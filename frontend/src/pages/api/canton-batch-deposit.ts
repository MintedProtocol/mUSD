/**
 * POST /api/canton-batch-deposit
 *
 * Batch collateral deposit endpoint for the lending service:
 *   - collateralType="smusd"  → exercises Lending_BatchDepositSMUSD
 *   - collateralType="smusde" → exercises Lending_BatchDepositSMUSDE
 *
 * Feature-gated: requires ENABLE_BATCH_CHOICES=true.
 * When disabled, returns 404 so callers fall back to the legacy single-position path.
 *
 * Request body:
 *   { party, collateralType, contractIds, existingEscrowCid?, collateralAggCid? }
 *
 * Response (success):
 *   { success: true, mode: "batch", collateralType, commandId, positionCount }
 *
 * Response (error):
 *   { success: false, error, errorType, fallbackAllowed? }
 */
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import {
  getCantonBaseUrl,
  getCantonToken,
  getCantonParty,
  getCantonUser,
  getLendingPackageId,
  validateConfig,
  guardMethod,
  guardBodyParty,
  IdempotencyStore,
  deriveIdempotencyKey,
} from "@/lib/api-hardening";
import {
  isBatchChoicesEnabled,
  isLendingBatchDepositEnabled,
} from "@/lib/server/batch-feature-flags";
import { guardBatchDepositBody } from "@/lib/server/batch-validation";

// ── types ──────────────────────────────────────────────────────────────

interface BatchDepositRecord {
  success: true;
  mode: "batch";
  collateralType: "smusd" | "smusde";
  commandId: string;
  positionCount: number;
}

// ── state ──────────────────────────────────────────────────────────────

const depositLog = new IdempotencyStore<BatchDepositRecord>({
  maxEntries: 500,
  ttlMs: 300_000,
});

// ── canton HTTP helper ─────────────────────────────────────────────────

async function cantonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${getCantonBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getCantonToken()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new CantonApiError(resp.status, path, text);
  }
  return resp.json() as Promise<T>;
}

class CantonApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`Canton API ${status} ${path}: ${body.slice(0, 200)}`);
    this.name = "CantonApiError";
  }
}

// ── template resolution ────────────────────────────────────────────────

function resolveDepositChoice(collateralType: "smusd" | "smusde"): {
  choice: string;
  cidField: string;
} {
  if (collateralType === "smusd") {
    return { choice: "Lending_BatchDepositSMUSD", cidField: "smusdCids" };
  }
  return { choice: "Lending_BatchDepositSMUSDE", cidField: "smusdeCids" };
}

// ── handler ────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Method guard
  if (!guardMethod(req, res, "POST")) return;

  // 2. Feature flag gate
  if (!isBatchChoicesEnabled() || !isLendingBatchDepositEnabled()) {
    return res.status(404).json({
      success: false,
      error: "Batch deposit not enabled",
      errorType: "FEATURE_DISABLED",
    });
  }

  // 3. Config validation
  const configErr = validateConfig({ requireLending: true });
  if (configErr) {
    return res.status(500).json({ success: false, ...configErr });
  }

  // 4. Input validation
  const input = guardBatchDepositBody(req, res);
  if (!input) return;

  // 5. Party validation
  const userParty = guardBodyParty(req, res, {
    extraFields: { mode: "batch", collateralType: input.collateralType },
  });
  if (!userParty) return;

  // 6. Idempotency check
  // Both optional targets must be in the key — different aggregate or
  // escrow target for the same CIDs is a distinct operation.
  const extraParts = [
    input.existingEscrowCid ?? "",
    input.collateralAggCid ?? "",
  ].join("|");
  const idemKey = deriveIdempotencyKey(
    `batch-deposit-${input.collateralType}`,
    input.contractIds,
    String(input.contractIds.length),
    userParty,
    extraParts
  );
  const cached = depositLog.get(idemKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  // 7. Build and submit command
  const operatorParty = getCantonParty();
  const lendingPkgId = getLendingPackageId();
  const templateId = `${lendingPkgId}:CantonLending:CantonLendingService`;
  const { choice, cidField } = resolveDepositChoice(input.collateralType);
  const commandId = `batch-deposit-${input.collateralType}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")}`;

  try {
    // Query for lending service contract
    const { offset } = await cantonRequest<{ offset: string }>(
      "GET",
      "/v2/state/ledger-end"
    );

    const services = await queryActiveContracts(operatorParty, offset, templateId);
    if (services.length === 0) {
      return res.status(502).json({
        success: false,
        error: "No lending service contract found",
        errorType: "SERVICE_NOT_FOUND",
      });
    }
    const serviceContractId = services[0].contractId;

    // Build exercise command
    // Lending batch deposits are nonconsuming choices, but the Canton API
    // still uses ExerciseCommand (the ledger handles nonconsuming internally)
    const choiceArgument: Record<string, unknown> = {
      user: userParty,
      [cidField]: input.contractIds,
      existingEscrowCid: input.existingEscrowCid ?? null,
      collateralAggCid: input.collateralAggCid ?? null,
    };

    const body = {
      userId: getCantonUser(),
      actAs: Array.from(new Set([userParty, operatorParty])),
      readAs: [operatorParty],
      commandId,
      commands: [
        {
          ExerciseCommand: {
            templateId,
            contractId: serviceContractId,
            choice,
            choiceArgument,
          },
        },
      ],
    };

    await cantonRequest("POST", "/v2/commands/submit-and-wait", body);

    const record: BatchDepositRecord = {
      success: true,
      mode: "batch",
      collateralType: input.collateralType,
      commandId,
      positionCount: input.contractIds.length,
    };
    depositLog.set(idemKey, record);
    return res.status(200).json(record);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof CantonApiError ? mapCantonStatus(err.status) : 502;

    console.error(`[batch-deposit] ${input.collateralType} error:`, message);

    return res.status(status).json({
      success: false,
      error: message,
      errorType: classifyErrorType(message),
      collateralType: input.collateralType,
      fallbackAllowed: status >= 500,
    });
  }
}

// ── helpers ────────────────────────────────────────────────────────────

function mapCantonStatus(cantonStatus: number): number {
  if (cantonStatus === 400) return 400;
  if (cantonStatus === 403) return 403;
  if (cantonStatus === 404) return 404;
  if (cantonStatus === 409) return 409;
  return 502;
}

function classifyErrorType(message: string): string {
  if (message.includes("SERVICE_PAUSED")) return "SERVICE_PAUSED";
  if (message.includes("NO_POSITIONS_PROVIDED")) return "NO_POSITIONS_PROVIDED";
  if (message.includes("NOT_OWNER")) return "NOT_OWNER";
  if (message.includes("ISSUER_MUST_BE_OPERATOR")) return "ISSUER_MISMATCH";
  if (message.includes("SMUSD_NOT_ENABLED")) return "COLLATERAL_NOT_ENABLED";
  if (message.includes("SMUSDE_NOT_ENABLED")) return "COLLATERAL_NOT_ENABLED";
  return "CANTON_ERROR";
}

interface RawContract {
  contractId: string;
  templateId: string;
}

async function queryActiveContracts(
  party: string,
  offset: string,
  fullTemplateId: string
): Promise<RawContract[]> {
  try {
    const raw = await cantonRequest<unknown>("POST", "/v2/state/active-contracts?limit=200", {
      eventFormat: {
        filtersByParty: {
          [party]: {
            cumulative: [
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: {
                      templateId: fullTemplateId,
                      includeCreatedEventBlob: false,
                    },
                  },
                },
              },
            ],
          },
        },
        verbose: true,
      },
      activeAtOffset: offset,
    });

    const entries: unknown[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { result?: unknown[] }).result)
        ? (raw as { result: unknown[] }).result
        : [];

    const contracts: RawContract[] = [];
    for (const entry of entries) {
      const ac = (entry as Record<string, unknown>)?.contractEntry;
      const jsAc =
        ac && typeof ac === "object"
          ? (ac as Record<string, unknown>).JsActiveContract
          : null;
      if (!jsAc || typeof jsAc !== "object") continue;
      const evt = (jsAc as Record<string, unknown>).createdEvent as
        | Record<string, unknown>
        | undefined;
      if (!evt) continue;
      contracts.push({
        contractId: evt.contractId as string,
        templateId: evt.templateId as string,
      });
    }
    return contracts;
  } catch (err: unknown) {
    if (String((err as Error)?.message || "").includes("Canton API 404")) return [];
    throw err;
  }
}

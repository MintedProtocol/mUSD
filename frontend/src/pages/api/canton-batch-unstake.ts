/**
 * POST /api/canton-batch-unstake
 *
 * Batch unstake endpoint supporting two pools:
 *   - pool="ethpool" → exercises ETHPool_BatchUnstake on CantonETHPoolService
 *   - pool="smusd"   → exercises Unstake_Batch on CantonStakingService
 *
 * Feature-gated: requires ENABLE_BATCH_CHOICES=true.
 * When disabled, returns 404 so callers fall back to the legacy single-position path.
 *
 * Request body:
 *   { party, pool, contractIds, requestedMusd }
 *
 * Response (success):
 *   { success: true, mode: "batch", pool, commandId, requestedMusd }
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
  getPackageId,
  validateConfig,
  guardMethod,
  guardBodyParty,
  IdempotencyStore,
  deriveIdempotencyKey,
  toDamlDecimal,
  toDisplay,
} from "@/lib/api-hardening";
import {
  isBatchChoicesEnabled,
  isEthPoolBatchUnstakeEnabled,
  isSmUsdBatchUnstakeEnabled,
} from "@/lib/server/batch-feature-flags";
import { guardBatchUnstakeBody } from "@/lib/server/batch-validation";

// ── types ──────────────────────────────────────────────────────────────

interface BatchUnstakeRecord {
  success: true;
  mode: "batch";
  pool: "ethpool" | "smusd";
  commandId: string;
  requestedMusd: string;
}

// ── state ──────────────────────────────────────────────────────────────

const unstakeLog = new IdempotencyStore<BatchUnstakeRecord>({ maxEntries: 500, ttlMs: 300_000 });

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

function resolveServiceTemplate(pool: "ethpool" | "smusd"): {
  templateId: string;
  choice: string;
  cidField: string;
} {
  const pkgId = getPackageId();
  if (pool === "ethpool") {
    return {
      templateId: `${pkgId}:CantonETHPool:CantonETHPoolService`,
      choice: "ETHPool_BatchUnstake",
      cidField: "smusdeCids",
    };
  }
  return {
    templateId: `${pkgId}:CantonSMUSD:CantonStakingService`,
    choice: "Unstake_Batch",
    cidField: "smusdCids",
  };
}

// ── handler ────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Method guard
  if (!guardMethod(req, res, "POST")) return;

  // 2. Feature flag gate
  if (!isBatchChoicesEnabled()) {
    return res.status(404).json({
      success: false,
      error: "Batch choices not enabled",
      errorType: "FEATURE_DISABLED",
    });
  }

  // 3. Config validation
  const configErr = validateConfig();
  if (configErr) {
    return res.status(500).json({ success: false, ...configErr });
  }

  // 4. Input validation
  const input = guardBatchUnstakeBody(req, res);
  if (!input) return; // response already sent

  // 5. Per-choice feature gate
  if (input.pool === "ethpool" && !isEthPoolBatchUnstakeEnabled()) {
    return res.status(404).json({
      success: false,
      error: "ETHPool_BatchUnstake not enabled",
      errorType: "FEATURE_DISABLED",
    });
  }
  if (input.pool === "smusd" && !isSmUsdBatchUnstakeEnabled()) {
    return res.status(404).json({
      success: false,
      error: "Unstake_Batch not enabled",
      errorType: "FEATURE_DISABLED",
    });
  }

  // 6. Party validation (full format check)
  const userParty = guardBodyParty(req, res, {
    extraFields: { mode: "batch", pool: input.pool },
  });
  if (!userParty) return;

  // 7. Idempotency check
  const idemKey = deriveIdempotencyKey(
    `batch-unstake-${input.pool}`,
    input.contractIds,
    input.requestedMusd,
    userParty
  );
  const cached = unstakeLog.get(idemKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  // 8. Build and submit command
  const operatorParty = getCantonParty();
  const { templateId, choice, cidField } = resolveServiceTemplate(input.pool);
  const commandId = `batch-unstake-${input.pool}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")}`;

  try {
    // Query for the service contract
    const { offset } = await cantonRequest<{ offset: string }>(
      "GET",
      "/v2/state/ledger-end"
    );

    const services = await queryActiveContracts(operatorParty, offset, templateId);
    if (services.length === 0) {
      return res.status(502).json({
        success: false,
        error: `No ${input.pool === "ethpool" ? "ETHPool" : "Staking"} service contract found`,
        errorType: "SERVICE_NOT_FOUND",
      });
    }
    const serviceContractId = services[0].contractId;

    // Build exercise command
    const choiceArgument: Record<string, unknown> = {
      user: userParty,
      [cidField]: input.contractIds,
      requestedMusd: toDamlDecimal(parseFloat(input.requestedMusd)),
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

    const record: BatchUnstakeRecord = {
      success: true,
      mode: "batch",
      pool: input.pool,
      commandId,
      requestedMusd: toDisplay(parseFloat(input.requestedMusd)),
    };
    unstakeLog.set(idemKey, record);
    return res.status(200).json(record);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof CantonApiError ? mapCantonStatus(err.status) : 502;

    console.error(`[batch-unstake] ${input.pool} error:`, message);

    return res.status(status).json({
      success: false,
      error: message,
      errorType: classifyErrorType(message),
      pool: input.pool,
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
  if (message.includes("OWNER_MISMATCH")) return "OWNER_MISMATCH";
  if (message.includes("ISSUER_MISMATCH")) return "ISSUER_MISMATCH";
  if (message.includes("POSITION_LOCKED")) return "POSITION_LOCKED";
  if (message.includes("COOLDOWN_NOT_ELAPSED")) return "COOLDOWN_NOT_ELAPSED";
  if (message.includes("INSUFFICIENT_BALANCE")) return "INSUFFICIENT_BALANCE";
  if (message.includes("UNSTAKE_EXCEEDS_MUSD_MINT_CAP")) return "UNSTAKE_EXCEEDS_MUSD_MINT_CAP";
  if (message.includes("REQUESTED_AMOUNT_POSITIVE")) return "REQUESTED_AMOUNT_POSITIVE";
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

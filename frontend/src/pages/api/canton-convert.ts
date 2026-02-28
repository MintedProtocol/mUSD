import type { NextApiRequest, NextApiResponse } from "next";
import * as crypto from "crypto";

/**
 * /api/canton-convert — CIP-56 → Redeemable (legacy CantonMUSD) inventory swap.
 *
 * Model: Operator holds legacy CantonMUSD inventory. User's CIP-56 tokens
 * are locked (transferred to operator as escrow), and equivalent CantonMUSD
 * is released from operator inventory to user.
 *
 * Supply invariant: Every conversion archives CIP-56 tokens, re-creates them
 * under the operator (locked escrow), and simultaneously transfers equal-value
 * CantonMUSD from operator to user. Net protocol supply change = 0.
 *
 * POST { party: string, amount: string }
 * Returns: { success, convertedAmount, sourceTemplate, targetTemplate, commandId }
 */

const CANTON_BASE_URL =
  process.env.CANTON_API_URL ||
  `http://${process.env.CANTON_HOST || "localhost"}:${process.env.CANTON_PORT || "7575"}`;
const CANTON_TOKEN = process.env.CANTON_TOKEN || "dummy-no-auth";
const CANTON_PARTY =
  process.env.CANTON_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const CANTON_USER = process.env.CANTON_USER || "administrator";
const PACKAGE_ID =
  process.env.NEXT_PUBLIC_DAML_PACKAGE_ID ||
  process.env.CANTON_PACKAGE_ID ||
  "";
const CIP56_PACKAGE_ID =
  process.env.NEXT_PUBLIC_CIP56_PACKAGE_ID ||
  process.env.CIP56_PACKAGE_ID ||
  "";
const CANTON_PARTY_PATTERN = /^[A-Za-z0-9._:-]+::1220[0-9a-f]{64}$/i;

// Known V3 packages for operator inventory discovery
const V3_PACKAGE_IDS: string[] = Array.from(new Set([
  PACKAGE_ID,
  process.env.CANTON_PACKAGE_ID,
  "eff3bf30edb508b2d052f969203db972e59c66e974344ed43016cfccfa618f06",
  "f9481d29611628c7145d3d9a856aed6bb318d7fdd371a0262dbac7ca22b0142b",
].filter((id): id is string => typeof id === "string" && id.length === 64)));

// ── Idempotency store ──────────────────────────────────────
interface ConversionRecord {
  success: boolean;
  convertedAmount: string;
  sourceTemplate: string;
  targetTemplate: string;
  commandId: string;
  lockedCip56Cids: string[];
  /** First consumed operator source CID (backward-compatible single value). */
  releasedFromCid: string;
  /** All consumed operator source CIDs (multi-source). */
  releasedFromCids: string[];
  timestamp: string;
}

const conversionLog = new Map<string, ConversionRecord>();

function idempotencyKey(sourceCids: string[], amount: string, party: string): string {
  const sorted = [...sourceCids].sort().join(",");
  return crypto.createHash("sha256").update(`${sorted}:${amount}:${party}`).digest("hex").slice(0, 32);
}

// ── Canton API helpers ─────────────────────────────────────
interface RawContract {
  contractId: string;
  templateId: string;
  createArgument: Record<string, unknown>;
}

async function cantonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${CANTON_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${CANTON_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Canton API ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

async function queryActiveContracts(
  party: string,
  offset: number,
  fullTemplateId: string
): Promise<RawContract[]> {
  try {
    const raw = await cantonRequest<unknown>("POST", "/v2/state/active-contracts?limit=200", {
      eventFormat: {
        filtersByParty: {
          [party]: {
            cumulative: [{
              identifierFilter: {
                TemplateFilter: {
                  value: { templateId: fullTemplateId, includeCreatedEventBlob: false },
                },
              },
            }],
          },
        },
        verbose: true,
      },
      activeAtOffset: offset,
    });

    const entries: unknown[] = Array.isArray(raw) ? raw :
      (raw && typeof raw === "object" && Array.isArray((raw as { result?: unknown[] }).result))
        ? (raw as { result: unknown[] }).result
        : [];

    const contracts: RawContract[] = [];
    for (const entry of entries) {
      const ac = (entry as Record<string, unknown>)?.contractEntry;
      const jsAc = ac && typeof ac === "object" ? (ac as Record<string, unknown>).JsActiveContract : null;
      if (!jsAc || typeof jsAc !== "object") continue;
      const evt = (jsAc as Record<string, unknown>).createdEvent as Record<string, unknown> | undefined;
      if (!evt) continue;
      contracts.push({
        contractId: evt.contractId as string,
        templateId: evt.templateId as string,
        createArgument: evt.createArgument as Record<string, unknown>,
      });
    }
    return contracts;
  } catch (err: unknown) {
    if (String((err as Error)?.message || "").includes("Canton API 404")) return [];
    throw err;
  }
}

// ── Main handler ───────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { party, amount } = req.body || {};

  // ── Validate ─────────────────────────────────────────────
  if (!party || typeof party !== "string" || !CANTON_PARTY_PATTERN.test(party.trim())) {
    return res.status(400).json({ error: "Invalid Canton party" });
  }
  const userParty = party.trim();

  if (!amount || typeof amount !== "string") {
    return res.status(400).json({ error: "Missing amount" });
  }
  const convertAmount = parseFloat(amount);
  if (!Number.isFinite(convertAmount) || convertAmount <= 0) {
    return res.status(400).json({ error: "Amount must be positive" });
  }

  if (!CIP56_PACKAGE_ID) {
    return res.status(500).json({ error: "CIP56_PACKAGE_ID not configured" });
  }

  const operatorParty = CANTON_PARTY;

  try {
    // 1. Get ledger offset
    const { offset } = await cantonRequest<{ offset: number }>("GET", "/v2/state/ledger-end");

    // 2. Query user's CIP56 tokens
    const cip56TemplateId = `${CIP56_PACKAGE_ID}:CIP56Interfaces:CIP56MintedMUSD`;
    const userCip56Raw = await queryActiveContracts(userParty, offset, cip56TemplateId);

    const userCip56 = userCip56Raw
      .filter(c => (c.createArgument.owner as string) === userParty)
      .map(c => ({
        contractId: c.contractId,
        templateId: c.templateId,
        amount: parseFloat((c.createArgument.amount as string) || "0"),
        issuer: (c.createArgument.issuer as string) || operatorParty,
        agreementHash: (c.createArgument.agreementHash as string) || "",
        agreementUri: (c.createArgument.agreementUri as string) || "",
      }))
      .sort((a, b) => b.amount - a.amount); // largest first for greedy selection

    const totalCip56 = userCip56.reduce((s, c) => s + c.amount, 0);
    if (totalCip56 < convertAmount - 0.000001) {
      return res.status(400).json({
        error: `Insufficient CIP-56 balance: have ${totalCip56.toFixed(6)}, need ${convertAmount.toFixed(6)}`,
      });
    }

    // 3. Select CIP56 tokens to lock (greedy, largest-first)
    const selectedCip56: typeof userCip56 = [];
    let selectedSum = 0;
    for (const c of userCip56) {
      if (selectedSum >= convertAmount - 0.000001) break;
      selectedCip56.push(c);
      selectedSum += c.amount;
    }

    // 4. Check idempotency
    const sourceCids = selectedCip56.map(c => c.contractId);
    const idemKey = idempotencyKey(sourceCids, convertAmount.toFixed(6), userParty);
    const existing = conversionLog.get(idemKey);
    if (existing) {
      return res.status(200).json(existing);
    }

    // 5. Discover pool-reserved CIDs to exclude from inventory selection.
    //    The staking service (CantonStakingService) holds a poolMusdCid that
    //    must never be consumed by conversion swaps.
    const reservedCids = new Set<string>();
    for (const pkg of V3_PACKAGE_IDS) {
      try {
        const svcs = await queryActiveContracts(
          operatorParty, offset, `${pkg}:CantonSMUSD:CantonStakingService`
        );
        for (const s of svcs) {
          const poolCid = s.createArgument.poolMusdCid;
          if (typeof poolCid === "string" && poolCid.length > 0) {
            reservedCids.add(poolCid);
          }
        }
      } catch { /* staking service may not exist for all packages */ }
    }
    if (reservedCids.size > 0) {
      console.log(`[canton-convert] Excluding ${reservedCids.size} pool-reserved CID(s) from inventory`);
    }

    // 5b. Query operator's CantonMUSD inventory (excluding reserved pool CIDs)
    const operatorMusd: Array<{
      contractId: string;
      templateId: string;
      amount: number;
      issuer: string;
      agreementHash: string;
      agreementUri: string;
    }> = [];

    for (const pkg of V3_PACKAGE_IDS) {
      const tplId = `${pkg}:CantonDirectMint:CantonMUSD`;
      const contracts = await queryActiveContracts(operatorParty, offset, tplId);
      for (const c of contracts) {
        if ((c.createArgument.owner as string) === operatorParty &&
            (c.createArgument.issuer as string) === operatorParty &&
            !reservedCids.has(c.contractId)) {
          operatorMusd.push({
            contractId: c.contractId,
            templateId: c.templateId,
            amount: parseFloat((c.createArgument.amount as string) || "0"),
            issuer: (c.createArgument.issuer as string) || "",
            agreementHash: (c.createArgument.agreementHash as string) || "",
            agreementUri: (c.createArgument.agreementUri as string) || "",
          });
        }
      }
    }

    const totalOperatorMusd = operatorMusd.reduce((s, c) => s + c.amount, 0);
    if (totalOperatorMusd < convertAmount - 0.000001) {
      return res.status(409).json({
        error: `Insufficient operator inventory: have ${totalOperatorMusd.toFixed(6)} redeemable, need ${convertAmount.toFixed(6)}`,
        inventoryAvailable: totalOperatorMusd.toFixed(6),
      });
    }

    // Select operator CantonMUSD sources (greedy, largest-first)
    operatorMusd.sort((a, b) => b.amount - a.amount);
    const selectedOperatorSources: typeof operatorMusd = [];
    let operatorSelectedSum = 0;
    for (const c of operatorMusd) {
      if (operatorSelectedSum >= convertAmount - 0.000001) break;
      selectedOperatorSources.push(c);
      operatorSelectedSum += c.amount;
    }

    // 6. Build atomic batch command
    // All commands in one submit-and-wait = atomic transaction.
    // actAs includes both parties since CIP56 signatories are [issuer=operator, owner=user]
    // and CantonMUSD signatories are [issuer=operator, owner=operator/user].
    const commandId = `convert-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const commands: unknown[] = [];
    const actAs = Array.from(new Set([userParty, operatorParty]));
    const readAs = actAs;

    const refCip56 = selectedCip56[0];
    const cip56Issuer = refCip56.issuer || operatorParty;

    // A. Archive each selected CIP56 token
    for (const c of selectedCip56) {
      commands.push({
        ExerciseCommand: {
          templateId: cip56TemplateId,
          contractId: c.contractId,
          choice: "Archive",
          choiceArgument: {},
        },
      });
    }

    // B. Create CIP56 change for user (if inputs > convertAmount)
    const changeAmount = selectedSum - convertAmount;
    if (changeAmount > 0.000001) {
      commands.push({
        CreateCommand: {
          templateId: cip56TemplateId,
          createArguments: {
            issuer: cip56Issuer,
            owner: userParty,
            amount: changeAmount.toFixed(10),
            blacklisted: false,
            agreementHash: refCip56.agreementHash,
            agreementUri: refCip56.agreementUri,
            observers: [],
          },
        },
      });
    }

    // C. Create CIP56 escrow for operator (locked amount)
    commands.push({
      CreateCommand: {
        templateId: cip56TemplateId,
        createArguments: {
          issuer: cip56Issuer,
          owner: operatorParty,
          amount: convertAmount.toFixed(10),
          blacklisted: false,
          agreementHash: refCip56.agreementHash,
          agreementUri: refCip56.agreementUri,
          observers: [],
        },
      },
    });

    // D. Archive each selected operator CantonMUSD source
    for (const src of selectedOperatorSources) {
      commands.push({
        ExerciseCommand: {
          templateId: src.templateId,
          contractId: src.contractId,
          choice: "Archive",
          choiceArgument: {},
        },
      });
    }

    // E. Create CantonMUSD for user (released inventory)
    const refOperator = selectedOperatorSources[0];
    commands.push({
      CreateCommand: {
        templateId: refOperator.templateId,
        createArguments: {
          issuer: refOperator.issuer,
          owner: userParty,
          amount: convertAmount.toFixed(10),
          agreementHash: refOperator.agreementHash,
          agreementUri: refOperator.agreementUri,
          privacyObservers: [],
        },
      },
    });

    // F. Create CantonMUSD remainder for operator (partially consumed last source)
    const operatorRemainder = operatorSelectedSum - convertAmount;
    if (operatorRemainder > 0.000001) {
      const lastSource = selectedOperatorSources[selectedOperatorSources.length - 1];
      commands.push({
        CreateCommand: {
          templateId: lastSource.templateId,
          createArguments: {
            issuer: lastSource.issuer,
            owner: operatorParty,
            amount: operatorRemainder.toFixed(10),
            agreementHash: lastSource.agreementHash,
            agreementUri: lastSource.agreementUri,
            privacyObservers: [],
          },
        },
      });
    }

    // 7. Submit atomic batch
    console.log(`[canton-convert] Submitting ${commands.length} cmds (${selectedOperatorSources.length} operator sources): ${convertAmount.toFixed(6)} CIP56→CantonMUSD for ${userParty.slice(0, 30)}`);

    await cantonRequest("POST", "/v2/commands/submit-and-wait", {
      userId: CANTON_USER,
      actAs,
      readAs,
      commandId,
      commands,
    });

    // 8. Record + return
    const record: ConversionRecord = {
      success: true,
      convertedAmount: convertAmount.toFixed(6),
      sourceTemplate: "CIP56MintedMUSD",
      targetTemplate: "CantonMUSD",
      commandId,
      lockedCip56Cids: sourceCids,
      releasedFromCid: selectedOperatorSources[0].contractId,
      releasedFromCids: selectedOperatorSources.map(s => s.contractId),
      timestamp: new Date().toISOString(),
    };

    conversionLog.set(idemKey, record);
    console.log(`[canton-convert] Conversion complete: ${convertAmount.toFixed(6)} CIP56→CantonMUSD`);

    return res.status(200).json(record);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canton-convert] Error:", message);
    return res.status(502).json({ success: false, error: message });
  }
}

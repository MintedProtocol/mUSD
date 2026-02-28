import type { NextApiRequest, NextApiResponse } from "next";

/**
 * /api/canton-bridge-preflight — Pre-submission check for bridge-out.
 *
 * Returns the user's bridgeable capacity given current ledger state:
 * - CIP-56 balance, redeemable balance, operator conversion inventory
 * - Max bridgeable amount (min of user total, conversion capacity)
 * - Deterministic blockers if any
 *
 * GET ?party=<canton-party>
 */

const CANTON_BASE_URL =
  process.env.CANTON_API_URL ||
  `http://${process.env.CANTON_HOST || "localhost"}:${process.env.CANTON_PORT || "7575"}`;
const CANTON_TOKEN = process.env.CANTON_TOKEN || "dummy-no-auth";
const CANTON_PARTY =
  process.env.CANTON_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const PACKAGE_ID =
  process.env.NEXT_PUBLIC_DAML_PACKAGE_ID ||
  process.env.CANTON_PACKAGE_ID ||
  "";
const CIP56_PACKAGE_ID =
  process.env.NEXT_PUBLIC_CIP56_PACKAGE_ID ||
  process.env.CIP56_PACKAGE_ID ||
  "";
const CANTON_PARTY_PATTERN = /^[A-Za-z0-9._:-]+::1220[0-9a-f]{64}$/i;

const V3_PACKAGE_IDS: string[] = Array.from(new Set([
  PACKAGE_ID,
  process.env.CANTON_PACKAGE_ID,
  "eff3bf30edb508b2d052f969203db972e59c66e974344ed43016cfccfa618f06",
  "f9481d29611628c7145d3d9a856aed6bb318d7fdd371a0262dbac7ca22b0142b",
].filter((id): id is string => typeof id === "string" && id.length === 64)));

// ── Canton API helper ────────────────────────────────────────
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
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Canton API ${resp.status}: ${text.slice(0, 300)}`);
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

// ── Main handler ─────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const party = (req.query.party as string)?.trim();
  if (!party || !CANTON_PARTY_PATTERN.test(party)) {
    return res.status(400).json({ error: "Invalid or missing Canton party" });
  }

  const operatorParty = CANTON_PARTY;

  try {
    const { offset } = await cantonRequest<{ offset: number }>("GET", "/v2/state/ledger-end");

    // 1. User's CIP-56 balance
    let userCip56Balance = 0;
    if (CIP56_PACKAGE_ID) {
      const cip56TemplateId = `${CIP56_PACKAGE_ID}:CIP56Interfaces:CIP56MintedMUSD`;
      const cip56Contracts = await queryActiveContracts(party, offset, cip56TemplateId);
      for (const c of cip56Contracts) {
        if ((c.createArgument.owner as string) === party) {
          userCip56Balance += parseFloat((c.createArgument.amount as string) || "0");
        }
      }
    }

    // 2. User's redeemable (legacy CantonMUSD) balance
    let userRedeemableBalance = 0;
    for (const pkg of V3_PACKAGE_IDS) {
      const tplId = `${pkg}:CantonDirectMint:CantonMUSD`;
      const contracts = await queryActiveContracts(party, offset, tplId);
      for (const c of contracts) {
        if ((c.createArgument.owner as string) === party) {
          userRedeemableBalance += parseFloat((c.createArgument.amount as string) || "0");
        }
      }
    }

    // 3. Operator's conversion inventory (excluding pool-reserved CIDs)
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

    let operatorInventory = 0;
    for (const pkg of V3_PACKAGE_IDS) {
      const tplId = `${pkg}:CantonDirectMint:CantonMUSD`;
      const contracts = await queryActiveContracts(operatorParty, offset, tplId);
      for (const c of contracts) {
        if ((c.createArgument.owner as string) === operatorParty &&
            (c.createArgument.issuer as string) === operatorParty &&
            !reservedCids.has(c.contractId)) {
          operatorInventory += parseFloat((c.createArgument.amount as string) || "0");
        }
      }
    }

    // 4. Compute max bridgeable
    // User can bridge up to: redeemable + min(cip56, operatorInventory)
    const convertibleCip56 = Math.min(userCip56Balance, operatorInventory);
    const maxBridgeable = userRedeemableBalance + convertibleCip56;
    const userTotal = userRedeemableBalance + userCip56Balance;

    // 5. Determine blockers
    const blockers: string[] = [];
    if (userTotal <= 0) {
      blockers.push("NO_BALANCE");
    }
    if (userCip56Balance > 0 && operatorInventory <= 0) {
      blockers.push("NO_OPERATOR_INVENTORY");
    }
    if (userCip56Balance > operatorInventory && operatorInventory > 0) {
      blockers.push("LOW_OPERATOR_INVENTORY");
    }

    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(200).json({
      party,
      userCip56Balance: userCip56Balance.toFixed(6),
      userRedeemableBalance: userRedeemableBalance.toFixed(6),
      userTotal: userTotal.toFixed(6),
      operatorInventory: operatorInventory.toFixed(6),
      convertibleCip56: convertibleCip56.toFixed(6),
      maxBridgeable: maxBridgeable.toFixed(6),
      blockers,
      ledgerOffset: offset,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Classify error
    if (message.includes("413") || message.includes("too large")) {
      return res.status(502).json({
        error: "Canton ACS query limit exceeded (413). Reduce contract count or contact operator.",
        errorType: "ACS_QUERY_LIMIT",
      });
    }
    console.error("[canton-bridge-preflight] Error:", message);
    return res.status(502).json({ error: message, errorType: "CANTON_ERROR" });
  }
}

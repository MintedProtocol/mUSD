import type { NextApiRequest, NextApiResponse } from "next";
import * as crypto from "crypto";

/**
 * /api/canton-command — Server-side proxy to submit DAML commands to Canton.
 *
 * Supports:
 *   POST { action: "exercise", templateId, contractId, choice, argument }
 *   POST { action: "create", templateId, payload }
 *
 * Template IDs can be passed as short names (e.g. "CantonStakingService") or
 * fully qualified (e.g. "pkgId:Module:Entity"). Short names are resolved
 * via TEMPLATE_MAP below.
 *
 * This keeps the Canton auth token server-side and avoids CORS.
 */

const CANTON_BASE_URL =
  process.env.CANTON_API_URL ||
  `http://${process.env.CANTON_HOST || "localhost"}:${process.env.CANTON_PORT || "7575"}`;
const CANTON_TOKEN = process.env.CANTON_TOKEN || "dummy-no-auth";
const CANTON_PARTY =
  process.env.CANTON_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const RECIPIENT_ALIAS_MAP_RAW = process.env.CANTON_RECIPIENT_PARTY_ALIASES || "";
const CANTON_PARTY_PATTERN = /^[A-Za-z0-9._:-]+::1220[0-9a-f]{64}$/i;
const CANTON_USER = process.env.CANTON_USER || "administrator";
const PACKAGE_ID_RAW =
  (process.env.NEXT_PUBLIC_DAML_PACKAGE_ID || process.env.CANTON_PACKAGE_ID || "").trim();
const PACKAGE_ID_VALID = /^[0-9a-f]{64}$/i.test(PACKAGE_ID_RAW);
const PACKAGE_ID = PACKAGE_ID_RAW;
const CIP56_PACKAGE_ID =
  process.env.NEXT_PUBLIC_CIP56_PACKAGE_ID ||
  process.env.CIP56_PACKAGE_ID ||
  "";
const ALLOW_OPERATOR_FALLBACK =
  (process.env.CANTON_ALLOW_OPERATOR_FALLBACK || "").toLowerCase() === "true";
const CIP56_PACKAGE_ID_VALID = /^[0-9a-f]{64}$/i.test(CIP56_PACKAGE_ID);
const CIP56_FAUCET_AGREEMENT_HASH =
  process.env.CIP56_FAUCET_AGREEMENT_HASH ||
  process.env.NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_HASH ||
  "";
const CIP56_FAUCET_AGREEMENT_URI =
  process.env.CIP56_FAUCET_AGREEMENT_URI ||
  process.env.NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_URI ||
  "";

/** Short template names that resolve against CIP56_PACKAGE_ID (not PACKAGE_ID). */
const CIP56_SHORT_NAMES = new Set([
  "CIP56MintedMUSD",
  "MUSDTransferFactory",
  "MUSDTransferInstruction",
  "MUSDAllocationFactory",
  "MUSDAllocation",
]);

/**
 * Map short template names to fully-qualified Canton template IDs.
 * Format: "packageId:ModuleName:EntityName"
 */
const TEMPLATE_MAP: Record<string, string> = {
  // CantonDirectMint module
  CantonMUSD:              `${PACKAGE_ID}:CantonDirectMint:CantonMUSD`,
  CantonUSDC:              `${PACKAGE_ID}:CantonDirectMint:CantonUSDC`,
  USDCx:                   `${PACKAGE_ID}:CantonDirectMint:USDCx`,
  CantonDirectMintService: `${PACKAGE_ID}:CantonDirectMint:CantonDirectMintService`,
  BridgeOutRequest:        `${PACKAGE_ID}:CantonDirectMint:BridgeOutRequest`,
  // CantonSMUSD module
  CantonStakingService:    `${PACKAGE_ID}:CantonSMUSD:CantonStakingService`,
  CantonSMUSD:             `${PACKAGE_ID}:CantonSMUSD:CantonSMUSD`,
  // CantonETHPool module
  CantonETHPoolService:    `${PACKAGE_ID}:CantonETHPool:CantonETHPoolService`,
  CantonSMUSD_E:           `${PACKAGE_ID}:CantonETHPool:CantonSMUSD_E`,
  // CantonBoostPool module
  CantonBoostPoolService:  `${PACKAGE_ID}:CantonBoostPool:CantonBoostPoolService`,
  BoostPoolLP:             `${PACKAGE_ID}:CantonBoostPool:BoostPoolLP`,
  // CantonLending module
  CantonLendingService:    `${PACKAGE_ID}:CantonLending:CantonLendingService`,
  CantonPriceFeed:         `${PACKAGE_ID}:CantonLending:CantonPriceFeed`,
  EscrowedCollateral:      `${PACKAGE_ID}:CantonLending:EscrowedCollateral`,
  CantonDebtPosition:      `${PACKAGE_ID}:CantonLending:CantonDebtPosition`,
  // CantonCoinToken module
  CantonCoin:              `${PACKAGE_ID}:CantonCoinToken:CantonCoin`,
  // CantonCoinMint module
  CoinMintService:         `${PACKAGE_ID}:CantonCoinMint:CoinMintService`,
  // Minted.Protocol.V3 module
  BridgeService:           `${PACKAGE_ID}:Minted.Protocol.V3:BridgeService`,
  MUSDSupplyService:       `${PACKAGE_ID}:Minted.Protocol.V3:MUSDSupplyService`,
  MintedMUSD:              `${PACKAGE_ID}:Minted.Protocol.V3:MintedMUSD`,
  // Compliance module
  ComplianceRegistry:      `${PACKAGE_ID}:Compliance:ComplianceRegistry`,
  // CIP-56 interfaces (ble-protocol-cip56 package, SDK 3.4.10)
  ...(CIP56_PACKAGE_ID ? {
    CIP56MintedMUSD:         `${CIP56_PACKAGE_ID}:CIP56Interfaces:CIP56MintedMUSD`,
    MUSDTransferFactory:     `${CIP56_PACKAGE_ID}:CIP56Interfaces:MUSDTransferFactory`,
    MUSDTransferInstruction: `${CIP56_PACKAGE_ID}:CIP56Interfaces:MUSDTransferInstruction`,
    MUSDAllocationFactory:   `${CIP56_PACKAGE_ID}:CIP56Interfaces:MUSDAllocationFactory`,
    MUSDAllocation:          `${CIP56_PACKAGE_ID}:CIP56Interfaces:MUSDAllocation`,
  } : {}),
};

function parseRecipientAliasMap(): Record<string, string> {
  if (!RECIPIENT_ALIAS_MAP_RAW.trim()) return {};
  try {
    const parsed = JSON.parse(RECIPIENT_ALIAS_MAP_RAW);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([from, to]) =>
          typeof from === "string" &&
          from.trim().length > 0 &&
          typeof to === "string" &&
          to.trim().length > 0
      )
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

const RECIPIENT_ALIAS_MAP = parseRecipientAliasMap();

/** Resolve a short name or pass through a fully-qualified template ID. */
function resolveTemplateId(tpl: string): string {
  // Already fully qualified (contains ':')
  if (tpl.includes(":")) return tpl;
  const resolved = TEMPLATE_MAP[tpl];
  if (!resolved) throw new Error(`Unknown template short name: ${tpl}. Use fully qualified ID or add to TEMPLATE_MAP.`);
  return resolved;
}

function resolveRequestedParty(rawParty: unknown): string {
  if (typeof rawParty !== "string" || !rawParty.trim()) {
    if (ALLOW_OPERATOR_FALLBACK) return CANTON_PARTY;
    throw new Error("Missing Canton party for command submission");
  }
  const party = rawParty.trim();
  if (party.length > 200 || !CANTON_PARTY_PATTERN.test(party)) {
    throw new Error("Invalid Canton party");
  }
  return RECIPIENT_ALIAS_MAP[party] || party;
}

function shouldOperatorCosignCreate(
  resolvedTemplateId: string,
  payload: Record<string, unknown>,
  actAsParty: string
): string[] | false {
  // Devnet faucet mint flow: create operator-issued user-owned token contracts.
  // When payload has issuer+owner and owner == requested party, actAs must
  // include both the owner and the issuer so the Canton ledger accepts the
  // multi-signatory create.
  const entityName = resolvedTemplateId.split(":").pop() || "";
  const faucetEntities = new Set(["CantonCoin", "CantonUSDC", "USDCx", "CantonMUSD", "CIP56MintedMUSD"]);
  if (!faucetEntities.has(entityName)) return false;

  const issuer = typeof payload.issuer === "string" ? payload.issuer : "";
  const owner = typeof payload.owner === "string" ? payload.owner : "";
  if (!issuer || !owner) return false;

  // Owner must be the requesting party
  if (owner !== actAsParty) return false;
  // Issuer must be the operator (or at least a different party that we can act as)
  if (issuer === actAsParty) return false;

  // Return deduplicated actAs list: [owner, issuer, CANTON_PARTY]
  return Array.from(new Set([actAsParty, issuer, CANTON_PARTY]));
}

async function cantonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${CANTON_BASE_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${CANTON_TOKEN}`,
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, templateId, contractId, choice, argument, payload, party } = req.body || {};

  if (!templateId) {
    return res.status(400).json({ error: "Missing templateId" });
  }

  // Fail fast: short template names require the correct package ID for resolution.
  // CIP-56 short names use CIP56_PACKAGE_ID; all others use PACKAGE_ID.
  if (!templateId.includes(":")) {
    if (CIP56_SHORT_NAMES.has(templateId)) {
      if (!CIP56_PACKAGE_ID_VALID) {
        return res.status(500).json({
          success: false,
          error: "CIP56 package ID not configured (set NEXT_PUBLIC_CIP56_PACKAGE_ID or CIP56_PACKAGE_ID)",
        });
      }
    } else if (templateId in TEMPLATE_MAP) {
      if (!PACKAGE_ID_VALID) {
        return res.status(500).json({
          success: false,
          error: "CANTON package ID not configured (set NEXT_PUBLIC_DAML_PACKAGE_ID or CANTON_PACKAGE_ID)",
        });
      }
    }
    // Unknown short names fall through to resolveTemplateId() which returns 400
  }

  let resolvedTemplateId: string;
  try {
    resolvedTemplateId = resolveTemplateId(templateId);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  let actAsParty: string;
  try {
    actAsParty = resolveRequestedParty(party);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Invalid Canton party" });
  }
  const baseReadAsParties = Array.from(new Set([actAsParty, CANTON_PARTY]));

  const commandId = `ui-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  try {
    if (action === "create") {
      // Create a new contract
      if (!payload) {
        return res.status(400).json({ error: "Missing payload for create" });
      }

      const createPayload = payload as Record<string, unknown>;

      // Normalize faucet create payloads: ensure issuer = CANTON_PARTY,
      // owner = actAsParty, and default observer lists to [].
      const entityName = resolvedTemplateId.split(":").pop() || "";
      const faucetEntities = new Set(["CantonCoin", "CantonUSDC", "USDCx", "CantonMUSD", "CIP56MintedMUSD"]);
      if (faucetEntities.has(entityName)) {
        if (typeof createPayload.issuer === "string") createPayload.issuer = CANTON_PARTY;
        if (typeof createPayload.owner === "string") createPayload.owner = actAsParty;
        // Only default observer lists if already present in payload
        if ("privacyObservers" in createPayload && !Array.isArray(createPayload.privacyObservers)) {
          createPayload.privacyObservers = [];
        }
      }

      // CIP-56 faucet normalization: fill agreement fields, default booleans/arrays
      if (entityName === "CIP56MintedMUSD") {
        createPayload.issuer = CANTON_PARTY;
        createPayload.owner = actAsParty;
        if (createPayload.blacklisted === undefined) createPayload.blacklisted = false;
        if (!Array.isArray(createPayload.observers)) createPayload.observers = [];
        // Fill agreement hash/uri from env if not provided in request
        if (!createPayload.agreementHash && CIP56_FAUCET_AGREEMENT_HASH) {
          createPayload.agreementHash = CIP56_FAUCET_AGREEMENT_HASH;
        }
        if (!createPayload.agreementUri && CIP56_FAUCET_AGREEMENT_URI) {
          createPayload.agreementUri = CIP56_FAUCET_AGREEMENT_URI;
        }
        // Validate agreement fields
        const hash = String(createPayload.agreementHash || "");
        const uri = String(createPayload.agreementUri || "");
        if (!/^[0-9a-f]{64}$/i.test(hash)) {
          return res.status(400).json({
            success: false,
            error: `CIP-56 faucet requires agreementHash (64 hex chars). Set CIP56_FAUCET_AGREEMENT_HASH env var or pass in payload. Got: "${hash.slice(0, 20)}..."`,
          });
        }
        if (!uri.trim()) {
          return res.status(400).json({
            success: false,
            error: "CIP-56 faucet requires agreementUri. Set CIP56_FAUCET_AGREEMENT_URI env var or pass in payload.",
          });
        }
      }

      const cosignParties = shouldOperatorCosignCreate(resolvedTemplateId, createPayload, actAsParty);
      const createActAs = cosignParties || [actAsParty];
      const createReadAs = Array.from(new Set([...baseReadAsParties, ...createActAs]));

      const body = {
        userId: CANTON_USER,
        actAs: createActAs,
        readAs: createReadAs,
        commandId,
        commands: [
          {
            CreateCommand: {
              templateId: resolvedTemplateId,
              createArguments: createPayload,
            },
          },
        ],
      };

      console.log("[canton-command] CREATE", resolvedTemplateId);
      const result = await cantonRequest("POST", "/v2/commands/submit-and-wait", body);
      return res.status(200).json({ success: true, result });

    } else {
      // Exercise a choice (default action)
      if (!contractId || !choice) {
        return res.status(400).json({ error: "Missing contractId or choice" });
      }

      const body = {
        userId: CANTON_USER,
        actAs: [actAsParty],
        readAs: baseReadAsParties,
        commandId,
        commands: [
          {
            ExerciseCommand: {
              templateId: resolvedTemplateId,
              contractId,
              choice,
              choiceArgument: argument || {},
            },
          },
        ],
      };

      console.log("[canton-command] EXERCISE", resolvedTemplateId, choice, "on", contractId.slice(0, 20));
      const result = await cantonRequest("POST", "/v2/commands/submit-and-wait", body);
      return res.status(200).json({ success: true, result });
    }
  } catch (err: any) {
    console.error("Canton command error:", err.message);
    return res.status(502).json({ success: false, error: err.message });
  }
}

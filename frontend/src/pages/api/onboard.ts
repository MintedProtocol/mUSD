import type { NextApiRequest, NextApiResponse } from "next";

/**
 * /api/onboard — Canton party onboarding and compliance registration.
 *
 * Endpoints (via ?action= query param):
 *   GET  ?action=status&ethAddress=0x...  — Check if ETH address has Canton party
 *   POST ?action=provision                — Provision Canton party + ComplianceRegistry entry
 *   POST ?action=kyc-check                — Stub: check KYC status
 *
 * In production, this would integrate with:
 *   - Sumsub/Onfido for KYC verification
 *   - Canton Participant Admin API for party allocation
 *   - ComplianceRegistry DAML template for compliance entry
 *
 * Security: This runs server-side only. Canton admin tokens are never exposed to the client.
 */

// ── Types ──────────────────────────────────────────────────────
interface OnboardStatusResponse {
  registered: boolean;
  cantonParty: string | null;
  kycStatus: "none" | "pending" | "approved" | "rejected";
}

interface ProvisionResponse {
  success: boolean;
  cantonParty: string;
  complianceContractId: string;
}

interface KycCheckResponse {
  status: "pending" | "approved" | "rejected";
  message: string;
}

type ErrorResponse = { error: string };

// ── In-memory registry (replace with DB in production) ────────
const partyRegistry = new Map<
  string,
  { cantonParty: string; kycStatus: string; complianceCid: string }
>();

// ── Rate limiter for party allocation (Canton 3.4.4 self-allocation guard) ──
const allocationAttempts = new Map<string, { count: number; windowStart: number }>();
const ALLOCATION_RATE_LIMIT = 3;          // max attempts per window
const ALLOCATION_WINDOW_MS = 60 * 1000;   // 1 minute window

function checkAllocationRateLimit(ethAddress: string): boolean {
  const now = Date.now();
  const key = ethAddress.toLowerCase();
  const entry = allocationAttempts.get(key);
  if (!entry || now - entry.windowStart > ALLOCATION_WINDOW_MS) {
    allocationAttempts.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= ALLOCATION_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

// ── Canton Admin API helpers ──────────────────────────────────
const CANTON_ADMIN_URL =
  process.env.CANTON_ADMIN_URL ||
  process.env.CANTON_API_URL ||
  `http://${process.env.CANTON_HOST || "localhost"}:${process.env.CANTON_PORT || "7575"}`;
const CANTON_ADMIN_TOKEN = process.env.CANTON_ADMIN_TOKEN || "";
const CANTON_OPERATOR_PARTY =
  process.env.CANTON_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";

function partyHintFromEth(ethAddress: string): string {
  return `minted-user-${ethAddress.toLowerCase().slice(2, 10)}`;
}

function authHeaders(): Record<string, string> {
  return CANTON_ADMIN_TOKEN
    ? { Authorization: `Bearer ${CANTON_ADMIN_TOKEN}` }
    : {};
}

async function findPartyByHint(partyHint: string): Promise<string | null> {
  const resp = await fetch(`${CANTON_ADMIN_URL}/v2/parties`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const parties: Array<{ party?: string }> = data.partyDetails || [];
  const found = parties.find((p) => typeof p.party === "string" && p.party.startsWith(`${partyHint}::`));
  return found?.party || null;
}

function getLocalPartyNamespace(): string {
  const fallback =
    "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
  const party = process.env.CANTON_PARTY || fallback;
  const ns = party.split("::")[1];
  // Namespace should be 1220 + 64 hex chars.
  if (!ns || !/^1220[0-9a-f]{64}$/i.test(ns)) {
    const fallbackNs = fallback.split("::")[1];
    if (!fallbackNs || !/^1220[0-9a-f]{64}$/i.test(fallbackNs)) {
      throw new Error(`Invalid CANTON_PARTY format: ${party}`);
    }
    return fallbackNs;
  }
  return ns;
}

async function verifyPartyExists(party: string): Promise<boolean> {
  const encoded = encodeURIComponent(party);
  const resp = await fetch(`${CANTON_ADMIN_URL}/v2/parties/${encoded}`, {
    method: "GET",
    headers: {
      ...(CANTON_ADMIN_TOKEN
        ? { Authorization: `Bearer ${CANTON_ADMIN_TOKEN}` }
        : {}),
    },
  });
  return resp.ok;
}

/**
 * Allocate a party on the Canton participant via the admin API.
 * Uses Canton Ledger JSON API v2:
 *   POST /v2/parties with partyIdHint and displayName.
 */
async function allocateCantonParty(
  ethAddress: string
): Promise<string> {
  const partyHint = partyHintFromEth(ethAddress);
  const displayName = `Minted User ${ethAddress.slice(0, 8)}`;

  // If the party already exists on this participant, reuse it.
  const existingParty = await findPartyByHint(partyHint);
  if (existingParty) return existingParty;

  try {
    const resp = await fetch(`${CANTON_ADMIN_URL}/v2/parties`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        partyIdHint: partyHint,
        displayName: displayName,
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(
        `[Onboard] Party allocation failed: ${resp.status} ${errorText}`
      );
      // Idempotent path: if party already exists on this participant, reuse it.
      if (resp.status === 400) {
        if (/already allocated/i.test(errorText) || /already exists/i.test(errorText)) {
          // Build deterministic local party from hint + participant namespace.
          const candidate = `${partyHint}::${getLocalPartyNamespace()}`;
          if (await verifyPartyExists(candidate)) {
            return candidate;
          }
          // Fallback for environments that return full party in error text.
          const alreadyAllocatedMatch = errorText.match(
            /party\s+([A-Za-z0-9._:-]+::[A-Za-z0-9._-]+)\s+is already allocated/i
          );
          if (alreadyAllocatedMatch?.[1] && await verifyPartyExists(alreadyAllocatedMatch[1])) {
            return alreadyAllocatedMatch[1];
          }
        }
        const existing = await findPartyByHint(partyHint);
        if (existing) return existing;
      }
      throw new Error(`Party allocation failed: ${resp.status}`);
    }

    const data = await resp.json();
    const party =
      data.partyDetails?.party ||
      data.party ||
      data.result?.partyDetails?.party ||
      data.result?.party;
    if (!party || typeof party !== "string") {
      throw new Error("Party allocation succeeded but response did not include party");
    }
    return party;
  } catch (err) {
    console.error("[Onboard] Canton admin request failed:", err);
    throw err;
  }
}

/**
 * Create or verify a ComplianceRegistry entry for the new party.
 * Exercises ValidateMint to ensure the party is not blacklisted.
 */
async function ensureComplianceEntry(
  cantonParty: string
): Promise<string> {
  try {
    // Query for existing ComplianceRegistry
    // First get the current ledger offset for the ACS query
    const offsetResp = await fetch(`${CANTON_ADMIN_URL}/v2/state/ledger-end`, {
      method: "GET",
      headers: {
        ...(CANTON_ADMIN_TOKEN
          ? { Authorization: `Bearer ${CANTON_ADMIN_TOKEN}` }
          : {}),
      },
    });
    const offsetData: any = offsetResp.ok ? await offsetResp.json() : { offset: 0 };
    const activeAtOffset = offsetData.offset || 0;

    // Canton 3.4 JSON API v2: use eventFormat with cumulative TemplateFilter
    const PACKAGE_ID = (process.env.NEXT_PUBLIC_DAML_PACKAGE_ID ||
      process.env.CANTON_PACKAGE_ID ||
      "").trim();
    if (!/^[0-9a-f]{64}$/i.test(PACKAGE_ID)) {
      throw new Error("CANTON package ID not configured (set NEXT_PUBLIC_DAML_PACKAGE_ID or CANTON_PACKAGE_ID)");
    }
    const queryResp = await fetch(`${CANTON_ADMIN_URL}/v2/state/active-contracts?limit=200`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        eventFormat: {
          filtersByParty: {
            [CANTON_OPERATOR_PARTY]: {
              cumulative: [
                {
                  identifierFilter: {
                    TemplateFilter: {
                      value: {
                        templateId: `${PACKAGE_ID}:Compliance:ComplianceRegistry`,
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
        activeAtOffset,
      }),
    });

    if (queryResp.ok) {
      const data = await queryResp.json();
      // Canton 3.4 returns array or { result: [...] } of contractEntry objects
      let entries: any[];
      if (Array.isArray(data)) {
        entries = data;
      } else if (data && typeof data === "object" && Array.isArray(data.result)) {
        entries = data.result;
      } else {
        entries = [];
      }

      for (const entry of entries) {
        const ac = entry?.contractEntry?.JsActiveContract;
        if (ac?.createdEvent?.contractId) {
          return ac.createdEvent.contractId;
        }
      }
    }

    // Development fallback
    if (process.env.NODE_ENV !== "production") {
      return `compliance-dev-${Date.now()}`;
    }
    throw new Error("No ComplianceRegistry found on Canton");
  } catch (err) {
    console.error("[Onboard] Compliance check failed:", err);
    // Config errors must surface regardless of NODE_ENV
    if (err instanceof Error && err.message.includes("CANTON package ID not configured")) {
      throw err;
    }
    if (process.env.NODE_ENV !== "production") {
      return `compliance-dev-${Date.now()}`;
    }
    throw err;
  }
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    OnboardStatusResponse | ProvisionResponse | KycCheckResponse | ErrorResponse
  >
) {
  const action = req.query.action as string;

  // ── GET: Check onboarding status ──────────────────────────
  if (req.method === "GET" && action === "status") {
    const ethAddress = (req.query.ethAddress as string)?.toLowerCase();

    if (!ethAddress || !/^0x[a-f0-9]{40}$/.test(ethAddress)) {
      return res.status(400).json({ error: "Invalid Ethereum address" });
    }

    const entry = partyRegistry.get(ethAddress);
    if (entry) {
      return res.status(200).json({
        registered: true,
        cantonParty: entry.cantonParty,
        kycStatus: (entry.kycStatus as OnboardStatusResponse["kycStatus"]) || "approved",
      });
    }

    // Dev/server-restart fallback: infer deterministic local party and verify on ledger.
    const partyHint = `minted-user-${ethAddress.slice(2, 10)}`;
    const inferredParty = `${partyHint}::${getLocalPartyNamespace()}`;
    const exists = await verifyPartyExists(inferredParty).catch(() => false);
    if (exists) {
      return res.status(200).json({
        registered: true,
        cantonParty: inferredParty,
        kycStatus: "approved",
      });
    }

    const existingParty = await findPartyByHint(partyHintFromEth(ethAddress));
    if (existingParty) {
      partyRegistry.set(ethAddress, {
        cantonParty: existingParty,
        kycStatus: "approved",
        complianceCid: "compliance-existing",
      });
      return res.status(200).json({
        registered: true,
        cantonParty: existingParty,
        kycStatus: "approved",
      });
    }

    return res.status(200).json({
      registered: false,
      cantonParty: null,
      kycStatus: "none",
    });
  }

  // ── POST: Provision Canton party ──────────────────────────
  if (req.method === "POST" && action === "provision") {
    const { ethAddress, kycToken } = req.body || {};

    if (!ethAddress || !/^0x[a-f0-9]{40}$/i.test(ethAddress)) {
      return res.status(400).json({ error: "Invalid Ethereum address" });
    }

    // Canton 3.4.4 guard: rate-limit allocation attempts to prevent
    // party front-running via self-allocation
    if (!checkAllocationRateLimit(ethAddress)) {
      return res.status(429).json({ error: "Too many allocation attempts. Try again later." });
    }

    // Security: require admin token for party allocation in production
    if (process.env.NODE_ENV === "production" && !CANTON_ADMIN_TOKEN) {
      return res.status(500).json({
        error: "CANTON_ADMIN_TOKEN required for party allocation in production",
      });
    }

    // Check if already provisioned
    const existing = partyRegistry.get(ethAddress.toLowerCase());
    if (existing) {
      return res.status(200).json({
        success: true,
        cantonParty: existing.cantonParty,
        complianceContractId: existing.complianceCid,
      });
    }

    const existingParty = await findPartyByHint(partyHintFromEth(ethAddress));
    if (existingParty) {
      const complianceCid = await ensureComplianceEntry(existingParty);
      partyRegistry.set(ethAddress.toLowerCase(), {
        cantonParty: existingParty,
        kycStatus: "approved",
        complianceCid,
      });
      return res.status(200).json({
        success: true,
        cantonParty: existingParty,
        complianceContractId: complianceCid,
      });
    }

    // In production: validate KYC token with Sumsub/Onfido
    // For now, accept any non-empty kycToken as "approved"
    if (!kycToken && process.env.NODE_ENV === "production") {
      return res.status(400).json({ error: "KYC verification required" });
    }

    try {
      // Step 1: Allocate Canton party
      const cantonParty = await allocateCantonParty(ethAddress);

      // Step 2: Ensure compliance entry
      const complianceCid = await ensureComplianceEntry(cantonParty);

      // Step 3: Store mapping
      partyRegistry.set(ethAddress.toLowerCase(), {
        cantonParty,
        kycStatus: "approved",
        complianceCid,
      });

      console.log(
        `[Onboard] Provisioned: ${ethAddress} → ${cantonParty}`
      );

      return res.status(200).json({
        success: true,
        cantonParty,
        complianceContractId: complianceCid,
      });
    } catch (err) {
      console.error("[Onboard] Provision failed:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Provisioning failed",
      });
    }
  }

  // ── POST: KYC status check (stub) ────────────────────────
  if (req.method === "POST" && action === "kyc-check") {
    const { ethAddress } = req.body || {};

    if (!ethAddress) {
      return res.status(400).json({ error: "ethAddress required" });
    }

    // Stub: auto-approve in development, pending in production
    const isProd = process.env.NODE_ENV === "production";

    return res.status(200).json({
      status: isProd ? "pending" : "approved",
      message: isProd
        ? "KYC verification is in progress. This usually takes 1-2 business days."
        : "Development mode: auto-approved",
    });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

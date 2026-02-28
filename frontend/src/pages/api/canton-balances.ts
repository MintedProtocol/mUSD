import type { NextApiRequest, NextApiResponse } from "next";

/**
 * /api/canton-balances — Server-side proxy to Canton JSON API v2.
 *
 * Queries the Canton participant's Active Contract Set (ACS) for CantonMUSD
 * tokens and other BLE protocol contracts, then returns a summarized response.
 *
 * This avoids CORS issues and keeps the Canton auth token server-side.
 */

const CANTON_BASE_URL =
  process.env.CANTON_API_URL ||
  `http://${process.env.CANTON_HOST || "localhost"}:${process.env.CANTON_PORT || "7575"}`;
const CANTON_TOKEN = process.env.CANTON_TOKEN || "dummy-no-auth";
const CANTON_PARTY =
  process.env.CANTON_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const RECIPIENT_ALIAS_MAP_RAW = process.env.CANTON_RECIPIENT_PARTY_ALIASES || "";
const DEVNET_CANARY_PARTY =
  "minted-canary::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const DEFAULT_RECIPIENT_ALIAS_MAP: Record<string, string> = {
  "minted-user-33f97321":
    DEVNET_CANARY_PARTY,
  "minted-user-33f97321::122038887449dad08a7caecd8acf578db26b02b61773070bfa7013f7563d2c01adb9":
    DEVNET_CANARY_PARTY,
  "minted-user-33f97321::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce":
    DEVNET_CANARY_PARTY,
  "dde6467edc610708573d717a53c7c396":
    DEVNET_CANARY_PARTY,
  "dde6467edc610708573d717a53c7c396::12200d9a833bb01839aa0c236eb5fe18008bd21fa980873a0c463ba1866506b4af9e":
    DEVNET_CANARY_PARTY,
  "eb4e4b84e7db045557f78d9b5e8c2b98":
    DEVNET_CANARY_PARTY,
  "eb4e4b84e7db045557f78d9b5e8c2b98::12202dadec11aab8a9dc6ad790b6caab962e2c39ff419a2ae0d12e9ce6e87601ebad":
    DEVNET_CANARY_PARTY,
};
const PACKAGE_ID =
  process.env.NEXT_PUBLIC_DAML_PACKAGE_ID ||
  process.env.CANTON_PACKAGE_ID ||
  "";
const CIP56_PACKAGE_ID =
  process.env.NEXT_PUBLIC_CIP56_PACKAGE_ID ||
  process.env.CIP56_PACKAGE_ID ||
  "11347710f0e7a9c6386bd712ea3850b3787534885cd662d35e35afcb329d60e5";
// Service contracts may live under a different package than PACKAGE_ID
// (e.g. created under eff3bf30 before migration to f9481d29).
// Collect all known V3 package IDs to fan out service discovery queries.
const V3_PACKAGE_IDS: string[] = Array.from(new Set([
  PACKAGE_ID,
  process.env.CANTON_PACKAGE_ID,
  // Known deployed V3 packages on devnet
  "eff3bf30edb508b2d052f969203db972e59c66e974344ed43016cfccfa618f06",
  "f9481d29611628c7145d3d9a856aed6bb318d7fdd371a0262dbac7ca22b0142b",
].filter((id): id is string => typeof id === "string" && id.length === 64)));
const CANTON_PARTY_PATTERN = /^[A-Za-z0-9._:-]+::1220[0-9a-f]{64}$/i;

function parseRecipientAliasMap(): Record<string, string> {
  if (!RECIPIENT_ALIAS_MAP_RAW.trim()) return DEFAULT_RECIPIENT_ALIAS_MAP;
  try {
    const parsed = JSON.parse(RECIPIENT_ALIAS_MAP_RAW);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      ...DEFAULT_RECIPIENT_ALIAS_MAP,
      ...Object.fromEntries(
        Object.entries(parsed).filter(
          ([from, to]) =>
            typeof from === "string" &&
            from.trim().length > 0 &&
            typeof to === "string" &&
            to.trim().length > 0
        )
      ) as Record<string, string>,
    };
  } catch {
    return DEFAULT_RECIPIENT_ALIAS_MAP;
  }
}

const RECIPIENT_ALIAS_MAP = parseRecipientAliasMap();

function resolveRequestedParty(rawParty: string | string[] | undefined): string {
  const candidate = Array.isArray(rawParty) ? rawParty[0] : rawParty;
  if (!candidate || !candidate.trim()) return CANTON_PARTY;
  const raw = candidate.trim();
  if (raw.length > 200) throw new Error("Invalid Canton party");
  // Resolve aliases first (bare party hints like "minted-user-33f97321" lack ::1220 suffix)
  const party = RECIPIENT_ALIAS_MAP[raw] || raw;
  if (!CANTON_PARTY_PATTERN.test(party)) {
    throw new Error("Invalid Canton party");
  }
  return party;
}

interface CantonMUSDToken {
  contractId: string;
  owner: string;
  amount: string;
  nonce: number;
  sourceChain: number;
  ethTxHash: string;
  createdAt: string;
  template: "CantonMUSD" | "CIP56MintedMUSD";
}

interface BridgeServiceInfo {
  contractId: string;
  operator: string;
  lastNonce: number;
}

interface StakingServiceInfo {
  contractId: string;
  totalShares: string;
  pooledMusd: string;
  sharePrice: string;
  cooldownSeconds: number;
  minDeposit: string;
  paused: boolean;
}

interface ETHPoolServiceInfo {
  contractId: string;
  totalShares: string;
  poolCap: string;
  sharePrice: string;
  pooledUsdc: string;
  paused: boolean;
  totalMusdStaked: string;
}

interface BoostPoolServiceInfo {
  contractId: string;
  totalCantonDeposited: string;
  totalLPShares: string;
  cantonPriceMusd: string;
  globalSharePrice: string;
  entryFeeBps: number;
  exitFeeBps: number;
  cooldownSeconds: number;
  paused: boolean;
  cantonCapRatio: string;
}

interface LendingServiceInfo {
  contractId: string;
  totalBorrows: string;
  interestRateBps: number;
  reserveFactorBps: number;
  protocolReserves: string;
  minBorrow: string;
  closeFactorBps: number;
  paused: boolean;
  cantonSupplyCap: string;
  cantonCurrentSupply: string;
  configs: Record<string, { ltvBps: number; liqThresholdBps: number; liqPenaltyBps: number }>;
}

interface PriceFeedInfo {
  contractId: string;
  asset: string;
  priceMusd: string;
  lastUpdate: string;
}

interface EscrowInfo {
  contractId: string;
  owner: string;
  collateralType: string;
  amount: string;
}

interface DebtPositionInfo {
  contractId: string;
  owner: string;
  collateralType: string;
  collateralAmount: string;
  debtMusd: string;
  interestAccrued: string;
}

interface SimpleToken {
  contractId: string;
  amount: string;
  template?: string;
  depositedAt?: string;
  unlockAt?: string;
}

interface BalancesResponse {
  tokens: CantonMUSDToken[];
  totalBalance: string;
  tokenCount: number;
  redeemableBalance: string;
  redeemableTokenCount: number;
  cip56Balance: string;
  bridgeService: BridgeServiceInfo | null;
  pendingBridgeIns: number;
  supplyService: boolean;
  stakingService: StakingServiceInfo | null;
  ethPoolService: ETHPoolServiceInfo | null;
  boostPoolService: BoostPoolServiceInfo | null;
  lendingService: LendingServiceInfo | null;
  priceFeeds: PriceFeedInfo[];
  directMintService: { contractId: string; paused: boolean; serviceName?: string; hasValidCompliance?: boolean; usdcxMintingEnabled?: boolean } | null;
  coinMintService: { contractId: string } | null;
  smusdTokens: SimpleToken[];
  totalSmusd: string;
  smusdETokens: SimpleToken[];
  totalSmusdE: string;
  boostLPTokens: SimpleToken[];
  totalBoostLP: string;
  cantonCoinTokens: SimpleToken[];
  totalCoin: string;
  usdcTokens: SimpleToken[];
  totalUsdc: string;
  usdcBalance: string;
  usdcxBalance: string;
  usdcContractCount: number;
  usdcxContractCount: number;
  escrowPositions: EscrowInfo[];
  debtPositions: DebtPositionInfo[];
  ledgerOffset: number;
  party: string;
  timestamp: string;
}

type RawEntry = {
  contractEntry: {
    JsActiveContract?: {
      createdEvent: {
        contractId: string;
        templateId: string;
        createArgument: Record<string, unknown>;
        createdAt: string;
        offset: number;
        signatories: string[];
        observers: string[];
      };
    };
  };
};

function templateId(moduleName: string, entityName: string): string {
  return `${PACKAGE_ID}:${moduleName}:${entityName}`;
}

function buildEventFormat(party: string, fullTemplateId: string): Record<string, unknown> {
  return {
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
  };
}

function normalizeEntries(payload: unknown): RawEntry[] {
  if (Array.isArray(payload)) return payload as RawEntry[];
  if (payload && typeof payload === "object") {
    const obj = payload as { result?: unknown };
    if (Array.isArray(obj.result)) return obj.result as RawEntry[];
  }
  return [];
}

async function queryTemplateEntries(
  party: string,
  activeAtOffset: number,
  fullTemplateId: string
): Promise<RawEntry[]> {
  try {
    const raw = await cantonRequest<unknown>("POST", "/v2/state/active-contracts?limit=200", {
      eventFormat: buildEventFormat(party, fullTemplateId),
      activeAtOffset,
    });
    return normalizeEntries(raw);
  } catch (err: any) {
    const msg = String(err?.message || "");
    // Some optional templates may not exist on this package/version.
    if (msg.includes("Canton API 404")) {
      return [];
    }
    throw err;
  }
}

async function cantonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${CANTON_BASE_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${CANTON_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Canton API ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<T>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BalancesResponse | { error: string }>
) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let actAsParty: string;
  try {
    actAsParty = resolveRequestedParty(req.query.party);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Invalid Canton party" });
  }

  try {
    const effectiveParty = actAsParty;
    // 1. Get current ledger offset
    const { offset } = await cantonRequest<{ offset: number }>("GET", "/v2/state/ledger-end");

    // 2. Query template-scoped slices to avoid wildcard ACS 413 at 200-element node cap.
    // Token templates are package-pinned; service templates fan out across all known V3 packages
    // so we discover contracts even if they were created under a different package version.
    const serviceModuleEntities = [
      ["Minted.Protocol.V3", "BridgeService"],
      ["Minted.Protocol.V3", "BridgeInRequest"],
      ["Minted.Protocol.V3", "MUSDSupplyService"],
      ["CantonSMUSD", "CantonStakingService"],
      ["CantonETHPool", "CantonETHPoolService"],
      ["CantonBoostPool", "CantonBoostPoolService"],
      ["CantonLending", "CantonLendingService"],
      ["CantonLending", "CantonPriceFeed"],
      ["CantonETHPool", "CantonSMUSD_E"],
      ["CantonBoostPool", "BoostPoolLP"],
      ["CantonLending", "EscrowedCollateral"],
      ["CantonLending", "CantonDebtPosition"],
      ["CantonDirectMint", "CantonDirectMintService"],
      ["CantonSMUSD", "CantonSMUSD"],
      ["CantonCoinToken", "CantonCoin"],
      ["CantonDirectMint", "CantonUSDC"],
      ["CantonDirectMint", "USDCx"],
      ["CantonDirectMint", "CantonMUSD"],
      ["CantonCoinMint", "CoinMintService"],
    ] as const;

    // Fan out service templates across all known V3 package IDs
    const serviceTemplates = serviceModuleEntities.flatMap(([mod, entity]) =>
      V3_PACKAGE_IDS.map((pkg) => `${pkg}:${mod}:${entity}`)
    );

    const templates = [
      `${CIP56_PACKAGE_ID}:CIP56Interfaces:CIP56MintedMUSD`,
      ...serviceTemplates,
    ];

    const entryGroups = await Promise.all(
      templates.map((tpl) => queryTemplateEntries(actAsParty, offset, tpl))
    );
    const entries = entryGroups.flat();

    // 3. Parse contracts by template
    const tokens: CantonMUSDToken[] = [];
    let bridgeService: BridgeServiceInfo | null = null;
    let pendingBridgeIns = 0;
    let supplyService = false;
    let stakingService: StakingServiceInfo | null = null;
    let ethPoolService: ETHPoolServiceInfo | null = null;
    let ethPoolHasValidCompliance = false;
    let boostPoolService: BoostPoolServiceInfo | null = null;
    let lendingService: LendingServiceInfo | null = null;
    type DirectMintEntry = { contractId: string; paused: boolean; serviceName?: string; hasValidCompliance?: boolean; usdcxMintingEnabled?: boolean };
    const directMintByCid = new Map<string, DirectMintEntry>();
    let directMintFallback: DirectMintEntry | null = null;
    let coinMintService: { contractId: string } | null = null;
    let ethPoolDirectMintCid: string | null = null;
    let stakingHasValidCompliance = false;
    const smusdTokens: SimpleToken[] = [];
    const smusdETokens: SimpleToken[] = [];
    const boostLPTokens: SimpleToken[] = [];
    const cantonCoinTokens: SimpleToken[] = [];
    const usdcTokens: SimpleToken[] = [];
    const priceFeeds: PriceFeedInfo[] = [];
    const escrowPositions: EscrowInfo[] = [];
    const debtPositions: DebtPositionInfo[] = [];

    const matchesActingOwner = (payload: Record<string, unknown>, field: "owner" | "borrower" = "owner"): boolean => {
      const owner = (payload[field] as string) || "";
      return !owner || owner === actAsParty;
    };
    const matchesOperatorIssuer = (payload: Record<string, unknown>): boolean => {
      const issuer = (payload.issuer as string) || "";
      return !issuer || issuer === CANTON_PARTY;
    };

    for (const entry of entries) {
      const ac = entry.contractEntry?.JsActiveContract;
      if (!ac) continue;

      const evt = ac.createdEvent;
      const tplId = evt.templateId; // "pkgId:ModuleName:EntityName"
      const parts = tplId.split(":");
      const entityName = parts[parts.length - 1] || "";

      if (entityName === "CantonMUSD") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        if (!matchesOperatorIssuer(p)) continue;
        tokens.push({
          contractId: evt.contractId,
          owner: (p.owner as string) || "",
          amount: (p.amount as string) || "0",
          nonce: parseInt(String(p.nonce || "0"), 10),
          sourceChain: parseInt(String(p.sourceChain || "0"), 10),
          ethTxHash: (p.ethTxHash as string) || "",
          createdAt: evt.createdAt || "",
          template: "CantonMUSD",
        });
      } else if (entityName === "CIP56MintedMUSD") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        tokens.push({
          contractId: evt.contractId,
          owner: (p.owner as string) || "",
          amount: (p.amount as string) || "0",
          nonce: 0,
          sourceChain: 0,
          ethTxHash: "",
          createdAt: evt.createdAt || "",
          template: "CIP56MintedMUSD",
        });
      } else if (entityName === "BridgeService") {
        const p = evt.createArgument;
        bridgeService = {
          contractId: evt.contractId,
          operator: (p.operator as string) || "",
          lastNonce: parseInt(String(p.lastNonce || "0"), 10),
        };
      } else if (entityName === "BridgeInRequest") {
        const p = evt.createArgument;
        const status = String(p.status || "").toLowerCase();
        if (status === "pending") {
          pendingBridgeIns++;
        }
      } else if (entityName === "MUSDSupplyService") {
        supplyService = true;
      } else if (entityName === "CantonStakingService") {
        const p = evt.createArgument;
        const ts = parseFloat(String(p.totalShares || "0"));
        // Deployed version uses globalSharePrice (not pooledMusd)
        const gsp = parseFloat(String(p.globalSharePrice || "1.0"));
        const pm = parseFloat(String(p.pooledMusd || "0"));
        // Pool-derived TVL: if pooledMusd is available use it, otherwise estimate from shares * sharePrice
        const tvl = pm > 0 ? pm : (ts * gsp);
        // Share price: prefer pool-derived, fall back to globalSharePrice
        const sharePrice = pm > 0 && ts > 0 ? pm / ts : gsp;
        const isPaused = p.paused === true || p.paused === "True";
        const compCid = (p.complianceRegistryCid as string) || "";
        const hasValidCompliance = compCid.length > 10 && !compCid.match(/^0+$/);
        const candidate: StakingServiceInfo = {
          contractId: evt.contractId,
          totalShares: String(ts),
          pooledMusd: String(tvl),
          sharePrice: String(sharePrice),
          cooldownSeconds: parseInt(String(p.cooldownSeconds || "86400"), 10),
          minDeposit: String(p.minDeposit || "0.01"),
          paused: isPaused,
        };
        const prevTvl = stakingService ? parseFloat(stakingService.pooledMusd) : -1;
        // Prefer service with valid complianceRegistryCid, unpaused, and higher TVL
        if (!stakingService
            || (hasValidCompliance && !stakingHasValidCompliance)
            || (hasValidCompliance === stakingHasValidCompliance && !isPaused && stakingService.paused)
            || (hasValidCompliance === stakingHasValidCompliance && isPaused === stakingService.paused && tvl > prevTvl)) {
          stakingService = candidate;
          stakingHasValidCompliance = hasValidCompliance;
        }
      } else if (entityName === "CantonETHPoolService") {
        const p = evt.createArgument;
        const isPaused = p.paused === true || p.paused === "True";
        const compCid = (p.complianceRegistryCid as string) || "";
        const hasValidCompliance = compCid.length > 10 && !compCid.match(/^0+$/);
        const tvl = parseFloat((p.totalUsdcStaked as string) || (p.totalMusdStaked as string) || "0");
        const candidate: ETHPoolServiceInfo = {
          contractId: evt.contractId,
          totalShares: (p.totalShares as string) || "0",
          poolCap: (p.poolCap as string) || "0",
          sharePrice: (p.sharePrice as string) || "1.0",
          pooledUsdc: (p.pooledUsdc as string) || "0",
          paused: isPaused,
          totalMusdStaked: (p.totalUsdcStaked as string) || (p.totalMusdStaked as string) || "0",
        };
        const prevTvl = ethPoolService ? parseFloat(ethPoolService.totalMusdStaked) : -1;
        if (!ethPoolService
            || (hasValidCompliance && !ethPoolHasValidCompliance)
            || (hasValidCompliance === ethPoolHasValidCompliance && !isPaused && ethPoolService.paused)
            || (hasValidCompliance === ethPoolHasValidCompliance && isPaused === ethPoolService.paused && tvl > prevTvl)) {
          ethPoolService = candidate;
          ethPoolHasValidCompliance = hasValidCompliance;
          // Capture the DirectMint CID linked to the selected ETHPool
          if (p.directMintServiceCid) ethPoolDirectMintCid = p.directMintServiceCid as string;
        }
      } else if (entityName === "CantonBoostPoolService") {
        const p = evt.createArgument;
        boostPoolService = {
          contractId: evt.contractId,
          totalCantonDeposited: (p.totalCantonDeposited as string) || "0",
          totalLPShares: (p.totalLPShares as string) || "0",
          cantonPriceMusd: (p.cantonPriceMusd as string) || "1.0",
          globalSharePrice: (p.globalSharePrice as string) || "1.0",
          entryFeeBps: parseInt(String(p.entryFeeBps || "25"), 10),
          exitFeeBps: parseInt(String(p.exitFeeBps || "50"), 10),
          cooldownSeconds: parseInt(String(p.cooldownSeconds || "86400"), 10),
          paused: p.paused === true || p.paused === "True",
          cantonCapRatio: (p.cantonCapRatio as string) || "0.25",
        };
      } else if (entityName === "CantonLendingService") {
        const p = evt.createArgument;
        // Parse configs array (ACS returns array of collateral config objects)
        const rawConfigs = (p.configs as Array<Record<string, unknown>>) || [];
        const configs: Record<string, { ltvBps: number; liqThresholdBps: number; liqPenaltyBps: number }> = {};
        for (const val of rawConfigs) {
          const key = (val.collateralType as string) || "";
          if (key) {
            configs[key] = {
              ltvBps: parseInt(String(val.collateralFactorBps || "0"), 10),
              liqThresholdBps: parseInt(String(val.liquidationThresholdBps || "0"), 10),
              liqPenaltyBps: parseInt(String(val.liquidationPenaltyBps || "0"), 10),
            };
          }
        }
        const isPaused = p.paused === true || p.paused === "True";
        const candidate: LendingServiceInfo = {
          contractId: evt.contractId,
          totalBorrows: (p.totalBorrows as string) || "0",
          interestRateBps: parseInt(String(p.interestRateBps || "500"), 10),
          reserveFactorBps: parseInt(String(p.reserveFactorBps || "1000"), 10),
          protocolReserves: (p.protocolReserves as string) || "0",
          minBorrow: (p.minBorrow as string) || "100",
          closeFactorBps: parseInt(String(p.closeFactorBps || "5000"), 10),
          paused: isPaused,
          cantonSupplyCap: (p.cantonSupplyCap as string) || "0",
          cantonCurrentSupply: (p.cantonCurrentSupply as string) || "0",
          configs,
        };
        // Deterministic selection: prefer unpaused, then highest config count, then highest totalBorrows
        if (!lendingService
            || (!isPaused && lendingService.paused)
            || (isPaused === lendingService.paused && Object.keys(configs).length > Object.keys(lendingService.configs).length)
            || (isPaused === lendingService.paused && Object.keys(configs).length === Object.keys(lendingService.configs).length && parseFloat(candidate.totalBorrows) > parseFloat(lendingService.totalBorrows))) {
          lendingService = candidate;
        }
      } else if (entityName === "CantonPriceFeed") {
        const p = evt.createArgument;
        priceFeeds.push({
          contractId: evt.contractId,
          asset: (p.symbol as string) || "",
          priceMusd: (p.priceUsd as string) || "0",
          lastUpdate: (p.lastUpdated as string) || evt.createdAt || "",
        });
      } else if (entityName === "CantonSMUSD_E") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        if (!matchesOperatorIssuer(p)) continue;
        smusdETokens.push({
          contractId: evt.contractId,
          amount: (p.shares as string) || (p.amount as string) || "0",
        });
      } else if (entityName === "BoostPoolLP") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        boostLPTokens.push({
          contractId: evt.contractId,
          amount: (p.shares as string) || (p.amount as string) || "0",
          depositedAt: (p.depositedAt as string) || evt.createdAt || "",
        });
      } else if (entityName === "EscrowedCollateral") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        escrowPositions.push({
          contractId: evt.contractId,
          owner: (p.owner as string) || "",
          collateralType: (p.collateralType as string) || "",
          amount: (p.amount as string) || "0",
        });
      } else if (entityName === "CantonDebtPosition") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "borrower")) continue;
        debtPositions.push({
          contractId: evt.contractId,
          owner: (p.borrower as string) || "",
          collateralType: "",  // Debt position is global — backed by all escrows
          collateralAmount: "0",
          debtMusd: (p.principalDebt as string) || "0",
          interestAccrued: (p.accruedInterest as string) || "0",
        });
      } else if (entityName === "CantonDirectMintService") {
        const p = evt.createArgument;
        const isPaused = p.paused === true || p.paused === "True";
        const compCid = (p.complianceRegistryCid as string) || "";
        const hasValidCompliance = compCid.length > 10 && !compCid.match(/^0+$/);
        const candidate: DirectMintEntry = {
          contractId: evt.contractId,
          paused: isPaused,
          serviceName: (p.serviceName as string) || "",
          hasValidCompliance,
          usdcxMintingEnabled: p.usdcxIssuer !== null && p.usdcxIssuer !== undefined,
        };
        directMintByCid.set(evt.contractId, candidate);
        // Track best fallback: prefer (1) valid compliance, (2) unpaused
        if (!directMintFallback
            || (hasValidCompliance && !directMintFallback.hasValidCompliance)
            || (hasValidCompliance === directMintFallback.hasValidCompliance && !isPaused && directMintFallback.paused)) {
          directMintFallback = candidate;
        }
      } else if (entityName === "CoinMintService") {
        if (!coinMintService) {
          coinMintService = { contractId: evt.contractId };
        }
      } else if (entityName === "CantonSMUSD") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        if (!matchesOperatorIssuer(p)) continue;
        smusdTokens.push({
          contractId: evt.contractId,
          amount: (p.shares as string) || (p.amount as string) || "0",
        });
      } else if (entityName === "CantonCoin") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        if (!matchesOperatorIssuer(p)) continue;
        cantonCoinTokens.push({
          contractId: evt.contractId,
          amount: (p.amount as string) || "0",
        });
      } else if (entityName === "CantonUSDC") {
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        if (!matchesOperatorIssuer(p)) continue;
        usdcTokens.push({
          contractId: evt.contractId,
          amount: (p.amount as string) || "0",
          template: "CantonUSDC",
        });
      } else if (entityName === "USDCx") {
        // USDCx is a separate template; track separately so DirectMint_Mint
        // (which expects CantonUSDC) doesn't accidentally receive a USDCx CID.
        const p = evt.createArgument;
        if (!matchesActingOwner(p, "owner")) continue;
        if (!matchesOperatorIssuer(p)) continue;
        usdcTokens.push({
          contractId: evt.contractId,
          amount: (p.amount as string) || "0",
          template: "USDCx",
        });
      }
    }

    // Some service contracts (for example CantonDirectMintService) may not be
    // directly visible to end-user parties even though they are operational.
    // In that case, fall back to the operator party view for service discovery.
    if (
      effectiveParty !== CANTON_PARTY &&
      (
        !directMintFallback ||
        !coinMintService ||
        !bridgeService ||
        !supplyService ||
        !stakingService ||
        !ethPoolService ||
        !boostPoolService ||
        !lendingService
      )
    ) {
      try {
        const operatorServiceEntities = [
          ["Minted.Protocol.V3", "BridgeService"],
          ["Minted.Protocol.V3", "MUSDSupplyService"],
          ["CantonDirectMint", "CantonDirectMintService"],
          ["CantonSMUSD", "CantonStakingService"],
          ["CantonETHPool", "CantonETHPoolService"],
          ["CantonBoostPool", "CantonBoostPoolService"],
          ["CantonLending", "CantonLendingService"],
          ["CantonLending", "CantonPriceFeed"],
          ["CantonCoinMint", "CoinMintService"],
        ] as const;
        const operatorTemplates = operatorServiceEntities.flatMap(([mod, entity]) =>
          V3_PACKAGE_IDS.map((pkg) => `${pkg}:${mod}:${entity}`)
        );

        const operatorGroups = await Promise.all(
          operatorTemplates.map((tpl) => queryTemplateEntries(CANTON_PARTY, offset, tpl))
        );
        const operatorEntries = operatorGroups.flat();

        for (const entry of operatorEntries) {
          const ac = entry.contractEntry?.JsActiveContract;
          if (!ac) continue;
          const evt = ac.createdEvent;
          const tplId = evt.templateId;
          const parts = tplId.split(":");
          const entityName = parts[parts.length - 1] || "";

          if (!bridgeService && entityName === "BridgeService") {
            const p = evt.createArgument;
            bridgeService = {
              contractId: evt.contractId,
              operator: (p.operator as string) || "",
              lastNonce: parseInt(String(p.lastNonce || "0"), 10),
            };
          } else if (!supplyService && entityName === "MUSDSupplyService") {
            supplyService = true;
          } else if (entityName === "CantonStakingService") {
            const p = evt.createArgument;
            const ts = parseFloat(String(p.totalShares || "0"));
            const gsp = parseFloat(String(p.globalSharePrice || "1.0"));
            const pm = parseFloat(String(p.pooledMusd || "0"));
            const tvl = pm > 0 ? pm : ts * gsp;
            const sharePrice = pm > 0 && ts > 0 ? pm / ts : gsp;
            const isPaused = p.paused === true || p.paused === "True";
            const compCid = (p.complianceRegistryCid as string) || "";
            const hasValidCompliance = compCid.length > 10 && !compCid.match(/^0+$/);
            const candidate: StakingServiceInfo = {
              contractId: evt.contractId,
              totalShares: String(ts),
              pooledMusd: String(tvl),
              sharePrice: String(sharePrice),
              cooldownSeconds: parseInt(String(p.cooldownSeconds || "86400"), 10),
              minDeposit: String(p.minDeposit || "0.01"),
              paused: isPaused,
            };
            const prevTvl = stakingService ? parseFloat(stakingService.pooledMusd) : -1;
            if (
              !stakingService ||
              (hasValidCompliance && !stakingHasValidCompliance) ||
              (hasValidCompliance === stakingHasValidCompliance && !isPaused && stakingService.paused) ||
              (hasValidCompliance === stakingHasValidCompliance && isPaused === stakingService.paused && tvl > prevTvl)
            ) {
              stakingService = candidate;
              stakingHasValidCompliance = hasValidCompliance;
            }
          } else if (entityName === "CantonETHPoolService") {
            const p = evt.createArgument;
            const isPaused = p.paused === true || p.paused === "True";
            const compCid = (p.complianceRegistryCid as string) || "";
            const hasValidCompliance = compCid.length > 10 && !compCid.match(/^0+$/);
            const tvl = parseFloat((p.totalUsdcStaked as string) || (p.totalMusdStaked as string) || "0");
            const candidate: ETHPoolServiceInfo = {
              contractId: evt.contractId,
              totalShares: (p.totalShares as string) || "0",
              poolCap: (p.poolCap as string) || "0",
              sharePrice: (p.sharePrice as string) || "1.0",
              pooledUsdc: (p.pooledUsdc as string) || "0",
              paused: isPaused,
              totalMusdStaked: (p.totalUsdcStaked as string) || (p.totalMusdStaked as string) || "0",
            };
            const prevTvl = ethPoolService ? parseFloat(ethPoolService.totalMusdStaked) : -1;
            if (
              !ethPoolService ||
              (hasValidCompliance && !ethPoolHasValidCompliance) ||
              (hasValidCompliance === ethPoolHasValidCompliance && !isPaused && ethPoolService.paused) ||
              (hasValidCompliance === ethPoolHasValidCompliance && isPaused === ethPoolService.paused && tvl > prevTvl)
            ) {
              ethPoolService = candidate;
              ethPoolHasValidCompliance = hasValidCompliance;
              if (p.directMintServiceCid) ethPoolDirectMintCid = p.directMintServiceCid as string;
            }
          } else if (entityName === "CantonBoostPoolService") {
            const p = evt.createArgument;
            boostPoolService = {
              contractId: evt.contractId,
              totalCantonDeposited: (p.totalCantonDeposited as string) || "0",
              totalLPShares: (p.totalLPShares as string) || "0",
              cantonPriceMusd: (p.cantonPriceMusd as string) || "1.0",
              globalSharePrice: (p.globalSharePrice as string) || "1.0",
              entryFeeBps: parseInt(String(p.entryFeeBps || "25"), 10),
              exitFeeBps: parseInt(String(p.exitFeeBps || "50"), 10),
              cooldownSeconds: parseInt(String(p.cooldownSeconds || "86400"), 10),
              paused: p.paused === true || p.paused === "True",
              cantonCapRatio: (p.cantonCapRatio as string) || "0.25",
            };
          } else if (entityName === "CantonLendingService") {
            const p = evt.createArgument;
            const rawConfigs = (p.configs as Array<Record<string, unknown>>) || [];
            const configs: Record<string, { ltvBps: number; liqThresholdBps: number; liqPenaltyBps: number }> = {};
            for (const val of rawConfigs) {
              const key = (val.collateralType as string) || "";
              if (key) {
                configs[key] = {
                  ltvBps: parseInt(String(val.collateralFactorBps || "0"), 10),
                  liqThresholdBps: parseInt(String(val.liquidationThresholdBps || "0"), 10),
                  liqPenaltyBps: parseInt(String(val.liquidationPenaltyBps || "0"), 10),
                };
              }
            }
            const isPaused = p.paused === true || p.paused === "True";
            const candidate: LendingServiceInfo = {
              contractId: evt.contractId,
              totalBorrows: (p.totalBorrows as string) || "0",
              interestRateBps: parseInt(String(p.interestRateBps || "500"), 10),
              reserveFactorBps: parseInt(String(p.reserveFactorBps || "1000"), 10),
              protocolReserves: (p.protocolReserves as string) || "0",
              minBorrow: (p.minBorrow as string) || "100",
              closeFactorBps: parseInt(String(p.closeFactorBps || "5000"), 10),
              paused: isPaused,
              cantonSupplyCap: (p.cantonSupplyCap as string) || "0",
              cantonCurrentSupply: (p.cantonCurrentSupply as string) || "0",
              configs,
            };
            if (!lendingService
                || (!isPaused && lendingService.paused)
                || (isPaused === lendingService.paused && Object.keys(configs).length > Object.keys(lendingService.configs).length)
                || (isPaused === lendingService.paused && Object.keys(configs).length === Object.keys(lendingService.configs).length && parseFloat(candidate.totalBorrows) > parseFloat(lendingService.totalBorrows))) {
              lendingService = candidate;
            }
          } else if (entityName === "CantonDirectMintService") {
            const p = evt.createArgument;
            const isPaused = p.paused === true || p.paused === "True";
            const compCid = (p.complianceRegistryCid as string) || "";
            const hasValidCompliance = compCid.length > 10 && !compCid.match(/^0+$/);
            const candidate: DirectMintEntry = {
              contractId: evt.contractId,
              paused: isPaused,
              serviceName: (p.serviceName as string) || "",
              hasValidCompliance,
              usdcxMintingEnabled: p.usdcxIssuer !== null && p.usdcxIssuer !== undefined,
            };
            directMintByCid.set(evt.contractId, candidate);
            if (
              !directMintFallback ||
              (hasValidCompliance && !directMintFallback.hasValidCompliance) ||
              (hasValidCompliance === directMintFallback.hasValidCompliance &&
                !isPaused &&
                directMintFallback.paused)
            ) {
              directMintFallback = candidate;
            }
          } else if (!coinMintService && entityName === "CoinMintService") {
            coinMintService = { contractId: evt.contractId };
          } else if (entityName === "CantonPriceFeed") {
            // Merge operator-visible price feeds when user query returned none
            const p = evt.createArgument;
            const operatorFeed: PriceFeedInfo = {
              contractId: evt.contractId,
              asset: (p.symbol as string) || "",
              priceMusd: (p.priceUsd as string) || "0",
              lastUpdate: (p.lastUpdated as string) || evt.createdAt || "",
            };
            const alreadyHas = priceFeeds.some((f) => f.contractId === operatorFeed.contractId);
            if (!alreadyHas) {
              priceFeeds.push(operatorFeed);
            }
          }
        }
      } catch (fallbackErr) {
        console.warn(
          "Canton balances service fallback failed:",
          (fallbackErr as Error)?.message || fallbackErr
        );
      }
    }

    // Resolve directMintService: anchor to ETHPool's linked CID when available
    let directMintService: DirectMintEntry | null = null;
    if (ethPoolDirectMintCid && directMintByCid.has(ethPoolDirectMintCid)) {
      directMintService = directMintByCid.get(ethPoolDirectMintCid)!;
    } else {
      directMintService = directMintFallback;
    }

    // Compute unlockAt for Boost LP positions using cooldownSeconds from service
    const boostCooldownSec = boostPoolService?.cooldownSeconds || 86400;
    for (const lp of boostLPTokens) {
      if (lp.depositedAt) {
        const depositMs = new Date(lp.depositedAt).getTime();
        if (Number.isFinite(depositMs)) {
          lp.unlockAt = new Date(depositMs + boostCooldownSec * 1000).toISOString();
        }
      }
    }

    // Sort tokens by nonce
    tokens.sort((a, b) => a.nonce - b.nonce);

    // Calculate total
    const totalBalance = tokens
      .reduce((sum, t) => sum + parseFloat(t.amount), 0)
      .toFixed(6);

    // Derived balance breakdown by token template
    const redeemableTokens = tokens.filter((t) => t.template === "CantonMUSD");
    const cip56Tokens = tokens.filter((t) => t.template === "CIP56MintedMUSD");
    const redeemableBalance = redeemableTokens.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(6);
    const redeemableTokenCount = redeemableTokens.length;
    const cip56Balance = cip56Tokens.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(6);

    // Sum token balances for non-mUSD tokens
    const totalSmusd = smusdTokens.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(6);
    const totalSmusdE = smusdETokens.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(6);
    const totalBoostLP = boostLPTokens.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(6);
    const totalCoin = cantonCoinTokens.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(6);
    const pureUsdcTokens = usdcTokens.filter(t => t.template !== "USDCx");
    const usdcxOnlyTokens = usdcTokens.filter(t => t.template === "USDCx");
    const usdcBalance = pureUsdcTokens.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(6);
    const usdcxBalance = usdcxOnlyTokens.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(6);
    const totalUsdc = (parseFloat(usdcBalance) + parseFloat(usdcxBalance)).toFixed(6);

    return res.status(200).json({
      tokens,
      totalBalance,
      tokenCount: tokens.length,
      redeemableBalance,
      redeemableTokenCount,
      cip56Balance,
      bridgeService,
      pendingBridgeIns,
      supplyService,
      stakingService,
      ethPoolService,
      boostPoolService,
      lendingService,
      priceFeeds,
      directMintService,
      coinMintService,
      smusdTokens,
      totalSmusd,
      smusdETokens,
      totalSmusdE,
      boostLPTokens,
      totalBoostLP,
      cantonCoinTokens,
      totalCoin,
      usdcTokens,
      totalUsdc,
      usdcBalance,
      usdcxBalance,
      usdcContractCount: pureUsdcTokens.length,
      usdcxContractCount: usdcxOnlyTokens.length,
      escrowPositions,
      debtPositions,
      ledgerOffset: offset,
      party: actAsParty,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Canton balances API error:", err.message);
    return res.status(502).json({ error: `Canton API unavailable: ${err.message}` });
  }
}

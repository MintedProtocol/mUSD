import { useState, useEffect, useCallback, useRef } from "react";
import { normalizeCantonParty } from "@/lib/canton-party";

/**
 * Shared hook to fetch Canton mUSD balances from the server-side API route.
 * Works without Loop Wallet — queries Canton JSON API directly via /api/canton-balances.
 */

export interface CantonMUSDToken {
  contractId: string;
  owner: string;
  amount: string;
  nonce: number;
  sourceChain: number;
  ethTxHash: string;
  createdAt: string;
  template: "CantonMUSD" | "CIP56MintedMUSD";
}

export interface BridgeServiceInfo {
  contractId: string;
  operator: string;
  lastNonce: number;
}

export interface StakingServiceInfo {
  contractId: string;
  totalShares: string;
  pooledMusd: string;
  sharePrice: string;
  cooldownSeconds: number;
  minDeposit: string;
  paused: boolean;
}

export interface ETHPoolServiceInfo {
  contractId: string;
  totalShares: string;
  poolCap: string;
  sharePrice: string;
  pooledUsdc: string;
  paused: boolean;
  totalMusdStaked: string;
}

export interface BoostPoolServiceInfo {
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

export interface LendingServiceInfo {
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

export interface PriceFeedInfo {
  contractId: string;
  asset: string;
  priceMusd: string;
  lastUpdate: string;
}

export interface EscrowInfo {
  contractId: string;
  owner: string;
  collateralType: string;
  amount: string;
}

export interface DebtPositionInfo {
  contractId: string;
  owner: string;
  collateralType: string;
  collateralAmount: string;
  debtMusd: string;
  interestAccrued: string;
}

export interface SimpleToken {
  contractId: string;
  amount: string;
  template?: string;
  depositedAt?: string;
  unlockAt?: string;
}

export interface CantonBalancesData {
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
  directMintService: { contractId: string; paused: boolean; usdcxMintingEnabled?: boolean } | null;
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

function partyQueryParam(party?: string | null): string {
  const normalized = normalizeCantonParty(party);
  if (!normalized || !normalized.trim()) return "";
  return `?party=${encodeURIComponent(normalized.trim())}`;
}

type PartyArg = string | null | { party?: string | null } | undefined;

function resolvePartyArg(input?: PartyArg): string | null {
  const rawParty: string | null =
    input && typeof input === "object"
      ? (input.party ?? null)
      : (input ?? null);
  return normalizeCantonParty(rawParty);
}

export function useCantonLedger(autoRefreshMs = 15_000, party?: string | null) {
  const effectiveParty = normalizeCantonParty(party);
  const [data, setData] = useState<CantonBalancesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequestRef.current;
    try {
      const resp = await fetch(`/api/canton-balances${partyQueryParam(effectiveParty)}`, {
        cache: "no-store",
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const result: CantonBalancesData = await resp.json();
      if (requestId === latestRequestRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err: any) {
      if (requestId === latestRequestRef.current) {
        setError(err.message);
      }
    } finally {
      if (requestId === latestRequestRef.current) {
        setLoading(false);
      }
    }
  }, [effectiveParty]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void refresh();
  }, [refresh, effectiveParty]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const interval = setInterval(refresh, autoRefreshMs);
    return () => clearInterval(interval);
  }, [autoRefreshMs, refresh]);

  return { data, loading, error, refresh };
}

/**
 * Submit a DAML command to Canton via server-side API route.
 */
export async function cantonExercise(
  templateId: string,
  contractId: string,
  choice: string,
  argument: Record<string, unknown>,
  partyOrOptions?: PartyArg
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const effectiveParty = resolvePartyArg(partyOrOptions);
  const resp = await fetch("/api/canton-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, contractId, choice, argument, party: effectiveParty || undefined }),
  });
  // Handle non-JSON responses (e.g. Next.js error pages returning HTML)
  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await resp.text().catch(() => "Unknown error");
    return { success: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
  }
  return resp.json();
}

/**
 * Fetch fresh balances data inline (not through React state).
 * Use this before exercising consuming choices to ensure the CID is current.
 */
export async function fetchFreshBalances(party?: string | null): Promise<CantonBalancesData> {
  const effectiveParty = normalizeCantonParty(party);
  const resp = await fetch(`/api/canton-balances${partyQueryParam(effectiveParty)}`, {
    cache: "no-store",
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

/**
 * Convert CIP-56 mUSD → redeemable CantonMUSD via server-side inventory swap.
 * Returns the conversion result or throws on failure.
 */
export async function convertCip56ToRedeemable(
  party: string,
  amount: number
): Promise<{ success: boolean; convertedAmount: string; commandId: string; error?: string }> {
  const resp = await fetch("/api/canton-convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ party, amount: amount.toFixed(10) }),
  });
  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await resp.text().catch(() => "Unknown error");
    return { success: false, convertedAmount: "0", commandId: "", error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
  }
  const result = await resp.json();
  if (!resp.ok || result.error) {
    return { success: false, convertedAmount: "0", commandId: "", error: result.error || `HTTP ${resp.status}` };
  }
  return result;
}

/**
 * Refresh all price feeds to prevent PRICE_STALE errors.
 * Call before borrow/withdraw operations.
 */
export async function refreshPriceFeeds(): Promise<{ success: boolean; refreshed?: number; error?: string }> {
  const resp = await fetch("/api/canton-refresh-prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await resp.text().catch(() => "Unknown error");
    return { success: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
  }
  return resp.json();
}

/**
 * Preflight check for bridge-out: returns max bridgeable amount
 * and deterministic blocker reasons.
 */
export interface BridgePreflightData {
  party: string;
  userCip56Balance: string;
  userRedeemableBalance: string;
  userTotal: string;
  operatorInventory: string;
  convertibleCip56: string;
  maxBridgeable: string;
  blockers: string[];
  ledgerOffset: number;
  timestamp: string;
}

export async function fetchBridgePreflight(party: string): Promise<BridgePreflightData> {
  const normalized = normalizeCantonParty(party);
  if (!normalized) throw new Error("Invalid party for preflight");
  const resp = await fetch(`/api/canton-bridge-preflight?party=${encodeURIComponent(normalized)}`, {
    cache: "no-store",
  });
  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const result = await resp.json();
  if (!resp.ok || result.error) {
    throw new Error(result.error || `HTTP ${resp.status}`);
  }
  return result;
}

/**
 * Create a DAML contract on Canton via server-side API route.
 */
export async function cantonCreate(
  templateId: string,
  payload: Record<string, unknown>,
  partyOrOptions?: PartyArg
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const effectiveParty = resolvePartyArg(partyOrOptions);
  const resp = await fetch("/api/canton-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", templateId, payload, party: effectiveParty || undefined }),
  });
  // Handle non-JSON responses (e.g. Next.js error pages returning HTML)
  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await resp.text().catch(() => "Unknown error");
    return { success: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
  }
  return resp.json();
}

import React, { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { TxButton } from "@/components/TxButton";
import { useLoopWallet } from "@/hooks/useLoopWallet";
import {
  useCantonLedger,
  cantonExercise,
  fetchFreshBalances,
  convertCip56ToRedeemable,
  type CantonBalancesData,
  type SimpleToken,
} from "@/hooks/useCantonLedger";
import {
  OPTION2_BATCH_ENABLED,
  isLastStakerPartialForbidden,
  selectCoveringCids,
  mapBatchUnstakeError,
} from "@/hooks/useOption2Batch";

type CantonPoolTab = "smusd" | "ethpool" | "boostpool";
type StakeAction = "stake" | "unstake";
type DepositAsset = "USDC" | "USDCx" | "CTN";

const POOL_TAB_CONFIG = [
  { key: "smusd" as CantonPoolTab, label: "smUSD", badge: "Yield Vault", color: "from-emerald-500 to-teal-500" },
  { key: "ethpool" as CantonPoolTab, label: "ETH Pool", badge: "smUSD-E", color: "from-blue-500 to-indigo-500" },
  { key: "boostpool" as CantonPoolTab, label: "Boost Pool", badge: "CTN Yield", color: "from-yellow-400 to-orange-500" },
];

const TIER_LABELS: Record<string, string> = {
  NoLock: "No Lock (1.0\u00d7)",
  ShortLock: "30 Days (1.25\u00d7)",
  MediumLock: "90 Days (1.5\u00d7)",
  LongLock: "180 Days (2.0\u00d7)",
};

function fmtAmount(v: string | number, decimals = 2): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function toInputAmount(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0";
  return v.toFixed(18).replace(/\.?0+$/, "");
}

const EPSILON = 0.000000001;

function parseTokenAmount(token?: { amount: string }): number {
  return token ? parseFloat(token.amount || "0") : 0;
}

function pickCoveringToken(tokens: SimpleToken[], requested: number): SimpleToken | null {
  if (tokens.length === 0) return null;
  const sorted = [...tokens].sort((a, b) => parseTokenAmount(a) - parseTokenAmount(b));
  return sorted.find((token) => parseTokenAmount(token) + EPSILON >= requested) || null;
}

function pickExactOrCoveringToken(tokens: SimpleToken[], requested: number): SimpleToken | null {
  const exact = tokens.find((token) => Math.abs(parseTokenAmount(token) - requested) <= 0.000001);
  if (exact) return exact;
  return pickCoveringToken(tokens, requested);
}

function isLPMatured(lp: SimpleToken): boolean {
  if (!lp.unlockAt) return true; // no unlock info → assume matured
  return new Date(lp.unlockAt).getTime() <= Date.now();
}

function formatTimeRemaining(unlockAt: string): string {
  const diff = new Date(unlockAt).getTime() - Date.now();
  if (diff <= 0) return "Unlocked";
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `Unlocks in ${hours}h ${minutes}m`;
  return `Unlocks in ${minutes}m`;
}

export function CantonStake() {
  const loopWallet = useLoopWallet();
  const activeParty = loopWallet.partyId || null;
  const hasConnectedUserParty = Boolean(activeParty && activeParty.trim());

  const { data, loading, error, refresh } = useCantonLedger(15_000, activeParty);
  const { data: operatorData } = useCantonLedger(60_000, null);

  const [pool, setPool] = useState<CantonPoolTab>("smusd");
  const [tab, setTab] = useState<StakeAction>("stake");
  const [amount, setAmount] = useState("");
  const [depositAsset, setDepositAsset] = useState<DepositAsset>("USDC");
  const [lockTier, setLockTier] = useState("NoLock");
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<string | null>(null);

  const totalMusd = data ? parseFloat(data.totalBalance) : 0;
  const redeemableMusd = data ? parseFloat(data.redeemableBalance || "0") : 0;
  const cip56Musd = data ? parseFloat(data.cip56Balance || "0") : 0;
  const tokens = (data?.tokens || []).filter((t) => t.template === "CantonMUSD");
  const stakingService = data?.stakingService || null;
  const ethPoolService = data?.ethPoolService || null;
  const boostPoolService = data?.boostPoolService || operatorData?.boostPoolService || null;
  const smusdTokens = data?.smusdTokens || [];
  const totalSmusd = data?.totalSmusd ? parseFloat(data.totalSmusd) : 0;
  const smusdETokens = data?.smusdETokens || [];
  const totalSmusdE = data?.totalSmusdE ? parseFloat(data.totalSmusdE) : 0;
  const maxSingleSmusdE = smusdETokens.reduce((max, t) => Math.max(max, parseTokenAmount(t)), 0);

  const boostLPTokens = data?.boostLPTokens || [];
  const totalBoostLP = data?.totalBoostLP ? parseFloat(data.totalBoostLP) : 0;
  const usdcTokens = data?.usdcTokens || [];
  const coinTokens = data?.cantonCoinTokens || [];
  const totalCoin = data?.totalCoin ? parseFloat(data.totalCoin) : 0;

  const usdcxMintingEnabled = data?.directMintService?.usdcxMintingEnabled ?? false;

  // USDC vs USDCx: use canonical API fields for display, filter tokens for tx routing
  const pureUsdcTokens = usdcTokens.filter(t => t.template !== "USDCx");
  const usdcxTokens = usdcTokens.filter(t => t.template === "USDCx");
  const totalPureUsdc = data ? parseFloat(data.usdcBalance || "0") : 0;
  const totalUsdcx = data ? parseFloat(data.usdcxBalance || "0") : 0;
  const selectedDepositTokens = depositAsset === "CTN" ? coinTokens : depositAsset === "USDCx" ? usdcxTokens : pureUsdcTokens;
  const selectedDepositBalance = depositAsset === "CTN" ? totalCoin : depositAsset === "USDCx" ? totalUsdcx : totalPureUsdc;
  const parsedAmount = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const smusdSharePrice = stakingService ? parseFloat(stakingService.sharePrice) : 1.0;
  const smusdTVL = stakingService ? parseFloat(stakingService.pooledMusd) : 0;
  const smusdApy = Math.max(0, (smusdSharePrice - 1) * 100);
  const smusdPositionValue = totalSmusd * smusdSharePrice;

  const ethPoolSharePrice = ethPoolService ? parseFloat(ethPoolService.sharePrice) : 1.0;
  const ethPoolTVL = ethPoolService ? parseFloat(ethPoolService.totalMusdStaked) : 0;
  const boostSharePrice = boostPoolService ? parseFloat(boostPoolService.globalSharePrice) : 1.0;
  const boostApy = Math.max(0, (boostSharePrice - 1) * 100);
  const boostCapRatio = boostPoolService ? parseFloat(boostPoolService.cantonCapRatio) : 0.25;
  const boostCantonPrice = boostPoolService ? parseFloat(boostPoolService.cantonPriceMusd) : 0.172;
  const maxQualifiedCtn = boostCantonPrice > 0
    ? (totalSmusd * smusdSharePrice * boostCapRatio) / boostCantonPrice
    : 0;
  // User's existing deposit is totalBoostLP * boostSharePrice (LP shares → CTN value)
  const userBoostCtnDeposited = totalBoostLP * boostSharePrice;
  const remainingQualifiedCtn = Math.max(0, maxQualifiedCtn - userBoostCtnDeposited);
  const exceedsCap = parsedAmount > 0 && parsedAmount > remainingQualifiedCtn + EPSILON;

  // Boost withdraw: matured LP computation
  const maturedLPs = boostLPTokens.filter(isLPMatured);
  const maturedLPTotal = maturedLPs.reduce((s, lp) => s + parseTokenAmount(lp), 0);
  const withdrawExceedsMatured = parsedAmount > 0 && parsedAmount > maturedLPTotal + EPSILON;

  async function selectTokenForRequestedAmount(
    party: string,
    templateId: "CantonMUSD" | "CantonUSDC" | "USDCx" | "CantonCoin" | "CantonSMUSD_E",
    splitChoice: "CantonMUSD_Split" | "CantonUSDC_Split" | "USDCx_Split" | "CantonCoin_Split" | "SMUSDE_Split",
    tokensList: SimpleToken[],
    requested: number,
    getTokens: (fresh: CantonBalancesData) => SimpleToken[],
    symbol: string
  ): Promise<SimpleToken> {
    const covering = pickCoveringToken(tokensList, requested);
    if (!covering) {
      const largest = tokensList.reduce((max, t) => Math.max(max, parseTokenAmount(t)), 0);
      throw new Error(
        largest > 0
          ? `No ${symbol} contract large enough. Largest available is ${fmtAmount(largest)} ${symbol}.`
          : `No ${symbol} token available.`
      );
    }
    const coveringAmt = parseTokenAmount(covering);
    if (coveringAmt <= requested + EPSILON) {
      return covering;
    }
    const splitResp = await cantonExercise(
      templateId,
      covering.contractId,
      splitChoice,
      { splitAmount: requested.toString() },
      { party }
    );
    if (!splitResp.success) {
      throw new Error(splitResp.error || `Failed to split ${symbol} token.`);
    }
    const refreshed = await fetchFreshBalances(party);
    const refreshedTokens = getTokens(refreshed);
    const selected = pickExactOrCoveringToken(refreshedTokens, requested);
    if (!selected) {
      throw new Error(`Unable to select ${symbol} token after split.`);
    }
    return selected;
  }

  /* ── smUSD Staking handlers ── */
  async function handleSmusdStake() {
    if (!stakingService) return;
    setTxLoading(true); setTxError(null); setTxSuccess(null);
    try {
      if (!hasConnectedUserParty || !activeParty) throw new Error("Connect your Loop wallet party first.");
      if (parsedAmount <= 0) throw new Error("Enter a valid mUSD amount.");
      // Fetch fresh data (Stake is consuming on CantonStakingService)
      const fresh = await fetchFreshBalances(activeParty);
      let freshService = fresh.stakingService;
      if (!freshService) {
        const operatorFresh = await fetchFreshBalances(null).catch(() => null);
        freshService = operatorFresh?.stakingService || null;
      }
      if (!freshService) throw new Error("Staking service not found");
      let freshTokens = (fresh.tokens || []).filter((t) => t.template === "CantonMUSD");
      const freshRedeemable = freshTokens.reduce((s, t) => s + parseFloat(t.amount || "0"), 0);
      const freshCip56 = parseFloat(fresh.cip56Balance || "0");
      // Auto-convert CIP-56 → redeemable if insufficient redeemable balance
      // (Stake currently requires legacy CantonMUSD CIDs per DAML service typing)
      if (freshRedeemable < parsedAmount && freshCip56 > 0 && freshRedeemable + freshCip56 >= parsedAmount) {
        const convertNeeded = parsedAmount - freshRedeemable;
        const convResult = await convertCip56ToRedeemable(activeParty, convertNeeded);
        if (!convResult.success) {
          const rawErr = convResult.error || "";
          if (rawErr.includes("Insufficient operator inventory") || rawErr.includes("inventoryAvailable")) {
            const match = rawErr.match(/have ([\d.]+) redeemable, need ([\d.]+)/);
            const available = match ? match[1] : "0";
            throw new Error(`Conversion inventory low: only ${available} redeemable mUSD available. Try a smaller amount.`);
          }
          if (rawErr.includes("WRONGLY_TYPED_CONTRACT") || rawErr.includes("type mismatch")) {
            throw new Error("Conversion unavailable: operator inventory token mismatch. Contact support.");
          }
          throw new Error(`Auto-conversion failed: ${rawErr}`);
        }
        const refreshed = await fetchFreshBalances(activeParty);
        freshTokens = (refreshed.tokens || []).filter((t) => t.template === "CantonMUSD");
      }
      if (freshTokens.length === 0) {
        throw new Error("No CantonMUSD tokens available for staking");
      }
      const token = await selectTokenForRequestedAmount(
        fresh.party,
        "CantonMUSD",
        "CantonMUSD_Split",
        freshTokens,
        parsedAmount,
        (refreshed) => (refreshed.tokens || []).filter((t) => t.template === "CantonMUSD"),
        "mUSD"
      );
      const resp = await cantonExercise("CantonStakingService", freshService.contractId, "Stake", {
        user: fresh.party, musdCid: token.contractId,
      }, { party: fresh.party });
      if (!resp.success) throw new Error(resp.error || "Stake failed");
      setTxSuccess(`Staked ${fmtAmount(parsedAmount)} mUSD → smUSD shares`);
      setAmount(""); await refresh();
    } catch (err: any) { setTxError(err.message); }
    finally { setTxLoading(false); }
  }

  async function handleSmusdUnstake() {
    if (!stakingService || smusdTokens.length === 0) return;
    setTxLoading(true); setTxError(null); setTxSuccess(null);
    try {
      if (!hasConnectedUserParty || !activeParty) throw new Error("Connect your Loop wallet party first.");
      if (parsedAmount <= 0) throw new Error("Enter a valid smUSD amount.");
      // Fetch fresh data (Unstake is consuming on CantonStakingService)
      const fresh = await fetchFreshBalances(activeParty);
      let freshService = fresh.stakingService;
      if (!freshService) {
        const operatorFresh = await fetchFreshBalances(null).catch(() => null);
        freshService = operatorFresh?.stakingService || null;
      }
      if (!freshService) throw new Error("Staking service not found");
      const freshSmusd = fresh.smusdTokens || [];

      if (OPTION2_BATCH_ENABLED) {
        // ── Option 2: batch unstake path ──
        const userShares = freshSmusd.reduce((s, t) => s + parseTokenAmount(t), 0);
        const poolTotal = parseFloat(freshService.totalShares || "0");
        const sharePrice = parseFloat(freshService.sharePrice || "1");
        const requestedMusd = parsedAmount * sharePrice;
        const pooledMusd = parseFloat(freshService.pooledMusd || "0");

        // Pre-submit: last-staker partial guard
        if (isLastStakerPartialForbidden(userShares, poolTotal, requestedMusd, pooledMusd)) {
          throw new Error(mapBatchUnstakeError("LAST_STAKER_PARTIAL_FORBIDDEN", "Partial unstake blocked"));
        }

        // Select minimal covering CID set (greedy largest-first)
        const cids = selectCoveringCids(freshSmusd, parsedAmount);
        if (cids.length === 0) throw new Error("No smUSD shares available.");

        // Submit to batch endpoint
        const resp = await fetch("/api/canton-batch-unstake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            party: fresh.party,
            pool: "smusd",
            contractIds: cids,
            requestedMusd: requestedMusd.toString(),
          }),
        });
        const data = await resp.json();
        if (!data.success) {
          throw new Error(mapBatchUnstakeError(data.errorType || "", data.error || "Batch unstake failed"));
        }
        setTxSuccess(`Unstaked ${fmtAmount(parsedAmount, 4)} smUSD → ~${fmtAmount(requestedMusd)} mUSD`);
      } else {
        // ── Legacy: single-position unstake ──
        const smusd = pickCoveringToken(freshSmusd, parsedAmount);
        if (!smusd) {
          const largest = freshSmusd.reduce((max, t) => Math.max(max, parseTokenAmount(t)), 0);
          throw new Error(
            largest > 0
              ? `No single smUSD contract covers ${fmtAmount(parsedAmount, 4)}. Largest is ${fmtAmount(largest, 4)} smUSD.`
              : "No smUSD shares available."
          );
        }
        const resp = await cantonExercise("CantonStakingService", freshService.contractId, "Unstake", {
          user: fresh.party, smusdCid: smusd.contractId,
        }, { party: fresh.party });
        if (!resp.success) throw new Error(resp.error || "Unstake failed");
        setTxSuccess(`Unstaked ${fmtAmount(parsedAmount, 4)} smUSD → mUSD`);
      }
      setAmount(""); await refresh();
    } catch (err: any) { setTxError(err.message || "Unstake failed"); }
    finally { setTxLoading(false); }
  }

  /* ── ETH Pool handler ── */
  async function handleEthPoolStake() {
    if (!ethPoolService) return;
    setTxLoading(true); setTxError(null); setTxSuccess(null);
    try {
      if (!hasConnectedUserParty || !activeParty) throw new Error("Connect your Loop wallet party first.");
      if (parsedAmount <= 0) throw new Error(`Enter a valid ${depositAsset} amount.`);
      // Fetch fresh data to avoid stale CIDs (ETHPool choices are consuming)
      const fresh = await fetchFreshBalances(activeParty);
      let freshService = fresh.ethPoolService;
      if (!freshService) {
        const operatorFresh = await fetchFreshBalances(null).catch(() => null);
        freshService = operatorFresh?.ethPoolService || null;
      }
      if (!freshService) throw new Error("ETH Pool service not found");

      // Use fresh token lists
      const freshPureUsdc = (fresh.usdcTokens || []).filter(t => t.template !== "USDCx");
      const freshUsdcx = (fresh.usdcTokens || []).filter(t => t.template === "USDCx");
      const freshCoins = fresh.cantonCoinTokens || [];

      let choice = "";
      const args: Record<string, unknown> = { user: fresh.party, selectedTier: lockTier };
      if (depositAsset === "USDC") {
        const token = await selectTokenForRequestedAmount(
          fresh.party,
          "CantonUSDC",
          "CantonUSDC_Split",
          freshPureUsdc,
          parsedAmount,
          (refreshed) => (refreshed.usdcTokens || []).filter((t) => t.template !== "USDCx"),
          "USDC"
        );
        choice = "ETHPool_StakeWithUSDC"; args.usdcCid = token.contractId;
      } else if (depositAsset === "USDCx") {
        const token = await selectTokenForRequestedAmount(
          fresh.party,
          "USDCx",
          "USDCx_Split",
          freshUsdcx,
          parsedAmount,
          (refreshed) => (refreshed.usdcTokens || []).filter((t) => t.template === "USDCx"),
          "USDCx"
        );
        choice = "ETHPool_StakeWithUSDCx"; args.usdcxCid = token.contractId;
      } else {
        const token = await selectTokenForRequestedAmount(
          fresh.party,
          "CantonCoin",
          "CantonCoin_Split",
          freshCoins,
          parsedAmount,
          (refreshed) => refreshed.cantonCoinTokens || [],
          "CTN"
        );
        choice = "ETHPool_StakeWithCantonCoin"; args.coinCid = token.contractId;
      }
      const resp = await cantonExercise("CantonETHPoolService", freshService.contractId, choice, args, { party: fresh.party });
      if (!resp.success) throw new Error(resp.error || "Stake failed");
      setTxSuccess(`Deposited ${fmtAmount(parsedAmount)} ${depositAsset} → smUSD-E shares`);
      setAmount(""); await refresh();
    } catch (err: any) {
      const msg: string = err.message || "";
      if (msg.includes("USDCX_MINTING_DISABLED")) {
        setTxError("USDCx staking is disabled on this devnet (DirectMint usdcxIssuer is not configured). Use USDC instead.");
      } else {
        setTxError(msg);
      }
    }
    finally { setTxLoading(false); }
  }

  /* ── ETH Pool unstake handler ── */
  async function handleEthPoolUnstake() {
    if (!ethPoolService || smusdETokens.length === 0) return;
    setTxLoading(true); setTxError(null); setTxSuccess(null);
    try {
      if (!hasConnectedUserParty || !activeParty) throw new Error("Connect your Loop wallet party first.");
      if (parsedAmount <= 0) throw new Error("Enter a valid smUSD-E amount.");

      // Fetch fresh data once (all subsequent ops use fresh CIDs)
      let fresh = await fetchFreshBalances(activeParty);
      let freshService = fresh.ethPoolService;
      if (!freshService) {
        const operatorFresh = await fetchFreshBalances(null).catch(() => null);
        freshService = operatorFresh?.ethPoolService || null;
      }
      if (!freshService) throw new Error("ETH Pool service not found");

      const freshSmusdE = fresh.smusdETokens || [];
      const smusdE = await selectTokenForRequestedAmount(
        fresh.party,
        "CantonSMUSD_E",
        "SMUSDE_Split",
        freshSmusdE,
        parsedAmount,
        (refreshed) => refreshed.smusdETokens || [],
        "smUSD-E"
      );
      const resp = await cantonExercise("CantonETHPoolService", freshService.contractId, "ETHPool_Unstake", {
        user: fresh.party, smusdeCid: smusdE.contractId,
      }, { party: fresh.party });
      if (!resp.success) throw new Error(resp.error || "Unstake failed");
      setTxSuccess(`Unstaked ${fmtAmount(parsedAmount, 4)} smUSD-E → mUSD`);
      setAmount("");
      await refresh();
    } catch (err: any) { setTxError(err.message); }
    finally { setTxLoading(false); }
  }

  /* ── Boost Pool handlers ── */
  async function handleBoostDeposit() {
    if (!boostPoolService) return;
    setTxLoading(true); setTxError(null); setTxSuccess(null);
    try {
      if (!hasConnectedUserParty || !activeParty) throw new Error("Connect your Loop wallet party first.");
      if (parsedAmount <= 0) throw new Error("Enter a valid CTN amount.");
      // Fetch fresh data (Boost Deposit is consuming)
      const fresh = await fetchFreshBalances(activeParty);
      let freshService = fresh.boostPoolService;
      if (!freshService) {
        const operatorFresh = await fetchFreshBalances(null).catch(() => null);
        freshService = operatorFresh?.boostPoolService || null;
      }
      if (!freshService) throw new Error("Boost Pool service not found");
      const freshCoins = fresh.cantonCoinTokens || [];
      const coin = await selectTokenForRequestedAmount(
        fresh.party,
        "CantonCoin",
        "CantonCoin_Split",
        freshCoins,
        parsedAmount,
        (refreshed) => refreshed.cantonCoinTokens || [],
        "CTN"
      );
      // Boost Pool requires smUSD stake — pick LARGEST for maximum deposit cap
      const freshSmusd = [...(fresh.smusdTokens || [])].sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
      const smusd = freshSmusd.length > 0 ? freshSmusd[0] : null;
      if (!smusd) throw new Error("Boost Pool requires smUSD stake. Stake mUSD into the smUSD pool first.");
      const resp = await cantonExercise("CantonBoostPoolService", freshService.contractId, "Deposit", {
        user: fresh.party,
        cantonCid: coin.contractId,
        smusdCid: smusd.contractId,
      }, { party: fresh.party });
      if (!resp.success) throw new Error(resp.error || "Deposit failed");
      setTxSuccess(`Deposited ${fmtAmount(parsedAmount)} CTN → Boost LP`);
      setAmount(""); await refresh();
    } catch (err: any) {
      const msg: string = err.message || "";
      if (msg.includes("EXCEEDS_SMUSD_QUALIFIED_CAP") || msg.includes("exceeds smusd-qualified cap")) {
        setTxError(`Deposit exceeds sMUSD-qualified cap (max ~${fmtAmount(remainingQualifiedCtn)} CTN). Stake more mUSD into sMUSD or reduce deposit amount.`);
      } else {
        setTxError(msg);
      }
    }
    finally { setTxLoading(false); }
  }

  async function handleBoostWithdraw() {
    if (!boostPoolService || boostLPTokens.length === 0) return;
    setTxLoading(true); setTxError(null); setTxSuccess(null);
    try {
      if (!hasConnectedUserParty || !activeParty) throw new Error("Connect your Loop wallet party first.");
      if (parsedAmount <= 0) throw new Error("Enter a valid CTN amount to withdraw.");
      // Fetch fresh data (Boost Withdraw is consuming)
      const fresh = await fetchFreshBalances(activeParty);
      let freshService = fresh.boostPoolService;
      if (!freshService) {
        const operatorFresh = await fetchFreshBalances(null).catch(() => null);
        freshService = operatorFresh?.boostPoolService || null;
      }
      if (!freshService) throw new Error("Boost Pool service not found");
      const freshLP = fresh.boostLPTokens || [];
      const freshMatured = freshLP.filter(isLPMatured);
      if (freshMatured.length === 0) throw new Error("No matured Boost LP positions. Cooldown has not elapsed.");
      const freshSharePrice = parseFloat(freshService.globalSharePrice) || 1.0;
      // Convert requested CTN amount to LP shares needed
      const lpSharesNeeded = freshSharePrice > 0 ? parsedAmount / freshSharePrice : parsedAmount;
      const totalMaturedShares = freshMatured.reduce((s, lp) => s + parseTokenAmount(lp), 0);
      if (lpSharesNeeded > totalMaturedShares + EPSILON) {
        throw new Error(`Requested ${fmtAmount(parsedAmount)} CTN exceeds matured LP value (~${fmtAmount(totalMaturedShares * freshSharePrice)} CTN).`);
      }
      // Pick smallest matured LP that covers the needed shares
      const sorted = [...freshMatured].sort((a, b) => parseTokenAmount(a) - parseTokenAmount(b));
      const coveringLP = sorted.find(lp => parseTokenAmount(lp) + EPSILON >= lpSharesNeeded);
      if (!coveringLP) throw new Error("No single matured LP position large enough. Withdraw a smaller amount.");
      const coveringAmt = parseTokenAmount(coveringLP);
      let lpCid = coveringLP.contractId;
      // Split if covering LP is larger than needed
      if (coveringAmt > lpSharesNeeded + EPSILON) {
        const splitResp = await cantonExercise(
          "BoostPoolLP",
          coveringLP.contractId,
          "BPLP_Split",
          { splitAmount: lpSharesNeeded.toString() },
          { party: fresh.party }
        );
        if (!splitResp.success) throw new Error(splitResp.error || "Failed to split Boost LP.");
        // Re-fetch to find the exact-size split piece
        const afterSplit = await fetchFreshBalances(activeParty);
        const splitLPs = (afterSplit.boostLPTokens || []).filter(isLPMatured);
        const exact = splitLPs.find(lp => Math.abs(parseTokenAmount(lp) - lpSharesNeeded) < 0.000001);
        const covering2 = [...splitLPs].sort((a, b) => parseTokenAmount(a) - parseTokenAmount(b))
          .find(lp => parseTokenAmount(lp) + EPSILON >= lpSharesNeeded);
        const selectedLP = exact || covering2;
        if (!selectedLP) throw new Error("Unable to select Boost LP after split.");
        lpCid = selectedLP.contractId;
        // Re-fetch service CID too (split consumes service)
        freshService = afterSplit.boostPoolService || freshService;
      }
      const resp = await cantonExercise("CantonBoostPoolService", freshService.contractId, "Withdraw", {
        user: fresh.party, lpCid,
      }, { party: fresh.party });
      if (!resp.success) throw new Error(resp.error || "Withdraw failed");
      setTxSuccess(`Withdrew ~${fmtAmount(parsedAmount)} CTN from Boost Pool`);
      setAmount(""); await refresh();
    } catch (err: any) {
      const msg: string = err.message || "";
      if (msg.includes("COOLDOWN_NOT_ELAPSED")) {
        setTxError("Cooldown period has not elapsed for this LP position. Wait for the unlock time before withdrawing.");
      } else {
        setTxError(msg);
      }
    }
    finally { setTxLoading(false); }
  }

  /* ── Loading / Error states ── */
  if (loading && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
          <p className="text-gray-400">Loading Canton ledger…</p>
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="max-w-md space-y-4 text-center">
          <h3 className="text-xl font-semibold text-white">Canton Unavailable</h3>
          <p className="text-sm text-gray-400">{error}</p>
          <button onClick={refresh} className="rounded-xl bg-emerald-600 px-6 py-2 font-medium text-white hover:bg-emerald-500">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Stake & Earn"
        subtitle="Earn yield by staking into Canton mUSD vaults \u2014 choose your pool"
        badge="Canton"
        badgeColor="emerald"
        action={
          <button onClick={refresh} className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20">
            <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Refresh
          </button>
        }
      />

      {/* Pool Selector */}
      <div className="flex gap-2 rounded-xl bg-surface-800/50 p-1.5 border border-white/10">
        {POOL_TAB_CONFIG.map(({ key, label, badge, color }) => (
          <button key={key} onClick={() => { setPool(key); setTab("stake"); setAmount(""); }}
            className={`relative flex-1 rounded-lg px-4 py-3 text-sm font-semibold transition-all duration-300 ${pool === key ? "bg-surface-700 text-white shadow-lg" : "text-gray-400 hover:text-white hover:bg-surface-700/50"}`}>
            <span className="flex items-center justify-center gap-2">
              {label}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${pool === key ? `bg-gradient-to-r ${color} text-white` : "bg-surface-600 text-gray-500"}`}>{badge}</span>
              {key === "smusd" && stakingService && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
              {key === "ethpool" && ethPoolService && <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />}
              {key === "boostpool" && boostPoolService && <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />}
            </span>
            {pool === key && <span className={`absolute bottom-0 left-1/2 h-0.5 w-16 -translate-x-1/2 rounded-full bg-gradient-to-r ${color}`} />}
          </button>
        ))}
      </div>

      {/* ========= smUSD POOL ========= */}
      {pool === "smusd" && (
        <>
          {!stakingService ? (
            <div className="card-gradient-border p-8 text-center space-y-4">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                <span className="text-white font-bold text-2xl">s</span>
              </div>
              <h3 className="text-2xl font-bold text-white">smUSD Staking Service</h3>
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-5 max-w-lg mx-auto">
                <p className="text-sm text-gray-400">The smUSD staking service is not yet deployed on this Canton participant.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              {/* Left: Stake/Unstake Card */}
              <div>
                <div className="card-gradient-border overflow-hidden">
                  <div className="flex border-b border-white/10">
                    <button className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all ${tab === "stake" ? "text-white" : "text-gray-400 hover:text-white"}`} onClick={() => { setTab("stake"); setAmount(""); }}>
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                        Stake mUSD
                      </span>
                      {tab === "stake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />}
                    </button>
                    <button className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all ${tab === "unstake" ? "text-white" : "text-gray-400 hover:text-white"}`} onClick={() => { setTab("unstake"); setAmount(""); }}>
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Unstake smUSD
                      </span>
                      {tab === "unstake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />}
                    </button>
                  </div>

                  <div className="space-y-6 p-6">
                    {tab === "stake" ? (
                      tokens.length > 0 ? (
                        <>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium text-gray-400">You Stake</label>
                              <span className="text-xs text-gray-500">Balance: {fmtAmount(redeemableMusd)} mUSD redeemable</span>
                            </div>
                            <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-emerald-500/50 focus-within:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)]">
                              <div className="flex items-center gap-4">
                                <input
                                  type="number"
                                  className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                                  placeholder="0.00"
                                  value={amount}
                                  onChange={(e) => setAmount(e.target.value)}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/30"
                                    onClick={() => setAmount(toInputAmount(redeemableMusd))}
                                  >
                                    MAX
                                  </button>
                                  <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand-500 to-purple-500" />
                                    <span className="font-semibold text-white">mUSD</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-surface-800/30 p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm text-gray-400">You Stake</p>
                                <p className="text-2xl font-semibold text-white">{fmtAmount(parsedAmount)} mUSD</p>
                              </div>
                              <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand-500 to-purple-500" />
                                <span className="font-semibold text-white">mUSD</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-center">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-surface-800">
                              <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-surface-800/30 p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm text-gray-400">You Receive</p>
                                <p className="text-2xl font-semibold text-white">~{fmtAmount(parsedAmount / smusdSharePrice, 4)} smUSD</p>
                              </div>
                              <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                <div className="h-6 w-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500" />
                                <span className="font-semibold text-white">smUSD</span>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2 rounded-xl bg-surface-800/30 p-4">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">Share Price</span>
                              <span className="font-medium text-white">1 smUSD = {smusdSharePrice.toFixed(4)} mUSD</span>
                            </div>
                            <div className="divider my-2" />
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">Cooldown Period</span>
                              <span className="text-gray-300">{Math.round((stakingService?.cooldownSeconds || 86400) / 3600)}h</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">Min Deposit</span>
                              <span className="text-gray-300">{fmtAmount(stakingService?.minDeposit || "0.01")} mUSD</span>
                            </div>
                          </div>
                          {cip56Musd > 0 && redeemableMusd < parsedAmount && (
                            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2">
                              <p className="text-xs text-blue-300">
                                Stake currently requires legacy CantonMUSD. CIP-56 mUSD will be auto-converted when needed.
                              </p>
                            </div>
                          )}
                          <TxButton onClick={handleSmusdStake} loading={txLoading} disabled={tokens.length === 0 || parsedAmount <= 0} className="w-full">
                            <span className="flex items-center justify-center gap-2">
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                              Stake mUSD → smUSD
                            </span>
                          </TxButton>
                        </>
                      ) : (
                        <div className="text-center py-12">
                          <p className="text-gray-400 font-medium">No redeemable CantonMUSD available</p>
                          <p className="text-sm text-gray-500 mt-1">
                            {cip56Musd > 0
                              ? "CIP-56 is your primary mUSD balance. Staking auto-converts from CIP-56 when triggered."
                              : "Bridge mUSD from Ethereum first."}
                          </p>
                        </div>
                      )
                    ) : (
                      smusdTokens.length === 0 ? (
                        <div className="text-center py-12">
                          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-surface-700/50 mb-4">
                            <svg className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
                          </div>
                          <p className="text-gray-400 font-medium">No smUSD positions</p>
                          <p className="text-sm text-gray-500 mt-1">Switch to Stake tab to create a position</p>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium text-gray-400">Unstake Amount</label>
                              <span className="text-xs text-gray-500">Balance: {fmtAmount(totalSmusd, 4)} smUSD</span>
                            </div>
                            <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-emerald-500/50 focus-within:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)]">
                              <div className="flex items-center gap-4">
                                <input
                                  type="number"
                                  className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                                  placeholder="0.00"
                                  value={amount}
                                  onChange={(e) => setAmount(e.target.value)}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/30"
                                    onClick={() => setAmount(toInputAmount(totalSmusd))}
                                  >
                                    MAX
                                  </button>
                                  <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500" />
                                    <span className="font-semibold text-white">smUSD</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-surface-800/30 p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm text-gray-400">You Receive</p>
                                <p className="text-2xl font-semibold text-white">~{fmtAmount(parsedAmount * smusdSharePrice)} mUSD</p>
                              </div>
                              <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand-500 to-purple-500" />
                                <span className="font-semibold text-white">mUSD</span>
                              </div>
                            </div>
                          </div>
                          <TxButton onClick={handleSmusdUnstake} loading={txLoading} disabled={smusdTokens.length === 0 || parsedAmount <= 0} className="w-full">
                            <span className="flex items-center justify-center gap-2">
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              Unstake smUSD → mUSD
                            </span>
                          </TxButton>
                        </div>
                      )
                    )}
                    {txError && <div className="alert-error flex items-center gap-3"><span className="text-sm">{txError}</span></div>}
                    {txSuccess && <div className="alert-success flex items-center gap-3"><span className="text-sm">{txSuccess}</span></div>}
                  </div>
                </div>
              </div>

              {/* Right: Stats & Position */}
              <div className="space-y-4">
                <div className="grid gap-4 grid-cols-2">
                  <StatCard label="Share Price" value={`${smusdSharePrice.toFixed(4)} mUSD`} subValue="per smUSD" color="green" />
                  <StatCard label="Estimated APY" value={`${smusdApy.toFixed(2)}%`} color="green" />
                  <StatCard label="Available mUSD" value={fmtAmount(redeemableMusd)} subValue={`${tokens.length} redeemable contracts`} color="blue" />
                  <StatCard label="Your smUSD" value={fmtAmount(totalSmusd, 4)} subValue={totalSmusd > 0 ? `\u2248 ${fmtAmount(smusdPositionValue)} mUSD` : undefined} color="purple" />
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <StatCard label="Pool TVL" value={fmtAmount(smusdTVL) + " mUSD"} color="blue" />
                  <StatCard label="Total Shares" value={fmtAmount(parseFloat(stakingService?.totalShares || "0"), 4)} color="purple" />
                </div>
                <div className="card overflow-hidden border-l-4 border-emerald-500">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 flex-shrink-0">
                      <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">Canton smUSD Vault — Live</h3>
                      <p className="text-sm text-gray-400">Stake mUSD into the Canton yield vault. Your mUSD is held in the pool and you receive smUSD shares. The share price increases as protocol revenue accrues.</p>
                      <p className="text-xs text-gray-500 mt-2 font-mono">Service: {stakingService.contractId.slice(0, 24)}…</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* How Staking Works */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-5">How Staking Works</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-brand-400 font-bold text-sm mb-3">1</div>
                <h3 className="font-medium text-white mb-1">Deposit mUSD</h3>
                <p className="text-sm text-gray-400">Enter an mUSD amount and stake it into the vault.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-sm mb-3">2</div>
                <h3 className="font-medium text-white mb-1">Earn Yield</h3>
                <p className="text-sm text-gray-400">The smUSD share price increases as protocol revenue accrues.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 font-bold text-sm mb-3">3</div>
                <h3 className="font-medium text-white mb-1">Withdraw After Cooldown</h3>
                <p className="text-sm text-gray-400">Redeem smUSD for mUSD at the current share price.</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ========= ETH POOL ========= */}
      {pool === "ethpool" && (
        <>
          {!ethPoolService ? (
            <div className="card-gradient-border p-8 text-center space-y-4">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                <span className="text-white font-bold text-2xl">E</span>
              </div>
              <h3 className="text-2xl font-bold text-white">ETH Pool Service</h3>
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-5 max-w-lg mx-auto">
                <p className="text-sm text-gray-400">The ETH Pool service is not yet deployed on this Canton participant.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <div className="card-gradient-border overflow-hidden">
                  <div className="flex border-b border-white/10">
                    <button className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all ${tab === "stake" ? "text-white" : "text-gray-400 hover:text-white"}`} onClick={() => { setTab("stake"); setAmount(""); }}>
                      <span className="relative z-10 flex items-center justify-center gap-2">Stake</span>
                      {tab === "stake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" />}
                    </button>
                    <button className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all ${tab === "unstake" ? "text-white" : "text-gray-400 hover:text-white"}`} onClick={() => { setTab("unstake"); setAmount(""); }}>
                      <span className="relative z-10 flex items-center justify-center gap-2">Unstake</span>
                      {tab === "unstake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" />}
                    </button>
                  </div>

                  <div className="space-y-6 p-6">
                    {tab === "stake" ? (
                      <>
                        {/* Deposit Asset Selector */}
                        <div className="space-y-3">
                          <label className="text-sm font-medium text-gray-400">Deposit Asset</label>
                          <div className="grid grid-cols-3 gap-2">
                            {(["USDC", "USDCx", "CTN"] as DepositAsset[]).map(asset => (
                              <button key={asset} onClick={() => { setDepositAsset(asset); setAmount(""); }}
                                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${depositAsset === asset ? "border-blue-500 bg-blue-500/20 text-white" : "border-white/10 bg-surface-800/50 text-gray-400 hover:border-white/30 hover:text-white"}`}>
                                {asset}
                              </button>
                            ))}
                          </div>
                          {depositAsset === "USDCx" && !usdcxMintingEnabled && (
                            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3 mt-2">
                              <p className="text-sm text-yellow-400">USDCx staking is disabled on this devnet (DirectMint usdcxIssuer is not configured).</p>
                            </div>
                          )}
                        </div>
                        {/* Lock Tier */}
                        <div className="space-y-3">
                          <label className="text-sm font-medium text-gray-400">Time-Lock Boost</label>
                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(TIER_LABELS).map(([tier, label]) => (
                              <button key={tier} onClick={() => setLockTier(tier)}
                                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${lockTier === tier ? "border-blue-500 bg-blue-500/20 text-white" : "border-white/10 bg-surface-800/50 text-gray-400 hover:border-white/30 hover:text-white"}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Amount Input */}
                        {selectedDepositTokens.length > 0 ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium text-gray-400">Deposit Amount</label>
                              <span className="text-xs text-gray-500">Balance: {fmtAmount(selectedDepositBalance)} {depositAsset}</span>
                            </div>
                            <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-blue-500/50">
                              <div className="flex items-center gap-4">
                                <input
                                  type="number"
                                  className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                                  placeholder="0.00"
                                  value={amount}
                                  onChange={(e) => setAmount(e.target.value)}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-300 transition-colors hover:bg-blue-500/30"
                                    onClick={() => setAmount(toInputAmount(selectedDepositBalance))}
                                  >
                                    MAX
                                  </button>
                                  <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                    <span className="font-semibold text-white">{depositAsset}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-center">
                            <p className="text-sm text-gray-400">No {depositAsset} tokens available on Canton</p>
                          </div>
                        )}
                        <TxButton onClick={handleEthPoolStake} loading={txLoading} disabled={selectedDepositTokens.length === 0 || parsedAmount <= 0 || (depositAsset === "USDCx" && !usdcxMintingEnabled)} className="w-full">
                          Stake {depositAsset} → smUSD-E
                        </TxButton>
                      </>
                    ) : (
                      smusdETokens.length === 0 ? (
                        <div className="text-center py-12">
                          <p className="text-gray-400 font-medium">No smUSD-E positions yet</p>
                          <p className="text-sm text-gray-500 mt-1">Switch to Stake tab to create a staking position</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-400">Unstake Amount</label>
                            <span className="text-xs text-gray-500">
                              Total: {fmtAmount(totalSmusdE, 4)} smUSD-E
                              {totalSmusdE > maxSingleSmusdE && (
                                <> &nbsp;·&nbsp; Max per tx: {fmtAmount(maxSingleSmusdE, 4)}</>
                              )}
                            </span>
                          </div>
                          <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-blue-500/50">
                            <div className="flex items-center gap-4">
                              <input
                                type="number"
                                className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                                placeholder="0.00"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  className="rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-300 transition-colors hover:bg-blue-500/30"
                                  onClick={() => setAmount(toInputAmount(maxSingleSmusdE))}
                                >
                                  MAX
                                </button>
                                <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                  <span className="font-semibold text-white">smUSD-E</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <TxButton onClick={handleEthPoolUnstake} loading={txLoading} disabled={maxSingleSmusdE === 0 || parsedAmount <= 0 || parsedAmount > maxSingleSmusdE} className="w-full">
                            {"Unstake smUSD-E → mUSD"}
                          </TxButton>
                        </div>
                      )
                    )}
                    {txError && <div className="alert-error flex items-center gap-3"><span className="text-sm">{txError}</span></div>}
                    {txSuccess && <div className="alert-success flex items-center gap-3"><span className="text-sm">{txSuccess}</span></div>}
                  </div>
                </div>
              </div>

              {/* Right: Pool Stats */}
              <div className="space-y-4">
                <div className="grid gap-4 grid-cols-2">
                  <StatCard label="Share Price" value={`${ethPoolSharePrice.toFixed(4)} mUSD`} subValue="per smUSD-E" color="blue" />
                  <StatCard label="Estimated APY" value={`${Math.max(0, (ethPoolSharePrice - 1) * 100).toFixed(2)}%`} color="green" />
                  <StatCard
                    label={`Available ${depositAsset}`}
                    value={fmtAmount(selectedDepositBalance)}
                    subValue={`${selectedDepositTokens.length} contracts`}
                    color="blue"
                  />
                  <StatCard
                    label="Your smUSD-E"
                    value={fmtAmount(totalSmusdE, 4)}
                    subValue={totalSmusdE > 0 ? `≈ ${fmtAmount(totalSmusdE * ethPoolSharePrice)} mUSD` : undefined}
                    color="purple"
                  />
                  <StatCard label="Pool TVL" value={fmtAmount(ethPoolTVL) + " mUSD"} color="blue" />
                  <StatCard label="Total Shares" value={fmtAmount(parseFloat(ethPoolService?.totalShares || "0"), 4)} color="purple" />
                </div>
                <div className="card overflow-hidden">
                  <h3 className="text-sm font-medium text-gray-400 mb-3">Your Canton Assets</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">USDC</span><span className="text-white font-medium">{fmtAmount(totalPureUsdc)} ({data?.usdcContractCount ?? 0} contracts)</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">USDCx</span><span className="text-white font-medium">{fmtAmount(totalUsdcx)} ({data?.usdcxContractCount ?? 0} contracts)</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">Canton Coin (CTN)</span><span className="text-white font-medium">{fmtAmount(totalCoin)} ({coinTokens.length} contracts)</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">mUSD (Total)</span><span className="text-white font-medium">{fmtAmount(totalMusd)} ({data?.tokenCount || 0} contracts)</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">mUSD (Redeemable)</span><span className="text-white font-medium">{fmtAmount(redeemableMusd)} ({data?.redeemableTokenCount ?? 0} contracts)</span></div>
                  </div>
                </div>
                <div className="card overflow-hidden border-l-4 border-blue-500">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/20 flex-shrink-0">
                      <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">ETH Pool — Fluid Strategy Yield</h3>
                      <p className="text-sm text-gray-400">Deposit USDC, USDCx, or Canton Coin. Capital flows to Ethereum Treasury → Fluid T2/T4 vaults. Receive smUSD-E shares with optional time-lock boost multipliers (up to 2×).</p>
                      <p className="text-xs text-gray-500 mt-2 font-mono">Service: {ethPoolService.contractId.slice(0, 24)}…</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* How ETH Pool Works */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-5">How ETH Pool Works</h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm mb-3">1</div>
                <h3 className="font-medium text-white mb-1">Deposit Assets</h3>
                <p className="text-sm text-gray-400">Deposit USDC, USDCx, or Canton Coin.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 font-bold text-sm mb-3">2</div>
                <h3 className="font-medium text-white mb-1">Receive smUSD-E</h3>
                <p className="text-sm text-gray-400">Get smUSD-E shares with optional time-lock multipliers.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-sm mb-3">3</div>
                <h3 className="font-medium text-white mb-1">Earn Yield</h3>
                <p className="text-sm text-gray-400">Pool capital is deployed to Fluid leveraged loop strategies.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 font-bold text-sm mb-3">4</div>
                <h3 className="font-medium text-white mb-1">Unstake for mUSD</h3>
                <p className="text-sm text-gray-400">Redeem smUSD-E shares for CantonMUSD at the current share price.</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ========= BOOST POOL ========= */}
      {pool === "boostpool" && (
        <>
          {!boostPoolService ? (
            <div className="card-gradient-border p-8 text-center space-y-4">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                <span className="text-white font-bold text-2xl">{"⚡"}</span>
              </div>
              <h3 className="text-2xl font-bold text-white">Canton Coin Boost Pool</h3>
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-5 max-w-lg mx-auto">
                <p className="text-sm text-gray-400">The Boost Pool service is not yet deployed on this Canton participant.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <div className="card-gradient-border overflow-hidden">
                  <div className="flex border-b border-white/10">
                    <button className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all ${tab === "stake" ? "text-white" : "text-gray-400 hover:text-white"}`} onClick={() => { setTab("stake"); setAmount(""); }}>
                      <span className="relative z-10 flex items-center justify-center gap-2">Deposit CTN</span>
                      {tab === "stake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500" />}
                    </button>
                    <button className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all ${tab === "unstake" ? "text-white" : "text-gray-400 hover:text-white"}`} onClick={() => { setTab("unstake"); setAmount(""); }}>
                      <span className="relative z-10 flex items-center justify-center gap-2">Withdraw</span>
                      {tab === "unstake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500" />}
                    </button>
                  </div>

                  <div className="space-y-6 p-6">
                    {tab === "stake" ? (
                      coinTokens.length > 0 ? (
                        <>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium text-gray-400">Deposit CTN Amount</label>
                              <span className="text-xs text-gray-500">Balance: {fmtAmount(totalCoin)} CTN</span>
                            </div>
                            <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-yellow-500/50">
                              <div className="flex items-center gap-4">
                                <input
                                  type="number"
                                  className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                                  placeholder="0.00"
                                  value={amount}
                                  onChange={(e) => setAmount(e.target.value)}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg bg-yellow-500/20 px-3 py-1.5 text-xs font-semibold text-yellow-300 transition-colors hover:bg-yellow-500/30"
                                    onClick={() => setAmount(toInputAmount(Math.min(totalCoin, remainingQualifiedCtn)))}
                                  >
                                    MAX
                                  </button>
                                  <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                    <span className="font-semibold text-white">CTN</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          {smusdTokens.length === 0 && (
                            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
                              <p className="text-sm text-yellow-400">You need smUSD to verify eligibility for the Boost Pool. Stake mUSD first.</p>
                            </div>
                          )}
                          {smusdTokens.length > 0 && (
                            <div className="space-y-2 rounded-xl border border-white/10 bg-surface-800/30 p-4">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">Max Qualified Deposit</span>
                                <span className="text-white font-medium">{fmtAmount(maxQualifiedCtn)} CTN</span>
                              </div>
                              {userBoostCtnDeposited > EPSILON && (
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-gray-400">Already Deposited</span>
                                  <span className="text-white font-medium">{fmtAmount(userBoostCtnDeposited)} CTN</span>
                                </div>
                              )}
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">Remaining Qualified</span>
                                <span className={`font-medium ${remainingQualifiedCtn < EPSILON ? "text-red-400" : "text-emerald-400"}`}>{fmtAmount(remainingQualifiedCtn)} CTN</span>
                              </div>
                            </div>
                          )}
                          {exceedsCap && (
                            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                              <p className="text-sm text-red-400">Deposit exceeds sMUSD-qualified cap. Stake more mUSD into sMUSD or reduce deposit amount.</p>
                            </div>
                          )}
                          <div className="space-y-2 rounded-xl bg-surface-800/30 p-4">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">Entry Fee</span>
                              <span className="text-white font-medium">{(boostPoolService.entryFeeBps / 100).toFixed(2)}%</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">Exit Fee</span>
                              <span className="text-white font-medium">{(boostPoolService.exitFeeBps / 100).toFixed(2)}%</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">CTN Price</span>
                              <span className="text-white font-medium">{parseFloat(boostPoolService.cantonPriceMusd).toFixed(4)} mUSD</span>
                            </div>
                          </div>
                          <TxButton onClick={handleBoostDeposit} loading={txLoading} disabled={coinTokens.length === 0 || smusdTokens.length === 0 || parsedAmount <= 0 || exceedsCap} className="w-full">
                            {"Deposit CTN → Boost LP"}
                          </TxButton>
                        </>
                      ) : (
                        <div className="text-center py-12">
                          <p className="text-gray-400 font-medium">No Canton Coin available</p>
                          <p className="text-sm text-gray-500 mt-1">You need CTN tokens to deposit into the Boost Pool</p>
                        </div>
                      )
                    ) : (
                      boostLPTokens.length === 0 ? (
                        <div className="text-center py-12">
                          <p className="text-gray-400 font-medium">No Boost LP positions</p>
                          <p className="text-sm text-gray-500 mt-1">Switch to Deposit tab to create a position</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Amount input */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium text-gray-400">Withdraw CTN Amount</label>
                              <span className="text-xs text-gray-500">Withdrawable: {fmtAmount(maturedLPTotal * boostSharePrice)} CTN</span>
                            </div>
                            <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-yellow-500/50">
                              <div className="flex items-center gap-4">
                                <input
                                  type="number"
                                  className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                                  placeholder="0.00"
                                  value={amount}
                                  onChange={(e) => setAmount(e.target.value)}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg bg-yellow-500/20 px-3 py-1.5 text-xs font-semibold text-yellow-300 transition-colors hover:bg-yellow-500/30"
                                    onClick={() => setAmount(toInputAmount(maturedLPTotal * boostSharePrice))}
                                  >
                                    MAX
                                  </button>
                                  <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                    <span className="font-semibold text-white">CTN</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          {withdrawExceedsMatured && (
                            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                              <p className="text-sm text-red-400">Requested amount exceeds matured LP value (~{fmtAmount(maturedLPTotal * boostSharePrice)} CTN). Wait for cooldown or reduce amount.</p>
                            </div>
                          )}
                          {/* Per-position cooldown status */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-400">Your Positions</label>
                            {boostLPTokens.map((lp) => {
                              const matured = isLPMatured(lp);
                              const ctnValue = parseTokenAmount(lp) * boostSharePrice;
                              return (
                                <div key={lp.contractId} className={`rounded-xl border p-3 ${matured ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-surface-800/50"}`}>
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="font-medium text-white">{fmtAmount(ctnValue)} CTN</span>
                                      <span className="text-xs text-gray-500 ml-2">({fmtAmount(lp.amount, 4)} LP)</span>
                                    </div>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${matured ? "bg-emerald-500/20 text-emerald-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                                      {matured ? "Unlocked" : lp.unlockAt ? formatTimeRemaining(lp.unlockAt) : "Locked"}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <TxButton onClick={handleBoostWithdraw} loading={txLoading} disabled={boostLPTokens.length === 0 || parsedAmount <= 0 || withdrawExceedsMatured || maturedLPs.length === 0} className="w-full">
                            Withdraw CTN from Boost Pool
                          </TxButton>
                        </div>
                      )
                    )}
                    {txError && <div className="alert-error flex items-center gap-3"><span className="text-sm">{txError}</span></div>}
                    {txSuccess && <div className="alert-success flex items-center gap-3"><span className="text-sm">{txSuccess}</span></div>}
                  </div>
                </div>
              </div>

              {/* Right: Boost Pool Stats */}
              <div className="space-y-4">
                <div className="grid gap-4 grid-cols-2">
                  <StatCard label="CTN Price" value={`${parseFloat(boostPoolService.cantonPriceMusd).toFixed(4)} mUSD`} color="yellow" />
                  <StatCard label="Share Price" value={`${parseFloat(boostPoolService.globalSharePrice).toFixed(4)}`} subValue="per Boost LP" color="green" />
                  <StatCard label="Total CTN Deposited" value={fmtAmount(boostPoolService.totalCantonDeposited)} color="blue" />
                  <StatCard label="APY" value={`${boostApy.toFixed(2)}%`} color="purple" />
                </div>
                <div className="card overflow-hidden">
                  <h3 className="text-sm font-medium text-gray-400 mb-3">Your Boost Positions</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">Boost LP</span><span className="text-white font-medium">{fmtAmount(totalBoostLP, 4)} ({boostLPTokens.length})</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">Canton Coin</span><span className="text-white font-medium">{fmtAmount(totalCoin)} ({coinTokens.length})</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">smUSD (eligibility)</span><span className="text-white font-medium">{fmtAmount(totalSmusd, 4)} ({smusdTokens.length})</span></div>
                    <div className="divider my-2" />
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">Cap Ratio</span><span className="text-white font-medium">{(boostCapRatio * 100).toFixed(0)}%</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">Qualified Cap</span><span className="text-emerald-400 font-medium">{fmtAmount(maxQualifiedCtn)} CTN</span></div>
                    <div className="flex items-center justify-between text-sm"><span className="text-gray-400">Remaining</span><span className={`font-medium ${remainingQualifiedCtn < EPSILON ? "text-red-400" : "text-emerald-400"}`}>{fmtAmount(remainingQualifiedCtn)} CTN</span></div>
                  </div>
                </div>
                <div className="card overflow-hidden border-l-4 border-yellow-500">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/20 flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">Canton Coin Boost Pool</h3>
                      <p className="text-sm text-gray-400">Deposit CTN alongside your smUSD position. Earn boosted validator rewards and LP fee distributions. Entry fee {(boostPoolService.entryFeeBps / 100).toFixed(2)}%, exit fee {(boostPoolService.exitFeeBps / 100).toFixed(2)}%.</p>
                      <p className="text-xs text-gray-500 mt-2 font-mono">Service: {boostPoolService.contractId.slice(0, 24)}\u2026</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* How Boost Pool Works */}
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-5">How Boost Pool Works</h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-400 font-bold text-sm mb-3">1</div>
                <h3 className="font-medium text-white mb-1">Deposit CTN</h3>
                <p className="text-sm text-gray-400">Deposit Canton Coin (requires smUSD eligibility).</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/20 text-orange-400 font-bold text-sm mb-3">2</div>
                <h3 className="font-medium text-white mb-1">Receive Boost LP</h3>
                <p className="text-sm text-gray-400">Get LP shares representing your pool position.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-sm mb-3">3</div>
                <h3 className="font-medium text-white mb-1">Earn Rewards</h3>
                <p className="text-sm text-gray-400">Earn validator rewards and protocol LP fee distributions.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 font-bold text-sm mb-3">4</div>
                <h3 className="font-medium text-white mb-1">Withdraw CTN</h3>
                <p className="text-sm text-gray-400">Burn LP shares to reclaim your CTN plus accrued rewards.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

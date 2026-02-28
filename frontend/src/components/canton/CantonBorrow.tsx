import React, { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { TxButton } from "@/components/TxButton";
import WalletConnector from "@/components/WalletConnector";
import { SlippageInput } from "@/components/SlippageInput";
import {
  useCantonLedger,
  cantonExercise,
  fetchFreshBalances,
  refreshPriceFeeds,
  convertCip56ToRedeemable,
  type CantonBalancesData,
  type EscrowInfo,
  type SimpleToken,
} from "@/hooks/useCantonLedger";
import { useLoopWallet } from "@/hooks/useLoopWallet";

type ActionTab = "deposit" | "borrow" | "repay" | "withdraw";
type CollateralAsset = "CTN" | "SMUSD" | "SMUSDE";

interface CantonCollateralInfo {
  key: CollateralAsset;
  collateralType: string;
  symbol: string;
  deposited: number;
  priceUsd: number;
  valueUsd: number;
  factorBps: number;
  liqThreshold: number;
  liqPenalty: number;
}

const COLLATERAL_META: Record<CollateralAsset, { symbol: string; collateralType: string; priceAliases: string[] }> = {
  CTN: { symbol: "Canton Coin", collateralType: "CTN_Coin", priceAliases: ["CTN", "CANTON", "CANTONCOIN", "CANTON COIN"] },
  SMUSD: { symbol: "smUSD", collateralType: "CTN_SMUSD", priceAliases: ["SMUSD", "CTN_SMUSD"] },
  SMUSDE: { symbol: "smUSD-E", collateralType: "CTN_SMUSDE", priceAliases: ["SMUSDE", "SMUSD-E", "CTN_SMUSDE"] },
};

const COLLATERAL_TYPE_TO_ASSET: Record<string, CollateralAsset> = {
  CTN_Coin: "CTN",
  CTN_SMUSD: "SMUSD",
  CTN_SMUSDE: "SMUSDE",
};

function fmtAmount(value: number, digits = 2): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtUSD(value: number): string {
  return `$${fmtAmount(value, 2)}`;
}

function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function normalizeKey(value: string): string {
  return (value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function getAssetContracts(asset: CollateralAsset, data: CantonBalancesData | null): SimpleToken[] {
  if (!data) return [];
  if (asset === "CTN") return data.cantonCoinTokens || [];
  if (asset === "SMUSD") return data.smusdTokens || [];
  return data.smusdETokens || [];
}

function pickContractForAmount(tokens: SimpleToken[], requested: number): SimpleToken | null {
  if (tokens.length === 0) return null;
  const sorted = [...tokens].sort((a, b) => parseFloat(a.amount || "0") - parseFloat(b.amount || "0"));
  if (requested <= 0) return sorted[0];
  const exact = sorted.find((token) => Math.abs(parseFloat(token.amount || "0") - requested) < 0.000001);
  if (exact) return exact;
  const covering = sorted.find((token) => parseFloat(token.amount || "0") >= requested);
  return covering || null;
}

function pickEscrowForWithdraw(escrows: EscrowInfo[], collateralType: string, requested: number): EscrowInfo | null {
  const candidates = escrows
    .filter((escrow) => escrow.collateralType === collateralType)
    .sort((a, b) => parseFloat(a.amount || "0") - parseFloat(b.amount || "0"));
  if (candidates.length === 0) return null;
  const covering = candidates.find((escrow) => parseFloat(escrow.amount || "0") >= requested);
  return covering || null;
}

function resolvePriceFeedCidForCollateralType(
  collateralType: string,
  feeds: CantonBalancesData["priceFeeds"] | undefined
): string | null {
  if (!feeds || feeds.length === 0) return null;

  const aliasMap = new Map<string, string>();
  for (const feed of feeds) {
    aliasMap.set(normalizeKey(feed.asset), feed.contractId);
  }

  const meta = Object.values(COLLATERAL_META).find((row) => row.collateralType === collateralType);
  if (!meta) return null;

  for (const alias of meta.priceAliases) {
    const cid = aliasMap.get(normalizeKey(alias));
    if (cid) return cid;
  }
  return null;
}

function buildEscrowPriceFeedPairs(
  escrows: EscrowInfo[],
  feeds: CantonBalancesData["priceFeeds"] | undefined
): { escrowCids: string[]; priceFeedCids: string[] } {
  const escrowCids: string[] = [];
  const priceFeedCids: string[] = [];

  for (const escrow of escrows) {
    const priceFeedCid = resolvePriceFeedCidForCollateralType(escrow.collateralType, feeds);
    if (!priceFeedCid) {
      throw new Error(`Missing price feed for collateral type ${escrow.collateralType}.`);
    }
    escrowCids.push(escrow.contractId);
    priceFeedCids.push(priceFeedCid);
  }

  return { escrowCids, priceFeedCids };
}

function mergePriceFeeds(
  userView: CantonBalancesData,
  operatorView: CantonBalancesData | null
): CantonBalancesData["priceFeeds"] {
  const byId = new Map<string, CantonBalancesData["priceFeeds"][number]>();
  for (const feed of operatorView?.priceFeeds || []) {
    if (feed?.contractId) byId.set(feed.contractId, feed);
  }
  for (const feed of userView.priceFeeds || []) {
    if (feed?.contractId) byId.set(feed.contractId, feed);
  }
  return Array.from(byId.values());
}

export function CantonBorrow() {
  const loopWallet = useLoopWallet();
  const activeParty = loopWallet.partyId || null;
  const hasConnectedUserParty = Boolean(activeParty && activeParty.trim());

  const { data, loading, error, refresh } = useCantonLedger(15_000, activeParty);
  const { data: operatorData } = useCantonLedger(15_000, null);

  const [action, setAction] = useState<ActionTab>("deposit");
  const [amount, setAmount] = useState("");
  const [collateralAsset, setCollateralAsset] = useState<CollateralAsset>("CTN");
  const [submitting, setSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [slippageBps, setSlippageBps] = useState(50);

  const lendingService = data?.lendingService || operatorData?.lendingService || null;

  const userEscrows = useMemo(() => {
    const rows = data?.escrowPositions || [];
    if (!activeParty) return rows;
    return rows.filter((row) => row.owner === activeParty);
  }, [data?.escrowPositions, activeParty]);

  const userDebts = useMemo(() => {
    const rows = data?.debtPositions || [];
    if (!activeParty) return rows;
    return rows.filter((row) => row.owner === activeParty);
  }, [data?.debtPositions, activeParty]);

  const userMusdTokens = useMemo(() => data?.tokens || [], [data?.tokens]);
  const userMusdBalance = userMusdTokens.reduce((sum, token) => sum + parseFloat(token.amount || "0"), 0);

  // Merge user + operator price feeds so collateral valuation works even when
  // the user party cannot directly see operator-created CantonPriceFeed contracts.
  const effectiveFeeds = useMemo(
    () => mergePriceFeeds(data || ({ priceFeeds: [] } as unknown as CantonBalancesData), operatorData),
    [data, operatorData]
  );

  const collateralInfos = useMemo<CantonCollateralInfo[]>(() => {
    const feedMap = new Map<string, number>();
    for (const feed of effectiveFeeds) {
      const price = parseFloat(feed.priceMusd || "0");
      feedMap.set(normalizeKey(feed.asset), Number.isFinite(price) ? price : 0);
    }

    return (Object.keys(COLLATERAL_META) as CollateralAsset[]).map((asset) => {
      const meta = COLLATERAL_META[asset];
      const deposited = userEscrows
        .filter((escrow) => escrow.collateralType === meta.collateralType)
        .reduce((sum, escrow) => sum + parseFloat(escrow.amount || "0"), 0);

      const priceUsd = meta.priceAliases
        .map((alias) => feedMap.get(normalizeKey(alias)))
        .find((price) => Number.isFinite(price) && (price as number) > 0) || 0;

      const valueUsd = deposited * priceUsd;
      const cfg = lendingService?.configs?.[meta.collateralType];

      return {
        key: asset,
        collateralType: meta.collateralType,
        symbol: meta.symbol,
        deposited,
        priceUsd,
        valueUsd,
        factorBps: cfg?.ltvBps || 0,
        liqThreshold: cfg?.liqThresholdBps || 0,
        liqPenalty: cfg?.liqPenaltyBps || 0,
      };
    });
  }, [effectiveFeeds, userEscrows, lendingService?.configs]);

  // Only show collateral types that have a config entry in the deployed lending service.
  const supportedCollateralAssets = useMemo<CollateralAsset[]>(() => {
    const configs = lendingService?.configs || {};
    const supported: CollateralAsset[] = [];
    for (const [collateralType, asset] of Object.entries(COLLATERAL_TYPE_TO_ASSET)) {
      if (configs[collateralType]) {
        supported.push(asset);
      }
    }
    return supported.length > 0 ? supported : (Object.keys(COLLATERAL_META) as CollateralAsset[]);
  }, [lendingService?.configs]);

  // Auto-fallback: if selected asset not in supported list, switch to first supported.
  useEffect(() => {
    if (supportedCollateralAssets.length > 0 && !supportedCollateralAssets.includes(collateralAsset)) {
      setCollateralAsset(supportedCollateralAssets[0]);
    }
  }, [supportedCollateralAssets, collateralAsset]);

  const supportedCollateralInfos = useMemo(
    () => collateralInfos.filter((info) => supportedCollateralAssets.includes(info.key)),
    [collateralInfos, supportedCollateralAssets]
  );

  const selectedCollateralInfo = collateralInfos.find((info) => info.key === collateralAsset) || null;
  const selectedAssetContracts = getAssetContracts(collateralAsset, data);
  const selectedAssetAvailable = selectedAssetContracts.reduce(
    (sum, token) => sum + parseFloat(token.amount || "0"),
    0
  );
  const selectedAssetDeposited = selectedCollateralInfo?.deposited || 0;
  const selectedAssetLargestContract = selectedAssetContracts.reduce<SimpleToken | null>((largest, token) => {
    if (!largest) return token;
    return parseFloat(token.amount || "0") > parseFloat(largest.amount || "0") ? token : largest;
  }, null);
  const selectedAssetMaxSingle = selectedAssetLargestContract
    ? parseFloat(selectedAssetLargestContract.amount || "0")
    : 0;
  const selectedAssetMaxInput = selectedAssetLargestContract?.amount || "0";
  const selectedEscrows = userEscrows.filter(
    (escrow) => escrow.collateralType === COLLATERAL_META[collateralAsset].collateralType
  );
  const selectedLargestEscrow = selectedEscrows.reduce<EscrowInfo | null>((largest, escrow) => {
    if (!largest) return escrow;
    return parseFloat(escrow.amount || "0") > parseFloat(largest.amount || "0") ? escrow : largest;
  }, null);
  const selectedEscrowMaxSingle = selectedLargestEscrow
    ? parseFloat(selectedLargestEscrow.amount || "0")
    : 0;
  const selectedEscrowMaxInput = selectedLargestEscrow?.amount || "0";

  useEffect(() => {
    if (action !== "withdraw") return;
    if (userEscrows.length === 0) return;
    const selectedType = COLLATERAL_META[collateralAsset].collateralType;
    const hasSelectedEscrow = userEscrows.some((row) => row.collateralType === selectedType);
    if (hasSelectedEscrow) return;
    const fallbackAsset = userEscrows
      .map((row) => COLLATERAL_TYPE_TO_ASSET[row.collateralType])
      .find((asset): asset is CollateralAsset => Boolean(asset));
    if (fallbackAsset && fallbackAsset !== collateralAsset) {
      setCollateralAsset(fallbackAsset);
    }
  }, [action, collateralAsset, userEscrows]);

  const DEBT_DUST_EPSILON = 0.0001;
  const rawOutstandingDebt = userDebts.reduce(
    (sum, row) => sum + parseFloat(row.debtMusd || "0") + parseFloat(row.interestAccrued || "0"),
    0
  );
  const hasDustDebt = rawOutstandingDebt > 0 && rawOutstandingDebt < DEBT_DUST_EPSILON;
  const outstandingDebt = hasDustDebt ? 0 : rawOutstandingDebt;
  // Use only supported collateral for aggregate valuations (unsupported types have 0 factorBps anyway)
  const totalCollateralUsd = supportedCollateralInfos.reduce((sum, row) => sum + row.valueUsd, 0);
  const borrowCapacityUsd = supportedCollateralInfos.reduce((sum, row) => sum + (row.valueUsd * row.factorBps) / 10000, 0);
  const maxBorrowableUsd = Math.max(borrowCapacityUsd - outstandingDebt, 0);
  const liquidationValueUsd = supportedCollateralInfos.reduce((sum, row) => sum + (row.valueUsd * row.liqThreshold) / 10000, 0);
  const healthFactor = outstandingDebt > 0 ? liquidationValueUsd / outstandingDebt : 99;
  const weightedMaxLtvBps = totalCollateralUsd > 0
    ? supportedCollateralInfos.reduce((sum, row) => sum + (row.valueUsd * row.factorBps), 0) / totalCollateralUsd
    : 0;
  const weightedLiqThresholdBps = totalCollateralUsd > 0
    ? supportedCollateralInfos.reduce((sum, row) => sum + (row.valueUsd * row.liqThreshold), 0) / totalCollateralUsd
    : 0;
  const currentLtvPct = totalCollateralUsd > 0 ? (outstandingDebt / totalCollateralUsd) * 100 : 0;
  const weightedMaxLtvPct = weightedMaxLtvBps / 100;
  const weightedLiqThresholdPct = weightedLiqThresholdBps / 100;
  const ltvGaugePct = weightedLiqThresholdPct > 0
    ? Math.min(100, Math.max(0, (currentLtvPct / weightedLiqThresholdPct) * 100))
    : 0;
  const ltvColorClass =
    currentLtvPct >= weightedLiqThresholdPct && weightedLiqThresholdPct > 0
      ? "text-red-400"
      : currentLtvPct >= weightedMaxLtvPct && weightedMaxLtvPct > 0
      ? "text-yellow-400"
      : "text-emerald-400";
  const ltvGaugeGradient =
    currentLtvPct >= weightedLiqThresholdPct && weightedLiqThresholdPct > 0
      ? "from-red-500 to-red-400"
      : currentLtvPct >= weightedMaxLtvPct && weightedMaxLtvPct > 0
      ? "from-yellow-500 to-yellow-400"
      : "from-emerald-500 to-teal-400";
  const interestRateBps = lendingService?.interestRateBps || 0;
  const isLiquidatable = outstandingDebt > 0 && healthFactor < 1.0;
  const isCritical = outstandingDebt > 0 && healthFactor < 1.2;
  const utilizationPct = borrowCapacityUsd > 0 ? Math.min(100, (outstandingDebt / borrowCapacityUsd) * 100) : 0;
  const hfGaugePct = outstandingDebt > 0 ? Math.min(100, Math.max(0, ((Math.min(healthFactor, 3) - 1) / 2) * 100)) : 100;
  const hfGaugeColor =
    healthFactor < 1.2 ? "from-red-500 to-red-400" : healthFactor < 1.5 ? "from-yellow-500 to-yellow-400" : "from-emerald-500 to-teal-400";

  const parsedAmount = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  function resetStatus() {
    setTxError(null);
    setResult(null);
  }

  async function handleAction() {
    if (!activeParty || !hasConnectedUserParty) {
      setTxError("Connect your Loop wallet first.");
      return;
    }
    if (!lendingService?.contractId) {
      setTxError("Canton lending service is unavailable.");
      return;
    }

    // Fix 3: Block unsupported collateral types before submitting to DAML
    const selectedCollateralType = COLLATERAL_META[collateralAsset].collateralType;
    if (lendingService.configs && !lendingService.configs[selectedCollateralType]) {
      const supported = Object.keys(lendingService.configs).join(", ") || "none";
      setTxError(`Collateral type "${selectedCollateralType}" is not supported by the lending service. Supported: ${supported}.`);
      return;
    }

    setSubmitting(true);
    setTxError(null);
    setResult(null);

    try {
      const fresh = await fetchFreshBalances(activeParty);
      const operatorFresh = await fetchFreshBalances(null).catch(() => null);
      const serviceCid =
        fresh.lendingService?.contractId ||
        operatorFresh?.lendingService?.contractId ||
        lendingService.contractId;

      const freshEscrows = (fresh.escrowPositions || []).filter((row) => row.owner === activeParty);

      let choice = "";
      let argument: Record<string, unknown> = {};

      if (action === "deposit") {
        const available = getAssetContracts(collateralAsset, fresh);
        const selected = pickContractForAmount(available, parsedAmount);
        if (!selected) {
          const maxAvailable = available.reduce((max, token) => Math.max(max, parseFloat(token.amount || "0")), 0);
          throw new Error(
            maxAvailable > 0
              ? `No ${COLLATERAL_META[collateralAsset].symbol} contract large enough. Largest available is ${fmtAmount(maxAvailable)}.`
              : `No ${COLLATERAL_META[collateralAsset].symbol} contracts available to deposit.`
          );
        }

        if (collateralAsset === "CTN") {
          choice = "Lending_DepositCTN";
          argument = { user: activeParty, coinCid: selected.contractId };
        } else if (collateralAsset === "SMUSD") {
          choice = "Lending_DepositSMUSD";
          argument = { user: activeParty, smusdCid: selected.contractId };
        } else {
          choice = "Lending_DepositSMUSDE";
          argument = { user: activeParty, smusdeCid: selected.contractId };
        }
      } else if (action === "borrow") {
        if (parsedAmount <= 0) {
          throw new Error("Enter a valid borrow amount.");
        }
        if (freshEscrows.length === 0) {
          throw new Error("Deposit collateral first.");
        }

        await refreshPriceFeeds();
        const postRefresh = await fetchFreshBalances(activeParty);
        const postRefreshOperator = await fetchFreshBalances(null).catch(() => operatorFresh);
        const postRefreshEscrows = (postRefresh.escrowPositions || []).filter((row) => row.owner === activeParty);
        if (postRefreshEscrows.length === 0) {
          throw new Error("Deposit collateral first.");
        }
        const postRefreshFeeds = mergePriceFeeds(postRefresh, postRefreshOperator);
        const { escrowCids, priceFeedCids } = buildEscrowPriceFeedPairs(postRefreshEscrows, postRefreshFeeds);
        choice = "Lending_Borrow";
        argument = {
          user: activeParty,
          borrowAmount: parsedAmount.toString(),
          escrowCids,
          priceFeedCids,
        };
      } else if (action === "repay") {
        if (parsedAmount <= 0) {
          throw new Error("Enter a valid repay amount.");
        }
        const debtRows = (fresh.debtPositions || []).filter((row) => row.owner === activeParty);
        if (debtRows.length === 0) {
          throw new Error("No debt position found.");
        }

        const selectedDebt = [...debtRows].sort((a, b) => {
          const aTotal = parseFloat(a.debtMusd || "0") + parseFloat(a.interestAccrued || "0");
          const bTotal = parseFloat(b.debtMusd || "0") + parseFloat(b.interestAccrued || "0");
          return bTotal - aTotal;
        })[0];
        const selectedDebtTotal =
          parseFloat(selectedDebt.debtMusd || "0") + parseFloat(selectedDebt.interestAccrued || "0");
        const targetRepayAmount = Math.min(parsedAmount, selectedDebtTotal);
        if (!(targetRepayAmount > 0)) {
          throw new Error("Selected debt is already settled.");
        }

        // Filter to redeemable CantonMUSD only (Lending_Repay requires CantonMUSD CID)
        let repayTokens = (fresh.tokens || []).filter((t) => t.template === "CantonMUSD");
        const redeemableTotal = repayTokens.reduce((s, t) => s + parseFloat(t.amount || "0"), 0);
        const cip56Total = parseFloat(fresh.cip56Balance || "0");
        // Auto-convert CIP-56 if redeemable insufficient
        // (Repay currently requires legacy CantonMUSD CIDs per DAML service typing)
        if (redeemableTotal < targetRepayAmount && cip56Total > 0 && redeemableTotal + cip56Total >= targetRepayAmount) {
          const convertNeeded = targetRepayAmount - redeemableTotal;
          const convResult = await convertCip56ToRedeemable(activeParty, convertNeeded);
          if (!convResult.success) {
            const rawErr = convResult.error || "";
            if (rawErr.includes("Insufficient operator inventory") || rawErr.includes("inventoryAvailable")) {
              const match = rawErr.match(/have ([\d.]+) redeemable, need ([\d.]+)/);
              const available = match ? match[1] : "0";
              throw new Error(`Conversion inventory low: only ${available} redeemable mUSD available. Try a smaller repayment.`);
            }
            if (rawErr.includes("WRONGLY_TYPED_CONTRACT") || rawErr.includes("type mismatch")) {
              throw new Error("Conversion unavailable: operator inventory token mismatch. Contact support.");
            }
            throw new Error(`Auto-conversion failed: ${rawErr}`);
          }
          const refreshed = await fetchFreshBalances(activeParty);
          repayTokens = (refreshed.tokens || []).filter((t) => t.template === "CantonMUSD");
        }
        const selectedMusd = pickContractForAmount(repayTokens, targetRepayAmount);
        if (!selectedMusd) {
          const maxAvailable = repayTokens.reduce((max, token) => Math.max(max, parseFloat(token.amount || "0")), 0);
          throw new Error(
            maxAvailable > 0
              ? `No redeemable mUSD contract large enough. Largest available is ${fmtAmount(maxAvailable)} mUSD.`
              : "No mUSD token available for repayment."
          );
        }

        let repayMusdCid = selectedMusd.contractId;
        let repayMusdAmount = parseFloat(selectedMusd.amount || "0");

        if (repayMusdAmount > targetRepayAmount + 0.000001) {
          const splitResp = await cantonExercise(
            "CantonMUSD",
            selectedMusd.contractId,
            "CantonMUSD_Split",
            { splitAmount: targetRepayAmount.toString() },
            { party: activeParty }
          );
          if (!splitResp.success) {
            throw new Error(splitResp.error || "Failed to split mUSD token for repayment.");
          }

          const afterSplit = await fetchFreshBalances(activeParty);
          const splitTokens = (afterSplit.tokens || []).filter((t) => t.template === "CantonMUSD");
          const exact = splitTokens.find(
            (token) => Math.abs(parseFloat(token.amount || "0") - targetRepayAmount) < 0.000001
          );
          const covering = [...splitTokens]
            .sort((a, b) => parseFloat(a.amount || "0") - parseFloat(b.amount || "0"))
            .find((token) => parseFloat(token.amount || "0") >= targetRepayAmount);
          const selectedAfterSplit = exact || covering;
          if (!selectedAfterSplit) {
            throw new Error("Unable to select split mUSD token for repayment.");
          }

          repayMusdCid = selectedAfterSplit.contractId;
          repayMusdAmount = parseFloat(selectedAfterSplit.amount || "0");
        }

        if (repayMusdAmount > selectedDebtTotal + 0.000001) {
          throw new Error(
            `Repay token amount (${fmtAmount(repayMusdAmount)} mUSD) exceeds debt (${fmtAmount(selectedDebtTotal)} mUSD).`
          );
        }

        choice = "Lending_Repay";
        argument = {
          user: activeParty,
          musdCid: repayMusdCid,
          debtCid: selectedDebt.contractId,
        };
      } else {
        if (parsedAmount <= 0) {
          throw new Error("Enter a valid withdraw amount.");
        }

        await refreshPriceFeeds();
        const postRefresh = await fetchFreshBalances(activeParty);
        const postRefreshOperator = await fetchFreshBalances(null).catch(() => operatorFresh);

        const collateralType = COLLATERAL_META[collateralAsset].collateralType;
        const postRefreshEscrows = (postRefresh.escrowPositions || []).filter((row) => row.owner === activeParty);
        const escrow = pickEscrowForWithdraw(postRefreshEscrows, collateralType, parsedAmount);
        if (!escrow) {
          const sameTypeRows = postRefreshEscrows.filter((row) => row.collateralType === collateralType);
          const maxAvailable = sameTypeRows.reduce((max, row) => Math.max(max, parseFloat(row.amount || "0")), 0);
          const availableTypes = Array.from(
            new Set(
              postRefreshEscrows
                .map((row) => COLLATERAL_TYPE_TO_ASSET[row.collateralType])
                .filter((asset): asset is CollateralAsset => Boolean(asset))
                .map((asset) => COLLATERAL_META[asset].symbol)
            )
          );
          throw new Error(
            maxAvailable > 0
              ? `No ${COLLATERAL_META[collateralAsset].symbol} escrow can cover ${fmtAmount(parsedAmount)}. Largest is ${fmtAmount(maxAvailable)}.`
              : availableTypes.length > 0
                ? `No active ${COLLATERAL_META[collateralAsset].symbol} escrow positions found. Available escrow types: ${availableTypes.join(", ")}.`
                : `No active ${COLLATERAL_META[collateralAsset].symbol} escrow positions found.`
          );
        }

        if (collateralType === "CTN_Coin") {
          choice = "Lending_WithdrawCTN";
        } else if (collateralType === "CTN_SMUSD") {
          choice = "Lending_WithdrawSMUSD";
        } else {
          choice = "Lending_WithdrawSMUSDE";
        }

        const postRefreshFeeds = mergePriceFeeds(postRefresh, postRefreshOperator);
        const otherEscrows = postRefreshEscrows.filter((row) => row.contractId !== escrow.contractId);
        const otherEscrowPairs = buildEscrowPriceFeedPairs(otherEscrows, postRefreshFeeds);
        const expectedWithdrawFeedCid = resolvePriceFeedCidForCollateralType(collateralType, postRefreshFeeds);
        if (!expectedWithdrawFeedCid) {
          throw new Error(`Missing price feed for withdraw collateral type ${collateralType}.`);
        }
        const withdrawPriceFeedCids = Array.from(new Set((postRefreshFeeds || []).map((feed) => feed.contractId)));
        if (!withdrawPriceFeedCids.includes(expectedWithdrawFeedCid)) {
          throw new Error(
            `Missing required ${COLLATERAL_META[collateralAsset].symbol} price feed for withdraw health check.`
          );
        }

        argument = {
          user: activeParty,
          escrowCid: escrow.contractId,
          withdrawAmount: parsedAmount.toString(),
          otherEscrowCids: otherEscrowPairs.escrowCids,
          // DAML withdraw checks fetch prices for both remaining positions and the current collateral symbol.
          priceFeedCids: withdrawPriceFeedCids,
        };
      }

      const resp = await cantonExercise("CantonLendingService", serviceCid, choice, argument, { party: activeParty });
      if (!resp.success) {
        throw new Error(resp.error || "Canton lending action failed");
      }

      setResult(`${action.charAt(0).toUpperCase() + action.slice(1)} submitted on Canton.`);
      setAmount("");
      refresh();
    } catch (err: any) {
      console.error("[CantonBorrow] action failed:", err);
      setTxError(err.message || "Action failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loopWallet.isConnected) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader title="Borrow & Lend" subtitle="Deposit collateral to borrow mUSD with overcollateralization" badge="Borrow" badgeColor="warning" />
        <WalletConnector mode="canton" />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-amber-500/20 border-t-amber-500" />
          <p className="text-gray-400">Loading Canton lending data...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="card-gradient-border max-w-md p-8 text-center">
          <h3 className="mb-2 text-xl font-semibold text-white">Canton Lending Unavailable</h3>
          <p className="mb-4 text-gray-400">{error}</p>
          <button
            onClick={refresh}
            className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-5 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/25"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Borrow & Lend"
        subtitle="Deposit collateral to borrow mUSD with overcollateralization"
        badge={outstandingDebt > 0 ? "Active Position" : "No Position"}
        badgeColor={outstandingDebt > 0 ? "warning" : "brand"}
      />

      {!lendingService && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          Canton lending service is not deployed or not visible to this party.
        </div>
      )}

      {lendingService?.paused && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          Lending service is currently paused.
        </div>
      )}

      {isLiquidatable && (
        <div className="rounded-2xl border-2 border-red-500/60 bg-red-900/20 p-6 backdrop-blur-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 ring-4 ring-red-500/10">
              <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-300">⚠ Position At Risk of Liquidation</h3>
              <p className="mt-1 text-sm text-red-200/80">
                Your health factor has dropped below the liquidation threshold. Add collateral or repay debt immediately.
              </p>
            </div>
          </div>
        </div>
      )}

      {isCritical && !isLiquidatable && (
        <div className="alert-warning flex items-center gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm">
            <span className="font-semibold">Caution:</span> Health factor is low ({healthFactor.toFixed(2)}). Add collateral or repay debt to avoid liquidation.
          </span>
        </div>
      )}

      {hasDustDebt && (
        <div className="rounded-xl border border-gray-500/20 bg-gray-500/5 p-3">
          <p className="text-sm text-gray-400">Dust debt detected ({rawOutstandingDebt.toFixed(10)} mUSD); use repay max to clear.</p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <div className="card-gradient-border overflow-hidden">
            <div className="flex border-b border-white/10">
              {(["deposit", "borrow", "repay", "withdraw"] as const).map((tab) => {
                const tabIcons: Record<ActionTab, JSX.Element> = {
                  deposit: (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                  ),
                  borrow: (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1" />
                    </svg>
                  ),
                  repay: (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  ),
                  withdraw: (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  ),
                };
                return (
                  <button
                    key={tab}
                    className={`relative flex-1 px-4 py-4 text-center text-sm font-semibold transition-all duration-300 ${
                      action === tab ? "text-white" : "text-gray-400 hover:text-white"
                    }`}
                    onClick={() => {
                      setAction(tab);
                      setAmount("");
                      resetStatus();
                    }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2 capitalize">
                      {tabIcons[tab]}
                      {tab}
                    </span>
                    {action === tab && (
                      <span className="absolute bottom-0 left-1/2 h-0.5 w-16 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-500 to-purple-500" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="space-y-6 p-6">
              {(action === "deposit" || action === "withdraw") && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-400">Collateral Token</label>
                  <div className="relative">
                    <select
                      className="input appearance-none pr-10"
                      value={collateralAsset}
                      onChange={(e) => setCollateralAsset(e.target.value as CollateralAsset)}
                    >
                      {supportedCollateralAssets.map((asset) => {
                        const info = collateralInfos.find((row) => row.key === asset);
                        const contractCount = getAssetContracts(asset, data).length;
                        return (
                          <option key={asset} value={asset}>
                            {COLLATERAL_META[asset].symbol}
                            {action === "deposit"
                              ? ` (${contractCount} contract${contractCount === 1 ? "" : "s"} available)`
                              : ` (${fmtAmount(info?.deposited || 0)} deposited)`}
                          </option>
                        );
                      })}
                    </select>
                    <svg className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-400">
                    {action === "deposit"
                      ? "Deposit Amount"
                      : action === "borrow"
                      ? "Borrow Amount (mUSD)"
                      : action === "repay"
                      ? "Repay Amount (mUSD)"
                      : "Withdraw Amount"}
                  </label>
                  {action === "borrow" && (
                    <span className="text-xs text-gray-500">Max: {fmtUSD(maxBorrowableUsd)}</span>
                  )}
                  {action === "repay" && (
                    <span className="text-xs text-gray-500">Debt: {fmtUSD(outstandingDebt)}</span>
                  )}
                  {action === "deposit" && (
                    <span className="text-xs text-gray-500">
                      Available: {fmtAmount(selectedAssetAvailable, 4)} {selectedCollateralInfo?.symbol || COLLATERAL_META[collateralAsset].symbol}
                    </span>
                  )}
                  {action === "withdraw" && (
                    <span className="text-xs text-gray-500">
                      Deposited: {fmtAmount(selectedAssetDeposited, 4)} {selectedCollateralInfo?.symbol || COLLATERAL_META[collateralAsset].symbol}
                    </span>
                  )}
                </div>
                <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-brand-500/50 focus-within:shadow-[0_0_20px_-5px_rgba(51,139,255,0.3)]">
                  <div className="flex items-center gap-4">
                    <input
                      type="number"
                      className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      {action === "borrow" && maxBorrowableUsd > 0 && (
                        <button
                          className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                          onClick={() => setAmount(maxBorrowableUsd.toFixed(4))}
                        >
                          MAX
                        </button>
                      )}
                      {action === "repay" && outstandingDebt > 0 && (
                        <button
                          className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                          onClick={() => setAmount(Math.min(userMusdBalance, outstandingDebt).toFixed(4))}
                        >
                          MAX
                        </button>
                      )}
                      {action === "deposit" && selectedAssetMaxSingle > 0 && (
                        <button
                          className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                          onClick={() => setAmount(selectedAssetMaxInput)}
                        >
                          MAX
                        </button>
                      )}
                      {action === "withdraw" && selectedEscrowMaxSingle > 0 && (
                        <button
                          className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                          onClick={() => setAmount(selectedEscrowMaxInput)}
                        >
                          MAX
                        </button>
                      )}
                      <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                        <div className={`h-6 w-6 rounded-full ${
                          action === "borrow" || action === "repay"
                            ? "bg-gradient-to-br from-brand-500 to-purple-500"
                            : "bg-gradient-to-br from-blue-500 to-cyan-500"
                        }`} />
                        <span className="font-semibold text-white">
                          {action === "borrow" || action === "repay" ? "mUSD" : selectedCollateralInfo?.symbol || "Token"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {action === "deposit" && (
                <p className="text-xs text-gray-500">
                  Contract-based routing is automatic. Enter an amount and the closest matching token contract is selected.
                </p>
              )}

              {action === "withdraw" && (
                <>
                  <SlippageInput value={slippageBps} onChange={setSlippageBps} compact />
                  <p className="text-xs text-gray-500">
                    Escrow routing is automatic. Withdrawals use an active escrow for the selected collateral type.
                  </p>
                </>
              )}

              {action === "repay" && parseFloat(data?.cip56Balance || "0") > 0 && (
                <p className="text-xs text-blue-400">
                  Repay currently requires legacy CantonMUSD. CIP-56 mUSD is auto-converted when needed.
                </p>
              )}

              <TxButton
                onClick={handleAction}
                loading={submitting}
                disabled={!amount || parseFloat(amount) <= 0 || !lendingService || lendingService.paused || !hasConnectedUserParty}
                variant={action === "repay" ? "secondary" : "primary"}
                className="w-full"
              >
                <span className="flex items-center justify-center gap-2">
                  {action === "deposit" && (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                      Deposit Collateral
                    </>
                  )}
                  {action === "borrow" && (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1" />
                      </svg>
                      Borrow mUSD
                    </>
                  )}
                  {action === "repay" && (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Repay Debt
                    </>
                  )}
                  {action === "withdraw" && (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                      Withdraw Collateral
                    </>
                  )}
                </span>
              </TxButton>

              {txError && (
                <div className="alert-error flex items-center gap-3">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm">{txError}</span>
                </div>
              )}
              {result && (
                <div className="alert-success flex items-center gap-3">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm">{result}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Total Collateral"
              value={fmtUSD(totalCollateralUsd)}
              color="blue"
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
            />
            <StatCard
              label="Outstanding Debt"
              value={fmtUSD(outstandingDebt)}
              color={outstandingDebt > 0 ? "red" : "default"}
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
              }
            />
            <StatCard
              label="Available to Borrow"
              value={fmtUSD(maxBorrowableUsd)}
              color="green"
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Interest Rate"
              value={`${fmtBps(interestRateBps)} APR`}
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              }
            />
          </div>

          <div className="card-gradient-border overflow-hidden p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">LTV Health Gauge</p>
                <p className={`text-3xl font-bold ${ltvColorClass}`}>{currentLtvPct.toFixed(2)}%</p>
              </div>
              <div className="text-right text-xs text-gray-400">
                <p>Max Borrow: {weightedMaxLtvPct.toFixed(2)}%</p>
                <p>Liq. Threshold: {weightedLiqThresholdPct.toFixed(2)}%</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="progress">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${ltvGaugeGradient} transition-all duration-1000`}
                  style={{ width: `${ltvGaugePct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span className="text-emerald-400">Safe</span>
                <span className="text-yellow-400">Borrow Limit</span>
                <span className="text-red-400">Liquidation</span>
              </div>
            </div>
          </div>

          {outstandingDebt > 0 && (
            <div className="card-gradient-border overflow-hidden">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      healthFactor < 1.2 ? "bg-red-500/20" : healthFactor < 1.5 ? "bg-yellow-500/20" : "bg-emerald-500/20"
                    }`}>
                      <svg className={`h-5 w-5 ${
                        healthFactor < 1.2 ? "text-red-400" : healthFactor < 1.5 ? "text-yellow-400" : "text-emerald-400"
                      }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Health Factor</p>
                      <p className={`text-3xl font-bold ${
                        healthFactor < 1.2 ? "text-red-400" : healthFactor < 1.5 ? "text-yellow-400" : "text-emerald-400"
                      }`}>
                        {healthFactor > 99 ? "∞" : healthFactor.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="progress">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${hfGaugeColor} transition-all duration-1000`}
                        style={{ width: `${hfGaugePct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span className="text-red-400">Liquidation (1.0)</span>
                      <span>Caution (1.5)</span>
                      <span className="text-emerald-400">Safe (3.0+)</span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-surface-800/50 px-3 py-2 text-sm">
                    <span className="text-gray-400">Status: </span>
                    <span className={`font-semibold ${
                      healthFactor < 1.2 ? "text-red-400" : healthFactor < 1.5 ? "text-yellow-400" : "text-emerald-400"
                    }`}>
                      {healthFactor < 1.0 ? "Liquidatable" : healthFactor < 1.2 ? "Critical" : healthFactor < 1.5 ? "Caution" : "Healthy"}
                    </span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/20">
                      <svg className="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-400">Position Summary</p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Collateral Value</span>
                      <span className="font-medium text-white">{fmtUSD(totalCollateralUsd)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Outstanding Debt</span>
                      <span className="font-medium text-red-400">{fmtUSD(outstandingDebt)}</span>
                    </div>
                    <div className="divider" />
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Net Position</span>
                      <span className="font-medium text-white">{fmtUSD(Math.max(totalCollateralUsd - outstandingDebt, 0))}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Utilization</span>
                      <span className={`font-medium ${utilizationPct > 80 ? "text-red-400" : utilizationPct > 60 ? "text-yellow-400" : "text-emerald-400"}`}>
                        {utilizationPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-surface-800/50 px-4 py-3">
                    <div>
                      <p className="text-xs text-gray-400">Your mUSD</p>
                      <p className="font-semibold text-white">{fmtUSD(userMusdBalance)}</p>
                    </div>
                    <button
                      onClick={() => {
                        setAction("repay");
                        setAmount(Math.min(userMusdBalance, outstandingDebt).toFixed(4));
                        resetStatus();
                      }}
                      disabled={userMusdBalance === 0 || outstandingDebt === 0}
                      className="btn-secondary !py-2 !px-4 text-sm disabled:opacity-50"
                    >
                      Close Position
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/20">
                <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Collateral Positions</h2>
                <p className="text-sm text-gray-400">
                  {supportedCollateralInfos.length} supported token{supportedCollateralInfos.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            {supportedCollateralAssets.length < Object.keys(COLLATERAL_META).length && (
              <p className="mb-3 text-xs text-amber-400/80">
                Current lending service supports: {supportedCollateralAssets.map((a) => COLLATERAL_META[a].symbol).join(", ")} only.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-gray-400">
                    <th className="pb-3 text-left font-medium">Token</th>
                    <th className="pb-3 text-right font-medium">Deposited</th>
                    <th className="pb-3 text-right font-medium">USD Value</th>
                    <th className="pb-3 text-right font-medium">LTV</th>
                    <th className="pb-3 text-right font-medium">Liq. Threshold</th>
                    <th className="pb-3 text-right font-medium">Penalty</th>
                  </tr>
                </thead>
                <tbody>
                  {supportedCollateralInfos.map((collateral) => (
                    <tr key={collateral.key} className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-500 text-xs font-bold text-white">
                            {collateral.symbol[0]}
                          </div>
                          <span className="font-medium text-white">{collateral.symbol}</span>
                        </div>
                      </td>
                      <td className="py-3 text-right text-gray-300">{fmtAmount(collateral.deposited, 4)}</td>
                      <td className="py-3 text-right font-medium text-white">{fmtUSD(collateral.valueUsd)}</td>
                      <td className="py-3 text-right">
                        <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-400">
                          {fmtBps(collateral.factorBps)}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
                          {fmtBps(collateral.liqThreshold)}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                          {fmtBps(collateral.liqPenalty)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/20">
            <svg className="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">How Borrowing Works</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-white/5 bg-surface-800/50 p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-sm font-bold text-blue-400">1</div>
            <h3 className="mb-1 font-medium text-white">Deposit</h3>
            <p className="text-sm text-gray-400">Lock collateral tokens in the lending escrow.</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-surface-800/50 p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-400">2</div>
            <h3 className="mb-1 font-medium text-white">Borrow</h3>
            <p className="text-sm text-gray-400">Borrow mUSD up to your collateral&apos;s LTV ratio.</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-surface-800/50 p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-400">3</div>
            <h3 className="mb-1 font-medium text-white">Repay</h3>
            <p className="text-sm text-gray-400">Return mUSD to reduce debt and improve health.</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-surface-800/50 p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-sm font-bold text-purple-400">4</div>
            <h3 className="mb-1 font-medium text-white">Withdraw</h3>
            <p className="text-sm text-gray-400">Withdraw collateral while keeping the position healthy.</p>
          </div>
        </div>
      </div>

    </div>
  );
}

export default CantonBorrow;

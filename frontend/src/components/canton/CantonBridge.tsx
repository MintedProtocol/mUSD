import React, { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { BLE_BRIDGE_V9_ABI } from "@/abis/BLEBridgeV9";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { useCantonLedger, cantonExercise, fetchFreshBalances, convertCip56ToRedeemable, fetchBridgePreflight, type BridgePreflightData } from "@/hooks/useCantonLedger";
import { useLoopWallet } from "@/hooks/useLoopWallet";
import { CONTRACTS } from "@/lib/config";
import { formatTimestamp, formatUSD } from "@/lib/format";

type TxStatus = "idle" | "bridging" | "success" | "error";
type EthereumBridgeData = {
  attestedAssets: bigint;
  supplyCap: bigint;
  remainingMintable: bigint;
  lastAttestation: bigint;
  paused: boolean;
};

function shortenParty(party?: string | null): string {
  if (!party) return "\u2014";
  return party.length > 36 ? `${party.slice(0, 24)}\u2026${party.slice(-8)}` : party;
}

export function CantonBridge() {
  const loopWallet = useLoopWallet();
  const activeParty = loopWallet.partyId || null;
  const hasConnectedUserParty = Boolean(activeParty && activeParty.trim());

  const { data, loading, error, refresh } = useCantonLedger(15_000, activeParty);

  const [amount, setAmount] = useState("");
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<BridgePreflightData | null>(null);
  const [ethBridge, setEthBridge] = useState<EthereumBridgeData>({
    attestedAssets: 0n,
    supplyCap: 0n,
    remainingMintable: 0n,
    lastAttestation: 0n,
    paused: false,
  });

  const totalMusd = hasConnectedUserParty && data ? parseFloat(data.totalBalance) : 0;
  const redeemableMusd = hasConnectedUserParty && data ? parseFloat(data.redeemableBalance || "0") : 0;
  const cip56Musd = hasConnectedUserParty && data ? parseFloat(data.cip56Balance || "0") : 0;
  const hasOnlyCip56 = totalMusd > 0 && redeemableMusd === 0;

  // Preflight: fetch operator inventory + max bridgeable
  const loadPreflight = useCallback(async () => {
    if (!activeParty) return;
    try {
      const pf = await fetchBridgePreflight(activeParty);
      setPreflight(pf);
    } catch (err) {
      console.warn("[CantonBridge] Preflight fetch failed:", err);
    }
  }, [activeParty]);

  useEffect(() => {
    void loadPreflight();
  }, [loadPreflight]);

  // Derived preflight values
  const maxBridgeable = preflight ? parseFloat(preflight.maxBridgeable) : totalMusd;
  const operatorInventory = preflight ? parseFloat(preflight.operatorInventory) : Infinity;
  const preflightBlockers = preflight?.blockers ?? [];

  const loadEthereumBridgeData = useCallback(async () => {
    if (!CONTRACTS.BLEBridgeV9 || !ethers.isAddress(CONTRACTS.BLEBridgeV9)) {
      return;
    }

    try {
      const rpcUrl =
        process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
        process.env.NEXT_PUBLIC_ETH_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com";
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const bridge = new ethers.Contract(CONTRACTS.BLEBridgeV9, BLE_BRIDGE_V9_ABI, provider);

      const [attestedAssets, supplyCap, remainingMintable, lastAttestation, paused] =
        (await Promise.all([
          bridge.attestedCantonAssets(),
          bridge.getCurrentSupplyCap(),
          bridge.getRemainingMintable(),
          bridge.lastAttestationTime(),
          bridge.paused(),
        ])) as [bigint, bigint, bigint, bigint, boolean];

      setEthBridge({
        attestedAssets,
        supplyCap,
        remainingMintable,
        lastAttestation,
        paused,
      });
    } catch (err) {
      console.error("[CantonBridge] Ethereum bridge metrics load failed:", err);
    }
  }, []);

  useEffect(() => {
    void loadEthereumBridgeData();
    const timer = setInterval(() => {
      void loadEthereumBridgeData();
    }, 15_000);
    return () => clearInterval(timer);
  }, [loadEthereumBridgeData]);

  const parsedAmount = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const hasEnoughRedeemable = parsedAmount > 0 && parsedAmount <= redeemableMusd;
  const needsConversion = parsedAmount > 0 && !hasEnoughRedeemable && parsedAmount <= totalMusd;
  const exceedsMaxBridgeable = parsedAmount > 0 && parsedAmount > maxBridgeable + 0.000001;
  const canRedeem = hasConnectedUserParty && parsedAmount > 0 && !exceedsMaxBridgeable && (hasEnoughRedeemable || needsConversion) && txStatus === "idle";
  const timeSinceAttestation = ethBridge.lastAttestation > 0n
    ? Math.round((Date.now() / 1000) - Number(ethBridge.lastAttestation))
    : 0;
  const attestationAge = ethBridge.lastAttestation === 0n
    ? "Never"
    : timeSinceAttestation < 60
    ? `${timeSinceAttestation}s ago`
    : timeSinceAttestation < 3600
    ? `${Math.round(timeSinceAttestation / 60)}m ago`
    : `${Math.round(timeSinceAttestation / 3600)}h ago`;
  const attestationFresh = ethBridge.lastAttestation > 0n && timeSinceAttestation < 3600;

  async function handleRefresh() {
    refresh();
    await Promise.all([loadEthereumBridgeData(), loadPreflight()]);
  }

  async function handleRedeem() {
    if (!hasConnectedUserParty || !activeParty) {
      setTxError("Connect your Loop wallet first.");
      setTxStatus("error");
      return;
    }

    if (parsedAmount <= 0) {
      setTxError("Enter a valid amount");
      setTxStatus("error");
      return;
    }

    if (!hasEnoughRedeemable && !needsConversion) {
      setTxError("Insufficient mUSD balance");
      setTxStatus("error");
      return;
    }

    setTxStatus("bridging");
    setTxError(null);

    try {
      // Auto-convert CIP-56 → redeemable if user doesn't have enough legacy tokens
      if (needsConversion) {
        const convertNeeded = parsedAmount - redeemableMusd;
        const convResult = await convertCip56ToRedeemable(activeParty, convertNeeded);
        if (!convResult.success) {
          const rawErr = convResult.error || "";
          // Translate inventory/type errors into user-friendly messages
          if (rawErr.includes("Insufficient operator inventory") || rawErr.includes("inventoryAvailable")) {
            const match = rawErr.match(/have ([\d.]+) redeemable, need ([\d.]+)/);
            const available = match ? match[1] : "0";
            const needed = match ? match[2] : convertNeeded.toFixed(2);
            throw new Error(`Conversion inventory low: only ${available} redeemable mUSD available, need ${needed}. Try a smaller amount or wait for inventory replenishment.`);
          }
          if (rawErr.includes("WRONGLY_TYPED_CONTRACT") || rawErr.includes("type mismatch")) {
            throw new Error("Conversion unavailable: operator inventory token mismatch. Contact support or try again later.");
          }
          throw new Error(`Auto-conversion failed: ${rawErr}`);
        }
      }

      const fresh = await fetchFreshBalances(activeParty);
      const freshTokens = (fresh.tokens || []).filter((t: any) => t.template === "CantonMUSD");
      const operatorSnapshot = await fetchFreshBalances(null);
      const directMintService = fresh.directMintService || operatorSnapshot.directMintService;

      if (freshTokens.length === 0) {
        throw new Error(
          fresh.tokens?.length
            ? "No redeemable CantonMUSD tokens. Your balance is CIP-56 mUSD which cannot be redeemed through DirectMint yet."
            : "No CantonMUSD tokens available"
        );
      }

      if (!directMintService) {
        setTxError("DirectMint service is not initialized on the Canton ledger. Contact the protocol operator to deploy CantonDirectMintService.");
        setTxStatus("error");
        return;
      }

      let selectedToken = freshTokens.find((t: any) => parseFloat(t.amount) >= parsedAmount);

      // Auto-consolidate fragmented redeemable tokens via CantonMUSD_Merge.
      // If no single token covers the amount but aggregate does, repeatedly
      // merge the two largest until one token is big enough (max 10 rounds).
      if (!selectedToken) {
        const totalRedeemable = freshTokens.reduce((s: number, t: any) => s + parseFloat(t.amount), 0);
        if (totalRedeemable < parsedAmount - 0.000001) {
          throw new Error(`Insufficient redeemable mUSD: have ${totalRedeemable.toFixed(2)}, need ${parsedAmount.toFixed(2)}`);
        }

        const MAX_MERGE_ROUNDS = 10;
        let mergeTokens = [...freshTokens];

        for (let round = 0; round < MAX_MERGE_ROUNDS; round++) {
          // Sort descending by amount
          mergeTokens.sort((a: any, b: any) => parseFloat(b.amount) - parseFloat(a.amount));

          // Check if largest now covers the request
          if (parseFloat(mergeTokens[0].amount) >= parsedAmount - 0.000001) {
            selectedToken = mergeTokens[0];
            break;
          }

          // Need at least 2 tokens to merge
          if (mergeTokens.length < 2) break;

          const primary = mergeTokens[0];
          const secondary = mergeTokens[1];

          const mergeResp = await cantonExercise(
            "CantonMUSD",
            primary.contractId,
            "CantonMUSD_Merge",
            { otherCid: secondary.contractId },
            activeParty
          );

          if (!mergeResp.success) {
            console.warn(`[CantonBridge] Merge round ${round + 1} failed:`, mergeResp.error);
            break;
          }

          // Re-fetch to get updated CIDs after merge
          const refreshed = await fetchFreshBalances(activeParty);
          mergeTokens = (refreshed.tokens || []).filter((t: any) => t.template === "CantonMUSD");

          if (mergeTokens.length === 0) break;
        }

        // Final check after consolidation
        if (!selectedToken) {
          selectedToken = mergeTokens
            .sort((a: any, b: any) => parseFloat(b.amount) - parseFloat(a.amount))
            .find((t: any) => parseFloat(t.amount) >= parsedAmount - 0.000001);
        }

        if (!selectedToken) {
          const largest = mergeTokens.length > 0
            ? Math.max(...mergeTokens.map((t: any) => parseFloat(t.amount)))
            : 0;
          throw new Error(
            `Auto-consolidation could not produce a token covering ${parsedAmount.toFixed(2)} mUSD after ${MAX_MERGE_ROUNDS} merge rounds. Largest: ${largest.toFixed(2)} mUSD.`
          );
        }
      }

      let cidToRedeem = selectedToken.contractId;
      const tokenAmount = parseFloat(selectedToken.amount);

      if (tokenAmount > parsedAmount + 0.001) {
        const splitResp = await cantonExercise(
          "CantonMUSD",
          selectedToken.contractId,
          "CantonMUSD_Split",
          { splitAmount: parsedAmount.toString() },
          activeParty
        );

        if (!splitResp.success) {
          throw new Error(splitResp.error || "Failed to split token");
        }

        const afterSplit = await fetchFreshBalances(activeParty);
        const afterSplitMusd = (afterSplit.tokens || []).filter((t: any) => t.template === "CantonMUSD");
        const exactToken = afterSplitMusd.find(
          (t: any) => Math.abs(parseFloat(t.amount) - parsedAmount) < 0.01
        );

        if (exactToken) {
          cidToRedeem = exactToken.contractId;
        }
      }

      const redeemResp = await cantonExercise(
        "CantonDirectMintService",
        directMintService.contractId,
        "DirectMint_Redeem",
        {
          user: activeParty,
          musdCid: cidToRedeem,
        },
        activeParty
      );

      if (!redeemResp.success) {
        throw new Error(redeemResp.error || "Redemption failed");
      }

      setTxStatus("success");
      setAmount("");
      setTimeout(() => {
        void handleRefresh();
        setTxStatus("idle");
      }, 4000);
    } catch (err: any) {
      console.error("[CantonBridge] Redeem failed:", err);
      setTxError(err.message || "Redemption failed");
      setTxStatus("error");
    }
  }

  function handleReset() {
    setTxStatus("idle");
    setTxError(null);
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-purple-500/20 border-t-purple-500" />
          <p className="text-gray-400">Loading Canton bridge data\u2026</p>
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
          <button onClick={() => void handleRefresh()} className="rounded-xl bg-purple-600 px-6 py-2 font-medium text-white hover:bg-purple-500">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Canton Bridge"
        subtitle="Real-time view of Canton Network attestations governing mUSD supply cap on Ethereum"
        badge={ethBridge.paused ? "PAUSED" : "Active"}
        badgeColor={ethBridge.paused ? "warning" : "emerald"}
        action={
          <button
            onClick={() => void handleRefresh()}
            className="flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-400 hover:bg-purple-500/20"
          >
            <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        }
      />

      {ethBridge.paused && (
        <div className="alert-error flex items-center gap-3">
          <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium">Bridge is currently paused. Attestation submissions and minting are disabled.</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Attested Canton Assets"
          value={formatUSD(ethBridge.attestedAssets)}
          color="blue"
          variant="glow"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          }
        />
        <StatCard
          label="Current Supply Cap"
          value={formatUSD(ethBridge.supplyCap)}
          color="purple"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
        <StatCard
          label="Remaining Mintable"
          value={formatUSD(ethBridge.remainingMintable)}
          color="green"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Last Attestation"
          value={attestationAge}
          color={attestationFresh ? "green" : "yellow"}
          subValue={ethBridge.lastAttestation > 0n ? formatTimestamp(Number(ethBridge.lastAttestation)) : "Never"}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      <div className="card-gradient-border overflow-hidden">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Bridge to Ethereum</h2>
            <p className="text-sm text-gray-400">Burn mUSD on Canton \u2192 Mint on Ethereum</p>
          </div>
        </div>

        <div className="mb-6">
          {hasConnectedUserParty ? (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-medium text-emerald-300">Loop Wallet Connected</span>
                </div>
                <span className="text-xs font-mono text-gray-500">{shortenParty(activeParty)}</span>
              </div>
            </div>
          ) : (
            <button
              onClick={loopWallet.connect}
              disabled={loopWallet.isConnecting}
              className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50"
            >
              {loopWallet.isConnecting ? "Connecting\u2026" : "Connect Loop Wallet"}
            </button>
          )}

          {loopWallet.error && (
            <p className="mt-2 text-xs text-red-300">{loopWallet.error}</p>
          )}
        </div>

        {hasConnectedUserParty && totalMusd > 0 && (
          <div className="mb-4 rounded-xl bg-surface-800/50 border border-white/5 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">Total mUSD Balance</span>
              <span className="text-sm font-semibold text-white">{totalMusd.toLocaleString(undefined, { maximumFractionDigits: 2 })} mUSD</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Redeemable (CantonMUSD)</span>
              <span className={`text-xs font-medium ${redeemableMusd > 0 ? "text-emerald-400" : "text-gray-500"}`}>
                {redeemableMusd.toLocaleString(undefined, { maximumFractionDigits: 2 })} mUSD
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">CIP-56 (auto-convertible)</span>
              <span className="text-xs font-medium text-blue-400">
                {cip56Musd.toLocaleString(undefined, { maximumFractionDigits: 2 })} mUSD
              </span>
            </div>
            {preflight && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Max bridgeable now</span>
                <span className={`text-xs font-semibold ${maxBridgeable > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {maxBridgeable.toLocaleString(undefined, { maximumFractionDigits: 2 })} mUSD
                </span>
              </div>
            )}
            {preflight && operatorInventory < Infinity && cip56Musd > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Operator conversion inventory</span>
                <span className={`text-xs font-medium ${operatorInventory > 0 ? "text-yellow-400" : "text-red-400"}`}>
                  {operatorInventory.toLocaleString(undefined, { maximumFractionDigits: 2 })} mUSD
                </span>
              </div>
            )}
            {cip56Musd > 0 && (
              <div className="mt-2 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2">
                <p className="text-xs text-blue-300">
                  CIP-56 is your primary mUSD balance. Redeem currently requires legacy CantonMUSD and auto-converts from CIP-56 when needed.
                </p>
              </div>
            )}
            {preflightBlockers.includes("NO_OPERATOR_INVENTORY") && (
              <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                <p className="text-xs text-red-300">
                  Operator conversion inventory is empty. Only existing redeemable CantonMUSD can be bridged. CIP-56 tokens cannot be converted until inventory is replenished.
                </p>
              </div>
            )}
            {preflightBlockers.includes("LOW_OPERATOR_INVENTORY") && !preflightBlockers.includes("NO_OPERATOR_INVENTORY") && (
              <div className="mt-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2">
                <p className="text-xs text-yellow-300">
                  Operator conversion inventory ({operatorInventory.toFixed(2)} mUSD) is lower than your CIP-56 balance. Max bridgeable is capped at {maxBridgeable.toFixed(2)} mUSD.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-300">Amount (mUSD)</label>
              <button
                onClick={() => setAmount(Math.min(totalMusd, maxBridgeable).toFixed(6))}
                disabled={totalMusd === 0}
                className="text-xs text-brand-400 hover:text-brand-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Max: {Math.min(totalMusd, maxBridgeable).toLocaleString(undefined, { maximumFractionDigits: 2 })} mUSD
              </button>
            </div>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || /^\d*\.?\d*$/.test(val)) {
                    setAmount(val);
                  }
                }}
                placeholder="0.00"
                disabled={!hasConnectedUserParty || txStatus === "bridging"}
                className="w-full rounded-xl bg-surface-800 border border-white/10 px-4 py-3.5 text-lg font-medium text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 transition-colors"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">mUSD</span>
            </div>

            {parsedAmount > 0 && parsedAmount > totalMusd && (
              <p className="mt-1 text-xs text-red-400">Insufficient mUSD balance</p>
            )}
            {exceedsMaxBridgeable && parsedAmount <= totalMusd && (
              <p className="mt-1 text-xs text-red-400">
                Exceeds max bridgeable ({maxBridgeable.toFixed(2)} mUSD). Operator conversion inventory limits how much CIP-56 can be converted.
              </p>
            )}
            {needsConversion && !exceedsMaxBridgeable && (
              <p className="mt-1 text-xs text-blue-400">CIP-56 tokens will be auto-converted to redeemable CantonMUSD</p>
            )}
          </div>

          <div className="flex items-center justify-center gap-4 py-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface-800/50 border border-white/5 px-3 py-2">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-gray-400">Canton</span>
            </div>
            <svg className="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <div className="flex items-center gap-2 rounded-lg bg-surface-800/50 border border-white/5 px-3 py-2">
              <div className="h-3 w-3 rounded-full bg-blue-400" />
              <span className="text-xs font-medium text-gray-400">Ethereum</span>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleRedeem}
              disabled={!canRedeem}
              className="w-full rounded-xl bg-gradient-to-r from-brand-500 to-purple-500 px-6 py-3.5 font-semibold text-white transition-all hover:from-brand-400 hover:to-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {txStatus === "bridging" ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Submitting\u2026
                </span>
              ) : !hasConnectedUserParty ? (
                "Connect Loop Wallet First"
              ) : parsedAmount <= 0 ? (
                "Enter Amount"
              ) : parsedAmount > totalMusd ? (
                "Insufficient Balance"
              ) : exceedsMaxBridgeable ? (
                `Exceeds Max Bridgeable (${maxBridgeable.toFixed(2)})`
              ) : needsConversion ? (
                `Convert & Bridge ${amount} mUSD to Ethereum`
              ) : (
                `Bridge ${amount} mUSD to Ethereum`
              )}
            </button>
          </div>

          {txStatus === "success" && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-300">Redemption Submitted</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Your Canton redemption request was created. The relay will settle it by minting mUSD on Ethereum.
                  </p>
                </div>
                <button onClick={handleReset} className="text-gray-500 hover:text-white transition-colors">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {txStatus === "error" && txError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-300">Transaction Failed</p>
                  <p className="text-xs text-gray-400 mt-1 break-all">{txError}</p>
                </div>
                <button onClick={handleReset} className="text-gray-500 hover:text-white transition-colors">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-surface-800/50 border border-white/5 p-4 space-y-2">
            <p className="text-xs font-medium text-gray-400">How it works</p>
            <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
              <li>Your CantonMUSD is consumed by DirectMint_Redeem on Canton</li>
              <li>A RedemptionRequest is created on the Canton ledger</li>
              <li>The relay detects the request and mints mUSD on Ethereum</li>
              <li>Typical completion time: 10\u201390 seconds</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

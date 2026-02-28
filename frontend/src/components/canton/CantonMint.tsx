import React, { useState } from "react";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { useLoopWallet } from "@/hooks/useLoopWallet";
import {
  useCantonLedger,
  cantonExercise,
  fetchFreshBalances,
  SimpleToken,
  CantonMUSDToken,
} from "@/hooks/useCantonLedger";
import WalletConnector from "@/components/WalletConnector";

type CantonMintAsset = "USDC" | "USDCX" | "CANTON_COIN";

export function CantonMint() {
  const loopWallet = useLoopWallet();
  const activeParty = loopWallet.partyId || null;
  const { data: canonicalData, refresh: refreshCanonical } = useCantonLedger(15_000, activeParty);

  const [tab, setTab] = useState<"mint" | "redeem">("mint");
  const [mintAsset, setMintAsset] = useState<CantonMintAsset>("USDC");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derive service + token data from canonical API (single source of truth)
  const directMintService = canonicalData?.directMintService ?? null;
  const coinMintService = canonicalData?.coinMintService ?? null;
  const pureUsdcTokens = (canonicalData?.usdcTokens ?? []).filter(t => t.template !== "USDCx");
  const usdcxTokens = (canonicalData?.usdcTokens ?? []).filter(t => t.template === "USDCx");
  const redeemableTokens = (canonicalData?.tokens ?? []).filter(t => t.template === "CantonMUSD");
  const coinTokens = canonicalData?.cantonCoinTokens ?? [];

  // Canonical display balances
  const totalUsdc = canonicalData ? parseFloat(canonicalData.usdcBalance || "0") : 0;
  const totalUsdcx = canonicalData ? parseFloat(canonicalData.usdcxBalance || "0") : 0;
  const totalMusd = canonicalData ? parseFloat(canonicalData.totalBalance || "0") : 0;
  const totalCantonCoin = canonicalData ? parseFloat(canonicalData.totalCoin || "0") : 0;

  function pickTokenForAmount(tokens: (SimpleToken | CantonMUSDToken)[], requestedAmount: number): string {
    const eligible = tokens
      .map(t => ({ contractId: t.contractId, amount: parseFloat(t.amount || "0") }))
      .filter(e => Number.isFinite(e.amount) && e.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    if (eligible.length === 0) return "";
    const match = eligible.find(e => e.amount >= requestedAmount);
    return match ? match.contractId : "";
  }

  async function exerciseWithFallback(
    templateId: string,
    contractId: string,
    choice: string,
    argsCandidates: Array<Record<string, unknown>>
  ): Promise<void> {
    let lastError: string | undefined;
    for (const args of argsCandidates) {
      const res = await cantonExercise(templateId, contractId, choice, args, activeParty);
      if (res.success) return;
      lastError = res.error;
    }
    throw new Error(lastError || `Failed to exercise ${choice}`);
  }

  async function handleMint() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const parsed = parseFloat(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Enter a valid amount");
      }

      // Fetch fresh balances to get current CIDs (avoid stale state)
      const fresh = await fetchFreshBalances(activeParty);
      const freshService = fresh.directMintService;

      if (mintAsset === "USDC") {
        if (!freshService) throw new Error("Direct mint service not found on Canton");
        const freshUsdc = (fresh.usdcTokens ?? []).filter(t => t.template !== "USDCx");
        const cid = pickTokenForAmount(freshUsdc, parsed);
        if (!cid) throw new Error("No single USDC token has enough balance for this amount");

        await exerciseWithFallback(
          "CantonDirectMintService",
          freshService.contractId,
          "DirectMint_Mint",
          [
            { usdcCid: cid, amount },
            { user: activeParty, usdcCid: cid },
            { usdcCid: cid },
          ]
        );
      } else if (mintAsset === "USDCX") {
        if (!freshService) throw new Error("Direct mint service not found on Canton");
        const freshUsdcx = (fresh.usdcTokens ?? []).filter(t => t.template === "USDCx");
        const cid = pickTokenForAmount(freshUsdcx, parsed);
        if (!cid) throw new Error("No single USDCx token has enough balance for this amount");

        await exerciseWithFallback(
          "CantonDirectMintService",
          freshService.contractId,
          "DirectMint_MintWithUSDCx",
          [
            { usdcxCid: cid, amount },
            { user: activeParty, usdcxCid: cid },
            { usdcxCid: cid },
          ]
        );
      } else {
        // CantonCoin mint path
        const freshCoin = fresh.cantonCoinTokens ?? [];
        const coinCid = pickTokenForAmount(freshCoin, parsed);
        if (!coinCid) throw new Error("No single CantonCoin token has enough balance for this amount");

        const freshCoinService = fresh.coinMintService;
        if (!freshCoinService) throw new Error("CantonCoin minting service is not configured on this network");

        // CoinMintService requires operator-owned USDCx as bridge backing
        const operatorData = await fetchFreshBalances(null);
        const operatorUsdcx = (operatorData.usdcTokens ?? []).find(t => t.template === "USDCx");
        if (!operatorUsdcx) throw new Error("Operator USDCx backing is not visible for CantonCoin minting");

        const coinResult = await cantonExercise(
          "CoinMintService",
          freshCoinService.contractId,
          "MintMusdWithCoin",
          { user: activeParty, coinCid, operatorUsdcxCid: operatorUsdcx.contractId },
          activeParty
        );
        if (!coinResult.success) throw new Error(coinResult.error || "CoinMint exercise failed");
      }

      setResult(`Minted ${amount} mUSD on Canton`);
      setAmount("");
      await refreshCanonical();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRedeem() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const parsed = parseFloat(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Enter a valid amount");
      }

      const fresh = await fetchFreshBalances(activeParty);
      const freshService = fresh.directMintService;
      if (!freshService) throw new Error("Direct mint service not found on Canton");

      const freshMusd = (fresh.tokens ?? []).filter(t => t.template === "CantonMUSD");
      const musdCid = pickTokenForAmount(freshMusd, parsed);
      if (!musdCid) throw new Error("No single mUSD token has enough balance for this amount");

      await exerciseWithFallback(
        "CantonDirectMintService",
        freshService.contractId,
        "DirectMint_Redeem",
        [
          { musdCid, amount },
          { user: activeParty, musdCid },
          { musdCid },
        ]
      );

      setResult(`Redeemed ${amount} mUSD for USDC on Canton`);
      setAmount("");
      await refreshCanonical();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const currentMintBalance =
    mintAsset === "USDC" ? totalUsdc : mintAsset === "USDCX" ? totalUsdcx : totalCantonCoin;
  const currentMintAssetLabel =
    mintAsset === "USDC" ? "USDC" : mintAsset === "USDCX" ? "USDCx" : "CantonCoin";
  const mintInputUnavailable =
    mintAsset === "USDC"
      ? pureUsdcTokens.length === 0 || !directMintService
      : mintAsset === "USDCX"
        ? usdcxTokens.length === 0 || !directMintService
        : coinTokens.length === 0 || !coinMintService;

  if (!loopWallet.isConnected) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="max-w-md space-y-6">
          <div className="card-emerald p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
              <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <h3 className="mb-2 text-xl font-semibold text-white">Connect to Canton</h3>
            <p className="text-gray-400 mb-6">Connect your Loop Wallet to mint or redeem mUSD on the Canton Network.</p>
          </div>
          <WalletConnector mode="canton" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="Mint & Redeem"
        subtitle="Mint with USDC, USDCx, or CantonCoin and redeem mUSD on Canton"
        badge="Canton"
        badgeColor="emerald"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Your USDC"
          value={totalUsdc.toFixed(2)}
          color="blue"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Your USDCx"
          value={totalUsdcx.toFixed(2)}
          color="purple"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h10M7 16h6" />
            </svg>
          }
        />
        <StatCard
          label="Your CantonCoin"
          value={totalCantonCoin.toFixed(2)}
          color="yellow"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4l7 4v8l-7 4-7-4V8l7-4z" />
            </svg>
          }
        />
        <StatCard
          label="Your mUSD"
          value={totalMusd.toFixed(2)}
          color="green"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          }
        />
      </div>

      <div className="card-emerald overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-emerald-500/20">
          <button
            className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all duration-300 ${
              tab === "mint"
                ? "text-emerald-400"
                : "text-gray-400 hover:text-white"
            }`}
            onClick={() => { setTab("mint"); setAmount(""); }}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              Mint mUSD
            </span>
            {tab === "mint" && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
            )}
          </button>
          <button
            className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all duration-300 ${
              tab === "redeem"
                ? "text-emerald-400"
                : "text-gray-400 hover:text-white"
            }`}
            onClick={() => { setTab("redeem"); setAmount(""); }}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Redeem USDC
            </span>
            {tab === "redeem" && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
            )}
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Amount Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="label">Amount</label>
              <span className="text-xs text-gray-500">
                Balance: {(tab === "mint" ? currentMintBalance : totalMusd).toFixed(2)} {tab === "mint" ? currentMintAssetLabel : "mUSD"}
              </span>
            </div>
            {tab === "mint" && (
              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase tracking-wider text-gray-500">Mint Asset</label>
                <select
                  className="input"
                  value={mintAsset}
                  onChange={(e) => setMintAsset(e.target.value as CantonMintAsset)}
                >
                  <option value="USDC">USDC</option>
                  <option value="USDCX">USDCx</option>
                  <option value="CANTON_COIN">Canton Coin</option>
                </select>
              </div>
            )}
            <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-emerald-500/50 focus-within:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)]">
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button
                  className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/30"
                  onClick={() => setAmount((tab === "mint" ? currentMintBalance : totalMusd).toString())}
                >
                  MAX
                </button>
                <span className="font-semibold text-white">{tab === "mint" ? currentMintAssetLabel : "mUSD"}</span>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="space-y-2 rounded-xl bg-surface-800/30 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Mint Service</span>
              <span className="font-mono text-xs text-emerald-400">
                {directMintService
                  ? `${directMintService.contractId.slice(0, 24)}...`
                  : (canonicalData ? "No service found" : "Loading...")}
              </span>
            </div>
            <div className="divider my-2" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Pattern</span>
              <span className="text-gray-300">
                {tab === "mint"
                  ? "1:1 USDC → mUSD (Daml Ledger)"
                  : "Burn mUSD → RedemptionRequest (Canton USDC payout)"}
              </span>
            </div>
            <div className="divider my-2" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Token Selection</span>
              <span className="text-gray-300">
                Auto-select from {tab === "mint"
                  ? (mintAsset === "USDC" ? pureUsdcTokens.length : mintAsset === "USDCX" ? usdcxTokens.length : coinTokens.length)
                  : redeemableTokens.length} visible contracts
              </span>
            </div>
            {tab === "mint" && mintAsset === "CANTON_COIN" && !coinMintService && (
              <>
                <div className="divider my-2" />
                <p className="text-xs text-amber-300">
                  CantonCoin minting requires an active `CoinMintService` on this Canton network.
                </p>
              </>
            )}
            {tab === "redeem" && (
              <>
                <div className="divider my-2" />
                <p className="text-xs text-amber-300">
                  This action creates a Canton redemption request. It does not send funds directly to an Ethereum wallet.
                </p>
              </>
            )}
          </div>

          {/* Action Button */}
          <button
            onClick={tab === "mint" ? handleMint : handleRedeem}
            disabled={loading || !amount || parseFloat(amount) <= 0 || (tab === "mint" && mintInputUnavailable)}
            className="btn-success w-full flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing on Canton...
              </>
            ) : (
              <>
                {tab === "mint" ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {tab === "mint"
                  ? `Mint mUSD with ${currentMintAssetLabel}`
                  : "Redeem USDC"}
              </>
            )}
          </button>

          {tab === "mint" && mintInputUnavailable && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
              {mintAsset === "USDC"
                ? (directMintService ? "No Canton USDC contracts found for this wallet." : "Direct mint service not found. Service may be initializing.")
                : mintAsset === "USDCX"
                  ? (directMintService ? "No USDCx contracts found for this wallet." : "Direct mint service not found. Service may be initializing.")
                  : "CantonCoin mint requires both CoinMintService and visible operator USDCx backing."}
            </div>
          )}

          {/* Status Messages */}
          {error && (
            <div className="alert-error flex items-center gap-3">
              <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm">{error}</span>
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
  );
}

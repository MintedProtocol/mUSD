import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { TxButton } from "@/components/TxButton";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { useTx } from "@/hooks/useTx";
import { formatToken } from "@/lib/format";
import { CONTRACTS, MUSD_DECIMALS, USDC_DECIMALS } from "@/lib/config";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import WalletConnector from "@/components/WalletConnector";
import { SlippageInput } from "@/components/SlippageInput";
import { ClearTestnetBalances } from "@/components/ClearTestnetBalances";

// ─── Constants ──────────────────────────────────────────────────────────────
// smUSD has _decimalsOffset(3) in its ERC-4626 vault, so ERC20 decimals = 18 + 3 = 21
const SMUSD_DECIMALS = 21;

// ─── Types ──────────────────────────────────────────────────────────────────
type PoolTab = "smusd" | "ethpool";
type StakeAction = "stake" | "unstake";
type DepositAsset = "ETH" | "USDC" | "USDT";
type LockTier = 0 | 1 | 2 | 3;

interface StakePosition {
  depositAsset: string;
  depositAmount: bigint;
  musdMinted: bigint;
  smUsdEShares: bigint;
  tier: number;
  stakedAt: bigint;
  unlockAt: bigint;
  active: boolean;
}

const TIER_LABELS: Record<LockTier, string> = {
  0: "No Lock (1.0\u00d7)",
  1: "30 Days (1.25\u00d7)",
  2: "90 Days (1.5\u00d7)",
  3: "180 Days (2.0\u00d7)",
};

const POOL_TAB_CONFIG = [
  { key: "smusd" as PoolTab, label: "smUSD", badge: "ERC-4626", color: "from-emerald-500 to-teal-500" },
  { key: "ethpool" as PoolTab, label: "ETH Pool", badge: "smUSD-E", color: "from-blue-500 to-indigo-500" },
];

// ─── Component ──────────────────────────────────────────────────────────────
export function StakePage() {
  const { address, isConnected, provider } = useUnifiedWallet();
  const contracts = useWCContracts();
  const tx = useTx();
  const [slippageBps, setSlippageBps] = useState(50);

  // Current timestamp (client-only to avoid hydration mismatch)
  const [nowSeconds, setNowSeconds] = useState(0);
  useEffect(() => { setNowSeconds(Math.floor(Date.now() / 1000)); }, []);

  // Shared state
  const [pool, setPool] = useState<PoolTab>("smusd");
  const [tab, setTab] = useState<StakeAction>("stake");
  const [amount, setAmount] = useState("");

  // smUSD vault state
  const [smusdStats, setSmusdStats] = useState({
    musdBal: 0n, smusdBal: 0n, totalAssets: 0n, totalSupply: 0n,
    canWithdraw: false, cooldownRemaining: 0n, previewDeposit: 0n, previewRedeem: 0n,
  });

  // ETH Pool state
  const [ethPoolStats, setEthPoolStats] = useState({
    sharePrice: 0n, totalETH: 0n, totalStable: 0n, totalMUSD: 0n,
    totalShares: 0n, poolCap: 0n, smUsdEBal: 0n, ethBal: 0n, usdcBal: 0n, usdtBal: 0n,
  });
  const [depositAsset, setDepositAsset] = useState<DepositAsset>("ETH");
  const [lockTier, setLockTier] = useState<LockTier>(0);
  const [positions, setPositions] = useState<(StakePosition & { id: number })[]>([]);
  const [unstakeId, setUnstakeId] = useState<number | null>(null);

  const { musd, smusd, ethPool, smusde, usdc, usdt } = contracts;

  // ═══════════════════════════════════════════════════════════════════════════
  //  smUSD Vault Data
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (pool !== "smusd") return;
    async function load() {
      if (!smusd || !musd || !address) return;
      const [musdBal, smusdBal, totalAssets, totalSupply, canWithdraw, cooldownRemaining] =
        await Promise.all([
          musd.balanceOf(address), smusd.balanceOf(address),
          smusd.totalAssets(), smusd.totalSupply(),
          smusd.canWithdraw(address), smusd.getRemainingCooldown(address),
        ]);
      setSmusdStats(s => ({ ...s, musdBal, smusdBal, totalAssets, totalSupply, canWithdraw, cooldownRemaining }));
    }
    load();
  }, [musd, smusd, address, pool, tx.success]);

  useEffect(() => {
    if (pool !== "smusd") return;
    async function loadPreview() {
      if (!smusd || !amount || parseFloat(amount) <= 0) {
        setSmusdStats(s => ({ ...s, previewDeposit: 0n, previewRedeem: 0n }));
        return;
      }
      try {
        const parsed = ethers.parseUnits(amount, tab === "stake" ? MUSD_DECIMALS : SMUSD_DECIMALS);
        if (tab === "stake") {
          const shares = await smusd.previewDeposit(parsed);
          setSmusdStats(s => ({ ...s, previewDeposit: shares }));
        } else {
          const assets = await smusd.previewRedeem(parsed);
          setSmusdStats(s => ({ ...s, previewRedeem: assets }));
        }
      } catch { /* ignore preview errors */ }
    }
    const timer = setTimeout(loadPreview, 300);
    return () => clearTimeout(timer);
  }, [smusd, amount, tab, pool]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  ETH Pool Data
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (pool !== "ethpool") return;
    async function load() {
      if (!ethPool || !smusde || !address) return;
      try {
        const [sharePrice, totalETH, totalStable, totalMUSD, totalShares, poolCap, smUsdEBal] =
          await Promise.all([
            ethPool.sharePrice(), ethPool.totalETHDeposited(), ethPool.totalStablecoinDeposited(),
            ethPool.totalMUSDMinted(), ethPool.totalSMUSDEIssued(), ethPool.poolCap(),
            smusde.balanceOf(address),
          ]);
        const ethBal = provider ? await provider.getBalance(address) : 0n;
        const usdcBal = usdc ? await usdc.balanceOf(address) : 0n;
        const usdtBal = usdt ? await usdt.balanceOf(address) : 0n;
        setEthPoolStats({ sharePrice, totalETH, totalStable, totalMUSD, totalShares, poolCap, smUsdEBal, ethBal, usdcBal, usdtBal });
      } catch (err) { console.error("ETH Pool load error:", err); }
    }
    load();
  }, [ethPool, smusde, usdc, usdt, address, provider, pool, tx.success]);

  useEffect(() => {
    if (pool !== "ethpool") return;
    async function loadPositions() {
      if (!ethPool || !address) return;
      try {
        const count = await ethPool.getPositionCount(address);
        const loaded: (StakePosition & { id: number })[] = [];
        for (let i = 0; i < Number(count); i++) {
          const pos = await ethPool.getPosition(address, i);
          if (pos.active) {
            loaded.push({
              id: i, depositAsset: pos.depositAsset, depositAmount: pos.depositAmount,
              musdMinted: pos.musdMinted, smUsdEShares: pos.smUsdEShares,
              tier: Number(pos.tier), stakedAt: pos.stakedAt, unlockAt: pos.unlockAt, active: pos.active,
            });
          }
        }
        setPositions(loaded);
      } catch (err) { console.error("Load positions error:", err); }
    }
    loadPositions();
  }, [ethPool, address, pool, tx.success]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  Handlers: smUSD
  // ═══════════════════════════════════════════════════════════════════════════
  async function handleSmusdStake() {
    if (!smusd || !musd || !address) return;
    const parsed = ethers.parseUnits(amount, MUSD_DECIMALS);
    await tx.send(async () => {
      const allowance = await musd.allowance(address, CONTRACTS.SMUSD);
      if (allowance < parsed) { const a = await musd.approve(CONTRACTS.SMUSD, parsed); await a.wait(); }
      return smusd.deposit(parsed, address);
    });
    setAmount("");
  }

  async function handleSmusdUnstake() {
    if (!smusd || !address) return;
    const parsed = ethers.parseUnits(amount, SMUSD_DECIMALS);
    await tx.send(() => smusd.redeem(parsed, address, address));
    setAmount("");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Handlers: ETH Pool
  // ═══════════════════════════════════════════════════════════════════════════
  async function handleEthPoolStake() {
    if (!ethPool || !address) return;
    if (depositAsset === "ETH") {
      const parsed = ethers.parseEther(amount);
      await tx.send(() => ethPool.stake(lockTier, { value: parsed }));
    } else {
      const tokenAddr = depositAsset === "USDC" ? CONTRACTS.USDC : CONTRACTS.USDT;
      const tokenContract = depositAsset === "USDC" ? usdc : usdt;
      if (!tokenContract) return;
      const parsed = ethers.parseUnits(amount, USDC_DECIMALS);
      await tx.send(async () => {
        const allowance = await tokenContract.allowance(address, CONTRACTS.ETHPool);
        if (allowance < parsed) { const a = await tokenContract.approve(CONTRACTS.ETHPool, parsed); await a.wait(); }
        return ethPool.stakeWithToken(tokenAddr, parsed, lockTier);
      });
    }
    setAmount("");
  }

  async function handleEthPoolUnstake() {
    if (!ethPool || unstakeId === null) return;
    await tx.send(() => ethPool.unstake(unstakeId));
    setUnstakeId(null);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Derived values
  //  NOTE: SMUSD.sol has _decimalsOffset() = 3, meaning smUSD shares have
  //  3 extra decimal places (21 effective vs 18 for mUSD). We must multiply
  //  totalAssets by 10^3 when computing per-share values to compensate.
  // ═══════════════════════════════════════════════════════════════════════════
  const SMUSD_OFFSET = 1000n; // 10^_decimalsOffset() = 10^3
  const smusdExchangeRate = smusdStats.totalSupply > 0n
    ? (Number(smusdStats.totalAssets * SMUSD_OFFSET) / Number(smusdStats.totalSupply)).toFixed(4) : "1.0000";
  const smusdSharePrice = smusdStats.totalSupply > 0n
    ? Number(smusdStats.totalAssets * SMUSD_OFFSET) / Number(smusdStats.totalSupply) : 1;
  const smusdApy = Math.max(0, (smusdSharePrice - 1) * 100);
  const smusdPositionValue = smusdStats.smusdBal > 0n && smusdStats.totalSupply > 0n
    ? (smusdStats.smusdBal * smusdStats.totalAssets) / smusdStats.totalSupply : 0n;
  // Yield = positionValue - (smusdBal adjusted back to mUSD decimals)
  const smusdBalAsMuSD = smusdStats.smusdBal / SMUSD_OFFSET;
  const smusdYieldEarned = smusdPositionValue > smusdBalAsMuSD ? smusdPositionValue - smusdBalAsMuSD : 0n;
  const cooldownSeconds = Number(smusdStats.cooldownRemaining);
  const cooldownHours = cooldownSeconds / 3600;
  const cooldownPct = Math.max(0, Math.min(100, ((86400 - cooldownSeconds) / 86400) * 100));

  const ethPoolSharePriceFmt = ethPoolStats.sharePrice > 0n
    ? (Number(ethPoolStats.sharePrice) / 1e18).toFixed(4) : "1.0000";
  const ethPoolTVL = ethPoolStats.totalMUSD;
  const ethPoolUtil = ethPoolStats.poolCap > 0n
    ? Number((ethPoolStats.totalMUSD * 10000n) / ethPoolStats.poolCap) / 100 : 0;
  const depositBalance = depositAsset === "ETH" ? ethPoolStats.ethBal
    : depositAsset === "USDC" ? ethPoolStats.usdcBal : ethPoolStats.usdtBal;
  const depositDecimals = depositAsset === "ETH" ? 18 : USDC_DECIMALS;

  // ═══════════════════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isConnected) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader title="Stake & Earn" subtitle="Earn yield by staking into mUSD vaults" badge="Staking" badgeColor="emerald" />
        <WalletConnector mode="ethereum" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Stake & Earn"
        subtitle="Earn yield by staking into mUSD vaults — choose your pool"
        badge="Staking"
        badgeColor="emerald"
      />

      {/* Testnet Reset */}
      <ClearTestnetBalances address={address ?? null} musd={musd} smusd={smusd} />

      {/* Pool Selector */}
      <div className="flex gap-2 rounded-xl bg-surface-800/50 p-1.5 border border-white/10">
        {POOL_TAB_CONFIG.map(({ key, label, badge, color }) => (
          <button
            key={key}
            onClick={() => { setPool(key); setTab("stake"); setAmount(""); }}
            className={`relative flex-1 rounded-lg px-4 py-3 text-sm font-semibold transition-all duration-300 ${
              pool === key
                ? "bg-surface-700 text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-surface-700/50"
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              {label}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                pool === key
                  ? `bg-gradient-to-r ${color} text-white`
                  : "bg-surface-600 text-gray-500"
              }`}>{badge}</span>
            </span>
            {pool === key && (
              <span className={`absolute bottom-0 left-1/2 h-0.5 w-16 -translate-x-1/2 rounded-full bg-gradient-to-r ${color}`} />
            )}
          </button>
        ))}
      </div>

      {/* ═══════════ smUSD POOL ═══════════ */}
      {pool === "smusd" && (
        <>
          {/* Two-column layout: Action left, Stats right */}
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Left column: Stake/Unstake Card */}
            <div>
              <div className="card-gradient-border overflow-hidden">
                <div className="flex border-b border-white/10">
                  <button
                    className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all duration-300 ${tab === "stake" ? "text-white" : "text-gray-400 hover:text-white"}`}
                    onClick={() => { setTab("stake"); setAmount(""); }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                      Stake mUSD
                    </span>
                    {tab === "stake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />}
                  </button>
                  <button
                    className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all duration-300 ${tab === "unstake" ? "text-white" : "text-gray-400 hover:text-white"}`}
                    onClick={() => { setTab("unstake"); setAmount(""); }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      Unstake smUSD
                    </span>
                    {tab === "unstake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />}
                  </button>
                </div>

                <div className="space-y-6 p-6">
                  {/* Input */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-400">{tab === "stake" ? "You Stake" : "You Unstake"}</label>
                      <span className="text-xs text-gray-500">Balance: {formatToken(tab === "stake" ? smusdStats.musdBal : smusdStats.smusdBal, tab === "stake" ? MUSD_DECIMALS : SMUSD_DECIMALS)}</span>
                    </div>
                    <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-emerald-500/50 focus-within:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)]">
                      <div className="flex items-center gap-4">
                        <input
                          type="number"
                          className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                          placeholder="0.00"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/30"
                            onClick={() => setAmount(ethers.formatUnits(tab === "stake" ? smusdStats.musdBal : smusdStats.smusdBal, tab === "stake" ? MUSD_DECIMALS : SMUSD_DECIMALS))}
                          >MAX</button>
                          <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                            <div className={`h-6 w-6 rounded-full ${tab === "stake" ? "bg-gradient-to-br from-brand-500 to-purple-500" : "bg-gradient-to-br from-emerald-500 to-teal-500"}`} />
                            <span className="font-semibold text-white">{tab === "stake" ? "mUSD" : "smUSD"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-surface-800">
                      <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                    </div>
                  </div>

                  {/* Output */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-400">You Receive</label>
                    <div className="rounded-xl border border-white/10 bg-surface-800/30 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-2xl font-semibold text-white">
                          {amount && parseFloat(amount) > 0
                            ? (tab === "stake" ? formatToken(smusdStats.previewDeposit, SMUSD_DECIMALS) : formatToken(smusdStats.previewRedeem))
                            : "0.00"}
                        </span>
                        <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                          <div className={`h-6 w-6 rounded-full ${tab === "stake" ? "bg-gradient-to-br from-emerald-500 to-teal-500" : "bg-gradient-to-br from-brand-500 to-purple-500"}`} />
                          <span className="font-semibold text-white">{tab === "stake" ? "smUSD" : "mUSD"}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Exchange Info */}
                  {amount && parseFloat(amount) > 0 && (
                    <div className="space-y-2 rounded-xl bg-surface-800/30 p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Exchange Rate</span>
                        <span className="font-medium text-white">1 smUSD = {smusdExchangeRate} mUSD</span>
                      </div>
                      <div className="divider my-2" />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Cooldown Period</span>
                        <span className="text-gray-300">24 hours</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Withdrawal Fee</span>
                        <span className="text-emerald-400 font-medium">None</span>
                      </div>
                    </div>
                  )}

                  {/* Cooldown Warning */}
                  {tab === "unstake" && !smusdStats.canWithdraw && smusdStats.cooldownRemaining > 0n && (
                    <div className="alert-warning flex items-center gap-3">
                      <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm">Cooldown active — {cooldownHours.toFixed(1)}h remaining before you can withdraw.</span>
                    </div>
                  )}

                  {/* Slippage Tolerance (unstake tab) */}
                  {tab === "unstake" && (
                    <SlippageInput value={slippageBps} onChange={setSlippageBps} compact />
                  )}

                  {/* Action Button */}
                  <TxButton
                    onClick={tab === "stake" ? handleSmusdStake : handleSmusdUnstake}
                    loading={tx.loading}
                    disabled={!amount || parseFloat(amount) <= 0 || (tab === "unstake" && !smusdStats.canWithdraw)}
                    className="w-full"
                  >
                    <span className="flex items-center justify-center gap-2">
                      {tab === "stake" ? (
                        <>
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                          Stake mUSD
                        </>
                      ) : (
                        <>
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          {smusdStats.canWithdraw ? "Unstake smUSD" : "Cooldown Active"}
                        </>
                      )}
                    </span>
                  </TxButton>

                  {/* Tx Status */}
                  {tx.error && (
                    <div className="alert-error flex items-center gap-3">
                      <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span className="text-sm">{tx.error}</span>
                    </div>
                  )}
                  {tx.success && (
                    <div className="alert-success flex items-center gap-3">
                      <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span className="text-sm">Transaction confirmed!{" "}
                        {tx.hash && <a href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="underline">View on Etherscan</a>}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right column: Stats & Position */}
            <div className="space-y-4">
              {/* Yield Overview */}
              <div className="grid gap-4 grid-cols-2">
                <StatCard
                  label="Share Price"
                  value={`${smusdExchangeRate} mUSD`}
                  subValue="per smUSD"
                  color="green"
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
                />
                <StatCard
                  label="Estimated APY"
                  value={`${smusdApy.toFixed(2)}%`}
                  color="green"
                  trend={smusdApy > 0 ? "up" : "neutral"}
                  trendValue={smusdApy > 0 ? "Earning" : "Base"}
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                />
                <StatCard
                  label="Your mUSD Balance"
                  value={formatToken(smusdStats.musdBal)}
                  color="blue"
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                />
                <StatCard
                  label="Your smUSD Balance"
                  value={formatToken(smusdStats.smusdBal, SMUSD_DECIMALS)}
                  color="purple"
                  subValue={smusdStats.smusdBal > 0n ? `≈ ${formatToken(smusdPositionValue)} mUSD` : undefined}
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>}
                />
              </div>

              {/* Position Card */}
              {smusdStats.smusdBal > 0n && (
                <div className="card-gradient-border overflow-hidden">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500">
                      <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Your Position</h2>
                      <p className="text-sm text-gray-400">Staking performance overview</p>
                    </div>
                  </div>
                  <div className="grid gap-4 grid-cols-3">
                    <div className="space-y-1">
                      <p className="text-sm text-gray-400">smUSD Balance</p>
                      <p className="text-xl font-bold text-white">{formatToken(smusdStats.smusdBal, SMUSD_DECIMALS)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-400">Position Value</p>
                      <p className="text-xl font-bold text-emerald-400">{formatToken(smusdPositionValue)} mUSD</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-400">Yield Earned</p>
                      <p className="text-xl font-bold text-green-400">+{formatToken(smusdYieldEarned)} mUSD</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Cooldown Timer */}
              {smusdStats.smusdBal > 0n && !smusdStats.canWithdraw && smusdStats.cooldownRemaining > 0n && (
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-500/20">
                        <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-white">Withdrawal Cooldown</p>
                        <p className="text-sm text-gray-400">
                          {cooldownHours >= 1
                            ? `${cooldownHours.toFixed(1)} hours remaining`
                            : `${Math.ceil(cooldownSeconds / 60)} minutes remaining`}
                        </p>
                      </div>
                    </div>
                    <span className="badge-warning">{Math.round(cooldownPct)}% Complete</span>
                  </div>
                  <div className="progress">
                    <div className="progress-bar-emerald h-full rounded-full transition-all duration-1000" style={{ width: `${cooldownPct}%` }} />
                  </div>
                </div>
              )}

              {/* Protocol Stats (collapsed) */}
              {smusdStats.smusdBal > 0n && (
                <div className="grid gap-4 grid-cols-2">
                  <StatCard
                    label="Protocol TVL"
                    value={formatToken(smusdStats.totalAssets) + " mUSD"}
                    color="blue"
                    icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>}
                  />
                  <StatCard
                    label="Protocol smUSD Supply"
                    value={formatToken(smusdStats.totalSupply, SMUSD_DECIMALS)}
                    color="purple"
                    icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>}
                  />
                </div>
              )}
            </div>
          </div>

          {/* How Staking Works */}
          <div className="card">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/20">
                <svg className="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h2 className="text-lg font-semibold text-white">How Staking Works</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-brand-400 font-bold text-sm mb-3">1</div>
                <h3 className="font-medium text-white mb-1">Deposit mUSD</h3>
                <p className="text-sm text-gray-400">Stake your mUSD tokens into the ERC-4626 vault to begin earning yield.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-sm mb-3">2</div>
                <h3 className="font-medium text-white mb-1">Earn Yield</h3>
                <p className="text-sm text-gray-400">The smUSD share price increases as protocol revenue accrues to the vault.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 font-bold text-sm mb-3">3</div>
                <h3 className="font-medium text-white mb-1">Withdraw Anytime</h3>
                <p className="text-sm text-gray-400">Redeem smUSD for mUSD at the current share price after a 24h cooldown.</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════════ ETH POOL ═══════════ */}
      {pool === "ethpool" && (
        <>
          {/* Two-column layout: Action left, Stats right */}
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Left column: Deposit / Unstake Card */}
            <div>
              <div className="card-gradient-border overflow-hidden">
                <div className="flex border-b border-white/10">
                  <button
                    className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all duration-300 ${tab === "stake" ? "text-white" : "text-gray-400 hover:text-white"}`}
                    onClick={() => { setTab("stake"); setAmount(""); }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                      Deposit
                    </span>
                    {tab === "stake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" />}
                  </button>
                  <button
                    className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all duration-300 ${tab === "unstake" ? "text-white" : "text-gray-400 hover:text-white"}`}
                    onClick={() => { setTab("unstake"); setAmount(""); }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      Unstake
                    </span>
                    {tab === "unstake" && <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" />}
                  </button>
                </div>

                <div className="space-y-6 p-6">
                  {tab === "stake" ? (
                    <>
                      {/* Asset Selector */}
                      <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-400">Deposit Asset</label>
                        <div className="grid grid-cols-3 gap-2">
                          {(["ETH", "USDC", "USDT"] as DepositAsset[]).map(asset => (
                            <button
                              key={asset}
                              onClick={() => { setDepositAsset(asset); setAmount(""); }}
                              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                                depositAsset === asset
                                  ? "border-blue-500 bg-blue-500/20 text-white"
                                  : "border-white/10 bg-surface-800/50 text-gray-400 hover:border-white/30 hover:text-white"
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <div className={`h-5 w-5 rounded-full ${
                                  asset === "ETH" ? "bg-gradient-to-br from-blue-400 to-purple-500"
                                  : asset === "USDC" ? "bg-gradient-to-br from-blue-400 to-blue-600"
                                  : "bg-gradient-to-br from-green-400 to-green-600"
                                }`} />
                                {asset}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Lock Tier */}
                      <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-400">Time-Lock Boost</label>
                        <div className="grid grid-cols-2 gap-2">
                          {([0, 1, 2, 3] as LockTier[]).map(tier => (
                            <button
                              key={tier}
                              onClick={() => setLockTier(tier)}
                              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                                lockTier === tier
                                  ? "border-blue-500 bg-blue-500/20 text-white"
                                  : "border-white/10 bg-surface-800/50 text-gray-400 hover:border-white/30 hover:text-white"
                              }`}
                            >
                              {TIER_LABELS[tier]}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Amount Input */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-gray-400">Amount</label>
                          <span className="text-xs text-gray-500">Balance: {ethers.formatUnits(depositBalance, depositDecimals)} {depositAsset}</span>
                        </div>
                        <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-blue-500/50 focus-within:shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)]">
                          <div className="flex items-center gap-4">
                            <input
                              type="number"
                              className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                              placeholder="0.00"
                              value={amount}
                              onChange={e => setAmount(e.target.value)}
                            />
                            <div className="flex items-center gap-2">
                              <button
                                className="rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-400 transition-colors hover:bg-blue-500/30"
                                onClick={() => setAmount(ethers.formatUnits(depositBalance, depositDecimals))}
                              >MAX</button>
                              <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                                <div className={`h-6 w-6 rounded-full ${
                                  depositAsset === "ETH" ? "bg-gradient-to-br from-blue-400 to-purple-500"
                                  : depositAsset === "USDC" ? "bg-gradient-to-br from-blue-400 to-blue-600"
                                  : "bg-gradient-to-br from-green-400 to-green-600"
                                }`} />
                                <span className="font-semibold text-white">{depositAsset}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex justify-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-surface-800">
                          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                        </div>
                      </div>

                      {/* Output */}
                      <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-400">You Receive</label>
                        <div className="rounded-xl border border-white/10 bg-surface-800/30 p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-2xl font-semibold text-white">smUSD-E</span>
                            <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                              <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500" />
                              <span className="font-semibold text-white">smUSD-E</span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Shares calculated at current price ({ethPoolSharePriceFmt} mUSD/share) with {TIER_LABELS[lockTier]} boost
                          </p>
                        </div>
                      </div>

                      {/* Deposit Button */}
                      <TxButton
                        onClick={handleEthPoolStake}
                        loading={tx.loading}
                        disabled={!amount || parseFloat(amount) <= 0 || !ethPool}
                        className="w-full"
                      >
                        <span className="flex items-center justify-center gap-2">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          Deposit {depositAsset} → smUSD-E
                        </span>
                      </TxButton>
                    </>
                  ) : (
                    <>
                      {/* Unstake: position-based */}
                      {positions.length === 0 ? (
                        <div className="text-center py-12">
                          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-surface-700/50 mb-4">
                            <svg className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                            </svg>
                          </div>
                          <p className="text-gray-400 font-medium">No active positions</p>
                          <p className="text-sm text-gray-500 mt-1">Switch to Deposit tab to create a staking position</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
                            ETH Pool is position-based. Each deposit creates its own position, so unstaking is done per position.
                          </div>
                          <label className="text-sm font-medium text-gray-400">Select Position to Unstake</label>
                          {positions.map(pos => {
                            const isETH = pos.depositAsset === ethers.ZeroAddress;
                            const assetLabel = isETH ? "ETH" : "Stablecoin";
                            const lockRemaining = pos.unlockAt > 0n ? Math.max(0, Number(pos.unlockAt) - nowSeconds) : 0;
                            const isLocked = lockRemaining > 0;
                            const daysLeft = Math.ceil(lockRemaining / 86400);
                            return (
                              <button
                                key={pos.id}
                                onClick={() => setUnstakeId(pos.id)}
                                className={`w-full rounded-xl border p-4 text-left transition-all duration-200 ${
                                  unstakeId === pos.id
                                    ? "border-blue-500 bg-blue-500/10"
                                    : "border-white/10 bg-surface-800/50 hover:border-white/30"
                                }`}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-white">Position #{pos.id}</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                      isLocked ? "bg-yellow-500/20 text-yellow-400" : "bg-emerald-500/20 text-emerald-400"
                                    }`}>
                                      {isLocked ? `${daysLeft}d locked` : "Unlocked"}
                                    </span>
                                  </div>
                                  <span className="text-sm text-gray-400">{TIER_LABELS[pos.tier as LockTier]}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <p className="text-gray-500">Deposited</p>
                                    <p className="text-white font-medium">
                                      {isETH
                                        ? ethers.formatEther(pos.depositAmount) + " ETH"
                                        : ethers.formatUnits(pos.depositAmount, USDC_DECIMALS) + " " + assetLabel}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-gray-500">mUSD Minted</p>
                                    <p className="text-white font-medium">{formatToken(pos.musdMinted)}</p>
                                  </div>
                                  <div>
                                    <p className="text-gray-500">smUSD-E Shares</p>
                                    <p className="text-white font-medium">{formatToken(pos.smUsdEShares)}</p>
                                  </div>
                                </div>
                              </button>
                            );
                          })}

                          {/* Unstake Button */}
                          <TxButton
                            onClick={handleEthPoolUnstake}
                            loading={tx.loading}
                            disabled={unstakeId === null}
                            className="w-full"
                          >
                            <span className="flex items-center justify-center gap-2">
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              {unstakeId !== null ? `Unstake Position #${unstakeId}` : "Select a Position"}
                            </span>
                          </TxButton>
                        </div>
                      )}
                    </>
                  )}

                  {/* Tx Status */}
                  {tx.error && (
                    <div className="alert-error flex items-center gap-3">
                      <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span className="text-sm">{tx.error}</span>
                    </div>
                  )}
                  {tx.success && (
                    <div className="alert-success flex items-center gap-3">
                      <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span className="text-sm">Transaction confirmed!{" "}
                        {tx.hash && <a href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="underline">View on Etherscan</a>}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right column: Pool Stats & Info */}
            <div className="space-y-4">
              {/* Pool Stats */}
              <div className="grid gap-4 grid-cols-2">
                <StatCard
                  label="smUSD-E Price"
                  value={`${ethPoolSharePriceFmt} mUSD`}
                  subValue="per smUSD-E"
                  color="blue"
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
                />
                <StatCard
                  label="Pool TVL"
                  value={formatToken(ethPoolTVL) + " mUSD"}
                  color="green"
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>}
                />
                <StatCard
                  label="Pool Utilization"
                  value={`${ethPoolUtil.toFixed(1)}%`}
                  color="yellow"
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
                />
                <StatCard
                  label="Your smUSD-E"
                  value={formatToken(ethPoolStats.smUsdEBal)}
                  color="purple"
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>}
                />
              </div>

              {/* Info Banner */}
              <div className="card overflow-hidden border-l-4 border-blue-500">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/20 flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">ETH Pool — Fluid Strategy Yield</h3>
                    <p className="text-sm text-gray-400">
                      Deposit ETH, USDC, or USDT into the ETH Pool. Your deposit mints mUSD and you receive smUSD-E shares
                      with optional time-lock boost multipliers (up to 2×). Yield is generated via Fluid leveraged loop strategies.
                    </p>
                    <p className="text-sm text-blue-400 mt-2 font-medium">
                      ✦ smUSD-E can be used as collateral for lending &amp; borrowing in the same pools as smUSD
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* How ETH Pool Works */}
          <div className="card">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/20">
                <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <h2 className="text-lg font-semibold text-white">How ETH Pool Works</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm mb-3">1</div>
                <h3 className="font-medium text-white mb-1">Deposit Assets</h3>
                <p className="text-sm text-gray-400">Deposit ETH, USDC, or USDT. Your deposit is converted to mUSD at oracle price.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 font-bold text-sm mb-3">2</div>
                <h3 className="font-medium text-white mb-1">Receive smUSD-E</h3>
                <p className="text-sm text-gray-400">Get smUSD-E shares with optional time-lock multipliers (1.0×–2.0×).</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-sm mb-3">3</div>
                <h3 className="font-medium text-white mb-1">Earn Yield</h3>
                <p className="text-sm text-gray-400">Pool capital is deployed to Fluid leveraged loop strategies for ETH-denominated yield.</p>
              </div>
              <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 font-bold text-sm mb-3">4</div>
                <h3 className="font-medium text-white mb-1">Lend &amp; Borrow</h3>
                <p className="text-sm text-gray-400">Use smUSD-E as collateral in the same lending pools as smUSD.</p>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

export default StakePage;

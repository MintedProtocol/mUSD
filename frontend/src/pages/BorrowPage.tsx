import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { TxButton } from "@/components/TxButton";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { useTx } from "@/hooks/useTx";
import { formatToken, formatUSD, formatBps, formatHealthFactor } from "@/lib/format";
import { CONTRACTS, MUSD_DECIMALS } from "@/lib/config";
import { ERC20_ABI } from "@/abis/ERC20";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import WalletConnector from "@/components/WalletConnector";
import { SlippageInput } from "@/components/SlippageInput";

interface CollateralInfo {
  token: string;
  symbol: string;
  decimals: number;
  walletBalance: bigint;
  deposited: bigint;
  price: bigint;
  valueUsd: bigint;
  factorBps: bigint;
  liqThreshold: bigint;
  liqPenalty: bigint;
  usedFallbackPrice: boolean;
}

type TabType = "deposit" | "borrow" | "repay" | "withdraw";

export function BorrowPage() {
  const { address, signer, isConnected } = useUnifiedWallet();
  const contracts = useWCContracts();
  const [action, setAction] = useState<TabType>("deposit");
  const [selectedToken, setSelectedToken] = useState("");
  const [amount, setAmount] = useState("");
  const [collaterals, setCollaterals] = useState<CollateralInfo[]>([]);
  const [debt, setDebt] = useState(0n);
  const [healthFactor, setHealthFactor] = useState(0n);
  const [maxBorrowable, setMaxBorrowable] = useState(0n);
  const [interestRate, setInterestRate] = useState(0n);
  const [isLiquidatable, setIsLiquidatable] = useState(false);
  const [musdBalance, setMusdBalance] = useState(0n);
  const [oracleDegraded, setOracleDegraded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const tx = useTx();
  const [slippageBps, setSlippageBps] = useState(50);

  const { vault, borrow, oracle, musd, liquidation } = contracts;

  useEffect(() => {
    async function load() {
      if (!vault || !oracle || !borrow || !address || !signer) return;
      try {
        const tokens: string[] = await vault.getSupportedTokens();
        const infos: CollateralInfo[] = [];

        for (const token of tokens) {
          const erc20 = new ethers.Contract(token, ERC20_ABI, signer);
          const [symbol, dec, dep, bal, prc, config] = await Promise.all([
            erc20.symbol(),
            erc20.decimals(),
            vault.getDeposit(address, token),
            erc20.balanceOf(address),
            oracle.getPrice(token).catch(() => 0n),
            vault.getConfig(token),
          ]);
          const decimals = Number(dec);
          const deposited = BigInt(dep);
          const walletBalance = BigInt(bal);
          const price = BigInt(prc);
          const valueUsd = deposited > 0n && price > 0n
            ? (deposited * price) / (10n ** BigInt(decimals))
            : 0n;
          infos.push({
            token,
            symbol,
            decimals,
            walletBalance,
            deposited,
            price,
            valueUsd,
            usedFallbackPrice: false,
            // getConfig returns (enabled, factorBps, liqThreshold, liqPenalty)
            // Previously mapped [0]→factor, [1]→threshold, [2]→penalty (off-by-one, skipping enabled)
            factorBps: config[1],
            liqThreshold: config[2],
            liqPenalty: config[3],
          });
        }
        setCollaterals(infos);
        if (tokens.length > 0 && !selectedToken) setSelectedToken(tokens[0]);

        const [d, hf, mb, ir, bal] = await Promise.all([
          borrow.totalDebt(address),
          borrow.healthFactor(address).catch(() => ethers.MaxUint256),
          borrow.maxBorrow(address).catch(() => 0n),
          borrow.interestRateBps(),
          musd?.balanceOf(address) ?? 0n,
        ]);
        setDebt(d);
        setHealthFactor(hf);
        setMaxBorrowable(mb);
        setInterestRate(ir);
        setMusdBalance(bal);

        // Check liquidation status
        if (liquidation) {
          const liq = await liquidation.isLiquidatable(address).catch(() => false);
          setIsLiquidatable(liq);
        }
      } catch (err) {
        console.error("Borrow load error:", err);
      }
    }
    load();
  }, [vault, oracle, borrow, musd, liquidation, address, signer, tx.success, reloadKey]);

  async function handleDeposit() {
    if (!vault || !signer || !selectedToken) return;
    const info = collaterals.find((c) => c.token === selectedToken);
    if (!info) return;
    const parsed = ethers.parseUnits(amount, info.decimals);
    await tx.send(async () => {
      const erc20 = new ethers.Contract(selectedToken, ERC20_ABI, signer);
      const allowance = await erc20.allowance(address, CONTRACTS.CollateralVault);
      if (allowance < parsed) {
        const approveTx = await erc20.approve(CONTRACTS.CollateralVault, parsed);
        await approveTx.wait();
      }
      return vault.deposit(selectedToken, parsed);
    });
    setAmount("");
  }

  async function handleBorrow() {
    if (!borrow) return;
    const parsed = ethers.parseUnits(amount, MUSD_DECIMALS);
    await tx.send(() => borrow.borrow(parsed));
    setAmount("");
  }

  async function handleRepay() {
    if (!borrow || !musd || !address) return;
    const parsed = ethers.parseUnits(amount, MUSD_DECIMALS);
    await tx.send(async () => {
      const allowance = await musd.allowance(address, CONTRACTS.BorrowModule);
      if (allowance < parsed) {
        const approveTx = await musd.approve(CONTRACTS.BorrowModule, parsed);
        await approveTx.wait();
      }
      return borrow.repay(parsed);
    });
    setAmount("");
  }

  async function handleRepayMax() {
    if (!borrow || !musd || !address || debt === 0n) return;
    const repayAmount = musdBalance < debt ? musdBalance : debt;
    if (repayAmount === 0n) return;

    await tx.send(async () => {
      const allowance = await musd.allowance(address, CONTRACTS.BorrowModule);
      if (allowance < repayAmount) {
        const approveTx = await musd.approve(CONTRACTS.BorrowModule, repayAmount);
        await approveTx.wait();
      }
      return borrow.repay(repayAmount);
    });
  }

  async function handleWithdraw() {
    if (!borrow || !selectedToken) return;
    const info = collaterals.find((c) => c.token === selectedToken);
    if (!info) return;
    const parsed = ethers.parseUnits(amount, info.decimals);
    await tx.send(() => borrow.withdrawCollateral(selectedToken, parsed));
    setAmount("");
  }

  // Health factor thresholds
  const hfValue = Number(ethers.formatUnits(healthFactor, 18));
  const hfColor = hfValue < 1.0 ? "red" : hfValue < 1.2 ? "red" : hfValue < 1.5 ? "yellow" : "green";
  const isAtRisk = hfValue < 1.5 && debt > 0n;
  const isCritical = hfValue < 1.2 && debt > 0n;

  // Total collateral value
  const totalCollateralUsd = collaterals.reduce((sum, c) => sum + c.valueUsd, 0n);

  // Utilization percentage (debt / max borrowable capacity)
  const utilizationPct = totalCollateralUsd > 0n && debt > 0n
    ? Math.min(100, Number((debt * 10000n) / totalCollateralUsd) / 100)
    : 0;

  // Weighted LTV thresholds across deposited collateral
  const weightedMaxLtvBps = totalCollateralUsd > 0n
    ? collaterals.reduce((sum, c) => sum + (c.valueUsd * c.factorBps), 0n) / totalCollateralUsd
    : 0n;
  const weightedLiqThresholdBps = totalCollateralUsd > 0n
    ? collaterals.reduce((sum, c) => sum + (c.valueUsd * c.liqThreshold), 0n) / totalCollateralUsd
    : 0n;
  const currentLtvBps = totalCollateralUsd > 0n && debt > 0n
    ? (debt * 10000n) / totalCollateralUsd
    : 0n;
  const currentLtvPct = Number(currentLtvBps) / 100;
  const weightedMaxLtvPct = Number(weightedMaxLtvBps) / 100;
  const weightedLiqThresholdPct = Number(weightedLiqThresholdBps) / 100;
  const ltvGaugePct = weightedLiqThresholdBps > 0n
    ? Math.min(100, Math.max(0, Number((currentLtvBps * 10000n) / weightedLiqThresholdBps) / 100))
    : 0;
  const ltvColorClass =
    currentLtvBps >= weightedLiqThresholdBps && weightedLiqThresholdBps > 0n
      ? "text-red-400"
      : currentLtvBps >= weightedMaxLtvBps && weightedMaxLtvBps > 0n
      ? "text-yellow-400"
      : "text-emerald-400";
  const ltvGaugeGradient =
    currentLtvBps >= weightedLiqThresholdBps && weightedLiqThresholdBps > 0n
      ? "from-red-500 to-red-400"
      : currentLtvBps >= weightedMaxLtvBps && weightedMaxLtvBps > 0n
      ? "from-yellow-500 to-yellow-400"
      : "from-emerald-500 to-teal-400";

  // Testnet faucet: mint test collateral tokens (MockERC20 has public mint)
  const [faucetLoading, setFaucetLoading] = useState(false);
  async function handleFaucetMint() {
    if (!signer || !selectedToken) return;
    setFaucetLoading(true);
    try {
      const info = collaterals.find(c => c.token === selectedToken);
      const decimals = info?.decimals ?? 18;
      const faucetAmount = ethers.parseUnits("10", decimals); // 10 tokens
      const erc20 = new ethers.Contract(selectedToken, [...ERC20_ABI, "function mint(address to, uint256 amount)"], signer);
      const mintTx = await erc20.mint(address, faucetAmount, { gasLimit: 100_000 });
      await mintTx.wait();
      // Trigger data reload
      setReloadKey(k => k + 1);
    } catch (e: any) {
      console.error("Faucet mint failed:", e);
    } finally {
      setFaucetLoading(false);
    }
  }

  // Health factor gauge (map from 1.0-3.0 to 0%-100%)
  const hfGaugePct = debt > 0n
    ? Math.min(100, Math.max(0, ((Math.min(hfValue, 3) - 1) / 2) * 100))
    : 100;
  const hfGaugeColor = hfValue < 1.2 ? "from-red-500 to-red-400" : hfValue < 1.5 ? "from-yellow-500 to-yellow-400" : "from-emerald-500 to-teal-400";
  const selectedCollateral = collaterals.find((c) => c.token === selectedToken) || null;
  const selectedSymbol = selectedCollateral?.symbol || "Token";
  const selectedDecimals = selectedCollateral?.decimals || 18;
  const selectedWalletBalance = selectedCollateral?.walletBalance || 0n;
  const selectedDeposited = selectedCollateral?.deposited || 0n;

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader title="Borrow & Lend" subtitle="Deposit collateral to borrow mUSD with overcollateralization" badge="Borrow" badgeColor="brand" />
        <WalletConnector mode="ethereum" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Borrow & Lend"
        subtitle="Deposit collateral to borrow mUSD with overcollateralization"
        badge={debt > 0n ? "Active Position" : "No Position"}
        badgeColor={debt > 0n ? "warning" : "brand"}
      />

      {/* Liquidation Alert */}
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
              <div className="mt-4 flex flex-wrap gap-3">
                <TxButton
                  onClick={handleRepayMax}
                  loading={tx.loading}
                  disabled={musdBalance === 0n}
                  variant="danger"
                >
                  Emergency Repay ({formatUSD(musdBalance < debt ? musdBalance : debt)})
                </TxButton>
                <button
                  onClick={() => setAction("deposit")}
                  className="btn-secondary !border-red-500/50 !text-red-300 hover:!bg-red-500/10"
                >
                  Add Collateral
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Critical Warning */}
      {!isLiquidatable && isCritical && (
        <div className="alert-warning flex items-center gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm">
            <span className="font-semibold">Caution:</span> Health factor is low ({hfValue.toFixed(2)}). Add collateral or repay debt to avoid liquidation.
          </span>
        </div>
      )}

      {/* Two-Column Grid: Action Card (left) + Stats/Health/Collateral (right) */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* LEFT column: Action Card */}
        <div>
          <div className="card-gradient-border overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-white/10">
              {(["deposit", "borrow", "repay", "withdraw"] as const).map((a) => {
                const tabIcons: Record<TabType, JSX.Element> = {
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
                    key={a}
                    className={`relative flex-1 px-4 py-4 text-center text-sm font-semibold transition-all duration-300 ${
                      action === a ? "text-white" : "text-gray-400 hover:text-white"
                    }`}
                    onClick={() => { setAction(a); setAmount(""); }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2 capitalize">
                      {tabIcons[a]}
                      {a}
                    </span>
                    {action === a && (
                      <span className="absolute bottom-0 left-1/2 h-0.5 w-16 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-500 to-purple-500" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Form Content */}
            <div className="space-y-6 p-6">
              {/* Token Selector for deposit/withdraw */}
              {(action === "deposit" || action === "withdraw") && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-400">Collateral Token</label>
                  <div className="relative">
                    <select
                      className="input appearance-none pr-10"
                      value={selectedToken}
                      onChange={(e) => setSelectedToken(e.target.value)}
                    >
                      {collaterals.map((c) => (
                        <option key={c.token} value={c.token}>
                          {c.symbol} {c.deposited > 0n ? `(${formatToken(c.deposited, c.decimals)} deposited)` : ""}
                        </option>
                      ))}
                    </select>
                    <svg className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {/* Testnet Faucet */}
                  {action === "deposit" && selectedToken && (
                    <button
                      className="mt-2 w-full rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/20 disabled:opacity-50"
                      onClick={handleFaucetMint}
                      disabled={faucetLoading}
                    >
                      {faucetLoading ? "Minting..." : `🚰 Get 10 Test ${collaterals.find(c => c.token === selectedToken)?.symbol || "Tokens"}`}
                    </button>
                  )}
                </div>
              )}

              {/* Amount Input */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-400">
                    {action === "deposit" ? "Deposit Amount" : action === "borrow" ? "Borrow Amount (mUSD)" : action === "repay" ? "Repay Amount (mUSD)" : "Withdraw Amount"}
                  </label>
                  {action === "borrow" && (
                    <span className="text-xs text-gray-500">Max: {formatUSD(maxBorrowable)}</span>
                  )}
                  {action === "repay" && (
                    <span className="text-xs text-gray-500">Debt: {formatUSD(debt)}</span>
                  )}
                  {action === "deposit" && (
                    <span className="text-xs text-gray-500">
                      Available: {formatToken(selectedWalletBalance, selectedDecimals)} {selectedSymbol}
                    </span>
                  )}
                  {action === "withdraw" && (
                    <span className="text-xs text-gray-500">
                      Deposited: {formatToken(selectedDeposited, selectedDecimals)} {selectedSymbol}
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
                      {action === "borrow" && maxBorrowable > 0n && (
                        <button
                          className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                          onClick={() => setAmount(ethers.formatUnits(maxBorrowable, MUSD_DECIMALS))}
                        >
                          MAX
                        </button>
                      )}
                      {action === "repay" && debt > 0n && (
                        <button
                          className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                          onClick={() => setAmount(ethers.formatUnits(musdBalance < debt ? musdBalance : debt, MUSD_DECIMALS))}
                        >
                          MAX
                        </button>
                      )}
                      {action === "deposit" && selectedWalletBalance > 0n && (
                        <button
                          className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                          onClick={() => setAmount(ethers.formatUnits(selectedWalletBalance, selectedDecimals))}
                        >
                          MAX
                        </button>
                      )}
                      {action === "withdraw" && selectedDeposited > 0n && (
                        <button
                          className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                          onClick={() => setAmount(ethers.formatUnits(selectedDeposited, selectedDecimals))}
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
                          {action === "borrow" || action === "repay" ? "mUSD" : selectedSymbol}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <TxButton
                onClick={
                  action === "deposit"
                    ? handleDeposit
                    : action === "borrow"
                    ? handleBorrow
                    : action === "repay"
                    ? handleRepay
                    : handleWithdraw
                }
                loading={tx.loading}
                disabled={!amount || parseFloat(amount) <= 0}
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

              {/* Slippage Tolerance (withdraw tab) */}
              {action === "withdraw" && (
                <SlippageInput value={slippageBps} onChange={setSlippageBps} compact />
              )}

              {/* Transaction Status */}
              {tx.error && (
                <div className="alert-error flex items-center gap-3">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm">{tx.error}</span>
                </div>
              )}
              {tx.success && (
                <div className="alert-success flex items-center gap-3">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm">
                    Transaction confirmed! {tx.hash && (
                      <a href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="underline">
                        View on Etherscan
                      </a>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT column: Stats + Health Factor + Collateral Positions */}
        <div className="space-y-4">
          {/* Stats Dashboard */}
          <div className="grid gap-4 grid-cols-2">
            <StatCard
              label="Total Collateral"
              value={formatUSD(totalCollateralUsd)}
              color="blue"
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
            />
            <StatCard
              label="Outstanding Debt"
              value={formatUSD(debt)}
              color={debt > 0n ? "red" : "default"}
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
              }
            />
            <StatCard
              label="Available to Borrow"
              value={formatUSD(maxBorrowable)}
              color="green"
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Interest Rate"
              value={formatBps(interestRate) + " APR"}
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              }
            />
          </div>

          {/* LTV Health Gauge */}
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

          {/* Health Factor & Position Overview */}
          {debt > 0n && (
            <div className="card-gradient-border overflow-hidden">
              <div className="grid gap-6 sm:grid-cols-2">
                {/* Health Factor Gauge */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      hfValue < 1.2 ? "bg-red-500/20" : hfValue < 1.5 ? "bg-yellow-500/20" : "bg-emerald-500/20"
                    }`}>
                      <svg className={`h-5 w-5 ${
                        hfValue < 1.2 ? "text-red-400" : hfValue < 1.5 ? "text-yellow-400" : "text-emerald-400"
                      }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Health Factor</p>
                      <p className={`text-3xl font-bold ${
                        hfValue < 1.2 ? "text-red-400" : hfValue < 1.5 ? "text-yellow-400" : "text-emerald-400"
                      }`}>
                        {formatHealthFactor(healthFactor)}
                      </p>
                    </div>
                  </div>

                  {/* Gauge Bar */}
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
                      hfValue < 1.2 ? "text-red-400" : hfValue < 1.5 ? "text-yellow-400" : "text-emerald-400"
                    }`}>
                      {hfValue < 1.0 ? "Liquidatable" : hfValue < 1.2 ? "Critical" : hfValue < 1.5 ? "Caution" : hfValue > 10 ? "Very Safe" : "Healthy"}
                    </span>
                  </div>
                </div>

                {/* Position Summary */}
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
                      <span className="font-medium text-white">{formatUSD(totalCollateralUsd)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Outstanding Debt</span>
                      <span className="font-medium text-red-400">{formatUSD(debt)}</span>
                    </div>
                    <div className="divider" />
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Net Position</span>
                      <span className="font-medium text-white">{formatUSD(totalCollateralUsd > debt ? totalCollateralUsd - debt : 0n)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Utilization</span>
                      <span className={`font-medium ${utilizationPct > 80 ? "text-red-400" : utilizationPct > 60 ? "text-yellow-400" : "text-emerald-400"}`}>
                        {utilizationPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* mUSD Balance for quick repay */}
                  <div className="flex items-center justify-between rounded-lg bg-surface-800/50 px-4 py-3">
                    <div>
                      <p className="text-xs text-gray-400">Your mUSD</p>
                      <p className="font-semibold text-white">{formatUSD(musdBalance)}</p>
                    </div>
                    <TxButton
                      onClick={handleRepayMax}
                      loading={tx.loading}
                      disabled={musdBalance === 0n || debt === 0n}
                      variant="secondary"
                      className="!py-2 !px-4 text-sm"
                    >
                      Close Position
                    </TxButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Collateral Positions Table */}
          {collaterals.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center gap-3 mb-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/20">
                  <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Collateral Positions</h2>
                  <p className="text-sm text-gray-400">{collaterals.length} supported token{collaterals.length > 1 ? "s" : ""}</p>
                </div>
              </div>
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
                    {collaterals.map((c) => (
                      <tr key={c.token} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-500 text-xs font-bold text-white">
                              {c.symbol[0]}
                            </div>
                            <span className="font-medium text-white">{c.symbol}</span>
                          </div>
                        </td>
                        <td className="py-3 text-right text-gray-300">{formatToken(c.deposited, c.decimals)}</td>
                        <td className="py-3 text-right font-medium text-white">{formatUSD(c.valueUsd)}</td>
                        <td className="py-3 text-right">
                          <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-400">
                            {formatBps(c.factorBps)}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
                            {formatBps(c.liqThreshold)}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                            {formatBps(c.liqPenalty)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* How Borrowing Works */}
      <div className="card">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/20">
            <svg className="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">How Borrowing Works</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm mb-3">1</div>
            <h3 className="font-medium text-white mb-1">Deposit</h3>
            <p className="text-sm text-gray-400">Lock collateral tokens in the vault.</p>
          </div>
          <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-brand-400 font-bold text-sm mb-3">2</div>
            <h3 className="font-medium text-white mb-1">Borrow</h3>
            <p className="text-sm text-gray-400">Mint mUSD up to your collateral&apos;s LTV ratio.</p>
          </div>
          <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-sm mb-3">3</div>
            <h3 className="font-medium text-white mb-1">Repay</h3>
            <p className="text-sm text-gray-400">Return mUSD + accrued interest to close your debt.</p>
          </div>
          <div className="rounded-xl bg-surface-800/50 p-4 border border-white/5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 font-bold text-sm mb-3">4</div>
            <h3 className="font-medium text-white mb-1">Withdraw</h3>
            <p className="text-sm text-gray-400">Reclaim your collateral once debt is cleared.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BorrowPage;

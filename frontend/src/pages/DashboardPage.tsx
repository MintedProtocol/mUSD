import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { formatUSD, formatToken, formatBps, formatHealthFactor } from "@/lib/format";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import { CONTRACTS, MUSD_DECIMALS } from "@/lib/config";
import { ERC20_ABI } from "@/abis/ERC20";
import WalletConnector from "@/components/WalletConnector";
import { MintPage } from "./MintPage";
import { ReferralWidget } from "@/components/ReferralWidget";

interface DashboardData {
  musdSupply: bigint;
  supplyCap: bigint;
  totalBacking: bigint;
  availableReserves: bigint;
  deployedToStrategies: bigint;
  smusdTotalAssets: bigint;
  smusdTotalSupply: bigint;
  attestedAssets: bigint;
  collateralRatio: bigint;
  bridgeHealthRatio: bigint;
  bridgePaused: boolean;
  mintFeeBps: bigint;
  redeemFeeBps: bigint;
  interestRateBps: bigint;
}

// Type-safe PromiseSettledResult value extractor
function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

interface PortfolioData {
  // Balances
  ethBalance: bigint;
  usdcBalance: bigint;
  musdBalance: bigint;
  smusdBalance: bigint;
  // Staking
  smusdValueInMusd: bigint;
  // Borrowing
  totalDebt: bigint;
  healthFactor: bigint;
  maxBorrowable: bigint;
  collateralValue: bigint;
  isLiquidatable: boolean;
  // Collateral breakdown
  collaterals: {
    symbol: string;
    deposited: bigint;
    decimals: number;
    valueUsd: bigint;
  }[];
}

interface DashboardPageProps {
  onNavigate?: (page: string) => void;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const { address, signer, isConnected, ensName, chainName } = useUnifiedWallet();
  const chain = chainName ? { name: chainName } : null;
  const contracts = useWCContracts();
  const [data, setData] = useState<DashboardData | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'mint' | 'portfolio' | 'protocol'>('protocol');

  // Load protocol data
  useEffect(() => {
    async function load() {
      const { musd, smusd, treasury, bridge, directMint, borrow } = contracts;
      if (!musd) return;

      try {
        const results = await Promise.allSettled([
          musd.totalSupply(),
          musd.supplyCap(),
          treasury?.totalBacking() ?? 0n,
          treasury?.availableReserves() ?? 0n,
          treasury?.totalValue() ?? 0n,
          smusd?.totalAssets() ?? 0n,
          smusd?.totalSupply() ?? 0n,
          bridge?.attestedCantonAssets() ?? 0n,
          bridge?.collateralRatioBps() ?? 0n,
          bridge?.getHealthRatio() ?? 0n,
          bridge?.paused() ?? false,
          directMint?.mintFeeBps() ?? 0n,
          directMint?.redeemFeeBps() ?? 0n,
          borrow?.interestRateBps() ?? 0n,
        ]);

        // Use type-safe settledValue instead of `as any`
        setData({
          musdSupply: settledValue(results[0], 0n),
          supplyCap: settledValue(results[1], 0n),
          totalBacking: settledValue(results[2], 0n),
          availableReserves: settledValue(results[3], 0n),
          deployedToStrategies: settledValue(results[4], 0n),
          smusdTotalAssets: settledValue(results[5], 0n),
          smusdTotalSupply: settledValue(results[6], 0n),
          attestedAssets: settledValue(results[7], 0n),
          collateralRatio: settledValue(results[8], 0n),
          bridgeHealthRatio: settledValue(results[9], 0n),
          bridgePaused: settledValue(results[10], false),
          mintFeeBps: settledValue(results[11], 0n),
          redeemFeeBps: settledValue(results[12], 0n),
          interestRateBps: settledValue(results[13], 0n),
        });
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [contracts, isConnected]);

  // Load user portfolio data
  useEffect(() => {
    async function loadPortfolio() {
      if (!address || !signer) return;
      const { musd, smusd, usdc, vault, borrow, oracle, liquidation } = contracts;
      if (!musd) return;

      try {
        // Get basic balances
        const provider = signer.provider;
        const [ethBal, usdcBal, musdBal, smusdBal] = await Promise.all([
          provider?.getBalance(address) ?? 0n,
          usdc?.balanceOf(address) ?? 0n,
          musd.balanceOf(address),
          smusd?.balanceOf(address) ?? 0n,
        ]);

        // Calculate smUSD value in mUSD
        let smusdValue = 0n;
        if (smusd && smusdBal > 0n) {
          try {
            smusdValue = await smusd.previewRedeem(smusdBal);
          } catch {
            smusdValue = smusdBal; // Fallback to 1:1
          }
        }

        // Get borrowing data
        let debt = 0n, hf = ethers.MaxUint256, maxBorrow = 0n, isLiq = false;
        if (borrow) {
          [debt, hf, maxBorrow] = await Promise.all([
            borrow.totalDebt(address).catch(() => 0n),
            borrow.healthFactor(address).catch(() => ethers.MaxUint256),
            borrow.maxBorrow(address).catch(() => 0n),
          ]);
        }
        if (liquidation && debt > 0n) {
          isLiq = await liquidation.isLiquidatable(address).catch(() => false);
        }

        // Get collateral positions
        const collaterals: PortfolioData['collaterals'] = [];
        let totalCollateralValue = 0n;
        
        if (vault && oracle) {
          try {
            const tokens: string[] = await vault.getSupportedTokens();
            for (const token of tokens) {
              const dep = await vault.getDeposit(address, token);
              const deposited = BigInt(dep);
              if (deposited > 0n) {
                const erc20 = new ethers.Contract(token, ERC20_ABI, signer);
                const [symbol, dec, prc] = await Promise.all([
                  erc20.symbol(),
                  erc20.decimals(),
                  oracle.getPrice(token).catch(() => 0n),
                ]);
                const decimals = Number(dec);
                const price = BigInt(prc);
                const valueUsd = price > 0n 
                  ? (deposited * price) / (10n ** BigInt(decimals))
                  : 0n;
                totalCollateralValue += valueUsd;
                collaterals.push({
                  symbol,
                  deposited,
                  decimals,
                  valueUsd,
                });
              }
            }
          } catch (e) {
            console.error("Error loading collaterals:", e);
          }
        }

        setPortfolio({
          ethBalance: ethBal,
          usdcBalance: usdcBal,
          musdBalance: musdBal,
          smusdBalance: smusdBal,
          smusdValueInMusd: smusdValue,
          totalDebt: debt,
          healthFactor: hf,
          maxBorrowable: maxBorrow,
          collateralValue: totalCollateralValue,
          isLiquidatable: isLiq,
          collaterals,
        });
      } catch (err) {
        console.error("Portfolio load error:", err);
      }
    }
    loadPortfolio();
  }, [address, signer, contracts]);

  if (!isConnected) {
    return <WalletConnector mode="ethereum" />;
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-brand-500/20 border-t-brand-500" />
          <p className="text-gray-400">Loading protocol data...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="card-gradient-border max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10">
            <svg className="h-8 w-8 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="mb-2 text-xl font-semibold text-white">No Data Available</h3>
          <p className="text-gray-400">Unable to load protocol data. Please check your network connection.</p>
        </div>
      </div>
    );
  }

  const utilizationPct = data.supplyCap > 0n 
    ? (Number(data.musdSupply) / Number(data.supplyCap)) * 100 
    : 0;

  // Calculate portfolio totals
  const portfolioTotal = portfolio ? (
    Number(ethers.formatUnits(portfolio.musdBalance, MUSD_DECIMALS)) +
    Number(ethers.formatUnits(portfolio.smusdValueInMusd, MUSD_DECIMALS)) +
    Number(ethers.formatUnits(portfolio.collateralValue, MUSD_DECIMALS)) -
    Number(ethers.formatUnits(portfolio.totalDebt, MUSD_DECIMALS))
  ) : 0;

  const hfValue = portfolio
    ? (portfolio.healthFactor >= BigInt("0xffffffffffffffffffffffffffffffff")
      ? Infinity
      : Number(portfolio.healthFactor) / 10000)
    : 999;
  const hfColor = hfValue < 1.0 ? "red" : hfValue < 1.2 ? "red" : hfValue < 1.5 ? "yellow" : "green";

  return (
    <div className="space-y-8">
      {/* Header with wallet info */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Dashboard"
          subtitle={`Welcome back${ensName ? `, ${ensName}` : ''}`}
          badge={chain?.name || "Ethereum"}
          badgeColor="brand"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('protocol')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'protocol'
                ? 'bg-brand-500 text-white' 
                : 'bg-slate-800 text-gray-400 hover:text-white'
            }`}
          >
            Protocol Stats
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'portfolio' 
                ? 'bg-brand-500 text-white' 
                : 'bg-slate-800 text-gray-400 hover:text-white'
            }`}
          >
            Portfolio Stats
          </button>
          <button
            onClick={() => setActiveTab('mint')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'mint'
                ? 'bg-brand-500 text-white' 
                : 'bg-slate-800 text-gray-400 hover:text-white'
            }`}
          >
            Mint & Redeem
          </button>
        </div>
      </div>

      {activeTab === 'mint' && (
        <MintPage />
      )}

      {activeTab === 'portfolio' && portfolio && (
        <>
          {/* Portfolio Alert Banner */}
          {portfolio.isLiquidatable && (
            <div className="rounded-xl border-2 border-red-500 bg-red-900/30 p-4">
              <div className="flex items-center gap-3">
                <svg className="h-6 w-6 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="font-semibold text-red-300">Position At Risk!</p>
                  <p className="text-sm text-red-200/80">Your borrowing position is below the liquidation threshold. Visit Borrow & Lend to take action.</p>
                </div>
              </div>
            </div>
          )}

          {/* Portfolio Hero */}
          <div className="card-gradient-border p-8">
            <div className="grid gap-8 lg:grid-cols-4">
              {/* Net Worth */}
              <div className="lg:col-span-2 space-y-2">
                <p className="text-sm font-medium text-gray-400">Net Portfolio Value</p>
                <p className="text-5xl font-bold text-white">
                  ${portfolioTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-sm text-gray-500">
                  Connected: {address?.slice(0, 6)}...{address?.slice(-4)}
                </p>
              </div>
              {/* Quick Stats */}
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Total Assets</p>
                  <p className="text-2xl font-semibold text-emerald-400">
                    {formatUSD(portfolio.musdBalance + portfolio.smusdValueInMusd + portfolio.collateralValue)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Total Debt</p>
                  <p className="text-2xl font-semibold text-red-400">
                    {portfolio.totalDebt > 0n ? `-${formatUSD(portfolio.totalDebt)}` : '$0.00'}
                  </p>
                </div>
              </div>
              {/* Health Factor */}
              {portfolio.totalDebt > 0n && (
                <div className="flex flex-col items-center justify-center rounded-xl bg-slate-800/50 p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Health Factor</p>
                  <p className={`text-4xl font-bold ${
                    hfColor === 'red' ? 'text-red-400' : 
                    hfColor === 'yellow' ? 'text-yellow-400' : 'text-emerald-400'
                  }`}>
                    {hfValue > 10 ? '∞' : hfValue.toFixed(2)}
                  </p>
                  <p className={`text-xs mt-1 ${
                    hfColor === 'red' ? 'text-red-300' : 
                    hfColor === 'yellow' ? 'text-yellow-300' : 'text-emerald-300'
                  }`}>
                    {hfValue < 1.0 ? 'LIQUIDATABLE' : hfValue < 1.2 ? 'At Risk' : hfValue < 1.5 ? 'Caution' : 'Healthy'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Token Balances */}
          <Section 
            title="Your Balances" 
            subtitle="Token holdings in your wallet"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard 
                label="ETH" 
                value={`${Number(ethers.formatEther(portfolio.ethBalance)).toFixed(4)} ETH`}
                color="blue"
                icon={
                  <svg className="h-5 w-5" viewBox="0 0 320 512" fill="currentColor">
                    <path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/>
                  </svg>
                }
              />
              <StatCard 
                label="USDC" 
                value={formatToken(portfolio.usdcBalance, 6)}
                color="blue"
                subValue="Available to mint"
              />
              <StatCard 
                label="mUSD" 
                value={formatToken(portfolio.musdBalance)}
                color="purple"
                variant="glow"
              />
              <StatCard 
                label="smUSD" 
                value={formatToken(portfolio.smusdBalance)}
                subValue={portfolio.smusdBalance > 0n ? `≈ ${formatToken(portfolio.smusdValueInMusd)} mUSD` : undefined}
                color="green"
              />
            </div>
          </Section>

          {/* Collateral Positions */}
          {portfolio.collaterals.length > 0 && (
            <Section 
              title="Collateral Positions" 
              subtitle="Assets deposited as borrowing collateral"
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
            >
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400">
                      <th className="pb-3 text-left font-medium">Token</th>
                      <th className="pb-3 text-right font-medium">Amount</th>
                      <th className="pb-3 text-right font-medium">Value (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.collaterals.map((c, i) => (
                      <tr key={i} className="border-b border-gray-800 last:border-0">
                        <td className="py-3 font-medium text-white">{c.symbol}</td>
                        <td className="py-3 text-right text-gray-300">
                          {formatToken(c.deposited, c.decimals)}
                        </td>
                        <td className="py-3 text-right text-white">
                          {formatUSD(c.valueUsd)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-800/30">
                      <td className="py-3 font-semibold text-white">Total Collateral</td>
                      <td className="py-3"></td>
                      <td className="py-3 text-right font-semibold text-white">
                        {formatUSD(portfolio.collateralValue)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Borrowing Summary */}
          {portfolio.totalDebt > 0n && (
            <Section 
              title="Borrowing Position" 
              subtitle="Your active loan details"
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard 
                  label="Outstanding Debt" 
                  value={formatUSD(portfolio.totalDebt)}
                  color="red"
                />
                <StatCard 
                  label="Collateral Value" 
                  value={formatUSD(portfolio.collateralValue)}
                  color="blue"
                />
                <StatCard 
                  label="Health Factor" 
                  value={formatHealthFactor(portfolio.healthFactor)}
                  color={hfColor}
                  subValue={hfValue < 1.5 ? 'Add collateral or repay' : 'Position is safe'}
                />
                <StatCard 
                  label="Available to Borrow" 
                  value={formatUSD(portfolio.maxBorrowable)}
                  color="green"
                />
              </div>
            </Section>
          )}

          {/* Quick Actions */}
          <Section 
            title="Quick Actions" 
            subtitle="Common operations"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ActionCard 
                title="Mint mUSD"
                description="Convert USDC to mUSD"
                icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                color="blue"
                onClick={() => setActiveTab('mint')}
              />
              <ActionCard 
                title="Stake mUSD"
                description="Earn yield with smUSD"
                icon="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                color="green"
                onClick={() => onNavigate?.('stake')}
              />
              <ActionCard 
                title="Borrow mUSD"
                description="Use collateral to borrow"
                icon="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                color="purple"
                onClick={() => onNavigate?.('borrow')}
              />
              <ActionCard 
                title="Bridge to Canton"
                description="Cross-chain transfer"
                icon="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                color="yellow"
                onClick={() => onNavigate?.('bridge')}
              />
            </div>
          </Section>

          {/* Referral Widget */}
          <ReferralWidget />
        </>
      )}

      {activeTab === 'protocol' && (
        <>
          {/* Hero Stats */}
          <div className="card-gradient-border p-8">
            <div className="grid gap-8 lg:grid-cols-3">
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-400">Total Value Locked</p>
                <p className="text-4xl font-bold text-white">{formatUSD(data.totalBacking, 6)}</p>
                <p className="flex items-center gap-2 text-sm text-emerald-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Fully backed by USDC
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-400">mUSD Supply</p>
                <p className="text-4xl font-bold text-gradient">{formatUSD(data.musdSupply)}</p>
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-xs text-gray-500">
                    <span>Utilization</span>
                    <span>{utilizationPct.toFixed(1)}%</span>
                  </div>
                  <div className="progress">
                    <div 
                      className={`progress-bar ${utilizationPct > 90 ? "!bg-red-500" : utilizationPct > 70 ? "!bg-yellow-500" : ""}`}
                      style={{ width: `${Math.min(utilizationPct, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-400">Total Staked</p>
                <p className="text-4xl font-bold text-gradient-emerald">{formatToken(data.smusdTotalAssets)}</p>
                <p className="text-sm text-gray-500">
                  {data.smusdTotalSupply > 0n 
                    ? `Exchange Rate: 1 smUSD = ${(Number(data.smusdTotalAssets) / Number(data.smusdTotalSupply)).toFixed(4)} mUSD`
                    : "1:1 Exchange Rate"
                  }
                </p>
              </div>
            </div>
          </div>

          {/* mUSD Supply Section */}
          <Section 
            title="mUSD Supply" 
            subtitle="Stablecoin issuance metrics"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard 
                label="Total Supply" 
                value={formatUSD(data.musdSupply)} 
                color="blue" 
                variant="glow"
              />
              <StatCard label="Supply Cap" value={formatUSD(data.supplyCap)} />
              <StatCard
                label="Utilization"
                value={`${utilizationPct.toFixed(1)}%`}
                color={utilizationPct > 90 ? "red" : utilizationPct > 70 ? "yellow" : "green"}
              />
              <StatCard
                label="Remaining Mintable"
                value={formatUSD(data.supplyCap > data.musdSupply ? data.supplyCap - data.musdSupply : 0n)}
              />
            </div>
          </Section>

          {/* Treasury Section */}
          <Section 
            title="Treasury" 
            subtitle="USDC backing and yield strategies"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard 
                label="Total Backing" 
                value={formatUSD(data.totalBacking, 6)} 
                color="green" 
                variant="glow"
              />
              <StatCard label="Available Reserves" value={formatUSD(data.availableReserves, 6)} />
              <StatCard label="Deployed to Strategies" value={formatUSD(data.deployedToStrategies, 6)} color="yellow" />
            </div>
          </Section>

          {/* Canton Bridge Section */}
          <Section 
            title="Canton Bridge" 
            subtitle="Cross-chain asset attestation"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Attested Assets" value={formatUSD(data.attestedAssets)} color="blue" />
              <StatCard label="Collateral Ratio" value={formatBps(data.collateralRatio)} />
              <StatCard
                label="Health Ratio"
                value={formatHealthFactor(data.bridgeHealthRatio)}
                color={data.bridgeHealthRatio < ethers.parseUnits("1.1", 18) ? "red" : "green"}
              />
              <StatCard
                label="Bridge Status"
                value={data.bridgePaused ? "PAUSED" : "Active"}
                color={data.bridgePaused ? "red" : "green"}
              />
            </div>
          </Section>

          {/* Fees & Rates Section */}
          <Section 
            title="Fees & Rates" 
            subtitle="Protocol fee structure"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="Mint Fee" value={formatBps(data.mintFeeBps)} color="purple" />
              <StatCard label="Redeem Fee" value={formatBps(data.redeemFeeBps)} color="purple" />
              <StatCard label="Borrow Rate (APR)" value={formatBps(data.interestRateBps)} color="yellow" />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

// Quick Action Card Component
function ActionCard({ title, description, icon, color, onClick }: { 
  title: string; 
  description: string; 
  icon: string; 
  color: 'blue' | 'green' | 'purple' | 'yellow';
  onClick?: () => void;
}) {
  const colorClasses = {
    blue: 'bg-blue-500/10 border-blue-500/20 hover:border-blue-500/40 text-blue-400',
    green: 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400',
    purple: 'bg-purple-500/10 border-purple-500/20 hover:border-purple-500/40 text-purple-400',
    yellow: 'bg-yellow-500/10 border-yellow-500/20 hover:border-yellow-500/40 text-yellow-400',
  };

  return (
    <button onClick={onClick} className={`rounded-xl border p-4 text-left transition-all ${colorClasses[color]}`}>
      <div className="mb-3">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
        </svg>
      </div>
      <h4 className="font-semibold text-white">{title}</h4>
      <p className="text-sm text-gray-400 mt-1">{description}</p>
    </button>
  );
}

export default DashboardPage;

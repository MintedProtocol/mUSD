import React, { useMemo, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { useCantonLedger } from "@/hooks/useCantonLedger";
import { useLoopWallet } from "@/hooks/useLoopWallet";
import { CantonMint } from "@/components/canton/CantonMint";

type DashboardTab = "protocol" | "portfolio" | "mint";

function num(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function collateralTypeToSymbol(collateralType: string): string {
  switch (collateralType) {
    case "CTN_Coin":
      return "CTN";
    case "CTN_SMUSD":
      return "sMUSD";
    case "CTN_SMUSDE":
      return "sMUSD-E";
    case "CTN_USDC":
      return "USDC";
    case "CTN_USDCx":
      return "USDCx";
    default:
      return collateralType;
  }
}

export function CantonDashboard() {
  const loopWallet = useLoopWallet();
  const activeParty = loopWallet.partyId || null;
  const { data, loading, error, refresh } = useCantonLedger(15_000, activeParty);
  const [activeTab, setActiveTab] = useState<DashboardTab>("protocol");

  // Keep hooks order stable across loading/error/data transitions.
  const prices = useMemo(() => {
    const map = new Map<string, number>();
    if (!data) return map;
    for (const p of data.priceFeeds || []) {
      const k = (p.asset || "").trim();
      if (k) map.set(k, num(p.priceMusd));
    }
    return map;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
          <p className="text-gray-400">Loading protocol data...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="card-gradient-border max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
            <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="mb-2 text-xl font-semibold text-white">Canton Data Unavailable</h3>
          <p className="text-gray-400">{error}</p>
          <button onClick={refresh} className="mt-4 rounded-xl bg-emerald-600 px-6 py-2 font-medium text-white hover:bg-emerald-500">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const ctnPrice = prices.get("CTN") ?? (num(data.boostPoolService?.cantonPriceMusd) || 0.172);
  const usdcPrice = prices.get("USDC") ?? 1;
  const usdcxPrice = prices.get("USDCx") ?? 1;
  const smusdPrice = prices.get("sMUSD") ?? (num(data.stakingService?.sharePrice) || 1);
  const smusdePrice = prices.get("sMUSD-E") ?? (num(data.ethPoolService?.sharePrice) || 1);
  const boostSharePrice = num(data.boostPoolService?.globalSharePrice) || 1;
  const pureUsdcTotal = num(data.usdcBalance);
  const usdcxTotal = num(data.usdcxBalance);

  const musdUsd = num(data.totalBalance);
  const usdcUsd = pureUsdcTotal * usdcPrice + usdcxTotal * usdcxPrice;
  const ctnUsd = num(data.totalCoin) * ctnPrice;
  const smusdUsd = num(data.totalSmusd) * smusdPrice;
  const smusdeUsd = num(data.totalSmusdE) * smusdePrice;
  const boostUsd = num(data.totalBoostLP) * boostSharePrice * ctnPrice;
  const totalAssetsUsd = musdUsd + usdcUsd + ctnUsd + smusdUsd + smusdeUsd + boostUsd;

  const totalDebtUsd = (data.debtPositions || []).reduce(
    (sum, d) => sum + num(d.debtMusd) + num(d.interestAccrued),
    0
  );

  const collateralUsd = (data.escrowPositions || []).reduce((sum, esc) => {
    const symbol = collateralTypeToSymbol(esc.collateralType);
    const px = prices.get(symbol) ?? (symbol === "USDC" ? 1 : symbol === "USDCx" ? 1 : symbol === "CTN" ? ctnPrice : 0);
    return sum + num(esc.amount) * px;
  }, 0);

  const netUsd = totalAssetsUsd - totalDebtUsd;
  const healthFactor = totalDebtUsd > 0 ? collateralUsd / totalDebtUsd : Infinity;
  const healthLabel = Number.isFinite(healthFactor) ? healthFactor.toFixed(2) : "∞";
  const healthColor = !Number.isFinite(healthFactor)
    ? "green"
    : healthFactor < 1.0
      ? "red"
      : healthFactor < 1.2
        ? "yellow"
        : "green";

  const protocolTvl =
    num(data.stakingService?.pooledMusd) +
    num(data.ethPoolService?.totalMusdStaked) +
    num(data.boostPoolService?.totalCantonDeposited) * ctnPrice;

  const visibleSupply = num(data.lendingService?.cantonCurrentSupply) || musdUsd;
  const supplyCap = num(data.lendingService?.cantonSupplyCap);
  const utilizationPct = supplyCap > 0 ? (visibleSupply / supplyCap) * 100 : 0;

  const totalShares =
    num(data.stakingService?.totalShares) +
    num(data.ethPoolService?.totalShares) +
    num(data.boostPoolService?.totalLPShares);

  const userLabel = activeParty ? activeParty.split("::")[0] : "Loop User";
  const isAtRisk = Number.isFinite(healthFactor) && healthFactor < 1.0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Dashboard"
          subtitle={`Welcome back, ${userLabel}`}
          badge="Canton"
          badgeColor="emerald"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("protocol")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "protocol" ? "bg-brand-500 text-white" : "bg-slate-800 text-gray-400 hover:text-white"
            }`}
          >
            Protocol Stats
          </button>
          <button
            onClick={() => setActiveTab("portfolio")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "portfolio" ? "bg-brand-500 text-white" : "bg-slate-800 text-gray-400 hover:text-white"
            }`}
          >
            Portfolio Stats
          </button>
          <button
            onClick={() => setActiveTab("mint")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "mint" ? "bg-brand-500 text-white" : "bg-slate-800 text-gray-400 hover:text-white"
            }`}
          >
            Mint & Redeem
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 p-3 text-sm text-yellow-400">
          Refresh failed: {error}. Showing latest successful data.
        </div>
      )}

      {activeTab === "mint" && <CantonMint />}

      {activeTab === "portfolio" && (
        <>
          {isAtRisk && (
            <div className="rounded-xl border-2 border-red-500 bg-red-900/30 p-4">
              <div className="flex items-center gap-3">
                <svg className="h-6 w-6 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="font-semibold text-red-300">Position At Risk</p>
                  <p className="text-sm text-red-200/80">Health factor is below 1.0. Repay debt or add collateral.</p>
                </div>
              </div>
            </div>
          )}

          <div className="card-gradient-border p-8">
            <div className="grid gap-8 lg:grid-cols-4">
              <div className="lg:col-span-2 space-y-2">
                <p className="text-sm font-medium text-gray-400">Net Portfolio Value</p>
                <p className="text-5xl font-bold text-white">
                  ${netUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-sm text-gray-500">Party: {userLabel}</p>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Total Assets</p>
                  <p className="text-2xl font-semibold text-emerald-400">
                    ${totalAssetsUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Total Debt</p>
                  <p className="text-2xl font-semibold text-red-400">
                    ${totalDebtUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Health Factor</p>
                  <p className={`text-3xl font-bold ${healthColor === "red" ? "text-red-400" : healthColor === "yellow" ? "text-yellow-400" : "text-emerald-400"}`}>
                    {healthLabel}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Collateral Value</p>
                  <p className="text-xl font-semibold text-blue-400">
                    ${collateralUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="mUSD" value={musdUsd.toFixed(2)} subValue={`${data.tokenCount} contracts`} color="green" />
            <StatCard
              label="USDC"
              value={pureUsdcTotal.toFixed(2)}
              subValue={`${data.usdcContractCount} contracts`}
              color="blue"
            />
            <StatCard
              label="USDCx"
              value={usdcxTotal.toFixed(2)}
              subValue={`${data.usdcxContractCount} contracts`}
              color="blue"
            />
            <StatCard label="Canton Coin" value={num(data.totalCoin).toFixed(2)} subValue={`${data.cantonCoinTokens.length} contracts`} color="yellow" />
            <StatCard label="smUSD" value={num(data.totalSmusd).toFixed(4)} subValue={`${data.smusdTokens.length} contracts`} color="purple" />
            <StatCard label="smUSD-E" value={num(data.totalSmusdE).toFixed(4)} subValue={`${data.smusdETokens.length} contracts`} color="blue" />
            <StatCard label="Boost LP" value={num(data.totalBoostLP).toFixed(4)} subValue={`${data.boostLPTokens.length} contracts`} color="yellow" />
          </div>

          <Section title="Collateral Positions" subtitle="Escrowed collateral backing your loans">
            {data.escrowPositions.length === 0 ? (
              <p className="text-sm text-gray-500">No collateral positions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Est. USD</th>
                      <th className="px-4 py-3">Contract</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.escrowPositions.map((esc) => {
                      const sym = collateralTypeToSymbol(esc.collateralType);
                      const px = prices.get(sym) ?? (sym === "USDC" ? 1 : sym === "USDCx" ? 1 : sym === "CTN" ? ctnPrice : 0);
                      const usd = num(esc.amount) * px;
                      return (
                        <tr key={esc.contractId} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-3 text-sm text-white">{sym}</td>
                          <td className="px-4 py-3 text-sm text-gray-300">{num(esc.amount).toFixed(6)}</td>
                          <td className="px-4 py-3 text-sm text-emerald-400">${usd.toFixed(2)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{esc.contractId.slice(0, 12)}...{esc.contractId.slice(-8)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Debt Positions" subtitle="Outstanding mUSD debt and accrued interest">
            {data.debtPositions.length === 0 ? (
              <p className="text-sm text-gray-500">No active debt.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      <th className="px-4 py-3">Principal</th>
                      <th className="px-4 py-3">Accrued Interest</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Contract</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.debtPositions.map((debt) => {
                      const principal = num(debt.debtMusd);
                      const interest = num(debt.interestAccrued);
                      return (
                        <tr key={debt.contractId} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-3 text-sm text-gray-300">{principal.toFixed(6)} mUSD</td>
                          <td className="px-4 py-3 text-sm text-yellow-300">{interest.toFixed(6)} mUSD</td>
                          <td className="px-4 py-3 text-sm text-red-400">{(principal + interest).toFixed(6)} mUSD</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{debt.contractId.slice(0, 12)}...{debt.contractId.slice(-8)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {activeTab === "protocol" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Protocol TVL" value={`$${protocolTvl.toFixed(2)}`} color="green" />
            <StatCard label="Canton mUSD Supply" value={visibleSupply.toFixed(2)} color="blue" />
            <StatCard label="Total Staked Shares" value={totalShares.toFixed(2)} color="purple" />
            <StatCard label="Supply Utilization" value={`${utilizationPct.toFixed(2)}%`} color="yellow" />
          </div>

          <Section title="Protocol Services" subtitle="Live service contracts discovered on Canton">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {[
                { label: "Bridge Service", active: !!data.bridgeService, detail: data.bridgeService ? `Nonce ${data.bridgeService.lastNonce}` : "Not deployed" },
                { label: "Supply Service", active: !!data.supplyService, detail: data.supplyService ? "Deployed" : "Not deployed" },
                { label: "Staking Service", active: !!data.stakingService, detail: data.stakingService ? `Share ${num(data.stakingService.sharePrice).toFixed(4)}` : "Not deployed" },
                { label: "ETH Pool", active: !!data.ethPoolService, detail: data.ethPoolService ? `Share ${num(data.ethPoolService.sharePrice).toFixed(4)}` : "Not deployed" },
                { label: "Boost Pool", active: !!data.boostPoolService, detail: data.boostPoolService ? `CTN ${num(data.boostPoolService.cantonPriceMusd).toFixed(4)}` : "Not deployed" },
                { label: "Lending Service", active: !!data.lendingService, detail: data.lendingService ? `Rate ${(num(data.lendingService.interestRateBps) / 100).toFixed(2)}%` : "Not deployed" },
                { label: "DirectMint Service", active: !!data.directMintService, detail: data.directMintService ? (data.directMintService.paused ? "Paused" : "Active") : "Not deployed" },
                { label: "Price Feeds", active: data.priceFeeds.length > 0, detail: `${data.priceFeeds.length} feeds` },
              ].map((svc) => (
                <div key={svc.label} className={`card text-center transition-all duration-300 ${svc.active ? "border-emerald-500/30 hover:border-emerald-500/50" : "opacity-60"}`}>
                  <div className={`mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${svc.active ? "bg-emerald-500/10 text-emerald-400" : "bg-gray-800 text-gray-600"}`}>
                    <span className={`h-3 w-3 rounded-full ${svc.active ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
                  </div>
                  <div className={`mb-1 text-sm font-bold ${svc.active ? "text-emerald-400" : "text-gray-600"}`}>{svc.active ? "Active" : "Inactive"}</div>
                  <div className="text-xs text-gray-400">{svc.label}</div>
                  <div className="mt-1 text-xs text-gray-500">{svc.detail}</div>
                </div>
              ))}
            </div>
          </Section>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">Canton Party</p>
            <p className="break-all font-mono text-sm text-gray-300">{data.party}</p>
          </div>
        </>
      )}
    </div>
  );
}

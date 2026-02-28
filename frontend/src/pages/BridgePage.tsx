import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { formatUSD, formatBps, formatHealthFactor, formatTimestamp, shortenAddress } from "@/lib/format";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import WalletConnector from "@/components/WalletConnector";
import BridgeOutPanel from "@/components/BridgeOutPanel";

export function BridgePage() {
  const { isConnected } = useUnifiedWallet();
  const contracts = useWCContracts();
  const [data, setData] = useState({
    attestedAssets: 0n,
    supplyCap: 0n,
    remainingMintable: 0n,
    collateralRatio: 0n,
    healthRatio: 0n,
    minSigs: 0n,
    nonce: 0n,
    lastAttestation: 0n,
    paused: false,
  });
  const [events, setEvents] = useState<any[]>([]);

  const { bridge } = contracts;

  useEffect(() => {
    async function load() {
      if (!bridge) return;
      try {
        const [
          attestedAssets,
          supplyCap,
          remainingMintable,
          collateralRatio,
          healthRatio,
          minSigs,
          nonce,
          lastAttestation,
          paused,
        ] = await Promise.all([
          bridge.attestedCantonAssets(),
          bridge.getCurrentSupplyCap(),
          bridge.getRemainingMintable(),
          bridge.collateralRatioBps(),
          bridge.getHealthRatio(),
          bridge.minSignatures(),
          bridge.currentNonce(),
          bridge.lastAttestationTime(),
          bridge.paused(),
        ]);
        setData({
          attestedAssets,
          supplyCap,
          remainingMintable,
          collateralRatio,
          healthRatio,
          minSigs,
          nonce,
          lastAttestation,
          paused,
        });
      } catch (err) {
        console.error("Bridge load error:", err);
      }
    }
    load();
  }, [bridge]);

  // Load recent attestation events
  useEffect(() => {
    async function loadEvents() {
      if (!bridge) return;
      try {
        const filter = bridge.filters.AttestationReceived();
        const logs = await bridge.queryFilter(filter, -10000);
        // Use ethers.EventLog type instead of any
        const parsed = logs.slice(-20).reverse().map((log) => {
          const eventLog = log as ethers.EventLog;
          return {
            id: eventLog.args.id,
            cantonAssets: eventLog.args.cantonAssets,
            newSupplyCap: eventLog.args.newSupplyCap,
            nonce: eventLog.args.nonce,
            timestamp: eventLog.args.timestamp,
            blockNumber: eventLog.blockNumber,
          };
        });
        setEvents(parsed);
      } catch {}
    }
    loadEvents();
  }, [bridge]);

  // Supply cap utilization
  const supplyCapUsed = data.supplyCap > 0n ? data.supplyCap - data.remainingMintable : 0n;
  const supplyCapPct = data.supplyCap > 0n
    ? Number((supplyCapUsed * 10000n) / data.supplyCap) / 100
    : 0;

  // Health ratio gauge
  const hrValue = Number(ethers.formatUnits(data.healthRatio, 18));
  const hrColor = hrValue < 1.1 ? "from-red-500 to-red-400" : hrValue < 1.3 ? "from-yellow-500 to-yellow-400" : "from-emerald-500 to-teal-400";
  const hrPct = Math.min(100, Math.max(0, ((Math.min(hrValue, 2) - 1) / 1) * 100));

  // Time since last attestation
  const timeSinceAttestation = data.lastAttestation > 0n
    ? Math.round((Date.now() / 1000) - Number(data.lastAttestation))
    : 0;
  const attestationAge = timeSinceAttestation < 60
    ? `${timeSinceAttestation}s ago`
    : timeSinceAttestation < 3600
    ? `${Math.round(timeSinceAttestation / 60)}m ago`
    : `${Math.round(timeSinceAttestation / 3600)}h ago`;
  const attestationFresh = timeSinceAttestation < 3600; // less than 1 hour

  if (!isConnected) {
    return <WalletConnector mode="ethereum" />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Canton Bridge"
        subtitle="Real-time view of Canton Network attestations governing mUSD supply cap on Ethereum"
        badge={data.paused ? "PAUSED" : "Active"}
        badgeColor={data.paused ? "warning" : "emerald"}
      />

      {/* ── Bridge to Canton (ETH → Canton) ── */}
      <BridgeOutPanel />

      {/* Paused Alert */}
      {data.paused && (
        <div className="alert-error flex items-center gap-3">
          <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium">Bridge is currently paused. Attestation submissions and minting are disabled.</span>
        </div>
      )}

      {/* Primary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Attested Canton Assets"
          value={formatUSD(data.attestedAssets)}
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
          value={formatUSD(data.supplyCap)}
          color="purple"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
        <StatCard
          label="Remaining Mintable"
          value={formatUSD(data.remainingMintable)}
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
          subValue={data.lastAttestation > 0n ? formatTimestamp(Number(data.lastAttestation)) : "Never"}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Supply Cap Utilization & Health Ratio */}
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Supply Cap Utilization */}
        <div className="card-gradient-border overflow-hidden">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-500">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Supply Cap Utilization</h2>
              <p className="text-sm text-gray-400">{supplyCapPct.toFixed(1)}% of capacity used</p>
            </div>
          </div>

          {/* Visual Bar */}
          <div className="space-y-3">
            <div className="progress h-4 rounded-full">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  supplyCapPct > 90 ? "bg-gradient-to-r from-red-500 to-red-400" :
                  supplyCapPct > 70 ? "bg-gradient-to-r from-yellow-500 to-yellow-400" :
                  "progress-bar"
                }`}
                style={{ width: `${supplyCapPct}%` }}
              />
            </div>
            <div className="flex justify-between text-sm">
              <div>
                <p className="text-gray-400">Minted</p>
                <p className="font-semibold text-white">{formatUSD(supplyCapUsed)}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400">Available</p>
                <p className="font-semibold text-emerald-400">{formatUSD(data.remainingMintable)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Health Ratio */}
        <div className="card-gradient-border overflow-hidden">
          <div className="flex items-center gap-3 mb-5">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
              hrValue < 1.1 ? "bg-red-500/20" : hrValue < 1.3 ? "bg-yellow-500/20" : "bg-emerald-500/20"
            }`}>
              <svg className={`h-5 w-5 ${
                hrValue < 1.1 ? "text-red-400" : hrValue < 1.3 ? "text-yellow-400" : "text-emerald-400"
              }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Bridge Health Ratio</h2>
              <p className="text-sm text-gray-400">Canton assets vs supply cap</p>
            </div>
          </div>

          <div className="text-center mb-4">
            <p className={`text-4xl font-bold ${
              hrValue < 1.1 ? "text-red-400" : hrValue < 1.3 ? "text-yellow-400" : "text-emerald-400"
            }`}>
              {formatHealthFactor(data.healthRatio)}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {hrValue < 1.1 ? "Critical" : hrValue < 1.3 ? "Moderate" : "Healthy"}
            </p>
          </div>

          <div className="space-y-2">
            <div className="progress">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${hrColor} transition-all duration-1000`}
                style={{ width: `${hrPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span className="text-red-400">1.0</span>
              <span>1.5</span>
              <span className="text-emerald-400">2.0+</span>
            </div>
          </div>
        </div>
      </div>

      {/* Protocol Parameters */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/20">
            <svg className="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Bridge Parameters</h2>
            <p className="text-sm text-gray-400">On-chain configuration</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-surface-800/50 border border-white/5 p-4 space-y-1">
            <p className="text-sm text-gray-400">Collateral Ratio</p>
            <p className="text-xl font-bold text-white">{formatBps(data.collateralRatio)}</p>
            <p className="text-xs text-gray-500">Required overcollateralization</p>
          </div>
          <div className="rounded-xl bg-surface-800/50 border border-white/5 p-4 space-y-1">
            <p className="text-sm text-gray-400">Required Signatures</p>
            <p className="text-xl font-bold text-white">{data.minSigs.toString()}</p>
            <p className="text-xs text-gray-500">Multi-sig threshold</p>
          </div>
          <div className="rounded-xl bg-surface-800/50 border border-white/5 p-4 space-y-1">
            <p className="text-sm text-gray-400">Current Nonce</p>
            <p className="text-xl font-bold text-white">{data.nonce.toString()}</p>
            <p className="text-xs text-gray-500">Attestation sequence number</p>
          </div>
        </div>
      </div>

      {/* Attestation History */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/20">
              <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Attestation History</h2>
              <p className="text-sm text-gray-400">{events.length} recent attestation{events.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          {events.length > 0 && (
            <span className="badge-brand">{events.length} events</span>
          )}
        </div>
        {events.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface-800 mb-4">
              <svg className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-400 font-medium">No attestations found</p>
            <p className="text-sm text-gray-500 mt-1">Attestations from Canton validators will appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400">
                  <th className="pb-3 text-left font-medium">Block</th>
                  <th className="pb-3 text-left font-medium">Attestation ID</th>
                  <th className="pb-3 text-right font-medium">Canton Assets</th>
                  <th className="pb-3 text-right font-medium">New Supply Cap</th>
                  <th className="pb-3 text-right font-medium">Nonce</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-3">
                      <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-400">
                        #{e.blockNumber}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-xs text-gray-400">
                      {e.id.slice(0, 10)}…{e.id.slice(-8)}
                    </td>
                    <td className="py-3 text-right font-medium text-white">{formatUSD(e.cantonAssets)}</td>
                    <td className="py-3 text-right text-gray-300">{formatUSD(e.newSupplyCap)}</td>
                    <td className="py-3 text-right">
                      <span className="rounded-full bg-surface-700 px-2 py-0.5 text-xs font-medium text-gray-300">
                        {e.nonce.toString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* How the Bridge Works */}
      <div className="card">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/20">
            <svg className="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">How the Bridge Works</h2>
        </div>

        {/* Visual Pipeline */}
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { step: "1", title: "Observe", desc: "Validators observe RWA positions on Canton", color: "blue" },
            { step: "2", title: "Verify", desc: "Each validator independently verifies asset values", color: "purple" },
            { step: "3", title: "Sign", desc: `Validators sign ECDSA attestations (${data.minSigs.toString()} of N)`, color: "brand" },
            { step: "4", title: "Aggregate", desc: "Aggregator submits multi-sig to BLEBridgeV9", color: "emerald" },
            { step: "5", title: "Update", desc: `Bridge updates supply cap (${formatBps(data.collateralRatio)} ratio)`, color: "yellow" },
            { step: "6", title: "Mint", desc: "Users mint mUSD up to the supply cap using USDC", color: "green" },
          ].map((item) => {
            const bgColors: Record<string, string> = {
              blue: "bg-blue-500/20 text-blue-400",
              purple: "bg-purple-500/20 text-purple-400",
              brand: "bg-brand-500/20 text-brand-400",
              emerald: "bg-emerald-500/20 text-emerald-400",
              yellow: "bg-yellow-500/20 text-yellow-400",
              green: "bg-green-500/20 text-green-400",
            };
            return (
              <div key={item.step} className="rounded-xl bg-surface-800/50 p-3 border border-white/5 text-center">
                <div className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full ${bgColors[item.color]} font-bold text-sm mb-2`}>
                  {item.step}
                </div>
                <h3 className="font-medium text-white text-sm mb-1">{item.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default BridgePage;

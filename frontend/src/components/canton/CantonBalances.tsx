import React, { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

interface CantonMUSDToken {
  contractId: string;
  owner: string;
  amount: string;
  nonce: number;
  sourceChain: number;
  ethTxHash: string;
  createdAt: string;
}

interface BridgeServiceInfo {
  contractId: string;
  operator: string;
  lastNonce: number;
}

interface BalancesData {
  tokens: CantonMUSDToken[];
  totalBalance: string;
  tokenCount: number;
  bridgeService: BridgeServiceInfo | null;
  pendingBridgeIns: number;
  supplyService: boolean;
  ledgerOffset: number;
  party: string;
  timestamp: string;
}

function shortenContractId(cid: string): string {
  if (cid.length <= 20) return cid;
  return `${cid.slice(0, 10)}…${cid.slice(-8)}`;
}

function shortenTxHash(hash: string): string {
  if (!hash || hash.length <= 14) return hash || "—";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  11155111: "Sepolia",
  10: "Optimism",
  42161: "Arbitrum",
  8453: "Base",
  0: "Canton Native",
};

export function CantonBalancesPage() {
  const [data, setData] = useState<BalancesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadBalances = useCallback(async () => {
    try {
      const resp = await fetch("/api/canton-balances");
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const result: BalancesData = await resp.json();
      setData(result);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadBalances, 10_000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadBalances]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
          <p className="text-gray-400">Querying Canton ledger...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
            <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-white">Canton Ledger Unavailable</h3>
          <p className="text-gray-400">{error}</p>
          <button
            onClick={() => { setLoading(true); loadBalances(); }}
            className="rounded-xl bg-emerald-600 px-6 py-2 font-medium text-white transition-all hover:bg-emerald-500"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Canton mUSD"
        subtitle="Live mUSD token balances from the Canton Network ledger"
        badge="Canton"
        badgeColor="emerald"
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-600 bg-surface-800 text-emerald-500 focus:ring-emerald-500"
              />
              Auto-refresh
            </label>
            <button
              onClick={() => { setLoading(true); loadBalances(); }}
              className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 transition-all hover:bg-emerald-500/20"
            >
              <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        }
      />

      {/* Error banner (non-blocking) */}
      {error && data && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 p-3 text-sm text-yellow-400">
          ⚠ Refresh failed: {error}. Showing cached data.
        </div>
      )}

      {/* Hero Balance Card */}
      <div className="card-emerald overflow-hidden p-8">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            <p className="text-sm font-medium uppercase tracking-wider text-gray-400">Total mUSD on Canton</p>
            <p className="text-5xl font-bold text-gradient-emerald">
              {parseFloat(data.totalBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="ml-2 text-2xl text-emerald-400/60">mUSD</span>
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <span className="flex items-center gap-1.5 text-sm text-gray-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {data.tokenCount} UTXO{data.tokenCount !== 1 ? "s" : ""}
              </span>
              <span className="text-sm text-gray-500">|</span>
              <span className="text-sm text-gray-400">
                Ledger offset: {data.ledgerOffset.toLocaleString()}
              </span>
              <span className="text-sm text-gray-500">|</span>
              <span className="text-sm text-gray-400">
                {data.pendingBridgeIns} pending bridge-in{data.pendingBridgeIns !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Status Indicators */}
          <div className="space-y-3">
            <StatusPill label="Bridge Service" active={!!data.bridgeService} detail={data.bridgeService ? `Nonce: ${data.bridgeService.lastNonce}` : undefined} />
            <StatusPill label="Supply Service" active={data.supplyService} />
            <StatusPill label="Ledger API" active={true} detail={`Offset ${data.ledgerOffset}`} />
          </div>
        </div>
      </div>

      {/* Token UTXOs */}
      <Section
        title="mUSD Tokens"
        subtitle={`${data.tokenCount} active contract${data.tokenCount !== 1 ? "s" : ""} on the Canton ledger`}
        icon={
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Nonce</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">ETH Tx</th>
                <th className="px-4 py-3">Contract ID</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.tokens.map((token) => (
                <tr key={token.contractId} className="group transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-sm font-bold text-emerald-400">
                      {token.nonce}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-lg font-semibold text-white">
                      {parseFloat(token.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="ml-1 text-xs text-gray-500">mUSD</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                      {CHAIN_NAMES[token.sourceChain] || `Chain ${token.sourceChain}`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {token.ethTxHash ? (
                      <a
                        href={`https://sepolia.etherscan.io/tx/${token.ethTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-brand-400 transition-colors hover:text-brand-300"
                        title={token.ethTxHash}
                      >
                        {shortenTxHash(token.ethTxHash)} ↗
                      </a>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-500" title={token.contractId}>
                      {shortenContractId(token.contractId)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500">{formatDate(token.createdAt)}</span>
                  </td>
                </tr>
              ))}
              {data.tokens.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-500">
                    No mUSD tokens found on the ledger.
                  </td>
                </tr>
              )}
            </tbody>
            {data.tokens.length > 0 && (
              <tfoot>
                <tr className="border-t border-white/10">
                  <td className="px-4 py-3 text-sm font-medium text-gray-400">Total</td>
                  <td className="px-4 py-3">
                    <span className="text-lg font-bold text-emerald-400">
                      {parseFloat(data.totalBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="ml-1 text-xs text-gray-500">mUSD</span>
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Section>

      {/* Participant Info */}
      <Section
        title="Canton Participant"
        subtitle="Connection details for the Canton Network node"
        icon={
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
          </svg>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoCard label="Party ID" value={data.party} mono />
          <InfoCard label="Ledger Offset" value={data.ledgerOffset.toLocaleString()} />
          <InfoCard label="Last Updated" value={formatDate(data.timestamp)} />
          <InfoCard
            label="Bridge Nonce"
            value={data.bridgeService ? data.bridgeService.lastNonce.toString() : "N/A"}
          />
        </div>
      </Section>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function StatusPill({ label, active, detail }: { label: string; active: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
        <span className="text-sm text-gray-300">{label}</span>
      </div>
      {detail && <span className="text-xs text-gray-500">{detail}</span>}
    </div>
  );
}

function InfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-sm text-white ${mono ? "font-mono break-all" : ""}`}>{value}</p>
    </div>
  );
}

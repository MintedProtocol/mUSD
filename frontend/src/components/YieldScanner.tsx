/**
 * YieldScanner — AI Yield Aggregation Engine
 *
 * Displays live DeFi yield opportunities scored across multiple dimensions:
 *   • Yield (APY)      — base + reward APY
 *   • TVL              — total value locked in pool
 *   • Security         — protocol audit tier (S/A/B/D)
 *   • Liquidity        — pool depth classification
 *   • Curator          — curator/governance confidence score
 *   • Maturity         — Pendle PT expiry detection
 *
 * Also shows leveraged loop opportunities when available.
 */

import React, { useState } from "react";
import { useYieldScanner, type SortField } from "@/hooks/useYieldScanner";
import type { PoolResult, LoopResult } from "@/pages/api/yields";

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(2)}%`;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Badge components ────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    S: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    A: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    B: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    C: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    D: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold border ${colors[tier] || colors.D}`}>
      {tier}
    </span>
  );
}

function LiquidityBadge({ depth }: { depth: string }) {
  const styles: Record<string, { bg: string; label: string }> = {
    deep:     { bg: "bg-emerald-500/20 text-emerald-400", label: "🟢 Deep" },
    moderate: { bg: "bg-yellow-500/20 text-yellow-400",   label: "🟡 Moderate" },
    shallow:  { bg: "bg-red-500/20 text-red-400",         label: "🔴 Shallow" },
  };
  const s = styles[depth] || styles.shallow;
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.bg}`}>{s.label}</span>;
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    LOW:    "bg-emerald-500/20 text-emerald-400",
    MEDIUM: "bg-yellow-500/20 text-yellow-400",
    HIGH:   "bg-red-500/20 text-red-400",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${colors[level] || colors.HIGH}`}>
      {level}
    </span>
  );
}

function MaturityBadge({ expiry }: { expiry: string | null }) {
  if (!expiry) return null;
  const daysLeft = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400_000);
  const color = daysLeft <= 7 ? "text-red-400" : daysLeft <= 30 ? "text-yellow-400" : "text-gray-400";
  return (
    <span className={`text-[10px] font-semibold ${color}`}>
      PT · {expiry} ({daysLeft}d)
    </span>
  );
}

// ─── Score bar ───────────────────────────────────────────────────────────

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100);
  const color = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-blue-500" : pct >= 25 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-surface-700">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-300 font-mono">{score}</span>
    </div>
  );
}

// ─── Sort header ─────────────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  currentField,
  currentDir,
  onSort,
}: {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: "asc" | "desc";
  onSort: (f: SortField) => void;
}) {
  const active = field === currentField;
  return (
    <th
      className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500 cursor-pointer hover:text-gray-300 select-none whitespace-nowrap"
      onClick={() => onSort(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active && <span className="text-brand-400">{currentDir === "desc" ? "▼" : "▲"}</span>}
      </span>
    </th>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Pool Table
// ═══════════════════════════════════════════════════════════════════════════

function PoolTable({
  pools,
  sortField,
  sortDir,
  onSort,
}: {
  pools: PoolResult[];
  sortField: SortField;
  sortDir: "asc" | "desc";
  onSort: (f: SortField) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">#</th>
            <SortHeader label="Protocol" field="project" currentField={sortField} currentDir={sortDir} onSort={onSort} />
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Asset</th>
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Chain</th>
            <SortHeader label="APY" field="apyBase" currentField={sortField} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="TVL" field="tvlUsd" currentField={sortField} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Security" field="securityScore" currentField={sortField} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Liquidity" field="liquidityDepth" currentField={sortField} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Curator" field="curatorScore" currentField={sortField} currentDir={sortDir} onSort={onSort} />
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Maturity</th>
            <SortHeader label="Score" field="overallScore" currentField={sortField} currentDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {pools.map((p, i) => (
            <tr key={p.pool} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{i + 1}</td>
              <td className="px-3 py-2.5 font-medium text-white whitespace-nowrap">{p.project}</td>
              <td className="px-3 py-2.5 text-gray-300 font-mono text-xs whitespace-nowrap">{p.symbol}</td>
              <td className="px-3 py-2.5 text-gray-400 text-xs">{p.chain}</td>
              <td className="px-3 py-2.5">
                <div className="space-y-0.5">
                  <span className="text-emerald-400 font-semibold">{formatPct(p.apyBase)}</span>
                  {(p.apyReward ?? 0) > 0 && (
                    <span className="block text-[10px] text-purple-400">+{formatPct(p.apyReward)} reward</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-gray-300">{formatUsd(p.tvlUsd)}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <TierBadge tier={p.securityTier} />
                  <span className="text-xs text-gray-400">{p.securityScore}</span>
                </div>
              </td>
              <td className="px-3 py-2.5"><LiquidityBadge depth={p.liquidityDepth} /></td>
              <td className="px-3 py-2.5"><ScoreBar score={p.curatorScore} /></td>
              <td className="px-3 py-2.5">
                {p.isPT ? <MaturityBadge expiry={p.ptExpiry} /> : <span className="text-[10px] text-gray-600">—</span>}
              </td>
              <td className="px-3 py-2.5"><ScoreBar score={p.overallScore} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {pools.length === 0 && (
        <div className="py-12 text-center text-gray-500">No pools match current filters</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Loop Table
// ═══════════════════════════════════════════════════════════════════════════

function LoopTable({ loops }: { loops: LoopResult[] }) {
  if (loops.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🔄</span>
        <h4 className="text-sm font-semibold text-white">Leveraged Loop Opportunities</h4>
        <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-400">
          {loops.length} found
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Asset</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Supply On</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Borrow On</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Supply APY</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Borrow Rate</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Leverage</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Net APY</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">Risk</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">TVL</th>
            </tr>
          </thead>
          <tbody>
            {loops.map((l, i) => (
              <tr key={`${l.symbol}-${l.borrowProtocol}-${i}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-3 py-2.5 font-mono text-xs text-gray-300">{l.symbol}</td>
                <td className="px-3 py-2.5 text-white font-medium text-xs">{l.project}</td>
                <td className="px-3 py-2.5 text-gray-400 text-xs">{l.borrowProtocol}</td>
                <td className="px-3 py-2.5 text-emerald-400 font-semibold">{l.supplyApy.toFixed(2)}%</td>
                <td className="px-3 py-2.5 text-red-400 font-semibold">{l.borrowRate.toFixed(2)}%</td>
                <td className="px-3 py-2.5 font-mono text-xs text-gray-300">{l.leverage}×</td>
                <td className="px-3 py-2.5 text-emerald-400 font-bold">{l.netApy.toFixed(2)}%</td>
                <td className="px-3 py-2.5"><RiskBadge level={l.riskLevel} /></td>
                <td className="px-3 py-2.5 font-mono text-xs text-gray-300">{formatUsd(l.tvlUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Filter Bar
// ═══════════════════════════════════════════════════════════════════════════

function FilterBar({
  filters,
  setFilters,
  chainsScanned,
}: {
  filters: ReturnType<typeof useYieldScanner>["filters"];
  setFilters: ReturnType<typeof useYieldScanner>["setFilters"];
  chainsScanned: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {/* Chain filter */}
      <select
        className="rounded-lg border border-white/10 bg-surface-800 px-3 py-1.5 text-gray-300 focus:border-brand-500 focus:outline-none"
        value={filters.chain || ""}
        onChange={(e) => setFilters((f) => ({ ...f, chain: e.target.value || null }))}
      >
        <option value="">All Chains</option>
        {chainsScanned.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {/* Min TVL */}
      <label className="flex items-center gap-1.5 text-gray-500">
        Min TVL
        <select
          className="rounded-lg border border-white/10 bg-surface-800 px-2 py-1.5 text-gray-300 focus:outline-none"
          value={filters.minTvl}
          onChange={(e) => setFilters((f) => ({ ...f, minTvl: Number(e.target.value) }))}
        >
          <option value={500000}>$500K</option>
          <option value={1000000}>$1M</option>
          <option value={5000000}>$5M</option>
          <option value={10000000}>$10M</option>
          <option value={50000000}>$50M</option>
        </select>
      </label>

      {/* Min APY */}
      <label className="flex items-center gap-1.5 text-gray-500">
        Min APY
        <select
          className="rounded-lg border border-white/10 bg-surface-800 px-2 py-1.5 text-gray-300 focus:outline-none"
          value={filters.minApy}
          onChange={(e) => setFilters((f) => ({ ...f, minApy: Number(e.target.value) }))}
        >
          <option value={0}>Any</option>
          <option value={2}>2%+</option>
          <option value={3}>3%+</option>
          <option value={5}>5%+</option>
          <option value={8}>8%+</option>
          <option value={10}>10%+</option>
        </select>
      </label>

      {/* PT only toggle */}
      <label className="flex items-center gap-1.5 cursor-pointer text-gray-500">
        <input
          type="checkbox"
          className="rounded border-white/20 bg-surface-800 text-brand-500 focus:ring-brand-500"
          checked={filters.showPTOnly}
          onChange={(e) => setFilters((f) => ({ ...f, showPTOnly: e.target.checked }))}
        />
        PT Markets Only
      </label>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Scoring Legend
// ═══════════════════════════════════════════════════════════════════════════

function ScoringLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-white/5 bg-surface-900/50 overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-gray-400 hover:text-gray-300 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm">🧠</span>
          <span className="font-medium">How the AI Scores Opportunities</span>
        </span>
        <span className="text-gray-600">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-white/5 px-4 py-3 space-y-2 text-xs text-gray-400">
          <p>
            The AI Yield Aggregation Engine evaluates <strong className="text-white">hundreds of DeFi pools</strong> across
            Ethereum, Arbitrum, Base, Optimism, and Polygon using a proprietary multi-factor scoring algorithm:
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-3">
            <div className="rounded-lg bg-surface-800/50 p-2.5 border border-white/5">
              <p className="font-semibold text-emerald-400 mb-1">🛡 Security — 30%</p>
              <p>Protocol audit tier, bug bounty history, incident track record. S-tier = multiple audits, $1M+ bounty.</p>
            </div>
            <div className="rounded-lg bg-surface-800/50 p-2.5 border border-white/5">
              <p className="font-semibold text-green-400 mb-1">📈 Yield — 25%</p>
              <p>Base APY (organic yield only), reward incentives separated. Higher = better, capped at 20% for scoring.</p>
            </div>
            <div className="rounded-lg bg-surface-800/50 p-2.5 border border-white/5">
              <p className="font-semibold text-blue-400 mb-1">🏦 TVL / Liquidity — 20%</p>
              <p>Total value locked and pool depth. Deep ≥ $50M, Moderate ≥ $5M, Shallow &lt; $5M.</p>
            </div>
            <div className="rounded-lg bg-surface-800/50 p-2.5 border border-white/5">
              <p className="font-semibold text-purple-400 mb-1">👥 Curator — 15%</p>
              <p>Protocol governance maturity, curator reputation, team track record, community confidence.</p>
            </div>
            <div className="rounded-lg bg-surface-800/50 p-2.5 border border-white/5">
              <p className="font-semibold text-yellow-400 mb-1">⏳ Stability — 10%</p>
              <p>Weighted performance over time, oracle reliability, rate volatility, and peg consistency.</p>
            </div>
            <div className="rounded-lg bg-surface-800/50 p-2.5 border border-white/5">
              <p className="font-semibold text-orange-400 mb-1">📅 Maturity</p>
              <p>Pendle PT markets show fixed-rate expiry. Days until maturity displayed, colour-coded by urgency.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════════════

export function YieldScanner() {
  const {
    pools,
    loops,
    loading,
    error,
    scanTimestamp,
    poolsScanned,
    chainsScanned,
    filters,
    setFilters,
    sortField,
    sortDir,
    setSort,
    refresh,
  } = useYieldScanner();

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-600">
            <span className="text-lg">🔬</span>
          </div>
          <div>
            <h3 className="font-semibold text-white">AI Yield Aggregation Engine</h3>
            <p className="text-xs text-gray-500">
              Live scan of {poolsScanned.toLocaleString()} DeFi pools across {chainsScanned.length} chains
              {scanTimestamp && <> · updated {timeAgo(scanTimestamp)}</>}
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30 disabled:opacity-50"
        >
          {loading ? (
            <>
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Scanning…
            </>
          ) : (
            <>🔍 Scan Now</>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          ⚠ Scan failed: {error}
        </div>
      )}

      {/* Summary Stats */}
      {pools.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg bg-surface-800/50 p-3 border border-white/5">
            <p className="text-[10px] uppercase text-gray-500">Top APY</p>
            <p className="text-lg font-bold text-emerald-400">
              {formatPct(Math.max(...pools.map((p) => p.apyBase ?? 0)))}
            </p>
          </div>
          <div className="rounded-lg bg-surface-800/50 p-3 border border-white/5">
            <p className="text-[10px] uppercase text-gray-500">S-Tier Pools</p>
            <p className="text-lg font-bold text-white">
              {pools.filter((p) => p.securityTier === "S").length}
            </p>
          </div>
          <div className="rounded-lg bg-surface-800/50 p-3 border border-white/5">
            <p className="text-[10px] uppercase text-gray-500">PT Markets</p>
            <p className="text-lg font-bold text-white">
              {pools.filter((p) => p.isPT).length}
            </p>
          </div>
          <div className="rounded-lg bg-surface-800/50 p-3 border border-white/5">
            <p className="text-[10px] uppercase text-gray-500">Loop Strategies</p>
            <p className="text-lg font-bold text-purple-400">{loops.length}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <FilterBar filters={filters} setFilters={setFilters} chainsScanned={chainsScanned} />

      {/* Divider */}
      <div className="my-4 border-t border-white/5" />

      {/* Pool Table */}
      {loading && pools.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <svg className="h-8 w-8 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-gray-500">Scanning DeFi protocols…</p>
        </div>
      ) : (
        <PoolTable pools={pools} sortField={sortField} sortDir={sortDir} onSort={setSort} />
      )}

      {/* Loop Opportunities */}
      {filters.showLoops && loops.length > 0 && <LoopTable loops={loops} />}

      {/* Scoring Legend */}
      <div className="mt-6">
        <ScoringLegend />
      </div>
    </div>
  );
}

export default YieldScanner;

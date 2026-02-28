import React, { useState } from "react";
import { TxButton } from "@/components/TxButton";
import { useYieldOptimizer } from "@/hooks/useYieldOptimizer";
import type { StrategyScore, RecommendedAllocation, AllocationDiff, RiskPreferences } from "@/lib/yield-optimizer";

// ═══════════════════════════════════════════════════════════════════════════
// AI Yield Optimizer — Admin Panel Component
// ═══════════════════════════════════════════════════════════════════════════

interface AIYieldOptimizerProps {
  totalValueUsd: number;
  reserveBalanceUsd: number;
  /** Current on-chain strategy allocations */
  currentStrategies: { key: string; bps: number }[];
  /** Called when user clicks "Apply Recommendation" — receives the list of diffs */
  onApply?: (diffs: AllocationDiff[]) => void;
}

function Stars({ count }: { count: number }) {
  return (
    <span className="text-xs tracking-tight">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < count ? "text-amber-400" : "text-gray-700"}>
          ★
        </span>
      ))}
    </span>
  );
}

function formatPct(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function formatUsdShort(usd: number): string {
  if (Math.abs(usd) >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (Math.abs(usd) >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}

function timeSince(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function ActionBadge({ action }: { action: AllocationDiff["action"] }) {
  const styles: Record<string, string> = {
    DEPLOY: "bg-green-800/60 text-green-400",
    NEW: "bg-blue-800/60 text-blue-400",
    WITHDRAW: "bg-amber-800/60 text-amber-400",
    REMOVE: "bg-red-800/60 text-red-400",
    HOLD: "bg-gray-800/60 text-gray-500",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[action]}`}>
      {action}
    </span>
  );
}

// ── Allocation Bar ──
function AllocationBar({ allocations }: { allocations: RecommendedAllocation[] }) {
  return (
    <div className="space-y-2">
      {/* Stacked horizontal bar */}
      <div className="flex h-6 w-full overflow-hidden rounded-full">
        {allocations
          .filter((a) => a.bps > 0)
          .map((a) => (
            <div
              key={a.key}
              className="relative flex items-center justify-center text-[9px] font-bold text-white/80 transition-all"
              style={{
                width: `${a.bps / 100}%`,
                backgroundColor: a.color,
                minWidth: a.bps > 200 ? "30px" : "0px",
              }}
              title={`${a.shortName}: ${formatPct(a.bps)}`}
            >
              {a.bps >= 500 && a.shortName}
            </div>
          ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {allocations
          .filter((a) => a.bps > 0)
          .map((a) => (
            <div key={a.key} className="flex items-center gap-1.5 text-xs">
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.color }} />
              <span className="text-gray-400">{a.shortName}</span>
              <span className="font-medium text-white">{formatPct(a.bps)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Strategy Scoring Table ──
function ScoreTable({ scores }: { scores: StrategyScore[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 text-left text-gray-500">
            <th className="pb-2 pr-2">Strategy</th>
            <th className="pb-2 pr-2 text-right">Live APY</th>
            <th className="pb-2 pr-2 text-right">TVL</th>
            <th className="pb-2 pr-2 text-center">Risk</th>
            <th className="pb-2 pr-2 text-right">Gas</th>
            <th className="pb-2 pr-2 text-center">Score</th>
            <th className="pb-2 text-center">Source</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr
              key={s.key}
              className={`border-b border-gray-800/50 ${!s.eligible ? "opacity-40" : ""}`}
            >
              <td className="py-2 pr-2">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="font-medium text-white">{s.shortName}</span>
                </div>
              </td>
              <td className="py-2 pr-2 text-right font-mono text-green-400">
                {formatPct(s.liveApyBps)}
              </td>
              <td className="py-2 pr-2 text-right text-gray-400">
                {formatUsdShort(s.tvlUsd)}
              </td>
              <td className="py-2 pr-2 text-center text-gray-400">{s.riskTier}/5</td>
              <td className="py-2 pr-2 text-right text-gray-400">
                ${s.gasEstimateUsd.toFixed(2)}
              </td>
              <td className="py-2 pr-2 text-center">
                <Stars count={s.stars} />
              </td>
              <td className="py-2 text-center">
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] ${
                    s.source === "defillama"
                      ? "bg-blue-900/40 text-blue-400"
                      : "bg-gray-800 text-gray-500"
                  }`}
                >
                  {s.source === "defillama" ? "LIVE" : "EST"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Risk Preferences ──
function RiskPrefsPanel({
  prefs,
  onChange,
}: {
  prefs: RiskPreferences;
  onChange: (p: Partial<RiskPreferences>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <div>
        <label className="label">Max Risk Tier</label>
        <select
          className="input"
          value={prefs.maxRiskTier}
          onChange={(e) => onChange({ maxRiskTier: parseInt(e.target.value) })}
        >
          {[1, 2, 3, 4, 5].map((t) => (
            <option key={t} value={t}>
              {t} — {["Conservative", "Moderate", "Balanced", "Aggressive", "Degen"][t - 1]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Min TVL</label>
        <select
          className="input"
          value={prefs.minTvlUsd}
          onChange={(e) => onChange({ minTvlUsd: parseInt(e.target.value) })}
        >
          <option value={100000}>$100K</option>
          <option value={1000000}>$1M</option>
          <option value={10000000}>$10M</option>
          <option value={50000000}>$50M</option>
          <option value={100000000}>$100M</option>
        </select>
      </div>
      <div>
        <label className="label">Min APY (bps)</label>
        <input
          className="input"
          type="number"
          value={prefs.minApyBps}
          onChange={(e) => onChange({ minApyBps: parseInt(e.target.value) || 0 })}
          placeholder="300"
        />
      </div>
      <div>
        <label className="label">Gas Budget ($/tx)</label>
        <input
          className="input"
          type="number"
          value={prefs.maxGasBudgetUsd}
          onChange={(e) => onChange({ maxGasBudgetUsd: parseFloat(e.target.value) || 10 })}
          placeholder="15"
        />
      </div>
    </div>
  );
}

// ── Diff Table ──
function DiffTable({ diffs, totalValueUsd }: { diffs: AllocationDiff[]; totalValueUsd: number }) {
  const activeDiffs = diffs.filter((d) => d.action !== "HOLD");
  if (activeDiffs.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Current allocation matches the recommendation — no changes needed.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {activeDiffs.map((d) => (
        <div
          key={d.key}
          className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <ActionBadge action={d.action} />
            <span className="font-medium text-white">{d.shortName}</span>
          </div>
          <div className="flex items-center gap-4 text-gray-400">
            <span>
              {formatPct(d.currentBps)} → {formatPct(d.recommendedBps)}
            </span>
            <span
              className={`font-mono ${
                d.deltaBps > 0 ? "text-green-400" : d.deltaBps < 0 ? "text-amber-400" : ""
              }`}
            >
              {d.deltaBps > 0 ? "▲" : "▼"} {formatPct(Math.abs(d.deltaBps))}
            </span>
            <span className="w-24 text-right">
              {d.deltaUsd >= 0 ? "Deploy" : "Withdraw"} {formatUsdShort(Math.abs(d.deltaUsd))}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function AIYieldOptimizer({
  totalValueUsd,
  reserveBalanceUsd,
  currentStrategies,
  onApply,
}: AIYieldOptimizerProps) {
  const { result, loading, error, lastRefresh, prefs, setPrefs, refresh } = useYieldOptimizer(
    totalValueUsd,
    currentStrategies,
    { refreshInterval: 120_000 },
  );

  const [showPrefs, setShowPrefs] = useState(false);
  const [showDiff, setShowDiff] = useState(true);

  return (
    <div className="card space-y-4 border border-purple-800/30 bg-gradient-to-br from-gray-900 via-gray-900 to-purple-950/20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">🤖</span>
          <div>
            <h3 className="font-semibold text-gray-200">AI Yield Optimizer</h3>
            <p className="text-[11px] text-gray-500">
              Recommended allocation based on live APY, TVL, risk &amp; gas costs
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[10px] text-gray-600">
              {timeSince(lastRefresh)}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded-lg bg-purple-900/40 px-3 py-1.5 text-xs font-medium text-purple-300 transition hover:bg-purple-800/50 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 p-2 text-xs text-amber-400">
          ⚠ {error}
        </div>
      )}

      {/* Initial state — prompt to scan */}
      {!result && !loading && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-gray-400">
            Click <strong>Refresh</strong> to scan live yield data from DefiLlama and compute the
            optimal strategy allocation.
          </p>
          <button
            onClick={refresh}
            className="rounded-lg bg-purple-600 px-6 py-2 text-sm font-medium text-white transition hover:bg-purple-500"
          >
            🔍 Run AI Yield Scan
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !result && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
          <span className="animate-spin">⏳</span>
          Fetching live data from DefiLlama and computing optimal allocation…
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* ── Summary Stats ── */}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-gray-800/50 p-3 text-center">
              <p className="text-[10px] uppercase text-gray-500">Blended APY</p>
              <p className="text-lg font-bold text-green-400">{formatPct(result.blendedApyBps)}</p>
            </div>
            <div className="rounded-lg bg-gray-800/50 p-3 text-center">
              <p className="text-[10px] uppercase text-gray-500">Est. Annual Yield</p>
              <p className="text-lg font-bold text-white">{formatUsdShort(result.estimatedYieldUsd)}</p>
            </div>
            <div className="rounded-lg bg-gray-800/50 p-3 text-center">
              <p className="text-[10px] uppercase text-gray-500">Avg Risk</p>
              <p className="text-lg font-bold text-amber-400">{result.avgRisk}/5</p>
            </div>
            <div className="rounded-lg bg-gray-800/50 p-3 text-center">
              <p className="text-[10px] uppercase text-gray-500">Rebalance Gas</p>
              <p className="text-lg font-bold text-gray-300">${result.totalGasUsd}</p>
            </div>
          </div>

          {/* ── Recommended Allocation Bar ── */}
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase text-gray-500">
              Recommended Allocation
            </h4>
            <AllocationBar allocations={result.allocations} />
          </div>

          {/* ── Strategy Scoring Table ── */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase text-gray-500">Strategy Scoring</h4>
              <span className="text-[10px] text-gray-600">
                Sources: DefiLlama, on-chain • {result.scores.filter((s) => s.source === "defillama").length} live,{" "}
                {result.scores.filter((s) => s.source === "fallback").length} estimated
              </span>
            </div>
            <ScoreTable scores={result.scores} />
          </div>

          {/* ── Risk Preferences (collapsible) ── */}
          <div>
            <button
              onClick={() => setShowPrefs(!showPrefs)}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition"
            >
              <span className={`transition-transform ${showPrefs ? "rotate-90" : ""}`}>▸</span>
              Risk Preferences
            </button>
            {showPrefs && (
              <div className="mt-2">
                <RiskPrefsPanel prefs={prefs} onChange={setPrefs} />
                <button
                  onClick={refresh}
                  className="mt-2 text-xs text-purple-400 hover:underline"
                >
                  Re-compute with new preferences
                </button>
              </div>
            )}
          </div>

          {/* ── Diff vs Current ── */}
          <div>
            <button
              onClick={() => setShowDiff(!showDiff)}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition"
            >
              <span className={`transition-transform ${showDiff ? "rotate-90" : ""}`}>▸</span>
              Diff vs Current Allocation
              {result.diffs.filter((d) => d.action !== "HOLD").length > 0 && (
                <span className="ml-1 rounded bg-amber-800/40 px-1.5 py-0.5 text-[10px] text-amber-400">
                  {result.diffs.filter((d) => d.action !== "HOLD").length} changes
                </span>
              )}
            </button>
            {showDiff && (
              <div className="mt-2">
                <DiffTable diffs={result.diffs} totalValueUsd={totalValueUsd} />
                {result.diffs.some((d) => d.action !== "HOLD") && (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-gray-800/30 px-3 py-1.5 text-[10px] text-gray-500">
                    <span>
                      Estimated yield change:{" "}
                      <span className="text-green-400">
                        +{formatUsdShort(result.estimatedYieldUsd)}/yr
                      </span>
                    </span>
                    <span>Gas cost: ~${result.totalGasUsd}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Action Buttons ── */}
          {onApply && result.diffs.some((d) => d.action !== "HOLD") && (
            <div className="grid gap-2 sm:grid-cols-2">
              <TxButton
                onClick={() => onApply(result.diffs.filter((d) => d.action !== "HOLD"))}
                loading={false}
                className="w-full"
              >
                Apply AI Recommendation
              </TxButton>
              <button
                onClick={() => {
                  const lines = result.diffs
                    .filter((d) => d.action !== "HOLD")
                    .map(
                      (d) =>
                        `${d.action} ${d.shortName}: ${formatPct(d.currentBps)} → ${formatPct(d.recommendedBps)} (${
                          d.deltaUsd >= 0 ? "+" : ""
                        }${formatUsdShort(d.deltaUsd)})`,
                    );
                  alert("Dry Run Preview:\n\n" + lines.join("\n"));
                }}
                className="w-full rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700"
              >
                Preview Transactions (dry run)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default AIYieldOptimizer;

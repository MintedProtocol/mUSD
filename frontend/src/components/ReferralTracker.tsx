import React from "react";
import { useReferral } from "@/hooks/useReferral";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { StatCard } from "@/components/StatCard";

/**
 * ReferralTracker — full-page referral tracking panel for the Points page.
 * Shows personal referral tree, earnings breakdown, tier progress, and chain.
 */
export function ReferralTracker() {
  const { address, isConnected } = useUnifiedWallet();
  const {
    isLoading,
    isReferred,
    referrer,
    myCodes,
    dashboard,
    tiers,
    totalReferrers,
    totalLinks,
  } = useReferral();

  if (!isConnected || !dashboard) {
    return (
      <div className="rounded-xl border border-white/10 bg-surface-900/50 p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
          <svg className="h-8 w-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white">Connect to view your referral stats</h3>
        <p className="mt-2 text-sm text-gray-400">
          Track your referrals, TVL contribution, and bonus point multiplier
        </p>
      </div>
    );
  }

  // Find current and next tier
  const currentTier = tiers.find((t) => dashboard.referredTvlRaw >= t.minTvl);
  const nextTierIdx = currentTier ? tiers.indexOf(currentTier) - 1 : tiers.length - 1;
  const nextTier = nextTierIdx >= 0 ? tiers[nextTierIdx] : null;

  const progressPct = nextTier
    ? Math.min(100, Number((dashboard.referredTvlRaw * 100n) / (nextTier.minTvl || 1n)))
    : 100;

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Your Referees"
          value={String(dashboard.numReferees)}
          color="blue"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <StatCard
          label="Referred TVL"
          value={dashboard.referredTvl}
          color="green"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Bonus Points"
          value={dashboard.kickbackPts}
          color="yellow"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          }
        />
        <StatCard
          label="Multiplier"
          value={dashboard.multiplier}
          color="purple"
          variant="glow"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
      </div>

      {/* Tier Progress */}
      <div className="rounded-xl border border-white/10 bg-surface-900/50 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Multiplier Progress</h3>
          {nextTier && (
            <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-400">
              Next: {nextTier.multiplierLabel}
            </span>
          )}
        </div>

        {/* Tier visualization */}
        <div className="relative mb-6">
          <div className="h-3 w-full overflow-hidden rounded-full bg-surface-700">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* Tier markers */}
          <div className="mt-2 flex justify-between text-xs text-gray-500">
            <span>Base</span>
            {[...tiers].reverse().map((tier, i) => (
              <span
                key={i}
                className={
                  dashboard.referredTvlRaw >= tier.minTvl
                    ? "font-semibold text-amber-400"
                    : ""
                }
              >
                {tier.label}
              </span>
            ))}
          </div>
        </div>

        {/* Tier breakdown table */}
        <div className="overflow-hidden rounded-lg border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-surface-800/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Tier</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Min TVL</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Multiplier</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, i) => {
                const isActive = dashboard.referredTvlRaw >= tier.minTvl;
                const isCurrent =
                  isActive &&
                  (i === 0 || dashboard.referredTvlRaw < tiers[i - 1].minTvl);
                return (
                  <tr
                    key={i}
                    className={`border-b border-white/5 transition-colors ${
                      isCurrent ? "bg-amber-500/10" : isActive ? "bg-emerald-500/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2 w-2 rounded-full ${
                            isCurrent
                              ? "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                              : isActive
                              ? "bg-emerald-400"
                              : "bg-gray-600"
                          }`}
                        />
                        <span className={isCurrent ? "font-semibold text-white" : "text-gray-300"}>
                          Tier {tiers.length - i}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{tier.label}</td>
                    <td className="px-4 py-3 text-right font-semibold text-amber-400">
                      {tier.multiplierLabel}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isCurrent ? (
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-400">
                          CURRENT
                        </span>
                      ) : isActive ? (
                        <span className="text-xs text-emerald-400">✓ Unlocked</span>
                      ) : (
                        <span className="text-xs text-gray-600">Locked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Referee List */}
      {dashboard.referees.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-surface-900/50 p-6">
          <h3 className="mb-4 text-lg font-semibold text-white">
            Your Referees ({dashboard.numReferees})
          </h3>
          <div className="space-y-2">
            {dashboard.referees.map((addr, i) => (
              <div
                key={addr}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-surface-800/30 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-500 text-xs font-bold text-white">
                    {i + 1}
                  </div>
                  <span className="font-mono text-sm text-gray-300">
                    {addr.slice(0, 6)}…{addr.slice(-4)}
                  </span>
                </div>
                <a
                  href={`https://etherscan.io/address/${addr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-400 hover:underline"
                >
                  Etherscan ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Your Referral Chain */}
      {isReferred && referrer && (
        <div className="rounded-xl border border-white/10 bg-surface-900/50 p-6">
          <h3 className="mb-4 text-lg font-semibold text-white">Your Referral Chain</h3>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
              ↑
            </div>
            <div>
              <p className="text-sm text-gray-300">
                Referred by{" "}
                <span className="font-mono text-white">
                  {referrer.slice(0, 6)}…{referrer.slice(-4)}
                </span>
              </p>
              <p className="text-xs text-gray-500">
                They earn 10% bonus on your points
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Global Stats */}
      <div className="flex items-center justify-center gap-6 text-xs text-gray-600">
        <span>Protocol Referrers: {totalReferrers.toLocaleString()}</span>
        <span>•</span>
        <span>Total Links: {totalLinks.toLocaleString()}</span>
      </div>
    </div>
  );
}

export default ReferralTracker;

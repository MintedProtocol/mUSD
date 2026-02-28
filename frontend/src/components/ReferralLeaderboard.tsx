import React, { useState, useEffect } from "react";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { CONTRACTS } from "@/lib/config";
import { ethers } from "ethers";

/**
 * ReferralLeaderboard — top referrers ranked by referred TVL & bonus points.
 * Reads events from ReferralRegistry to build a global ranking.
 */

interface LeaderboardEntry {
  rank: number;
  address: string;
  referees: number;
  referredTvl: string;
  multiplier: string;
  bonusPoints: string;
  isYou: boolean;
}

// Minimal ABI for leaderboard reads
const REGISTRY_ABI = [
  "function referrerStats(address) view returns (uint32 totalReferees, uint256 totalReferredTvl, uint256 totalKickbackPts)",
  "function getMultiplier(address) view returns (uint256)",
  "function totalReferrers() view returns (uint256)",
  "function totalLinks() view returns (uint256)",
  "event ReferralLinked(address indexed referee, address indexed referrer, bytes32 indexed codeHash)",
];

function formatTvl(raw: bigint): string {
  const n = Number(ethers.formatUnits(raw, 18));
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatMultiplier(raw: bigint): string {
  return `${Number(ethers.formatUnits(raw, 18)).toFixed(1)}x`;
}

export function ReferralLeaderboard() {
  const { address, isConnected, getContract, provider } = useUnifiedWallet();

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"all" | "30d" | "7d">("all");
  const [userRank, setUserRank] = useState<LeaderboardEntry | null>(null);

  const contractAddr = CONTRACTS.ReferralRegistry;

  useEffect(() => {
    async function loadLeaderboard() {
      if (!contractAddr || !provider) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const contract = getContract(contractAddr, REGISTRY_ABI);
        if (!contract) return;

        // Get all ReferralLinked events to discover referrers
        const filter = contract.filters.ReferralLinked();
        const events = await contract.queryFilter(filter, -200000);

        // Collect unique referrers
        const referrerSet = new Set<string>();
        for (const event of events) {
          const e = event as ethers.EventLog;
          if (e.args?.[1]) {
            referrerSet.add(e.args[1] as string);
          }
        }

        // Batch fetch stats for each referrer
        const referrers = Array.from(referrerSet);
        const statsPromises = referrers.map(async (addr) => {
          const [stats, mult] = await Promise.all([
            contract.referrerStats(addr),
            contract.getMultiplier(addr),
          ]);
          return {
            address: addr,
            referees: Number(stats.totalReferees),
            referredTvlRaw: stats.totalReferredTvl as bigint,
            referredTvl: formatTvl(stats.totalReferredTvl),
            multiplierRaw: mult as bigint,
            multiplier: formatMultiplier(mult),
            bonusPointsRaw: stats.totalKickbackPts as bigint,
            bonusPoints: Number(stats.totalKickbackPts).toLocaleString(),
          };
        });

        const allStats = await Promise.all(statsPromises);

        // Sort by referred TVL descending
        allStats.sort((a, b) => {
          if (b.referredTvlRaw > a.referredTvlRaw) return 1;
          if (b.referredTvlRaw < a.referredTvlRaw) return -1;
          return 0;
        });

        // Build leaderboard
        const board: LeaderboardEntry[] = allStats.slice(0, 50).map((s, i) => ({
          rank: i + 1,
          address: s.address,
          referees: s.referees,
          referredTvl: s.referredTvl,
          multiplier: s.multiplier,
          bonusPoints: s.bonusPoints,
          isYou: address ? s.address.toLowerCase() === address.toLowerCase() : false,
        }));

        setEntries(board);

        // Find user rank
        if (address) {
          const idx = allStats.findIndex(
            (s) => s.address.toLowerCase() === address.toLowerCase()
          );
          if (idx >= 0) {
            setUserRank({
              rank: idx + 1,
              address: allStats[idx].address,
              referees: allStats[idx].referees,
              referredTvl: allStats[idx].referredTvl,
              multiplier: allStats[idx].multiplier,
              bonusPoints: allStats[idx].bonusPoints,
              isYou: true,
            });
          }
        }
      } catch (err) {
        console.error("[Leaderboard] Failed to load:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadLeaderboard();
  }, [contractAddr, provider, address, getContract, timeRange]);

  const medalColors = [
    "from-yellow-400 to-amber-600",   // 🥇
    "from-gray-300 to-gray-500",      // 🥈
    "from-amber-600 to-orange-800",   // 🥉
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Referral Leaderboard</h3>
          <p className="text-sm text-gray-400">Top referrers by TVL contributed</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-800/50 p-1">
          {(["all", "30d", "7d"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                timeRange === range
                  ? "bg-brand-500 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {range === "all" ? "All Time" : range === "30d" ? "30D" : "7D"}
            </button>
          ))}
        </div>
      </div>

      {/* Your Position (sticky banner) */}
      {userRank && (
        <div className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20 text-lg font-bold text-amber-400">
                #{userRank.rank}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Your Position</p>
                <p className="text-xs text-gray-400">
                  {userRank.referees} referees · {userRank.referredTvl} TVL
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-amber-400">{userRank.multiplier}</p>
              <p className="text-xs text-gray-500">{userRank.bonusPoints} bonus pts</p>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <svg className="h-8 w-8 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-surface-900/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-800">
            <svg className="h-8 w-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h4 className="text-lg font-semibold text-gray-300">No referrers yet</h4>
          <p className="mt-2 text-sm text-gray-500">
            Be the first to invite friends and top the leaderboard!
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-surface-800/50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Rank
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Referrer
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                  Referees
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Referred TVL
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Multiplier
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Bonus Points
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {entries.map((entry) => (
                <tr
                  key={entry.address}
                  className={`transition-colors ${
                    entry.isYou
                      ? "bg-amber-500/10 hover:bg-amber-500/15"
                      : "hover:bg-surface-800/30"
                  }`}
                >
                  <td className="px-4 py-3.5">
                    {entry.rank <= 3 ? (
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${
                          medalColors[entry.rank - 1]
                        } text-sm font-bold text-white`}
                      >
                        {entry.rank}
                      </div>
                    ) : (
                      <span className="pl-2 text-sm font-medium text-gray-400">
                        {entry.rank}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-300">
                        {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                      </span>
                      {entry.isYou && (
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                          YOU
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center text-sm text-gray-300">
                    {entry.referees}
                  </td>
                  <td className="px-4 py-3.5 text-right text-sm font-medium text-white">
                    {entry.referredTvl}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-400">
                      {entry.multiplier}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right text-sm font-medium text-emerald-400">
                    {entry.bonusPoints}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ReferralLeaderboard;

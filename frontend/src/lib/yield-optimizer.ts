// ═══════════════════════════════════════════════════════════════════════════
// AI Yield Optimizer — scoring, allocation, and diff computation
// ═══════════════════════════════════════════════════════════════════════════
// Fetches live APY data from DefiLlama, scores each strategy by risk-adjusted
// yield, and computes an optimal BPS allocation + diff vs current on-chain state.
// ═══════════════════════════════════════════════════════════════════════════

// ── DefiLlama pool IDs mapped to our strategy contracts ──
// These are stable identifiers from https://yields.llama.fi/pools
// Update if DefiLlama changes pool IDs (they rarely do)
export const DEFILLAMA_POOL_MAP: Record<string, string[]> = {
  fluid:    ["747c1d2a-c668-4571-a395-22f10e465f03"], // syrupUSDC/USDC
  pendle:   ["9cfeb00e-5bba-43ae-84ce-1e5e8ccfe2bd"], // PT-sUSDe, representative
  morpho:   ["d5b88f07-ae05-42e3-a7a1-dfd20fbfc52e"], // Morpho Blue USDC
  euler:    ["c4f3093c-29e4-4bb5-a265-b8b6bc39e8dc"], // Euler V2 USDC
  aave:     ["aa70268e-4b52-42bf-a116-608b370f9501"], // Aave V3 USDC Ethereum
  compound: ["cefa9bb8-c230-459a-a855-3b94571c9a07"], // Compound V3 USDC
  contango: [],                                         // No standard pool — use fallback
  sky:      ["c139da29-e2f8-4e88-8e84-1eed40115754"], // sUSDS
  eulerCross: [],                                       // RLUSD/USDC — no pool yet
};

// ── Types ──

export interface RiskPreferences {
  maxRiskTier: number;    // 1-5 (1=safest)
  minTvlUsd: number;      // minimum TVL to consider
  minApyBps: number;      // minimum APY in basis points
  maxGasBudgetUsd: number; // max acceptable gas per deploy tx
  reserveBps: number;      // forced reserve (e.g. 500 = 5%)
}

export const DEFAULT_RISK_PREFS: RiskPreferences = {
  maxRiskTier: 3,
  minTvlUsd: 1_000_000,
  minApyBps: 300,
  maxGasBudgetUsd: 15,
  reserveBps: 500,
};

export interface StrategyScore {
  key: string;
  name: string;
  shortName: string;
  color: string;
  liveApyBps: number;
  tvlUsd: number;
  riskTier: number;
  gasEstimateUsd: number;
  score: number;          // 0-100 composite
  stars: number;          // 1-5
  eligible: boolean;      // passes risk prefs
  source: "defillama" | "fallback";
}

export interface RecommendedAllocation {
  key: string;
  shortName: string;
  color: string;
  bps: number;            // recommended basis points
  amountUsd: number;      // $ at current total value
}

export interface AllocationDiff {
  key: string;
  shortName: string;
  currentBps: number;
  recommendedBps: number;
  deltaBps: number;
  deltaUsd: number;
  action: "DEPLOY" | "WITHDRAW" | "NEW" | "REMOVE" | "HOLD";
}

export interface OptimizerResult {
  scores: StrategyScore[];
  allocations: RecommendedAllocation[];
  diffs: AllocationDiff[];
  blendedApyBps: number;
  avgRisk: number;
  estimatedYieldUsd: number; // annual
  totalGasUsd: number;
  scannedAt: Date;
  errors: string[];
}

// ── Strategy Metadata (mirrors AdminPage catalog) ──

interface StrategyMeta {
  key: string;
  name: string;
  shortName: string;
  color: string;
  riskTier: number;       // 1=safest (Aave), 5=riskiest
  gasEstimateUsd: number; // typical deploy tx gas cost
  fallbackApyBps: number; // used when DefiLlama has no data
}

const STRATEGY_META: StrategyMeta[] = [
  { key: "fluid",      name: "Fluid Stable Loop #146",          shortName: "Fluid #146",    color: "#06b6d4", riskTier: 2, gasEstimateUsd: 3.20, fallbackApyBps: 1430 },
  { key: "pendle",     name: "Pendle Multi-Pool",               shortName: "Pendle",        color: "#8b5cf6", riskTier: 2, gasEstimateUsd: 4.80, fallbackApyBps: 1170 },
  { key: "morpho",     name: "Morpho Leveraged Loop",           shortName: "Morpho",        color: "#3b82f6", riskTier: 2, gasEstimateUsd: 2.10, fallbackApyBps: 1150 },
  { key: "eulerCross", name: "Euler V2 RLUSD/USDC Cross-Stable",shortName: "Euler xStable", color: "#10b981", riskTier: 3, gasEstimateUsd: 3.60, fallbackApyBps: 1000 },
  { key: "aave",       name: "Aave V3 Loop",                    shortName: "Aave V3",       color: "#a855f7", riskTier: 1, gasEstimateUsd: 1.90, fallbackApyBps: 750  },
  { key: "compound",   name: "Compound V3 Loop",                shortName: "Compound",      color: "#22c55e", riskTier: 1, gasEstimateUsd: 1.80, fallbackApyBps: 650  },
  { key: "contango",   name: "Contango Perp Loop",              shortName: "Contango",      color: "#f59e0b", riskTier: 3, gasEstimateUsd: 5.40, fallbackApyBps: 1100 },
  { key: "euler",      name: "Euler V2 Loop",                   shortName: "Euler V2",      color: "#14b8a6", riskTier: 2, gasEstimateUsd: 3.10, fallbackApyBps: 850  },
  { key: "sky",        name: "Sky sUSDS Savings",               shortName: "Sky sUSDS",     color: "#f97316", riskTier: 1, gasEstimateUsd: 1.20, fallbackApyBps: 790  },
];

// ── DefiLlama Fetch ──

interface DefiLlamaPool {
  pool: string;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  tvlUsd: number;
  project: string;
  chain: string;
  symbol: string;
}

async function fetchDefiLlamaPools(): Promise<Map<string, DefiLlamaPool>> {
  const poolIds = Object.values(DEFILLAMA_POOL_MAP).flat().filter(Boolean);
  if (poolIds.length === 0) return new Map();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const resp = await fetch("https://yields.llama.fi/pools", {
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`DefiLlama HTTP ${resp.status}`);

    const json = (await resp.json()) as { data?: DefiLlamaPool[] };
    if (!json.data) throw new Error("Missing data array");

    const map = new Map<string, DefiLlamaPool>();
    for (const pool of json.data) {
      if (poolIds.includes(pool.pool)) {
        map.set(pool.pool, pool);
      }
    }
    return map;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Scoring Engine ──

function scoreStrategy(
  meta: StrategyMeta,
  liveApyBps: number,
  tvlUsd: number,
  source: "defillama" | "fallback",
  prefs: RiskPreferences,
): StrategyScore {
  // Composite score: 40% risk-adjusted yield + 25% TVL depth + 20% security + 15% gas efficiency
  const yieldScore = Math.min(100, (liveApyBps / 2000) * 100); // 20% = perfect score
  const riskAdjustedYield = yieldScore * (1 - (meta.riskTier - 1) * 0.15); // penalty per risk tier
  const tvlScore = Math.min(100, (tvlUsd / 500_000_000) * 100);
  const securityScore = Math.max(0, 100 - (meta.riskTier - 1) * 20);
  const gasScore = Math.max(0, 100 - (meta.gasEstimateUsd / prefs.maxGasBudgetUsd) * 50);

  const composite =
    riskAdjustedYield * 0.40 +
    tvlScore * 0.25 +
    securityScore * 0.20 +
    gasScore * 0.15;

  const score = Math.round(Math.min(100, Math.max(0, composite)));
  const stars = score >= 80 ? 5 : score >= 65 ? 4 : score >= 50 ? 3 : score >= 35 ? 2 : 1;

  const eligible =
    meta.riskTier <= prefs.maxRiskTier &&
    tvlUsd >= prefs.minTvlUsd &&
    liveApyBps >= prefs.minApyBps &&
    meta.gasEstimateUsd <= prefs.maxGasBudgetUsd;

  return {
    key: meta.key,
    name: meta.name,
    shortName: meta.shortName,
    color: meta.color,
    liveApyBps,
    tvlUsd,
    riskTier: meta.riskTier,
    gasEstimateUsd: meta.gasEstimateUsd,
    score,
    stars,
    eligible,
    source,
  };
}

// ── Allocation Optimizer ──
// Uses a score-weighted proportional allocation with reserve carve-out.

function computeAllocations(
  scores: StrategyScore[],
  totalValueUsd: number,
  prefs: RiskPreferences,
): RecommendedAllocation[] {
  const eligible = scores.filter((s) => s.eligible);
  if (eligible.length === 0) {
    return [{ key: "reserve", shortName: "Reserve", color: "#6b7280", bps: 10000, amountUsd: totalValueUsd }];
  }

  const reserveBps = prefs.reserveBps;
  const deployableBps = 10000 - reserveBps;

  // Score-weighted proportional
  const totalScore = eligible.reduce((sum, s) => sum + s.score, 0);
  const rawAllocations = eligible.map((s) => ({
    key: s.key,
    shortName: s.shortName,
    color: s.color,
    rawBps: Math.round((s.score / totalScore) * deployableBps),
  }));

  // Normalize to ensure sum == deployableBps
  const rawSum = rawAllocations.reduce((s, a) => s + a.rawBps, 0);
  const delta = deployableBps - rawSum;
  if (rawAllocations.length > 0) rawAllocations[0].rawBps += delta; // adjust largest

  const allocations: RecommendedAllocation[] = rawAllocations.map((a) => ({
    key: a.key,
    shortName: a.shortName,
    color: a.color,
    bps: a.rawBps,
    amountUsd: (a.rawBps / 10000) * totalValueUsd,
  }));

  // Add reserve
  allocations.push({
    key: "reserve",
    shortName: "Reserve",
    color: "#6b7280",
    bps: reserveBps,
    amountUsd: (reserveBps / 10000) * totalValueUsd,
  });

  return allocations.sort((a, b) => b.bps - a.bps);
}

// ── Diff Computation ──

export function computeDiffs(
  recommended: RecommendedAllocation[],
  currentOnChain: { key: string; bps: number }[],
  totalValueUsd: number,
): AllocationDiff[] {
  const currentMap = new Map(currentOnChain.map((c) => [c.key, c.bps]));
  const recMap = new Map(recommended.filter((r) => r.key !== "reserve").map((r) => [r.key, r]));

  const diffs: AllocationDiff[] = [];

  // Strategies in recommendation
  for (const [key, rec] of recMap) {
    const currentBps = currentMap.get(key) ?? 0;
    const deltaBps = rec.bps - currentBps;
    const deltaUsd = (deltaBps / 10000) * totalValueUsd;
    let action: AllocationDiff["action"] = "HOLD";
    if (currentBps === 0 && rec.bps > 0) action = "NEW";
    else if (deltaBps > 50) action = "DEPLOY";
    else if (deltaBps < -50) action = "WITHDRAW";

    diffs.push({
      key,
      shortName: rec.shortName,
      currentBps,
      recommendedBps: rec.bps,
      deltaBps,
      deltaUsd,
      action,
    });
  }

  // Strategies on-chain but NOT in recommendation → REMOVE
  for (const [key, bps] of currentMap) {
    if (!recMap.has(key) && key !== "reserve") {
      diffs.push({
        key,
        shortName: key,
        currentBps: bps,
        recommendedBps: 0,
        deltaBps: -bps,
        deltaUsd: -(bps / 10000) * totalValueUsd,
        action: "REMOVE",
      });
    }
  }

  return diffs.sort((a, b) => Math.abs(b.deltaBps) - Math.abs(a.deltaBps));
}

// ── Main Optimizer Entry Point ──

export async function runOptimizer(
  prefs: RiskPreferences,
  totalValueUsd: number,
  currentOnChain: { key: string; bps: number }[],
): Promise<OptimizerResult> {
  const errors: string[] = [];

  // 1. Fetch live data
  let poolMap = new Map<string, DefiLlamaPool>();
  try {
    poolMap = await fetchDefiLlamaPools();
  } catch (err) {
    errors.push(`DefiLlama fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Score each strategy
  const scores: StrategyScore[] = STRATEGY_META.map((meta) => {
    const poolIds = DEFILLAMA_POOL_MAP[meta.key] || [];
    let liveApyBps = meta.fallbackApyBps;
    let tvlUsd = 50_000_000; // fallback
    let source: "defillama" | "fallback" = "fallback";

    for (const pid of poolIds) {
      const pool = poolMap.get(pid);
      if (pool) {
        const apy = pool.apyBase ?? pool.apy ?? 0;
        liveApyBps = Math.round(apy * 100); // percent → bps
        tvlUsd = pool.tvlUsd;
        source = "defillama";
        break;
      }
    }

    return scoreStrategy(meta, liveApyBps, tvlUsd, source, prefs);
  });

  scores.sort((a, b) => b.score - a.score);

  // 3. Compute optimal allocation
  const allocations = computeAllocations(scores, totalValueUsd, prefs);

  // 4. Diff vs current
  const diffs = computeDiffs(allocations, currentOnChain, totalValueUsd);

  // 5. Summary metrics
  const eligible = scores.filter((s) => s.eligible);
  const blendedApyBps = allocations
    .filter((a) => a.key !== "reserve")
    .reduce((sum, a) => {
      const score = scores.find((s) => s.key === a.key);
      return sum + (score ? (a.bps / 10000) * score.liveApyBps : 0);
    }, 0);

  const avgRisk =
    eligible.length > 0
      ? eligible.reduce((s, e) => s + e.riskTier, 0) / eligible.length
      : 0;

  const estimatedYieldUsd = (blendedApyBps / 10000) * totalValueUsd;

  const totalGasUsd = diffs
    .filter((d) => d.action !== "HOLD")
    .reduce((sum, d) => {
      const s = scores.find((sc) => sc.key === d.key);
      return sum + (s?.gasEstimateUsd ?? 3);
    }, 0);

  return {
    scores,
    allocations,
    diffs,
    blendedApyBps: Math.round(blendedApyBps),
    avgRisk: Math.round(avgRisk * 10) / 10,
    estimatedYieldUsd: Math.round(estimatedYieldUsd),
    totalGasUsd: Math.round(totalGasUsd * 100) / 100,
    scannedAt: new Date(),
    errors,
  };
}

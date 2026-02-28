/**
 * /api/yields — Next.js API route
 *
 * Fetches live stablecoin yield data from DefiLlama, scores & ranks pools,
 * detects Pendle PT maturities, and computes leveraged-loop opportunities.
 *
 * Query params:
 *   ?limit=N           — max pools to return (default 20)
 *   ?chain=Ethereum     — filter by chain
 *   ?minTvl=1000000     — minimum TVL filter (default 1 000 000)
 *   ?minApy=3           — minimum APY filter (default 3%)
 *   ?loops=true         — include loop opportunities
 */

import type { NextApiRequest, NextApiResponse } from "next";

// ─── Types ───────────────────────────────────────────────────────────────

export interface PoolResult {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apy: number | null;
  stablecoin: boolean;
  securityScore: number;
  securityTier: string;
  curatorScore: number;
  overallScore: number;
  isPT: boolean;
  ptExpiry: string | null;
  liquidityDepth: string; // "deep" | "moderate" | "shallow"
}

export interface LoopResult {
  symbol: string;
  project: string;
  chain: string;
  borrowProtocol: string;
  supplyApy: number;
  borrowRate: number;
  ltv: number;
  loops: number;
  leverage: number;
  netApy: number;
  riskLevel: string;
  tvlUsd: number;
}

export interface YieldScanResponse {
  pools: PoolResult[];
  loops: LoopResult[];
  scanTimestamp: number;
  poolsScanned: number;
  chainsScanned: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────

const DEFI_LLAMA_URL = "https://yields.llama.fi/pools";

const STABLECOIN_KEYWORDS = [
  "usdc", "usdt", "dai", "usde", "susde", "frax", "lusd", "gusd",
  "musd", "gho", "cusd", "pyusd", "usdm", "usdd", "tusd",
  "susd", "usds", "susds", "usd+", "rlusd", "usda",
];

const SCAN_CHAINS = ["Ethereum", "Arbitrum", "Base", "Optimism", "Polygon"];

const PROTOCOL_SECURITY: Record<string, { score: number; tier: string }> = {
  "aave-v3":          { score: 95, tier: "S" },
  "compound-v3":      { score: 92, tier: "S" },
  "morpho-blue":      { score: 90, tier: "S" },
  "sky-savings-rate":  { score: 90, tier: "S" },
  "lido":             { score: 93, tier: "S" },
  "rocket-pool":      { score: 90, tier: "S" },
  "spark":            { score: 88, tier: "A" },
  "pendle":           { score: 88, tier: "A" },
  "curve-dex":        { score: 85, tier: "A" },
  "frax-lend":        { score: 85, tier: "A" },
  "fluid":            { score: 80, tier: "A" },
  "euler":            { score: 78, tier: "B" },
  "ethena":           { score: 75, tier: "B" },
  "contango":         { score: 72, tier: "B" },
  "default":          { score: 40, tier: "D" },
};

const BORROW_RATES: Record<string, number> = {
  "aave-v3":     3.5,
  "morpho-blue": 6.0,
  "compound-v3": 4.2,
  "spark":       5.5,
};

interface RawPool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apy: number | null;
  stablecoin: boolean;
  exposure: string;
  poolMeta: string | null;
}

// ─── In-memory cache (60s TTL) ──────────────────────────────────────────

let cachedResult: YieldScanResponse | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

// ─── Handler ─────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<YieldScanResponse | { error: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const now = Date.now();
    if (!cachedResult || now - cacheTimestamp > CACHE_TTL_MS) {
      cachedResult = await fetchAndScore();
      cacheTimestamp = now;
    }

    // Apply query-param filters
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
    const chainFilter = req.query.chain ? String(req.query.chain).toLowerCase() : null;
    const minTvl = Number(req.query.minTvl || "1000000");
    const minApy = Number(req.query.minApy || "3");
    const includeLoops = req.query.loops === "true";

    let pools = cachedResult.pools;
    if (chainFilter) pools = pools.filter((p) => p.chain.toLowerCase() === chainFilter);
    if (minTvl > 0)  pools = pools.filter((p) => p.tvlUsd >= minTvl);
    if (minApy > 0)  pools = pools.filter((p) => (p.apyBase ?? p.apy ?? 0) >= minApy);
    pools = pools.slice(0, limit);

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      pools,
      loops: includeLoops ? cachedResult.loops : [],
      scanTimestamp: cachedResult.scanTimestamp,
      poolsScanned: cachedResult.poolsScanned,
      chainsScanned: SCAN_CHAINS,
    });
  } catch (err) {
    console.error("[api/yields] Error:", err);
    return res.status(500).json({ error: "Failed to fetch yield data" });
  }
}

// ─── Core logic ──────────────────────────────────────────────────────────

async function fetchAndScore(): Promise<YieldScanResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let resp: Response;
  try {
    resp = await fetch(DEFI_LLAMA_URL, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) throw new Error(`DefiLlama ${resp.status}`);

  const text = await resp.text();
  if (text.length > 50 * 1024 * 1024) throw new Error("Response too large");

  const json = JSON.parse(text) as { data?: RawPool[] };
  if (!json.data || !Array.isArray(json.data)) throw new Error("Missing data array");

  const allPools = json.data;

  // Filter stablecoin pools on target chains
  const filtered = allPools.filter((p) => {
    if (!SCAN_CHAINS.some((c) => c.toLowerCase() === p.chain.toLowerCase())) return false;
    if (p.tvlUsd < 500_000) return false; // lower floor; query params filter further
    const sym = p.symbol.toLowerCase();
    return STABLECOIN_KEYWORDS.some((kw) => sym.includes(kw));
  });

  // Score each pool
  const scored: PoolResult[] = filtered.map((p) => {
    const key = p.project.toLowerCase().replace(/\s+/g, "-");
    const sec = PROTOCOL_SECURITY[key] || PROTOCOL_SECURITY["default"];
    const tvlScore = Math.min(100, (p.tvlUsd / 100_000_000) * 100);
    const apyScore = Math.min(100, ((p.apyBase ?? 0) / 20) * 100);

    // Liquidity depth classification
    let liquidityDepth: "deep" | "moderate" | "shallow";
    if (p.tvlUsd >= 50_000_000)      liquidityDepth = "deep";
    else if (p.tvlUsd >= 5_000_000)  liquidityDepth = "moderate";
    else                              liquidityDepth = "shallow";

    // Curator score: security + maturity bonus for established projects
    const curatorScore = Math.min(100, sec.score + (tvlScore > 50 ? 5 : 0));

    // Composite: 30% security + 25% yield + 20% TVL/liquidity + 15% curator + 10% stability
    const overallScore = Math.round(
      sec.score   * 0.30 +
      apyScore    * 0.25 +
      tvlScore    * 0.20 +
      curatorScore * 0.15 +
      50           * 0.10, // stability placeholder
    );

    return {
      pool: p.pool,
      chain: p.chain,
      project: p.project,
      symbol: p.symbol,
      tvlUsd: p.tvlUsd,
      apyBase: p.apyBase,
      apyReward: p.apyReward,
      apy: p.apy,
      stablecoin: p.stablecoin,
      securityScore: sec.score,
      securityTier: sec.tier,
      curatorScore,
      overallScore,
      isPT: p.symbol.toLowerCase().includes("pt-") || (p.poolMeta?.includes("maturity") ?? false),
      ptExpiry: p.poolMeta?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null,
      liquidityDepth,
    };
  });

  scored.sort((a, b) => b.overallScore - a.overallScore);

  // Compute loop opportunities
  const loops: LoopResult[] = [];
  const DEFAULT_LTV = 0.50;
  const MAX_LOOPS = 5;

  for (const pool of scored.slice(0, 40)) {
    for (const [protocol, rate] of Object.entries(BORROW_RATES)) {
      const supplyApy = pool.apyBase ?? 0;
      if (supplyApy - rate <= 0) continue;

      let leverage = 1;
      let factor = 1;
      for (let i = 0; i < MAX_LOOPS; i++) {
        factor *= DEFAULT_LTV;
        leverage += factor;
      }
      const netApy = supplyApy * leverage - rate * (leverage - 1);
      if (netApy < 8) continue;

      loops.push({
        symbol: pool.symbol,
        project: pool.project,
        chain: pool.chain,
        borrowProtocol: protocol,
        supplyApy,
        borrowRate: rate,
        ltv: DEFAULT_LTV,
        loops: MAX_LOOPS,
        leverage: Math.round(leverage * 100) / 100,
        netApy: Math.round(netApy * 100) / 100,
        riskLevel: netApy > 25 ? "HIGH" : netApy > 15 ? "MEDIUM" : "LOW",
        tvlUsd: pool.tvlUsd,
      });
    }
  }

  loops.sort((a, b) => b.netApy - a.netApy);

  return {
    pools: scored.slice(0, 50),
    loops: loops.slice(0, 20),
    scanTimestamp: Date.now(),
    poolsScanned: allPools.length,
    chainsScanned: SCAN_CHAINS,
  };
}

/**
 * useYieldScanner — React hook for the DeFi yield scanner.
 *
 * Fetches from /api/yields, supports sorting, chain filtering,
 * auto-refresh, and returns typed pool + loop data.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { PoolResult, LoopResult, YieldScanResponse } from "@/pages/api/yields";

// ─── Types ───────────────────────────────────────────────────────────────

export type SortField =
  | "overallScore"
  | "apyBase"
  | "tvlUsd"
  | "securityScore"
  | "curatorScore"
  | "liquidityDepth"
  | "project";

export type SortDir = "asc" | "desc";

export interface ScannerFilters {
  chain: string | null;
  minTvl: number;
  minApy: number;
  showPTOnly: boolean;
  showLoops: boolean;
}

export interface UseYieldScannerReturn {
  pools: PoolResult[];
  loops: LoopResult[];
  loading: boolean;
  error: string | null;
  scanTimestamp: number | null;
  poolsScanned: number;
  chainsScanned: string[];
  filters: ScannerFilters;
  setFilters: React.Dispatch<React.SetStateAction<ScannerFilters>>;
  sortField: SortField;
  sortDir: SortDir;
  setSort: (field: SortField) => void;
  refresh: () => void;
}

const DEFAULT_FILTERS: ScannerFilters = {
  chain: null,
  minTvl: 1_000_000,
  minApy: 3,
  showPTOnly: false,
  showLoops: true,
};

const REFRESH_INTERVAL_MS = 5 * 60_000; // 5 minutes

// ─── Comparator ──────────────────────────────────────────────────────────

const LIQUIDITY_ORDER: Record<string, number> = { deep: 3, moderate: 2, shallow: 1 };

function comparePools(a: PoolResult, b: PoolResult, field: SortField, dir: SortDir): number {
  let cmp = 0;
  switch (field) {
    case "overallScore":   cmp = a.overallScore - b.overallScore; break;
    case "apyBase":        cmp = (a.apyBase ?? 0) - (b.apyBase ?? 0); break;
    case "tvlUsd":         cmp = a.tvlUsd - b.tvlUsd; break;
    case "securityScore":  cmp = a.securityScore - b.securityScore; break;
    case "curatorScore":   cmp = a.curatorScore - b.curatorScore; break;
    case "liquidityDepth": cmp = (LIQUIDITY_ORDER[a.liquidityDepth] ?? 0) - (LIQUIDITY_ORDER[b.liquidityDepth] ?? 0); break;
    case "project":        cmp = a.project.localeCompare(b.project); break;
    default:               cmp = 0;
  }
  return dir === "desc" ? -cmp : cmp;
}

// ─── Hook ────────────────────────────────────────────────────────────────

export function useYieldScanner(): UseYieldScannerReturn {
  const [rawPools, setRawPools] = useState<PoolResult[]>([]);
  const [loops, setLoops] = useState<LoopResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanTimestamp, setScanTimestamp] = useState<number | null>(null);
  const [poolsScanned, setPoolsScanned] = useState(0);
  const [chainsScanned, setChainsScanned] = useState<string[]>([]);
  const [filters, setFilters] = useState<ScannerFilters>(DEFAULT_FILTERS);
  const [sortField, setSortField] = useState<SortField>("overallScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "30", loops: "true" });
      if (filters.chain) params.set("chain", filters.chain);
      params.set("minTvl", String(filters.minTvl));
      params.set("minApy", String(filters.minApy));

      const resp = await fetch(`/api/yields?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: YieldScanResponse = await resp.json();

      setRawPools(data.pools);
      setLoops(data.loops);
      setScanTimestamp(data.scanTimestamp);
      setPoolsScanned(data.poolsScanned);
      setChainsScanned(data.chainsScanned);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filters.chain, filters.minTvl, filters.minApy]);

  // Initial fetch + auto-refresh
  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  // Toggle sort direction or change sort field
  const setSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortField(field);
        setSortDir("desc");
      }
    },
    [sortField],
  );

  // Apply client-side filters + sort
  let pools = rawPools;
  if (filters.showPTOnly) pools = pools.filter((p) => p.isPT);
  pools = [...pools].sort((a, b) => comparePools(a, b, sortField, sortDir));

  return {
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
    refresh: fetchData,
  };
}

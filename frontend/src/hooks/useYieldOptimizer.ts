import { useState, useCallback, useRef, useEffect } from "react";
import {
  runOptimizer,
  OptimizerResult,
  RiskPreferences,
  DEFAULT_RISK_PREFS,
} from "@/lib/yield-optimizer";

export interface UseYieldOptimizerOptions {
  /** Auto-refresh interval in ms (0 = disabled). Default 120_000 (2 min). */
  refreshInterval?: number;
  /** Initial risk preferences */
  initialPrefs?: Partial<RiskPreferences>;
}

export interface UseYieldOptimizerReturn {
  result: OptimizerResult | null;
  loading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  prefs: RiskPreferences;
  setPrefs: (p: Partial<RiskPreferences>) => void;
  refresh: () => Promise<void>;
}

/**
 * React hook that wraps the yield optimizer engine.
 *
 * Usage:
 * ```tsx
 * const { result, loading, refresh, prefs, setPrefs } = useYieldOptimizer({
 *   refreshInterval: 120_000,
 * });
 * ```
 */
export function useYieldOptimizer(
  totalValueUsd: number,
  currentOnChain: { key: string; bps: number }[],
  opts?: UseYieldOptimizerOptions,
): UseYieldOptimizerReturn {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [prefs, setPrefsState] = useState<RiskPreferences>({
    ...DEFAULT_RISK_PREFS,
    ...opts?.initialPrefs,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable refs for values used in callbacks
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const totalRef = useRef(totalValueUsd);
  totalRef.current = totalValueUsd;
  const onChainRef = useRef(currentOnChain);
  onChainRef.current = currentOnChain;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await runOptimizer(
        prefsRef.current,
        totalRef.current,
        onChainRef.current,
      );
      setResult(res);
      setLastRefresh(new Date());
      if (res.errors.length > 0) {
        setError(res.errors.join("; "));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const setPrefs = useCallback((partial: Partial<RiskPreferences>) => {
    setPrefsState((prev) => ({ ...prev, ...partial }));
  }, []);

  // Auto-refresh
  const interval = opts?.refreshInterval ?? 120_000;
  useEffect(() => {
    if (interval <= 0) return;
    intervalRef.current = setInterval(refresh, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [interval, refresh]);

  return { result, loading, error, lastRefresh, prefs, setPrefs, refresh };
}

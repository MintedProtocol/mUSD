import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Real-time BTC & ETH price hook.
 * Fetches from /api/prices (CoinGecko proxy) with 30s auto-refresh.
 */

export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  sparkline7d: number[];
}

export interface CryptoPrices {
  btc: CoinPrice | null;
  eth: CoinPrice | null;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

function mapCoin(raw: any): CoinPrice | null {
  if (!raw) return null;
  return {
    id: raw.id,
    symbol: raw.symbol,
    name: raw.name,
    price: raw.current_price ?? 0,
    change24h: raw.price_change_percentage_24h ?? 0,
    marketCap: raw.market_cap ?? 0,
    volume24h: raw.total_volume ?? 0,
    high24h: raw.high_24h ?? 0,
    low24h: raw.low_24h ?? 0,
    sparkline7d: raw.sparkline_in_7d?.price ?? [],
  };
}

export function useCryptoPrices(refreshInterval = 30_000): CryptoPrices {
  const [btc, setBtc] = useState<CoinPrice | null>(null);
  const [eth, setEth] = useState<CoinPrice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch("/api/prices");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBtc(mapCoin(data.btc));
      setEth(mapCoin(data.eth));
      setUpdatedAt(data.updatedAt || Date.now());
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to fetch prices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    intervalRef.current = setInterval(fetchPrices, refreshInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchPrices, refreshInterval]);

  return { btc, eth, loading, error, updatedAt, refresh: fetchPrices };
}

/**
 * Format a large number into a human-readable string (e.g. 1.92T, 325B, 12.5M)
 */
export function formatLargeNumber(num: number): string {
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

/**
 * Format price with appropriate precision
 */
export function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  if (price >= 100) return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/**
 * Tiny inline sparkline SVG (for 7d price trend)
 */
export function MiniSparkline({
  data,
  width = 80,
  height = 28,
  color = "#10b981",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!data || data.length < 2) return null;

  // Downsample to ~40 points for performance
  const step = Math.max(1, Math.floor(data.length / 40));
  const sampled = data.filter((_, i) => i % step === 0);

  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;

  const points = sampled
    .map((v, i) => {
      const x = (i / (sampled.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

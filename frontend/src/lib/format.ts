import { ethers } from "ethers";

export function formatUSD(value: bigint, decimals = 18): string {
  const num = parseFloat(ethers.formatUnits(value, decimals));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatToken(value: bigint, decimals = 18, dp = 4): string {
  const num = parseFloat(ethers.formatUnits(value, decimals));
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  }).format(num);
}

export function formatBps(bps: bigint | number): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export function formatHealthFactor(hf: bigint): string {
  // Contract returns health factor in basis points (10000 = 1.0)
  if (hf >= BigInt("0xffffffffffffffffffffffffffffffff")) return "∞";
  const num = Number(hf) / 10000;
  if (num > 100) return ">100";
  return num.toFixed(2);
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

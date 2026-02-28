/**
 * Safe decimal math and formatting.
 *
 * Mirrors the production api-hardening/decimal.ts from MintedCantonDev.
 */

export const EPSILON = 0.000001;

export function parseAmount(raw: string | number | undefined | null): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const n = parseFloat(String(raw ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export function gte(a: number, b: number, eps = EPSILON): boolean {
  return a >= b - eps;
}

export function gt(a: number, b: number, eps = EPSILON): boolean {
  return a > b + eps;
}

export function approxEqual(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) <= eps;
}

export function toDamlDecimal(amount: number): string {
  return amount.toFixed(10);
}

export function toDisplay(amount: number): string {
  return amount.toFixed(6);
}

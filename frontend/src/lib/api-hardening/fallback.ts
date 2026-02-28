/**
 * Fallback classification for batch → legacy single-position path.
 *
 * When a batch choice fails, this module determines whether to fall back
 * to the legacy single-position path or surface the error to the user.
 *
 * Mirrors the production api-hardening/fallback.ts pattern but adapted
 * for batch choice context.
 */

export type FallbackDecision = "allow" | "block";

export interface FallbackResult {
  decision: FallbackDecision;
  reason: string;
}

export const BATCH_FALLBACK_ENABLED =
  typeof process !== "undefined" &&
  process.env?.ENABLE_BATCH_FALLBACK === "true";

export function classifyFallback(status: number): FallbackResult {
  if (status === 0 || !Number.isFinite(status)) {
    return { decision: "allow", reason: "network-error" };
  }
  if (status === 409) {
    return { decision: "allow", reason: "inventory-conflict" };
  }
  if (status >= 500 && status < 600) {
    return { decision: "allow", reason: "server-error" };
  }
  return { decision: "block", reason: "business-error" };
}

export function isFallbackAllowed(status: number): boolean {
  if (!BATCH_FALLBACK_ENABLED) return false;
  return classifyFallback(status).decision === "allow";
}

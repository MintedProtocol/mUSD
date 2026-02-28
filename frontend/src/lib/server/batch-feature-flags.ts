/**
 * Server-side feature flags for Option 2 batch choices.
 *
 * All flags default to OFF. Set environment variables to "true" to enable.
 * When OFF, batch endpoints return 404 (capability absent) and the legacy
 * single-position path remains the only active code path.
 */

// ── master switch ──────────────────────────────────────────────────────
export function isBatchChoicesEnabled(): boolean {
  return process.env.ENABLE_BATCH_CHOICES === "true";
}

// ── per-choice overrides (require master switch) ───────────────────────
export function isEthPoolBatchUnstakeEnabled(): boolean {
  if (!isBatchChoicesEnabled()) return false;
  return process.env.DISABLE_ETHPOOL_BATCH_UNSTAKE !== "true";
}

export function isSmUsdBatchUnstakeEnabled(): boolean {
  if (!isBatchChoicesEnabled()) return false;
  return process.env.DISABLE_SMUSD_BATCH_UNSTAKE !== "true";
}

export function isLendingBatchDepositEnabled(): boolean {
  if (!isBatchChoicesEnabled()) return false;
  return process.env.DISABLE_LENDING_BATCH_DEPOSIT !== "true";
}

// ── capability report ──────────────────────────────────────────────────

export interface BatchCapabilityReport {
  batchChoicesEnabled: boolean;
  choices: {
    ETHPool_BatchUnstake: boolean;
    Unstake_Batch: boolean;
    Lending_BatchDepositSMUSD: boolean;
    Lending_BatchDepositSMUSDE: boolean;
  };
  version: string;
}

export const BATCH_PROTOCOL_VERSION = "1.2.0";

export function getBatchCapabilities(): BatchCapabilityReport {
  return {
    batchChoicesEnabled: isBatchChoicesEnabled(),
    choices: {
      ETHPool_BatchUnstake: isEthPoolBatchUnstakeEnabled(),
      Unstake_Batch: isSmUsdBatchUnstakeEnabled(),
      Lending_BatchDepositSMUSD: isLendingBatchDepositEnabled(),
      Lending_BatchDepositSMUSDE: isLendingBatchDepositEnabled(),
    },
    version: BATCH_PROTOCOL_VERSION,
  };
}

// ── flag behavior matrix (for docs / tests) ────────────────────────────
//
// ENABLE_BATCH_CHOICES        | per-choice DISABLE_*  | Result
// ----------------------------|----------------------|--------
// unset / "false"             | (any)                | OFF
// "true"                      | unset / "false"      | ON
// "true"                      | "true"               | OFF (that choice only)

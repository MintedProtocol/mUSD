/**
 * Relay-side support for Option 2 batch choices.
 *
 * Extends the relay's template mapping and command-building capabilities
 * to handle the four new batch choices from ble-protocol v1.2.0:
 *   - ETHPool_BatchUnstake    (CantonETHPool)
 *   - Unstake_Batch           (CantonSMUSD / CantonStakingService)
 *   - Lending_BatchDepositSMUSD    (CantonLending)
 *   - Lending_BatchDepositSMUSDE   (CantonLending)
 *
 * Feature-gated by ENABLE_BATCH_CHOICES env var (default: off).
 */

// ── feature flag ───────────────────────────────────────────────────────

export function isBatchEnabled(): boolean {
  return process.env.ENABLE_BATCH_CHOICES === "true";
}

// ── batch choice registry ──────────────────────────────────────────────

export interface BatchChoiceSpec {
  /** DAML module containing the service template */
  module: string;
  /** Service template name */
  template: string;
  /** Choice name as it appears in the DAML source */
  choice: string;
  /** Name of the contract-ID-list field in the choice argument */
  cidField: string;
  /** Whether this is a nonconsuming choice */
  nonconsuming: boolean;
  /** Which package ID env var to use */
  packageEnv: "CANTON_PACKAGE_ID" | "CANTON_LENDING_PACKAGE_ID";
}

export const BATCH_CHOICES: Record<string, BatchChoiceSpec> = {
  ETHPool_BatchUnstake: {
    module: "CantonETHPool",
    template: "CantonETHPoolService",
    choice: "ETHPool_BatchUnstake",
    cidField: "smusdeCids",
    nonconsuming: false,
    packageEnv: "CANTON_PACKAGE_ID",
  },
  Unstake_Batch: {
    module: "CantonSMUSD",
    template: "CantonStakingService",
    choice: "Unstake_Batch",
    cidField: "smusdCids",
    nonconsuming: false,
    packageEnv: "CANTON_PACKAGE_ID",
  },
  Lending_BatchDepositSMUSD: {
    module: "CantonLending",
    template: "CantonLendingService",
    choice: "Lending_BatchDepositSMUSD",
    cidField: "smusdCids",
    nonconsuming: true,
    packageEnv: "CANTON_LENDING_PACKAGE_ID",
  },
  Lending_BatchDepositSMUSDE: {
    module: "CantonLending",
    template: "CantonLendingService",
    choice: "Lending_BatchDepositSMUSDE",
    cidField: "smusdeCids",
    nonconsuming: true,
    packageEnv: "CANTON_LENDING_PACKAGE_ID",
  },
};

// ── template ID resolution ─────────────────────────────────────────────

export function resolveBatchTemplateId(choiceName: string): string | null {
  const spec = BATCH_CHOICES[choiceName];
  if (!spec) return null;

  const pkgId =
    spec.packageEnv === "CANTON_LENDING_PACKAGE_ID"
      ? process.env.CANTON_LENDING_PACKAGE_ID || process.env.CANTON_PACKAGE_ID || ""
      : process.env.CANTON_PACKAGE_ID || "";

  if (!pkgId) return null;
  return `${pkgId}:${spec.module}:${spec.template}`;
}

// ── command building ───────────────────────────────────────────────────

export interface BatchUnstakeArgs {
  user: string;
  contractIds: string[];
  requestedMusd: string;
}

export interface BatchDepositArgs {
  user: string;
  contractIds: string[];
  existingEscrowCid: string | null;
  collateralAggCid: string | null;
}

export function buildBatchUnstakeCommand(
  choiceName: "ETHPool_BatchUnstake" | "Unstake_Batch",
  serviceContractId: string,
  args: BatchUnstakeArgs
): Record<string, unknown> | null {
  if (!isBatchEnabled()) return null;

  const spec = BATCH_CHOICES[choiceName];
  if (!spec) return null;

  const templateId = resolveBatchTemplateId(choiceName);
  if (!templateId) return null;

  return {
    ExerciseCommand: {
      templateId,
      contractId: serviceContractId,
      choice: spec.choice,
      choiceArgument: {
        user: args.user,
        [spec.cidField]: args.contractIds,
        requestedMusd: args.requestedMusd,
      },
    },
  };
}

export function buildBatchDepositCommand(
  choiceName: "Lending_BatchDepositSMUSD" | "Lending_BatchDepositSMUSDE",
  serviceContractId: string,
  args: BatchDepositArgs
): Record<string, unknown> | null {
  if (!isBatchEnabled()) return null;

  const spec = BATCH_CHOICES[choiceName];
  if (!spec) return null;

  const templateId = resolveBatchTemplateId(choiceName);
  if (!templateId) return null;

  return {
    ExerciseCommand: {
      templateId,
      contractId: serviceContractId,
      choice: spec.choice,
      choiceArgument: {
        user: args.user,
        [spec.cidField]: args.contractIds,
        existingEscrowCid: args.existingEscrowCid,
        collateralAggCid: args.collateralAggCid,
      },
    },
  };
}

// ── health reporting ───────────────────────────────────────────────────

export interface BatchHealthReport {
  batchEnabled: boolean;
  resolvedTemplates: Record<string, string | null>;
}

export function getBatchHealthReport(): BatchHealthReport {
  const resolvedTemplates: Record<string, string | null> = {};
  for (const name of Object.keys(BATCH_CHOICES)) {
    resolvedTemplates[name] = resolveBatchTemplateId(name);
  }
  return {
    batchEnabled: isBatchEnabled(),
    resolvedTemplates,
  };
}

// ── error classification ───────────────────────────────────────────────

/** DAML assertion names returned by Canton when a batch choice fails. */
export const BATCH_ERROR_CODES = [
  "SERVICE_PAUSED",
  "NO_POSITIONS_PROVIDED",
  "REQUESTED_AMOUNT_POSITIVE",
  "OWNER_MISMATCH",
  "ISSUER_MISMATCH",
  "NOT_OWNER",
  "POSITION_LOCKED",
  "COOLDOWN_NOT_ELAPSED",
  "INSUFFICIENT_BALANCE",
  "UNSTAKE_EXCEEDS_MUSD_MINT_CAP",
  "SMUSD_NOT_ENABLED",
  "SMUSDE_NOT_ENABLED",
  "SMUSD_ISSUER_MUST_BE_OPERATOR",
  "SMUSDE_ISSUER_MUST_BE_OPERATOR",
] as const;

export type BatchErrorCode = (typeof BATCH_ERROR_CODES)[number];

export function extractBatchErrorCode(message: string): BatchErrorCode | null {
  for (const code of BATCH_ERROR_CODES) {
    if (message.includes(code)) return code;
  }
  return null;
}

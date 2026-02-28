/**
 * Input validation helpers for batch choice API endpoints.
 *
 * Follows the same guard patterns as api-hardening/auth.ts:
 * - Returns null on validation failure (after writing error response)
 * - Returns parsed data on success
 */
import type { NextApiRequest, NextApiResponse } from "next";

// ── constants ──────────────────────────────────────────────────────────

/** Maximum positions per batch request (prevents DoS via oversized arrays). */
export const MAX_BATCH_SIZE = 50;

/** Canton contract ID format: hex hash (64+ chars). */
const CONTRACT_ID_PATTERN = /^[0-9a-f:]+$/i;

// ── types ──────────────────────────────────────────────────────────────

export interface BatchUnstakeInput {
  party: string;
  pool: "ethpool" | "smusd";
  contractIds: string[];
  requestedMusd: string;
}

export interface BatchDepositInput {
  party: string;
  collateralType: "smusd" | "smusde";
  contractIds: string[];
  existingEscrowCid: string | null;
  collateralAggCid: string | null;
}

export type BatchValidationError = {
  error: string;
  errorType: string;
  field?: string;
};

// ── validators ─────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateContractIds(ids: string[]): string | null {
  if (ids.length === 0) {
    return "Contract ID list must not be empty";
  }
  if (ids.length > MAX_BATCH_SIZE) {
    return `Batch size ${ids.length} exceeds maximum ${MAX_BATCH_SIZE}`;
  }
  for (const id of ids) {
    if (!id.trim()) return "Empty contract ID in list";
    if (!CONTRACT_ID_PATTERN.test(id.trim())) {
      return `Invalid contract ID format: ${id.slice(0, 20)}...`;
    }
  }
  const unique = new Set(ids.map((id) => id.trim()));
  if (unique.size !== ids.length) {
    return "Duplicate contract IDs in batch";
  }
  return null;
}

// ── batch unstake guard ────────────────────────────────────────────────

export function guardBatchUnstakeBody(
  req: NextApiRequest,
  res: NextApiResponse
): BatchUnstakeInput | null {
  const body = req.body || {};

  // pool discriminator
  const pool = body.pool;
  if (pool !== "ethpool" && pool !== "smusd") {
    res.status(400).json({
      success: false,
      error: 'Missing or invalid "pool" — must be "ethpool" or "smusd"',
      errorType: "VALIDATION_ERROR",
      field: "pool",
    } satisfies BatchValidationError & { success: false });
    return null;
  }

  // contract IDs
  if (!isStringArray(body.contractIds)) {
    res.status(400).json({
      success: false,
      error: '"contractIds" must be an array of strings',
      errorType: "VALIDATION_ERROR",
      field: "contractIds",
    });
    return null;
  }
  const cidError = validateContractIds(body.contractIds);
  if (cidError) {
    res.status(400).json({
      success: false,
      error: cidError,
      errorType: "VALIDATION_ERROR",
      field: "contractIds",
    });
    return null;
  }

  // requested amount
  if (!isNonEmptyString(body.requestedMusd)) {
    res.status(400).json({
      success: false,
      error: '"requestedMusd" is required and must be a non-empty string',
      errorType: "VALIDATION_ERROR",
      field: "requestedMusd",
    });
    return null;
  }
  const parsed = parseFloat(body.requestedMusd);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    res.status(400).json({
      success: false,
      error: '"requestedMusd" must be a positive number',
      errorType: "VALIDATION_ERROR",
      field: "requestedMusd",
    });
    return null;
  }

  // party (basic presence check — full validation deferred to guardBodyParty)
  if (!isNonEmptyString(body.party)) {
    res.status(400).json({
      success: false,
      error: "Missing party",
      errorType: "VALIDATION_ERROR",
      field: "party",
    });
    return null;
  }

  return {
    party: body.party.trim(),
    pool,
    contractIds: body.contractIds.map((id: string) => id.trim()),
    requestedMusd: body.requestedMusd.trim(),
  };
}

// ── batch deposit guard ────────────────────────────────────────────────

export function guardBatchDepositBody(
  req: NextApiRequest,
  res: NextApiResponse
): BatchDepositInput | null {
  const body = req.body || {};

  // collateral type discriminator
  const ct = body.collateralType;
  if (ct !== "smusd" && ct !== "smusde") {
    res.status(400).json({
      success: false,
      error:
        'Missing or invalid "collateralType" — must be "smusd" or "smusde"',
      errorType: "VALIDATION_ERROR",
      field: "collateralType",
    });
    return null;
  }

  // contract IDs
  if (!isStringArray(body.contractIds)) {
    res.status(400).json({
      success: false,
      error: '"contractIds" must be an array of strings',
      errorType: "VALIDATION_ERROR",
      field: "contractIds",
    });
    return null;
  }
  const cidError = validateContractIds(body.contractIds);
  if (cidError) {
    res.status(400).json({
      success: false,
      error: cidError,
      errorType: "VALIDATION_ERROR",
      field: "contractIds",
    });
    return null;
  }

  // party
  if (!isNonEmptyString(body.party)) {
    res.status(400).json({
      success: false,
      error: "Missing party",
      errorType: "VALIDATION_ERROR",
      field: "party",
    });
    return null;
  }

  // optional CIDs (null if absent or empty string)
  const existingEscrowCid =
    isNonEmptyString(body.existingEscrowCid) ? body.existingEscrowCid.trim() : null;
  const collateralAggCid =
    isNonEmptyString(body.collateralAggCid) ? body.collateralAggCid.trim() : null;

  return {
    party: body.party.trim(),
    collateralType: ct,
    contractIds: body.contractIds.map((id: string) => id.trim()),
    existingEscrowCid,
    collateralAggCid,
  };
}

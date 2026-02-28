/**
 * Option 2 batch consolidation hook.
 *
 * When NEXT_PUBLIC_OPTION2_BATCH_ENABLED=true, this provides merge-then-split
 * logic for fragmented Canton token balances. A single user action triggers
 * the full consolidation pipeline:
 *
 *   1. Check if a single covering token exists (fast path — no merge needed)
 *   2. If not, iteratively merge the two largest tokens (dynamic budget: N-1, hard cap 128)
 *   3. Split the consolidated token to the exact requested amount
 *   4. Return the CID of the correctly-sized token (deterministic CID binding from exercise metadata)
 *
 * When the flag is OFF, all exports are inert stubs that preserve legacy behavior.
 */

import {
  cantonExercise,
  fetchFreshBalances,
  type SimpleToken,
  type CantonMUSDToken,
  type CantonBalancesData,
} from "./useCantonLedger";

// ── Feature flag ──────────────────────────────────────────────────────

export const OPTION2_BATCH_ENABLED =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_OPTION2_BATCH_ENABLED === "true"
    : process.env.NEXT_PUBLIC_OPTION2_BATCH_ENABLED === "true";

// ── Constants ─────────────────────────────────────────────────────────

/** Absolute upper bound on merge rounds to prevent infinite loops. */
const MERGE_HARD_CAP = 128;
const EPSILON = 0.000001;

// ── Types ─────────────────────────────────────────────────────────────

export type TokenKind =
  | "CantonMUSD"
  | "CantonUSDC"
  | "USDCx"
  | "CantonCoin"
  | "CantonSMUSD"
  | "CantonSMUSD_E";

interface MergeSpec {
  templateId: string;
  mergeChoice: string;
  splitChoice: string;
}

const MERGE_SPECS: Record<TokenKind, MergeSpec> = {
  CantonMUSD: {
    templateId: "CantonMUSD",
    mergeChoice: "CantonMUSD_Merge",
    splitChoice: "CantonMUSD_Split",
  },
  CantonUSDC: {
    templateId: "CantonUSDC",
    mergeChoice: "CantonUSDC_Merge",
    splitChoice: "CantonUSDC_Split",
  },
  USDCx: {
    templateId: "USDCx",
    mergeChoice: "USDCx_Merge",
    splitChoice: "USDCx_Split",
  },
  CantonCoin: {
    templateId: "CantonCoin",
    mergeChoice: "CantonCoin_Merge",
    splitChoice: "CantonCoin_Split",
  },
  CantonSMUSD: {
    templateId: "CantonSMUSD",
    mergeChoice: "CantonSMUSD_Merge",
    splitChoice: "CantonSMUSD_Split",
  },
  CantonSMUSD_E: {
    templateId: "CantonSMUSD_E",
    mergeChoice: "SMUSDE_Merge",
    splitChoice: "SMUSDE_Split",
  },
};

export interface BatchResult {
  contractId: string;
  amount: number;
  mergesPerformed: number;
  splitPerformed: boolean;
}

export interface BatchProgress {
  phase: "idle" | "checking" | "merging" | "splitting" | "done" | "error";
  mergesCompleted: number;
  mergesTotal: number;
  message: string;
}

// ── Token helpers ─────────────────────────────────────────────────────

function parseAmt(t: { amount: string }): number {
  return parseFloat(t.amount || "0");
}

function findCovering(
  tokens: (SimpleToken | CantonMUSDToken)[],
  requested: number
): (SimpleToken | CantonMUSDToken) | null {
  const sorted = [...tokens]
    .filter((t) => parseAmt(t) > 0)
    .sort((a, b) => parseAmt(a) - parseAmt(b));
  return sorted.find((t) => parseAmt(t) >= requested - EPSILON) || null;
}

function sumTokens(tokens: (SimpleToken | CantonMUSDToken)[]): number {
  return tokens.reduce((s, t) => s + parseAmt(t), 0);
}

// ── Extract tokens from balance data by kind ──────────────────────────

type TokenExtractor = (data: CantonBalancesData) => (SimpleToken | CantonMUSDToken)[];

const TOKEN_EXTRACTORS: Record<TokenKind, TokenExtractor> = {
  CantonMUSD: (d) => (d.tokens || []).filter((t) => t.template === "CantonMUSD"),
  CantonUSDC: (d) => (d.usdcTokens || []).filter((t) => t.template !== "USDCx"),
  USDCx: (d) => (d.usdcTokens || []).filter((t) => t.template === "USDCx"),
  CantonCoin: (d) => d.cantonCoinTokens || [],
  CantonSMUSD: (d) => d.smusdTokens || [],
  CantonSMUSD_E: (d) => d.smusdETokens || [],
};

// ── Core batch consolidation ──────────────────────────────────────────

/**
 * Consolidate fragmented tokens via merge-then-split to produce a single
 * contract of the exact requested amount. Returns the CID of that contract.
 *
 * @param kind       Which token type to consolidate
 * @param requested  The exact decimal amount needed
 * @param party      The acting Canton party
 * @param onProgress Optional progress callback for UI state
 *
 * @throws Error if consolidation is impossible (insufficient total balance,
 *         merge failures, etc.)
 */
export async function consolidateTokens(
  kind: TokenKind,
  requested: number,
  party: string,
  onProgress?: (p: BatchProgress) => void,
): Promise<BatchResult> {
  const spec = MERGE_SPECS[kind];
  const extractor = TOKEN_EXTRACTORS[kind];
  const report = (p: Partial<BatchProgress>) =>
    onProgress?.({
      phase: "idle",
      mergesCompleted: 0,
      mergesTotal: 0,
      message: "",
      ...p,
    });

  report({ phase: "checking", message: "Checking token availability..." });

  // Step 1: Fetch fresh tokens
  let fresh = await fetchFreshBalances(party);
  let tokens = extractor(fresh);

  // Step 2: Fast path — single covering token exists
  const covering = findCovering(tokens, requested);
  if (covering) {
    const coverAmt = parseAmt(covering);
    // Exact or close-enough match — no split needed
    if (Math.abs(coverAmt - requested) < EPSILON) {
      report({ phase: "done", message: "Exact token found." });
      return {
        contractId: covering.contractId,
        amount: coverAmt,
        mergesPerformed: 0,
        splitPerformed: false,
      };
    }
    // Covering but oversized — split only
    report({ phase: "splitting", message: "Splitting oversized token..." });
    const createdCids = await splitToken(spec, covering.contractId, requested, party);
    fresh = await fetchFreshBalances(party);
    tokens = extractor(fresh);
    const splitToken_ = selectSplitResult(tokens, requested, createdCids);
    if (!splitToken_) throw new Error("Token not found after split.");
    report({ phase: "done", message: "Token split complete." });
    return {
      contractId: splitToken_.contractId,
      amount: parseAmt(splitToken_),
      mergesPerformed: 0,
      splitPerformed: true,
    };
  }

  // Step 3: Check total balance is sufficient
  const total = sumTokens(tokens);
  if (total < requested - EPSILON) {
    throw new Error(
      `Insufficient total ${kind} balance. Have ${total.toFixed(6)}, need ${requested.toFixed(6)}.`,
    );
  }

  // Step 4: Merge loop — merge two largest until one covers the amount.
  // Dynamic budget: N tokens need at most N-1 merges, capped by MERGE_HARD_CAP.
  const activeTokenCount = tokens.filter((t) => parseAmt(t) > 0).length;
  const mergeBudget = Math.min(MERGE_HARD_CAP, Math.max(0, activeTokenCount - 1));

  report({
    phase: "merging",
    mergesTotal: mergeBudget,
    message: "Consolidating fragmented tokens...",
  });

  let mergesPerformed = 0;
  for (let round = 0; round < mergeBudget; round++) {
    const sorted = [...tokens]
      .filter((t) => parseAmt(t) > 0)
      .sort((a, b) => parseAmt(b) - parseAmt(a)); // descending

    // Check if largest now covers
    if (sorted.length > 0 && parseAmt(sorted[0]) >= requested - EPSILON) {
      break;
    }

    if (sorted.length < 2) {
      throw new Error(
        `Cannot consolidate ${kind}: only ${sorted.length} token(s) remaining, none large enough.`,
      );
    }

    const primary = sorted[0];
    const secondary = sorted[1];

    report({
      phase: "merging",
      mergesCompleted: mergesPerformed,
      mergesTotal: Math.min(mergeBudget, sorted.length - 1),
      message: `Merging token ${mergesPerformed + 1} of ~${Math.min(mergeBudget, sorted.length - 1)}...`,
    });

    const mergeResp = await cantonExercise(
      spec.templateId,
      primary.contractId,
      spec.mergeChoice,
      { otherCid: secondary.contractId },
      party,
    );
    if (!mergeResp.success) {
      throw new Error(mergeResp.error || `Merge failed on round ${round + 1}.`);
    }

    mergesPerformed++;
    fresh = await fetchFreshBalances(party);
    tokens = extractor(fresh);
  }

  // Step 5: After merges, find covering token
  const postMergeCovering = findCovering(tokens, requested);
  if (!postMergeCovering) {
    throw new Error(
      `Consolidation incomplete after ${mergesPerformed} merges. Largest token still insufficient.`,
    );
  }

  // Step 6: Split if oversized
  const postMergeAmt = parseAmt(postMergeCovering);
  if (Math.abs(postMergeAmt - requested) < EPSILON) {
    report({ phase: "done", message: `Consolidated in ${mergesPerformed} merge(s).` });
    return {
      contractId: postMergeCovering.contractId,
      amount: postMergeAmt,
      mergesPerformed,
      splitPerformed: false,
    };
  }

  report({ phase: "splitting", message: "Splitting to exact amount..." });
  const createdCids = await splitToken(spec, postMergeCovering.contractId, requested, party);
  fresh = await fetchFreshBalances(party);
  tokens = extractor(fresh);
  const finalToken = selectSplitResult(tokens, requested, createdCids);
  if (!finalToken) throw new Error("Token not found after final split.");

  report({ phase: "done", message: `Done: ${mergesPerformed} merge(s) + split.` });
  return {
    contractId: finalToken.contractId,
    amount: parseAmt(finalToken),
    mergesPerformed,
    splitPerformed: true,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────

/**
 * Extract created contract IDs from a Canton exercise result.
 * Handles multiple common response shapes; returns empty array if
 * metadata is absent or unparseable.
 */
function extractCreatedCids(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const cids: string[] = [];
  const r = result as Record<string, unknown>;
  // Shape: result.events[].created.contractId (Canton JSON API)
  if (Array.isArray(r.events)) {
    for (const event of r.events) {
      const created = (event as Record<string, unknown>)?.created as Record<string, unknown> | undefined;
      if (typeof created?.contractId === "string" && created.contractId) {
        cids.push(created.contractId);
      }
    }
  }
  // Shape: result.exerciseResult (direct CID string)
  if (typeof r.exerciseResult === "string" && r.exerciseResult) {
    cids.push(r.exerciseResult);
  }
  // Shape: result.contractId
  if (typeof r.contractId === "string" && r.contractId) {
    cids.push(r.contractId);
  }
  return cids;
}

/**
 * Split a token and return the created CIDs from the exercise result.
 * Returns an empty array when Canton metadata doesn't expose created CIDs.
 */
async function splitToken(
  spec: MergeSpec,
  contractId: string,
  amount: number,
  party: string,
): Promise<string[]> {
  const resp = await cantonExercise(
    spec.templateId,
    contractId,
    spec.splitChoice,
    { splitAmount: amount.toString() },
    { party },
  );
  if (!resp.success) {
    throw new Error(resp.error || "Token split failed.");
  }
  return extractCreatedCids(resp.result);
}

/**
 * Select the correct token after a split, using deterministic CID binding.
 *
 * 1. If createdCids available → only consider tokens whose CID is in the set,
 *    and require exact amount match among those.
 * 2. If createdCids empty (metadata absent) → exact-match-only fallback.
 * 3. Never selects a covering (oversized) token — exact match or fail.
 */
function selectSplitResult(
  tokens: (SimpleToken | CantonMUSDToken)[],
  requested: number,
  createdCids: string[],
): (SimpleToken | CantonMUSDToken) | null {
  if (createdCids.length > 0) {
    // Deterministic: restrict to CIDs created by the split exercise
    const created = tokens.filter((t) => createdCids.includes(t.contractId));
    return created.find((t) => Math.abs(parseAmt(t) - requested) < EPSILON) || null;
  }
  // Metadata absent: exact-match-only (no covering fallback)
  return findExactToken(tokens, requested);
}

function findExactToken(
  tokens: (SimpleToken | CantonMUSDToken)[],
  requested: number,
): (SimpleToken | CantonMUSDToken) | null {
  return (
    tokens.find((t) => Math.abs(parseAmt(t) - requested) < EPSILON) || null
  );
}

// ── Fragmentation detection helper ────────────────────────────────────

/**
 * Returns true if the requested amount requires merge consolidation
 * (i.e., no single token covers it but total balance does).
 */
export function needsConsolidation(
  tokens: (SimpleToken | CantonMUSDToken)[],
  requested: number,
): boolean {
  if (requested <= 0) return false;
  const covering = findCovering(tokens, requested);
  if (covering) return false;
  return sumTokens(tokens) >= requested - EPSILON;
}

/**
 * Returns the largest single-token amount from a list.
 */
export function largestSingleAmount(
  tokens: (SimpleToken | CantonMUSDToken)[],
): number {
  return tokens.reduce((max, t) => Math.max(max, parseAmt(t)), 0);
}

// ── Batch CID selection (forfeit-minimising) ────────────────────────

/**
 * Select token CIDs that cover `requested` with the least excess (forfeit).
 *
 * DAML `Unstake_Batch` burns ALL provided positions. Any value above the
 * requested mUSD is forfeited — it is NOT returned to the user. Therefore
 * we minimise excess with this priority:
 *
 *   1. Exact match — a single token whose amount ≈ requested (zero forfeit)
 *   2. Smallest single covering — the smallest token ≥ requested (least overshoot)
 *   3. Accumulate from smallest upward — greedy smallest-first minimises the
 *      total included and stops as soon as the sum covers the request
 *
 * Returns empty array when the total balance is insufficient.
 */
export function selectMinForfeitCoveringCids(
  tokens: (SimpleToken | CantonMUSDToken)[],
  requested: number,
): string[] {
  if (requested <= 0) return [];
  const positive = tokens.filter((t) => parseAmt(t) > 0);
  if (positive.length === 0) return [];

  // 1. Exact match
  const exact = positive.find((t) => Math.abs(parseAmt(t) - requested) < EPSILON);
  if (exact) return [exact.contractId];

  // 2. Smallest single covering token (least overshoot)
  const covering = positive
    .filter((t) => parseAmt(t) >= requested - EPSILON)
    .sort((a, b) => parseAmt(a) - parseAmt(b));
  if (covering.length > 0) return [covering[0].contractId];

  // 3. Accumulate from smallest upward
  const ascending = [...positive].sort((a, b) => parseAmt(a) - parseAmt(b));
  const cids: string[] = [];
  let total = 0;
  for (const t of ascending) {
    cids.push(t.contractId);
    total += parseAmt(t);
    if (total >= requested - EPSILON) return cids;
  }
  return []; // insufficient total
}

// ── Last-staker partial guard ────────────────────────────────────────

export const LAST_STAKER_PARTIAL_MSG =
  "You hold all pool shares. Partial batch unstake is not allowed. Use full vault amount.";

export const FEATURE_DISABLED_MSG =
  "Batch unstake is not currently available. Please try again later or use a single position.";

/**
 * Returns true when the unstake should be blocked because the user is
 * effectively the last staker requesting a partial withdrawal.
 *
 * Condition (mirrors DAML Unstake_Batch guard):
 *   userShares >= poolTotalShares - epsilon   (last staker)
 *   AND requestedMusd < pooledMusd - epsilon  (partial withdrawal)
 */
export function isLastStakerPartialForbidden(
  userShares: number,
  poolTotalShares: number,
  requestedMusd: number,
  pooledMusd: number,
): boolean {
  if (poolTotalShares <= 0) return false;
  const isLastStaker = userShares >= poolTotalShares - EPSILON;
  const isPartial = requestedMusd < pooledMusd - EPSILON;
  return isLastStaker && isPartial;
}

/**
 * Map a batch-unstake errorType to a user-facing message.
 * Returns the fallback for unrecognised error types.
 */
export function mapBatchUnstakeError(
  errorType: string,
  fallbackMessage: string,
): string {
  if (errorType === "LAST_STAKER_PARTIAL_FORBIDDEN") return LAST_STAKER_PARTIAL_MSG;
  if (errorType === "FEATURE_DISABLED") return FEATURE_DISABLED_MSG;
  return fallbackMessage;
}

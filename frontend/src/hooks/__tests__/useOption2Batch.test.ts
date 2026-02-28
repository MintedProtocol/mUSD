/**
 * Tests for useOption2Batch — Option 2 batch consolidation logic.
 *
 * Tests cover:
 *  - Feature flag gating (OPTION2_BATCH_ENABLED)
 *  - needsConsolidation() for various token scenarios
 *  - largestSingleAmount() helper
 *  - consolidateTokens() fast path (exact match, oversized + split)
 *  - consolidateTokens() merge loop
 *  - Error paths (insufficient balance, merge failure)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock useCantonLedger before importing the module under test
const mockCantonExercise = vi.fn();
const mockFetchFreshBalances = vi.fn();

vi.mock("@/hooks/useCantonLedger", () => ({
  cantonExercise: (...args: unknown[]) => mockCantonExercise(...args),
  fetchFreshBalances: (...args: unknown[]) => mockFetchFreshBalances(...args),
}));

// Force the env var before importing the module
const originalEnv = process.env.NEXT_PUBLIC_OPTION2_BATCH_ENABLED;

import {
  needsConsolidation,
  largestSingleAmount,
  consolidateTokens,
  isLastStakerPartialForbidden,
  selectMinForfeitCoveringCids,
  mapBatchUnstakeError,
  LAST_STAKER_PARTIAL_MSG,
  type BatchProgress,
} from "../useOption2Batch";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeToken(contractId: string, amount: number, template = "CantonMUSD") {
  return { contractId, amount: amount.toString(), template };
}

function makeSimpleToken(contractId: string, amount: number, template?: string) {
  return { contractId, amount: amount.toString(), ...(template ? { template } : {}) };
}

function makeBalancesData(overrides: Record<string, unknown> = {}) {
  return {
    tokens: [],
    totalBalance: "0",
    tokenCount: 0,
    redeemableBalance: "0",
    redeemableTokenCount: 0,
    cip56Balance: "0",
    bridgeService: null,
    pendingBridgeIns: 0,
    supplyService: false,
    stakingService: null,
    ethPoolService: null,
    boostPoolService: null,
    lendingService: null,
    priceFeeds: [],
    directMintService: null,
    coinMintService: null,
    smusdTokens: [],
    totalSmusd: "0",
    smusdETokens: [],
    totalSmusdE: "0",
    boostLPTokens: [],
    totalBoostLP: "0",
    cantonCoinTokens: [],
    totalCoin: "0",
    usdcTokens: [],
    totalUsdc: "0",
    usdcBalance: "0",
    usdcxBalance: "0",
    usdcContractCount: 0,
    usdcxContractCount: 0,
    escrowPositions: [],
    debtPositions: [],
    ledgerOffset: 0,
    party: "test-party",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("needsConsolidation", () => {
  it("returns false for zero or negative requested amounts", () => {
    const tokens = [makeToken("cid1", 100)];
    expect(needsConsolidation(tokens, 0)).toBe(false);
    expect(needsConsolidation(tokens, -5)).toBe(false);
  });

  it("returns false when a single token covers the requested amount", () => {
    const tokens = [makeToken("cid1", 50), makeToken("cid2", 100)];
    expect(needsConsolidation(tokens, 80)).toBe(false);
  });

  it("returns false when a token exactly matches the requested amount", () => {
    const tokens = [makeToken("cid1", 50), makeToken("cid2", 50)];
    expect(needsConsolidation(tokens, 50)).toBe(false);
  });

  it("returns true when no single token covers but total does", () => {
    const tokens = [makeToken("cid1", 30), makeToken("cid2", 40), makeToken("cid3", 35)];
    expect(needsConsolidation(tokens, 60)).toBe(true);
  });

  it("returns false when total balance is insufficient", () => {
    const tokens = [makeToken("cid1", 10), makeToken("cid2", 20)];
    expect(needsConsolidation(tokens, 50)).toBe(false);
  });

  it("returns false for empty token list", () => {
    expect(needsConsolidation([], 10)).toBe(false);
  });
});

describe("largestSingleAmount", () => {
  it("returns 0 for empty list", () => {
    expect(largestSingleAmount([])).toBe(0);
  });

  it("returns the largest amount from multiple tokens", () => {
    const tokens = [makeToken("a", 10), makeToken("b", 50), makeToken("c", 25)];
    expect(largestSingleAmount(tokens)).toBe(50);
  });

  it("handles single token", () => {
    expect(largestSingleAmount([makeToken("x", 42)])).toBe(42);
  });
});

describe("consolidateTokens", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fast path: returns exact token without merge or split", async () => {
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        tokens: [makeToken("cid-exact", 100, "CantonMUSD")],
      })
    );

    const result = await consolidateTokens("CantonMUSD", 100, "party1");

    expect(result.contractId).toBe("cid-exact");
    expect(result.mergesPerformed).toBe(0);
    expect(result.splitPerformed).toBe(false);
    expect(mockCantonExercise).not.toHaveBeenCalled();
  });

  it("fast path: splits oversized single token", async () => {
    mockFetchFreshBalances
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [makeToken("cid-large", 200, "CantonMUSD")],
        })
      )
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [
            makeToken("cid-split-50", 50, "CantonMUSD"),
            makeToken("cid-split-150", 150, "CantonMUSD"),
          ],
        })
      );

    mockCantonExercise.mockResolvedValueOnce({ success: true });

    const result = await consolidateTokens("CantonMUSD", 50, "party1");

    expect(result.splitPerformed).toBe(true);
    expect(result.mergesPerformed).toBe(0);
    expect(mockCantonExercise).toHaveBeenCalledWith(
      "CantonMUSD",
      "cid-large",
      "CantonMUSD_Split",
      { splitAmount: "50" },
      { party: "party1" }
    );
  });

  it("merge path: merges two tokens when neither covers amount", async () => {
    // Initial fetch: two tokens, neither covers 80
    mockFetchFreshBalances
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [
            makeToken("cid1", 50, "CantonMUSD"),
            makeToken("cid2", 40, "CantonMUSD"),
          ],
        })
      )
      // After merge: single token of 90
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [makeToken("cid-merged", 90, "CantonMUSD")],
        })
      )
      // After split:
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [
            makeToken("cid-final-80", 80, "CantonMUSD"),
            makeToken("cid-remainder", 10, "CantonMUSD"),
          ],
        })
      );

    // Merge succeeds
    mockCantonExercise
      .mockResolvedValueOnce({ success: true })  // merge
      .mockResolvedValueOnce({ success: true });  // split

    const result = await consolidateTokens("CantonMUSD", 80, "party1");

    expect(result.mergesPerformed).toBe(1);
    expect(result.splitPerformed).toBe(true);
    // Merge was called with the two largest tokens
    expect(mockCantonExercise).toHaveBeenCalledWith(
      "CantonMUSD",
      "cid1",           // primary (largest)
      "CantonMUSD_Merge",
      { otherCid: "cid2" },  // secondary
      "party1"
    );
  });

  it("throws when total balance is insufficient", async () => {
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        tokens: [
          makeToken("cid1", 10, "CantonMUSD"),
          makeToken("cid2", 20, "CantonMUSD"),
        ],
      })
    );

    await expect(
      consolidateTokens("CantonMUSD", 100, "party1")
    ).rejects.toThrow(/Insufficient total CantonMUSD balance/);
  });

  it("throws when merge fails", async () => {
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        tokens: [
          makeToken("cid1", 50, "CantonMUSD"),
          makeToken("cid2", 40, "CantonMUSD"),
        ],
      })
    );

    mockCantonExercise.mockResolvedValueOnce({
      success: false,
      error: "CONTRACT_NOT_FOUND",
    });

    await expect(
      consolidateTokens("CantonMUSD", 80, "party1")
    ).rejects.toThrow(/CONTRACT_NOT_FOUND/);
  });

  it("reports progress during merge loop", async () => {
    const progressUpdates: BatchProgress[] = [];
    const onProgress = (p: BatchProgress) => progressUpdates.push({ ...p });

    mockFetchFreshBalances
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [
            makeToken("cid1", 50, "CantonMUSD"),
            makeToken("cid2", 40, "CantonMUSD"),
          ],
        })
      )
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [makeToken("cid-merged", 90, "CantonMUSD")],
        })
      );

    mockCantonExercise.mockResolvedValueOnce({ success: true }); // merge

    await consolidateTokens("CantonMUSD", 90, "party1", onProgress);

    // Should have progress reports: checking, merging, done
    const phases = progressUpdates.map((p) => p.phase);
    expect(phases).toContain("checking");
    expect(phases).toContain("merging");
    expect(phases).toContain("done");
  });

  it("works with CantonUSDC token kind", async () => {
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        usdcTokens: [makeSimpleToken("usdc-exact", 100, "CantonUSDC")],
      })
    );

    const result = await consolidateTokens("CantonUSDC", 100, "party1");
    expect(result.contractId).toBe("usdc-exact");
    expect(result.mergesPerformed).toBe(0);
  });

  it("works with CantonCoin token kind", async () => {
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        cantonCoinTokens: [makeSimpleToken("coin-exact", 50)],
      })
    );

    const result = await consolidateTokens("CantonCoin", 50, "party1");
    expect(result.contractId).toBe("coin-exact");
    expect(result.mergesPerformed).toBe(0);
  });

  it("works with CantonSMUSD token kind", async () => {
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        smusdTokens: [makeSimpleToken("smusd-exact", 25)],
      })
    );

    const result = await consolidateTokens("CantonSMUSD", 25, "party1");
    expect(result.contractId).toBe("smusd-exact");
    expect(result.mergesPerformed).toBe(0);
  });

  it("works with CantonSMUSD_E token kind", async () => {
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        smusdETokens: [makeSimpleToken("smusde-exact", 75)],
      })
    );

    const result = await consolidateTokens("CantonSMUSD_E", 75, "party1");
    expect(result.contractId).toBe("smusde-exact");
    expect(result.mergesPerformed).toBe(0);
  });

  // ── Audit fix tests: dynamic merge budget ──────────────────────────────

  it("merge path: succeeds with >10 fragments (21 tokens)", async () => {
    // 21 tokens of 5 each = total 105; requesting 100.
    // Budget = min(128, 20) = 20. After 19 merges the largest token reaches
    // exactly 100 → loop breaks, exact match, no split needed.
    const initialTokens = Array.from({ length: 21 }, (_, i) =>
      makeToken(`frag-${i}`, 5, "CantonMUSD")
    );

    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({ tokens: initialTokens })
    );

    // Simulate 19 merge rounds (each merging the two largest)
    let currentTokens = [...initialTokens];
    for (let round = 0; round < 19; round++) {
      mockCantonExercise.mockResolvedValueOnce({ success: true });
      const sorted = [...currentTokens].sort(
        (a, b) => parseFloat(b.amount) - parseFloat(a.amount)
      );
      const merged = makeToken(
        `merged-${round}`,
        parseFloat(sorted[0].amount) + parseFloat(sorted[1].amount),
        "CantonMUSD"
      );
      currentTokens = [merged, ...sorted.slice(2)];
      mockFetchFreshBalances.mockResolvedValueOnce(
        makeBalancesData({ tokens: [...currentTokens] })
      );
    }

    const result = await consolidateTokens("CantonMUSD", 100, "party1");

    expect(result.mergesPerformed).toBe(19);
    expect(result.splitPerformed).toBe(false);
    expect(result.contractId).toBe("merged-18");
  });

  it("fails with clear message when merge budget exhausted without covering token", async () => {
    // 3 tokens of 40 each (total 120), requesting 100. Budget = 2.
    // Simulate concurrent activity re-fragmenting after each merge,
    // so no single token ever reaches 100.
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        tokens: [
          makeToken("x1", 40, "CantonMUSD"),
          makeToken("x2", 40, "CantonMUSD"),
          makeToken("x3", 40, "CantonMUSD"),
        ],
      })
    );

    mockCantonExercise
      .mockResolvedValueOnce({ success: true })   // merge 1
      .mockResolvedValueOnce({ success: true });   // merge 2

    // After merge 1: re-fragmented by concurrent activity
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        tokens: [
          makeToken("y1", 40, "CantonMUSD"),
          makeToken("y2", 40, "CantonMUSD"),
        ],
      })
    );
    // After merge 2: still fragmented
    mockFetchFreshBalances.mockResolvedValueOnce(
      makeBalancesData({
        tokens: [
          makeToken("z1", 40, "CantonMUSD"),
          makeToken("z2", 40, "CantonMUSD"),
        ],
      })
    );

    await expect(
      consolidateTokens("CantonMUSD", 100, "party1")
    ).rejects.toThrow(/Consolidation incomplete after 2 merges/);
  });

  // ── Audit fix tests: deterministic CID binding ─────────────────────────

  it("split CID binding: prefers split-created CID over pre-existing exact match", async () => {
    // Oversized token triggers split. After split, both a pre-existing token
    // and the newly-created split token have the exact requested amount.
    // The split exercise metadata contains the created CID → that one wins.
    mockFetchFreshBalances
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [makeToken("cid-big", 200, "CantonMUSD")],
        })
      )
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [
            makeToken("cid-preexisting-50", 50, "CantonMUSD"), // pre-existing
            makeToken("cid-split-new-50", 50, "CantonMUSD"),   // created by split
            makeToken("cid-remainder-150", 150, "CantonMUSD"),
          ],
        })
      );

    // Split exercise returns metadata with created CID
    mockCantonExercise.mockResolvedValueOnce({
      success: true,
      result: {
        events: [
          { created: { contractId: "cid-split-new-50" } },
          { created: { contractId: "cid-remainder-150" } },
        ],
      },
    });

    const result = await consolidateTokens("CantonMUSD", 50, "party1");

    expect(result.contractId).toBe("cid-split-new-50");
    expect(result.splitPerformed).toBe(true);
    expect(result.mergesPerformed).toBe(0);
  });

  it("split CID binding: falls back to exact-match when metadata absent", async () => {
    // Split exercise returns success but no result metadata.
    // Fallback: find any token with exact matching amount.
    mockFetchFreshBalances
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [makeToken("cid-big", 200, "CantonMUSD")],
        })
      )
      .mockResolvedValueOnce(
        makeBalancesData({
          tokens: [
            makeToken("cid-exact-50", 50, "CantonMUSD"),
            makeToken("cid-remainder-150", 150, "CantonMUSD"),
          ],
        })
      );

    // Split succeeds but no result metadata
    mockCantonExercise.mockResolvedValueOnce({ success: true });

    const result = await consolidateTokens("CantonMUSD", 50, "party1");

    expect(result.contractId).toBe("cid-exact-50");
    expect(result.splitPerformed).toBe(true);
    expect(result.mergesPerformed).toBe(0);
  });
});

// ── Last-staker partial guard ───────────────────────────────────────────

describe("isLastStakerPartialForbidden", () => {
  it("blocks last staker requesting partial withdrawal", () => {
    // User holds 1000 shares = all pool shares, requests 800 mUSD of 1000 pooled
    expect(isLastStakerPartialForbidden(1000, 1000, 800, 1000)).toBe(true);
  });

  it("allows last staker requesting full vault amount", () => {
    // User holds all shares and requests the entire pooled mUSD
    expect(isLastStakerPartialForbidden(1000, 1000, 1000, 1000)).toBe(false);
  });

  it("allows non-last-staker requesting partial withdrawal", () => {
    // User holds 500 of 1000 total shares — not last staker
    expect(isLastStakerPartialForbidden(500, 1000, 400, 1000)).toBe(false);
  });

  it("returns false when pool has no shares", () => {
    expect(isLastStakerPartialForbidden(0, 0, 100, 200)).toBe(false);
  });

  it("handles near-epsilon boundary: user slightly below total shares", () => {
    // userShares just barely under poolTotal by more than epsilon → not last staker
    expect(isLastStakerPartialForbidden(999, 1000, 800, 1000)).toBe(false);
  });
});

describe("mapBatchUnstakeError", () => {
  it("maps LAST_STAKER_PARTIAL_FORBIDDEN to friendly message", () => {
    expect(mapBatchUnstakeError("LAST_STAKER_PARTIAL_FORBIDDEN", "raw error"))
      .toBe(LAST_STAKER_PARTIAL_MSG);
  });

  it("returns fallback for unrecognised error type", () => {
    expect(mapBatchUnstakeError("CANTON_ERROR", "Something went wrong"))
      .toBe("Something went wrong");
  });

  it("returns fallback for INSUFFICIENT_BALANCE", () => {
    expect(mapBatchUnstakeError("INSUFFICIENT_BALANCE", "Not enough funds"))
      .toBe("Not enough funds");
  });

  it("returns fallback for FEATURE_DISABLED (server batch flag off)", () => {
    expect(mapBatchUnstakeError("FEATURE_DISABLED", "Batch choices not enabled"))
      .toBe("Batch choices not enabled");
  });
});

// ── Batch CID selection: forfeit-minimising (Option2 batch path) ─────────

describe("selectMinForfeitCoveringCids", () => {
  it("returns single CID for exact-match token", () => {
    const tokens = [makeToken("cid1", 50), makeToken("cid2", 100)];
    expect(selectMinForfeitCoveringCids(tokens, 100)).toEqual(["cid2"]);
  });

  it("prefers exact match over smaller covering tokens", () => {
    // 100 is exact, 200 also covers — exact match wins (zero forfeit)
    const tokens = [makeToken("big", 200), makeToken("exact", 100), makeToken("small", 30)];
    expect(selectMinForfeitCoveringCids(tokens, 100)).toEqual(["exact"]);
  });

  it("prefers smallest single covering token when no exact match", () => {
    // Need 80: tokens 90, 150, 200 all cover. Pick 90 (least overshoot = 10)
    const tokens = [makeToken("a", 200), makeToken("b", 90), makeToken("c", 150)];
    expect(selectMinForfeitCoveringCids(tokens, 80)).toEqual(["b"]);
  });

  it("accumulates from smallest upward when no single token covers", () => {
    // Need 80: tokens 30, 40, 50 — none covers alone.
    // Smallest-first: 30 + 40 = 70 (not enough), + 50 = 120 → done.
    // All 3 needed. But order is ascending: 30, 40, 50.
    const tokens = [makeToken("a", 30), makeToken("b", 50), makeToken("c", 40)];
    const result = selectMinForfeitCoveringCids(tokens, 80);
    expect(result).toEqual(["a", "c", "b"]); // ascending by amount
  });

  it("accumulates minimal set from smallest upward", () => {
    // Need 60: tokens 10, 20, 30, 50.
    // Smallest-first: 10 + 20 = 30, + 30 = 60 → covered. Stops, doesn't include 50.
    const tokens = [makeToken("d", 50), makeToken("a", 10), makeToken("b", 20), makeToken("c", 30)];
    const result = selectMinForfeitCoveringCids(tokens, 60);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("returns empty array when total is insufficient", () => {
    const tokens = [makeToken("a", 10), makeToken("b", 20)];
    expect(selectMinForfeitCoveringCids(tokens, 50)).toEqual([]);
  });

  it("returns empty array for zero requested amount", () => {
    const tokens = [makeToken("a", 100)];
    expect(selectMinForfeitCoveringCids(tokens, 0)).toEqual([]);
  });

  it("skips zero-amount tokens", () => {
    const tokens = [makeToken("a", 0), makeToken("b", 100), makeToken("c", 0)];
    expect(selectMinForfeitCoveringCids(tokens, 50)).toEqual(["b"]);
  });

  it("returns empty array for empty token list", () => {
    expect(selectMinForfeitCoveringCids([], 50)).toEqual([]);
  });

  it("handles near-epsilon exact match", () => {
    // Token amount differs from requested by less than EPSILON (0.000001)
    const tokens = [makeToken("cid1", 100.0000005)];
    expect(selectMinForfeitCoveringCids(tokens, 100)).toEqual(["cid1"]);
  });
});

// ── Guard parity: selected CIDs vs total shares ─────────────────────────

describe("last-staker guard with selected CIDs (parity fix)", () => {
  it("allows partial unstake when selected CIDs are a subset of total shares", () => {
    // User has 1000 shares across 4 tokens (250 each), pool total = 1000.
    // Requesting 200 smUSD → selectMinForfeitCoveringCids picks 1 token (250).
    // selectedShares = 250, poolTotal = 1000 → NOT last staker → allowed.
    const tokens = [
      makeToken("a", 250), makeToken("b", 250),
      makeToken("c", 250), makeToken("d", 250),
    ];
    const requested = 200;
    const cids = selectMinForfeitCoveringCids(tokens, requested);
    expect(cids).toHaveLength(1); // picks smallest covering (250)

    const selectedShares = tokens
      .filter((t) => cids.includes(t.contractId))
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    expect(selectedShares).toBe(250);

    // With old bug (total shares = 1000): would block (last staker + partial)
    // With fix (selected shares = 250): NOT last staker → allowed
    const poolTotal = 1000;
    const sharePrice = 1;
    const requestedMusd = requested * sharePrice;
    const pooledMusd = 1000;
    expect(isLastStakerPartialForbidden(selectedShares, poolTotal, requestedMusd, pooledMusd)).toBe(false);
    // Prove old logic would have blocked:
    expect(isLastStakerPartialForbidden(1000, poolTotal, requestedMusd, pooledMusd)).toBe(true);
  });

  it("blocks when selected CIDs consume all pool shares and request is partial", () => {
    // Single user, single token of 1000 = all pool shares.
    // Requesting 800 (partial). Selected CIDs = ["a"] with 1000 shares.
    const tokens = [makeToken("a", 1000)];
    const requested = 800;
    const cids = selectMinForfeitCoveringCids(tokens, requested);
    expect(cids).toEqual(["a"]);

    const selectedShares = 1000;
    const poolTotal = 1000;
    const requestedMusd = 800; // partial
    const pooledMusd = 1000;
    expect(isLastStakerPartialForbidden(selectedShares, poolTotal, requestedMusd, pooledMusd)).toBe(true);
  });

  it("allows full-vault request when selected CIDs consume all shares", () => {
    // Single user, single token of 1000 = all pool shares.
    // Requesting full 1000 → not partial → allowed.
    const tokens = [makeToken("a", 1000)];
    const requested = 1000;
    const cids = selectMinForfeitCoveringCids(tokens, requested);
    expect(cids).toEqual(["a"]);

    const selectedShares = 1000;
    const poolTotal = 1000;
    const requestedMusd = 1000; // full
    const pooledMusd = 1000;
    expect(isLastStakerPartialForbidden(selectedShares, poolTotal, requestedMusd, pooledMusd)).toBe(false);
  });
});

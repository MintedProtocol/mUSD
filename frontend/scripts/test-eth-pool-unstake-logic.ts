#!/usr/bin/env npx ts-node --skip-project
/**
 * test-eth-pool-unstake-logic.ts — Regression tests for ETH Pool unstake UX
 *
 * Bug context:
 *   ETHPool_Unstake takes exactly one smusdeCid. A user with tokens split across
 *   multiple contracts (e.g. 997 + 700 + 317 = 2014 total) can only unstake up to
 *   the largest single contract per transaction. The UI was setting MAX = totalSmusdE,
 *   which silently triggered "No smUSD-E contract large enough" at submission time.
 *
 * Fix:
 *   maxSingleSmusdE = smusdETokens.reduce((max, t) => Math.max(max, parseTokenAmount(t)), 0)
 *   - MAX button uses maxSingleSmusdE
 *   - Label shows "Total: X · Max per tx: Y" when fragmented
 *   - Button disabled when maxSingleSmusdE === 0, parsedAmount <= 0, or parsedAmount > maxSingleSmusdE
 *
 * Usage:
 *   npx ts-node --skip-project scripts/test-eth-pool-unstake-logic.ts
 *   # or via npm:
 *   npm run test:eth-pool-unstake
 */

import * as assert from "node:assert/strict";

// ── Types (matching CantonStake.tsx SimpleToken shape) ───────

interface SimpleToken {
  contractId: string;
  template: string;
  amount: string;
}

// ── Logic under test (extracted from CantonStake.tsx) ────────

const EPSILON = 0.000000001;

function parseTokenAmount(token?: { amount: string }): number {
  return token ? parseFloat(token.amount || "0") : 0;
}

function computeMaxSingle(tokens: SimpleToken[]): number {
  return tokens.reduce((max, t) => Math.max(max, parseTokenAmount(t)), 0);
}

function computeTotal(tokens: SimpleToken[]): number {
  return tokens.reduce((sum, t) => sum + parseTokenAmount(t), 0);
}

/** Mirrors the button disabled condition from CantonStake.tsx */
function isUnstakeButtonDisabled(maxSingle: number, parsedAmount: number): boolean {
  return maxSingle === 0 || parsedAmount <= 0 || parsedAmount > maxSingle;
}

/** Mirrors the label fragmentation hint condition from CantonStake.tsx */
function showsMaxPerTxHint(total: number, maxSingle: number): boolean {
  return total > maxSingle;
}

// ── Test fixtures ────────────────────────────────────────────

function makeToken(contractId: string, amount: string): SimpleToken {
  return { contractId, template: "CantonSMUSD_E", amount };
}

// Single contract: 997 smUSD-E
const singleTokens = [makeToken("cid-A", "997.0000000000")];

// Fragmented: 997 + 700 + 317 = 2014
const fragmentedTokens = [
  makeToken("cid-A", "997.0000000000"),
  makeToken("cid-B", "700.0000000000"),
  makeToken("cid-C", "317.0000000000"),
];

// Empty
const emptyTokens: SimpleToken[] = [];

// ── Test runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${(err as Error).message}`);
    failed++;
  }
}

console.log("=== ETH Pool Unstake Logic Regression Tests ===\n");

// ── Single-contract scenarios ────────────────────────────────

console.log("-- Single contract (cid-A: 997 smUSD-E) --");

test("single: maxSingle equals total", () => {
  const max = computeMaxSingle(singleTokens);
  const total = computeTotal(singleTokens);
  assert.equal(max, total, "maxSingle must equal total when there is one contract");
});

test("single: no fragmentation hint shown", () => {
  const max = computeMaxSingle(singleTokens);
  const total = computeTotal(singleTokens);
  assert.equal(showsMaxPerTxHint(total, max), false, "No 'Max per tx' hint should appear for single contract");
});

test("single: MAX fills exactly the contract amount", () => {
  const max = computeMaxSingle(singleTokens);
  assert.equal(max, 997, "MAX should be 997 — the only contract");
});

test("single: button enabled at max amount", () => {
  const max = computeMaxSingle(singleTokens);
  assert.equal(isUnstakeButtonDisabled(max, 997), false, "Button must be enabled when parsedAmount === maxSingle");
});

test("single: button enabled for partial amount", () => {
  const max = computeMaxSingle(singleTokens);
  assert.equal(isUnstakeButtonDisabled(max, 500), false, "Button must be enabled for any amount ≤ maxSingle");
});

test("single: button disabled for zero amount", () => {
  const max = computeMaxSingle(singleTokens);
  assert.equal(isUnstakeButtonDisabled(max, 0), true, "Button must be disabled when parsedAmount === 0");
});

// ── Fragmented-contract scenarios ────────────────────────────

console.log("\n-- Fragmented contracts (997 + 700 + 317 = 2014 smUSD-E) --");

test("fragmented: maxSingle equals largest contract", () => {
  const max = computeMaxSingle(fragmentedTokens);
  assert.equal(max, 997, "maxSingle must be 997 — the largest single contract");
});

test("fragmented: total equals sum of all contracts", () => {
  const total = computeTotal(fragmentedTokens);
  assert.equal(total, 2014, "total must be 2014 (997 + 700 + 317)");
});

test("fragmented: fragmentation hint is shown", () => {
  const max = computeMaxSingle(fragmentedTokens);
  const total = computeTotal(fragmentedTokens);
  assert.equal(showsMaxPerTxHint(total, max), true, "'Max per tx' hint must appear when fragmented");
});

test("fragmented: MAX button fills largest single (997), not total (2014)", () => {
  const max = computeMaxSingle(fragmentedTokens);
  assert.equal(max, 997, "MAX button value must be 997, not 2014");
  assert.notEqual(max, 2014, "MAX must NOT equal the total");
});

test("fragmented: button enabled at maxSingle amount", () => {
  const max = computeMaxSingle(fragmentedTokens);
  assert.equal(isUnstakeButtonDisabled(max, 997), false, "Button must be enabled at exactly maxSingle");
});

test("fragmented: button disabled when amount exceeds maxSingle", () => {
  const max = computeMaxSingle(fragmentedTokens);
  assert.equal(isUnstakeButtonDisabled(max, 998), true, "Button must be disabled when parsedAmount > maxSingle (998 > 997)");
  assert.equal(isUnstakeButtonDisabled(max, 2014), true, "Button must be disabled at full total (2014 > 997)");
});

test("fragmented: button enabled for partial amounts within maxSingle", () => {
  const max = computeMaxSingle(fragmentedTokens);
  assert.equal(isUnstakeButtonDisabled(max, 1), false);
  assert.equal(isUnstakeButtonDisabled(max, 500), false);
  assert.equal(isUnstakeButtonDisabled(max, 996.9999), false);
});

// ── Empty / zero scenarios ────────────────────────────────────

console.log("\n-- Empty / zero balance --");

test("empty: maxSingle is 0", () => {
  assert.equal(computeMaxSingle(emptyTokens), 0);
});

test("empty: button always disabled (maxSingle === 0)", () => {
  assert.equal(isUnstakeButtonDisabled(0, 1), true, "Button must be disabled when no tokens exist");
  assert.equal(isUnstakeButtonDisabled(0, 0), true, "Button must be disabled when no tokens and zero amount");
});

test("empty: no fragmentation hint shown", () => {
  assert.equal(showsMaxPerTxHint(0, 0), false, "No hint when both total and max are 0");
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failed > 0) {
  console.log("\n=== SOME TESTS FAILED ===");
  process.exit(1);
} else {
  console.log("\n=== ALL TESTS PASSED ===");
}

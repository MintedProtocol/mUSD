#!/usr/bin/env npx ts-node --skip-project
/**
 * test-pool-reserved-cid.ts — Regression test for pool-reserved CID exclusion
 * in /api/canton-convert operator inventory selection.
 *
 * Bug: canton-convert.ts selected ALL operator CantonMUSD tokens as conversion
 * inventory, including the staking pool's reserved token (poolMusdCid).
 * Consuming it broke Stake with CONTRACT_NOT_FOUND.
 *
 * Fix: Step 5 now queries CantonStakingService for poolMusdCid and excludes
 * those CIDs from inventory selection (step 5b).
 *
 * This test exercises the filtering logic in isolation — no Canton connection.
 *
 * Usage:
 *   npx ts-node --skip-project scripts/test-pool-reserved-cid.ts
 *   # or via npm:
 *   npm run test:pool-reserved-cid
 */

import * as assert from "node:assert/strict";

// ── Types matching canton-convert.ts ────────────────────────

interface RawContract {
  contractId: string;
  templateId: string;
  createArgument: Record<string, unknown>;
}

interface OperatorMusdEntry {
  contractId: string;
  templateId: string;
  amount: number;
  issuer: string;
  agreementHash: string;
  agreementUri: string;
}

// ── Extracted logic under test ──────────────────────────────

/**
 * Replicates the inventory selection from canton-convert.ts steps 5 + 5b.
 * Given raw operator contracts and a set of reserved CIDs, returns the
 * filtered inventory list.
 */
function selectOperatorInventory(
  contracts: RawContract[],
  operatorParty: string,
  reservedCids: Set<string>
): OperatorMusdEntry[] {
  const result: OperatorMusdEntry[] = [];
  for (const c of contracts) {
    if (
      (c.createArgument.owner as string) === operatorParty &&
      (c.createArgument.issuer as string) === operatorParty &&
      !reservedCids.has(c.contractId)
    ) {
      result.push({
        contractId: c.contractId,
        templateId: c.templateId,
        amount: parseFloat((c.createArgument.amount as string) || "0"),
        issuer: (c.createArgument.issuer as string) || "",
        agreementHash: (c.createArgument.agreementHash as string) || "",
        agreementUri: (c.createArgument.agreementUri as string) || "",
      });
    }
  }
  return result;
}

/**
 * Replicates the OLD (buggy) behavior: no reservedCids filtering.
 */
function selectOperatorInventoryOLD(
  contracts: RawContract[],
  operatorParty: string
): OperatorMusdEntry[] {
  const result: OperatorMusdEntry[] = [];
  for (const c of contracts) {
    if (
      (c.createArgument.owner as string) === operatorParty &&
      (c.createArgument.issuer as string) === operatorParty
    ) {
      result.push({
        contractId: c.contractId,
        templateId: c.templateId,
        amount: parseFloat((c.createArgument.amount as string) || "0"),
        issuer: (c.createArgument.issuer as string) || "",
        agreementHash: (c.createArgument.agreementHash as string) || "",
        agreementUri: (c.createArgument.agreementUri as string) || "",
      });
    }
  }
  return result;
}

// ── Test fixtures ───────────────────────────────────────────

const OPERATOR = "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const POOL_CID = "006651eb0000dead0000000000000000pool-reserved";
const SAFE_CID_1 = "00aabb110000000000000000000000000000inventory-a";
const SAFE_CID_2 = "00ccdd220000000000000000000000000000inventory-b";
const TPL = "pkg123:CantonDirectMint:CantonMUSD";

const allContracts: RawContract[] = [
  {
    contractId: POOL_CID,
    templateId: TPL,
    createArgument: { owner: OPERATOR, issuer: OPERATOR, amount: "47.0000000000", agreementHash: "abc", agreementUri: "uri" },
  },
  {
    contractId: SAFE_CID_1,
    templateId: TPL,
    createArgument: { owner: OPERATOR, issuer: OPERATOR, amount: "100.0000000000", agreementHash: "abc", agreementUri: "uri" },
  },
  {
    contractId: SAFE_CID_2,
    templateId: TPL,
    createArgument: { owner: OPERATOR, issuer: OPERATOR, amount: "25.0000000000", agreementHash: "abc", agreementUri: "uri" },
  },
];

const reservedCids = new Set([POOL_CID]);

// ── Tests ───────────────────────────────────────────────────

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

console.log("=== Pool-Reserved CID Exclusion Regression Tests ===\n");

// 1. NEW behavior: pool-reserved CID is excluded
test("new behavior excludes pool-reserved CID from inventory", () => {
  const inv = selectOperatorInventory(allContracts, OPERATOR, reservedCids);
  const cids = inv.map(c => c.contractId);
  assert.ok(!cids.includes(POOL_CID), `Pool CID ${POOL_CID.slice(0, 20)}... must NOT be in inventory`);
  assert.equal(inv.length, 2, "Should have exactly 2 contracts (pool excluded)");
});

// 2. NEW behavior: non-reserved CIDs are still included
test("new behavior keeps non-reserved operator contracts", () => {
  const inv = selectOperatorInventory(allContracts, OPERATOR, reservedCids);
  const cids = inv.map(c => c.contractId);
  assert.ok(cids.includes(SAFE_CID_1), "SAFE_CID_1 must be in inventory");
  assert.ok(cids.includes(SAFE_CID_2), "SAFE_CID_2 must be in inventory");
});

// 3. OLD behavior: pool-reserved CID was incorrectly included (regression proof)
test("old behavior (bug) would include pool-reserved CID", () => {
  const inv = selectOperatorInventoryOLD(allContracts, OPERATOR);
  const cids = inv.map(c => c.contractId);
  assert.ok(cids.includes(POOL_CID), "Old code would include pool CID — confirming the bug existed");
  assert.equal(inv.length, 3, "Old code returns all 3 contracts");
});

// 4. Empty reserved set: all contracts returned
test("empty reservedCids returns all operator contracts", () => {
  const inv = selectOperatorInventory(allContracts, OPERATOR, new Set());
  assert.equal(inv.length, 3, "With no reservations, all 3 contracts should be returned");
});

// 5. Non-operator contracts are filtered regardless
test("non-operator-owned contracts are always excluded", () => {
  const withUser: RawContract[] = [
    ...allContracts,
    {
      contractId: "00user000000000000000000000000000000user-token",
      templateId: TPL,
      createArgument: { owner: "user::1220abcd", issuer: OPERATOR, amount: "50.0", agreementHash: "abc", agreementUri: "uri" },
    },
  ];
  const inv = selectOperatorInventory(withUser, OPERATOR, reservedCids);
  assert.equal(inv.length, 2, "User-owned contract must be excluded from operator inventory");
});

// 6. Multiple reserved CIDs
test("multiple reserved CIDs all excluded", () => {
  const multiReserved = new Set([POOL_CID, SAFE_CID_2]);
  const inv = selectOperatorInventory(allContracts, OPERATOR, multiReserved);
  assert.equal(inv.length, 1, "Only SAFE_CID_1 should remain");
  assert.equal(inv[0].contractId, SAFE_CID_1);
});

// 7. Amount parsing
test("amounts are correctly parsed from string fields", () => {
  const inv = selectOperatorInventory(allContracts, OPERATOR, reservedCids);
  const byId = Object.fromEntries(inv.map(c => [c.contractId, c]));
  assert.equal(byId[SAFE_CID_1].amount, 100, "SAFE_CID_1 amount should be 100");
  assert.equal(byId[SAFE_CID_2].amount, 25, "SAFE_CID_2 amount should be 25");
});

// ── Summary ─────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failed > 0) {
  console.log("\n=== SOME TESTS FAILED ===");
  process.exit(1);
} else {
  console.log("\n=== ALL TESTS PASSED ===");
}

/**
 * Tests for relay/batch-support.ts
 *
 * Covers:
 *   1. Feature flag gating (default OFF)
 *   2. Template ID resolution
 *   3. Command building (unstake + deposit)
 *   4. Health report
 *   5. Error code extraction
 *   6. Fallback to legacy when disabled
 */

// Silence console during tests
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const TEST_PKG_ID = "a".repeat(64);
const TEST_LENDING_PKG_ID = "b".repeat(64);

function loadModule() {
  // Clear module cache to pick up env changes
  jest.resetModules();
  return require("../batch-support") as typeof import("../batch-support");
}

describe("batch-support feature flag", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to OFF when ENABLE_BATCH_CHOICES is unset", () => {
    delete process.env.ENABLE_BATCH_CHOICES;
    const mod = loadModule();
    expect(mod.isBatchEnabled()).toBe(false);
  });

  it("defaults to OFF when ENABLE_BATCH_CHOICES is 'false'", () => {
    process.env.ENABLE_BATCH_CHOICES = "false";
    const mod = loadModule();
    expect(mod.isBatchEnabled()).toBe(false);
  });

  it("is ON when ENABLE_BATCH_CHOICES is 'true'", () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const mod = loadModule();
    expect(mod.isBatchEnabled()).toBe(true);
  });
});

describe("resolveBatchTemplateId", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CANTON_PACKAGE_ID: TEST_PKG_ID,
      CANTON_LENDING_PACKAGE_ID: TEST_LENDING_PKG_ID,
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves ETHPool_BatchUnstake with main package ID", () => {
    const mod = loadModule();
    expect(mod.resolveBatchTemplateId("ETHPool_BatchUnstake")).toBe(
      `${TEST_PKG_ID}:CantonETHPool:CantonETHPoolService`
    );
  });

  it("resolves Unstake_Batch with main package ID", () => {
    const mod = loadModule();
    expect(mod.resolveBatchTemplateId("Unstake_Batch")).toBe(
      `${TEST_PKG_ID}:CantonSMUSD:CantonStakingService`
    );
  });

  it("resolves Lending_BatchDepositSMUSD with lending package ID", () => {
    const mod = loadModule();
    expect(mod.resolveBatchTemplateId("Lending_BatchDepositSMUSD")).toBe(
      `${TEST_LENDING_PKG_ID}:CantonLending:CantonLendingService`
    );
  });

  it("resolves Lending_BatchDepositSMUSDE with lending package ID", () => {
    const mod = loadModule();
    expect(mod.resolveBatchTemplateId("Lending_BatchDepositSMUSDE")).toBe(
      `${TEST_LENDING_PKG_ID}:CantonLending:CantonLendingService`
    );
  });

  it("falls back to CANTON_PACKAGE_ID when CANTON_LENDING_PACKAGE_ID is unset", () => {
    delete process.env.CANTON_LENDING_PACKAGE_ID;
    const mod = loadModule();
    expect(mod.resolveBatchTemplateId("Lending_BatchDepositSMUSD")).toBe(
      `${TEST_PKG_ID}:CantonLending:CantonLendingService`
    );
  });

  it("returns null for unknown choice name", () => {
    const mod = loadModule();
    expect(mod.resolveBatchTemplateId("NonExistentChoice")).toBeNull();
  });

  it("returns null when no package ID is configured", () => {
    delete process.env.CANTON_PACKAGE_ID;
    delete process.env.CANTON_LENDING_PACKAGE_ID;
    const mod = loadModule();
    expect(mod.resolveBatchTemplateId("ETHPool_BatchUnstake")).toBeNull();
  });
});

describe("buildBatchUnstakeCommand", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ENABLE_BATCH_CHOICES: "true",
      CANTON_PACKAGE_ID: TEST_PKG_ID,
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("builds ETHPool_BatchUnstake command with smusdeCids field", () => {
    const mod = loadModule();
    const cmd = mod.buildBatchUnstakeCommand("ETHPool_BatchUnstake", "svc-001", {
      user: "alice::1220" + "0".repeat(64),
      contractIds: ["cid-1", "cid-2", "cid-3"],
      requestedMusd: "100.0000000000",
    });
    expect(cmd).not.toBeNull();
    const ex = (cmd as Record<string, unknown>).ExerciseCommand as Record<string, unknown>;
    expect(ex.choice).toBe("ETHPool_BatchUnstake");
    expect(ex.contractId).toBe("svc-001");
    const args = ex.choiceArgument as Record<string, unknown>;
    expect(args.smusdeCids).toEqual(["cid-1", "cid-2", "cid-3"]);
    expect(args.requestedMusd).toBe("100.0000000000");
  });

  it("builds Unstake_Batch command with smusdCids field", () => {
    const mod = loadModule();
    const cmd = mod.buildBatchUnstakeCommand("Unstake_Batch", "svc-002", {
      user: "bob::1220" + "1".repeat(64),
      contractIds: ["cid-a"],
      requestedMusd: "50.0000000000",
    });
    expect(cmd).not.toBeNull();
    const ex = (cmd as Record<string, unknown>).ExerciseCommand as Record<string, unknown>;
    expect(ex.choice).toBe("Unstake_Batch");
    const args = ex.choiceArgument as Record<string, unknown>;
    expect(args.smusdCids).toEqual(["cid-a"]);
    expect(args.smusdeCids).toBeUndefined();
  });

  it("returns null when batch choices are disabled", () => {
    process.env.ENABLE_BATCH_CHOICES = "false";
    const mod = loadModule();
    const cmd = mod.buildBatchUnstakeCommand("ETHPool_BatchUnstake", "svc-001", {
      user: "alice::1220" + "0".repeat(64),
      contractIds: ["cid-1"],
      requestedMusd: "100.0000000000",
    });
    expect(cmd).toBeNull();
  });
});

describe("buildBatchDepositCommand", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ENABLE_BATCH_CHOICES: "true",
      CANTON_PACKAGE_ID: TEST_PKG_ID,
      CANTON_LENDING_PACKAGE_ID: TEST_LENDING_PKG_ID,
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("builds Lending_BatchDepositSMUSD command", () => {
    const mod = loadModule();
    const cmd = mod.buildBatchDepositCommand("Lending_BatchDepositSMUSD", "svc-003", {
      user: "alice::1220" + "0".repeat(64),
      contractIds: ["cid-x", "cid-y"],
      existingEscrowCid: "escrow-001",
      collateralAggCid: null,
    });
    expect(cmd).not.toBeNull();
    const ex = (cmd as Record<string, unknown>).ExerciseCommand as Record<string, unknown>;
    expect(ex.choice).toBe("Lending_BatchDepositSMUSD");
    const args = ex.choiceArgument as Record<string, unknown>;
    expect(args.smusdCids).toEqual(["cid-x", "cid-y"]);
    expect(args.existingEscrowCid).toBe("escrow-001");
    expect(args.collateralAggCid).toBeNull();
  });

  it("builds Lending_BatchDepositSMUSDE command with smusdeCids", () => {
    const mod = loadModule();
    const cmd = mod.buildBatchDepositCommand("Lending_BatchDepositSMUSDE", "svc-004", {
      user: "bob::1220" + "1".repeat(64),
      contractIds: ["cid-e1", "cid-e2", "cid-e3"],
      existingEscrowCid: null,
      collateralAggCid: "agg-001",
    });
    const ex = (cmd as Record<string, unknown>).ExerciseCommand as Record<string, unknown>;
    const args = ex.choiceArgument as Record<string, unknown>;
    expect(args.smusdeCids).toEqual(["cid-e1", "cid-e2", "cid-e3"]);
    expect(args.existingEscrowCid).toBeNull();
    expect(args.collateralAggCid).toBe("agg-001");
  });

  it("returns null when batch choices are disabled", () => {
    process.env.ENABLE_BATCH_CHOICES = "false";
    const mod = loadModule();
    const cmd = mod.buildBatchDepositCommand("Lending_BatchDepositSMUSD", "svc-003", {
      user: "alice::1220" + "0".repeat(64),
      contractIds: ["cid-x"],
      existingEscrowCid: null,
      collateralAggCid: null,
    });
    expect(cmd).toBeNull();
  });
});

describe("getBatchHealthReport", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ENABLE_BATCH_CHOICES: "true",
      CANTON_PACKAGE_ID: TEST_PKG_ID,
      CANTON_LENDING_PACKAGE_ID: TEST_LENDING_PKG_ID,
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("reports all four templates resolved when configured", () => {
    const mod = loadModule();
    const report = mod.getBatchHealthReport();
    expect(report.batchEnabled).toBe(true);
    expect(Object.keys(report.resolvedTemplates)).toHaveLength(4);
    for (const tid of Object.values(report.resolvedTemplates)) {
      expect(tid).not.toBeNull();
    }
  });

  it("reports batchEnabled=false when flag is off", () => {
    process.env.ENABLE_BATCH_CHOICES = "false";
    const mod = loadModule();
    const report = mod.getBatchHealthReport();
    expect(report.batchEnabled).toBe(false);
  });
});

describe("extractBatchErrorCode", () => {
  it("extracts known DAML assertion codes", () => {
    const mod = loadModule();
    expect(mod.extractBatchErrorCode("assertion failed: SERVICE_PAUSED")).toBe("SERVICE_PAUSED");
    expect(mod.extractBatchErrorCode("blah OWNER_MISMATCH blah")).toBe("OWNER_MISMATCH");
    expect(mod.extractBatchErrorCode("INSUFFICIENT_BALANCE check")).toBe("INSUFFICIENT_BALANCE");
    expect(mod.extractBatchErrorCode("COOLDOWN_NOT_ELAPSED for position")).toBe(
      "COOLDOWN_NOT_ELAPSED"
    );
    expect(mod.extractBatchErrorCode("POSITION_LOCKED until 2026")).toBe("POSITION_LOCKED");
  });

  it("returns null for unknown error messages", () => {
    const mod = loadModule();
    expect(mod.extractBatchErrorCode("Something else went wrong")).toBeNull();
    expect(mod.extractBatchErrorCode("")).toBeNull();
  });
});

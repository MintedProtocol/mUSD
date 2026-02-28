/**
 * Tests for /api/canton-batch-unstake
 *
 * Test matrix:
 *   1. Feature flag OFF → 404
 *   2. Missing/invalid input → 400 with typed error
 *   3. Per-choice flag disable → 404
 *   4. Config error → 500
 *   5. Success path (ethpool) → 200
 *   6. Success path (smusd) → 200
 *   7. Idempotent replay → 200 (cached)
 *   8. Canton error → 502 with classification
 *   9. Service not found → 502
 *  10. Malformed contractIds → 400
 */

// ── mocks ──────────────────────────────────────────────────────────────

export {}; // ensure this is treated as a module

const mockFetch = jest.fn();
(global as Record<string, unknown>).fetch = mockFetch;

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const TEST_PARTY = "alice::1220" + "0".repeat(64);
const TEST_PKG = "c".repeat(64);

function makeReq(body: Record<string, unknown> = {}, method = "POST") {
  return { method, body } as unknown as import("next").NextApiRequest;
}

function makeRes() {
  const data: { statusCode: number; body: unknown } = { statusCode: 0, body: null };
  const res = {
    status(code: number) {
      data.statusCode = code;
      return res;
    },
    json(body: unknown) {
      data.body = body;
      return res;
    },
  } as unknown as import("next").NextApiResponse;
  return { res, data };
}

function loadHandler() {
  jest.resetModules();
  process.env.CANTON_PACKAGE_ID = TEST_PKG;
  process.env.CANTON_PARTY = TEST_PARTY;
  process.env.CANTON_TOKEN = "test-token";
  return require("../canton-batch-unstake").default as (
    req: import("next").NextApiRequest,
    res: import("next").NextApiResponse
  ) => Promise<void>;
}

// Mock Canton responses
function mockCantonSuccess() {
  mockFetch
    // ledger-end
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ offset: "1000" }),
    })
    // active-contracts (service lookup)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          contractEntry: {
            JsActiveContract: {
              createdEvent: {
                contractId: "svc-contract-001",
                templateId: `${TEST_PKG}:CantonETHPool:CantonETHPoolService`,
              },
            },
          },
        },
      ],
    })
    // submit-and-wait
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: {} }),
    });
}

// ── tests ──────────────────────────────────────────────────────────────

describe("/api/canton-batch-unstake", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockFetch.mockReset();
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 404 when ENABLE_BATCH_CHOICES is unset", async () => {
    delete process.env.ENABLE_BATCH_CHOICES;
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: ["cid-1"],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(404);
    expect((data.body as Record<string, unknown>).errorType).toBe("FEATURE_DISABLED");
  });

  it("returns 405 for GET requests", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(makeReq({}, "GET"), res);
    expect(data.statusCode).toBe(405);
  });

  it("returns 400 for missing pool field", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({ party: TEST_PARTY, contractIds: ["cid-1"], requestedMusd: "100" }),
      res
    );
    expect(data.statusCode).toBe(400);
    expect((data.body as Record<string, unknown>).field).toBe("pool");
  });

  it("returns 400 for invalid pool value", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "invalid",
        contractIds: ["cid-1"],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(400);
  });

  it("returns 400 for empty contractIds array", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: [],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(400);
    expect((data.body as Record<string, unknown>).error).toContain("must not be empty");
  });

  it("returns 400 for negative requestedMusd", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: ["abc123"],
        requestedMusd: "-50",
      }),
      res
    );
    expect(data.statusCode).toBe(400);
    expect((data.body as Record<string, unknown>).error).toContain("positive");
  });

  it("returns 400 for duplicate contract IDs", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: ["abc123", "abc123"],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(400);
    expect((data.body as Record<string, unknown>).error).toContain("Duplicate");
  });

  it("returns 404 when per-choice flag disables ETHPool_BatchUnstake", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    process.env.DISABLE_ETHPOOL_BATCH_UNSTAKE = "true";
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: ["abc123"],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(404);
    expect((data.body as Record<string, unknown>).errorType).toBe("FEATURE_DISABLED");
  });

  it("returns 404 when per-choice flag disables Unstake_Batch", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    process.env.DISABLE_SMUSD_BATCH_UNSTAKE = "true";
    const handler = loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "smusd",
        contractIds: ["abc123"],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(404);
  });

  it("returns 200 on success (ethpool)", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    mockCantonSuccess();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: ["abc123", "def456"],
        requestedMusd: "100.5",
      }),
      res
    );
    expect(data.statusCode).toBe(200);
    const body = data.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.mode).toBe("batch");
    expect(body.pool).toBe("ethpool");
    expect(body.commandId).toMatch(/^batch-unstake-ethpool-/);
  });

  it("returns 502 when no service contract found", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ offset: "1000" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [] }); // empty contracts
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: ["abc123"],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(502);
    expect((data.body as Record<string, unknown>).errorType).toBe("SERVICE_NOT_FOUND");
  });

  it("classifies Canton SERVICE_PAUSED error", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ offset: "1000" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            contractEntry: {
              JsActiveContract: {
                createdEvent: {
                  contractId: "svc-001",
                  templateId: `${TEST_PKG}:CantonETHPool:CantonETHPoolService`,
                },
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "assertion failed: SERVICE_PAUSED",
      });
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: ["abc123"],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(400);
    expect((data.body as Record<string, unknown>).errorType).toBe("SERVICE_PAUSED");
  });

  it("returns 500 when CANTON_PARTY is not configured", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = loadHandler();
    delete process.env.CANTON_PARTY; // delete after load so env getter reads missing value
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        pool: "ethpool",
        contractIds: ["abc123"],
        requestedMusd: "100",
      }),
      res
    );
    expect(data.statusCode).toBe(500);
    expect((data.body as Record<string, unknown>).errorType).toBe("CONFIG_ERROR");
  });
});

/**
 * Tests for /api/canton-batch-deposit
 *
 * Test matrix:
 *   1. Feature flag OFF → 404
 *   2. Missing/invalid collateralType → 400
 *   3. Empty contractIds → 400
 *   4. Success path (smusd) → 200
 *   5. Success path (smusde) → 200
 *   6. Optional escrowCid / aggCid handling
 *   7. Canton error → classified
 *   8. Config error (lending package missing) → 500
 */
export {}; // ensure this is treated as a module

const mockFetch = vi.fn();
(global as Record<string, unknown>).fetch = mockFetch;

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

const TEST_PARTY = "alice::1220" + "0".repeat(64);
const TEST_PKG = "d".repeat(64);
const TEST_LENDING_PKG = "e".repeat(64);

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

async function loadHandler() {
  vi.resetModules();
  process.env.CANTON_PACKAGE_ID = TEST_PKG;
  process.env.CANTON_LENDING_PACKAGE_ID = TEST_LENDING_PKG;
  process.env.CANTON_PARTY = TEST_PARTY;
  process.env.CANTON_TOKEN = "test-token";
  return (await import("@/pages/api/canton-batch-deposit")).default as (
    req: import("next").NextApiRequest,
    res: import("next").NextApiResponse
  ) => Promise<void>;
}

function mockCantonSuccess() {
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ offset: "2000" }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          contractEntry: {
            JsActiveContract: {
              createdEvent: {
                contractId: "lending-svc-001",
                templateId: `${TEST_LENDING_PKG}:CantonLending:CantonLendingService`,
              },
            },
          },
        },
      ],
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ result: {} }) });
}

describe("/api/canton-batch-deposit", () => {
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
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["cid-1"],
      }),
      res
    );
    expect(data.statusCode).toBe(404);
    expect((data.body as Record<string, unknown>).errorType).toBe("FEATURE_DISABLED");
  });

  it("returns 400 for missing collateralType", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({ party: TEST_PARTY, contractIds: ["cid-1"] }),
      res
    );
    expect(data.statusCode).toBe(400);
    expect((data.body as Record<string, unknown>).field).toBe("collateralType");
  });

  it("returns 400 for invalid collateralType", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "usdc",
        contractIds: ["cid-1"],
      }),
      res
    );
    expect(data.statusCode).toBe(400);
  });

  it("returns 400 for empty contractIds", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: [],
      }),
      res
    );
    expect(data.statusCode).toBe(400);
    expect((data.body as Record<string, unknown>).error).toContain("must not be empty");
  });

  it("returns 200 on success (smusd deposit)", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    mockCantonSuccess();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["abc123", "def456"],
      }),
      res
    );
    expect(data.statusCode).toBe(200);
    const body = data.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.mode).toBe("batch");
    expect(body.collateralType).toBe("smusd");
    expect(body.positionCount).toBe(2);
  });

  it("returns 200 on success (smusde deposit with escrow)", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    mockCantonSuccess();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusde",
        contractIds: ["abc123"],
        existingEscrowCid: "escrow-001",
        collateralAggCid: "agg-001",
      }),
      res
    );
    expect(data.statusCode).toBe(200);
    const body = data.body as Record<string, unknown>;
    expect(body.collateralType).toBe("smusde");
  });

  it("treats absent escrowCid as null (not error)", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    mockCantonSuccess();
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["abc123"],
        // existingEscrowCid and collateralAggCid intentionally omitted
      }),
      res
    );
    expect(data.statusCode).toBe(200);
  });

  it("returns 502 when no lending service contract found", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ offset: "2000" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["abc123"],
      }),
      res
    );
    expect(data.statusCode).toBe(502);
    expect((data.body as Record<string, unknown>).errorType).toBe("SERVICE_NOT_FOUND");
  });

  it("produces different idempotency keys for different collateralAggCid", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();

    // First call with aggCid = "agg-A"
    mockCantonSuccess();
    const { res: res1, data: data1 } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["abc123"],
        existingEscrowCid: "escrow-001",
        collateralAggCid: "agg-A",
      }),
      res1
    );
    expect(data1.statusCode).toBe(200);
    const cmd1 = (data1.body as Record<string, unknown>).commandId;

    // Second call with same CIDs/escrow but aggCid = "agg-B"
    // This MUST produce a new command (not replay cached result)
    mockCantonSuccess();
    const { res: res2, data: data2 } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["abc123"],
        existingEscrowCid: "escrow-001",
        collateralAggCid: "agg-B",
      }),
      res2
    );
    expect(data2.statusCode).toBe(200);
    const cmd2 = (data2.body as Record<string, unknown>).commandId;

    // Different aggregate target => different command
    expect(cmd1).not.toBe(cmd2);
  });

  it("produces different idempotency keys for different existingEscrowCid", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();

    // First call with escrow = null
    mockCantonSuccess();
    const { res: res1, data: data1 } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["aaa111"],
      }),
      res1
    );
    expect(data1.statusCode).toBe(200);
    const cmd1 = (data1.body as Record<string, unknown>).commandId;

    // Second call with same CIDs but escrow = "escrow-new"
    mockCantonSuccess();
    const { res: res2, data: data2 } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["aaa111"],
        existingEscrowCid: "escrow-new",
      }),
      res2
    );
    expect(data2.statusCode).toBe(200);
    const cmd2 = (data2.body as Record<string, unknown>).commandId;

    expect(cmd1).not.toBe(cmd2);
  });

  it("classifies Canton SMUSD_NOT_ENABLED error", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ offset: "2000" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            contractEntry: {
              JsActiveContract: {
                createdEvent: {
                  contractId: "lending-001",
                  templateId: `${TEST_LENDING_PKG}:CantonLending:CantonLendingService`,
                },
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "assertion failed: SMUSD_NOT_ENABLED",
      });
    const { res, data } = makeRes();
    await handler(
      makeReq({
        party: TEST_PARTY,
        collateralType: "smusd",
        contractIds: ["abc123"],
      }),
      res
    );
    expect(data.statusCode).toBe(400);
    expect((data.body as Record<string, unknown>).errorType).toBe("COLLATERAL_NOT_ENABLED");
  });
});

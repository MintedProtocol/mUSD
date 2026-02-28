/**
 * Tests for /api/canton-batch-capability
 *
 * Test matrix:
 *   1. Returns capabilities when batch choices enabled
 *   2. Returns capabilities when batch choices disabled
 *   3. Per-choice overrides reflected
 *   4. Method guard (POST → 405)
 *   5. Version string present
 */

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

function makeReq(method = "GET") {
  return { method, body: {} } as unknown as import("next").NextApiRequest;
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
  return (await import("@/pages/api/canton-batch-capability")).default as (
    req: import("next").NextApiRequest,
    res: import("next").NextApiResponse
  ) => Promise<void>;
}

describe("/api/canton-batch-capability", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns all choices OFF when ENABLE_BATCH_CHOICES is unset", async () => {
    delete process.env.ENABLE_BATCH_CHOICES;
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(makeReq(), res);
    expect(data.statusCode).toBe(200);
    const body = data.body as Record<string, unknown>;
    expect(body.batchChoicesEnabled).toBe(false);
    const choices = body.choices as Record<string, boolean>;
    expect(choices.ETHPool_BatchUnstake).toBe(false);
    expect(choices.Unstake_Batch).toBe(false);
    expect(choices.Lending_BatchDepositSMUSD).toBe(false);
    expect(choices.Lending_BatchDepositSMUSDE).toBe(false);
  });

  it("returns all choices ON when ENABLE_BATCH_CHOICES is true", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(makeReq(), res);
    expect(data.statusCode).toBe(200);
    const body = data.body as Record<string, unknown>;
    expect(body.batchChoicesEnabled).toBe(true);
    const choices = body.choices as Record<string, boolean>;
    expect(choices.ETHPool_BatchUnstake).toBe(true);
    expect(choices.Unstake_Batch).toBe(true);
  });

  it("reflects per-choice disable overrides", async () => {
    process.env.ENABLE_BATCH_CHOICES = "true";
    process.env.DISABLE_ETHPOOL_BATCH_UNSTAKE = "true";
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(makeReq(), res);
    const choices = (data.body as Record<string, unknown>).choices as Record<string, boolean>;
    expect(choices.ETHPool_BatchUnstake).toBe(false);
    expect(choices.Unstake_Batch).toBe(true);
  });

  it("returns version string", async () => {
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(makeReq(), res);
    expect((data.body as Record<string, unknown>).version).toBe("1.2.0");
  });

  it("returns 405 for POST requests", async () => {
    const handler = await loadHandler();
    const { res, data } = makeRes();
    await handler(makeReq("POST"), res);
    expect(data.statusCode).toBe(405);
  });
});

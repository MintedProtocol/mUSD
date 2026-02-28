/**
 * Tests for api-hardening/auth.ts
 *
 * Covers:
 *   1. guardMethod: 405 typed envelope
 *   2. guardBodyParty: alias resolution via canton-party-resolver
 *   3. guardBodyParty: invalid/missing party → 400 INVALID_INPUT
 *   4. guardBodyParty: extraFields propagation
 *   5. guardBodyParty: config errors → 500 CONFIG_ERROR
 *   6. guardBodyParty: malformed alias values → 500 CONFIG_ERROR
 */
export {};

function makeReq(method: string, body: Record<string, unknown> = {}) {
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

const TEST_PARTY = "testuser::1220" + "a".repeat(64);
const ALIASED_PARTY = "resolved::1220" + "b".repeat(64);

async function loadAuth() {
  vi.resetModules();
  return await import("../auth");
}

describe("guardMethod", () => {
  it("returns true for matching method", async () => {
    const { guardMethod } = await loadAuth();
    const { res } = makeRes();
    expect(guardMethod(makeReq("POST"), res, "POST")).toBe(true);
  });

  it("returns false and 405 with typed envelope for wrong method", async () => {
    const { guardMethod } = await loadAuth();
    const { res, data } = makeRes();
    expect(guardMethod(makeReq("GET"), res, "POST")).toBe(false);
    expect(data.statusCode).toBe(405);
    const body = data.body as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("Method not allowed");
    expect(body.errorType).toBe("METHOD_NOT_ALLOWED");
  });
});

describe("guardBodyParty", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns resolved party for valid input", async () => {
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: TEST_PARTY }), res);
    expect(result).toBe(TEST_PARTY);
    expect(data.statusCode).toBe(0);
  });

  it("resolves alias when CANTON_RECIPIENT_PARTY_ALIASES is set", async () => {
    process.env.CANTON_RECIPIENT_PARTY_ALIASES = JSON.stringify({
      [TEST_PARTY]: ALIASED_PARTY,
    });
    process.env.CANTON_PARTY = "operator::1220" + "c".repeat(64);
    const { guardBodyParty } = await loadAuth();
    const { res } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: TEST_PARTY }), res);
    expect(result).toBe(ALIASED_PARTY);
  });

  // ── input errors → 400 INVALID_INPUT ────────────────────────────────

  it("returns null and 400 INVALID_INPUT for missing party", async () => {
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", {}), res);
    expect(result).toBeNull();
    expect(data.statusCode).toBe(400);
    const body = data.body as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.errorType).toBe("INVALID_INPUT");
  });

  it("returns null and 400 INVALID_INPUT for empty string party", async () => {
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: "   " }), res);
    expect(result).toBeNull();
    expect(data.statusCode).toBe(400);
    const body = data.body as Record<string, unknown>;
    expect(body.errorType).toBe("INVALID_INPUT");
  });

  it("returns null and 400 INVALID_INPUT for invalid party format", async () => {
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: "not-a-valid-party" }), res);
    expect(result).toBeNull();
    expect(data.statusCode).toBe(400);
    const body = data.body as Record<string, unknown>;
    expect(body.errorType).toBe("INVALID_INPUT");
    expect(body.resolverErrorType).toBe("INVALID_PARTY");
  });

  // ── config errors → 500 CONFIG_ERROR ────────────────────────────────

  it("returns null and 500 CONFIG_ERROR for malformed alias JSON", async () => {
    process.env.CANTON_RECIPIENT_PARTY_ALIASES = "not valid json {{{";
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: TEST_PARTY }), res);
    expect(result).toBeNull();
    expect(data.statusCode).toBe(500);
    const body = data.body as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.errorType).toBe("CONFIG_ERROR");
    expect(body.resolverErrorType).toBe("MALFORMED_ALIAS_JSON");
  });

  it("returns null and 500 CONFIG_ERROR for alias policy violation", async () => {
    const operatorParty = "operator::1220" + "c".repeat(64);
    const nonOperatorKey = "attacker::1220" + "d".repeat(64);
    process.env.CANTON_PARTY = operatorParty;
    // Non-operator key maps to operator party — policy violation
    process.env.CANTON_RECIPIENT_PARTY_ALIASES = JSON.stringify({
      [nonOperatorKey]: operatorParty,
    });
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: TEST_PARTY }), res);
    expect(result).toBeNull();
    expect(data.statusCode).toBe(500);
    const body = data.body as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.errorType).toBe("CONFIG_ERROR");
    expect(body.resolverErrorType).toBe("ALIAS_POLICY_VIOLATION");
  });

  it("returns null and 500 CONFIG_ERROR for non-string alias values", async () => {
    process.env.CANTON_RECIPIENT_PARTY_ALIASES = JSON.stringify({
      [TEST_PARTY]: 12345,
    });
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: TEST_PARTY }), res);
    expect(result).toBeNull();
    expect(data.statusCode).toBe(500);
    const body = data.body as Record<string, unknown>;
    expect(body.errorType).toBe("CONFIG_ERROR");
    expect(body.resolverErrorType).toBe("MALFORMED_ALIAS_JSON");
  });

  it("returns null and 500 CONFIG_ERROR for null alias values", async () => {
    process.env.CANTON_RECIPIENT_PARTY_ALIASES = JSON.stringify({
      [TEST_PARTY]: null,
    });
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: TEST_PARTY }), res);
    expect(result).toBeNull();
    expect(data.statusCode).toBe(500);
    const body = data.body as Record<string, unknown>;
    expect(body.errorType).toBe("CONFIG_ERROR");
    expect(body.resolverErrorType).toBe("MALFORMED_ALIAS_JSON");
    expect((body.error as string)).toContain("non-empty string");
  });

  it("returns null and 500 CONFIG_ERROR for empty string alias values", async () => {
    process.env.CANTON_RECIPIENT_PARTY_ALIASES = JSON.stringify({
      [TEST_PARTY]: "   ",
    });
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    const result = guardBodyParty(makeReq("POST", { party: TEST_PARTY }), res);
    expect(result).toBeNull();
    expect(data.statusCode).toBe(500);
    const body = data.body as Record<string, unknown>;
    expect(body.errorType).toBe("CONFIG_ERROR");
    expect(body.resolverErrorType).toBe("MALFORMED_ALIAS_JSON");
  });

  // ── extraFields / custom field ──────────────────────────────────────

  it("propagates extraFields on error", async () => {
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    guardBodyParty(makeReq("POST", {}), res, {
      extraFields: { mode: "batch", pool: "ethpool" },
    });
    const body = data.body as Record<string, unknown>;
    expect(body.mode).toBe("batch");
    expect(body.pool).toBe("ethpool");
  });

  it("propagates extraFields on config error", async () => {
    process.env.CANTON_RECIPIENT_PARTY_ALIASES = "BAD JSON";
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    guardBodyParty(makeReq("POST", { party: TEST_PARTY }), res, {
      extraFields: { mode: "batch" },
    });
    const body = data.body as Record<string, unknown>;
    expect(data.statusCode).toBe(500);
    expect(body.mode).toBe("batch");
  });

  it("uses custom fieldName", async () => {
    const { guardBodyParty } = await loadAuth();
    const { res, data } = makeRes();
    guardBodyParty(makeReq("POST", { user: TEST_PARTY }), res, {
      fieldName: "user",
    });
    expect(data.statusCode).toBe(0);
  });
});

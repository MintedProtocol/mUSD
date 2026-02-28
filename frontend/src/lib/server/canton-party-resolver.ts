/**
 * Unified server-side Canton party resolution with alias support.
 *
 * Mirrors the canonical canton-party-resolver.ts from MintedCantonDev.
 * When branches merge, the frontend branch's version takes precedence.
 */
import { CANTON_PARTY_PATTERN } from "@/lib/api-hardening/env";

// ── types ──────────────────────────────────────────────────────────────

export type ResolverErrorType =
  | "ALIAS_POLICY_VIOLATION"
  | "MALFORMED_ALIAS_JSON"
  | "MISSING_PARTY"
  | "INVALID_PARTY";

export class ResolverError extends Error {
  readonly errorType: ResolverErrorType;
  constructor(errorType: ResolverErrorType, message: string) {
    super(message);
    this.name = "ResolverError";
    this.errorType = errorType;
  }
}

export interface ResolvedParty {
  requestedParty: string;
  resolvedParty: string;
  wasAliased: boolean;
  aliasSource: "env" | "none" | "fallback";
}

export interface ResolveOptions {
  allowFallback?: boolean;
}

// ── lazy alias cache ───────────────────────────────────────────────────

let _aliasCache: { map: Record<string, string>; error: ResolverError | null } | null = null;

function buildAndValidateAliases(): { map: Record<string, string>; error: ResolverError | null } {
  const raw = process.env.CANTON_RECIPIENT_PARTY_ALIASES;
  if (!raw || !raw.trim()) {
    return { map: {}, error: null };
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      map: {},
      error: new ResolverError("MALFORMED_ALIAS_JSON", "Cannot parse CANTON_RECIPIENT_PARTY_ALIASES"),
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      map: {},
      error: new ResolverError("MALFORMED_ALIAS_JSON", "CANTON_RECIPIENT_PARTY_ALIASES must be a JSON object"),
    };
  }

  // Validate every entry is a non-empty string key mapping to a non-empty string value.
  // Prevents raw TypeError in policy guard when values are numbers, null, or objects.
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== "string" || !key.trim()) {
      return {
        map: {},
        error: new ResolverError("MALFORMED_ALIAS_JSON", "Alias map contains empty key"),
      };
    }
    if (typeof value !== "string" || !value.trim()) {
      return {
        map: {},
        error: new ResolverError(
          "MALFORMED_ALIAS_JSON",
          `Alias map value for key "${key.slice(0, 40)}" must be a non-empty string`
        ),
      };
    }
  }

  const policyError = checkAliasPolicyGuard(parsed);
  if (policyError) {
    return { map: parsed, error: policyError };
  }

  return { map: parsed, error: null };
}

function checkAliasPolicyGuard(aliases: Record<string, string>): ResolverError | null {
  if (process.env.ALLOW_OPERATOR_ALIAS_OVERRIDE === "true") return null;

  const operatorParty = process.env.CANTON_PARTY;
  if (!operatorParty) return null;

  const operatorHint = operatorParty.split("::")[0];

  for (const [from, to] of Object.entries(aliases)) {
    const fromHint = from.split("::")[0];
    const isFromOperator = fromHint === operatorHint;
    const isToOperator = to === operatorParty || to.split("::")[0] === operatorHint;

    if (!isFromOperator && isToOperator) {
      return new ResolverError(
        "ALIAS_POLICY_VIOLATION",
        `Alias maps non-operator key "${fromHint}" to operator party`
      );
    }
  }

  return null;
}

function getValidatedAliasMap(): Record<string, string> {
  if (!_aliasCache) {
    _aliasCache = buildAndValidateAliases();
  }
  if (_aliasCache.error) throw _aliasCache.error;
  return _aliasCache.map;
}

/** Reset the alias cache (for testing only). */
export function _resetAliasCache(): void {
  _aliasCache = null;
}

// ── main resolver ──────────────────────────────────────────────────────

export function resolveRequestedParty(
  rawParty: string | string[] | undefined,
  opts?: ResolveOptions
): ResolvedParty {
  const aliasMap = getValidatedAliasMap();
  const candidate = Array.isArray(rawParty) ? rawParty[0] : rawParty;

  if (!candidate || !candidate.trim()) {
    if (opts?.allowFallback && process.env.CANTON_PARTY) {
      return {
        requestedParty: process.env.CANTON_PARTY,
        resolvedParty: process.env.CANTON_PARTY,
        wasAliased: false,
        aliasSource: "fallback",
      };
    }
    throw new ResolverError("MISSING_PARTY", "Missing Canton party");
  }

  const party = candidate.trim();
  if (party.length > 200 || !CANTON_PARTY_PATTERN.test(party)) {
    throw new ResolverError("INVALID_PARTY", "Invalid Canton party format");
  }

  const aliased = aliasMap[party];
  if (aliased) {
    return {
      requestedParty: party,
      resolvedParty: aliased,
      wasAliased: true,
      aliasSource: "env",
    };
  }

  return {
    requestedParty: party,
    resolvedParty: party,
    wasAliased: false,
    aliasSource: "none",
  };
}

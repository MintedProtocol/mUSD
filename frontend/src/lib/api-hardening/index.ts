/**
 * Barrel re-export for api-hardening utilities.
 *
 * NOTE: The canonical copies of env, auth, idempotency, fallback, and decimal
 * live on the frontend branch. This file exists on the backend branch solely
 * to satisfy import resolution for the batch API endpoints during isolated
 * branch development. When branches merge, the frontend branch's version
 * takes precedence (identical interface).
 */

export {
  getCantonBaseUrl,
  getCantonToken,
  getCantonParty,
  getCantonUser,
  getPackageId,
  getLendingPackageId,
  getBoostPoolPackageId,
  getV3PackageIds,
  validateConfig,
  CANTON_PARTY_PATTERN,
  PKG_ID_PATTERN,
} from "./env";

export type { ConfigError } from "./env";

export {
  guardMethod,
  guardBodyParty,
} from "./auth";

export {
  IdempotencyStore,
  deriveIdempotencyKey,
} from "./idempotency";

export type { IdempotencyStoreOptions } from "./idempotency";

export {
  parseAmount,
  gte,
  gt,
  toDamlDecimal,
  toDisplay,
  EPSILON,
} from "./decimal";

export {
  classifyFallback,
  isFallbackAllowed,
} from "./fallback";

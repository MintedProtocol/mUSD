/**
 * Environment configuration getters and validators.
 *
 * Mirrors the production api-hardening/env.ts from MintedCantonDev.
 * When branches merge, the frontend branch copy takes precedence.
 */

export const CANTON_PARTY_PATTERN = /^[A-Za-z0-9._:-]+::1220[0-9a-f]{64}$/i;
export const PKG_ID_PATTERN = /^[0-9a-f]{64}$/i;

export interface ConfigError {
  error: string;
  errorType: "CONFIG_ERROR";
}

export function getCantonBaseUrl(): string {
  return (
    process.env.CANTON_API_URL ||
    `http://${process.env.CANTON_HOST || "localhost"}:${process.env.CANTON_PORT || "7575"}`
  );
}

export function getCantonToken(): string {
  return process.env.CANTON_TOKEN || "";
}

export function getCantonParty(): string {
  return process.env.CANTON_PARTY || "";
}

export function getCantonUser(): string {
  return process.env.CANTON_USER || "canton-user";
}

export function getPackageId(): string {
  return process.env.NEXT_PUBLIC_DAML_PACKAGE_ID || process.env.CANTON_PACKAGE_ID || "";
}

export function getLendingPackageId(): string {
  return process.env.CANTON_LENDING_PACKAGE_ID || getPackageId();
}

export function getBoostPoolPackageId(): string {
  return process.env.CANTON_BOOST_POOL_PACKAGE_ID || getPackageId();
}

export function getV3PackageIds(): string[] {
  return Array.from(
    new Set(
      [getPackageId(), process.env.CANTON_PACKAGE_ID].filter(
        (id): id is string => typeof id === "string" && id.length === 64
      )
    )
  );
}

export function validateConfig(opts?: { requireLending?: boolean }): ConfigError | null {
  const party = getCantonParty();
  if (!party || !CANTON_PARTY_PATTERN.test(party)) {
    return { error: "CANTON_PARTY not configured or invalid", errorType: "CONFIG_ERROR" };
  }
  const pkgId = getPackageId();
  if (!pkgId || !PKG_ID_PATTERN.test(pkgId)) {
    return { error: "CANTON_PACKAGE_ID not configured or invalid", errorType: "CONFIG_ERROR" };
  }
  if (opts?.requireLending) {
    const lendingId = getLendingPackageId();
    if (!lendingId || !PKG_ID_PATTERN.test(lendingId)) {
      return { error: "CANTON_LENDING_PACKAGE_ID not configured or invalid", errorType: "CONFIG_ERROR" };
    }
  }
  return null;
}

export function validatePartyInput(raw: string): void {
  if (!raw || !CANTON_PARTY_PATTERN.test(raw)) {
    throw new Error("Invalid Canton party format");
  }
}

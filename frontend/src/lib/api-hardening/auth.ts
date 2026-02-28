/**
 * HTTP request guards for API endpoints.
 *
 * Mirrors the production api-hardening/auth.ts from MintedCantonDev.
 * Uses server-side party resolver for alias resolution parity.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  resolveRequestedParty,
  ResolverError,
} from "@/lib/server/canton-party-resolver";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export function guardMethod(
  req: NextApiRequest,
  res: NextApiResponse,
  expected: HttpMethod
): boolean {
  if (req.method === expected) return true;
  res.status(405).json({
    success: false,
    error: "Method not allowed",
    errorType: "METHOD_NOT_ALLOWED",
  });
  return false;
}

export function guardBodyParty(
  req: NextApiRequest,
  res: NextApiResponse,
  opts?: { fieldName?: string; extraFields?: Record<string, unknown> }
): string | null {
  const fieldName = opts?.fieldName ?? "party";
  const body = req.body || {};
  const raw = body[fieldName];

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    res.status(400).json({
      success: false,
      error: `Missing ${fieldName}`,
      errorType: "INVALID_INPUT",
      ...(opts?.extraFields || {}),
    });
    return null;
  }

  try {
    const resolved = resolveRequestedParty(raw);
    return resolved.resolvedParty;
  } catch (err: unknown) {
    if (err instanceof ResolverError) {
      const isConfigError =
        err.errorType === "ALIAS_POLICY_VIOLATION" ||
        err.errorType === "MALFORMED_ALIAS_JSON";
      const status = isConfigError ? 500 : 400;
      const errorType = isConfigError ? "CONFIG_ERROR" : "INVALID_INPUT";
      res.status(status).json({
        success: false,
        error: err.message,
        errorType,
        resolverErrorType: err.errorType,
        ...(opts?.extraFields || {}),
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Invalid Canton ${fieldName} format`,
        errorType: "INVALID_INPUT",
        ...(opts?.extraFields || {}),
      });
    }
    return null;
  }
}

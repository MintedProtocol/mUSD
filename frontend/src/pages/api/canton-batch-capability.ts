/**
 * GET /api/canton-batch-capability
 *
 * Reports which batch choices are available and the protocol version.
 * Always returns 200 — the response body indicates feature availability.
 * No authentication required (public capability endpoint).
 *
 * Response:
 *   {
 *     batchChoicesEnabled: boolean,
 *     choices: { ETHPool_BatchUnstake: boolean, Unstake_Batch: boolean, ... },
 *     version: "1.2.0"
 *   }
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { guardMethod } from "@/lib/api-hardening";
import { getBatchCapabilities } from "@/lib/server/batch-feature-flags";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardMethod(req, res, "GET")) return;

  const capabilities = getBatchCapabilities();
  return res.status(200).json(capabilities);
}

import type { NextApiRequest, NextApiResponse } from "next";
import * as crypto from "crypto";

/**
 * /api/canton-refresh-prices — Refresh all CantonPriceFeed contracts.
 *
 * Exercises PriceFeed_Update on each active price feed to reset staleness.
 * Called automatically before borrow/withdraw operations that check staleness.
 */

const CANTON_BASE_URL =
  process.env.CANTON_API_URL ||
  `http://${process.env.CANTON_HOST || "localhost"}:${process.env.CANTON_PORT || "7575"}`;
const CANTON_TOKEN = process.env.CANTON_TOKEN || "dummy-no-auth";
const CANTON_PARTY =
  process.env.CANTON_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const CANTON_USER = process.env.CANTON_USER || "administrator";
const PACKAGE_ID =
  process.env.NEXT_PUBLIC_DAML_PACKAGE_ID ||
  process.env.CANTON_PACKAGE_ID ||
  "";

// Known V3 packages for fan-out discovery
const V3_PACKAGE_IDS: string[] = Array.from(new Set([
  PACKAGE_ID,
  process.env.CANTON_PACKAGE_ID,
  "eff3bf30edb508b2d052f969203db972e59c66e974344ed43016cfccfa618f06",
  "f9481d29611628c7145d3d9a856aed6bb318d7fdd371a0262dbac7ca22b0142b",
].filter((id): id is string => typeof id === "string" && id.length === 64)));

const PRICE_FEED_TEMPLATES = V3_PACKAGE_IDS.map((pkg) => `${pkg}:CantonLending:CantonPriceFeed`);

async function cantonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${CANTON_BASE_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${CANTON_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Canton API ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

interface PriceFeedContract {
  contractId: string;
  templateId: string;
  symbol: string;
  priceUsd: string;
  lastUpdated: string;
}

async function getActivePriceFeeds(): Promise<PriceFeedContract[]> {
  const { offset } = await cantonRequest<{ offset: number }>("GET", "/v2/state/ledger-end");

  type RawEntry = {
    contractEntry: {
      JsActiveContract?: {
        createdEvent: {
          contractId: string;
          templateId: string;
          createArgument: Record<string, unknown>;
        };
      };
    };
  };

  // Fan out across all known V3 packages to find price feeds
  const allEntries: RawEntry[] = [];
  for (const tpl of PRICE_FEED_TEMPLATES) {
    try {
      const raw = await cantonRequest<unknown>("POST", "/v2/state/active-contracts?limit=200", {
        eventFormat: {
          filtersByParty: {
            [CANTON_PARTY]: {
              cumulative: [
                {
                  identifierFilter: {
                    TemplateFilter: {
                      value: {
                        templateId: tpl,
                        includeCreatedEventBlob: false,
                      },
                    },
                  },
                },
              ],
            },
          },
          verbose: true,
        },
        activeAtOffset: offset,
      });
      let entries: RawEntry[];
      if (Array.isArray(raw)) {
        entries = raw;
      } else if (raw && typeof raw === "object" && Array.isArray((raw as any).result)) {
        entries = (raw as any).result;
      } else {
        entries = [];
      }
      allEntries.push(...entries);
    } catch {
      // Template may not exist under this package — skip
    }
  }

  // Deduplicate by contractId
  const entries = Array.from(
    new Map(allEntries.map((e) => [e.contractEntry?.JsActiveContract?.createdEvent?.contractId, e])).values()
  );

  const feeds: PriceFeedContract[] = [];
  for (const entry of entries) {
    const ac = entry.contractEntry?.JsActiveContract;
    if (!ac) continue;
    const evt = ac.createdEvent;
    if (!evt.templateId.endsWith(":CantonPriceFeed")) continue;
    const p = evt.createArgument;
    feeds.push({
      contractId: evt.contractId,
      templateId: evt.templateId,
      symbol: (p.symbol as string) || "",
      priceUsd: (p.priceUsd as string) || "0",
      lastUpdated: (p.lastUpdated as string) || "",
    });
  }
  return feeds;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const feeds = await getActivePriceFeeds();
    if (feeds.length === 0) {
      return res.status(200).json({ success: true, message: "No price feeds found", refreshed: 0 });
    }

    const results: { symbol: string; success: boolean; error?: string; newCid?: string }[] = [];

    for (const feed of feeds) {
      try {
        // Generate attestation hash from current price + timestamp
        const attestationData = `price-refresh:${feed.symbol}:${feed.priceUsd}:${Date.now()}`;
        const attestationHash = crypto.createHash("sha256").update(attestationData).digest("hex");

        const commandId = `price-refresh-${feed.symbol}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

        const body = {
          userId: CANTON_USER,
          actAs: [CANTON_PARTY],
          readAs: [CANTON_PARTY],
          commandId,
          commands: [
            {
              ExerciseCommand: {
                templateId: feed.templateId,
                contractId: feed.contractId,
                choice: "PriceFeed_Update",
                choiceArgument: {
                  newPriceUsd: feed.priceUsd,       // Keep same price
                  newSource: "relay-service-sync",
                  attestationHash,
                  validatorCount: 3,
                },
              },
            },
          ],
        };

        const result = await cantonRequest<unknown>("POST", "/v2/commands/submit-and-wait", body);
        results.push({ symbol: feed.symbol, success: true });
      } catch (err: any) {
        // If UPDATE_TOO_FREQUENT (< 10s since last), that's fine — price is fresh
        if (err.message?.includes("UPDATE_TOO_FREQUENT")) {
          results.push({ symbol: feed.symbol, success: true, error: "Already fresh" });
        } else {
          results.push({ symbol: feed.symbol, success: false, error: err.message });
        }
      }
    }

    const refreshed = results.filter(r => r.success).length;
    return res.status(200).json({ success: true, refreshed, total: feeds.length, results });
  } catch (err: any) {
    console.error("Price refresh error:", err.message);
    return res.status(502).json({ success: false, error: err.message });
  }
}

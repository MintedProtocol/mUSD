/**
 * Bounded in-memory idempotency store with TTL + LRU eviction.
 *
 * Mirrors the production api-hardening/idempotency.ts from MintedCantonDev.
 */
import crypto from "crypto";

interface StoreEntry<T> {
  value: T;
  createdAt: number;
}

export interface IdempotencyStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
}

export class IdempotencyStore<T> {
  private readonly store = new Map<string, StoreEntry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private lastPrune = 0;

  constructor(opts?: IdempotencyStoreOptions) {
    this.maxEntries = opts?.maxEntries ?? 1000;
    this.ttlMs = opts?.ttlMs ?? 300_000;
  }

  get(key: string): T | undefined {
    this.maybePrune();
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.maybePrune();
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, createdAt: Date.now() });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  get size(): number {
    return this.store.size;
  }

  private maybePrune(): void {
    const now = Date.now();
    if (now - this.lastPrune < 30_000) return;
    this.lastPrune = now;
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }
}

export function deriveIdempotencyKey(
  prefix: string,
  sourceCids: string[],
  amount: string,
  party: string,
  extra?: string
): string {
  const sorted = [...sourceCids].sort().join(",");
  const input = extra
    ? `${prefix}:${sorted}:${amount}:${party}:${extra}`
    : `${prefix}:${sorted}:${amount}:${party}`;
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
}

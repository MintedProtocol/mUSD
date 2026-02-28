/**
 * useVaultAPY — Live on-chain APY calculation for MetaVaults.
 *
 * Computes APY from totalValue() snapshots taken over time.
 * Falls back to the keeper's /apy endpoint if available.
 *
 * Usage:
 *   const { vaultAPYs, treasuryAPY, loading } = useVaultAPY();
 *   // vaultAPYs: Record<"vault1" | "vault2" | "vault3", number | null>
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useWCContracts } from "./useWCContracts";

const USDC_DECIMALS = 6;
const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LOCAL_STORAGE_KEY = "minted_vault_snapshots";

type VaultKey = "vault1" | "vault2" | "vault3";

interface Snapshot {
  totalValue: string; // bigint serialized
  timestamp: number;  // unix seconds
}

interface SnapshotStore {
  treasury: Snapshot[];
  vault1: Snapshot[];
  vault2: Snapshot[];
  vault3: Snapshot[];
}

export interface VaultAPYResult {
  /** APY per vault (null = insufficient data) */
  vaultAPYs: Record<VaultKey, number | null>;
  /** Treasury aggregate APY */
  treasuryAPY: number | null;
  /** Current total value per vault in USDC */
  vaultTotalValues: Record<VaultKey, string>;
  /** Pending yield info from Treasury */
  pendingYield: { net: string; gross: string; fee: string } | null;
  /** Loading state */
  loading: boolean;
}

function loadSnapshots(): SnapshotStore {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SnapshotStore;
      // Prune snapshots older than 30 days
      const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      for (const key of Object.keys(parsed) as (keyof SnapshotStore)[]) {
        parsed[key] = (parsed[key] || []).filter((s) => s.timestamp > cutoff);
      }
      return parsed;
    }
  } catch {
    /* corrupt data — start fresh */
  }
  return { treasury: [], vault1: [], vault2: [], vault3: [] };
}

function saveSnapshots(store: SnapshotStore): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* localStorage full or disabled */
  }
}

function computeAPY(
  earlierValue: bigint,
  laterValue: bigint,
  elapsedSeconds: number
): number | null {
  if (earlierValue === 0n || elapsedSeconds < 3600) return null;
  if (laterValue <= earlierValue) return 0;

  const yieldRatio = Number(laterValue - earlierValue) / Number(earlierValue);
  const annualized = Math.pow(1 + yieldRatio, SECONDS_PER_YEAR / elapsedSeconds) - 1;

  // Sanity: >500% is likely data error
  return annualized > 5 ? null : annualized * 100;
}

function findSnapshotAtAge(
  snaps: Snapshot[],
  ageSeconds: number
): Snapshot | null {
  if (snaps.length < 2) return null;
  const target = snaps[snaps.length - 1].timestamp - ageSeconds;
  let closest: Snapshot | null = null;
  let closestDiff = Infinity;
  for (const s of snaps) {
    const diff = Math.abs(s.timestamp - target);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = s;
    }
  }
  // Accept if within 20% of target window
  if (closest && closestDiff < ageSeconds * 0.2) return closest;
  return null;
}

export function useVaultAPY(): VaultAPYResult {
  const contracts = useWCContracts();
  const [result, setResult] = useState<VaultAPYResult>({
    vaultAPYs: { vault1: null, vault2: null, vault3: null },
    treasuryAPY: null,
    vaultTotalValues: { vault1: "0", vault2: "0", vault3: "0" },
    pendingYield: null,
    loading: true,
  });
  const storeRef = useRef<SnapshotStore | null>(null);

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => {
    storeRef.current = loadSnapshots();
  }, []);

  const refresh = useCallback(async () => {
    const contractsAny = contracts as any;
    const vaultContracts: [VaultKey, any][] = [
      ["vault1", contractsAny.metaVault1 ?? contractsAny.metaVault ?? null],
      ["vault2", contractsAny.metaVault2 ?? null],
      ["vault3", contractsAny.metaVault3 ?? null],
    ];
    const now = Math.floor(Date.now() / 1000);
    const store = storeRef.current;
    if (!store) return; // not yet hydrated from localStorage

    // Take snapshots
    for (const [key, contract] of vaultContracts) {
      if (!contract) continue;
      try {
        const tv: bigint = await contract.totalValue();
        const last = store[key][store[key].length - 1];
        // Only snapshot if > 1 min since last (avoid duplicates on rapid refresh)
        if (!last || now - last.timestamp > 60) {
          store[key].push({ totalValue: tv.toString(), timestamp: now });
        }
      } catch {
        /* vault not deployed yet */
      }
    }

    // Treasury snapshot
    if (contracts.treasury) {
      try {
        const tv: bigint = await contracts.treasury.totalValue();
        const last = store.treasury[store.treasury.length - 1];
        if (!last || now - last.timestamp > 60) {
          store.treasury.push({ totalValue: tv.toString(), timestamp: now });
        }
      } catch {
        /* treasury not deployed */
      }
    }

    // Persist
    saveSnapshots(store);

    // Compute APYs (use 7-day window, fallback to whatever we have)
    const vaultAPYs: Record<VaultKey, number | null> = { vault1: null, vault2: null, vault3: null };
    const vaultTotalValues: Record<VaultKey, string> = { vault1: "0", vault2: "0", vault3: "0" };

    for (const key of ["vault1", "vault2", "vault3"] as VaultKey[]) {
      const snaps = store[key];
      if (snaps.length >= 2) {
        const latest = snaps[snaps.length - 1];
        vaultTotalValues[key] = latest.totalValue;

        // Try 7-day, then fallback to oldest available
        const refSnap =
          findSnapshotAtAge(snaps, 7 * 24 * 3600) || snaps[0];
        const elapsed = latest.timestamp - refSnap.timestamp;
        vaultAPYs[key] = computeAPY(
          BigInt(refSnap.totalValue),
          BigInt(latest.totalValue),
          elapsed
        );
      }
    }

    // Treasury APY
    let treasuryAPY: number | null = null;
    const tSnaps = store.treasury;
    if (tSnaps.length >= 2) {
      const latest = tSnaps[tSnaps.length - 1];
      const refSnap = findSnapshotAtAge(tSnaps, 7 * 24 * 3600) || tSnaps[0];
      const elapsed = latest.timestamp - refSnap.timestamp;
      treasuryAPY = computeAPY(
        BigInt(refSnap.totalValue),
        BigInt(latest.totalValue),
        elapsed
      );
    }

    // Pending yield
    let pendingYield: VaultAPYResult["pendingYield"] = null;
    if (contracts.treasury) {
      try {
        const [net, gross, fee] = await contracts.treasury.pendingYield();
        pendingYield = {
          net: (Number(net) / 1e6).toFixed(2),
          gross: (Number(gross) / 1e6).toFixed(2),
          fee: (Number(fee) / 1e6).toFixed(2),
        };
      } catch {
        /* pendingYield not available on old deployment */
      }
    }

    setResult({
      vaultAPYs,
      treasuryAPY,
      vaultTotalValues,
      pendingYield,
      loading: false,
    });
  }, [contracts]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return result;
}

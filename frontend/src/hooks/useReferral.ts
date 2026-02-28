import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { useUnifiedWallet } from "./useUnifiedWallet";
import { CONTRACTS } from "@/lib/config";

// ═══════════════════════════════════════════════════════════
// ABI (subset of ReferralRegistry)
// ═══════════════════════════════════════════════════════════

const REFERRAL_ABI = [
  "function registerCode(string code) external",
  "function linkReferral(string code) external",
  "function getDashboard(address referrer) view returns (uint32 numReferees, uint256 referredTvl, uint256 multiplier, uint256 kickbackPts, address[] referees)",
  "function getMultiplier(address referrer) view returns (uint256)",
  "function isReferred(address user) view returns (bool)",
  "function referrals(address) view returns (address referrer, uint64 linkedAt, bool active)",
  "function getCodeCount(address owner) view returns (uint256)",
  "function getCodeHashes(address owner) view returns (bytes32[])",
  "function getReferralChain(address user, uint8 depth) view returns (address[])",
  "function totalReferrers() view returns (uint256)",
  "function totalLinks() view returns (uint256)",
  "function getTiers() view returns (tuple(uint256 minTvl, uint256 multiplier)[])",
  "event CodeCreated(address indexed owner, bytes32 indexed codeHash, string code)",
  "event ReferralLinked(address indexed referee, address indexed referrer, bytes32 indexed codeHash)",
];

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ReferralDashboard {
  numReferees: number;
  referredTvl: string;       // formatted USD
  referredTvlRaw: bigint;
  multiplier: string;        // e.g. "2.5x"
  multiplierRaw: bigint;
  kickbackPts: string;       // formatted
  kickbackPtsRaw: bigint;
  referees: string[];        // addresses
}

export interface MultiplierTier {
  minTvl: bigint;
  multiplier: bigint;
  label: string;             // e.g. "$100K"
  multiplierLabel: string;   // e.g. "2.0x"
}

export interface ReferralState {
  // Connection
  isLoading: boolean;
  error: string | null;

  // User state
  isReferred: boolean;
  referrer: string | null;
  myCodes: string[];
  dashboard: ReferralDashboard | null;

  // Global
  totalReferrers: number;
  totalLinks: number;
  tiers: MultiplierTier[];

  // Actions
  generateCode: () => Promise<string | null>;
  applyCode: (code: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function generateCodeString(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "MNTD-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function formatTvl(raw: bigint): string {
  const n = Number(ethers.formatUnits(raw, 18));
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatMultiplier(raw: bigint): string {
  const n = Number(ethers.formatUnits(raw, 18));
  return `${n.toFixed(1)}x`;
}

// ═══════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════

export function useReferral(): ReferralState {
  const { address, isConnected, getContract, writeContract, provider } = useUnifiedWallet();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUserReferred, setIsUserReferred] = useState(false);
  const [referrer, setReferrer] = useState<string | null>(null);
  const [myCodes, setMyCodes] = useState<string[]>([]);
  const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null);
  const [totalReferrers, setTotalReferrers] = useState(0);
  const [totalLinks, setTotalLinks] = useState(0);
  const [tiers, setTiers] = useState<MultiplierTier[]>([]);

  const contractAddr = CONTRACTS.ReferralRegistry;

  // ─── Fetch state ──────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!isConnected || !address || !contractAddr) return;

    setIsLoading(true);
    setError(null);

    try {
      const contract = getContract(contractAddr, REFERRAL_ABI);
      if (!contract) return;

      // Parallel reads
      const [referred, refInfo, dashData, codeCount, globalReferrers, globalLinks, tierData] =
        await Promise.all([
          contract.isReferred(address),
          contract.referrals(address),
          contract.getDashboard(address),
          contract.getCodeCount(address),
          contract.totalReferrers(),
          contract.totalLinks(),
          contract.getTiers(),
        ]);

      setIsUserReferred(referred);
      setReferrer(refInfo.active ? refInfo.referrer : null);
      setTotalReferrers(Number(globalReferrers));
      setTotalLinks(Number(globalLinks));

      // Dashboard
      setDashboard({
        numReferees: Number(dashData.numReferees),
        referredTvl: formatTvl(dashData.referredTvl),
        referredTvlRaw: dashData.referredTvl,
        multiplier: formatMultiplier(dashData.multiplier),
        multiplierRaw: dashData.multiplier,
        kickbackPts: Number(ethers.formatUnits(dashData.kickbackPts, 0)).toLocaleString(),
        kickbackPtsRaw: dashData.kickbackPts,
        referees: dashData.referees,
      });

      // Tiers
      const parsedTiers: MultiplierTier[] = tierData.map((t: { minTvl: bigint; multiplier: bigint }) => ({
        minTvl: t.minTvl,
        multiplier: t.multiplier,
        label: formatTvl(t.minTvl),
        multiplierLabel: formatMultiplier(t.multiplier),
      }));
      setTiers(parsedTiers);

      // Fetch code strings from events (codes are stored as hashes on-chain)
      if (provider && Number(codeCount) > 0) {
        try {
          const filter = contract.filters.CodeCreated(address);
          const events = await contract.queryFilter(filter, -100000);
          const codes = events
            .filter((e): e is ethers.EventLog => "args" in e)
            .map((e) => e.args?.[2] as string)
            .filter(Boolean);
          setMyCodes(codes);
        } catch {
          // Event querying may fail on some providers, use empty
          setMyCodes([]);
        }
      } else {
        setMyCodes([]);
      }
    } catch (err: unknown) {
      console.error("[Referral] Failed to load:", err);
      setError("Failed to load referral data");
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, contractAddr, getContract, provider]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ─── Actions ──────────────────────────────────────────────

  const generateCode = useCallback(async (): Promise<string | null> => {
    if (!contractAddr || !address) return null;
    setError(null);

    try {
      const code = generateCodeString();
      const tx = await writeContract(contractAddr, REFERRAL_ABI, "registerCode", [code]);
      await tx.wait();
      setMyCodes((prev) => [...prev, code]);
      return code;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate code";
      if (msg.includes("MaxCodesReached")) {
        setError("Maximum referral codes reached (5)");
      } else if (msg.includes("CodeAlreadyExists")) {
        setError("Code collision — try again");
      } else {
        setError(msg);
      }
      return null;
    }
  }, [contractAddr, address, writeContract]);

  const applyCode = useCallback(async (code: string): Promise<boolean> => {
    if (!contractAddr || !address) return false;
    setError(null);

    try {
      const tx = await writeContract(contractAddr, REFERRAL_ABI, "linkReferral", [code]);
      await tx.wait();
      setIsUserReferred(true);
      await refresh();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to apply code";
      if (msg.includes("InvalidCode")) {
        setError("Invalid referral code");
      } else if (msg.includes("SelfReferral")) {
        setError("You can't refer yourself");
      } else if (msg.includes("AlreadyReferred")) {
        setError("You've already been referred");
      } else if (msg.includes("CircularReferral")) {
        setError("This would create a circular referral chain");
      } else {
        setError(msg);
      }
      return false;
    }
  }, [contractAddr, address, writeContract, refresh]);

  return {
    isLoading,
    error,
    isReferred: isUserReferred,
    referrer,
    myCodes,
    dashboard,
    totalReferrers,
    totalLinks,
    tiers,
    generateCode,
    applyCode,
    refresh,
  };
}

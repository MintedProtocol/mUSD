import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { TxButton } from "@/components/TxButton";
import { StatCard } from "@/components/StatCard";
import { useTx } from "@/hooks/useTx";
import { formatUSD, formatBps, formatToken } from "@/lib/format";
import { CONTRACTS, USDC_DECIMALS, MUSD_DECIMALS } from "@/lib/config";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import WalletConnector from "@/components/WalletConnector";
import { useVaultAPY } from "@/hooks/useVaultAPY";
import { cantonCreate, useCantonLedger } from "@/hooks/useCantonLedger";
import { useLoopWallet } from "@/hooks/useLoopWallet";

type AdminSection = "emergency" | "musd" | "directmint" | "treasury" | "vaults" | "bridge" | "borrow" | "oracle" | "faucet";

const CANTON_PACKAGE_ID = process.env.NEXT_PUBLIC_DAML_PACKAGE_ID || "";
const CANTON_OPERATOR_PARTY =
  process.env.NEXT_PUBLIC_CANTON_OPERATOR_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const CIP56_FAUCET_AGREEMENT_HASH = process.env.NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_HASH || "";
const CIP56_FAUCET_AGREEMENT_URI = process.env.NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_URI || "";
const CIP56_CONFIGURED = Boolean(
  (process.env.NEXT_PUBLIC_CIP56_PACKAGE_ID || "") &&
  CIP56_FAUCET_AGREEMENT_HASH &&
  CIP56_FAUCET_AGREEMENT_URI
);

const CANTON_FAUCET_TEMPLATES = {
  CantonUSDC: `${CANTON_PACKAGE_ID}:CantonDirectMint:CantonUSDC`,
  USDCx: `${CANTON_PACKAGE_ID}:CantonDirectMint:USDCx`,
  CantonCoin: `${CANTON_PACKAGE_ID}:CantonCoinToken:CantonCoin`,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY CATALOG — all deployable yield strategies
// Addresses are populated from env vars; empty string = not yet deployed
// ═══════════════════════════════════════════════════════════════════════════
// TreasuryV2 registers MetaVault instances as allocation slots.
// Each vault aggregates sub-strategies internally via weighted allocation.
// Routing:
//   - DirectMint / smUSD deposits → TreasuryV2 → Vaults 1 & 2 (USDC strategies)
//   - ETH Pool deposits (ETH/USDC/USDT) → TreasuryV2 → Vault 3 only (ETH strategies)
type VaultAssignment = "vault1" | "vault2" | "vault3";

interface StrategyInfo {
  name: string;
  shortName: string;
  address: string;
  targetBps: number;
  apy: string;
  description: string;
  color: string;
  vault: VaultAssignment;
}

interface SubStrategyView {
  strategy: string;
  weightBps: number;
  capUsd: bigint;
  enabled: boolean;
  currentValue: bigint;
}

interface VaultViewData {
  key: VaultAssignment;
  contract: any;
  totalValue: bigint;
  totalPrincipal: bigint;
  idle: bigint;
  drift: number;
  driftThreshold: number;
  paused: boolean;
  active: boolean;
  subStrategies: SubStrategyView[];
}

const VAULT_CONTRACTS_MAP: { key: VaultAssignment; envKey: string }[] = [
  { key: "vault1", envKey: "metaVault1" },
  { key: "vault2", envKey: "metaVault2" },
  { key: "vault3", envKey: "metaVault3" },
];

const VAULT_LABELS: Record<VaultAssignment, { label: string; badge: string; desc: string }> = {
  vault1: {
    label: "Vault #1 — Diversified Yield",
    badge: "bg-emerald-800/60 text-emerald-300",
    desc: "Blue-chip lending loops + PT yield (Euler xStable, Euler V2, Pendle 3-PT)",
  },
  vault2: {
    label: "Vault #2 — Fluid Syrup",
    badge: "bg-pink-800/60 text-pink-300",
    desc: "Leveraged syrupUSDC loops across borrow tokens (GHO, USDT, USDC)",
  },
  vault3: {
    label: "Vault #3 — ETH Pool",
    badge: "bg-blue-800/60 text-blue-300",
    desc: "ETH Pool deposits (ETH/USDC/USDT) are routed exclusively here — Fluid T2 #74 LRT + T4 #44 LST. Exit: mUSD (30/60/90 day lock)",
  },
};

const KNOWN_STRATEGIES: StrategyInfo[] = [
  // ── Vault #1 — Diversified Yield (45% of treasury) ─────────
  {
    name: "Euler V2 RLUSD/USDC Cross-Stable",
    shortName: "Euler xStable",
    address: process.env.NEXT_PUBLIC_EULER_CROSS_STRATEGY_ADDRESS || "",
    targetBps: 5000,
    apy: "~15.7%",
    description: "Cross-stable leverage with depeg circuit breaker (RLUSD/USDC)",
    color: "#10b981", // emerald
    vault: "vault1",
  },
  {
    name: "Euler V2 Loop USDC/USDC",
    shortName: "Euler V2",
    address: process.env.NEXT_PUBLIC_EULER_STRATEGY_ADDRESS || "",
    targetBps: 3000,
    apy: "~18%",
    description: "Leveraged lending loop on Euler V2 (same-asset USDC, incentivized)",
    color: "#14b8a6", // teal
    vault: "vault1",
  },
  {
    name: "Pendle 3-PT Markets",
    shortName: "Pendle",
    address: process.env.NEXT_PUBLIC_PENDLE_STRATEGY_ADDRESS || "",
    targetBps: 2000,
    apy: "~10.7%",
    description: "PT markets with auto-rollover — top pools only",
    color: "#8b5cf6", // violet
    vault: "vault1",
  },
  // ── Vault #2 — Fluid Syrup (45% of treasury) ──────────────
  {
    name: "Fluid #148 syrupUSDC/GHO",
    shortName: "Fluid #148",
    address: process.env.NEXT_PUBLIC_FLUID_GHO_STRATEGY_ADDRESS || "",
    targetBps: 5000,
    apy: "~18.77%",
    description: "syrupUSDC/GHO VaultT1 — cross-borrow loop via Fluid Protocol",
    color: "#06b6d4", // cyan
    vault: "vault2",
  },
  {
    name: "Fluid #147 syrupUSDC/USDT",
    shortName: "Fluid #147",
    address: process.env.NEXT_PUBLIC_FLUID_USDT_STRATEGY_ADDRESS || "",
    targetBps: 3000,
    apy: "~16.61%",
    description: "syrupUSDC/USDT VaultT1 — cross-borrow loop via Fluid Protocol",
    color: "#0891b2", // cyan-600
    vault: "vault2",
  },
  {
    name: "Fluid #146 syrupUSDC/USDC",
    shortName: "Fluid #146",
    address: process.env.NEXT_PUBLIC_FLUID_STRATEGY_ADDRESS || "",
    targetBps: 2000,
    apy: "~11.66%",
    description: "syrupUSDC/USDC VaultT1 — same-asset stable loop via Fluid Protocol",
    color: "#22d3ee", // cyan-400
    vault: "vault2",
  },
  // ── Vault #3 — ETH Pool (10% of treasury) ─────────────────
  // All ETH Pool deposits (ETH/USDC/USDT) are routed exclusively here.
  // DirectMint / smUSD deposits do NOT flow into Vault 3.
  {
    name: "Fluid #74 weETH-ETH/wstETH (Mode 2 LRT)",
    shortName: "Fluid #74",
    address: process.env.NEXT_PUBLIC_FLUID_ETH_STRATEGY_ADDRESS || "",
    targetBps: 6000,
    apy: "~12-18%",
    description: "Mode 2 — LRT Smart Collateral + Smart Debt, Fluid T2 Vault #74 (92% LTV, 4 loops)",
    color: "#3b82f6", // blue-500
    vault: "vault3",
  },
  {
    name: "Fluid #44 wstETH-ETH/wstETH-ETH (Mode 3 LST)",
    shortName: "Fluid #44",
    address: process.env.NEXT_PUBLIC_FLUID_LST_STRATEGY_ADDRESS || "",
    targetBps: 4000,
    apy: "~14-20%",
    description: "Mode 3 — LST Smart Collateral + Smart Debt, Fluid T4 Vault #44 (94% LTV, 5 loops, ~16.7x leverage)",
    color: "#2563eb", // blue-600
    vault: "vault3",
  },
];

/** Look up a human-readable name for a strategy address */
function strategyName(addr: string): string {
  const found = KNOWN_STRATEGIES.find(
    (s) => s.address && s.address.toLowerCase() === addr.toLowerCase()
  );
  return found ? found.shortName : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function strategyColor(addr: string): string {
  const found = KNOWN_STRATEGIES.find(
    (s) => s.address && s.address.toLowerCase() === addr.toLowerCase()
  );
  return found?.color || "#6b7280";
}

/** Map shortName → optimizer engine key for the AI yield optimizer */
/** H-01: Validate Ethereum address */
function isAddr(v: string): boolean {
  try { return ethers.isAddress(v); } catch { return false; }
}

/** H-02: Validate basis points in range [0, 10000] */
function isValidBps(v: string): boolean {
  if (!v) return false;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 10000;
}

export function AdminPage() {
  const { address, isConnected, signer } = useUnifiedWallet();
  const loopWallet = useLoopWallet();
  const activeParty = loopWallet.partyId || null;
  const contracts = useWCContracts();
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();
  const [section, setSection] = useState<AdminSection>("treasury");
  const tx = useTx();
  const { vaultAPYs, treasuryAPY, pendingYield, loading: apyLoading } = useVaultAPY();
  const { data: cantonData, refresh: refreshCantonData } = useCantonLedger(0, activeParty);

  // ── All state hooks (must precede conditional returns — Rules of Hooks) ──

  // MUSD Admin
  const [newSupplyCap, setNewSupplyCap] = useState("");
  const [blacklistAddr, setBlacklistAddr] = useState("");

  // DirectMint Admin
  const [mintFeeBps, setMintFeeBps] = useState("");
  const [redeemFeeBps, setRedeemFeeBps] = useState("");
  const [newFeeRecipient, setNewFeeRecipient] = useState("");
  const [minMint, setMinMint] = useState("");
  const [maxMint, setMaxMint] = useState("");
  const [minRedeem, setMinRedeem] = useState("");
  const [maxRedeem, setMaxRedeem] = useState("");

  // Treasury Admin
  const [reserveBps, setReserveBps] = useState("");
  const [vaultActions, setVaultActions] = useState<Record<VaultAssignment, { deposit: string; withdraw: string }>>({
    vault1: { deposit: "", withdraw: "" },
    vault2: { deposit: "", withdraw: "" },
    vault3: { deposit: "", withdraw: "" },
  });

  // Bridge Admin
  const [bridgeMinSigs, setBridgeMinSigs] = useState("");
  const [bridgeRatio, setBridgeRatio] = useState("");
  const [emergencyCap, setEmergencyCap] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");

  // Borrow Admin
  const [newInterestRate, setNewInterestRate] = useState("");
  const [newMinDebt, setNewMinDebt] = useState("");

  // Oracle Admin
  const [oracleToken, setOracleToken] = useState("");
  const [oracleFeed, setOracleFeed] = useState("");
  const [oracleStale, setOracleStale] = useState("3600");
  const [oracleDecimals, setOracleDecimals] = useState("18");

  // Emergency / Global Pause
  const [cancelOpId, setCancelOpId] = useState("");
  const [globalPauseStatus, setGlobalPauseStatus] = useState<{ paused: boolean; lastPausedAt: string; lastUnpausedAt: string; isGuardian: boolean; isAdmin: boolean } | null>(null);

  // Vault Admin
  const [vaultData, setVaultData] = useState<Record<string, VaultViewData>>({});
  const [addSubAddr, setAddSubAddr] = useState("");
  const [addSubWeight, setAddSubWeight] = useState("");
  const [addSubCap, setAddSubCap] = useState("0");
  const [addSubVault, setAddSubVault] = useState<string>("");

  const { musd, directMint, treasury, bridge, borrow, oracle, metaVault1, metaVault2, metaVault3, globalPause, timelock } = contracts as any;

  // Current values + data-loading state (H-04)
  const [currentValues, setCurrentValues] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [faucetStatus, setFaucetStatus] = useState<{ success?: string; error?: string }>({});
  const [faucetLoadingKey, setFaucetLoadingKey] = useState<string | null>(null);
  const [cantonUsdcAmount, setCantonUsdcAmount] = useState("10000");
  const [cantonUsdcxAmount, setCantonUsdcxAmount] = useState("10000");
  const [cantonCoinAmount, setCantonCoinAmount] = useState("1000");
  const [cip56MusdAmount, setCip56MusdAmount] = useState("1000");
  const [ethUsdcAmount, setEthUsdcAmount] = useState("10000");
  const [ethUsdtAmount, setEthUsdtAmount] = useState("10000");
  const [ethMusdAmount, setEthMusdAmount] = useState("1000");
  const [evmUsdcBal, setEvmUsdcBal] = useState<bigint | null>(null);
  const [evmUsdtBal, setEvmUsdtBal] = useState<bigint | null>(null);
  const [evmMusdBal, setEvmMusdBal] = useState<bigint | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCurrentValues() {
      if (!address) return;
      setLoadError(null);
      const vals: Record<string, string> = {};
      try {
        if (musd) vals.supplyCap = formatUSD(await musd.supplyCap());
        if (directMint) {
          vals.mintFee = formatBps(await directMint.mintFeeBps());
          vals.redeemFee = formatBps(await directMint.redeemFeeBps());
          const accumulatedFeesRaw =
            typeof directMint.accumulatedFees === "function"
              ? await directMint.accumulatedFees()
              : typeof directMint.totalAccumulatedFees === "function"
                ? await directMint.totalAccumulatedFees()
                : 0n;
          vals.accFees = formatToken(accumulatedFeesRaw, 6);
          vals.paused = (await directMint.paused()).toString();
        }
        if (treasury) {
          // Use TreasuryV2 functions instead of stale V1 calls
          vals.maxDeploy = formatBps(await treasury.reserveBps());
          vals.totalBacking = formatUSD(await treasury.totalValue(), 6);
          vals.reserveBalance = formatUSD(await treasury.reserveBalance(), 6);
        }
        if (bridge) {
          vals.bridgeMinSigs = (await bridge.minSignatures()).toString();
          vals.bridgeRatio = formatBps(await bridge.collateralRatioBps());
          vals.bridgePaused = (await bridge.paused()).toString();
        }
        if (borrow) {
          vals.interestRate = formatBps(await borrow.interestRateBps());
          vals.minDebt = formatUSD(await borrow.minDebt());
        }
        // Global Pause status
        if (globalPause && address) {
          try {
            const paused = await globalPause.isGloballyPaused();
            const lastPausedAtRaw = await globalPause.lastPausedAt();
            const lastUnpausedAtRaw = await globalPause.lastUnpausedAt();
            const GUARDIAN_ROLE = await globalPause.GUARDIAN_ROLE();
            const ADMIN_ROLE = await globalPause.DEFAULT_ADMIN_ROLE();
            const isGuardian = await globalPause.hasRole(GUARDIAN_ROLE, address);
            const isAdmin = await globalPause.hasRole(ADMIN_ROLE, address);
            const fmtTs = (ts: bigint) => ts > 0n ? new Date(Number(ts) * 1000).toLocaleString() : "Never";
            if (!cancelled) setGlobalPauseStatus({
              paused,
              lastPausedAt: fmtTs(lastPausedAtRaw),
              lastUnpausedAt: fmtTs(lastUnpausedAtRaw),
              isGuardian,
              isAdmin,
            });
          } catch (err) {
            console.error("[AdminPage] GlobalPause load failed:", err);
          }
        }
      } catch (err) {
        console.error("[AdminPage] Failed to load protocol data:", err);
        if (!cancelled) setLoadError("Failed to load protocol data. Check RPC connection.");
      }
      if (!cancelled) setCurrentValues(vals);
    }
    loadCurrentValues();
    return () => { cancelled = true; };
  }, [musd, directMint, treasury, bridge, borrow, globalPause, address, tx.success]);

  // ── Load MetaVault data ──
  useEffect(() => {
    let cancelled = false;
    async function loadVaultData() {
      const vaults: Record<string, VaultViewData> = {};
      const mvContracts: Record<string, any> = { vault1: metaVault1, vault2: metaVault2, vault3: metaVault3 };

      for (const { key } of VAULT_CONTRACTS_MAP) {
        const mv = mvContracts[key];
        if (!mv) continue;
        try {
          const [totalVal, principal, idle, drift, driftThreshold, isPaused, isAct, count] = await Promise.all([
            mv.totalValue(),
            mv.totalPrincipal(),
            mv.idleBalance(),
            mv.currentDrift(),
            mv.driftThresholdBps(),
            mv.paused(),
            mv.isActive(),
            mv.subStrategyCount(),
          ]);
          const subs: SubStrategyView[] = [];
          for (let i = 0; i < Number(count); i++) {
            const s = await mv.getSubStrategy(i);
            subs.push({
              strategy: s.strategy,
              weightBps: Number(s.weightBps),
              capUsd: s.capUsd,
              enabled: s.enabled,
              currentValue: s.currentValue,
            });
          }
          vaults[key] = {
            key,
            contract: mv,
            totalValue: totalVal,
            totalPrincipal: principal,
            idle,
            drift: Number(drift),
            driftThreshold: Number(driftThreshold),
            paused: isPaused,
            active: isAct,
            subStrategies: subs,
          };
        } catch (err) {
          console.error(`[AdminPage] Failed to load ${key} data:`, err);
        }
      }
      if (!cancelled) setVaultData(vaults);
    }
    loadVaultData();
    return () => { cancelled = true; };
  }, [metaVault1, metaVault2, metaVault3, tx.success]);

  useEffect(() => {
    let cancelled = false;
    async function loadEvmFaucetBalances() {
      try {
        if (!address) {
          if (!cancelled) {
            setEvmUsdcBal(null);
            setEvmUsdtBal(null);
            setEvmMusdBal(null);
          }
          return;
        }
        const [usdcBal, usdtBal, musdBal] = await Promise.all([
          contracts.usdc ? contracts.usdc.balanceOf(address) : Promise.resolve(null),
          contracts.usdt ? contracts.usdt.balanceOf(address) : Promise.resolve(null),
          contracts.musd ? contracts.musd.balanceOf(address) : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setEvmUsdcBal(usdcBal);
          setEvmUsdtBal(usdtBal);
          setEvmMusdBal(musdBal);
        }
      } catch (err) {
        console.error("[AdminPage] Failed to load EVM faucet balances:", err);
      }
    }
    loadEvmFaucetBalances();
    return () => { cancelled = true; };
  }, [contracts.usdc, contracts.usdt, contracts.musd, address, tx.success, faucetStatus.success]);

  async function mintCantonFaucetToken(
    token: keyof typeof CANTON_FAUCET_TEMPLATES,
    amount: string
  ) {
    const trimmedAmount = amount.trim();
    const numericAmount = Number(trimmedAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFaucetStatus({ error: "Enter a valid Canton faucet amount." });
      return;
    }
    if (!CANTON_PACKAGE_ID) {
      setFaucetStatus({ error: "NEXT_PUBLIC_DAML_PACKAGE_ID is missing." });
      return;
    }
    const party = activeParty;
    if (!party) {
      setFaucetStatus({ error: "Connect your Loop wallet party before using the Canton faucet." });
      return;
    }

    setFaucetLoadingKey(`canton-${token}`);
    setFaucetStatus({});
    try {
      const payload: Record<string, unknown> = token === "USDCx"
        ? {
            issuer: CANTON_OPERATOR_PARTY,
            owner: party,
            amount: trimmedAmount,
            sourceChain: "admin-faucet",
            cctpNonce: Date.now(),
            privacyObservers: [] as string[],
          }
        : {
            issuer: CANTON_OPERATOR_PARTY,
            owner: party,
            amount: trimmedAmount,
            privacyObservers: [] as string[],
          };

      const response = await cantonCreate(CANTON_FAUCET_TEMPLATES[token], payload, { party });
      if (!response.success) {
        throw new Error(response.error || "Canton faucet command failed");
      }
      await refreshCantonData();
      setFaucetStatus({ success: `Minted ${trimmedAmount} ${token} on Canton.` });
    } catch (err: any) {
      setFaucetStatus({ error: err.message || "Canton faucet mint failed." });
    } finally {
      setFaucetLoadingKey(null);
    }
  }

  async function mintCip56MusdFaucet(amount: string) {
    const trimmedAmount = amount.trim();
    const numericAmount = Number(trimmedAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFaucetStatus({ error: "Enter a valid CIP-56 faucet amount." });
      return;
    }
    const party = activeParty;
    if (!party) {
      setFaucetStatus({ error: "Connect your Loop wallet party before using the CIP-56 faucet." });
      return;
    }
    setFaucetLoadingKey("canton-CIP56");
    setFaucetStatus({});
    try {
      const payload: Record<string, unknown> = {
        issuer: CANTON_OPERATOR_PARTY,
        owner: party,
        amount: trimmedAmount,
        blacklisted: false,
        observers: [],
        agreementHash: CIP56_FAUCET_AGREEMENT_HASH,
        agreementUri: CIP56_FAUCET_AGREEMENT_URI,
      };
      const response = await cantonCreate("CIP56MintedMUSD", payload, { party });
      if (!response.success) {
        throw new Error(response.error || "CIP-56 faucet command failed");
      }
      await refreshCantonData();
      setFaucetStatus({ success: `Minted ${trimmedAmount} CIP-56 mUSD on Canton.` });
    } catch (err: any) {
      setFaucetStatus({ error: err.message || "CIP-56 faucet mint failed." });
    } finally {
      setFaucetLoadingKey(null);
    }
  }

  async function mintEvmFaucetToken(token: "USDC" | "USDT" | "MUSD", amount: string) {
    const trimmedAmount = amount.trim();
    const numericAmount = Number(trimmedAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFaucetStatus({ error: "Enter a valid Ethereum faucet amount." });
      return;
    }
    if (!signer || !address) {
      setFaucetStatus({ error: "Connect your Ethereum wallet to mint test tokens." });
      return;
    }

    setFaucetLoadingKey(`eth-${token}`);
    setFaucetStatus({});
    try {
      if (token === "MUSD") {
        if (!CONTRACTS.USDC || !contracts.directMint || !contracts.musd) {
          throw new Error("USDC, DirectMint, or mUSD contract is not configured.");
        }

        const usdcMintable = new ethers.Contract(
          CONTRACTS.USDC,
          [
            "function mint(address to, uint256 amount)",
            "function approve(address spender, uint256 amount) returns (bool)",
            "function balanceOf(address account) view returns (uint256)",
          ],
          signer
        );

        const usdcAmount = ethers.parseUnits(trimmedAmount, USDC_DECIMALS);
        const mintUsdcTx = await usdcMintable.mint(address, usdcAmount);
        await mintUsdcTx.wait(1);

        const approveTx = await usdcMintable.approve(CONTRACTS.DirectMint, usdcAmount);
        await approveTx.wait(1);

        const mintMusdTx = await contracts.directMint.mint(usdcAmount);
        await mintMusdTx.wait(1);

        const [newUsdcBalance, newMusdBalance] = await Promise.all([
          usdcMintable.balanceOf(address),
          contracts.musd.balanceOf(address),
        ]);
        setEvmUsdcBal(newUsdcBalance);
        setEvmMusdBal(newMusdBalance);
        setFaucetStatus({ success: `Minted ${trimmedAmount} mUSD on Sepolia (via USDC + DirectMint).` });
      } else {
        const tokenAddress = token === "USDC" ? CONTRACTS.USDC : CONTRACTS.USDT;
        if (!tokenAddress) {
          throw new Error(`${token} address is not configured.`);
        }

        const mintableToken = new ethers.Contract(
          tokenAddress,
          [
            "function mint(address to, uint256 amount)",
            "function balanceOf(address account) view returns (uint256)",
          ],
          signer
        );

        const txResp = await mintableToken.mint(address, ethers.parseUnits(trimmedAmount, USDC_DECIMALS));
        await txResp.wait(1);
        const newBalance = await mintableToken.balanceOf(address);
        if (token === "USDC") setEvmUsdcBal(newBalance);
        if (token === "USDT") setEvmUsdtBal(newBalance);
        setFaucetStatus({ success: `Minted ${trimmedAmount} ${token} on Sepolia.` });
      }
    } catch (err: any) {
      setFaucetStatus({ error: err.message || `${token} mint failed.` });
    } finally {
      setFaucetLoadingKey(null);
    }
  }

  // ── Conditional returns (after all hooks — C-01 fix) ──
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h2 className="text-xl font-semibold text-gray-300">Admin Panel</h2>
        <p className="text-gray-400">Connect your wallet to access admin functions.</p>
        <WalletConnector />
      </div>
    );
  }

  if (isAdminLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-400">Verifying admin role…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h2 className="text-xl font-semibold text-red-400">Access Denied</h2>
        <p className="text-gray-400">
          Connected wallet <span className="font-mono text-sm">{address}</span> does not
          hold an admin role on this protocol.
        </p>
        <p className="text-gray-500 text-sm">
          Required: DEFAULT_ADMIN_ROLE or TIMELOCK_ROLE on the MUSD contract.
        </p>
      </div>
    );
  }

  const sections: { key: AdminSection; label: string }[] = [
    { key: "emergency", label: "🚨 Emergency" },
    { key: "musd", label: "mUSD" },
    { key: "directmint", label: "DirectMint" },
    { key: "treasury", label: "Treasury" },
    { key: "vaults", label: "Vaults" },
    { key: "bridge", label: "Bridge" },
    { key: "borrow", label: "Borrow" },
    { key: "oracle", label: "Oracle" },
    { key: "faucet", label: "🚰 Faucet" },
  ];

  const setVaultAmount = (
    vault: VaultAssignment,
    field: "deposit" | "withdraw",
    value: string
  ) => {
    setVaultActions((prev) => ({
      ...prev,
      [vault]: {
        ...prev[vault],
        [field]: value,
      },
    }));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Admin Panel</h1>
      <p className="text-gray-400">Protocol administration (requires appropriate roles)</p>

      <div className="flex flex-wrap gap-2 border-b border-gray-700 pb-4">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              section === s.key ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {tx.error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
          {tx.error}
        </div>
      )}
      {tx.success && (
        <div className="rounded-lg border border-green-800 bg-green-900/20 p-4 text-sm text-green-400">
          Transaction confirmed!
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 p-4 text-sm text-amber-400">
          ⚠️ {loadError}
        </div>
      )}

      {/* ===== Emergency Section ===== */}
      {section === "emergency" && (
        <div className="space-y-4">
          {/* Global Pause Status */}
          <div className={`card border-2 ${
            globalPauseStatus?.paused
              ? "border-red-500 bg-red-950/30"
              : "border-green-800 bg-green-950/20"
          }`}>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              {globalPauseStatus?.paused ? "🔴" : "🟢"} Global Protocol Status
            </h3>
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Status</span>
                <span className={globalPauseStatus?.paused ? "text-red-400 font-bold" : "text-green-400 font-bold"}>
                  {globalPauseStatus?.paused ? "⛔ PAUSED" : "✅ ACTIVE"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Last Paused</span>
                <span className="text-gray-300">{globalPauseStatus?.lastPausedAt || "..."}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Last Unpaused</span>
                <span className="text-gray-300">{globalPauseStatus?.lastUnpausedAt || "..."}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Your Roles</span>
                <span className="text-gray-300">
                  {globalPauseStatus?.isGuardian ? "✅ GUARDIAN" : "❌ GUARDIAN"}
                  {" · "}
                  {globalPauseStatus?.isAdmin ? "✅ ADMIN" : "❌ ADMIN"}
                </span>
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <TxButton
                className="flex-1 !bg-red-700 hover:!bg-red-600"
                onClick={() => tx.send(() => globalPause!.pauseGlobal())}
                loading={tx.loading}
                disabled={!globalPause || !globalPauseStatus?.isGuardian || globalPauseStatus?.paused}
              >
                🛑 Pause Entire Protocol
              </TxButton>
              <TxButton
                className="flex-1 !bg-green-700 hover:!bg-green-600"
                onClick={() => tx.send(() => globalPause!.unpauseGlobal())}
                loading={tx.loading}
                disabled={!globalPause || !globalPauseStatus?.isAdmin || !globalPauseStatus?.paused}
              >
                ▶️ Unpause Protocol
              </TxButton>
            </div>

            {!globalPauseStatus?.isGuardian && (
              <p className="mt-2 text-xs text-amber-400">
                ⚠️ Your wallet does not have GUARDIAN_ROLE — you cannot trigger the global pause.
              </p>
            )}
          </div>

          {/* Timelock Cancel */}
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Cancel Pending Timelock Operation</h3>
            <p className="mb-3 text-sm text-gray-500">
              If a malicious or incorrect operation was scheduled on the MintedTimelockController,
              paste the operation ID below to cancel it before it becomes executable.
              Requires CANCELLER_ROLE.
            </p>
            <label className="label">Operation ID (bytes32)</label>
            <input
              className="input font-mono text-xs"
              type="text"
              placeholder="0xb2693f1d561b08b889b568927f2930793111ee06eafe82142d40fed18b11afe4"
              value={cancelOpId}
              onChange={(e) => setCancelOpId(e.target.value)}
            />
            <TxButton
              className="mt-3 w-full !bg-amber-700 hover:!bg-amber-600"
              onClick={() => tx.send(() => timelock!.cancel(cancelOpId))}
              loading={tx.loading}
              disabled={!timelock || !cancelOpId || cancelOpId.length !== 66}
            >
              ⚠️ Cancel Timelock Operation
            </TxButton>
          </div>

          {/* Info Card */}
          <div className="card border border-gray-700">
            <h3 className="mb-2 font-semibold text-gray-300">Emergency Response Guide</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><span className="text-red-400 font-mono">pauseGlobal()</span> — Instantly halts all deposits, withdrawals, mints, borrows, and liquidations across the entire protocol. Use during active exploits.</li>
              <li><span className="text-amber-400 font-mono">cancel(id)</span> — Cancels a scheduled timelock operation before it executes. Use if a PROPOSER key is compromised and a malicious upgrade is queued.</li>
              <li><span className="text-green-400 font-mono">unpauseGlobal()</span> — Resumes protocol after root cause is resolved. Requires DEFAULT_ADMIN_ROLE (higher authority than GUARDIAN).</li>
            </ul>
          </div>
        </div>
      )}

      {/* ===== mUSD Section ===== */}
      {section === "musd" && (
        <div className="space-y-4">
          <div className="card">
            <p className="mb-2 text-sm text-gray-400">Current Supply Cap: {currentValues.supplyCap || "..."}</p>
            <label className="label">New Supply Cap (mUSD)</label>
            <input className="input" type="number" placeholder="1000000" value={newSupplyCap} onChange={(e) => setNewSupplyCap(e.target.value)} />
            <TxButton
              className="mt-3 w-full"
              onClick={() => tx.send(() => musd!.setSupplyCap(ethers.parseUnits(newSupplyCap, MUSD_DECIMALS)))}
              loading={tx.loading}
              disabled={!musd || !newSupplyCap}
            >
              Set Supply Cap
            </TxButton>
          </div>
          <div className="card">
            <label className="label">Compliance — Freeze / Permit Address</label>
            <input className="input" type="text" placeholder="0x..." value={blacklistAddr} onChange={(e) => setBlacklistAddr(e.target.value)} />
            <div className="mt-2 flex gap-2">
              <TxButton
                className="flex-1"
                onClick={() => tx.send(() => musd!.setBlacklist(blacklistAddr, true))}
                loading={tx.loading}
                disabled={!musd || !blacklistAddr || !isAddr(blacklistAddr)}
                variant="danger"
              >
                🔒 FREEZE
              </TxButton>
              <TxButton
                className="flex-1"
                onClick={() => tx.send(() => musd!.setBlacklist(blacklistAddr, false))}
                loading={tx.loading}
                disabled={!musd || !blacklistAddr || !isAddr(blacklistAddr)}
                variant="success"
              >
                ✅ PERMIT
              </TxButton>
            </div>
          </div>
        </div>
      )}

      {/* ===== DirectMint Section ===== */}
      {section === "directmint" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Mint Fee" value={currentValues.mintFee || "..."} />
            <StatCard label="Redeem Fee" value={currentValues.redeemFee || "..."} />
            <StatCard label="Accumulated Fees" value={currentValues.accFees || "..."} subValue="USDC" />
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Set Fees (basis points)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Mint Fee (bps)</label>
                <input className="input" type="number" placeholder="30" value={mintFeeBps} onChange={(e) => setMintFeeBps(e.target.value)} />
              </div>
              <div>
                <label className="label">Redeem Fee (bps)</label>
                <input className="input" type="number" placeholder="30" value={redeemFeeBps} onChange={(e) => setRedeemFeeBps(e.target.value)} />
              </div>
            </div>
            <TxButton
              className="mt-3 w-full"
              onClick={() => tx.send(() => directMint!.setFees(BigInt(mintFeeBps), BigInt(redeemFeeBps)))}
              loading={tx.loading}
              disabled={!directMint || !isValidBps(mintFeeBps) || !isValidBps(redeemFeeBps)}
            >
              Update Fees
            </TxButton>
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Set Limits (USDC)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Min Mint</label>
                <input className="input" type="number" value={minMint} onChange={(e) => setMinMint(e.target.value)} />
              </div>
              <div>
                <label className="label">Max Mint</label>
                <input className="input" type="number" value={maxMint} onChange={(e) => setMaxMint(e.target.value)} />
              </div>
              <div>
                <label className="label">Min Redeem</label>
                <input className="input" type="number" value={minRedeem} onChange={(e) => setMinRedeem(e.target.value)} />
              </div>
              <div>
                <label className="label">Max Redeem</label>
                <input className="input" type="number" value={maxRedeem} onChange={(e) => setMaxRedeem(e.target.value)} />
              </div>
            </div>
            <TxButton
              className="mt-3 w-full"
              onClick={() =>
                tx.send(() =>
                  directMint!.setLimits(
                    ethers.parseUnits(minMint, USDC_DECIMALS),
                    ethers.parseUnits(maxMint, USDC_DECIMALS),
                    ethers.parseUnits(minRedeem, USDC_DECIMALS),
                    ethers.parseUnits(maxRedeem, USDC_DECIMALS)
                  )
                )
              }
              loading={tx.loading}
              disabled={!directMint || !minMint || !maxMint || !minRedeem || !maxRedeem}
            >
              Update Limits
            </TxButton>
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Fee Recipient</h3>
            <input className="input" type="text" placeholder="0x..." value={newFeeRecipient} onChange={(e) => setNewFeeRecipient(e.target.value)} />
            <TxButton
              className="mt-3 w-full"
              onClick={() => tx.send(() => directMint!.setFeeRecipient(newFeeRecipient))}
              loading={tx.loading}
              disabled={!directMint || !newFeeRecipient || !isAddr(newFeeRecipient)}
            >
              Set Fee Recipient
            </TxButton>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TxButton onClick={() => tx.send(() => directMint!.withdrawFees())} loading={tx.loading} disabled={!directMint}>
              Withdraw Fees
            </TxButton>
            <TxButton onClick={() => tx.send(() => directMint!.pause())} loading={tx.loading} disabled={!directMint} variant="danger">
              Pause
            </TxButton>
            <TxButton onClick={() => tx.send(() => directMint!.unpause())} loading={tx.loading} disabled={!directMint} variant="secondary">
              Unpause
            </TxButton>
          </div>
        </div>
      )}

      {/* ===== Treasury Section ===== */}
      {section === "treasury" && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="mb-2 font-semibold text-gray-300">MetaVault Deposits & Withdrawals</h3>
            <p className="mb-4 text-xs text-gray-500">
              Deposit into or withdraw from any MetaVault directly from here.
            </p>
            <div className="grid gap-4 lg:grid-cols-3">
              {(["vault1", "vault2", "vault3"] as VaultAssignment[]).map((vk) => {
                const vd = vaultData[vk];
                return (
                  <div key={vk} className="rounded-lg border border-gray-700 bg-gray-800/30 p-3">
                    <div className="mb-2">
                      <p className="text-sm font-semibold text-white">{VAULT_LABELS[vk].label}</p>
                      <p className="text-[11px] text-gray-500">Value: {vd ? formatUSD(vd.totalValue, 6) : "Not deployed"}</p>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="label">Deposit (USDC)</label>
                        <input
                          className="input"
                          type="number"
                          placeholder="1000"
                          value={vaultActions[vk].deposit}
                          onChange={(e) => setVaultAmount(vk, "deposit", e.target.value)}
                        />
                        <button
                          type="button"
                          className="mt-1 text-[10px] text-brand-400 hover:underline"
                          onClick={() => setVaultAmount(vk, "deposit", (currentValues.reserveBalance || "0").replace(/[^0-9.]/g, ""))}
                        >
                          MAX RESERVE
                        </button>
                        <TxButton
                          className="mt-2 w-full"
                          size="sm"
                          onClick={() => tx.send(() => treasury!.deployToStrategy(vd.contract.target, ethers.parseUnits(vaultActions[vk].deposit, USDC_DECIMALS)))}
                          loading={tx.loading}
                          disabled={!treasury || !vd || !vaultActions[vk].deposit}
                        >
                          Deposit to {vk.replace("vault", "Vault ")}
                        </TxButton>
                      </div>

                      <div>
                        <label className="label">Withdraw (USDC)</label>
                        <input
                          className="input"
                          type="number"
                          placeholder="500"
                          value={vaultActions[vk].withdraw}
                          onChange={(e) => setVaultAmount(vk, "withdraw", e.target.value)}
                        />
                        <TxButton
                          className="mt-2 w-full"
                          size="sm"
                          variant="secondary"
                          onClick={() => tx.send(() => treasury!.withdrawFromStrategy(vd.contract.target, ethers.parseUnits(vaultActions[vk].withdraw, USDC_DECIMALS)))}
                          loading={tx.loading}
                          disabled={!treasury || !vd || !vaultActions[vk].withdraw}
                        >
                          Withdraw from {vk.replace("vault", "Vault ")}
                        </TxButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-2 font-semibold text-gray-300">Accumulated 20% Protocol Fees</h3>
            <p className="text-xs text-gray-500">
              Withdraw protocol fees accumulated by Treasury from harvested yield.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <StatCard label="Pending Fee (20%)" value={pendingYield ? `$${pendingYield.fee}` : "—"} color="yellow" />
              <StatCard label="Reserve Balance" value={currentValues.reserveBalance || "..."} color="green" />
              <StatCard label="Total Treasury Value" value={currentValues.totalBacking || "..."} />
            </div>
            <TxButton
              className="mt-3 w-full"
              onClick={() => tx.send(() => treasury!.claimFees())}
              loading={tx.loading}
              disabled={!treasury}
              variant="secondary"
            >
              Withdraw 20% Fees
            </TxButton>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total Value" value={currentValues.totalBacking || "..."} />
            <StatCard label="Reserve (idle USDC)" value={currentValues.reserveBalance || "..."} color="green" />
            <StatCard label="Reserve Target (bps)" value={currentValues.maxDeploy || "..."} />
          </div>

          {/* ── Reserve & Rebalance ── */}
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Reserve Ratio (bps)</h3>
            <p className="mb-2 text-xs text-gray-500">Current: {currentValues.maxDeploy || "..."}</p>
            <input className="input" type="number" placeholder="500" value={reserveBps} onChange={(e) => setReserveBps(e.target.value)} />
            <TxButton
              className="mt-3 w-full"
              onClick={() => tx.send(() => treasury!.setReserveBps(BigInt(reserveBps)))}
              loading={tx.loading}
              disabled={!treasury || !isValidBps(reserveBps)}
            >
              Set Reserve
            </TxButton>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TxButton
              onClick={() => tx.send(() => treasury!.rebalance())}
              loading={tx.loading}
              disabled={!treasury}
            >
              Rebalance All
            </TxButton>
            <TxButton
              onClick={() => tx.send(() => treasury!.emergencyWithdrawAll())}
              loading={tx.loading}
              disabled={!treasury}
              variant="danger"
            >
              Emergency Withdraw All
            </TxButton>
          </div>
        </div>
      )}

      {/* ===== Vaults Section ===== */}
      {section === "vaults" && (
        <div className="space-y-6">
          {/* Overview stats */}
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard
              label="Total Across Vaults"
              value={formatUSD(
                Object.values(vaultData).reduce((sum, v) => sum + v.totalValue, 0n),
                6
              )}
            />
            <StatCard
              label="Active Vaults"
              value={`${Object.values(vaultData).filter((v) => v.active).length} / 3`}
              color="green"
            />
            <StatCard
              label="Total Idle USDC"
              value={formatUSD(
                Object.values(vaultData).reduce((sum, v) => sum + v.idle, 0n),
                6
              )}
            />
            <StatCard
              label="Treasury APY (7d)"
              value={treasuryAPY != null ? `${treasuryAPY.toFixed(2)}%` : apyLoading ? "Loading…" : "Collecting…"}
              color={treasuryAPY != null && treasuryAPY > 0 ? "green" : undefined}
            />
          </div>

          {/* ── Yield Harvest Status ── */}
          <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-emerald-300">📊 Yield Harvest</h3>
              {pendingYield && (
                <span className="text-xs text-gray-400">
                  Auto-distributes 80% to smUSD holders | 20% protocol fee
                </span>
              )}
            </div>
            {pendingYield ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-gray-800/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Gross Yield</p>
                  <p className="text-sm font-medium text-white">${pendingYield.gross}</p>
                </div>
                <div className="rounded-lg bg-gray-800/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Net Yield (80%)</p>
                  <p className="text-sm font-medium text-emerald-400">${pendingYield.net}</p>
                </div>
                <div className="rounded-lg bg-gray-800/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Protocol Fee (20%)</p>
                  <p className="text-sm font-medium text-yellow-400">${pendingYield.fee}</p>
                </div>
                <div className="flex items-end">
                  <TxButton
                    size="sm"
                    onClick={() => tx.send(() => contracts.treasury!.harvestYield())}
                    loading={tx.loading}
                    disabled={!contracts.treasury || pendingYield.net === "0.00"}
                  >
                    Harvest Now
                  </TxButton>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                {apyLoading ? "Loading yield data…" : "Connect wallet & deploy TreasuryV2 upgrade to see pending yield."}
              </p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {(["vault1", "vault2", "vault3"] as VaultAssignment[]).map((vk) => (
                <div key={vk} className="rounded-lg bg-gray-800/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">{VAULT_LABELS[vk].label.split("—")[0].trim()} APY</p>
                  <p className={`text-lg font-bold ${vaultAPYs[vk] != null && vaultAPYs[vk]! > 0 ? "text-emerald-400" : "text-gray-400"}`}>
                    {vaultAPYs[vk] != null ? `${vaultAPYs[vk]!.toFixed(2)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-gray-600">
                    {vaultAPYs[vk] != null ? "7-day annualized" : "Collecting data…"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Per-vault cards */}
          {(["vault1", "vault2", "vault3"] as VaultAssignment[]).map((vk) => {
            const label = VAULT_LABELS[vk];
            const vd = vaultData[vk];
            const strategies = KNOWN_STRATEGIES.filter((ks) => ks.vault === vk);

            return (
              <div key={vk} className="rounded-xl border border-gray-700 bg-gray-900/50 overflow-hidden">
                {/* Vault header */}
                <div className="flex items-center justify-between border-b border-gray-700/50 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${label.badge}`}>
                      {vk.replace("vault", "#")}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold text-white">{label.label}</h3>
                      <p className="text-xs text-gray-500">{label.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {vd ? (
                      <>
                        {vd.paused && (
                          <span className="rounded bg-red-900/60 px-2 py-0.5 text-[10px] font-medium text-red-400">PAUSED</span>
                        )}
                        {!vd.active && !vd.paused && (
                          <span className="rounded bg-yellow-900/60 px-2 py-0.5 text-[10px] font-medium text-yellow-400">INACTIVE</span>
                        )}
                        {vd.active && !vd.paused && (
                          <span className="rounded bg-green-900/60 px-2 py-0.5 text-[10px] font-medium text-green-400">LIVE</span>
                        )}
                      </>
                    ) : (
                      <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] text-gray-500">NOT DEPLOYED</span>
                    )}
                  </div>
                </div>

                {/* Vault body */}
                {vd ? (
                  <div className="px-5 py-4 space-y-4">
                    {/* Stats row */}
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-gray-800/40 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Total Value</p>
                        <p className="text-sm font-medium text-white">{formatUSD(vd.totalValue, 6)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-800/40 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Principal</p>
                        <p className="text-sm font-medium text-white">{formatUSD(vd.totalPrincipal, 6)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-800/40 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Idle USDC</p>
                        <p className="text-sm font-medium text-white">{formatUSD(vd.idle, 6)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-800/40 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Drift / Threshold</p>
                        <p className={`text-sm font-medium ${vd.drift >= vd.driftThreshold ? "text-yellow-400" : "text-white"}`}>
                          {(vd.drift / 100).toFixed(1)}% / {(vd.driftThreshold / 100).toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    {/* Sub-strategies */}
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Sub-Strategies</h4>
                      {vd.subStrategies.length === 0 ? (
                        <p className="text-xs text-gray-500">No sub-strategies registered.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {vd.subStrategies.map((ss, idx) => {
                            const name = strategyName(ss.strategy);
                            const color = strategyColor(ss.strategy);
                            const pct = vd.totalValue > 0n
                              ? Number((ss.currentValue * 10000n) / vd.totalValue) / 100
                              : 0;
                            return (
                              <div key={idx} className="flex items-center justify-between rounded-lg bg-gray-800/30 px-4 py-2.5 text-sm">
                                <div className="flex items-center gap-3">
                                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                                  <span className="font-medium text-white">{name}</span>
                                  <span className="font-mono text-[10px] text-gray-600">
                                    {ss.strategy.slice(0, 6)}…{ss.strategy.slice(-4)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-gray-400">{formatUSD(ss.currentValue, 6)}</span>
                                  {/* Weight bar */}
                                  <div className="flex items-center gap-1.5">
                                    <div className="h-1.5 w-16 rounded-full bg-gray-700 overflow-hidden">
                                      <div
                                        className="h-full rounded-full"
                                        style={{ width: `${pct}%`, backgroundColor: color }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-gray-400 w-8 text-right">
                                      {(ss.weightBps / 100).toFixed(0)}%
                                    </span>
                                  </div>
                                  {ss.enabled ? (
                                    <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-[10px] text-green-400">ON</span>
                                  ) : (
                                    <span className="rounded bg-red-900/40 px-1.5 py-0.5 text-[10px] text-red-400">OFF</span>
                                  )}
                                  {/* Toggle circuit breaker */}
                                  <button
                                    onClick={() => tx.send(() => vd.contract.toggleSubStrategy(idx, !ss.enabled))}
                                    className="rounded bg-gray-700 px-2 py-0.5 text-[10px] text-gray-300 hover:bg-gray-600"
                                    disabled={tx.loading}
                                  >
                                    {ss.enabled ? "Disable" : "Enable"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Vault actions */}
                    <div className="flex flex-wrap gap-2 border-t border-gray-700/30 pt-3">
                      <TxButton
                        size="sm"
                        onClick={() => tx.send(() => vd.contract.rebalance())}
                        loading={tx.loading}
                        disabled={vd.drift < vd.driftThreshold}
                      >
                        Rebalance
                      </TxButton>
                      <TxButton
                        size="sm"
                        variant="secondary"
                        onClick={() => tx.send(() => vd.contract.pause())}
                        loading={tx.loading}
                        disabled={vd.paused}
                      >
                        Pause
                      </TxButton>
                      <TxButton
                        size="sm"
                        variant="secondary"
                        onClick={() => tx.send(() => vd.contract.unpause())}
                        loading={tx.loading}
                        disabled={!vd.paused}
                      >
                        Unpause
                      </TxButton>
                      <TxButton
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (confirm(`Emergency withdraw ALL from ${label.label}? This will disable all sub-strategies.`)) {
                            tx.send(() => vd.contract.emergencyWithdrawAll());
                          }
                        }}
                        loading={tx.loading}
                      >
                        Emergency Withdraw All
                      </TxButton>
                    </div>
                  </div>
                ) : (
                  /* Not deployed — show catalog preview */
                  <div className="px-5 py-4">
                    <p className="mb-3 text-xs text-gray-500">
                      Not yet deployed. Planned sub-strategies:
                    </p>
                    <div className="space-y-1">
                      {strategies.map((ks, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: ks.color }} />
                          <span>{ks.shortName}</span>
                          <span className="text-gray-600">— {vaultAPYs[vk] != null ? `${vaultAPYs[vk]!.toFixed(1)}% live` : ks.apy}</span>
                          <span className="text-gray-600">({ks.targetBps / 100}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Add Sub-Strategy to Vault ── */}
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Add Sub-Strategy to Vault</h3>
            <p className="mb-3 text-xs text-gray-500">Register a new sub-strategy inside a MetaVault. Remember to call setWeights() afterwards so weights sum to 100%.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label">Vault</label>
                <select className="input" value={addSubVault} onChange={(e) => setAddSubVault(e.target.value)}>
                  <option value="">Select vault…</option>
                  {(["vault1", "vault2", "vault3"] as VaultAssignment[]).map((vk) => (
                    vaultData[vk] ? <option key={vk} value={vk}>{VAULT_LABELS[vk].label}</option> : null
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Strategy Address</label>
                <input className="input" type="text" placeholder="0x..." value={addSubAddr} onChange={(e) => setAddSubAddr(e.target.value)} />
              </div>
              <div>
                <label className="label">Weight (bps)</label>
                <input className="input" type="number" placeholder="2500" value={addSubWeight} onChange={(e) => setAddSubWeight(e.target.value)} />
              </div>
              <div>
                <label className="label">Cap (USDC, 0=∞)</label>
                <input className="input" type="number" placeholder="0" value={addSubCap} onChange={(e) => setAddSubCap(e.target.value)} />
              </div>
            </div>
            <TxButton
              className="mt-3 w-full"
              onClick={() => {
                const vd = vaultData[addSubVault];
                if (vd) {
                  tx.send(() =>
                    vd.contract.addSubStrategy(
                      addSubAddr,
                      BigInt(addSubWeight),
                      ethers.parseUnits(addSubCap || "0", USDC_DECIMALS)
                    )
                  );
                }
              }}
              loading={tx.loading}
              disabled={!addSubVault || !isAddr(addSubAddr) || !addSubWeight}
            >
              Add Sub-Strategy
            </TxButton>
          </div>
        </div>
      )}

      {/* ===== Bridge Section ===== */}
      {section === "bridge" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Min Signatures" value={currentValues.bridgeMinSigs || "..."} />
            <StatCard label="Collateral Ratio" value={currentValues.bridgeRatio || "..."} />
            <StatCard label="Paused" value={currentValues.bridgePaused || "..."} color={currentValues.bridgePaused === "true" ? "red" : "green"} />
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Configuration</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Min Signatures</label>
                <input className="input" type="number" value={bridgeMinSigs} onChange={(e) => setBridgeMinSigs(e.target.value)} />
                <TxButton className="mt-2 w-full" onClick={() => tx.send(() => bridge!.setMinSignatures(BigInt(bridgeMinSigs)))} loading={tx.loading} disabled={!bridge || !bridgeMinSigs}>
                  Update
                </TxButton>
              </div>
              <div>
                <label className="label">Collateral Ratio (bps)</label>
                <input className="input" type="number" value={bridgeRatio} onChange={(e) => setBridgeRatio(e.target.value)} />
                <TxButton className="mt-2 w-full" onClick={() => tx.send(() => bridge!.setCollateralRatio(BigInt(bridgeRatio)))} loading={tx.loading} disabled={!bridge || !isValidBps(bridgeRatio)}>
                  Update
                </TxButton>
              </div>
            </div>
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Emergency Cap Reduction</h3>
            <div>
              <label className="label">New Cap (mUSD)</label>
              <input className="input" type="number" value={emergencyCap} onChange={(e) => setEmergencyCap(e.target.value)} />
            </div>
            <div className="mt-3">
              <label className="label">Reason</label>
              <input className="input" type="text" value={emergencyReason} onChange={(e) => setEmergencyReason(e.target.value)} />
            </div>
            <TxButton
              className="mt-3 w-full"
              onClick={() => tx.send(() => bridge!.emergencyReduceCap(ethers.parseUnits(emergencyCap, MUSD_DECIMALS), emergencyReason))}
              loading={tx.loading}
              disabled={!bridge || !emergencyCap || !emergencyReason}
              variant="danger"
            >
              Emergency Reduce Cap
            </TxButton>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TxButton onClick={() => tx.send(() => bridge!.pause())} loading={tx.loading} disabled={!bridge} variant="danger">
              Pause Bridge
            </TxButton>
            <TxButton onClick={() => tx.send(() => bridge!.requestUnpause())} loading={tx.loading} disabled={!bridge} variant="secondary">
              Request Unpause (24h delay)
            </TxButton>
            <TxButton onClick={() => tx.send(() => bridge!.executeUnpause())} loading={tx.loading} disabled={!bridge} variant="secondary">
              Execute Unpause
            </TxButton>
          </div>
        </div>
      )}

      {/* ===== Borrow Section ===== */}
      {section === "borrow" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Interest Rate" value={currentValues.interestRate || "..."} />
            <StatCard label="Min Debt" value={currentValues.minDebt || "..."} />
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Set Interest Rate (bps APR)</h3>
            <input className="input" type="number" placeholder="500" value={newInterestRate} onChange={(e) => setNewInterestRate(e.target.value)} />
            <TxButton
              className="mt-3 w-full"
              onClick={() => tx.send(() => borrow!.setInterestRate(BigInt(newInterestRate)))}
              loading={tx.loading}
              disabled={!borrow || !isValidBps(newInterestRate)}
            >
              Set Interest Rate
            </TxButton>
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Set Min Debt (mUSD)</h3>
            <input className="input" type="number" placeholder="100" value={newMinDebt} onChange={(e) => setNewMinDebt(e.target.value)} />
            <TxButton
              className="mt-3 w-full"
              onClick={() => tx.send(() => borrow!.setMinDebt(ethers.parseUnits(newMinDebt, MUSD_DECIMALS)))}
              loading={tx.loading}
              disabled={!borrow || !newMinDebt}
            >
              Set Min Debt
            </TxButton>
          </div>
        </div>
      )}

      {/* ===== Oracle Section ===== */}
      {section === "oracle" && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Set Price Feed</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Token Address</label>
                <input className="input" type="text" placeholder="0x..." value={oracleToken} onChange={(e) => setOracleToken(e.target.value)} />
              </div>
              <div>
                <label className="label">Chainlink Feed</label>
                <input className="input" type="text" placeholder="0x..." value={oracleFeed} onChange={(e) => setOracleFeed(e.target.value)} />
              </div>
              <div>
                <label className="label">Stale Period (seconds)</label>
                <input className="input" type="number" value={oracleStale} onChange={(e) => setOracleStale(e.target.value)} />
              </div>
              <div>
                <label className="label">Token Decimals</label>
                <input className="input" type="number" value={oracleDecimals} onChange={(e) => setOracleDecimals(e.target.value)} />
              </div>
            </div>
            <TxButton
              className="mt-3 w-full"
              onClick={() =>
                tx.send(() =>
                  oracle!.setFeed(oracleToken, oracleFeed, BigInt(oracleStale), parseInt(oracleDecimals), 0)
                )
              }
              loading={tx.loading}
              disabled={!oracle || !oracleToken || !oracleFeed || !isAddr(oracleToken) || !isAddr(oracleFeed)}
            >
              Set Feed
            </TxButton>
          </div>
        </div>
      )}

      {/* ===== Faucet Section ===== */}
      {section === "faucet" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/20 p-4 text-sm text-yellow-200">
            Devnet-only faucet controls. Keep these disabled for production.
          </div>

          {faucetStatus.error && (
            <div className="rounded-lg border border-red-700/40 bg-red-900/20 p-4 text-sm text-red-300">
              {faucetStatus.error}
            </div>
          )}
          {faucetStatus.success && (
            <div className="rounded-lg border border-green-700/40 bg-green-900/20 p-4 text-sm text-green-300">
              {faucetStatus.success}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Canton USDC + USDCx" value={cantonData ? Number(cantonData.totalUsdc || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "..."} />
            <StatCard label="Canton Coin" value={cantonData ? Number(cantonData.totalCoin || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "..."} />
            <StatCard label="Canton Party" value={cantonData?.party ? `${cantonData.party.slice(0, 18)}…` : "Not connected"} />
          </div>

          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Canton Faucet</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Canton USDC Amount</label>
                <input className="input" type="number" value={cantonUsdcAmount} onChange={(e) => setCantonUsdcAmount(e.target.value)} />
                <TxButton
                  className="mt-2 w-full"
                  onClick={() => mintCantonFaucetToken("CantonUSDC", cantonUsdcAmount)}
                  loading={faucetLoadingKey === "canton-CantonUSDC"}
                  disabled={faucetLoadingKey !== null}
                >
                  Mint Canton USDC
                </TxButton>
              </div>
              <div>
                <label className="label">USDCx Amount</label>
                <input className="input" type="number" value={cantonUsdcxAmount} onChange={(e) => setCantonUsdcxAmount(e.target.value)} />
                <TxButton
                  className="mt-2 w-full"
                  onClick={() => mintCantonFaucetToken("USDCx", cantonUsdcxAmount)}
                  loading={faucetLoadingKey === "canton-USDCx"}
                  disabled={faucetLoadingKey !== null}
                >
                  Mint USDCx
                </TxButton>
              </div>
              <div>
                <label className="label">Canton Coin Amount</label>
                <input className="input" type="number" value={cantonCoinAmount} onChange={(e) => setCantonCoinAmount(e.target.value)} />
                <TxButton
                  className="mt-2 w-full"
                  onClick={() => mintCantonFaucetToken("CantonCoin", cantonCoinAmount)}
                  loading={faucetLoadingKey === "canton-CantonCoin"}
                  disabled={faucetLoadingKey !== null}
                >
                  Mint Canton Coin
                </TxButton>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">CIP-56 mUSD Faucet (Primary Standard)</h3>
            <p className="mb-2 text-xs text-gray-400">Canton Network standard mUSD token for transfers and settlement.</p>
            <div>
              <label className="label">Amount</label>
              <input className="input" type="number" value={cip56MusdAmount} onChange={(e) => setCip56MusdAmount(e.target.value)} />
              <TxButton
                className="mt-2 w-full"
                onClick={() => mintCip56MusdFaucet(cip56MusdAmount)}
                loading={faucetLoadingKey === "canton-CIP56"}
                disabled={faucetLoadingKey !== null || !CIP56_CONFIGURED}
              >
                Mint CIP-56 mUSD
              </TxButton>
              {!CIP56_CONFIGURED && (
                <p className="mt-2 text-xs text-yellow-400">
                  Requires: NEXT_PUBLIC_CIP56_PACKAGE_ID, NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_HASH, NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_URI
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-3 font-semibold text-gray-300">Ethereum Faucet (Sepolia)</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">USDC Amount</label>
                <input className="input" type="number" value={ethUsdcAmount} onChange={(e) => setEthUsdcAmount(e.target.value)} />
                <p className="mt-1 text-xs text-gray-500">Wallet Balance: {evmUsdcBal !== null ? formatToken(evmUsdcBal, USDC_DECIMALS) : "..."}</p>
                <TxButton
                  className="mt-2 w-full"
                  onClick={() => mintEvmFaucetToken("USDC", ethUsdcAmount)}
                  loading={faucetLoadingKey === "eth-USDC"}
                  disabled={faucetLoadingKey !== null || !signer || !address}
                >
                  Mint USDC
                </TxButton>
              </div>
              <div>
                <label className="label">USDT Amount</label>
                <input className="input" type="number" value={ethUsdtAmount} onChange={(e) => setEthUsdtAmount(e.target.value)} />
                <p className="mt-1 text-xs text-gray-500">Wallet Balance: {evmUsdtBal !== null ? formatToken(evmUsdtBal, USDC_DECIMALS) : "..."}</p>
                <TxButton
                  className="mt-2 w-full"
                  onClick={() => mintEvmFaucetToken("USDT", ethUsdtAmount)}
                  loading={faucetLoadingKey === "eth-USDT"}
                  disabled={faucetLoadingKey !== null || !signer || !address}
                >
                  Mint USDT
                </TxButton>
              </div>
              <div>
                <label className="label">mUSD Amount</label>
                <input className="input" type="number" value={ethMusdAmount} onChange={(e) => setEthMusdAmount(e.target.value)} />
                <p className="mt-1 text-xs text-gray-500">Wallet Balance: {evmMusdBal !== null ? formatToken(evmMusdBal, MUSD_DECIMALS) : "..."}</p>
                <TxButton
                  className="mt-2 w-full"
                  onClick={() => mintEvmFaucetToken("MUSD", ethMusdAmount)}
                  loading={faucetLoadingKey === "eth-MUSD"}
                  disabled={faucetLoadingKey !== null || !signer || !address || !contracts.directMint || !contracts.musd}
                >
                  Mint mUSD
                </TxButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPage;

import { ethers } from "ethers";

export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || "1");

export const CONTRACTS: Record<string, string> = {
  MUSD: process.env.NEXT_PUBLIC_MUSD_ADDRESS || "",
  SMUSD: process.env.NEXT_PUBLIC_SMUSD_ADDRESS || "",
  USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS || "",
  USDT: process.env.NEXT_PUBLIC_USDT_ADDRESS || "",
  DirectMint: process.env.NEXT_PUBLIC_DIRECT_MINT_ADDRESS || "",
  Treasury: process.env.NEXT_PUBLIC_TREASURY_ADDRESS || "",
  CollateralVault: process.env.NEXT_PUBLIC_COLLATERAL_VAULT_ADDRESS || "",
  BorrowModule: process.env.NEXT_PUBLIC_BORROW_MODULE_ADDRESS || "",
  LiquidationEngine: process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE_ADDRESS || "",
  BLEBridgeV9: process.env.NEXT_PUBLIC_BRIDGE_ADDRESS || "",
  PriceOracle: process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS || "",
  LeverageVault: process.env.NEXT_PUBLIC_LEVERAGE_VAULT_ADDRESS || "",
  ETHPool: process.env.NEXT_PUBLIC_ETH_POOL_ADDRESS || "",
  SMUSDE: process.env.NEXT_PUBLIC_SMUSDE_ADDRESS || "",
  MetaVault: process.env.NEXT_PUBLIC_METAVAULT_ADDRESS || "",
};

// Validate contract addresses at config time
export function validateContracts(): { valid: boolean; missing: string[] } {
  const requiredContracts = ["MUSD", "DirectMint", "USDC"];
  const missing = requiredContracts.filter(
    (c) => !CONTRACTS[c] || !ethers.isAddress(CONTRACTS[c])
  );
  return { valid: missing.length === 0, missing };
}

// Canton token should NOT be exposed client-side
// Move to server-side API routes for production. This is a placeholder.
export const CANTON_CONFIG = {
  ledgerHost: process.env.NEXT_PUBLIC_CANTON_LEDGER_HOST || "localhost",
  ledgerPort: parseInt(process.env.NEXT_PUBLIC_CANTON_LEDGER_PORT || "7575"),
  // Use HTTPS in production, HTTP only for local development
  protocol: process.env.NODE_ENV === 'production' 
    ? (process.env.NEXT_PUBLIC_CANTON_PROTOCOL || "https")
    : (process.env.NEXT_PUBLIC_CANTON_PROTOCOL || "http"),
  // Token removed from client - fetch from secure API route
  // token: "" - Removed: Use /api/canton/token endpoint instead
};

export const USDC_DECIMALS = 6;
export const MUSD_DECIMALS = 18;
export const SCALING_FACTOR = 10n ** 12n; // USDC 6 → mUSD 18

// Input validation utilities
export function validateAmount(
  amount: string,
  decimals: number,
  minWei: bigint = 0n,
  maxWei: bigint = ethers.MaxUint256
): { valid: boolean; error?: string; parsed?: bigint } {
  if (!amount || amount.trim() === "") {
    return { valid: false, error: "Amount is required" };
  }
  
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    return { valid: false, error: "Amount must be a positive number" };
  }
  
  try {
    const parsed = ethers.parseUnits(amount, decimals);
    if (parsed < minWei) {
      return { valid: false, error: `Amount below minimum` };
    }
    if (parsed > maxWei) {
      return { valid: false, error: `Amount exceeds maximum` };
    }
    return { valid: true, parsed };
  } catch {
    return { valid: false, error: "Invalid amount format" };
  }
}

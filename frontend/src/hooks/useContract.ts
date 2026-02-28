import { useMemo } from "react";
import { ethers } from "ethers";
import { CONTRACTS } from "@/lib/config";
import { MUSD_ABI } from "@/abis/MUSD";
import { SMUSD_ABI } from "@/abis/SMUSD";
import { DIRECT_MINT_ABI } from "@/abis/DirectMint";
import { TREASURY_ABI } from "@/abis/Treasury";
import { COLLATERAL_VAULT_ABI } from "@/abis/CollateralVault";
import { BORROW_MODULE_ABI } from "@/abis/BorrowModule";
import { LIQUIDATION_ENGINE_ABI } from "@/abis/LiquidationEngine";
import { BLE_BRIDGE_V9_ABI } from "@/abis/BLEBridgeV9";
import { PRICE_ORACLE_ABI } from "@/abis/PriceOracle";
import { ERC20_ABI } from "@/abis/ERC20";

const ABI_MAP: Record<string, readonly string[]> = {
  MUSD: MUSD_ABI,
  SMUSD: SMUSD_ABI,
  DirectMint: DIRECT_MINT_ABI,
  Treasury: TREASURY_ABI,
  CollateralVault: COLLATERAL_VAULT_ABI,
  BorrowModule: BORROW_MODULE_ABI,
  LiquidationEngine: LIQUIDATION_ENGINE_ABI,
  BLEBridgeV9: BLE_BRIDGE_V9_ABI,
  PriceOracle: PRICE_ORACLE_ABI,
  USDC: ERC20_ABI,
};

export function useContract(
  name: keyof typeof CONTRACTS,
  signerOrProvider: ethers.Signer | ethers.Provider | null
) {
  return useMemo(() => {
    const address = CONTRACTS[name];
    const abi = ABI_MAP[name];
    if (!address || !abi || !signerOrProvider) return null;
    return new ethers.Contract(address, abi, signerOrProvider);
  }, [name, signerOrProvider]);
}

export function useContracts(signer: ethers.Signer | null) {
  const musd = useContract("MUSD", signer);
  const smusd = useContract("SMUSD", signer);
  const usdc = useContract("USDC", signer);
  const directMint = useContract("DirectMint", signer);
  const treasury = useContract("Treasury", signer);
  const vault = useContract("CollateralVault", signer);
  const borrow = useContract("BorrowModule", signer);
  const liquidation = useContract("LiquidationEngine", signer);
  const bridge = useContract("BLEBridgeV9", signer);
  const oracle = useContract("PriceOracle", signer);

  return { musd, smusd, usdc, directMint, treasury, vault, borrow, liquidation, bridge, oracle };
}

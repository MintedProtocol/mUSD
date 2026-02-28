/**
 * useNetworkGuard — Network mismatch detection hook
 *
 * Reads NEXT_PUBLIC_CHAIN_ID from config.ts, compares against the wallet's
 * connected chainId from UnifiedWalletProvider. Exposes:
 *   - isCorrectNetwork   – true when wallet matches expected chain (or no wallet)
 *   - expectedChainId    – the chain ID the dApp is configured for
 *   - walletChainId      – the chain ID the wallet is currently on (null if disconnected)
 *   - expectedChainName  – human-readable name of the expected network
 *   - walletChainName    – human-readable name of the wallet's network
 *   - switchToCorrectNetwork() – prompts the wallet to switch
 *
 * Designed for ethers v6 + raw RPC (no wagmi).
 */

import { useCallback, useMemo } from 'react';
import { useUnifiedWallet } from './useUnifiedWallet';
import { CHAIN_ID } from '@/lib/config';
import { getChainByChainId } from '@/lib/chains';
import { getNetworkById } from '@/lib/walletconnect';

/** Canonical chain-name lookup (covers chains.ts + walletconnect.ts + fallback) */
function chainName(chainId: number | null): string {
  if (chainId === null) return 'Unknown';

  // Try chains.ts first (has the richest metadata)
  const chainConfig = getChainByChainId(chainId);
  if (chainConfig) return chainConfig.name;

  // Fallback to walletconnect.ts network list
  const wcNet = getNetworkById(chainId);
  if (wcNet) return wcNet.name;

  // Last resort
  const wellKnown: Record<number, string> = {
    1: 'Ethereum Mainnet',
    5: 'Goerli',
    11155111: 'Sepolia',
    8453: 'Base',
    84532: 'Base Sepolia',
    42161: 'Arbitrum One',
    421614: 'Arbitrum Sepolia',
    31337: 'Hardhat Local',
    137: 'Polygon',
    10: 'Optimism',
  };
  return wellKnown[chainId] ?? `Chain ${chainId}`;
}

export interface NetworkGuardState {
  /** True when wallet chain matches expected chain (or wallet is disconnected) */
  isCorrectNetwork: boolean;
  /** The chain ID the dApp expects (from NEXT_PUBLIC_CHAIN_ID) */
  expectedChainId: number;
  /** The chain ID the wallet is connected to (null if disconnected) */
  walletChainId: number | null;
  /** Human-readable name of the expected network */
  expectedChainName: string;
  /** Human-readable name of the wallet's current network */
  walletChainName: string;
  /** Whether the user has a wallet connected */
  isConnected: boolean;
  /** Prompt the wallet to switch to the expected chain */
  switchToCorrectNetwork: () => Promise<void>;
}

export function useNetworkGuard(): NetworkGuardState {
  const { chainId: walletChainId, isConnected, switchChain } = useUnifiedWallet();

  const expectedChainId = CHAIN_ID;

  const isCorrectNetwork = useMemo(() => {
    // If wallet is not connected, don't block — the user will see connection prompts first
    if (!isConnected || walletChainId === null) return true;
    return walletChainId === expectedChainId;
  }, [isConnected, walletChainId, expectedChainId]);

  const expectedChainName = useMemo(() => chainName(expectedChainId), [expectedChainId]);
  const walletChainName = useMemo(() => chainName(walletChainId), [walletChainId]);

  const switchToCorrectNetwork = useCallback(async () => {
    await switchChain(expectedChainId);
  }, [switchChain, expectedChainId]);

  return {
    isCorrectNetwork,
    expectedChainId,
    walletChainId,
    expectedChainName,
    walletChainName,
    isConnected,
    switchToCorrectNetwork,
  };
}

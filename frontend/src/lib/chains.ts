/**
 * Multi-Chain Configuration
 * 
 * Supports deposits from multiple chains that route to the main Ethereum Treasury.
 * - EVM Chains: Ethereum, Base, Arbitrum (native support)
 * - Non-EVM: Solana (via Wormhole bridge)
 */

export type ChainType = 'evm' | 'solana';

export interface ChainConfig {
  id: string;
  chainId: number | string; // number for EVM, string for non-EVM
  name: string;
  shortName: string;
  type: ChainType;
  icon: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  // Contract addresses on this chain
  contracts: {
    USDC: string;
    depositRouter: string; // Contract that receives deposits and routes to ETH treasury
    wormholeBridge?: string; // For non-ETH chains
  };
  // Is this the main treasury chain?
  isTreasuryChain: boolean;
  // Supported for deposits?
  depositsEnabled: boolean;
  // Is this a testnet?
  isTestnet: boolean;
  // Average block time in seconds
  blockTime: number;
  // Estimated time to finality
  finalityTime: number;
}

// Main Ethereum chain - where the Treasury lives
export const ETHEREUM_MAINNET: ChainConfig = {
  id: 'ethereum',
  chainId: 1,
  name: 'Ethereum',
  shortName: 'ETH',
  type: 'evm',
  icon: '/chains/ethereum.svg',
  rpcUrl: process.env.NEXT_PUBLIC_ETH_RPC_URL || 'https://eth.llamarpc.com',
  explorerUrl: 'https://etherscan.io',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  contracts: {
    USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    // Use correct env var name for deposit router
    // Fallback to DIRECT_MINT for backwards compatibility
    depositRouter: process.env.NEXT_PUBLIC_DEPOSIT_ROUTER_ADDRESS || process.env.NEXT_PUBLIC_DIRECT_MINT_ADDRESS || '',
  },
  isTreasuryChain: true,
  depositsEnabled: true,
  isTestnet: false,
  blockTime: 12,
  finalityTime: 900, // ~15 minutes for finality
};

export const ETHEREUM_SEPOLIA: ChainConfig = {
  id: 'sepolia',
  chainId: 11155111,
  name: 'Sepolia Testnet',
  shortName: 'SEP',
  type: 'evm',
  icon: '/chains/ethereum.svg',
  rpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
  explorerUrl: 'https://sepolia.etherscan.io',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  contracts: {
    USDC: process.env.NEXT_PUBLIC_SEPOLIA_USDC_ADDRESS || '',
    depositRouter: process.env.NEXT_PUBLIC_SEPOLIA_DEPOSIT_ROUTER_ADDRESS || '',
  },
  isTreasuryChain: true,
  depositsEnabled: true,
  isTestnet: true,
  blockTime: 12,
  finalityTime: 180,
};

export const BASE_MAINNET: ChainConfig = {
  id: 'base',
  chainId: 8453,
  name: 'Base',
  shortName: 'BASE',
  type: 'evm',
  icon: '/chains/base.svg',
  rpcUrl: process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org',
  explorerUrl: 'https://basescan.org',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  contracts: {
    USDC: process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    depositRouter: process.env.NEXT_PUBLIC_BASE_DEPOSIT_ROUTER_ADDRESS || '',
    wormholeBridge: process.env.NEXT_PUBLIC_BASE_WORMHOLE_ADDRESS || '',
  },
  isTreasuryChain: false,
  depositsEnabled: true,
  isTestnet: false,
  blockTime: 2,
  finalityTime: 60,
};

export const BASE_SEPOLIA: ChainConfig = {
  id: 'base-sepolia',
  chainId: 84532,
  name: 'Base Sepolia',
  shortName: 'BSEP',
  type: 'evm',
  icon: '/chains/base.svg',
  rpcUrl: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  explorerUrl: 'https://sepolia.basescan.org',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  contracts: {
    USDC: process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC_ADDRESS || '',
    depositRouter: process.env.NEXT_PUBLIC_BASE_SEPOLIA_DEPOSIT_ROUTER_ADDRESS || '',
  },
  isTreasuryChain: false,
  depositsEnabled: true,
  isTestnet: true,
  blockTime: 2,
  finalityTime: 60,
};

export const ARBITRUM_ONE: ChainConfig = {
  id: 'arbitrum',
  chainId: 42161,
  name: 'Arbitrum One',
  shortName: 'ARB',
  type: 'evm',
  icon: '/chains/arbitrum.svg',
  rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  explorerUrl: 'https://arbiscan.io',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  contracts: {
    USDC: process.env.NEXT_PUBLIC_ARBITRUM_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    depositRouter: process.env.NEXT_PUBLIC_ARBITRUM_DEPOSIT_ROUTER_ADDRESS || '',
    wormholeBridge: process.env.NEXT_PUBLIC_ARBITRUM_WORMHOLE_ADDRESS || '',
  },
  isTreasuryChain: false,
  depositsEnabled: true,
  isTestnet: false,
  blockTime: 0.25,
  finalityTime: 900, // ~15 min for L1 finality
};

export const ARBITRUM_SEPOLIA: ChainConfig = {
  id: 'arbitrum-sepolia',
  chainId: 421614,
  name: 'Arbitrum Sepolia',
  shortName: 'ASEP',
  type: 'evm',
  icon: '/chains/arbitrum.svg',
  rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
  explorerUrl: 'https://sepolia.arbiscan.io',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  contracts: {
    USDC: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_USDC_ADDRESS || '',
    depositRouter: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_DEPOSIT_ROUTER_ADDRESS || '',
  },
  isTreasuryChain: false,
  depositsEnabled: true,
  isTestnet: true,
  blockTime: 0.25,
  finalityTime: 180,
};

export const SOLANA_MAINNET: ChainConfig = {
  id: 'solana',
  chainId: 'solana-mainnet',
  name: 'Solana',
  shortName: 'SOL',
  type: 'solana',
  icon: '/chains/solana.svg',
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  explorerUrl: 'https://solscan.io',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  contracts: {
    USDC: process.env.NEXT_PUBLIC_SOLANA_USDC_ADDRESS || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    depositRouter: process.env.NEXT_PUBLIC_SOLANA_DEPOSIT_ROUTER_ADDRESS || '',
    wormholeBridge: process.env.NEXT_PUBLIC_SOLANA_WORMHOLE_ADDRESS || 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
  },
  isTreasuryChain: false,
  depositsEnabled: true,
  isTestnet: false,
  blockTime: 0.4,
  finalityTime: 30,
};

export const SOLANA_DEVNET: ChainConfig = {
  id: 'solana-devnet',
  chainId: 'solana-devnet',
  name: 'Solana Devnet',
  shortName: 'SDEV',
  type: 'solana',
  icon: '/chains/solana.svg',
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com',
  explorerUrl: 'https://solscan.io?cluster=devnet',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  contracts: {
    USDC: process.env.NEXT_PUBLIC_SOLANA_DEVNET_USDC_ADDRESS || '',
    depositRouter: process.env.NEXT_PUBLIC_SOLANA_DEVNET_DEPOSIT_ROUTER_ADDRESS || '',
  },
  isTreasuryChain: false,
  depositsEnabled: true,
  isTestnet: true,
  blockTime: 0.4,
  finalityTime: 30,
};

// All supported chains
export const SUPPORTED_CHAINS: ChainConfig[] = [
  ETHEREUM_MAINNET,
  BASE_MAINNET,
  ARBITRUM_ONE,
  SOLANA_MAINNET,
];

// Testnet chains
export const TESTNET_CHAINS: ChainConfig[] = [
  ETHEREUM_SEPOLIA,
  BASE_SEPOLIA,
  ARBITRUM_SEPOLIA,
  SOLANA_DEVNET,
];

// Get all chains based on environment
export function getAllChains(): ChainConfig[] {
  const isTestnet = process.env.NEXT_PUBLIC_USE_TESTNET === 'true';
  return isTestnet ? TESTNET_CHAINS : SUPPORTED_CHAINS;
}

// Get chain by ID
export function getChainById(id: string): ChainConfig | undefined {
  return [...SUPPORTED_CHAINS, ...TESTNET_CHAINS].find(c => c.id === id);
}

// Get chain by chainId (EVM)
export function getChainByChainId(chainId: number): ChainConfig | undefined {
  return [...SUPPORTED_CHAINS, ...TESTNET_CHAINS].find(
    c => c.type === 'evm' && c.chainId === chainId
  );
}

// Get the treasury chain
export function getTreasuryChain(): ChainConfig {
  const isTestnet = process.env.NEXT_PUBLIC_USE_TESTNET === 'true';
  return isTestnet ? ETHEREUM_SEPOLIA : ETHEREUM_MAINNET;
}

// Get EVM chains only
export function getEVMChains(): ChainConfig[] {
  return getAllChains().filter(c => c.type === 'evm');
}

// Get Solana chains
export function getSolanaChains(): ChainConfig[] {
  return getAllChains().filter(c => c.type === 'solana');
}

// Check if chain requires bridging to treasury
export function requiresBridging(chain: ChainConfig): boolean {
  return !chain.isTreasuryChain;
}

// Estimate bridging time from source chain to treasury
export function estimateBridgeTime(sourceChain: ChainConfig): number {
  if (sourceChain.isTreasuryChain) return 0;
  
  // Base estimate: source finality + bridge processing + ETH confirmation
  const bridgeProcessing = 300; // 5 minutes for bridge relayers
  const ethConfirmation = 900; // 15 minutes for ETH finality
  
  return sourceChain.finalityTime + bridgeProcessing + ethConfirmation;
}

// Format bridge time for display
export function formatBridgeTime(seconds: number): string {
  if (seconds === 0) return 'Instant';
  if (seconds < 60) return `~${seconds}s`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
  return `~${(seconds / 3600).toFixed(1)} hr`;
}

// Chain-specific USDC decimals (native USDC is 6 on all chains)
export const USDC_DECIMALS_BY_CHAIN: Record<string, number> = {
  ethereum: 6,
  sepolia: 6,
  base: 6,
  'base-sepolia': 6,
  arbitrum: 6,
  'arbitrum-sepolia': 6,
  solana: 6,
  'solana-devnet': 6,
};

// Get USDC decimals for a chain
export function getUSDCDecimals(chainId: string): number {
  return USDC_DECIMALS_BY_CHAIN[chainId] ?? 6;
}

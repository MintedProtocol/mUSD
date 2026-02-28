// Wallet Hooks
export { WalletConnectProvider, useWalletConnect } from './useWalletConnect';
export { MetaMaskProvider, useMetaMask } from './useMetaMask';
export { UnifiedWalletProvider, useUnifiedWallet } from './useUnifiedWallet';
export { LoopWalletProvider, useLoopWallet } from './useLoopWallet';
export { EthWalletProvider, useEthWallet } from './useEthWallet';

// Contract Hooks
export { useWCContracts, useWCContract } from './useWCContracts';
export { useEthContracts, useEthContract } from './useEthContracts';

// Legacy hooks (for compatibility)
export { useWallet } from './useWallet';
export { useContracts, useContract } from './useContract';
export { useCanton } from './useCanton';

// UI Hooks
export { useTx } from './useTx';
export { useChainState } from './useChain';

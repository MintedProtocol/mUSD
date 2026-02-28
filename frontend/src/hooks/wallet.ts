// Wallet Hooks - unified exports
export { EthWalletProvider, useEthWallet } from './useEthWallet';
export type { EthWalletContextType, ConnectedChain } from './useEthWallet';

export { LoopWalletProvider, useLoopWallet } from './useLoopWallet';
export type { 
  LoopWalletContextType, 
  LoopAccount, 
  LoopHolding, 
  LoopContract,
  LoopProvider 
} from './useLoopWallet';

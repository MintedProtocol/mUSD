import { useState, useCallback, createContext, useContext, ReactNode } from 'react';
import { ethers, BrowserProvider, Signer, Contract } from 'ethers';
import { useWalletConnect, WalletConnectContextType } from './useWalletConnect';
import { useMetaMask, MetaMaskContextType } from './useMetaMask';

// Wallet connection types
export type WalletType = 'metamask' | 'walletconnect' | 'browser' | null;

interface UnifiedWalletContextType {
  // Active wallet
  activeWallet: WalletType;
  
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  
  // Account info
  address: string | null;
  ensName: string | null;
  
  // Chain info
  chainId: number | null;
  chainName: string | null;
  
  // Balances
  ethBalance: string;
  refreshBalance: () => Promise<void>;
  
  // Connection actions
  connectMetaMask: () => Promise<void>;
  connectWalletConnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  
  // Chain switching
  switchChain: (chainId: number) => Promise<void>;
  
  // Contract interactions
  getContract: (address: string, abi: ethers.InterfaceAbi) => Contract | null;
  readContract: <T>(address: string, abi: ethers.InterfaceAbi, method: string, args?: unknown[]) => Promise<T>;
  writeContract: (address: string, abi: ethers.InterfaceAbi, method: string, args?: unknown[]) => Promise<ethers.TransactionResponse>;
  
  // Provider/Signer access
  provider: BrowserProvider | null;
  signer: Signer | null;
  
  // Wallet capabilities
  isMetaMaskInstalled: boolean;
  isMobile: boolean;
  
  // Error handling
  error: string | null;
}

const UnifiedWalletContext = createContext<UnifiedWalletContextType | null>(null);

interface UnifiedWalletProviderProps {
  children: ReactNode;
}

export function UnifiedWalletProvider({ children }: UnifiedWalletProviderProps) {
  const [activeWallet, setActiveWallet] = useState<WalletType>(null);
  
  // Get both wallet contexts
  const walletConnect = useWalletConnect();
  const metamask = useMetaMask();
  
  // Determine which wallet is active
  const isMetaMaskActive = activeWallet === 'metamask' && metamask.isConnected;
  const isWalletConnectActive = activeWallet === 'walletconnect' && walletConnect.isConnected;
  
  // Unified state based on active wallet
  const isConnected = isMetaMaskActive || isWalletConnectActive;
  const isConnecting = metamask.isConnecting || walletConnect.isConnecting;
  
  const address = isMetaMaskActive 
    ? metamask.address 
    : isWalletConnectActive 
      ? walletConnect.address 
      : null;
      
  const ensName = isMetaMaskActive 
    ? metamask.ensName 
    : isWalletConnectActive 
      ? walletConnect.ensName 
      : null;
      
  const chainId = isMetaMaskActive 
    ? metamask.chainId 
    : isWalletConnectActive 
      ? walletConnect.chainId 
      : null;
      
  const chainName = isMetaMaskActive 
    ? metamask.chain?.name || null
    : isWalletConnectActive 
      ? walletConnect.chain?.name || null
      : null;
      
  const ethBalance = isMetaMaskActive 
    ? metamask.ethBalance 
    : isWalletConnectActive 
      ? walletConnect.ethBalance 
      : '0';
      
  const provider = isMetaMaskActive 
    ? metamask.provider 
    : isWalletConnectActive 
      ? walletConnect.provider 
      : null;
      
  const signer = isMetaMaskActive 
    ? metamask.signer 
    : isWalletConnectActive 
      ? walletConnect.signer 
      : null;
      
  const error = isMetaMaskActive 
    ? metamask.error 
    : isWalletConnectActive 
      ? walletConnect.error 
      : null;

  // Connect via MetaMask
  const connectMetaMask = useCallback(async () => {
    // Disconnect other wallet first if connected
    if (walletConnect.isConnected) {
      await walletConnect.disconnect();
    }
    
    await metamask.connect();
    setActiveWallet('metamask');
  }, [metamask, walletConnect]);

  // Connect via WalletConnect
  const connectWalletConnect = useCallback(async () => {
    // Disconnect other wallet first if connected
    if (metamask.isConnected) {
      metamask.disconnect();
    }
    
    await walletConnect.connect();
    setActiveWallet('walletconnect');
  }, [walletConnect, metamask]);

  // Disconnect current wallet
  const disconnect = useCallback(async () => {
    if (isMetaMaskActive) {
      metamask.disconnect();
    } else if (isWalletConnectActive) {
      await walletConnect.disconnect();
    }
    setActiveWallet(null);
  }, [isMetaMaskActive, isWalletConnectActive, metamask, walletConnect]);

  // Switch chain on active wallet
  const switchChain = useCallback(async (targetChainId: number) => {
    if (isMetaMaskActive) {
      await metamask.switchChain(targetChainId);
    } else if (isWalletConnectActive) {
      await walletConnect.switchChain(targetChainId);
    } else {
      throw new Error('No wallet connected');
    }
  }, [isMetaMaskActive, isWalletConnectActive, metamask, walletConnect]);

  // Refresh balance on active wallet
  const refreshBalance = useCallback(async () => {
    if (isMetaMaskActive) {
      await metamask.refreshBalance();
    } else if (isWalletConnectActive) {
      await walletConnect.refreshBalance();
    }
  }, [isMetaMaskActive, isWalletConnectActive, metamask, walletConnect]);

  // Get contract from active wallet
  const getContract = useCallback((contractAddress: string, abi: ethers.InterfaceAbi): Contract | null => {
    if (isMetaMaskActive) {
      return metamask.getContract(contractAddress, abi);
    } else if (isWalletConnectActive) {
      return walletConnect.getContract(contractAddress, abi);
    }
    return null;
  }, [isMetaMaskActive, isWalletConnectActive, metamask, walletConnect]);

  // Read contract via active wallet
  const readContract = useCallback(async <T,>(
    contractAddress: string,
    abi: ethers.InterfaceAbi,
    method: string,
    args: unknown[] = []
  ): Promise<T> => {
    if (isMetaMaskActive) {
      return metamask.readContract<T>(contractAddress, abi, method, args);
    } else if (isWalletConnectActive) {
      return walletConnect.readContract<T>(contractAddress, abi, method, args);
    }
    throw new Error('No wallet connected');
  }, [isMetaMaskActive, isWalletConnectActive, metamask, walletConnect]);

  // Write contract via active wallet
  const writeContract = useCallback(async (
    contractAddress: string,
    abi: ethers.InterfaceAbi,
    method: string,
    args: unknown[] = []
  ): Promise<ethers.TransactionResponse> => {
    if (isMetaMaskActive) {
      return metamask.writeContract(contractAddress, abi, method, args);
    } else if (isWalletConnectActive) {
      return walletConnect.writeContract(contractAddress, abi, method, args);
    }
    throw new Error('No wallet connected');
  }, [isMetaMaskActive, isWalletConnectActive, metamask, walletConnect]);

  const value: UnifiedWalletContextType = {
    activeWallet,
    isConnected,
    isConnecting,
    address,
    ensName,
    chainId,
    chainName,
    ethBalance,
    refreshBalance,
    connectMetaMask,
    connectWalletConnect,
    disconnect,
    switchChain,
    getContract,
    readContract,
    writeContract,
    provider,
    signer,
    isMetaMaskInstalled: metamask.isMetaMaskInstalled,
    isMobile: metamask.isMobile,
    error,
  };

  return (
    <UnifiedWalletContext.Provider value={value}>
      {children}
    </UnifiedWalletContext.Provider>
  );
}

export function useUnifiedWallet(): UnifiedWalletContextType {
  const context = useContext(UnifiedWalletContext);
  if (!context) {
    throw new Error('useUnifiedWallet must be used within UnifiedWalletProvider');
  }
  return context;
}

// Re-export types
export type { UnifiedWalletContextType };

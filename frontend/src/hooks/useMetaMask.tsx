import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { ethers, BrowserProvider, Signer, Contract, formatUnits } from 'ethers';
import { MetaMaskSDK, SDKProvider } from '@metamask/sdk';
import { getMetaMaskSDK, isMetaMaskInstalled, isMobile } from '@/lib/metamask';

// Types
interface ConnectedChain {
  id: number;
  name: string;
  unsupported: boolean;
}

// Supported chains
const SUPPORTED_CHAINS: Record<number, string> = {
  1: 'Ethereum Mainnet',
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  8453: 'Base',
  31337: 'Hardhat Local',
  59144: 'Linea Mainnet',
  59141: 'Linea Sepolia',
};

interface MetaMaskContextType {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  isMetaMaskInstalled: boolean;
  isMobile: boolean;
  
  // Account info
  address: string | null;
  ensName: string | null;
  
  // Chain info
  chainId: number | null;
  chain: ConnectedChain | null;
  
  // Balances
  ethBalance: string;
  refreshBalance: () => Promise<void>;
  
  // Actions
  connect: () => Promise<void>;
  connectAndSign: (message: string) => Promise<string | null>;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
  
  // Contract interactions
  getContract: (address: string, abi: ethers.InterfaceAbi) => Contract | null;
  readContract: <T>(address: string, abi: ethers.InterfaceAbi, method: string, args?: unknown[]) => Promise<T>;
  writeContract: (address: string, abi: ethers.InterfaceAbi, method: string, args?: unknown[]) => Promise<ethers.TransactionResponse>;
  
  // Provider/Signer access
  provider: BrowserProvider | null;
  signer: Signer | null;
  sdk: MetaMaskSDK | null;
  
  // Error handling
  error: string | null;
}

const MetaMaskContext = createContext<MetaMaskContextType | null>(null);

interface MetaMaskProviderProps {
  children: ReactNode;
}

export function MetaMaskProvider({ children }: MetaMaskProviderProps) {
  // SDK and provider state
  const [sdk, setSdk] = useState<MetaMaskSDK | null>(null);
  const [sdkProvider, setSdkProvider] = useState<SDKProvider | null>(null);
  
  // Wallet state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [ensName, setEnsName] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState('0');
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Defer browser-only checks to avoid SSR hydration mismatch
  const [installed, setInstalled] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    setInstalled(isMetaMaskInstalled());
    setMobile(isMobile());
  }, []);
  
  const chain: ConnectedChain | null = chainId
    ? {
        id: chainId,
        name: SUPPORTED_CHAINS[chainId] || `Unknown (${chainId})`,
        unsupported: !SUPPORTED_CHAINS[chainId],
      }
    : null;

  // Initialize MetaMask SDK
  useEffect(() => {
    const initSDK = async () => {
      try {
        const metamaskSDK = getMetaMaskSDK();
        setSdk(metamaskSDK);
        
        // Get the provider
        const mmProvider = metamaskSDK.getProvider();
        if (mmProvider) {
          setSdkProvider(mmProvider);
          
          // Check if already connected
          try {
            const accounts = await mmProvider.request({ method: 'eth_accounts' }) as string[];
            if (accounts && accounts.length > 0) {
              await handleAccountsChanged(accounts, mmProvider);
            }
          } catch (err) {
            console.error('[MetaMask] Failed to check existing connection:', err);
          }
        }
      } catch (err) {
        console.error('[MetaMask] SDK init failed:', err);
      }
    };

    initSDK();
  }, []);

  // Handle accounts changed
  const handleAccountsChanged = useCallback(async (accounts: string[], mmProvider?: SDKProvider) => {
    const activeProvider = mmProvider || sdkProvider;
    if (!activeProvider) return;

    if (accounts.length === 0) {
      setIsConnected(false);
      setAddress(null);
      setChainId(null);
      setProvider(null);
      setSigner(null);
      setEthBalance('0');
      return;
    }

    const account = accounts[0];
    setAddress(account);
    setIsConnected(true);
    
    // Create ethers provider
    const ethersProvider = new BrowserProvider(activeProvider as any);
    setProvider(ethersProvider);
    
    // Get signer
    try {
      const ethersSigner = await ethersProvider.getSigner();
      setSigner(ethersSigner);
    } catch (err) {
      console.error('[MetaMask] Failed to get signer:', err);
    }

    // Get chain ID
    try {
      const chainIdHex = await activeProvider.request({ method: 'eth_chainId' }) as string;
      const currentChainId = parseInt(chainIdHex, 16);
      setChainId(currentChainId);

      // Try ENS on mainnet
      if (currentChainId === 1) {
        try {
          const name = await ethersProvider.lookupAddress(account);
          setEnsName(name);
        } catch {}
      }
    } catch (err) {
      console.error('[MetaMask] Failed to get chain ID:', err);
    }

    // Get balance
    try {
      const balance = await ethersProvider.getBalance(account);
      setEthBalance(formatUnits(balance, 18));
    } catch (err) {
      console.error('[MetaMask] Failed to get balance:', err);
    }
  }, [sdkProvider]);

  // Setup event listeners
  useEffect(() => {
    if (!sdkProvider) return;

    const handleChainChanged = (chainIdHex: string) => {
      const newChainId = parseInt(chainIdHex, 16);
      setChainId(newChainId);
      // Refresh provider on chain change
      const ethersProvider = new BrowserProvider(sdkProvider as any);
      setProvider(ethersProvider);
      ethersProvider.getSigner().then(setSigner).catch(console.error);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
      setAddress(null);
      setChainId(null);
      setProvider(null);
      setSigner(null);
      setEthBalance('0');
    };

    sdkProvider.on('accountsChanged', ((accounts: string[]) => handleAccountsChanged(accounts)) as (...args: unknown[]) => void);
    sdkProvider.on('chainChanged', handleChainChanged as (...args: unknown[]) => void);
    sdkProvider.on('disconnect', handleDisconnect as (...args: unknown[]) => void);

    return () => {
      sdkProvider.removeListener('accountsChanged', handleAccountsChanged as any);
      sdkProvider.removeListener('chainChanged', handleChainChanged);
      sdkProvider.removeListener('disconnect', handleDisconnect);
    };
  }, [sdkProvider, handleAccountsChanged]);

  // Connect wallet
  const connect = useCallback(async () => {
    if (!sdk) {
      setError('MetaMask SDK not initialized');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await sdk.connect();
      if (accounts && accounts.length > 0) {
        const mmProvider = sdk.getProvider();
        if (mmProvider) {
          setSdkProvider(mmProvider);
          await handleAccountsChanged(accounts, mmProvider);
        }
      }
    } catch (err: any) {
      console.error('[MetaMask] Connect failed:', err);
      setError(err.message || 'Failed to connect to MetaMask');
    } finally {
      setIsConnecting(false);
    }
  }, [sdk, handleAccountsChanged]);

  // Connect and sign message
  const connectAndSign = useCallback(async (message: string): Promise<string | null> => {
    if (!sdk) {
      setError('MetaMask SDK not initialized');
      return null;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const result = await sdk.connectAndSign({ msg: message });
      
      // Also update connection state
      const mmProvider = sdk.getProvider();
      if (mmProvider) {
        setSdkProvider(mmProvider);
        const accounts = await mmProvider.request({ method: 'eth_accounts' }) as string[];
        if (accounts && accounts.length > 0) {
          await handleAccountsChanged(accounts, mmProvider);
        }
      }
      
      return result as string;
    } catch (err: any) {
      console.error('[MetaMask] ConnectAndSign failed:', err);
      setError(err.message || 'Failed to connect and sign');
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [sdk, handleAccountsChanged]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (sdk) {
      sdk.terminate();
    }
    setIsConnected(false);
    setAddress(null);
    setChainId(null);
    setProvider(null);
    setSigner(null);
    setEthBalance('0');
    setEnsName(null);
  }, [sdk]);

  // Refresh balance
  const refreshBalance = useCallback(async () => {
    if (!provider || !address) return;
    try {
      const balance = await provider.getBalance(address);
      setEthBalance(formatUnits(balance, 18));
    } catch (err) {
      console.error('[MetaMask] Failed to refresh balance:', err);
    }
  }, [provider, address]);

  // Switch chain
  const switchChain = useCallback(async (targetChainId: number) => {
    if (!sdkProvider) throw new Error('Not connected');
    
    const hexChainId = `0x${targetChainId.toString(16)}`;
    
    try {
      await sdkProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (err: any) {
      // Chain not added, try to add it
      if (err.code === 4902) {
        // You would need chain config here
        throw new Error(`Chain ${targetChainId} not configured in wallet`);
      }
      throw err;
    }
  }, [sdkProvider]);

  // Get contract instance
  const getContract = useCallback((contractAddress: string, abi: ethers.InterfaceAbi): Contract | null => {
    if (!signer) return null;
    return new Contract(contractAddress, abi, signer);
  }, [signer]);

  // Read contract
  const readContract = useCallback(async <T,>(
    contractAddress: string,
    abi: ethers.InterfaceAbi,
    method: string,
    args: unknown[] = []
  ): Promise<T> => {
    if (!provider) throw new Error('Not connected');
    const contract = new Contract(contractAddress, abi, provider);
    return contract[method](...args);
  }, [provider]);

  // Write contract
  const writeContract = useCallback(async (
    contractAddress: string,
    abi: ethers.InterfaceAbi,
    method: string,
    args: unknown[] = []
  ): Promise<ethers.TransactionResponse> => {
    if (!signer) throw new Error('Not connected');
    const contract = new Contract(contractAddress, abi, signer);
    return contract[method](...args);
  }, [signer]);

  // Refresh balance on address/chain changes
  useEffect(() => {
    if (provider && address) {
      refreshBalance();
    }
  }, [provider, address, chainId, refreshBalance]);

  const value: MetaMaskContextType = {
    isConnected,
    isConnecting,
    isMetaMaskInstalled: installed,
    isMobile: mobile,
    address,
    ensName,
    chainId,
    chain,
    ethBalance,
    refreshBalance,
    connect,
    connectAndSign,
    disconnect,
    switchChain,
    getContract,
    readContract,
    writeContract,
    provider,
    signer,
    sdk,
    error,
  };

  return (
    <MetaMaskContext.Provider value={value}>
      {children}
    </MetaMaskContext.Provider>
  );
}

export function useMetaMask(): MetaMaskContextType {
  const context = useContext(MetaMaskContext);
  if (!context) {
    throw new Error('useMetaMask must be used within a MetaMaskProvider');
  }
  return context;
}

// Re-export types
export type { ConnectedChain, MetaMaskContextType };

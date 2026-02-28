import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { ethers, BrowserProvider, Signer, Contract, formatUnits } from 'ethers';
import { UniversalConnector } from '@reown/appkit-universal-connector';
import { getUniversalConnector, projectId, getNetworkById } from '@/lib/walletconnect';

// Types
interface ConnectedChain {
  id: number;
  name: string;
  unsupported: boolean;
}

interface WalletConnectContextType {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  
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
  disconnect: () => Promise<void>;
  switchChain: (chainId: number) => Promise<void>;
  
  // Contract interactions
  getContract: (address: string, abi: ethers.InterfaceAbi) => Contract | null;
  readContract: <T>(address: string, abi: ethers.InterfaceAbi, method: string, args?: unknown[]) => Promise<T>;
  writeContract: (address: string, abi: ethers.InterfaceAbi, method: string, args?: unknown[]) => Promise<ethers.TransactionResponse>;
  
  // Provider/Signer access
  provider: BrowserProvider | null;
  signer: Signer | null;
  
  // WalletConnect specific
  connector: UniversalConnector | null;
  session: any;
  
  // Error handling
  error: string | null;
}

const WalletConnectContext = createContext<WalletConnectContextType | null>(null);

interface WalletConnectProviderProps {
  children: ReactNode;
  autoConnect?: boolean;
}

export function WalletConnectProvider({ 
  children,
  autoConnect = true,
}: WalletConnectProviderProps) {
  // WalletConnect state
  const [connector, setConnector] = useState<UniversalConnector | null>(null);
  const [session, setSession] = useState<any>(null);
  
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

  // Get chain info
  const chain: ConnectedChain | null = chainId
    ? {
        id: chainId,
        name: getNetworkById(chainId)?.name || `Unknown (${chainId})`,
        unsupported: !getNetworkById(chainId),
      }
    : null;

  // Initialize WalletConnect connector
  useEffect(() => {
    if (!projectId) {
      console.warn('[WalletConnect] No project ID - wallet connection disabled');
      return;
    }

    const initConnector = async () => {
      try {
        const wc = await getUniversalConnector();
        setConnector(wc);
        
        // Check for existing session
        if (wc.provider?.session) {
          setSession(wc.provider.session);
          await handleSessionConnected(wc);
        }
      } catch (err) {
        console.error('[WalletConnect] Failed to initialize:', err);
      }
    };

    initConnector();
  }, []);

  // Handle session connection
  const handleSessionConnected = async (wc: UniversalConnector) => {
    try {
      const wcProvider = wc.provider;
      if (!wcProvider?.session) return;

      // Get accounts from session
      const accounts = wcProvider.session.namespaces?.eip155?.accounts || [];
      if (accounts.length === 0) return;

      // Parse account (format: "eip155:1:0x...")
      const [, chainPart, accountAddress] = accounts[0].split(':');
      const connectedChainId = parseInt(chainPart, 10);
      
      // Create ethers provider from WalletConnect provider
      const ethersProvider = new BrowserProvider(wcProvider as any);
      const ethersSigner = await ethersProvider.getSigner();
      
      setProvider(ethersProvider);
      setSigner(ethersSigner);
      setAddress(accountAddress);
      setChainId(connectedChainId);
      setIsConnected(true);
      setError(null);
      
      // Try to resolve ENS name on mainnet
      if (connectedChainId === 1) {
        try {
          const name = await ethersProvider.lookupAddress(accountAddress);
          setEnsName(name);
        } catch {
          // ENS not available
        }
      }
      
      // Get balance
      const balance = await ethersProvider.getBalance(accountAddress);
      setEthBalance(formatUnits(balance, 18));
    } catch (err) {
      console.error('[WalletConnect] Session connect error:', err);
    }
  };

  // Connect wallet via WalletConnect modal
  const connect = useCallback(async () => {
    if (!connector) {
      // Fallback to browser wallet if WalletConnect not available
      if (typeof window !== 'undefined' && window.ethereum) {
        await connectBrowserWallet();
        return;
      }
      setError('No wallet connection method available');
      return;
    }

    setIsConnecting(true);
    setError(null);
    
    try {
      const { session: newSession } = await connector.connect();
      setSession(newSession);
      await handleSessionConnected(connector);
    } catch (err: any) {
      console.error('[WalletConnect] Connect failed:', err);
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [connector]);

  // Fallback browser wallet connection (MetaMask, etc.)
  const connectBrowserWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('No Ethereum wallet found. Please install MetaMask.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const browserProvider = new BrowserProvider(window.ethereum);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const account = accounts[0];
      const signerInstance = await browserProvider.getSigner();
      const network = await browserProvider.getNetwork();
      const currentChainId = Number(network.chainId);
      
      setProvider(browserProvider);
      setSigner(signerInstance);
      setAddress(account);
      setChainId(currentChainId);
      setIsConnected(true);
      setError(null);
      
      // Get balance
      const balance = await browserProvider.getBalance(account);
      setEthBalance(formatUnits(balance, 18));
      
      // Try ENS on mainnet
      if (currentChainId === 1) {
        try {
          const name = await browserProvider.lookupAddress(account);
          setEnsName(name);
        } catch {}
      }
    } catch (err: any) {
      console.error('[BrowserWallet] Connect failed:', err);
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect wallet
  const disconnect = useCallback(async () => {
    try {
      if (connector) {
        await connector.disconnect();
      }
    } catch (err) {
      console.error('[WalletConnect] Disconnect error:', err);
    }
    
    setProvider(null);
    setSigner(null);
    setAddress(null);
    setEnsName(null);
    setChainId(null);
    setEthBalance('0');
    setIsConnected(false);
    setSession(null);
  }, [connector]);

  // Refresh balance
  const refreshBalance = useCallback(async () => {
    if (!provider || !address) return;
    try {
      const balance = await provider.getBalance(address);
      setEthBalance(formatUnits(balance, 18));
    } catch (err) {
      console.error('[WalletConnect] Failed to get balance:', err);
    }
  }, [provider, address]);

  // Switch chain
  const switchChain = useCallback(async (targetChainId: number) => {
    const hexChainId = `0x${targetChainId.toString(16)}`;
    
    if (connector?.provider) {
      try {
        await connector.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        });
        setChainId(targetChainId);
      } catch (err: any) {
        // Chain not added, try to add it
        if (err.code === 4902) {
          const network = getNetworkById(targetChainId);
          if (network) {
            await connector.provider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: hexChainId,
                chainName: network.name,
                rpcUrls: [network.rpcUrls.default.http[0]],
                nativeCurrency: network.nativeCurrency,
              }],
            });
          }
        } else {
          throw err;
        }
      }
    } else if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        });
        setChainId(targetChainId);
      } catch (err: any) {
        if (err.code === 4902) {
          const network = getNetworkById(targetChainId);
          if (network) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: hexChainId,
                chainName: network.name,
                rpcUrls: [network.rpcUrls.default.http[0]],
                nativeCurrency: network.nativeCurrency,
              }],
            });
          }
        } else {
          throw err;
        }
      }
    }
  }, [connector]);

  // Get contract instance
  const getContract = useCallback((contractAddress: string, abi: ethers.InterfaceAbi): Contract | null => {
    if (!signer) return null;
    return new Contract(contractAddress, abi, signer);
  }, [signer]);

  // Read contract (view function)
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

  // Write contract (transaction)
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

  // Listen for browser wallet changes (when using fallback)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum || connector) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else if (accounts[0] !== address) {
        setAddress(accounts[0]);
      }
    };

    const handleChainChanged = (chainIdHex: string) => {
      const newChainId = parseInt(chainIdHex, 16);
      setChainId(newChainId);
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [address, connector, disconnect]);

  // Refresh balance when address/chain changes
  useEffect(() => {
    if (provider && address) {
      refreshBalance();
    }
  }, [provider, address, chainId, refreshBalance]);

  const value: WalletConnectContextType = {
    isConnected,
    isConnecting,
    address,
    ensName,
    chainId,
    chain,
    ethBalance,
    refreshBalance,
    connect,
    disconnect,
    switchChain,
    getContract,
    readContract,
    writeContract,
    provider,
    signer,
    connector,
    session,
    error,
  };

  return (
    <WalletConnectContext.Provider value={value}>
      {children}
    </WalletConnectContext.Provider>
  );
}

export function useWalletConnect(): WalletConnectContextType {
  const context = useContext(WalletConnectContext);
  if (!context) {
    throw new Error('useWalletConnect must be used within a WalletConnectProvider');
  }
  return context;
}

// Re-export types
export type { ConnectedChain, WalletConnectContextType };

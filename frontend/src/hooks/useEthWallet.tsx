import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { ethers, BrowserProvider, Signer, Contract, parseUnits, formatUnits } from 'ethers';

// Types
interface ConnectedChain {
  id: number;
  name: string;
  unsupported: boolean;
}

interface EthWalletContextType {
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
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
  
  // Contract interactions
  getContract: (address: string, abi: any[]) => Contract | null;
  readContract: <T>(address: string, abi: any[], method: string, args?: any[]) => Promise<T>;
  writeContract: (address: string, abi: any[], method: string, args?: any[]) => Promise<ethers.TransactionResponse>;
  
  // Provider/Signer access
  provider: BrowserProvider | null;
  signer: Signer | null;
  
  // Error handling
  error: string | null;
}

const EthWalletContext = createContext<EthWalletContextType | null>(null);

// Supported chains configuration
const SUPPORTED_CHAINS: Record<number, { name: string; rpcUrl: string }> = {
  1: { name: 'Ethereum Mainnet', rpcUrl: 'https://eth.llamarpc.com' },
  11155111: { name: 'Sepolia Testnet', rpcUrl: 'https://rpc.sepolia.org' },
  84532: { name: 'Base Sepolia', rpcUrl: 'https://sepolia.base.org' },
  8453: { name: 'Base', rpcUrl: 'https://mainnet.base.org' },
  31337: { name: 'Hardhat Local', rpcUrl: 'http://127.0.0.1:8545' },
};

interface EthWalletProviderProps {
  children: ReactNode;
  defaultChainId?: number;
  onAccountChange?: (address: string | null) => void;
  onChainChange?: (chainId: number) => void;
}

export function EthWalletProvider({ 
  children,
  defaultChainId = 11155111, // Sepolia by default
  onAccountChange,
  onChainChange,
}: EthWalletProviderProps) {
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
        name: SUPPORTED_CHAINS[chainId]?.name || `Unknown (${chainId})`,
        unsupported: !SUPPORTED_CHAINS[chainId],
      }
    : null;

  // Initialize on mount - check if already connected
  useEffect(() => {
    const checkConnection = async () => {
      if (typeof window === 'undefined' || !window.ethereum) return;
      // Guard against MetaMask SDK shim returning non-provider strings
      if (typeof window.ethereum !== 'object' || typeof window.ethereum.request !== 'function') return;
      try {
        const rawChainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (typeof rawChainId !== 'string' || !rawChainId.startsWith('0x')) return;
      } catch { return; }

      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          await handleConnect();
        }
      } catch (err) {
        console.error('[EthWallet] Failed to check connection:', err);
      }
    };

    checkConnection();
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else if (accounts[0] !== address) {
        setAddress(accounts[0]);
        onAccountChange?.(accounts[0]);
      }
    };

    const handleChainChanged = (chainIdHex: string) => {
      if (typeof chainIdHex !== 'string' || !chainIdHex.startsWith('0x')) return;
      const newChainId = parseInt(chainIdHex, 16);
      setChainId(newChainId);
      onChainChange?.(newChainId);
      // Reload provider with new chain
      if (window.ethereum && typeof window.ethereum === 'object' && typeof window.ethereum.request === 'function') {
        const newProvider = new BrowserProvider(window.ethereum);
        setProvider(newProvider);
        newProvider.getSigner().then(setSigner).catch(console.error);
      }
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [address, onAccountChange, onChainChange]);

  // Refresh balance when address or chain changes
  useEffect(() => {
    if (provider && address) {
      refreshBalance();
    }
  }, [provider, address, chainId]);

  const handleConnect = async () => {
    if (typeof window === 'undefined' || !window.ethereum ||
        typeof window.ethereum !== 'object' || typeof window.ethereum.request !== 'function') {
      setError('No Ethereum wallet found. Please install MetaMask.');
      return;
    }

    // Validate provider returns a real chain ID, not a MetaMask SDK redirect
    try {
      const rawChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (typeof rawChainId !== 'string' || !rawChainId.startsWith('0x')) {
        setError('Wallet provider is not ready. Please check MetaMask.');
        return;
      }
    } catch {
      setError('Wallet provider is not available.');
      return;
    }

    try {
      const browserProvider = new BrowserProvider(window.ethereum);
      
      // Request accounts
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const account = accounts[0];
      
      // Get signer and chain ID
      const signerInstance = await browserProvider.getSigner();
      const network = await browserProvider.getNetwork();
      const currentChainId = Number(network.chainId);
      
      setProvider(browserProvider);
      setSigner(signerInstance);
      setAddress(account);
      setChainId(currentChainId);
      setIsConnected(true);
      setError(null);
      
      // Try to resolve ENS
      try {
        if (currentChainId === 1) { // Only on mainnet
          const name = await browserProvider.lookupAddress(account);
          setEnsName(name);
        }
      } catch {
        // ENS not available or not found
      }
      
      onAccountChange?.(account);
      onChainChange?.(currentChainId);
    } catch (err: any) {
      console.error('[EthWallet] Connect failed:', err);
      setError(err.message || 'Failed to connect wallet');
    }
  };

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      await handleConnect();
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setAddress(null);
    setEnsName(null);
    setChainId(null);
    setEthBalance('0');
    setIsConnected(false);
    onAccountChange?.(null);
  }, [onAccountChange]);

  const refreshBalance = useCallback(async () => {
    if (!provider || !address) return;
    try {
      const balance = await provider.getBalance(address);
      setEthBalance(formatUnits(balance, 18));
    } catch (err) {
      console.error('[EthWallet] Failed to get balance:', err);
    }
  }, [provider, address]);

  const switchChain = useCallback(async (targetChainId: number) => {
    if (!window.ethereum) throw new Error('No wallet connected');
    
    const hexChainId = `0x${targetChainId.toString(16)}`;
    
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (switchError: any) {
      // If chain not added, try to add it
      if (switchError.code === 4902 && SUPPORTED_CHAINS[targetChainId]) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: hexChainId,
            chainName: SUPPORTED_CHAINS[targetChainId].name,
            rpcUrls: [SUPPORTED_CHAINS[targetChainId].rpcUrl],
          }],
        });
      } else {
        throw switchError;
      }
    }
  }, []);

  const getContract = useCallback((contractAddress: string, abi: any[]): Contract | null => {
    if (!signer) return null;
    return new Contract(contractAddress, abi, signer);
  }, [signer]);

  const readContract = useCallback(async <T,>(
    contractAddress: string,
    abi: any[],
    method: string,
    args: any[] = []
  ): Promise<T> => {
    if (!provider) throw new Error('Not connected');
    const contract = new Contract(contractAddress, abi, provider);
    // Validate method name against ABI to prevent arbitrary invocation
    // Supports both JSON ABI objects and human-readable string ABI entries
    const abiMethods = abi
      .map((item: any) => {
        if (typeof item === 'string') {
          // Human-readable: "function balanceOf(address) view returns (uint256)"
          const match = item.match(/^function\s+(\w+)\s*\(/);
          return match ? match[1] : null;
        }
        return item.type === 'function' ? item.name : null;
      })
      .filter(Boolean);
    if (!abiMethods.includes(method)) {
      throw new Error(`Method "${method}" not found in contract ABI`);
    }
    return contract[method](...args);
  }, [provider]);

  const writeContract = useCallback(async (
    contractAddress: string,
    abi: any[],
    method: string,
    args: any[] = []
  ): Promise<ethers.TransactionResponse> => {
    if (!signer) throw new Error('Not connected');
    // FIX: Validate chain ID before sending transactions
    if (chainId !== undefined && chainId !== null) {
      const { CHAIN_ID } = await import('@/lib/config');
      if (chainId !== CHAIN_ID) {
        throw new Error(`Wrong network. Expected chain ${CHAIN_ID}, got ${chainId}. Please switch networks.`);
      }
    }
    const contract = new Contract(contractAddress, abi, signer);
    // Validate method name against ABI to prevent arbitrary invocation
    // Supports both JSON ABI objects and human-readable string ABI entries
    const abiMethods = abi
      .map((item: any) => {
        if (typeof item === 'string') {
          const match = item.match(/^function\s+(\w+)\s*\(/);
          return match ? match[1] : null;
        }
        return item.type === 'function' ? item.name : null;
      })
      .filter(Boolean);
    if (!abiMethods.includes(method)) {
      throw new Error(`Method "${method}" not found in contract ABI`);
    }
    return contract[method](...args);
  }, [signer, chainId]);

  const value: EthWalletContextType = {
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
    error,
  };

  return (
    <EthWalletContext.Provider value={value}>
      {children}
    </EthWalletContext.Provider>
  );
}

export function useEthWallet(): EthWalletContextType {
  const context = useContext(EthWalletContext);
  if (!context) {
    throw new Error('useEthWallet must be used within an EthWalletProvider');
  }
  return context;
}

// Add ethereum types for window
declare global {
  interface Window {
    ethereum?: any;
  }
}

// Export types
export type { ConnectedChain, EthWalletContextType };

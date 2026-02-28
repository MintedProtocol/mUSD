/**
 * Multi-Chain Deposit Hook
 * 
 * Handles deposits from multiple chains (ETH, Base, Arbitrum, Solana)
 * and routes them to the main Ethereum Treasury.
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { ethers, BrowserProvider, Signer, Contract } from 'ethers';
import { 
  ChainConfig, 
  getAllChains, 
  getChainById, 
  getChainByChainId,
  getTreasuryChain,
  requiresBridging,
  estimateBridgeTime,
} from '@/lib/chains';
import { ERC20_ABI } from '@/abis/ERC20';

// Deposit Router ABI (simplified - deploy actual contract)
const DEPOSIT_ROUTER_ABI = [
  'function deposit(uint256 amount) external payable returns (uint64)',
  'function depositFor(address recipient, uint256 amount) external payable returns (uint64)',
  'function previewDeposit(uint256 amount) external view returns (uint256 netAmount, uint256 fee)',
  'function quoteBridgeCost() external view returns (uint256)',
  'function paused() external view returns (bool)',
  'event DepositInitiated(uint64 indexed sequence, address indexed depositor, address indexed recipient, uint256 grossAmount, uint256 netAmount, uint256 fee)',
  'event DepositCompleted(uint64 indexed sequence, bool success, bytes32 vaaHash)',
];

export interface DepositQuote {
  inputAmount: bigint;
  outputAmount: bigint;
  fee: bigint;
  feePercentage: number;
  bridgeTime: number;
  sourceChain: ChainConfig;
  destinationChain: ChainConfig;
}

export interface PendingDeposit {
  id: string;
  sourceChain: ChainConfig;
  amount: bigint;
  txHash: string;
  status: 'pending' | 'bridging' | 'completed' | 'failed';
  timestamp: number;
  bridgeMessageId?: string;
  estimatedCompletion?: number;
}

interface MultiChainDepositContextType {
  // Current state
  selectedChain: ChainConfig | null;
  availableChains: ChainConfig[];
  isConnected: boolean;
  address: string | null;
  usdcBalance: bigint;
  nativeBalance: bigint;
  
  // Chain switching
  selectChain: (chainId: string) => Promise<void>;
  switchToChain: (chain: ChainConfig) => Promise<boolean>;
  
  // Deposits
  getDepositQuote: (amount: bigint) => Promise<DepositQuote | null>;
  deposit: (amount: bigint) => Promise<string | null>;
  depositFor: (recipient: string, amount: bigint) => Promise<string | null>;
  
  // Pending deposits
  pendingDeposits: PendingDeposit[];
  refreshPendingDeposits: () => Promise<void>;
  
  // Status
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

const MultiChainDepositContext = createContext<MultiChainDepositContextType | null>(null);

export function MultiChainDepositProvider({ children }: { children: ReactNode }) {
  const [selectedChain, setSelectedChain] = useState<ChainConfig | null>(null);
  const [availableChains] = useState<ChainConfig[]>(getAllChains());
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [nativeBalance, setNativeBalance] = useState<bigint>(0n);
  const [pendingDeposits, setPendingDeposits] = useState<PendingDeposit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const treasuryChain = getTreasuryChain();

  // Detect current chain from wallet
  useEffect(() => {
    async function detectChain() {
      if (typeof window === 'undefined' || !window.ethereum) return;
      // MetaMask SDK can set window.ethereum to a string like "open_metamask_install_page"
      // when the extension isn't available. Guard against non-object values.
      if (typeof window.ethereum !== 'object' || typeof window.ethereum.request !== 'function') return;

      // Pre-validate: ensure the provider returns a real chain ID, not a redirect string
      try {
        const rawChainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (typeof rawChainId !== 'string' || !rawChainId.startsWith('0x')) return;
      } catch {
        return; // Not a real EIP-1193 provider
      }
      
      try {
        const browserProvider = new BrowserProvider(window.ethereum);
        const network = await browserProvider.getNetwork();
        const chainId = Number(network.chainId);
        const detected = getChainByChainId(chainId);
        
        if (detected) {
          setSelectedChain(detected);
          setProvider(browserProvider);
          
          const accounts = await browserProvider.listAccounts();
          if (accounts.length > 0) {
            const s = await browserProvider.getSigner();
            setSigner(s);
            setAddress(await s.getAddress());
          }
        }
      } catch (e) {
        console.error('Failed to detect chain:', e);
      }
    }
    detectChain();

    // Listen for chain changes
    if (window.ethereum && typeof window.ethereum === 'object') {
      window.ethereum.on('chainChanged', detectChain);
      window.ethereum.on('accountsChanged', detectChain);
      return () => {
        window.ethereum?.removeListener('chainChanged', detectChain);
        window.ethereum?.removeListener('accountsChanged', detectChain);
      };
    }
  }, []);

  // Load balances when chain/address changes
  useEffect(() => {
    async function loadBalances() {
      if (!selectedChain || !address || !provider) return;
      
      try {
        // Native balance
        const native = await provider.getBalance(address);
        setNativeBalance(native);

        // USDC balance (EVM only for now)
        if (selectedChain.type === 'evm' && selectedChain.contracts.USDC) {
          const usdc = new Contract(selectedChain.contracts.USDC, ERC20_ABI, provider);
          const bal = await usdc.balanceOf(address);
          setUsdcBalance(bal);
        }
      } catch (e) {
        console.error('Failed to load balances:', e);
      }
    }
    loadBalances();
  }, [selectedChain, address, provider]);

  // Select a chain
  const selectChain = useCallback(async (chainId: string) => {
    const chain = getChainById(chainId);
    if (!chain) {
      setError(`Unknown chain: ${chainId}`);
      return;
    }
    
    if (chain.type === 'solana') {
      // Solana requires different wallet connection
      setSelectedChain(chain);
      // TODO: Implement Solana wallet connection
      return;
    }

    // Switch EVM chain
    await switchToChain(chain);
  }, []);

  // Switch to an EVM chain
  const switchToChain = useCallback(async (chain: ChainConfig): Promise<boolean> => {
    if (!window.ethereum || chain.type !== 'evm') return false;

    try {
      setIsLoading(true);
      setError(null);

      // Try to switch chain
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chain.chainId.toString(16)}` }],
        });
      } catch (switchError: any) {
        // Chain not added, try to add it
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${chain.chainId.toString(16)}`,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [chain.rpcUrl],
              blockExplorerUrls: [chain.explorerUrl],
            }],
          });
        } else {
          throw switchError;
        }
      }

      // Update provider and signer
      const browserProvider = new BrowserProvider(window.ethereum);
      const s = await browserProvider.getSigner();
      
      setSelectedChain(chain);
      setProvider(browserProvider);
      setSigner(s);
      setAddress(await s.getAddress());
      
      return true;
    } catch (e: any) {
      setError(e.message || 'Failed to switch chain');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Get deposit quote
  const getDepositQuote = useCallback(async (amount: bigint): Promise<DepositQuote | null> => {
    if (!selectedChain || !provider || amount <= 0n) return null;

    try {
      const depositRouter = selectedChain.contracts.depositRouter;
      if (!depositRouter) {
        // No deposit router - estimate based on treasury chain direct mint
        const fee = (amount * 30n) / 10000n; // 0.30% fee estimate
        return {
          inputAmount: amount,
          outputAmount: amount - fee,
          fee,
          feePercentage: 0.3,
          bridgeTime: estimateBridgeTime(selectedChain),
          sourceChain: selectedChain,
          destinationChain: treasuryChain,
        };
      }

      const router = new Contract(depositRouter, DEPOSIT_ROUTER_ABI, provider);
      const [mUSDAmount] = await router.previewDeposit(amount);
      
      const totalFee = amount - mUSDAmount;
      const feePercentage = Number(totalFee * 10000n / amount) / 100;

      return {
        inputAmount: amount,
        outputAmount: mUSDAmount,
        fee: totalFee,
        feePercentage,
        bridgeTime: estimateBridgeTime(selectedChain),
        sourceChain: selectedChain,
        destinationChain: treasuryChain,
      };
    } catch (e) {
      console.error('Failed to get deposit quote:', e);
      return null;
    }
  }, [selectedChain, provider, treasuryChain]);

  // Execute deposit
  const deposit = useCallback(async (amount: bigint): Promise<string | null> => {
    if (!selectedChain || !signer || !address) {
      setError('Wallet not connected');
      return null;
    }

    if (selectedChain.type === 'solana') {
      // TODO: Implement Solana deposit
      setError('Solana deposits coming soon');
      return null;
    }

    try {
      setIsLoading(true);
      setError(null);

      const depositRouter = selectedChain.contracts.depositRouter;
      const usdcAddress = selectedChain.contracts.USDC;

      if (!depositRouter || !usdcAddress) {
        setError('Deposit router not configured for this chain');
        return null;
      }

      // Approve USDC
      const usdc = new Contract(usdcAddress, ERC20_ABI, signer);
      const allowance = await usdc.allowance(address, depositRouter);
      
      if (allowance < amount) {
        const approveTx = await usdc.approve(depositRouter, amount);
        await approveTx.wait();
      }

      // Execute deposit
      const router = new Contract(depositRouter, DEPOSIT_ROUTER_ABI, signer);
      
      let tx;
      if (requiresBridging(selectedChain)) {
        // Cross-chain deposits require native gas for Wormhole delivery.
        const bridgeCost: bigint = await router.quoteBridgeCost();
        tx = await router.deposit(amount, { value: bridgeCost });
      } else {
        // Direct deposit on treasury chain
        tx = await router.deposit(amount);
      }

      const receipt = await tx.wait();
      const txHash = receipt.hash;

      // Track pending deposit
      const pendingDeposit: PendingDeposit = {
        id: `${selectedChain.id}-${txHash}`,
        sourceChain: selectedChain,
        amount,
        txHash,
        status: requiresBridging(selectedChain) ? 'bridging' : 'completed',
        timestamp: Date.now(),
        estimatedCompletion: Date.now() + estimateBridgeTime(selectedChain) * 1000,
      };

      setPendingDeposits(prev => [pendingDeposit, ...prev]);

      return txHash;
    } catch (e: any) {
      setError(e.reason || e.message || 'Deposit failed');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [selectedChain, signer, address]);

  // Deposit for another address
  const depositFor = useCallback(async (recipient: string, amount: bigint): Promise<string | null> => {
    if (!selectedChain || !signer || !address) {
      setError('Wallet not connected');
      return null;
    }

    if (!ethers.isAddress(recipient)) {
      setError('Invalid recipient address');
      return null;
    }

    try {
      setIsLoading(true);
      setError(null);

      const depositRouter = selectedChain.contracts.depositRouter;
      const usdcAddress = selectedChain.contracts.USDC;

      if (!depositRouter || !usdcAddress) {
        setError('Deposit router not configured');
        return null;
      }

      // Approve and deposit
      const usdc = new Contract(usdcAddress, ERC20_ABI, signer);
      const allowance = await usdc.allowance(address, depositRouter);
      
      if (allowance < amount) {
        const approveTx = await usdc.approve(depositRouter, amount);
        await approveTx.wait();
      }

      const router = new Contract(depositRouter, DEPOSIT_ROUTER_ABI, signer);
      const tx = requiresBridging(selectedChain)
        ? await router.depositFor(recipient, amount, { value: await router.quoteBridgeCost() })
        : await router.depositFor(recipient, amount);
      const receipt = await tx.wait();

      return receipt.hash;
    } catch (e: any) {
      setError(e.reason || e.message || 'Deposit failed');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [selectedChain, signer, address]);

  // Refresh pending deposits status
  const refreshPendingDeposits = useCallback(async () => {
    // TODO: Query bridge status for pending deposits
    // Update status from 'bridging' to 'completed' when done
  }, [pendingDeposits]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <MultiChainDepositContext.Provider
      value={{
        selectedChain,
        availableChains,
        isConnected: !!address,
        address,
        usdcBalance,
        nativeBalance,
        selectChain,
        switchToChain,
        getDepositQuote,
        deposit,
        depositFor,
        pendingDeposits,
        refreshPendingDeposits,
        isLoading,
        error,
        clearError,
      }}
    >
      {children}
    </MultiChainDepositContext.Provider>
  );
}

export function useMultiChainDeposit() {
  const ctx = useContext(MultiChainDepositContext);
  if (!ctx) {
    throw new Error('useMultiChainDeposit must be used within MultiChainDepositProvider');
  }
  return ctx;
}

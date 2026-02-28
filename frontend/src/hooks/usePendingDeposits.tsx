/**
 * Pending Deposit Tracker
 * 
 * Tracks cross-chain deposits and polls Wormhole for bridge status.
 * Persists pending deposits to localStorage and provides UI components.
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { ChainConfig, getChainById } from '@/lib/chains';

// Wormhole API endpoints
const WORMHOLE_API = {
  mainnet: 'https://api.wormholescan.io/api/v1',
  testnet: 'https://api.testnet.wormholescan.io/api/v1',
};

// Wormhole chain IDs
const WORMHOLE_CHAIN_IDS: Record<string, number> = {
  'ethereum': 2,
  'sepolia': 10002,
  'base': 30,
  'base-sepolia': 10004,
  'arbitrum': 23,
  'arbitrum-sepolia': 10003,
  'solana': 1,
  'solana-devnet': 1,
};

export type DepositStatus = 
  | 'pending'      // Transaction submitted, waiting for source chain confirmation
  | 'confirmed'    // Confirmed on source chain, waiting for VAA
  | 'signed'       // VAA signed by guardians
  | 'relaying'     // Being relayed to destination chain
  | 'completed'    // Successfully completed on destination
  | 'failed';      // Failed at some stage

export interface TrackedDeposit {
  id: string;
  sourceChainId: string;
  destinationChainId: string;
  sourceTxHash: string;
  destinationTxHash?: string;
  amount: string; // Stored as string for serialization
  depositor: string;
  recipient: string;
  status: DepositStatus;
  wormholeSequence?: string;
  vaaId?: string;
  createdAt: number;
  updatedAt: number;
  estimatedCompletion?: number;
  errorMessage?: string;
}

interface WormholeVAAResponse {
  id: string;
  emitterChain: number;
  emitterAddress: string;
  sequence: string;
  txHash: string;
  timestamp: string;
  payload?: {
    amount: string;
    tokenAddress: string;
    tokenChain: number;
    toAddress: string;
    toChain: number;
  };
  status?: {
    completed: boolean;
    destinationTxHash?: string;
  };
}

interface PendingDepositContextType {
  // Deposits
  deposits: TrackedDeposit[];
  pendingCount: number;
  
  // Actions
  addDeposit: (deposit: Omit<TrackedDeposit, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateDeposit: (id: string, updates: Partial<TrackedDeposit>) => void;
  removeDeposit: (id: string) => void;
  clearCompleted: () => void;
  
  // Polling
  refreshStatus: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  isPolling: boolean;
  startPolling: () => void;
  stopPolling: () => void;
  
  // Helpers
  getDepositsByChain: (chainId: string) => TrackedDeposit[];
  getDepositsByStatus: (status: DepositStatus) => TrackedDeposit[];
}

const PendingDepositContext = createContext<PendingDepositContextType | null>(null);

const STORAGE_KEY = 'minted_pending_deposits';
const POLL_INTERVAL = 15000; // 15 seconds

export function PendingDepositProvider({ children }: { children: ReactNode }) {
  const [deposits, setDeposits] = useState<TrackedDeposit[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [pollIntervalId, setPollIntervalId] = useState<NodeJS.Timeout | null>(null);

  const isTestnet = process.env.NEXT_PUBLIC_USE_TESTNET === 'true';
  const wormholeApi = isTestnet ? WORMHOLE_API.testnet : WORMHOLE_API.mainnet;

  // Load deposits from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as TrackedDeposit[];
        setDeposits(parsed);
      }
    } catch (e) {
      console.error('Failed to load pending deposits:', e);
    }
  }, []);

  // Persist deposits to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deposits));
    } catch (e) {
      console.error('Failed to save pending deposits:', e);
    }
  }, [deposits]);

  // Auto-start polling if there are pending deposits
  useEffect(() => {
    const hasPending = deposits.some(d => 
      d.status === 'pending' || d.status === 'confirmed' || d.status === 'signed' || d.status === 'relaying'
    );
    
    if (hasPending && !isPolling) {
      startPolling();
    } else if (!hasPending && isPolling) {
      stopPolling();
    }
  }, [deposits]);

  const pendingCount = deposits.filter(d => 
    d.status !== 'completed' && d.status !== 'failed'
  ).length;

  const addDeposit = useCallback((deposit: Omit<TrackedDeposit, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = `${deposit.sourceChainId}-${deposit.sourceTxHash}-${Date.now()}`;
    const now = Date.now();
    
    const newDeposit: TrackedDeposit = {
      ...deposit,
      id,
      createdAt: now,
      updatedAt: now,
    };

    setDeposits(prev => [newDeposit, ...prev]);
    return id;
  }, []);

  const updateDeposit = useCallback((id: string, updates: Partial<TrackedDeposit>) => {
    setDeposits(prev => prev.map(d => 
      d.id === id 
        ? { ...d, ...updates, updatedAt: Date.now() }
        : d
    ));
  }, []);

  const removeDeposit = useCallback((id: string) => {
    setDeposits(prev => prev.filter(d => d.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setDeposits(prev => prev.filter(d => d.status !== 'completed'));
  }, []);

  const refreshStatus = useCallback(async (id: string) => {
    const deposit = deposits.find(d => d.id === id);
    if (!deposit) return;

    try {
      // If we have a sequence number, query the VAA status
      if (deposit.wormholeSequence) {
        const chainId = WORMHOLE_CHAIN_IDS[deposit.sourceChainId];
        if (!chainId) return;

        const response = await fetch(
          `${wormholeApi}/vaas/${chainId}/${deposit.wormholeSequence}`
        );

        if (response.ok) {
          const data = await response.json() as { data: WormholeVAAResponse };
          const vaa = data.data;

          if (vaa.status?.completed) {
            updateDeposit(id, {
              status: 'completed',
              destinationTxHash: vaa.status.destinationTxHash,
              vaaId: vaa.id,
            });
          } else if (vaa.id) {
            // VAA exists but not completed
            updateDeposit(id, {
              status: 'relaying',
              vaaId: vaa.id,
            });
          }
        }
      } else {
        // Try to find the VAA by transaction hash
        const response = await fetch(
          `${wormholeApi}/transactions?txHash=${deposit.sourceTxHash}`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data.length > 0) {
            const tx = data.data[0];
            
            if (tx.vaa) {
              updateDeposit(id, {
                status: tx.vaa.status?.completed ? 'completed' : 'signed',
                wormholeSequence: tx.vaa.sequence,
                vaaId: tx.vaa.id,
                destinationTxHash: tx.vaa.status?.destinationTxHash,
              });
            } else {
              // Transaction found but no VAA yet
              updateDeposit(id, { status: 'confirmed' });
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to refresh deposit status:', e);
    }
  }, [deposits, wormholeApi, updateDeposit]);

  const refreshAll = useCallback(async () => {
    const pending = deposits.filter(d => 
      d.status !== 'completed' && d.status !== 'failed'
    );

    await Promise.all(pending.map(d => refreshStatus(d.id)));
  }, [deposits, refreshStatus]);

  const startPolling = useCallback(() => {
    if (pollIntervalId) return;
    
    setIsPolling(true);
    const id = setInterval(() => {
      refreshAll();
    }, POLL_INTERVAL);
    setPollIntervalId(id);
  }, [pollIntervalId, refreshAll]);

  const stopPolling = useCallback(() => {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      setPollIntervalId(null);
    }
    setIsPolling(false);
  }, [pollIntervalId]);

  const getDepositsByChain = useCallback((chainId: string) => {
    return deposits.filter(d => d.sourceChainId === chainId);
  }, [deposits]);

  const getDepositsByStatus = useCallback((status: DepositStatus) => {
    return deposits.filter(d => d.status === status);
  }, [deposits]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
      }
    };
  }, [pollIntervalId]);

  return (
    <PendingDepositContext.Provider
      value={{
        deposits,
        pendingCount,
        addDeposit,
        updateDeposit,
        removeDeposit,
        clearCompleted,
        refreshStatus,
        refreshAll,
        isPolling,
        startPolling,
        stopPolling,
        getDepositsByChain,
        getDepositsByStatus,
      }}
    >
      {children}
    </PendingDepositContext.Provider>
  );
}

export function usePendingDeposits() {
  const ctx = useContext(PendingDepositContext);
  if (!ctx) {
    throw new Error('usePendingDeposits must be used within PendingDepositProvider');
  }
  return ctx;
}

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { normalizeCantonParty } from "@/lib/canton-party";

// Types from Loop SDK
interface Account {
  party_id: string;
  auth_token: string;
  public_key: string;
  email?: string;
  has_preapproval?: boolean;
  has_merge_delegation?: boolean;
  usdc_bridge_access?: 'not_requested' | 'pending' | 'granted';
}

interface Holding {
  instrument_id: { admin: string; id: string };
  symbol: string;
  decimals: number;
  total_unlocked_coin: string;
  total_locked_coin: string;
}

interface ActiveContract {
  contractId: string;
  templateId: string;
  payload: Record<string, any>;
}

interface LoopProvider {
  party_id: string;
  public_key: string;
  email?: string;
  getHolding(): Promise<Holding[]>;
  getAccount(): Promise<Account>;
  getActiveContracts(params?: { templateId?: string; interfaceId?: string }): Promise<ActiveContract[]>;
  submitTransaction(payload: any, options?: { message?: string }): Promise<any>;
  submitAndWaitForTransaction(payload: any, options?: { message?: string }): Promise<any>;
  signMessage(message: string): Promise<any>;
  transfer(recipient: string, amount: string, instrument?: any, options?: any): Promise<any>;
}

interface LoopWalletContextType {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  
  // User info
  partyId: string | null;
  publicKey: string | null;
  email: string | null;
  account: Account | null;
  
  // Holdings
  holdings: Holding[];
  
  // Actions
  connect: () => void;
  disconnect: () => void;
  refreshHoldings: () => Promise<void>;
  refreshAccount: () => Promise<void>;
  
  // DAML operations
  queryContracts: (templateId: string) => Promise<ActiveContract[]>;
  exerciseChoice: (templateId: string, contractId: string, choice: string, args: Record<string, any>) => Promise<any>;
  
  // Raw provider access
  provider: LoopProvider | null;
  
  // Error handling
  error: string | null;
}

const LoopWalletContext = createContext<LoopWalletContextType | null>(null);

// Get the loop SDK - it's a global singleton
declare global {
  interface Window {
    loop?: any;
  }
}

interface LoopWalletProviderProps {
  children: ReactNode;
  appName: string;
  network?: 'devnet' | 'testnet' | 'mainnet' | 'local';
  onTransactionUpdate?: (payload: any) => void;
}

export function LoopWalletProvider({ 
  children, 
  appName,
  network = 'devnet',
  onTransactionUpdate
}: LoopWalletProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [provider, setProvider] = useState<LoopProvider | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initialize Loop SDK
  useEffect(() => {
    const initLoop = async () => {
      // Dynamically import Loop SDK
      try {
        const { loop } = await import('@fivenorth/loop-sdk');
        
        loop.init({
          appName,
          network,
          onTransactionUpdate: (payload: any) => {
            console.log('[LoopWallet] Transaction update:', payload);
            onTransactionUpdate?.(payload);
          },
          options: {
            openMode: 'popup',
            requestSigningMode: 'popup',
          },
          onAccept: (prov: LoopProvider) => {
            console.log('[LoopWallet] Connected:', prov.party_id);
            setProvider(prov);
            setIsConnected(true);
            setIsConnecting(false);
            setError(null);
            
            // Fetch initial data
            prov.getAccount().then(acc => setAccount(acc)).catch(console.error);
            prov.getHolding().then(h => setHoldings(h)).catch(console.error);
          },
          onReject: () => {
            console.log('[LoopWallet] Connection rejected');
            setIsConnecting(false);
            setError('Connection rejected by user');
          },
        });

        // Try auto-connect if session exists
        await loop.autoConnect();
        
        // Store loop instance for later use
        window.loop = loop;
      } catch (err) {
        console.error('[LoopWallet] Failed to initialize:', err);
        setError('Failed to initialize Loop SDK');
      }
    };

    initLoop();
  }, [appName, network, onTransactionUpdate]);

  const connect = useCallback(() => {
    if (!window.loop) {
      setError('Loop SDK not initialized');
      return;
    }
    setIsConnecting(true);
    setError(null);
    window.loop.connect();
  }, []);

  const disconnect = useCallback(() => {
    if (window.loop) {
      window.loop.logout();
    }
    setProvider(null);
    setAccount(null);
    setHoldings([]);
    setIsConnected(false);
  }, []);

  const refreshHoldings = useCallback(async () => {
    if (!provider) return;
    try {
      const h = await provider.getHolding();
      setHoldings(h);
    } catch (err: any) {
      console.error('[LoopWallet] Failed to refresh holdings:', err);
      setError(err.message);
    }
  }, [provider]);

  const refreshAccount = useCallback(async () => {
    if (!provider) return;
    try {
      const acc = await provider.getAccount();
      setAccount(acc);
    } catch (err: any) {
      console.error('[LoopWallet] Failed to refresh account:', err);
      setError(err.message);
    }
  }, [provider]);

  const queryContracts = useCallback(async (templateId: string): Promise<ActiveContract[]> => {
    if (!provider) throw new Error('Not connected');
    return provider.getActiveContracts({ templateId });
  }, [provider]);

  const exerciseChoice = useCallback(async (
    templateId: string,
    contractId: string,
    choice: string,
    args: Record<string, any>
  ): Promise<any> => {
    if (!provider) throw new Error('Not connected');

    // Build DAML command
    const damlCommand = {
      commands: [{
        ExerciseByIdCommand: {
          templateId,
          contractId,
          choice,
          choiceArgument: args,
        },
      }],
      packageIdSelectionPreference: [],
      disclosedContracts: [],
    };

    const result = await provider.submitAndWaitForTransaction(damlCommand, {
      message: `Execute ${choice} on ${templateId.split(':')[1]}`,
    });

    return result;
  }, [provider]);

  const value: LoopWalletContextType = {
    isConnected,
    isConnecting,
    partyId: normalizeCantonParty(provider?.party_id || null),
    publicKey: provider?.public_key || null,
    email: provider?.email || null,
    account,
    holdings,
    connect,
    disconnect,
    refreshHoldings,
    refreshAccount,
    queryContracts,
    exerciseChoice,
    provider,
    error,
  };

  return (
    <LoopWalletContext.Provider value={value}>
      {children}
    </LoopWalletContext.Provider>
  );
}

export function useLoopWallet(): LoopWalletContextType {
  const context = useContext(LoopWalletContext);
  if (!context) {
    throw new Error('useLoopWallet must be used within a LoopWalletProvider');
  }
  return context;
}

// Export types
export type { 
  Account as LoopAccount, 
  Holding as LoopHolding, 
  ActiveContract as LoopContract,
  LoopProvider,
  LoopWalletContextType 
};

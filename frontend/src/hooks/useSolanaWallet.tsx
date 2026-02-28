/**
 * Solana Wallet Hook
 * 
 * Provides Phantom and Solflare wallet connection for Solana deposits.
 * Handles wallet detection, connection, and USDC transfers.
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Connection, PublicKey, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Solana USDC token address (mainnet)
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function createTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0); // SPL Token: Transfer
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// RPC endpoints
const RPC_ENDPOINTS = {
  mainnet: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  devnet: process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com',
};

export type SolanaWalletType = 'phantom' | 'solflare';
export type SolanaNetwork = 'mainnet' | 'devnet';

interface PhantomProvider {
  isPhantom: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions: (transactions: Transaction[]) => Promise<Transaction[]>;
  signMessage: (message: Uint8Array) => Promise<{ signature: Uint8Array }>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
}

interface SolflareProvider {
  isSolflare: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions: (transactions: Transaction[]) => Promise<Transaction[]>;
  signMessage: (message: Uint8Array) => Promise<{ signature: Uint8Array }>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
}

type SolanaProvider = PhantomProvider | SolflareProvider;

interface SolanaWalletContextType {
  // Connection state
  isConnected: boolean;
  address: string | null;
  publicKey: PublicKey | null;
  walletType: SolanaWalletType | null;
  network: SolanaNetwork;
  
  // Wallet detection
  isPhantomInstalled: boolean;
  isSolflareInstalled: boolean;
  
  // Balances
  solBalance: number;
  usdcBalance: bigint;
  
  // Actions
  connect: (walletType: SolanaWalletType) => Promise<boolean>;
  disconnect: () => Promise<void>;
  switchNetwork: (network: SolanaNetwork) => void;
  refreshBalances: () => Promise<void>;
  
  // Transactions
  transferUSDC: (recipient: string, amount: bigint) => Promise<string | null>;
  signMessage: (message: string) => Promise<string | null>;
  
  // Status
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

const SolanaWalletContext = createContext<SolanaWalletContextType | null>(null);

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<SolanaProvider | null>(null);
  const [walletType, setWalletType] = useState<SolanaWalletType | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [network, setNetwork] = useState<SolanaNetwork>('mainnet');
  const [connection, setConnection] = useState<Connection>(() => new Connection(RPC_ENDPOINTS.mainnet));
  const [solBalance, setSolBalance] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect installed wallets
  const isPhantomInstalled = typeof window !== 'undefined' && !!window.phantom?.solana?.isPhantom;
  const isSolflareInstalled = typeof window !== 'undefined' && !!window.solflare?.isSolflare;

  // Update connection when network changes
  useEffect(() => {
    setConnection(new Connection(RPC_ENDPOINTS[network]));
  }, [network]);

  // Listen for account changes
  useEffect(() => {
    if (!provider) return;

    const handleAccountChange = () => {
      if (provider.publicKey) {
        setPublicKey(provider.publicKey);
      } else {
        setPublicKey(null);
      }
    };

    const handleDisconnect = () => {
      setPublicKey(null);
      setProvider(null);
      setWalletType(null);
    };

    provider.on('accountChanged', handleAccountChange);
    provider.on('disconnect', handleDisconnect);

    return () => {
      provider.off('accountChanged', handleAccountChange);
      provider.off('disconnect', handleDisconnect);
    };
  }, [provider]);

  // Load balances when connected
  useEffect(() => {
    if (publicKey) {
      refreshBalances();
    }
  }, [publicKey, connection]);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;

    try {
      // Get SOL balance
      const lamports = await connection.getBalance(publicKey);
      setSolBalance(lamports / LAMPORTS_PER_SOL);

      // Get USDC balance
      try {
        const usdcATA = getAssociatedTokenAddress(USDC_MINT, publicKey);
        const tokenBalance = await connection.getTokenAccountBalance(usdcATA);
        setUsdcBalance(BigInt(tokenBalance.value.amount));
      } catch {
        // Token account doesn't exist
        setUsdcBalance(0n);
      }
    } catch (e) {
      console.error('Failed to load Solana balances:', e);
    }
  }, [publicKey, connection]);

  const connect = useCallback(async (type: SolanaWalletType): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      let walletProvider: SolanaProvider | null = null;

      if (type === 'phantom') {
        if (!window.phantom?.solana) {
          setError('Phantom wallet not installed');
          window.open('https://phantom.app/', '_blank');
          return false;
        }
        walletProvider = window.phantom.solana as PhantomProvider;
        const resp = await walletProvider.connect();
        setPublicKey(resp.publicKey);
      } else if (type === 'solflare') {
        if (!window.solflare) {
          setError('Solflare wallet not installed');
          window.open('https://solflare.com/', '_blank');
          return false;
        }
        walletProvider = window.solflare as SolflareProvider;
        await walletProvider.connect();
        if (walletProvider.publicKey) {
          setPublicKey(walletProvider.publicKey);
        }
      }

      if (walletProvider) {
        setProvider(walletProvider);
        setWalletType(type);
        return true;
      }
      return false;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to connect wallet';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (provider) {
      try {
        await provider.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    setProvider(null);
    setPublicKey(null);
    setWalletType(null);
    setSolBalance(0);
    setUsdcBalance(0n);
  }, [provider]);

  const switchNetwork = useCallback((newNetwork: SolanaNetwork) => {
    setNetwork(newNetwork);
  }, []);

  const transferUSDC = useCallback(async (recipient: string, amount: bigint): Promise<string | null> => {
    if (!provider || !publicKey) {
      setError('Wallet not connected');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const recipientPubkey = new PublicKey(recipient);
      
      // Get token accounts
      const senderATA = getAssociatedTokenAddress(USDC_MINT, publicKey);
      const recipientATA = getAssociatedTokenAddress(USDC_MINT, recipientPubkey);

      // Create transfer instruction
      const transferIx = createTransferInstruction(
        senderATA,
        recipientATA,
        publicKey,
        amount
      );

      // Build transaction
      const transaction = new Transaction().add(transferIx);
      transaction.feePayer = publicKey;
      
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      // Sign and send
      const signedTx = await provider.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      
      // Confirm transaction
      await connection.confirmTransaction(signature, 'confirmed');

      // Refresh balances
      await refreshBalances();

      return signature;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Transfer failed';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [provider, publicKey, connection, refreshBalances]);

  const signMessage = useCallback(async (message: string): Promise<string | null> => {
    if (!provider || !publicKey) {
      setError('Wallet not connected');
      return null;
    }

    try {
      const encodedMessage = new TextEncoder().encode(message);
      const { signature } = await provider.signMessage(encodedMessage);
      return Buffer.from(signature).toString('base64');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Signing failed';
      setError(message);
      return null;
    }
  }, [provider, publicKey]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <SolanaWalletContext.Provider
      value={{
        isConnected: !!publicKey,
        address: publicKey?.toBase58() || null,
        publicKey,
        walletType,
        network,
        isPhantomInstalled,
        isSolflareInstalled,
        solBalance,
        usdcBalance,
        connect,
        disconnect,
        switchNetwork,
        refreshBalances,
        transferUSDC,
        signMessage,
        isLoading,
        error,
        clearError,
      }}
    >
      {children}
    </SolanaWalletContext.Provider>
  );
}

export function useSolanaWallet() {
  const ctx = useContext(SolanaWalletContext);
  if (!ctx) {
    throw new Error('useSolanaWallet must be used within SolanaWalletProvider');
  }
  return ctx;
}

// Type declarations for window
declare global {
  interface Window {
    phantom?: {
      solana?: PhantomProvider;
    };
    solflare?: SolflareProvider;
  }
}

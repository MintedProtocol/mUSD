// Type declarations for @fivenorth/loop-sdk
declare module '@fivenorth/loop-sdk' {
  interface LoopAccount {
    party_id: string;
    auth_token: string;
    public_key: string;
    email?: string;
    has_preapproval?: boolean;
    has_merge_delegation?: boolean;
    usdc_bridge_access?: 'not_requested' | 'pending' | 'granted';
  }

  interface LoopHolding {
    instrument_id: { admin: string; id: string };
    symbol: string;
    decimals: number;
    total_unlocked_coin: string;
    total_locked_coin: string;
  }

  interface LoopActiveContract {
    contractId: string;
    templateId: string;
    payload: Record<string, any>;
  }

  interface LoopProvider {
    party_id: string;
    public_key: string;
    email?: string;
    getHolding(): Promise<LoopHolding[]>;
    getAccount(): Promise<LoopAccount>;
    getActiveContracts(params?: { 
      templateId?: string; 
      interfaceId?: string;
    }): Promise<LoopActiveContract[]>;
    submitTransaction(
      payload: any, 
      options?: { message?: string }
    ): Promise<any>;
    submitAndWaitForTransaction(
      payload: any, 
      options?: { message?: string }
    ): Promise<any>;
    signMessage(message: string): Promise<any>;
    transfer(
      recipient: string, 
      amount: string, 
      instrument?: any, 
      options?: any
    ): Promise<any>;
  }

  interface LoopWalletTransferOptions {
    message?: string;
  }

  interface LoopWallet {
    transfer(
      recipient: string,
      amount: string,
      instrument?: any,
      options?: LoopWalletTransferOptions
    ): Promise<any>;
    extension: {
      usdcBridge: {
        withdrawalUSDCxToEthereum(params?: {
          amount?: string;
          message?: string;
        }): Promise<any>;
      };
    };
  }

  interface LoopInitOptions {
    appName: string;
    network: 'devnet' | 'testnet' | 'mainnet' | 'local';
    onAccept: (provider: LoopProvider) => void;
    onReject: () => void;
    onTransactionUpdate?: (payload: any) => void;
    options?: {
      openMode?: 'popup' | 'redirect';
      requestSigningMode?: 'popup' | 'redirect';
    };
  }

  interface Loop {
    init(options: LoopInitOptions): void;
    connect(): void;
    autoConnect(): Promise<void>;
    logout(): void;
    wallet: LoopWallet;
  }

  export const loop: Loop;
}

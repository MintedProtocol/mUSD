import type { AppKitNetwork } from '@reown/appkit/networks';
import type { CustomCaipNetwork } from '@reown/appkit-common';
import { UniversalConnector } from '@reown/appkit-universal-connector';

// WalletConnect Project ID from dashboard.walletconnect.com
export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

if (!projectId) {
  console.warn('[WalletConnect] No project ID configured. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID');
}

// EVM Networks Configuration
const ethereumMainnet = {
  id: 1,
  chainNamespace: 'eip155' as const,
  caipNetworkId: 'eip155:1',
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://eth.llamarpc.com'] } },
};

const sepoliaTestnet = {
  id: 11155111,
  chainNamespace: 'eip155' as const,
  caipNetworkId: 'eip155:11155111',
  name: 'Sepolia',
  nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.sepolia.org'] } },
};

const baseSepolia = {
  id: 84532,
  chainNamespace: 'eip155' as const,
  caipNetworkId: 'eip155:84532',
  name: 'Base Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
};

const baseMainnet = {
  id: 8453,
  chainNamespace: 'eip155' as const,
  caipNetworkId: 'eip155:8453',
  name: 'Base',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.base.org'] } },
};

const hardhatLocal = {
  id: 31337,
  chainNamespace: 'eip155' as const,
  caipNetworkId: 'eip155:31337',
  name: 'Hardhat Local',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
};

// Export all supported networks
export const evmNetworks = [
  ethereumMainnet,
  sepoliaTestnet,
  baseSepolia,
  baseMainnet,
  hardhatLocal,
];

export const networks = evmNetworks as unknown as [AppKitNetwork, ...AppKitNetwork[]];

// Network type for internal use
export type EvmNetwork = typeof ethereumMainnet;

// Get network by chain ID
export function getNetworkById(chainId: number): EvmNetwork | undefined {
  return evmNetworks.find(n => n.id === chainId);
}

// Singleton instance
let universalConnectorInstance: UniversalConnector | null = null;

/**
 * Initialize and return the WalletConnect Universal Connector singleton
 */
export async function getUniversalConnector(): Promise<UniversalConnector> {
  if (universalConnectorInstance) {
    return universalConnectorInstance;
  }

  if (!projectId) {
    throw new Error('WalletConnect Project ID is not configured');
  }

  universalConnectorInstance = await UniversalConnector.init({
    projectId,
    metadata: {
      name: 'Minted Protocol',
      description: 'Decentralized stablecoin protocol on Ethereum and Canton',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://minted.finance',
      icons: ['https://minted.finance/logo.png'],
    },
    networks: [
      {
        methods: [
          'eth_sendTransaction',
          'eth_signTransaction',
          'eth_sign',
          'personal_sign',
          'eth_signTypedData',
          'eth_signTypedData_v3',
          'eth_signTypedData_v4',
        ],
        chains: [...evmNetworks] as any,
        events: ['chainChanged', 'accountsChanged'],
        namespace: 'eip155',
      },
    ],
  });

  return universalConnectorInstance;
}

/**
 * Reset the connector instance (for testing/reconnection)
 */
export function resetUniversalConnector(): void {
  universalConnectorInstance = null;
}

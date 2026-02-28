import { MetaMaskSDK } from '@metamask/sdk';

// MetaMask SDK configuration
const INFURA_API_KEY = process.env.NEXT_PUBLIC_INFURA_API_KEY || '';

// Singleton instance
let metamaskSDKInstance: MetaMaskSDK | null = null;

/**
 * Get or initialize the MetaMask SDK singleton
 */
export function getMetaMaskSDK(): MetaMaskSDK {
  if (metamaskSDKInstance) {
    return metamaskSDKInstance;
  }

  metamaskSDKInstance = new MetaMaskSDK({
    dappMetadata: {
      name: 'Minted Protocol',
      url: typeof window !== 'undefined' ? window.location.href : 'https://minted.finance',
      iconUrl: 'https://minted.finance/logo.png',
    },
    infuraAPIKey: INFURA_API_KEY || undefined,
    // Enable logging in development
    logging: {
      developerMode: process.env.NODE_ENV === 'development',
    },
    // Check if extension installed
    checkInstallationImmediately: false,
    // Preferred connection mode
    preferDesktop: true,
  });

  return metamaskSDKInstance;
}

/**
 * Reset the MetaMask SDK instance
 */
export function resetMetaMaskSDK(): void {
  metamaskSDKInstance = null;
}

/**
 * Check if MetaMask is installed
 */
export function isMetaMaskInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.ethereum?.isMetaMask);
}

/**
 * Check if running on mobile
 */
export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

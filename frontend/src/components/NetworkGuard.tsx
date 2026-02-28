/**
 * NetworkGuard — Full-screen overlay when wallet is on the wrong EVM network
 *
 * Renders a dismissable warning banner with:
 *   - Expected vs actual chain
 *   - A "Switch Network" button (uses wallet_switchEthereumChain)
 *   - Visual cue so users can't accidentally sign on the wrong chain
 *
 * Does NOT block the page entirely — shows a prominent top-banner + disabled overlay
 * so the user can still read the UI but cannot interact with contracts.
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';

export default function NetworkGuard({ children }: { children: React.ReactNode }) {
  const {
    isCorrectNetwork,
    expectedChainName,
    walletChainName,
    walletChainId,
    isConnected,
    switchToCorrectNetwork,
  } = useNetworkGuard();

  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = useCallback(async () => {
    setSwitching(true);
    setError(null);
    try {
      await switchToCorrectNetwork();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to switch network';
      // User rejected or wallet doesn't support the chain
      if (msg.includes('User rejected') || msg.includes('user rejected')) {
        setError('Network switch was rejected. Please switch manually in your wallet.');
      } else {
        setError(msg);
      }
    } finally {
      setSwitching(false);
    }
  }, [switchToCorrectNetwork]);

  // Nothing to warn about if wallet is disconnected or on the correct chain
  if (!isConnected || isCorrectNetwork) {
    return <>{children}</>;
  }

  return (
    <>
      {/* Warning Banner — fixed at top, above everything */}
      <div
        role="alert"
        aria-live="assertive"
        className="fixed inset-x-0 top-0 z-[9999] border-b-2 border-red-500/40 bg-red-950/95 px-4 py-3 text-center backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
          {/* Warning icon */}
          <span className="flex items-center gap-2 text-red-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 flex-shrink-0"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm font-semibold">Wrong Network</span>
          </span>

          {/* Message */}
          <p className="text-sm text-red-200">
            Your wallet is on{' '}
            <span className="font-bold text-white">{walletChainName}</span>
            {walletChainId !== null && (
              <span className="text-red-400"> (chain {walletChainId})</span>
            )}
            . This app requires{' '}
            <span className="font-bold text-white">{expectedChainName}</span>.
          </p>

          {/* Switch Button */}
          <button
            onClick={handleSwitch}
            disabled={switching}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-wait disabled:opacity-60"
          >
            {switching ? 'Switching…' : `Switch to ${expectedChainName}`}
          </button>
        </div>

        {/* Error message */}
        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}
      </div>

      {/* Dimmed content — pointer-events disabled so user can't interact with contracts */}
      <div
        className="pointer-events-none select-none opacity-40"
        style={{ paddingTop: '60px' }}
        aria-hidden="true"
      >
        {children}
      </div>
    </>
  );
}

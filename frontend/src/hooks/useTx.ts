import { useState, useCallback } from "react";
import { ethers } from "ethers";

interface TxState {
  loading: boolean;
  hash: string | null;
  error: string | null;
  success: boolean;
}

const CUSTOM_ERROR_LABELS: Array<[string, string]> = [
  ["InvalidPrice()", "Oracle price is invalid."],
  ["StalePrice()", "Oracle price is stale. Refresh feeds and retry."],
  ["FeedNotEnabled()", "Price feed is not enabled for this asset."],
  ["CircuitBreakerActive()", "Oracle circuit breaker is active for this asset."],
  ["TokenNotSupported()", "Token is not supported for this action."],
  ["ExceedsBorrowCapacity()", "Borrow amount exceeds your collateral capacity."],
  ["WithdrawalWouldUndercollateralize()", "Withdrawal would undercollateralize your position."],
  ["NoPosition()", "No active position found."],
  ["InsufficientBalance()", "Insufficient balance for this action."],
  ["InsufficientDeposit()", "Insufficient deposited collateral."],
  ["CooldownActive()", "Cooldown is active. Please wait before withdrawing."],
  ["ExceedsSupplyCap()", "Pool supply cap reached."],
  ["FeedNotFound()", "Price feed not found for this asset."],
];

const CUSTOM_ERROR_MESSAGES: Record<string, string> = CUSTOM_ERROR_LABELS.reduce((acc, [sig, msg]) => {
  acc[ethers.id(sig).slice(0, 10).toLowerCase()] = msg;
  return acc;
}, {} as Record<string, string>);

function extractRevertData(err: any): string | null {
  const directCandidates = [
    err?.data,
    err?.error?.data,
    err?.info?.error?.data,
    err?.error?.error?.data,
    err?.cause?.data,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.startsWith("0x")) {
      return candidate;
    }
    if (candidate && typeof candidate === "object" && typeof candidate.data === "string" && candidate.data.startsWith("0x")) {
      return candidate.data;
    }
  }
  return null;
}

function decodeCustomErrorMessage(err: any): string | null {
  const data = extractRevertData(err);
  if (!data || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  return CUSTOM_ERROR_MESSAGES[selector] || null;
}

function friendlyErrorMessage(err: any, prefix?: string): string {
  const custom = decodeCustomErrorMessage(err);
  const base = custom || err?.reason || err?.shortMessage || err?.message || "Transaction failed";
  return prefix ? `${prefix}${base}` : base;
}

/**
 * Hook for sending Ethereum transactions with loading/error/success tracking.
 * Added transaction simulation before signing to catch reverts early.
 */
export function useTx() {
  const [state, setState] = useState<TxState>({
    loading: false,
    hash: null,
    error: null,
    success: false,
  });

  const reset = useCallback(() => {
    setState({ loading: false, hash: null, error: null, success: false });
  }, []);

  /**
   * Simulate a transaction to check if it would succeed
   * Catches reverts before user signs, saving gas on failed txs
   */
  const simulate = useCallback(
    async (simulateFn: () => Promise<void>): Promise<boolean> => {
      try {
        await simulateFn();
        return true;
      } catch (err: any) {
        const message = friendlyErrorMessage(err, "Simulation: ");
        setState({ loading: false, hash: null, error: message, success: false });
        return false;
      }
    },
    []
  );

  const send = useCallback(
    async (
      txFn: () => Promise<ethers.TransactionResponse>,
      simulateFn?: () => Promise<void>
    ): Promise<ethers.TransactionReceipt | null> => {
      setState({ loading: true, hash: null, error: null, success: false });
      
      // Simulate first if simulation function provided
      if (simulateFn) {
        const simOk = await simulate(simulateFn);
        if (!simOk) {
          return null;
        }
      }
      
      try {
        const tx = await txFn();
        setState((s) => ({ ...s, hash: tx.hash }));
        const receipt = await tx.wait();
        setState({ loading: false, hash: tx.hash, error: null, success: true });
        return receipt;
      } catch (err: any) {
        const message = friendlyErrorMessage(err);
        setState({ loading: false, hash: null, error: message, success: false });
        return null;
      }
    },
    [simulate]
  );

  return { ...state, send, reset, simulate };
}

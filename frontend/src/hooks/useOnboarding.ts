import { useState, useCallback, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────
export type OnboardStep =
  | "idle"           // Not started
  | "checking"       // Checking if user has Canton party
  | "needs-kyc"      // Needs KYC verification
  | "kyc-pending"    // KYC submitted, waiting for approval
  | "provisioning"   // Creating Canton party + compliance entry
  | "complete"       // Fully onboarded
  | "error";         // Something went wrong

export interface OnboardingState {
  step: OnboardStep;
  cantonParty: string | null;
  kycStatus: "none" | "pending" | "approved" | "rejected";
  error: string | null;
  isLoading: boolean;
}

export interface UseOnboardingReturn extends OnboardingState {
  /** Check if ETH address is already onboarded */
  checkStatus: (ethAddress: string) => Promise<void>;
  /** Submit KYC (stub: auto-approves in dev) */
  submitKyc: (ethAddress: string) => Promise<void>;
  /** Provision Canton party after KYC approval */
  provision: (ethAddress: string) => Promise<string | null>;
  /** Reset state */
  reset: () => void;
}

const INITIAL_STATE: OnboardingState = {
  step: "idle",
  cantonParty: null,
  kycStatus: "none",
  error: null,
  isLoading: false,
};

/**
 * Hook to manage Canton Network onboarding flow.
 *
 * Flow: checkStatus → (needs-kyc → submitKyc → provisioning) → complete
 *
 * If user already has a Canton party, skips directly to "complete".
 */
export function useOnboarding(): UseOnboardingReturn {
  const [state, setState] = useState<OnboardingState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const checkStatus = useCallback(async (ethAddress: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState((s) => ({ ...s, step: "checking", isLoading: true, error: null }));

    try {
      const resp = await fetch(
        `/api/onboard?action=status&ethAddress=${encodeURIComponent(ethAddress)}`,
        { signal: abortRef.current.signal }
      );

      if (!resp.ok) {
        throw new Error(`Status check failed: ${resp.status}`);
      }

      const data = await resp.json();

      if (data.registered && data.cantonParty) {
        setState({
          step: "complete",
          cantonParty: data.cantonParty,
          kycStatus: "approved",
          error: null,
          isLoading: false,
        });
      } else {
        setState({
          step: "needs-kyc",
          cantonParty: null,
          kycStatus: data.kycStatus || "none",
          error: null,
          isLoading: false,
        });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState({
        step: "error",
        cantonParty: null,
        kycStatus: "none",
        error: err instanceof Error ? err.message : "Failed to check status",
        isLoading: false,
      });
    }
  }, []);

  const submitKyc = useCallback(async (ethAddress: string) => {
    setState((s) => ({
      ...s,
      step: "kyc-pending",
      isLoading: true,
      error: null,
    }));

    try {
      const resp = await fetch("/api/onboard?action=kyc-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ethAddress }),
      });

      if (!resp.ok) {
        throw new Error(`KYC check failed: ${resp.status}`);
      }

      const data = await resp.json();

      if (data.status === "approved") {
        // Auto-provision after KYC approval
        setState((s) => ({
          ...s,
          kycStatus: "approved",
          step: "provisioning",
        }));
        // Trigger provision
        await provisionInternal(ethAddress);
      } else if (data.status === "rejected") {
        setState({
          step: "error",
          cantonParty: null,
          kycStatus: "rejected",
          error: "KYC verification was rejected. Please contact support.",
          isLoading: false,
        });
      } else {
        setState((s) => ({
          ...s,
          kycStatus: "pending",
          step: "kyc-pending",
          isLoading: false,
        }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "KYC submission failed",
        isLoading: false,
      }));
    }
  }, []);

  const provisionInternal = async (ethAddress: string) => {
    try {
      const resp = await fetch("/api/onboard?action=provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ethAddress,
          kycToken: "dev-approved", // In production: real KYC token
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error || `Provision failed: ${resp.status}`
        );
      }

      const data = await resp.json();

      setState({
        step: "complete",
        cantonParty: data.cantonParty,
        kycStatus: "approved",
        error: null,
        isLoading: false,
      });

      return data.cantonParty as string;
    } catch (err) {
      setState((s) => ({
        ...s,
        step: "error",
        error:
          err instanceof Error ? err.message : "Canton provisioning failed",
        isLoading: false,
      }));
      return null;
    }
  };

  const provision = useCallback(
    async (ethAddress: string): Promise<string | null> => {
      setState((s) => ({
        ...s,
        step: "provisioning",
        isLoading: true,
        error: null,
      }));
      return provisionInternal(ethAddress);
    },
    []
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { ...state, checkStatus, submitKyc, provision, reset };
}

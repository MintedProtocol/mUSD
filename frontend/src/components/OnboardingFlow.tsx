import { useEffect, useState } from "react";
import { useOnboarding, type OnboardStep } from "@/hooks/useOnboarding";

interface OnboardingFlowProps {
  ethAddress: string;
  onComplete: (cantonParty: string) => void;
  onCancel: () => void;
}

/** Step metadata for the progress bar */
const STEPS: { key: OnboardStep; label: string; icon: string }[] = [
  { key: "checking", label: "Check Status", icon: "🔍" },
  { key: "needs-kyc", label: "Identity", icon: "🪪" },
  { key: "provisioning", label: "Canton Party", icon: "⛓" },
  { key: "complete", label: "Ready", icon: "✅" },
];

function stepIndex(step: OnboardStep): number {
  if (step === "idle" || step === "checking") return 0;
  if (step === "needs-kyc" || step === "kyc-pending") return 1;
  if (step === "provisioning") return 2;
  if (step === "complete") return 3;
  return -1; // error
}

/**
 * Multi-step onboarding wizard for Canton Network.
 *
 * Flow:
 *   1. Auto-check if ETH address has Canton party
 *   2. If not → KYC verification step (stub: auto-approves in dev)
 *   3. Provision Canton party via participant admin API
 *   4. Show Canton party ID and enable bridging
 */
export function OnboardingFlow({
  ethAddress,
  onComplete,
  onCancel,
}: OnboardingFlowProps) {
  const onboarding = useOnboarding();
  const [email, setEmail] = useState("");
  const currentIdx = stepIndex(onboarding.step);

  // Auto-check status on mount
  useEffect(() => {
    if (ethAddress && onboarding.step === "idle") {
      onboarding.checkStatus(ethAddress);
    }
  }, [ethAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-notify parent when complete
  useEffect(() => {
    if (onboarding.step === "complete" && onboarding.cantonParty) {
      onComplete(onboarding.cantonParty);
    }
  }, [onboarding.step, onboarding.cantonParty]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onboarding.submitKyc(ethAddress);
  };

  return (
    <div className="card-gradient-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              Canton Network Onboarding
            </h2>
            <p className="text-sm text-gray-400">
              Set up your Canton identity to bridge mUSD
            </p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const isActive = i === currentIdx;
            const isDone = currentIdx > i;
            const isError = onboarding.step === "error";

            return (
              <div key={s.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-all ${
                      isDone
                        ? "bg-emerald-500 text-white"
                        : isActive && !isError
                          ? "bg-brand-500 text-white ring-2 ring-brand-400/50"
                          : isActive && isError
                            ? "bg-red-500 text-white ring-2 ring-red-400/50"
                            : "bg-surface-700 text-gray-500"
                    }`}
                  >
                    {isDone ? "✓" : s.icon}
                  </div>
                  <span
                    className={`mt-1.5 text-xs ${
                      isDone || isActive
                        ? "text-white font-medium"
                        : "text-gray-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`mx-2 h-0.5 flex-1 rounded transition-all ${
                      isDone
                        ? "bg-emerald-500"
                        : "bg-surface-700"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="min-h-[200px]">
        {/* Checking status */}
        {(onboarding.step === "idle" || onboarding.step === "checking") && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent mb-4" />
            <p className="text-gray-300 font-medium">
              Checking your Canton Network status…
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Address: {ethAddress.slice(0, 8)}…{ethAddress.slice(-6)}
            </p>
          </div>
        )}

        {/* Needs KYC */}
        {onboarding.step === "needs-kyc" && (
          <div className="space-y-6">
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-yellow-300">
                    Identity Verification Required
                  </p>
                  <p className="text-sm text-gray-400 mt-1">
                    To comply with regulatory requirements, we need to verify
                    your identity before creating your Canton Network account.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleKycSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full rounded-xl bg-surface-800 border border-white/10 px-4 py-3 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Wallet Address
                </label>
                <div className="rounded-xl bg-surface-800/50 border border-white/5 px-4 py-3">
                  <span className="font-mono text-sm text-gray-400">
                    {ethAddress}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-surface-800/50 border border-white/5 p-4 space-y-2">
                <p className="text-sm font-medium text-gray-300">
                  By proceeding, you confirm:
                </p>
                <ul className="text-sm text-gray-400 space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    You are not a resident of a sanctioned jurisdiction
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    You agree to the Terms of Service and Privacy Policy
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    Your identity information will be verified via a KYC provider
                  </li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={!email || onboarding.isLoading}
                className="w-full rounded-xl bg-gradient-to-r from-brand-500 to-purple-500 px-6 py-3.5 font-semibold text-white transition-all hover:from-brand-400 hover:to-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {onboarding.isLoading
                  ? "Verifying…"
                  : "Verify Identity & Create Canton Account"}
              </button>
            </form>
          </div>
        )}

        {/* KYC Pending */}
        {onboarding.step === "kyc-pending" && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-yellow-500 border-t-transparent mb-4" />
            <p className="text-gray-300 font-medium">
              Verifying your identity…
            </p>
            <p className="text-sm text-gray-500 mt-1">
              This may take a moment
            </p>
          </div>
        )}

        {/* Provisioning */}
        {onboarding.step === "provisioning" && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent mb-4" />
            <p className="text-gray-300 font-medium">
              Creating your Canton Network identity…
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Allocating party and registering with ComplianceRegistry
            </p>
          </div>
        )}

        {/* Complete */}
        {onboarding.step === "complete" && onboarding.cantonParty && (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="h-6 w-6 text-emerald-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="text-base font-semibold text-emerald-300">
                    Canton Account Ready!
                  </p>
                  <p className="text-sm text-gray-400 mt-1">
                    Your Canton Network identity has been created and verified.
                    You can now bridge mUSD from Ethereum.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-surface-800/50 border border-white/5 p-4">
              <p className="text-xs text-gray-500 mb-1">Your Canton Party ID</p>
              <p className="font-mono text-sm text-brand-400 break-all">
                {onboarding.cantonParty}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {onboarding.step === "error" && (
          <div className="space-y-4">
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-red-300">
                    Onboarding Error
                  </p>
                  <p className="text-sm text-gray-400 mt-1">
                    {onboarding.error}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => onboarding.checkStatus(ethAddress)}
              className="w-full rounded-xl bg-surface-700 px-6 py-3 font-medium text-white transition-colors hover:bg-surface-600"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default OnboardingFlow;

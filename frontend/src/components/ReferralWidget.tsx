import React, { useState, useEffect } from "react";
import { useReferral } from "@/hooks/useReferral";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";

/**
 * ReferralWidget — compact card for the Dashboard / Mint page.
 * Shows referral code generation, copy-to-clipboard, quick stats,
 * and an input to apply someone else's code.
 */
export function ReferralWidget() {
  const { address, isConnected } = useUnifiedWallet();
  const {
    isLoading,
    error,
    isReferred,
    myCodes,
    dashboard,
    tiers,
    generateCode,
    applyCode,
  } = useReferral();

  const [inputCode, setInputCode] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);

  // Auto-detect ?ref= query param from shared referral links
  useEffect(() => {
    if (typeof window === "undefined" || isReferred) return;
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get("ref");
    if (refCode && /^MNTD-[A-Z0-9]{6}$/.test(refCode.toUpperCase())) {
      setInputCode(refCode.toUpperCase());
      // Clean the URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete("ref");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [isReferred]);

  if (!isConnected) return null;

  const handleGenerate = async () => {
    setIsGenerating(true);
    const code = await generateCode();
    setIsGenerating(false);
    if (code) {
      handleCopy(code);
    }
  };

  const handleCopy = (code: string) => {
    const url = `${window.location.origin}?ref=${code}`;
    navigator.clipboard.writeText(url);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleApply = async () => {
    if (!inputCode.trim()) return;
    setIsApplying(true);
    setApplySuccess(false);
    const ok = await applyCode(inputCode.trim().toUpperCase());
    setIsApplying(false);
    if (ok) {
      setApplySuccess(true);
      setInputCode("");
      setTimeout(() => setApplySuccess(false), 3000);
    }
  };

  const currentMultiplier = dashboard?.multiplier || "1.0x";
  const nextTier = tiers.find(
    (t) => dashboard && dashboard.referredTvlRaw < t.minTvl
  );

  return (
    <div className="card-gradient-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-white">Referral Program</h3>
            <p className="text-xs text-gray-400">Earn boosted points for every friend who adds TVL</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-400">
            {currentMultiplier} BOOST
          </span>
        </div>
      </div>

      <div className="space-y-5 p-6">
        {/* Quick Stats Row */}
        {dashboard && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-surface-800/50 p-3 text-center">
              <p className="text-xs text-gray-500">Referees</p>
              <p className="text-lg font-bold text-white">{dashboard.numReferees}</p>
            </div>
            <div className="rounded-lg bg-surface-800/50 p-3 text-center">
              <p className="text-xs text-gray-500">Referred TVL</p>
              <p className="text-lg font-bold text-white">{dashboard.referredTvl}</p>
            </div>
            <div className="rounded-lg bg-surface-800/50 p-3 text-center">
              <p className="text-xs text-gray-500">Bonus Pts</p>
              <p className="text-lg font-bold text-amber-400">{dashboard.kickbackPts}</p>
            </div>
          </div>
        )}

        {/* Next Tier Progress */}
        {nextTier && dashboard && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">
                Next tier: {nextTier.multiplierLabel} at {nextTier.label}
              </span>
              <span className="font-medium text-amber-400">
                {dashboard.referredTvl} / {nextTier.label}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    Number(
                      (dashboard.referredTvlRaw * 100n) / (nextTier.minTvl || 1n)
                    )
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Your Referral Codes */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-400">Your Referral Links</label>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || myCodes.length >= 5}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? (
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              )}
              Generate Code ({myCodes.length}/5)
            </button>
          </div>

          {myCodes.length > 0 ? (
            <div className="space-y-2">
              {myCodes.map((code) => (
                <div
                  key={code}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-surface-800/50 px-4 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-white">{code}</span>
                  </div>
                  <button
                    onClick={() => handleCopy(code)}
                    className="flex items-center gap-1.5 rounded-md bg-brand-500/20 px-3 py-1 text-xs font-medium text-brand-400 transition-colors hover:bg-brand-500/30"
                  >
                    {copied === code ? (
                      <>
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy Link
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 bg-surface-800/30 p-4 text-center">
              <p className="text-sm text-gray-500">
                No codes yet — generate one to start earning referral points!
              </p>
            </div>
          )}
        </div>

        {/* Apply a Referral Code */}
        {!isReferred && (
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-400">Have a referral code?</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="MNTD-XXXXXX"
                maxLength={11}
                className="flex-1 rounded-lg border border-white/10 bg-surface-800/50 px-4 py-2.5 font-mono text-sm text-white placeholder-gray-600 transition-colors focus:border-amber-500/50 focus:outline-none"
              />
              <button
                onClick={handleApply}
                disabled={isApplying || !inputCode.trim()}
                className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isApplying ? "Linking..." : "Apply"}
              </button>
            </div>
            {applySuccess && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Referral linked! You'll both earn boosted points.
              </p>
            )}
          </div>
        )}

        {isReferred && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            You were referred — your referrer earns bonus points from your TVL!
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Tier Table */}
        {tiers.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-500 transition-colors hover:text-gray-300">
              <svg className="h-4 w-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Multiplier Tiers
            </summary>
            <div className="mt-3 overflow-hidden rounded-lg border border-white/5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-surface-800/50">
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Referred TVL</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Multiplier</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((tier, i) => (
                    <tr
                      key={i}
                      className={`border-b border-white/5 ${
                        dashboard && dashboard.referredTvlRaw >= tier.minTvl
                          ? "bg-amber-500/5"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-2 text-gray-300">≥ {tier.label}</td>
                      <td className="px-4 py-2 text-right font-semibold text-amber-400">
                        {tier.multiplierLabel}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-4 py-2 text-gray-500">Base</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-400">1.0x</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export default ReferralWidget;

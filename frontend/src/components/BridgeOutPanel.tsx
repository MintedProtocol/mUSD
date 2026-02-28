import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { useEthWallet } from "@/hooks/useEthWallet";
import { CONTRACTS } from "@/lib/config";
import { BLE_BRIDGE_V9_ABI } from "@/abis/BLEBridgeV9";
import { MUSD_ABI } from "@/abis/MUSD";
import OnboardingFlow from "./OnboardingFlow";

// ── Types ──────────────────────────────────────────────────────
type TxStatus = "idle" | "approving" | "bridging" | "confirming" | "success" | "error";

interface BridgeOutPanelProps {
  /** Canton party ID if user is already onboarded */
  existingCantonParty?: string | null;
}

/**
 * Bridge-out panel: Transfer mUSD from Ethereum to Canton Network.
 *
 * Flow:
 *   1. User connects ETH wallet (MetaMask)
 *   2. Checks if user has Canton party — if not, shows OnboardingFlow
 *   3. User enters amount, approves mUSD spending, calls bridgeToCanton
 *   4. Relay picks up BridgeToCantonRequested event and mints on Canton
 */
export function BridgeOutPanel({ existingCantonParty }: BridgeOutPanelProps) {
  const wallet = useEthWallet();

  // Form state
  const [amount, setAmount] = useState("");
  const [cantonParty, setCantonParty] = useState<string | null>(
    existingCantonParty || null
  );
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Contract state
  const [musdBalance, setMusdBalance] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [minAmount, setMinAmount] = useState<bigint>(0n);
  const [bridgePaused, setBridgePaused] = useState(false);

  // Transaction state
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const bridgeAddress = CONTRACTS.BLEBridgeV9;
  const musdAddress = CONTRACTS.MUSD;

  // ── Load balances and contract state ──────────────────────
  const refreshData = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address || !bridgeAddress || !musdAddress) return;

    try {
      const [bal, allow, minAmt, paused] = await Promise.all([
        wallet.readContract<bigint>(musdAddress, [...MUSD_ABI], "balanceOf", [
          wallet.address,
        ]),
        wallet.readContract<bigint>(musdAddress, [...MUSD_ABI], "allowance", [
          wallet.address,
          bridgeAddress,
        ]),
        wallet.readContract<bigint>(
          bridgeAddress,
          [...BLE_BRIDGE_V9_ABI],
          "bridgeOutMinAmount",
          []
        ),
        wallet.readContract<boolean>(
          bridgeAddress,
          [...BLE_BRIDGE_V9_ABI],
          "paused",
          []
        ),
      ]);

      setMusdBalance(bal);
      setAllowance(allow);
      setMinAmount(minAmt);
      setBridgePaused(paused);
    } catch (err) {
      console.error("[BridgeOut] Failed to load contract data:", err);
    }
  }, [wallet.isConnected, wallet.address, bridgeAddress, musdAddress]);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 15_000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [refreshData]);

  // ── Derived values ────────────────────────────────────────
  const parsedAmount = (() => {
    try {
      return amount ? ethers.parseEther(amount) : 0n;
    } catch {
      return 0n;
    }
  })();

  const needsApproval = parsedAmount > 0n && allowance < parsedAmount;
  const hasEnoughBalance = parsedAmount > 0n && musdBalance >= parsedAmount;
  const meetsMinimum = parsedAmount >= minAmount;
  const isValidAmount = parsedAmount > 0n && hasEnoughBalance && meetsMinimum;

  const canBridge =
    wallet.isConnected &&
    cantonParty &&
    isValidAmount &&
    !bridgePaused &&
    !needsApproval &&
    txStatus === "idle";

  // ── Approve mUSD spending ─────────────────────────────────
  const handleApprove = async () => {
    if (!wallet.isConnected || !musdAddress || !bridgeAddress) return;

    setTxStatus("approving");
    setTxError(null);

    try {
      const tx = await wallet.writeContract(
        musdAddress,
        [...MUSD_ABI],
        "approve",
        [bridgeAddress, parsedAmount]
      );
      await tx.wait();
      setAllowance(parsedAmount);
      setTxStatus("idle");
    } catch (err) {
      console.error("[BridgeOut] Approve failed:", err);
      setTxError(
        err instanceof Error ? err.message : "Approval failed"
      );
      setTxStatus("error");
    }
  };

  // ── Execute bridge-to-Canton ──────────────────────────────
  const handleBridge = async () => {
    if (!canBridge || !cantonParty) return;

    setTxStatus("bridging");
    setTxError(null);
    setTxHash(null);

    try {
      const tx = await wallet.writeContract(
        bridgeAddress,
        [...BLE_BRIDGE_V9_ABI],
        "bridgeToCanton",
        [parsedAmount, cantonParty]
      );

      setTxHash(tx.hash);
      setTxStatus("confirming");

      await tx.wait();

      setTxStatus("success");
      setAmount("");
      refreshData();
    } catch (err) {
      console.error("[BridgeOut] Bridge failed:", err);
      setTxError(
        err instanceof Error ? err.message : "Bridge transaction failed"
      );
      setTxStatus("error");
    }
  };

  // ── Reset after error/success ─────────────────────────────
  const handleReset = () => {
    setTxStatus("idle");
    setTxError(null);
    setTxHash(null);
  };

  // ── Not connected ─────────────────────────────────────────
  if (!wallet.isConnected) {
    return (
      <div className="card-gradient-border overflow-hidden">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500">
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
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              Bridge to Canton
            </h2>
            <p className="text-sm text-gray-400">
              Transfer mUSD from Ethereum to Canton Network
            </p>
          </div>
        </div>

        <div className="text-center py-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface-800 mb-4">
            <svg
              className="h-8 w-8 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
              />
            </svg>
          </div>
          <p className="text-gray-400 font-medium">
            Connect your Ethereum wallet to bridge mUSD
          </p>
          <button
            onClick={wallet.connect}
            disabled={wallet.isConnecting}
            className="mt-4 rounded-xl bg-gradient-to-r from-brand-500 to-purple-500 px-6 py-3 font-semibold text-white transition-all hover:from-brand-400 hover:to-purple-400 disabled:opacity-50"
          >
            {wallet.isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>
        </div>
      </div>
    );
  }

  // ── Onboarding flow ───────────────────────────────────────
  if (showOnboarding && !cantonParty) {
    return (
      <OnboardingFlow
        ethAddress={wallet.address!}
        onComplete={(party) => {
          setCantonParty(party);
          setShowOnboarding(false);
        }}
        onCancel={() => setShowOnboarding(false)}
      />
    );
  }

  // ── Main bridge panel ─────────────────────────────────────
  return (
    <div className="card-gradient-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500">
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
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">
            Bridge to Canton
          </h2>
          <p className="text-sm text-gray-400">
            Burn mUSD on Ethereum → Mint on Canton Network
          </p>
        </div>
      </div>

      {/* Paused Warning */}
      {bridgePaused && (
        <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3">
          <p className="text-sm text-red-300 font-medium">
            ⚠ Bridge is currently paused. Transactions are disabled.
          </p>
        </div>
      )}

      {/* Canton Party Status */}
      <div className="mb-6">
        {cantonParty ? (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm font-medium text-emerald-300">
                  Canton Account Connected
                </span>
              </div>
              <span className="text-xs font-mono text-gray-500">
                {cantonParty.length > 30
                  ? `${cantonParty.slice(0, 20)}…${cantonParty.slice(-8)}`
                  : cantonParty}
              </span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowOnboarding(true)}
            className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:from-emerald-500 hover:to-teal-500"
          >
            Set Up Canton Account to Bridge
          </button>
        )}
      </div>

      {/* Amount Input */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-300">
              Amount (mUSD)
            </label>
            <button
              onClick={() =>
                setAmount(ethers.formatEther(musdBalance))
              }
              className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              Max: {Number(ethers.formatEther(musdBalance)).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              mUSD
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              value={amount}
              onChange={(e) => {
                // Only allow valid number input
                const val = e.target.value;
                if (val === "" || /^\d*\.?\d*$/.test(val)) {
                  setAmount(val);
                }
              }}
              placeholder="0.00"
              disabled={!cantonParty || bridgePaused}
              className="w-full rounded-xl bg-surface-800 border border-white/10 px-4 py-3.5 text-lg font-medium text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 transition-colors"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">
              mUSD
            </span>
          </div>

          {/* Validation messages */}
          {parsedAmount > 0n && !hasEnoughBalance && (
            <p className="mt-1 text-xs text-red-400">
              Insufficient mUSD balance
            </p>
          )}
          {parsedAmount > 0n && !meetsMinimum && minAmount > 0n && (
            <p className="mt-1 text-xs text-yellow-400">
              Minimum bridge amount:{" "}
              {Number(ethers.formatEther(minAmount)).toLocaleString()} mUSD
            </p>
          )}
        </div>

        {/* Direction Indicator */}
        <div className="flex items-center justify-center gap-4 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-surface-800/50 border border-white/5 px-3 py-2">
            <div className="h-3 w-3 rounded-full bg-blue-400" />
            <span className="text-xs font-medium text-gray-400">Ethereum</span>
          </div>
          <svg
            className="h-5 w-5 text-brand-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
          <div className="flex items-center gap-2 rounded-lg bg-surface-800/50 border border-white/5 px-3 py-2">
            <div className="h-3 w-3 rounded-full bg-emerald-400" />
            <span className="text-xs font-medium text-gray-400">Canton</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          {/* Approve button */}
          {needsApproval && isValidAmount && !bridgePaused && (
            <button
              onClick={handleApprove}
              disabled={txStatus !== "idle"}
              className="w-full rounded-xl bg-gradient-to-r from-yellow-600 to-orange-600 px-6 py-3.5 font-semibold text-white transition-all hover:from-yellow-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {txStatus === "approving" ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Approving…
                </span>
              ) : (
                `Approve ${amount} mUSD`
              )}
            </button>
          )}

          {/* Bridge button */}
          <button
            onClick={handleBridge}
            disabled={!canBridge}
            className="w-full rounded-xl bg-gradient-to-r from-brand-500 to-purple-500 px-6 py-3.5 font-semibold text-white transition-all hover:from-brand-400 hover:to-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {txStatus === "bridging" || txStatus === "confirming" ? (
              <span className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {txStatus === "bridging"
                  ? "Submitting…"
                  : "Confirming…"}
              </span>
            ) : needsApproval ? (
              "Approve First"
            ) : !cantonParty ? (
              "Set Up Canton Account First"
            ) : !isValidAmount ? (
              "Enter Amount"
            ) : bridgePaused ? (
              "Bridge Paused"
            ) : (
              `Bridge ${amount} mUSD to Canton`
            )}
          </button>
        </div>

        {/* Transaction Status */}
        {txStatus === "success" && txHash && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
            <div className="flex items-start gap-3">
              <svg
                className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0"
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
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-300">
                  Bridge Transaction Submitted!
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Your mUSD has been burned on Ethereum. The relay service will
                  mint equivalent mUSD on Canton within a few minutes.
                </p>
                <a
                  href={`https://sepolia.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  View on Etherscan
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>
              <button
                onClick={handleReset}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <svg
                  className="h-4 w-4"
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
          </div>
        )}

        {txStatus === "error" && txError && (
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
              <div className="flex-1">
                <p className="text-sm font-medium text-red-300">
                  Transaction Failed
                </p>
                <p className="text-xs text-gray-400 mt-1 break-all">
                  {txError}
                </p>
              </div>
              <button
                onClick={handleReset}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <svg
                  className="h-4 w-4"
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
          </div>
        )}

        {/* Info Box */}
        <div className="rounded-xl bg-surface-800/50 border border-white/5 p-4 space-y-2">
          <p className="text-xs font-medium text-gray-400">How it works</p>
          <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
            <li>Your mUSD is burned on Ethereum via BLEBridgeV9</li>
            <li>The relay service detects the burn event</li>
            <li>
              Equivalent mUSD is minted on Canton to your party (compliance-checked)
            </li>
            <li>Typical completion time: 2–5 minutes</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export default BridgeOutPanel;

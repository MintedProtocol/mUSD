import React, { useState } from "react";
import { ethers, Contract } from "ethers";
import { CONTRACTS, MUSD_DECIMALS } from "@/lib/config";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";

const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const SMUSD_DECIMALS = 21;

// Minimal ABI with transfer — the protocol ABIs may not include it
const TRANSFER_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

interface Props {
  address: string | null;
  musd: Contract | null;
  smusd?: Contract | null;
}

/**
 * Testnet-only component: clears all mUSD and sMUSD balances from the connected wallet.
 * - Transfers sMUSD to burn address (bypasses cooldown — transfer != redeem)
 * - Transfers mUSD to burn address
 */
export function ClearTestnetBalances({ address, musd, smusd }: Props) {
  const { signer } = useUnifiedWallet();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleClear() {
    if (!address || !signer) return;
    setLoading(true);
    setStatus(null);

    try {
      // Step 1: Transfer all sMUSD to dead address (uses minimal ABI with transfer)
      if (CONTRACTS.SMUSD) {
        const smusdContract = new Contract(CONTRACTS.SMUSD, TRANSFER_ABI, signer);
        const smusdBal: bigint = await smusdContract.balanceOf(address);
        if (smusdBal > 0n) {
          setStatus(`Transferring ${ethers.formatUnits(smusdBal, SMUSD_DECIMALS)} sMUSD to burn address...`);
          const tx1 = await smusdContract.transfer(DEAD_ADDRESS, smusdBal);
          await tx1.wait(1);
          setStatus("sMUSD cleared ✓");
        } else {
          setStatus("sMUSD balance already 0 ✓");
        }
      }

      // Step 2: Transfer all mUSD to dead address (uses minimal ABI with transfer)
      if (CONTRACTS.MUSD) {
        const musdContract = new Contract(CONTRACTS.MUSD, TRANSFER_ABI, signer);
        const musdBal: bigint = await musdContract.balanceOf(address);
        if (musdBal > 0n) {
          setStatus((s) => (s ? s + "\n" : "") + `Transferring ${ethers.formatUnits(musdBal, MUSD_DECIMALS)} mUSD to burn address...`);
          const tx2 = await musdContract.transfer(DEAD_ADDRESS, musdBal);
          await tx2.wait(1);
          setStatus((s) => (s || "") + "\nAll balances cleared ✓");
        } else {
          setStatus((s) => (s ? s + "\n" : "") + "mUSD balance already 0 ✓");
        }
      }
    } catch (e: any) {
      console.error("Clear balances error:", e);
      setStatus(`Error: ${e?.reason || e?.message || "Transaction failed"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/20">
            <svg className="h-4 w-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-yellow-300">Testnet Reset</p>
            <p className="text-xs text-gray-400">Clear all mUSD &amp; sMUSD from your wallet</p>
          </div>
        </div>
        <button
          onClick={handleClear}
          disabled={loading || !address || !signer}
          className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Clearing..." : "Clear All Balances"}
        </button>
      </div>
      {status && (
        <pre className="mt-3 text-xs text-gray-300 whitespace-pre-wrap">{status}</pre>
      )}
    </div>
  );
}

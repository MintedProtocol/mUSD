// Points Page — displays user points, leaderboard, and referral system
// Populated stub file (was 0-byte)

import React, { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useLoopWallet } from "@/hooks/useLoopWallet";
import { useChainState } from "@/hooks/useChain";
import WalletConnector from "@/components/WalletConnector";

export function PointsPage() {
  const { address, isConnected } = useUnifiedWallet();
  const loopWallet = useLoopWallet();
  const chainState = useChainState();
  const [referralCode, setReferralCode] = useState("");
  const isCanton = chainState.chain === "canton";
  const isWalletConnected = isCanton ? Boolean(loopWallet.partyId) : isConnected;
  const walletMode = isCanton ? "canton" : "ethereum";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Points"
        description="Earn points by minting, staking, borrowing, and bridging mUSD"
      />

      {!isWalletConnected ? (
        <WalletConnector mode={walletMode} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard label="Total Points" value="—" />
            <StatCard label="Rank" value="—" />
            <StatCard label="Referrals" value="0" />
            <StatCard label="Multiplier" value="1.0x" />
          </div>

          <div className="bg-gray-900 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Your Referral Code</h3>
            <p className="text-gray-400 text-sm mb-4">
              Share your referral code to earn bonus points when others join the protocol.
            </p>
            <input
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value)}
              placeholder="Enter referral code"
              className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700"
            />
          </div>

          <div className="bg-gray-900 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Points Breakdown</h3>
            <p className="text-gray-400 text-sm">
              Points are calculated daily based on your protocol activity.
            </p>
            {/* TODO: Fetch from points API and display breakdown */}
          </div>
        </>
      )}
    </div>
  );
}

export default PointsPage;

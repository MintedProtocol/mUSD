// Landing Page — protocol overview and call-to-action
// Populated stub file (was 0-byte)

import React from "react";

export function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-5xl font-bold mb-4">
        Minted <span className="text-blue-400">mUSD</span>
      </h1>
      <p className="text-xl text-gray-400 max-w-2xl mb-8">
        Institutional-grade stablecoin bridging Canton Network tokenized assets to
        Ethereum DeFi. Mint, stake, borrow, and earn yield across chains.
      </p>
      <div className="flex gap-4">
        <a
          href="/mint"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition"
        >
          Start Minting
        </a>
        <a
          href="/stake"
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition"
        >
          Stake mUSD
        </a>
      </div>
      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl">
        <div className="p-6 bg-gray-900 rounded-xl">
          <h3 className="text-lg font-semibold mb-2">Cross-Chain</h3>
          <p className="text-gray-400 text-sm">
            Bridge between Canton Network and Ethereum with institutional-grade attestation security.
          </p>
        </div>
        <div className="p-6 bg-gray-900 rounded-xl">
          <h3 className="text-lg font-semibold mb-2">Yield Bearing</h3>
          <p className="text-gray-400 text-sm">
            Stake mUSD as smUSD to earn yield from multi-strategy treasury allocations.
          </p>
        </div>
        <div className="p-6 bg-gray-900 rounded-xl">
          <h3 className="text-lg font-semibold mb-2">DeFi Native</h3>
          <p className="text-gray-400 text-sm">
            Borrow against collateral, leverage positions, and participate in liquidations.
          </p>
        </div>
      </div>
    </div>
  );
}

export default LandingPage;

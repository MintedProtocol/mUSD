import React, { useState } from "react";
import { ethers } from "ethers";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { TxButton } from "@/components/TxButton";
import { useCantonLedger, cantonCreate } from "@/hooks/useCantonLedger";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import { useLoopWallet } from "@/hooks/useLoopWallet";
import { CONTRACTS, USDC_DECIMALS, CHAIN_ID } from "@/lib/config";
import { formatToken } from "@/lib/format";

const PACKAGE_ID = process.env.NEXT_PUBLIC_DAML_PACKAGE_ID || "";
const CIP56_PACKAGE_ID = process.env.NEXT_PUBLIC_CIP56_PACKAGE_ID || "";
const CANTON_OPERATOR_PARTY =
  process.env.NEXT_PUBLIC_CANTON_OPERATOR_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";
const CIP56_FAUCET_AGREEMENT_HASH = process.env.NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_HASH || "";
const CIP56_FAUCET_AGREEMENT_URI = process.env.NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_URI || "";
const CIP56_CONFIGURED = Boolean(CIP56_PACKAGE_ID && CIP56_FAUCET_AGREEMENT_HASH && CIP56_FAUCET_AGREEMENT_URI);

/** Fully-qualified DAML template IDs */
const CANTON_TEMPLATES = {
  CantonUSDC: `${PACKAGE_ID}:CantonDirectMint:CantonUSDC`,
  USDCx: `${PACKAGE_ID}:CantonDirectMint:USDCx`,
  CantonCoin: `${PACKAGE_ID}:CantonCoinToken:CantonCoin`,
};

type TokenType = "CantonUSDC" | "USDCx" | "CantonCoin";

const TOKEN_INFO: Record<TokenType, { label: string; description: string; gradient: string; defaultAmount: string }> = {
  CantonUSDC: {
    label: "Canton USDC",
    description: "Native USDC representation on Canton Network",
    gradient: "from-blue-500 to-cyan-500",
    defaultAmount: "10000",
  },
  USDCx: {
    label: "USDCx (xReserve)",
    description: "Circle CCTP-bridged USDC via xReserve on Canton",
    gradient: "from-indigo-500 to-blue-500",
    defaultAmount: "10000",
  },
  CantonCoin: {
    label: "Canton Coin",
    description: "Native Canton validator coin token",
    gradient: "from-amber-500 to-orange-500",
    defaultAmount: "1000",
  },
};

export function DevnetFaucet() {
  const loopWallet = useLoopWallet();
  const activeParty = loopWallet.partyId || null;
  const { data, loading, refresh } = useCantonLedger(15_000, activeParty);
  const { address, isConnected } = useUnifiedWallet();
  const contracts = useWCContracts();

  const [amounts, setAmounts] = useState<Record<TokenType, string>>({
    CantonUSDC: "10000",
    USDCx: "10000",
    CantonCoin: "1000",
  });
  const [cip56Amount, setCip56Amount] = useState("1000");
  const [mintingToken, setMintingToken] = useState<TokenType | "evm-usdc" | "cip56-musd" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evmUsdcBal, setEvmUsdcBal] = useState<bigint | null>(null);

  // Load EVM USDC balance
  React.useEffect(() => {
    async function load() {
      if (contracts.usdc && address) {
        const bal = await contracts.usdc.balanceOf(address);
        setEvmUsdcBal(bal);
      }
    }
    load();
  }, [contracts.usdc, address]);

  const party = activeParty || "";

  async function handleCantonMint(tokenType: TokenType) {
    const amt = amounts[tokenType];
    if (!amt || parseFloat(amt) <= 0 || !party) return;

    setMintingToken(tokenType);
    setError(null);
    setResult(null);

    try {
      const templateId = CANTON_TEMPLATES[tokenType];

      // Build payload based on token type
      let payload: Record<string, unknown>;

      if (tokenType === "USDCx") {
        payload = {
          issuer: CANTON_OPERATOR_PARTY,
          owner: party,
          amount: amt,
          sourceChain: "devnet-faucet",
          cctpNonce: Date.now(),
          privacyObservers: [] as string[],
        };
      } else if (tokenType === "CantonCoin") {
        payload = {
          issuer: CANTON_OPERATOR_PARTY,
          owner: party,
          amount: amt,
          privacyObservers: [] as string[],
        };
      } else {
        // CantonUSDC
        payload = {
          issuer: CANTON_OPERATOR_PARTY,
          owner: party,
          amount: amt,
          privacyObservers: [] as string[],
        };
      }

      const resp = await cantonCreate(templateId, payload, { party });
      if (!resp.success) throw new Error(resp.error || "Canton create failed");

      setResult(`✅ Minted ${amt} ${TOKEN_INFO[tokenType].label} on Canton`);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMintingToken(null);
    }
  }

  async function handleEvmUsdcMint() {
    if (!contracts.usdc || !address) return;
    setMintingToken("evm-usdc");
    setError(null);
    setResult(null);

    try {
      const amount = ethers.parseUnits("10000", USDC_DECIMALS);
      const tx = await (contracts.usdc as any).mint(address, amount, { gasLimit: 100_000 });
      await tx.wait(1);
      const newBal = await contracts.usdc.balanceOf(address);
      setEvmUsdcBal(newBal);
      setResult("✅ Minted 10,000 Test USDC on Sepolia (EVM)");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMintingToken(null);
    }
  }

  async function handleCip56Mint() {
    const amt = cip56Amount;
    if (!amt || parseFloat(amt) <= 0 || !party) return;

    setMintingToken("cip56-musd");
    setError(null);
    setResult(null);

    try {
      // Use short name — API resolves via TEMPLATE_MAP and normalizes payload
      const payload: Record<string, unknown> = {
        issuer: CANTON_OPERATOR_PARTY,
        owner: party,
        amount: amt,
        blacklisted: false,
        observers: [],
        agreementHash: CIP56_FAUCET_AGREEMENT_HASH,
        agreementUri: CIP56_FAUCET_AGREEMENT_URI,
      };

      const resp = await cantonCreate("CIP56MintedMUSD", payload, { party });
      if (!resp.success) throw new Error(resp.error || "CIP-56 faucet create failed");

      setResult(`Minted ${amt} CIP-56 mUSD on Canton`);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMintingToken(null);
    }
  }

  const totalUsdc = data ? parseFloat(data.totalUsdc) : 0;
  const pureUsdc = data ? parseFloat(data.usdcBalance || "0") : 0;
  const usdcxOnly = data ? parseFloat(data.usdcxBalance || "0") : 0;
  const totalCoin = data ? parseFloat(data.totalCoin) : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Devnet Faucet"
        subtitle="Mint test tokens for development — Canton USDC, USDCx, Canton Coin, and EVM USDC"
        badge="🚰 Faucet"
        badgeColor="warning"
        action={
          <button
            onClick={refresh}
            className="flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-400 hover:bg-yellow-500/20"
          >
            <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        }
      />

      {/* Current Balances */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Canton USDC + USDCx (combined)"
          value={totalUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          subValue={`${pureUsdc.toFixed(0)} USDC (${data?.usdcContractCount ?? 0}) / ${usdcxOnly.toFixed(0)} USDCx (${data?.usdcxContractCount ?? 0})`}
          color="blue"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Canton Coin"
          value={totalCoin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          subValue={`${data?.cantonCoinTokens.length || 0} contracts`}
          color="yellow"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />
        <StatCard
          label="Canton mUSD"
          value={data ? parseFloat(data.totalBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
          subValue={`${data?.tokenCount || 0} contracts`}
          color="green"
        />
        <StatCard
          label="EVM USDC (Sepolia)"
          value={evmUsdcBal !== null ? formatToken(evmUsdcBal, 6) : "—"}
          subValue={isConnected ? "Wallet connected" : "Not connected"}
          color="purple"
        />
      </div>

      {/* Canton Token Faucets */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          Canton Network Tokens
        </h3>

        {!party && (
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-yellow-300">
            Canton ledger loading… Faucet will be available once connected.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-1">
          {(Object.keys(TOKEN_INFO) as TokenType[]).map((tokenType) => {
            const info = TOKEN_INFO[tokenType];
            return (
              <div key={tokenType} className="card-gradient-border overflow-hidden">
                <div className="flex items-center gap-4 p-5">
                  {/* Token Icon */}
                  <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${info.gradient}`}>
                    {tokenType === "CantonCoin" ? (
                      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    ) : (
                      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                  </div>

                  {/* Token Info */}
                  <div className="flex-1">
                    <h4 className="font-semibold text-white">{info.label}</h4>
                    <p className="text-xs text-gray-400">{info.description}</p>
                  </div>

                  {/* Amount Input */}
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      className="w-32 rounded-lg border border-white/10 bg-surface-800/50 px-3 py-2 text-right text-sm font-semibold text-white placeholder-gray-600 focus:border-yellow-500/50 focus:outline-none"
                      value={amounts[tokenType]}
                      onChange={(e) => setAmounts((prev) => ({ ...prev, [tokenType]: e.target.value }))}
                      placeholder={info.defaultAmount}
                    />

                    {/* Mint Button */}
                    <button
                      className={`rounded-lg bg-gradient-to-r ${info.gradient} px-5 py-2 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50`}
                      onClick={() => handleCantonMint(tokenType)}
                      disabled={!party || mintingToken !== null}
                    >
                      {mintingToken === tokenType ? (
                        <span className="flex items-center gap-2">
                          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Minting…
                        </span>
                      ) : (
                        "🚰 Mint"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CIP-56 mUSD Faucet */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          CIP-56 mUSD (Primary Standard)
        </h3>

        <div className="card-gradient-border overflow-hidden">
          <div className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-white">CIP-56 mUSD</h4>
              <p className="text-xs text-gray-400">
                Canton Network standard token. Primary balance for transfers and settlement.
              </p>
              {data && (
                <p className="text-xs text-emerald-400 mt-1">
                  Balance: {parseFloat(data.cip56Balance || "0").toLocaleString(undefined, { maximumFractionDigits: 2 })} mUSD
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                className="w-32 rounded-lg border border-white/10 bg-surface-800/50 px-3 py-2 text-right text-sm font-semibold text-white placeholder-gray-600 focus:border-green-500/50 focus:outline-none"
                value={cip56Amount}
                onChange={(e) => setCip56Amount(e.target.value)}
                placeholder="1000"
              />
              <button
                className="rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50"
                onClick={handleCip56Mint}
                disabled={!party || mintingToken !== null || !CIP56_CONFIGURED}
                title={!CIP56_CONFIGURED ? "Set NEXT_PUBLIC_CIP56_PACKAGE_ID, NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_HASH, and NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_URI" : ""}
              >
                {mintingToken === "cip56-musd" ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Minting...
                  </span>
                ) : (
                  "Mint CIP-56"
                )}
              </button>
            </div>
          </div>
          {!CIP56_CONFIGURED && (
            <div className="border-t border-white/5 bg-yellow-500/5 px-5 py-3 text-xs text-yellow-400">
              CIP-56 faucet requires env config: NEXT_PUBLIC_CIP56_PACKAGE_ID, NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_HASH, NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_URI
            </div>
          )}
        </div>
      </div>

      {/* EVM USDC Faucet */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Ethereum (Sepolia) Tokens
        </h3>

        <div className="card-gradient-border overflow-hidden">
          <div className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-purple-600">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-white">Test USDC (Sepolia)</h4>
              <p className="text-xs text-gray-400">MockERC20 on Sepolia — mint 10,000 per click. Requires MetaMask connected to Sepolia.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-gray-400">
                {evmUsdcBal !== null ? formatToken(evmUsdcBal, 6) : "—"} USDC
              </span>
              <button
                className="rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50"
                onClick={handleEvmUsdcMint}
                disabled={!isConnected || !contracts.usdc || mintingToken !== null}
              >
                {mintingToken === "evm-usdc" ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Minting…
                  </span>
                ) : (
                  "🚰 Mint 10,000"
                )}
              </button>
            </div>
          </div>
          {!isConnected && (
            <div className="border-t border-white/5 bg-yellow-500/5 px-5 py-3 text-xs text-yellow-400">
              Connect MetaMask to Sepolia to use the EVM faucet.
            </div>
          )}
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="alert-error flex items-center gap-3 rounded-xl p-4">
          <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm">{error}</span>
        </div>
      )}
      {result && (
        <div className="alert-success flex items-center gap-3 rounded-xl p-4">
          <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm">{result}</span>
        </div>
      )}

      {/* How It Works */}
      <div className="rounded-xl border border-white/10 bg-surface-800/30 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">How the Devnet Faucet Works</h3>
        <div className="grid gap-4 sm:grid-cols-2 text-xs text-gray-400">
          <div className="space-y-2">
            <p className="font-medium text-emerald-400">Canton Tokens</p>
            <p>Canton tokens (USDC, USDCx, Coin) are DAML contracts created directly on the Canton ledger via the operator party. They represent tokenized assets on the Canton Network layer.</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>Canton USDC</strong> — Native USDC representation for Canton DeFi</li>
              <li><strong>USDCx</strong> — Circle CCTP-bridged USDC via xReserve</li>
              <li><strong>Canton Coin</strong> — Validator coin (swap to mUSD via CoinMint)</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-blue-400">EVM Tokens</p>
            <p>EVM Test USDC is a MockERC20 contract on Sepolia with a public <code className="text-gray-300">mint()</code> function. Use it to get USDC for minting mUSD via DirectMint on Ethereum.</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>Test USDC</strong> — {CONTRACTS.USDC?.slice(0, 10)}… on Sepolia</li>
              <li>Anyone can mint unlimited amounts</li>
              <li>Use on the Mint page to get mUSD</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

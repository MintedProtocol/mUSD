import React, { useState, useEffect, useCallback } from "react";
import { ethers, Contract } from "ethers";
import { PageHeader } from "@/components/PageHeader";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import { CONTRACTS, USDC_DECIMALS, MUSD_DECIMALS } from "@/lib/config";
import WalletConnector from "@/components/WalletConnector";

// MockERC20 has a public mint(address, uint256)
const MOCK_ERC20_ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
] as const;

interface TokenFaucet {
  key: string;
  label: string;
  symbol: string;
  description: string;
  address: string;
  decimals: number;
  defaultAmount: string;
  gradient: string;
  icon: string;
}

const FAUCET_TOKENS: TokenFaucet[] = [
  {
    key: "usdc",
    label: "Mock USDC",
    symbol: "USDC",
    description: "Testnet USDC — mint freely, then use Mint page to swap to mUSD",
    address: CONTRACTS.USDC,
    decimals: USDC_DECIMALS,
    defaultAmount: "10000",
    gradient: "from-blue-500 to-cyan-500",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    key: "usdt",
    label: "Mock USDT",
    symbol: "USDT",
    description: "Testnet USDT — mint freely for ETH Pool deposits and testing",
    address: CONTRACTS.USDT,
    decimals: 6,
    defaultAmount: "10000",
    gradient: "from-green-500 to-emerald-500",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    key: "musd",
    label: "mUSD (via DirectMint)",
    symbol: "mUSD",
    description: "Mints USDC then swaps through DirectMint contract to get mUSD",
    address: CONTRACTS.MUSD,
    decimals: MUSD_DECIMALS,
    defaultAmount: "1000",
    gradient: "from-brand-500 to-purple-500",
    icon: "M9 7h6l2 4H7l2-4zM12 15v4m-4-4h8",
  },
];

interface MintState {
  minting: boolean;
  success: string | null;
  error: string | null;
}

export function FaucetPage() {
  const { address, isConnected, signer, provider, chainId } = useUnifiedWallet();
  const contracts = useWCContracts();
  const [amounts, setAmounts] = useState<Record<string, string>>({
    usdc: "10000",
    usdt: "10000",
    musd: "1000",
  });
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [states, setStates] = useState<Record<string, MintState>>({});
  const [ethBalance, setEthBalance] = useState<string>("0");

  const loadBalances = useCallback(async () => {
    if (!address || !provider) return;
    try {
      const ethBal = await provider.getBalance(address);
      setEthBalance(ethers.formatEther(ethBal));

      const bals: Record<string, bigint> = {};
      for (const token of FAUCET_TOKENS) {
        if (!token.address) continue;
        try {
          const c = new Contract(token.address, MOCK_ERC20_ABI, provider);
          bals[token.key] = await c.balanceOf(address);
        } catch {
          bals[token.key] = 0n;
        }
      }
      setBalances(bals);
    } catch (err) {
      console.error("Failed to load balances:", err);
    }
  }, [address, provider]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  async function handleMintUSDC() {
    if (!signer || !address) return;
    const amt = amounts.usdc;
    if (!amt || parseFloat(amt) <= 0) return;

    setStates((s) => ({ ...s, usdc: { minting: true, success: null, error: null } }));
    try {
      const usdcContract = new Contract(CONTRACTS.USDC, MOCK_ERC20_ABI, signer);
      const parsed = ethers.parseUnits(amt, USDC_DECIMALS);
      const tx = await usdcContract.mint(address, parsed);
      await tx.wait();
      setStates((s) => ({
        ...s,
        usdc: { minting: false, success: `Minted ${amt} USDC`, error: null },
      }));
      loadBalances();
    } catch (err: any) {
      setStates((s) => ({
        ...s,
        usdc: { minting: false, success: null, error: err?.reason || err?.message || "Mint failed" },
      }));
    }
  }

  async function handleMintUSDT() {
    if (!signer || !address) return;
    const amt = amounts.usdt;
    if (!amt || parseFloat(amt) <= 0) return;

    setStates((s) => ({ ...s, usdt: { minting: true, success: null, error: null } }));
    try {
      const usdtContract = new Contract(CONTRACTS.USDT, MOCK_ERC20_ABI, signer);
      const parsed = ethers.parseUnits(amt, 6);
      const tx = await usdtContract.mint(address, parsed);
      await tx.wait();
      setStates((s) => ({
        ...s,
        usdt: { minting: false, success: `Minted ${amt} USDT`, error: null },
      }));
      loadBalances();
    } catch (err: any) {
      setStates((s) => ({
        ...s,
        usdt: { minting: false, success: null, error: err?.reason || err?.message || "Mint failed" },
      }));
    }
  }

  async function handleMintMUSD() {
    if (!signer || !address) return;
    const amt = amounts.musd;
    if (!amt || parseFloat(amt) <= 0) return;

    setStates((s) => ({ ...s, musd: { minting: true, success: null, error: null } }));
    try {
      // Step 1: Mint USDC
      const usdcContract = new Contract(CONTRACTS.USDC, MOCK_ERC20_ABI, signer);
      const usdcAmount = ethers.parseUnits(amt, USDC_DECIMALS);
      const mintTx = await usdcContract.mint(address, usdcAmount);
      await mintTx.wait();

      // Step 2: Approve DirectMint to spend USDC
      const usdcFull = new Contract(
        CONTRACTS.USDC,
        [...MOCK_ERC20_ABI, "function approve(address spender, uint256 amount) returns (bool)"],
        signer,
      );
      const approveTx = await usdcFull.approve(CONTRACTS.DirectMint, usdcAmount);
      await approveTx.wait();

      // Step 3: Call DirectMint.mint(usdcAmount)
      const directMint = new Contract(
        CONTRACTS.DirectMint,
        ["function mint(uint256 usdcAmount) returns (uint256)"],
        signer,
      );
      const dmTx = await directMint.mint(usdcAmount);
      await dmTx.wait();

      setStates((s) => ({
        ...s,
        musd: { minting: false, success: `Minted ~${amt} mUSD (via USDC → DirectMint)`, error: null },
      }));
      loadBalances();
    } catch (err: any) {
      setStates((s) => ({
        ...s,
        musd: {
          minting: false,
          success: null,
          error: err?.reason || err?.message || "Mint failed",
        },
      }));
    }
  }

  if (!isConnected) {
    return <WalletConnector mode="ethereum" />;
  }

  const isWrongChain = chainId !== 11155111;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Testnet Faucet"
        subtitle="Get test tokens on Sepolia to try out the protocol"
        badge="Sepolia"
        badgeColor="brand"
      />

      {isWrongChain && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-sm text-yellow-300">
              Please switch to <strong>Sepolia</strong> network in your wallet. Current chain ID: {chainId}
            </p>
          </div>
        </div>
      )}

      {/* ETH Balance & External Faucet */}
      <div className="rounded-xl border border-white/10 bg-surface-800/50 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-gray-400 to-gray-600">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Sepolia ETH</h3>
              <p className="text-sm text-gray-400">Required for gas fees on all transactions</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white">{parseFloat(ethBalance).toFixed(4)} ETH</p>
            <a
              href="https://www.alchemy.com/faucets/ethereum-sepolia"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-brand-500/20 px-4 py-2 text-sm font-medium text-brand-400 transition-colors hover:bg-brand-500/30"
            >
              Get Sepolia ETH
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* Token Faucets */}
      <div className="space-y-4">
        {FAUCET_TOKENS.map((token) => {
          const state = states[token.key] || { minting: false, success: null, error: null };
          const balance = balances[token.key];
          const formattedBalance = balance !== undefined
            ? parseFloat(ethers.formatUnits(balance, token.decimals)).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })
            : "—";

          return (
            <div key={token.key} className="rounded-xl border border-white/10 bg-surface-800/50 p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${token.gradient}`}>
                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={token.icon} />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{token.label}</h3>
                    <p className="text-sm text-gray-400">{token.description}</p>
                  </div>
                </div>
                <p className="text-right text-lg font-bold text-white">
                  {formattedBalance} {token.symbol}
                </p>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <input
                    type="number"
                    value={amounts[token.key] || ""}
                    onChange={(e) => setAmounts((a) => ({ ...a, [token.key]: e.target.value }))}
                    placeholder="Amount"
                    className="w-full rounded-lg border border-white/10 bg-surface-900/50 px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                    {token.symbol}
                  </span>
                </div>
                <button
                  onClick={token.key === "usdc" ? handleMintUSDC : token.key === "usdt" ? handleMintUSDT : handleMintMUSD}
                  disabled={state.minting || isWrongChain}
                  className={`flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r ${token.gradient} px-6 py-3 font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {state.minting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      {token.key === "musd" ? "Minting USDC → mUSD..." : "Minting..."}
                    </>
                  ) : (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Mint {token.symbol}
                    </>
                  )}
                </button>
              </div>

              {state.success && (
                <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
                  ✓ {state.success}
                </div>
              )}
              {state.error && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
                  ✗ {state.error}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info Box */}
      <div className="rounded-xl border border-white/5 bg-surface-800/30 p-6">
        <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">How it works</h4>
        <div className="space-y-2 text-sm text-gray-400">
          <p>
            <span className="font-medium text-white">USDC:</span> Calls <code className="rounded bg-surface-900 px-1.5 py-0.5 text-xs text-brand-400">MockERC20.mint()</code> — unlimited, instant.
          </p>
          <p>
            <span className="font-medium text-white">USDT:</span> Same as USDC — calls <code className="rounded bg-surface-900 px-1.5 py-0.5 text-xs text-brand-400">MockERC20.mint()</code> on the USDT contract.
          </p>
          <p>
            <span className="font-medium text-white">mUSD:</span> Mints USDC first, approves the DirectMint contract, then swaps USDC → mUSD (minus protocol fee).
          </p>
          <p>
            <span className="font-medium text-white">ETH:</span> Use an external Sepolia faucet — <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">Alchemy</a>, <a href="https://sepoliafaucet.com" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">sepoliafaucet.com</a>, or <a href="https://faucets.chain.link/sepolia" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">Chainlink</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

export default FaucetPage;

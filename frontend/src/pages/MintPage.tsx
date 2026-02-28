import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { TxButton } from "@/components/TxButton";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { useTx } from "@/hooks/useTx";
import { formatUSD, formatToken, formatBps } from "@/lib/format";
import { CONTRACTS, USDC_DECIMALS, MUSD_DECIMALS, CHAIN_ID } from "@/lib/config";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import WalletConnector from "@/components/WalletConnector";
import { useMultiChainDeposit, DepositQuote } from "@/hooks/useMultiChainDeposit";
import { requiresBridging, getUSDCDecimals } from "@/lib/chains";
import { SlippageInput } from "@/components/SlippageInput";
import { ERC20_ABI } from "@/abis/ERC20";

type MintAssetSymbol = "USDC" | "USDE" | "WETH" | "WBTC";

type CollateralMintAsset = {
  address: string;
  symbol: MintAssetSymbol;
  decimals: number;
  balance: bigint;
  factorBps: bigint;
  enabled: boolean;
};

export function MintPage() {
  const { address, signer, isConnected } = useUnifiedWallet();
  const contracts = useWCContracts();
  const multiChain = useMultiChainDeposit();

  const [tab, setTab] = useState<"mint" | "redeem">("mint");
  const [mintAsset, setMintAsset] = useState<MintAssetSymbol>("USDC");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<{ output: bigint; fee: bigint } | null>(null);
  const [depositQuote, setDepositQuote] = useState<DepositQuote | null>(null);
  const [showCrossChain, setShowCrossChain] = useState(false);
  const [stats, setStats] = useState({
    mintFee: 0n,
    redeemFee: 0n,
    remaining: 0n,
    available: 0n,
    usdcBal: 0n,
    musdBal: 0n,
    minMint: 0n,
    maxMint: 0n,
    minRedeem: 0n,
    maxRedeem: 0n,
  });
  const tx = useTx();
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [slippageBps, setSlippageBps] = useState(50);
  const [collateralMintAssets, setCollateralMintAssets] = useState<Partial<Record<MintAssetSymbol, CollateralMintAsset>>>({});

  const { directMint, usdc, musd, vault, oracle, borrow } = contracts;
  const selectedCollateralAsset = mintAsset === "USDC" ? null : collateralMintAssets[mintAsset];
  const isCollateralMint = tab === "mint" && mintAsset !== "USDC";
  const collateralMintUnavailable = isCollateralMint && !selectedCollateralAsset;

  const requestedCollateralSymbols: MintAssetSymbol[] = ["USDE", "WETH", "WBTC"];

  const mintAssetOptions = [
    { symbol: "USDC" as const, enabled: true, label: "USDC" },
    ...requestedCollateralSymbols.map((symbol) => ({
      symbol,
      enabled: !!collateralMintAssets[symbol],
      label: symbol,
    })),
  ];

  // Testnet faucet: mint test USDC (MockERC20 has public mint)
  async function handleFaucetMint() {
    if (!usdc || !address) return;
    setFaucetLoading(true);
    try {
      const amount = ethers.parseUnits("10000", USDC_DECIMALS);
      const mintTx = await (usdc as any).mint(address, amount, { gasLimit: 100_000 });
      await mintTx.wait(1);
      // Refresh balances
      const newBal = await usdc.balanceOf(address);
      setStats(s => ({ ...s, usdcBal: newBal }));
    } catch (e: any) {
      console.error("Faucet mint failed:", e);
    } finally {
      setFaucetLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      if (!directMint || !address) return;
      const [mintFee, redeemFee, remaining, available, minMint, maxMint, minRedeem, maxRedeem, usdcBal, musdBal] =
        await Promise.all([
          directMint.mintFeeBps(),
          directMint.redeemFeeBps(),
          directMint.remainingMintable(),
          directMint.availableForRedemption(),
          directMint.minMintAmount(),
          directMint.maxMintAmount(),
          directMint.minRedeemAmount(),
          directMint.maxRedeemAmount(),
          usdc?.balanceOf(address) ?? 0n,
          musd?.balanceOf(address) ?? 0n,
        ]);
      setStats({ mintFee, redeemFee, remaining, available, usdcBal, musdBal, minMint, maxMint, minRedeem, maxRedeem });
    }
    load();
  }, [directMint, usdc, musd, address, tx.success]);

  useEffect(() => {
    async function loadCollateralMintAssets() {
      if (!vault || !address || !signer) {
        setCollateralMintAssets({});
        return;
      }

      try {
        const tokens: string[] = await vault.getSupportedTokens();
        const nextAssets: Partial<Record<MintAssetSymbol, CollateralMintAsset>> = {};

        for (const token of tokens) {
          const erc20 = new ethers.Contract(token, ERC20_ABI, signer);
          const [symbolRaw, decimalsRaw, balanceRaw, config] = await Promise.all([
            erc20.symbol().catch(() => ""),
            erc20.decimals().catch(() => 18),
            erc20.balanceOf(address).catch(() => 0n),
            vault.getConfig(token).catch(() => [false, 0n, 0n, 0n]),
          ]);

          const symbol = String(symbolRaw).toUpperCase() as MintAssetSymbol;
          if (!requestedCollateralSymbols.includes(symbol)) continue;

          nextAssets[symbol] = {
            address: token,
            symbol,
            decimals: Number(decimalsRaw),
            balance: BigInt(balanceRaw),
            enabled: Boolean(config[0]),
            factorBps: BigInt(config[1] ?? 0n),
          };
        }

        setCollateralMintAssets(nextAssets);
      } catch (err) {
        console.error("Failed to load collateral mint assets:", err);
        setCollateralMintAssets({});
      }
    }

    loadCollateralMintAssets();
  }, [vault, signer, address, tx.success]);

  useEffect(() => {
    if (mintAsset !== "USDC" && showCrossChain) {
      setShowCrossChain(false);
    }
  }, [mintAsset, showCrossChain]);

  useEffect(() => {
    async function loadPreview() {
      if (!directMint || !amount || parseFloat(amount) <= 0) {
        setPreview(null);
        setDepositQuote(null);
        return;
      }
      try {
        if (tab === "mint") {
          if (mintAsset === "USDC") {
            const parsed = ethers.parseUnits(amount, USDC_DECIMALS);
            const [output, fee] = await directMint.previewMint(parsed);
            setPreview({ output, fee });

            // Also get cross-chain quote if on non-treasury chain
            if (showCrossChain && multiChain.selectedChain) {
              const quote = await multiChain.getDepositQuote(parsed);
              setDepositQuote(quote);
            }
          } else {
            if (!oracle || !selectedCollateralAsset) {
              setPreview(null);
              setDepositQuote(null);
              return;
            }

            const parsed = ethers.parseUnits(amount, selectedCollateralAsset.decimals);
            const collateralUsdValue = await oracle.getValueUsd(selectedCollateralAsset.address, parsed);
            // Preview shows a safer borrow target (90% of currently available borrowing power).
            const borrowCapacity = (BigInt(collateralUsdValue) * selectedCollateralAsset.factorBps) / 10000n;
            const output = (borrowCapacity * 9000n) / 10000n;
            setPreview({ output, fee: 0n });
            setDepositQuote(null);
          }
        } else {
          const parsed = ethers.parseUnits(amount, MUSD_DECIMALS);
          const [output, fee] = await directMint.previewRedeem(parsed);
          setPreview({ output, fee });
          setDepositQuote(null);
        }
      } catch {
        setPreview(null);
        setDepositQuote(null);
      }
    }
    const timer = setTimeout(loadPreview, 300);
    return () => clearTimeout(timer);
  }, [directMint, oracle, selectedCollateralAsset, mintAsset, amount, tab, showCrossChain, multiChain]);

  async function handleMint() {
    if (!amount || parseFloat(amount) <= 0) return;

    // Standard 1:1 direct mint path
    if (mintAsset === "USDC") {
      const parsed = ethers.parseUnits(amount, USDC_DECIMALS);

      // Pre-flight validation
      if (parsed <= 0n) return;
      if (stats.usdcBal < parsed) {
        tx.reset();
        await tx.send(async () => { throw new Error(`Insufficient USDC balance. You have ${formatToken(stats.usdcBal, 6)} USDC but tried to mint with ${amount} USDC.`); });
        return;
      }
      if (parsed < stats.minMint) {
        await tx.send(async () => { throw new Error(`Minimum mint amount is ${formatToken(stats.minMint, 6)} USDC.`); });
        return;
      }
      if (parsed > stats.maxMint) {
        await tx.send(async () => { throw new Error(`Maximum mint amount is ${formatToken(stats.maxMint, 6)} USDC per transaction.`); });
        return;
      }

      // Cross-chain deposit
      if (showCrossChain && multiChain.selectedChain && requiresBridging(multiChain.selectedChain)) {
        const txHash = await multiChain.deposit(parsed);
        if (txHash) setAmount("");
        return;
      }

      if (!directMint || !usdc) return;
      await tx.send(async () => {
        const allowance = await usdc.allowance(address, CONTRACTS.DirectMint);
        if (allowance < parsed) {
          if (allowance > 0n) {
            const resetTx = await usdc.approve(CONTRACTS.DirectMint, 0n);
            await resetTx.wait();
          }
          const approveTx = await usdc.approve(CONTRACTS.DirectMint, parsed);
          await approveTx.wait();
        }
        return directMint.mint(parsed);
      });
      setAmount("");
      return;
    }

    // Collateralized mint path (deposit collateral, then borrow mUSD)
    if (!selectedCollateralAsset || !vault || !borrow || !signer || !address) {
      await tx.send(async () => {
        throw new Error(`${mintAsset} minting is not configured on this network yet.`);
      });
      return;
    }

    const parsedCollateral = ethers.parseUnits(amount, selectedCollateralAsset.decimals);
    if (parsedCollateral <= 0n) return;
    if (selectedCollateralAsset.balance < parsedCollateral) {
      await tx.send(async () => {
        throw new Error(`Insufficient ${mintAsset} balance. You have ${formatToken(selectedCollateralAsset.balance, selectedCollateralAsset.decimals)} ${mintAsset}.`);
      });
      return;
    }

    await tx.send(async () => {
      const token = new ethers.Contract(selectedCollateralAsset.address, ERC20_ABI, signer);
      const allowance = await token.allowance(address, CONTRACTS.CollateralVault);
      if (allowance < parsedCollateral) {
        if (allowance > 0n) {
          const resetTx = await token.approve(CONTRACTS.CollateralVault, 0n);
          await resetTx.wait();
        }
        const approveTx = await token.approve(CONTRACTS.CollateralVault, parsedCollateral);
        await approveTx.wait();
      }

      const depositTx = await vault.deposit(selectedCollateralAsset.address, parsedCollateral);
      await depositTx.wait();

      const availableToBorrow: bigint = await borrow.maxBorrow(address);
      const borrowAmount = (availableToBorrow * 9000n) / 10000n; // 90% buffer
      if (borrowAmount <= 0n) {
        throw new Error("No borrow capacity available after deposit.");
      }

      return borrow.borrow(borrowAmount);
    });

    setAmount("");
  }

  async function handleCrossChainMint() {
    if (!multiChain.selectedChain || !amount) return;
    const decimals = getUSDCDecimals(multiChain.selectedChain.id);
    const parsed = ethers.parseUnits(amount, decimals);
    const txHash = await multiChain.deposit(parsed);
    if (txHash) {
      setAmount("");
    }
  }

  async function handleRedeem() {
    if (!directMint || !musd) return;
    const parsed = ethers.parseUnits(amount, MUSD_DECIMALS);

    if (stats.musdBal < parsed) {
      tx.reset();
      await tx.send(async () => { throw new Error(`Insufficient mUSD balance. You have ${formatToken(stats.musdBal)} mUSD.`); });
      return;
    }

    await tx.send(async () => {
      const allowance = await musd.allowance(address, CONTRACTS.DirectMint);
      if (allowance < parsed) {
        // Reset allowance to 0 first for non-standard tokens (USDT)
        // that revert on non-zero to non-zero approval changes
        if (allowance > 0n) {
          const resetTx = await musd.approve(CONTRACTS.DirectMint, 0n);
          await resetTx.wait();
        }
        const approveTx = await musd.approve(CONTRACTS.DirectMint, parsed);
        await approveTx.wait();
      }
      return directMint.redeem(parsed);
    });
    setAmount("");
  }

  const activeMintBalance = mintAsset === "USDC"
    ? stats.usdcBal
    : (selectedCollateralAsset?.balance ?? 0n);
  const activeMintDecimals = mintAsset === "USDC"
    ? USDC_DECIMALS
    : (selectedCollateralAsset?.decimals ?? 18);
  const usdeAsset = collateralMintAssets.USDE;
  const wethAsset = collateralMintAssets.WETH;
  const wbtcAsset = collateralMintAssets.WBTC;

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader title="Mint & Redeem" subtitle="Mint mUSD with supported assets or redeem mUSD to USDC" badge="Mint" badgeColor="brand" />
        <WalletConnector mode="ethereum" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Mint & Redeem"
        subtitle="Mint with USDC or collateral assets, and redeem mUSD to USDC"
        badge="Ethereum"
        badgeColor="brand"
      />

      {tab === "mint" && mintAsset !== "USDC" && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          {mintAsset} mints use the collateralized path (deposit + borrow).
        </div>
      )}

      {/* Mintable Asset Balances (match Canton Mint layout) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Your USDC"
          value={formatToken(stats.usdcBal, USDC_DECIMALS)}
          color="blue"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Your USDE"
          value={formatToken(usdeAsset?.balance ?? 0n, usdeAsset?.decimals ?? 18)}
          color="purple"
          subValue={usdeAsset ? (usdeAsset.enabled ? "Enabled collateral" : "Collateral disabled") : "Not enabled on vault"}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h10M7 16h6" />
            </svg>
          }
        />
        <StatCard
          label="Your WETH"
          value={formatToken(wethAsset?.balance ?? 0n, wethAsset?.decimals ?? 18)}
          color="yellow"
          subValue={wethAsset ? (wethAsset.enabled ? "Enabled collateral" : "Collateral disabled") : "Not enabled on vault"}
          icon={
            <svg className="h-5 w-5" viewBox="0 0 320 512" fill="currentColor">
              <path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/>
            </svg>
          }
        />
        <StatCard
          label="Your WBTC"
          value={formatToken(wbtcAsset?.balance ?? 0n, wbtcAsset?.decimals ?? 8)}
          color="green"
          subValue={wbtcAsset ? (wbtcAsset.enabled ? "Enabled collateral" : "Collateral disabled") : "Not enabled on vault"}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4l7 4v8l-7 4-7-4V8l7-4z" />
            </svg>
          }
        />
      </div>

      {/* Action Card */}
      <div className="card-gradient-border overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-white/10">
              <button
                className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all duration-300 ${
                  tab === "mint"
                    ? "text-white"
                    : "text-gray-400 hover:text-white"
                }`}
                onClick={() => { setTab("mint"); setAmount(""); }}
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                  Mint mUSD
                </span>
                {tab === "mint" && (
                  <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-500 to-purple-500" />
                )}
              </button>
              <button
                className={`relative flex-1 px-6 py-4 text-center text-sm font-semibold transition-all duration-300 ${
                  tab === "redeem"
                    ? "text-white"
                    : "text-gray-400 hover:text-white"
                }`}
                onClick={() => { setTab("redeem"); setAmount(""); }}
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Redeem USDC
                </span>
                {tab === "redeem" && (
                  <span className="absolute bottom-0 left-1/2 h-0.5 w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-500 to-purple-500" />
                )}
              </button>
            </div>

            {/* Form Content */}
            <div className="space-y-6 p-6">
              {/* Input Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-400">
                    {tab === "mint" ? "You Pay" : "You Redeem"}
                  </label>
                  <span className="text-xs text-gray-500">
                    Balance: {tab === "mint"
                      ? formatToken(activeMintBalance, activeMintDecimals)
                      : formatToken(stats.musdBal)}
                    {" "}
                    {tab === "mint" ? mintAsset : "mUSD"}
                  </span>
                </div>
                {tab === "mint" && (
                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-wider text-gray-500">Mint Asset</label>
                    <select
                      className="input"
                      value={mintAsset}
                      onChange={(e) => setMintAsset(e.target.value as MintAssetSymbol)}
                    >
                      {mintAssetOptions.map((asset) => (
                        <option key={asset.symbol} value={asset.symbol} disabled={!asset.enabled}>
                          {asset.label}{asset.enabled ? "" : " (Not enabled on this network)"}
                        </option>
                      ))}
                    </select>
                    {collateralMintUnavailable && (
                      <p className="text-xs text-yellow-300">
                        {mintAsset} is not currently enabled in the collateral vault on this network.
                      </p>
                    )}
                  </div>
                )}
                <div className="relative rounded-xl border border-white/10 bg-surface-800/50 p-4 transition-all duration-300 focus-within:border-brand-500/50 focus-within:shadow-[0_0_20px_-5px_rgba(51,139,255,0.3)]">
                  <div className="flex items-center gap-4">
                    <input
                      type="number"
                      className="flex-1 bg-transparent text-2xl font-semibold text-white placeholder-gray-600 focus:outline-none"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
                        onClick={() =>
                          setAmount(
                            ethers.formatUnits(
                              tab === "mint" ? activeMintBalance : stats.musdBal,
                              tab === "mint" ? activeMintDecimals : MUSD_DECIMALS
                            )
                          )
                        }
                      >
                        MAX
                      </button>
                      <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                        <div className={`h-6 w-6 rounded-full ${tab === "mint" ? "bg-blue-500" : "bg-gradient-to-br from-brand-500 to-purple-500"}`} />
                        <span className="font-semibold text-white">{tab === "mint" ? mintAsset : "mUSD"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-surface-800">
                  <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              </div>

              {/* Output Section */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-400">You Receive</label>
                <div className="rounded-xl border border-white/10 bg-surface-800/30 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-semibold text-white">
                      {preview ? (tab === "mint"
                        ? formatToken(preview.output)
                        : formatToken(preview.output, 6)
                      ) : "0.00"}
                    </span>
                    <div className="flex items-center gap-2 rounded-full bg-surface-700/50 px-3 py-1.5">
                      <div className={`h-6 w-6 rounded-full ${tab === "mint" ? "bg-gradient-to-br from-brand-500 to-purple-500" : "bg-blue-500"}`} />
                      <span className="font-semibold text-white">{tab === "mint" ? "mUSD" : "USDC"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Fee Details */}
              {preview && (
                <div className="space-y-2 rounded-xl bg-surface-800/30 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Protocol Fee</span>
                    <span className="font-medium text-yellow-400">
                      {tab === "mint" && mintAsset !== "USDC"
                        ? "Collateralized"
                        : formatBps(tab === "mint" ? stats.mintFee : stats.redeemFee)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Fee Amount</span>
                    <span className="text-gray-300">
                      {tab === "mint" && mintAsset !== "USDC"
                        ? "N/A"
                        : `${formatToken(preview.fee, 6)} USDC`}
                    </span>
                  </div>
                  {showCrossChain && depositQuote && (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Bridge Fee</span>
                        <span className="text-gray-300">
                          ~{depositQuote.feePercentage.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Est. Time</span>
                        <span className="text-gray-300">
                          ~{Math.round(depositQuote.bridgeTime / 60)} min
                        </span>
                      </div>
                    </>
                  )}
                  <div className="divider my-2" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">
                      {tab === "mint" && mintAsset !== "USDC" ? "Mint Route" : "Exchange Rate"}
                    </span>
                    <span className="text-gray-300">
                      {tab === "mint" && mintAsset !== "USDC"
                        ? `${mintAsset} collateral → mUSD borrow`
                        : "1 USDC = 1 mUSD"}
                    </span>
                  </div>
                </div>
              )}

              {/* Testnet USDC Faucet */}
              {CHAIN_ID === 11155111 && tab === "mint" && mintAsset === "USDC" && stats.usdcBal === 0n && (
                <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-4">
                  <div className="flex items-center gap-3">
                    <svg className="h-5 w-5 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-yellow-300">No test USDC</p>
                      <p className="text-xs text-yellow-400/70">You need test USDC to mint mUSD on Sepolia.</p>
                    </div>
                  </div>
                  <button
                    className="mt-3 w-full rounded-lg bg-yellow-500/20 px-4 py-2 text-sm font-semibold text-yellow-300 transition-colors hover:bg-yellow-500/30"
                    onClick={handleFaucetMint}
                    disabled={faucetLoading}
                  >
                    {faucetLoading ? "Minting..." : "🚰 Get 10,000 Test USDC"}
                  </button>
                </div>
              )}

              {/* Slippage Tolerance (redeem tab) */}
              {tab === "redeem" && (
                <SlippageInput value={slippageBps} onChange={setSlippageBps} />
              )}

              {/* Action Button */}
              <TxButton
                onClick={mintAsset === "USDC" && showCrossChain && multiChain.selectedChain && requiresBridging(multiChain.selectedChain)
                  ? handleCrossChainMint
                  : (tab === "mint" ? handleMint : handleRedeem)}
                loading={tx.loading || multiChain.isLoading}
                disabled={!amount || parseFloat(amount) <= 0 || collateralMintUnavailable}
                className="w-full"
              >
                <span className="flex items-center justify-center gap-2">
                  {tab === "mint" ? (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                      {mintAsset === "USDC" && showCrossChain && multiChain.selectedChain && requiresBridging(multiChain.selectedChain)
                        ? `Deposit from ${multiChain.selectedChain.name}`
                        : (mintAsset === "USDC" ? "Mint mUSD" : `Deposit ${mintAsset} & Mint mUSD`)}
                    </>
                  ) : (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Redeem USDC
                    </>
                  )}
                </span>
              </TxButton>

              {/* Transaction Status */}
              {(tx.error || multiChain.error) && (
                <div className="alert-error flex items-center gap-3">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm">{(tx.error || multiChain.error || '')
                    .replace('execution reverted (unknown custom error)', 'Transaction failed — check your balance and try again')
                    .replace('user rejected transaction', 'Transaction cancelled by user')}</span>
                </div>
              )}
              {tx.success && (
                <div className="alert-success flex items-center gap-3">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm">
                    Transaction confirmed! {tx.hash && (
                      <a href={`https://${CHAIN_ID === 11155111 ? 'sepolia.' : ''}etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="underline">
                        View on Etherscan
                      </a>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Your mUSD"
          value={formatToken(stats.musdBal)}
          color="purple"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          }
        />
        <StatCard
          label="Remaining Mintable"
          value={formatUSD(stats.remaining)}
          subValue={`Max: ${formatToken(stats.maxMint, 6)} per tx`}
        />
        <StatCard
          label="Available for Redemption"
          value={formatUSD(stats.available, 6)}
          subValue={`Max: ${formatToken(stats.maxRedeem)} per tx`}
        />
      </div>
    </div>
  );
}

export default MintPage;

import React, { useState, useEffect, useCallback } from "react";
import { TxButton } from "@/components/TxButton";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { StatCard } from "@/components/StatCard";
import { useLoopWallet, LoopContract } from "@/hooks/useLoopWallet";
import { cantonCreate, useCantonLedger } from "@/hooks/useCantonLedger";
import WalletConnector from "@/components/WalletConnector";

// DAML template IDs
const PACKAGE_ID = process.env.NEXT_PUBLIC_DAML_PACKAGE_ID || "";
const templates = {
  IssuerRole: `${PACKAGE_ID}:Minted.Protocol.V3:MUSDSupplyService`,
  PriceOracle: `${PACKAGE_ID}:Minted.Protocol.V3:PriceOracle`,
  DirectMintService: `${PACKAGE_ID}:Minted.Protocol.V3:CantonDirectMint`,
  LiquidityPool: `${PACKAGE_ID}:Minted.Protocol.V3:LiquidityPool`,
};

const CANTON_OPERATOR_PARTY =
  process.env.NEXT_PUBLIC_CANTON_OPERATOR_PARTY ||
  "sv::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce";

const CIP56_PACKAGE_ID = process.env.NEXT_PUBLIC_CIP56_PACKAGE_ID || "";
const CIP56_FAUCET_AGREEMENT_HASH = process.env.NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_HASH || "";
const CIP56_FAUCET_AGREEMENT_URI = process.env.NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_URI || "";
const CIP56_CONFIGURED = Boolean(CIP56_PACKAGE_ID && CIP56_FAUCET_AGREEMENT_HASH && CIP56_FAUCET_AGREEMENT_URI);

const CANTON_FAUCET_TEMPLATES = {
  CantonUSDC: `${PACKAGE_ID}:CantonDirectMint:CantonUSDC`,
  USDCx: `${PACKAGE_ID}:CantonDirectMint:USDCx`,
  CantonCoin: `${PACKAGE_ID}:CantonCoinToken:CantonCoin`,
} as const;

export function CantonAdmin() {
  const loopWallet = useLoopWallet();
  const activeParty = loopWallet.partyId || null;
  const { data: balances, refresh: refreshBalances } = useCantonLedger(15_000, activeParty);
  
  const [section, setSection] = useState<"issuer" | "oracle" | "mint" | "pool" | "faucet">("issuer");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Issuer
  const [issuerRoles, setIssuerRoles] = useState<LoopContract[]>([]);
  const [mintOwner, setMintOwner] = useState("");
  const [mintAmount, setMintAmount] = useState("");

  // Oracle
  const [oracleContracts, setOracleContracts] = useState<LoopContract[]>([]);
  const [priceSymbol, setPriceSymbol] = useState("ETH");
  const [priceValue, setPriceValue] = useState("");

  // DirectMintService
  const [mintServices, setMintServices] = useState<LoopContract[]>([]);
  const [newCap, setNewCap] = useState("");
  const [pauseState, setPauseState] = useState(false);

  // Pool
  const [pools, setPools] = useState<LoopContract[]>([]);
  const [swapAmount, setSwapAmount] = useState("");
  const [faucetLoadingKey, setFaucetLoadingKey] = useState<string | null>(null);
  const [faucetAmount, setFaucetAmount] = useState("1000");
  const [cip56FaucetAmount, setCip56FaucetAmount] = useState("1000");

  const loadContracts = useCallback(async () => {
    if (!loopWallet.isConnected) return;
    try {
      const [ir, oc, ms, pl] = await Promise.all([
        loopWallet.queryContracts(templates.IssuerRole).catch(() => []),
        loopWallet.queryContracts(templates.PriceOracle).catch(() => []),
        loopWallet.queryContracts(templates.DirectMintService).catch(() => []),
        loopWallet.queryContracts(templates.LiquidityPool).catch(() => []),
      ]);
      setIssuerRoles(ir);
      setOracleContracts(oc);
      setMintServices(ms);
      setPools(pl);
    } catch (err) {
      console.error("Failed to load contracts:", err);
    }
  }, [loopWallet.isConnected, loopWallet.queryContracts]);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  async function handleFaucetMint(token: keyof typeof CANTON_FAUCET_TEMPLATES, amount: string) {
    const party = activeParty;
    const trimmed = amount.trim();
    const numeric = Number(trimmed);
    if (!party) {
      setError("Connect your Loop wallet party first.");
      return;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Enter a valid faucet amount.");
      return;
    }
    setFaucetLoadingKey(token);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> =
        token === "USDCx"
          ? {
              issuer: CANTON_OPERATOR_PARTY,
              owner: party,
              amount: trimmed,
              sourceChain: "canton-admin-faucet",
              cctpNonce: Date.now(),
              privacyObservers: [] as string[],
            }
          : {
              issuer: CANTON_OPERATOR_PARTY,
              owner: party,
              amount: trimmed,
              privacyObservers: [] as string[],
            };
      const resp = await cantonCreate(CANTON_FAUCET_TEMPLATES[token], payload, { party });
      if (!resp.success) throw new Error(resp.error || "Canton faucet mint failed");
      await Promise.all([refreshBalances(), loadContracts()]);
      setResult(`Minted ${trimmed} ${token} to ${party.split("::")[0]}.`);
    } catch (err: any) {
      setError(err?.message || "Canton faucet mint failed");
    } finally {
      setFaucetLoadingKey(null);
    }
  }

  async function handleCip56FaucetMint(amount: string) {
    const party = activeParty;
    const trimmed = amount.trim();
    const numeric = Number(trimmed);
    if (!party) {
      setError("Connect your Loop wallet party first.");
      return;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Enter a valid faucet amount.");
      return;
    }
    setFaucetLoadingKey("CIP56MintedMUSD");
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        issuer: CANTON_OPERATOR_PARTY,
        owner: party,
        amount: trimmed,
        blacklisted: false,
        observers: [],
        agreementHash: CIP56_FAUCET_AGREEMENT_HASH,
        agreementUri: CIP56_FAUCET_AGREEMENT_URI,
      };
      const resp = await cantonCreate("CIP56MintedMUSD", payload, { party });
      if (!resp.success) throw new Error(resp.error || "CIP-56 faucet mint failed");
      await Promise.all([refreshBalances(), loadContracts()]);
      setResult(`Minted ${trimmed} CIP-56 mUSD to ${party.split("::")[0]}.`);
    } catch (err: any) {
      setError(err?.message || "CIP-56 faucet mint failed");
    } finally {
      setFaucetLoadingKey(null);
    }
  }

  async function handleExercise(templateId: string, cid: string, choice: string, args: any) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await loopWallet.exerciseChoice(templateId, cid, choice, args);
      setResult(`${choice} executed successfully: ${JSON.stringify(res).slice(0, 200)}`);
      await loadContracts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!loopWallet.isConnected) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="max-w-md space-y-6">
          <div className="text-center">
            <h3 className="mb-2 text-xl font-semibold text-white">Connect to Canton</h3>
            <p className="text-gray-400 mb-6">Connect your Loop Wallet to access admin functions.</p>
          </div>
          <WalletConnector mode="canton" />
        </div>
      </div>
    );
  }

  const sections = [
    { key: "issuer" as const, label: "Issuer Role" },
    { key: "oracle" as const, label: "Price Oracle" },
    { key: "mint" as const, label: "Mint Service" },
    { key: "pool" as const, label: "Liquidity Pool" },
    { key: "faucet" as const, label: "Faucet" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Admin Panel"
        subtitle="Manage Canton DAML protocol contracts and services"
        badge="Admin"
        badgeColor="warning"
      />

      <div className="flex gap-2 rounded-xl bg-surface-800/50 p-1.5 border border-white/10">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => { setSection(s.key); setError(null); setResult(null); }}
            className={`relative flex-1 rounded-lg px-4 py-3 text-sm font-semibold transition-all duration-300 ${
              section === s.key
                ? "bg-surface-700 text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-surface-700/50"
            }`}
          >
            {s.label}
            {section === s.key && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-16 -translate-x-1/2 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500" />
            )}
          </button>
        ))}
      </div>

      {error && <div className="alert-error text-sm">{error}</div>}
      {result && <div className="alert-success text-sm">{result}</div>}

      {/* Issuer Role */}
      {section === "issuer" && (
        <div className="space-y-4">
          <StatCard label="Issuer Roles" value={issuerRoles.length.toString()} />
          {issuerRoles.length > 0 && (
            <>
              <div className="card">
                <h3 className="mb-3 font-semibold text-gray-300">Direct Mint (Admin)</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Owner Party</label>
                    <input className="input" type="text" placeholder="Alice::1234..." value={mintOwner} onChange={(e) => setMintOwner(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Amount</label>
                    <input className="input" type="number" placeholder="1000.0" value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} />
                  </div>
                </div>
                <TxButton
                  onClick={() => handleExercise(
                    templates.IssuerRole,
                    issuerRoles[0].contractId,
                    "DirectMint",
                    { owner: mintOwner, amount: mintAmount }
                  )}
                  loading={loading}
                  disabled={!mintOwner || !mintAmount}
                  variant="primary"
                  className="mt-3 w-full"
                >
                  Direct Mint
                </TxButton>
              </div>
              <div className="card">
                <h3 className="mb-3 font-semibold text-gray-300">Mint From Attestation</h3>
                <p className="text-sm text-gray-400">
                  Use this to mint mUSD backed by validated Canton attestations with multi-sig verification.
                  Requires a finalized AttestationRequest contract ID.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Price Oracle */}
      {section === "oracle" && (
        <div className="space-y-4">
          <StatCard label="Oracle Contracts" value={oracleContracts.length.toString()} />
          {oracleContracts.length > 0 && (
            <>
              <div className="card">
                <h3 className="mb-3 font-semibold text-gray-300">Get Price</h3>
                <div>
                  <label className="label">Symbol</label>
                  <input className="input" type="text" placeholder="ETH" value={priceSymbol} onChange={(e) => setPriceSymbol(e.target.value)} />
                </div>
                <TxButton
                  onClick={() => handleExercise(
                    templates.PriceOracle,
                    oracleContracts[0].contractId,
                    "GetPrice",
                    { symbol: priceSymbol }
                  )}
                  loading={loading}
                  variant="secondary"
                  className="mt-3 w-full"
                >
                  Query Price
                </TxButton>
              </div>
              <div className="card">
                <h3 className="mb-3 font-semibold text-gray-300">Update Prices</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Symbol</label>
                    <input className="input" type="text" value={priceSymbol} onChange={(e) => setPriceSymbol(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Price (USD)</label>
                    <input className="input" type="number" placeholder="3500.00" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} />
                  </div>
                </div>
                <TxButton
                  onClick={() => handleExercise(
                    templates.PriceOracle,
                    oracleContracts[0].contractId,
                    "UpdatePrices",
                    { updates: [{ symbol: priceSymbol, price: priceValue }] }
                  )}
                  loading={loading}
                  disabled={!priceValue}
                  variant="primary"
                  className="mt-3 w-full"
                >
                  Update Prices
                </TxButton>
              </div>
            </>
          )}
        </div>
      )}

      {/* Mint Service */}
      {section === "mint" && (
        <div className="space-y-4">
          <StatCard label="Mint Services" value={mintServices.length.toString()} />
          {mintServices.length > 0 && (
            <>
              <div className="card">
                <h3 className="mb-3 font-semibold text-gray-300">Current Config</h3>
                <div className="space-y-2 rounded-xl bg-surface-800/30 p-4">
                  {mintServices[0].payload && Object.entries(mintServices[0].payload).slice(0, 8).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">{key}</span>
                      <span className="font-mono text-xs text-gray-300">{String(val).slice(0, 40)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <h3 className="mb-3 font-semibold text-gray-300">Update Supply Cap</h3>
                <input className="input" type="number" placeholder="10000000" value={newCap} onChange={(e) => setNewCap(e.target.value)} />
                <TxButton
                  onClick={() => handleExercise(
                    templates.DirectMintService,
                    mintServices[0].contractId,
                    "DirectMint_UpdateSupplyCap",
                    { newSupplyCap: newCap }
                  )}
                  loading={loading}
                  disabled={!newCap}
                  variant="primary"
                  className="mt-3 w-full"
                >
                  Update Cap
                </TxButton>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TxButton
                  onClick={() => handleExercise(
                    templates.DirectMintService,
                    mintServices[0].contractId,
                    "DirectMint_SetPaused",
                    { paused: true }
                  )}
                  loading={loading}
                  variant="danger"
                  className="w-full"
                >
                  Pause Service
                </TxButton>
                <TxButton
                  onClick={() => handleExercise(
                    templates.DirectMintService,
                    mintServices[0].contractId,
                    "DirectMint_SetPaused",
                    { paused: false }
                  )}
                  loading={loading}
                  variant="secondary"
                  className="w-full"
                >
                  Unpause Service
                </TxButton>
              </div>
            </>
          )}
        </div>
      )}

      {/* Liquidity Pool */}
      {section === "pool" && (
        <div className="space-y-4">
          <StatCard label="Pools" value={pools.length.toString()} />
          {pools.length > 0 && (
            <>
              <div className="card">
                <h3 className="mb-3 font-semibold text-gray-300">Pool State</h3>
                <div className="space-y-2 rounded-xl bg-surface-800/30 p-4">
                  {pools[0].payload && Object.entries(pools[0].payload).slice(0, 8).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">{key}</span>
                      <span className="font-mono text-xs text-gray-300">{String(val).slice(0, 40)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <h3 className="mb-3 font-semibold text-gray-300">Swap mUSD for Collateral</h3>
                <input className="input" type="number" placeholder="Amount" value={swapAmount} onChange={(e) => setSwapAmount(e.target.value)} />
                <TxButton
                  onClick={() => handleExercise(
                    templates.LiquidityPool,
                    pools[0].contractId,
                    "Pool_SwapMUSDForCollateral",
                    { musdAmount: swapAmount }
                  )}
                  loading={loading}
                  disabled={!swapAmount}
                  variant="primary"
                  className="mt-3 w-full"
                >
                  Swap
                </TxButton>
              </div>
            </>
          )}
        </div>
      )}

      {section === "faucet" && (
        <Section
          title="Canton Faucet"
          subtitle="Devnet-only operator-issued test assets for Canton staking/lending"
        >
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="mUSD" value={balances?.totalBalance || "0"} subValue={`${balances?.tokenCount || 0} contracts`} />
            <StatCard label="USDC + USDCx (combined)" value={balances?.totalUsdc || "0"} subValue={`${parseFloat(balances?.usdcBalance || "0").toFixed(0)} USDC (${balances?.usdcContractCount ?? 0}) / ${parseFloat(balances?.usdcxBalance || "0").toFixed(0)} USDCx (${balances?.usdcxContractCount ?? 0})`} />
            <StatCard label="Canton Coin" value={balances?.totalCoin || "0"} subValue={`${balances?.cantonCoinTokens?.length || 0} contracts`} />
            <StatCard label="Active Party" value={activeParty ? activeParty.split("::")[0] : "Disconnected"} />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="card">
              <h3 className="mb-2 font-semibold text-gray-200">Canton USDC</h3>
              <input className="input" type="number" value={faucetAmount} onChange={(e) => setFaucetAmount(e.target.value)} />
              <TxButton
                onClick={() => handleFaucetMint("CantonUSDC", faucetAmount)}
                loading={faucetLoadingKey === "CantonUSDC"}
                disabled={Boolean(faucetLoadingKey)}
                className="mt-3 w-full"
              >
                Mint USDC
              </TxButton>
            </div>
            <div className="card">
              <h3 className="mb-2 font-semibold text-gray-200">USDCx</h3>
              <input className="input" type="number" value={faucetAmount} onChange={(e) => setFaucetAmount(e.target.value)} />
              <TxButton
                onClick={() => handleFaucetMint("USDCx", faucetAmount)}
                loading={faucetLoadingKey === "USDCx"}
                disabled={Boolean(faucetLoadingKey)}
                className="mt-3 w-full"
              >
                Mint USDCx
              </TxButton>
            </div>
            <div className="card">
              <h3 className="mb-2 font-semibold text-gray-200">Canton Coin</h3>
              <input className="input" type="number" value={faucetAmount} onChange={(e) => setFaucetAmount(e.target.value)} />
              <TxButton
                onClick={() => handleFaucetMint("CantonCoin", faucetAmount)}
                loading={faucetLoadingKey === "CantonCoin"}
                disabled={Boolean(faucetLoadingKey)}
                className="mt-3 w-full"
              >
                Mint CTN
              </TxButton>
            </div>
          </div>

          <div className="mt-4 card">
            <h3 className="mb-2 font-semibold text-gray-200">CIP-56 mUSD (Primary Standard)</h3>
            <p className="text-xs text-gray-400 mb-2">Canton Network standard mUSD token for transfers and settlement.</p>
            <input className="input" type="number" value={cip56FaucetAmount} onChange={(e) => setCip56FaucetAmount(e.target.value)} />
            <TxButton
              onClick={() => handleCip56FaucetMint(cip56FaucetAmount)}
              loading={faucetLoadingKey === "CIP56MintedMUSD"}
              disabled={Boolean(faucetLoadingKey) || !CIP56_CONFIGURED}
              className="mt-3 w-full"
            >
              Mint CIP-56 mUSD
            </TxButton>
            {!CIP56_CONFIGURED && (
              <p className="mt-2 text-xs text-yellow-400">
                Requires: NEXT_PUBLIC_CIP56_PACKAGE_ID, NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_HASH, NEXT_PUBLIC_CIP56_FAUCET_AGREEMENT_URI
              </p>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

// useCantonBoostPool — hook for Canton Network liquidity boost pool interactions
// Populated stub file (was 0-byte)

import { useState, useEffect, useCallback } from "react";
import { useLoopWallet, LoopContract } from "./useLoopWallet";

const PACKAGE_ID = process.env.NEXT_PUBLIC_DAML_PACKAGE_ID || "";
const BOOST_POOL_TEMPLATE = `${PACKAGE_ID}:MintedProtocolV2Fixed:LiquidityPool`;

export interface BoostPoolState {
  isLoading: boolean;
  error: string | null;
  pools: LoopContract[];
  totalLiquidity: string;
  userShare: string;
}

export function useCantonBoostPool() {
  const loopWallet = useLoopWallet();
  const [state, setState] = useState<BoostPoolState>({
    isLoading: false,
    error: null,
    pools: [],
    totalLiquidity: "0",
    userShare: "0",
  });

  const fetchPools = useCallback(async () => {
    if (!loopWallet.isConnected) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const pools = await loopWallet.queryContracts(BOOST_POOL_TEMPLATE);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        pools,
        totalLiquidity: pools.reduce(
          (sum, p) => (BigInt(sum) + BigInt(p.payload?.amount || "0")).toString(),
          "0"
        ),
      }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to fetch boost pools",
      }));
    }
  }, [loopWallet]);

  useEffect(() => {
    fetchPools();
  }, [fetchPools]);

  const deposit = useCallback(
    async (amount: string) => {
      if (!loopWallet.isConnected || state.pools.length === 0) return;
      await loopWallet.exerciseChoice(BOOST_POOL_TEMPLATE, state.pools[0].contractId, "LiquidityPool_Deposit", {
        amount,
      });
      await fetchPools();
    },
    [loopWallet, state.pools, fetchPools]
  );

  const withdraw = useCallback(
    async (amount: string) => {
      if (!loopWallet.isConnected || state.pools.length === 0) return;
      await loopWallet.exerciseChoice(BOOST_POOL_TEMPLATE, state.pools[0].contractId, "LiquidityPool_Withdraw", {
        amount,
      });
      await fetchPools();
    },
    [loopWallet, state.pools, fetchPools]
  );

  return { ...state, deposit, withdraw, refresh: fetchPools };
}

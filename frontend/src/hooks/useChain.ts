import { createContext, useContext, useState, useCallback } from "react";

export type ActiveChain = "ethereum" | "canton";

export interface ChainContextValue {
  chain: ActiveChain;
  toggle: () => void;
  setChain: (c: ActiveChain) => void;
}

export function useChainState(): ChainContextValue {
  const [chain, setChain] = useState<ActiveChain>("ethereum");

  const toggle = useCallback(() => {
    setChain((c) => (c === "ethereum" ? "canton" : "ethereum"));
  }, []);

  return { chain, toggle, setChain };
}

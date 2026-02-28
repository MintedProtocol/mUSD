import React from "react";
import type { ActiveChain } from "@/hooks/useChain";

interface ChainToggleProps {
  chain: ActiveChain;
  onToggle: () => void;
}

export function ChainToggle({ chain, onToggle }: ChainToggleProps) {
  const isEthereum = chain === "ethereum";

  return (
    <button
      onClick={onToggle}
      className="group relative flex items-center gap-2 rounded-xl border border-white/10 bg-surface-800/50 px-4 py-2.5 text-sm font-semibold backdrop-blur-sm transition-all duration-300 hover:border-white/20 hover:bg-surface-700/50"
    >
      {/* Animated background glow */}
      <div
        className={`absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${
          isEthereum
            ? "bg-[radial-gradient(ellipse_at_center,_rgba(51,139,255,0.15)_0%,_transparent_70%)]"
            : "bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.15)_0%,_transparent_70%)]"
        }`}
      />

      {/* Chain indicator */}
      <div className="relative flex items-center gap-2">
        {/* Animated dot */}
        <span
          className={`relative flex h-2.5 w-2.5 items-center justify-center`}
        >
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
              isEthereum ? "bg-brand-400" : "bg-emerald-400"
            }`}
            style={{ animationDuration: "2s" }}
          />
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              isEthereum ? "bg-brand-400" : "bg-emerald-400"
            }`}
          />
        </span>

        {/* Chain name */}
        <span className={isEthereum ? "text-brand-400" : "text-emerald-400"}>
          {isEthereum ? "Ethereum" : "Canton"}
        </span>
      </div>

      {/* Toggle icon */}
      <svg 
        className="h-4 w-4 text-gray-500 transition-all duration-300 group-hover:rotate-180 group-hover:text-gray-300" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={1.5} 
          d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" 
        />
      </svg>
    </button>
  );
}

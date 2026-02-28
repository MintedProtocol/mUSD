import React, { useState } from "react";
import { shortenAddress } from "@/lib/format";
import { ChainToggle } from "./ChainToggle";
import type { ActiveChain } from "@/hooks/useChain";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { key: "mint", label: "Mint", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "stake", label: "Stake", icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
  { key: "borrow", label: "Borrow & Lend", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
  { key: "bridge", label: "Bridge", icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" },
  { key: "faucet", label: "Faucet", icon: "M12 3v6m0 0a4 4 0 104 4v-2a4 4 0 10-8 0v2a4 4 0 004 4m0-8v12" },
  { key: "points", label: "Points", icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" },
  { key: "admin", label: "Admin", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

interface NavbarProps {
  address: string | null;
  onEthConnect: () => void;
  onEthDisconnect: () => void;
  isEthConnecting?: boolean;
  activePage: string;
  onNavigate: (page: string) => void;
  chain: ActiveChain;
  onToggleChain: () => void;
  cantonParty: string | null;
  onCantonConnect: () => void;
  onCantonDisconnect: () => void;
  isCantonConnecting?: boolean;
}

export function Navbar({
  address,
  onEthConnect,
  onEthDisconnect,
  isEthConnecting = false,
  activePage,
  onNavigate,
  chain,
  onToggleChain,
  cantonParty,
  onCantonConnect,
  onCantonDisconnect,
  isCantonConnecting = false,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const loopWalletNumber = React.useMemo(() => {
    if (!cantonParty) return null;
    const [partyName] = cantonParty.split("::");
    if (!partyName) return cantonParty;

    const mintedUserPrefix = "minted-user-";
    if (partyName.startsWith(mintedUserPrefix)) {
      return partyName.slice(mintedUserPrefix.length);
    }

    return partyName;
  }, [cantonParty]);

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-surface-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <button 
              onClick={() => onNavigate("dashboard")} 
              className="group flex items-center gap-2"
            >
              {/* Logo Icon */}
              <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 shadow-glow-sm transition-all duration-300 group-hover:shadow-glow-md">
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-xl font-bold">
                <span className="text-white">Minted</span>
                <span className="text-gradient">Protocol</span>
              </span>
            </button>

            {/* Desktop Nav */}
            <div className="hidden items-center gap-1 lg:flex">
              {NAV_ITEMS.map((item) => {
                const isActive = activePage === item.key;
                const activeColor = chain === "ethereum" ? "text-brand-400" : "text-emerald-400";
                const activeBg = chain === "ethereum" ? "bg-brand-500/10" : "bg-emerald-500/10";
                
                return (
                  <button
                    key={item.key}
                    onClick={() => onNavigate(item.key)}
                    className={`group relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300 ${
                      isActive
                        ? `${activeColor} ${activeBg}`
                        : "text-gray-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                    </svg>
                    {item.label}
                    {isActive && (
                      <span 
                        className={`absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full ${
                          chain === "ethereum" ? "bg-brand-500" : "bg-emerald-500"
                        }`} 
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-3">
            <ChainToggle chain={chain} onToggle={onToggleChain} />

            {loopWalletNumber ? (
              <button
                onClick={onCantonDisconnect}
                className="group flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition-all duration-300 hover:border-emerald-500/50 hover:bg-emerald-500/20"
                title={cantonParty ?? "Disconnect Loop wallet"}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                <span className="max-w-[240px] truncate">Loop #{loopWalletNumber}</span>
                <svg
                  className="h-4 w-4 text-emerald-300/80 transition-colors group-hover:text-emerald-200"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            ) : chain === "ethereum" ? (
              address ? (
                <button
                  onClick={onEthDisconnect}
                  className="group flex items-center gap-2 rounded-xl border border-white/10 bg-surface-800/50 px-3 py-2 text-xs font-medium text-gray-200 backdrop-blur-sm transition-all duration-300 hover:border-white/20 hover:bg-surface-700/50"
                  title="Disconnect Ethereum wallet"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                  ETH {shortenAddress(address)}
                  <svg
                    className="h-4 w-4 text-gray-500 transition-colors group-hover:text-gray-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={onEthConnect}
                  disabled={isEthConnecting}
                  className="rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-xs font-semibold text-brand-300 transition-all duration-300 hover:border-brand-500/50 hover:bg-brand-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isEthConnecting ? "Connecting ETH..." : "Connect ETH"}
                </button>
              )
            ) : (
              <button
                onClick={onCantonConnect}
                disabled={isCantonConnecting}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-all duration-300 hover:border-emerald-500/50 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCantonConnecting ? "Connecting Loop..." : "Connect Loop"}
              </button>
            )}

            {/* Mobile Menu Button */}
            <button
              className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-white lg:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileOpen && (
          <div className="animate-slide-down border-t border-white/10 bg-surface-900/95 backdrop-blur-xl lg:hidden">
            <div className="space-y-1 px-4 py-4">
              {NAV_ITEMS.map((item) => {
                const isActive = activePage === item.key;
                const activeColor = chain === "ethereum" ? "text-brand-400" : "text-emerald-400";
                const activeBg = chain === "ethereum" ? "bg-brand-500/10" : "bg-emerald-500/10";
                
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      onNavigate(item.key);
                      setMobileOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? `${activeColor} ${activeBg}`
                        : "text-gray-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                    </svg>
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </nav>
    </>
  );
}

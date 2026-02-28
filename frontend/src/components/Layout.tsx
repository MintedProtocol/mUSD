import React from "react";
import { Navbar } from "./Navbar";
import type { ActiveChain } from "@/hooks/useChain";

interface LayoutProps {
  children: React.ReactNode;
  address: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
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

export function Layout({
  children,
  address,
  onConnect,
  onDisconnect,
  isEthConnecting = false,
  activePage,
  onNavigate,
  chain,
  onToggleChain,
  cantonParty,
  onCantonConnect,
  onCantonDisconnect,
  isCantonConnecting = false,
}: LayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-surface-950">
      {/* Animated Background Gradients */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* Top gradient orb */}
        <div 
          className="absolute -left-40 -top-40 h-96 w-96 animate-pulse-slow rounded-full opacity-30"
          style={{
            background: chain === "ethereum" 
              ? "radial-gradient(circle, rgba(51, 139, 255, 0.4) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(16, 185, 129, 0.4) 0%, transparent 70%)",
          }}
        />
        {/* Bottom right orb */}
        <div 
          className="absolute -bottom-40 -right-40 h-[500px] w-[500px] animate-pulse-slow rounded-full opacity-20"
          style={{
            background: "radial-gradient(circle, rgba(168, 85, 247, 0.4) 0%, transparent 70%)",
            animationDelay: "1s",
          }}
        />
        {/* Center subtle glow */}
        <div 
          className="absolute left-1/2 top-1/3 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-10"
          style={{
            background: chain === "ethereum"
              ? "radial-gradient(ellipse, rgba(51, 139, 255, 0.3) 0%, transparent 60%)"
              : "radial-gradient(ellipse, rgba(16, 185, 129, 0.3) 0%, transparent 60%)",
          }}
        />
        {/* Grid pattern */}
        <div 
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10">
        <Navbar
          address={address}
          onEthConnect={onConnect}
          onEthDisconnect={onDisconnect}
          isEthConnecting={isEthConnecting}
          activePage={activePage}
          onNavigate={onNavigate}
          chain={chain}
          onToggleChain={onToggleChain}
          cantonParty={cantonParty}
          onCantonConnect={onCantonConnect}
          onCantonDisconnect={onCantonDisconnect}
          isCantonConnecting={isCantonConnecting}
        />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="animate-fade-in">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 py-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <span>All systems operational</span>
              </div>
              <div className="flex items-center gap-6">
                <a href="#" className="text-sm text-gray-500 transition-colors hover:text-white">Docs</a>
                <a href="#" className="text-sm text-gray-500 transition-colors hover:text-white">GitHub</a>
                <a href="#" className="text-sm text-gray-500 transition-colors hover:text-white">Discord</a>
              </div>
              <p className="text-sm text-gray-600">
                © 2026 Minted Protocol
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Chain Selector Component
 * 
 * Dropdown to select deposit chain from supported networks.
 * Shows chain icon, name, and indicates treasury chain.
 */

import { useState, useRef, useEffect } from 'react';
import { ChainConfig, getAllChains, getTreasuryChain } from '@/lib/chains';
import { useMultiChainDeposit } from '@/hooks/useMultiChainDeposit';

interface ChainSelectorProps {
  onChainSelect?: (chain: ChainConfig) => void;
  showTestnets?: boolean;
  disabled?: boolean;
}

// Chain icons (SVG paths or emoji fallbacks)
const chainIcons: Record<string, string> = {
  'ethereum-mainnet': '⟠',
  'ethereum-sepolia': '⟠',
  'base-mainnet': '🔵',
  'base-sepolia': '🔵',
  'arbitrum-one': '🔷',
  'arbitrum-sepolia': '🔷',
  'solana-mainnet': '◎',
  'solana-devnet': '◎',
};

export default function ChainSelector({ 
  onChainSelect, 
  showTestnets = false,
  disabled = false 
}: ChainSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { selectedChain, selectChain, isLoading } = useMultiChainDeposit();
  
  const allChains = getAllChains();
  const treasuryChain = getTreasuryChain();
  
  // Filter chains based on testnet preference
  const displayChains = allChains.filter(chain => 
    showTestnets ? chain.isTestnet : !chain.isTestnet
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (chain: ChainConfig) => {
    setIsOpen(false);
    await selectChain(chain.id);
    onChainSelect?.(chain);
  };

  const getChainIcon = (chain: ChainConfig) => {
    return chainIcons[chain.id] || '🔗';
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected Chain Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || isLoading}
        className={`
          w-full flex items-center justify-between gap-3 
          px-4 py-3 rounded-xl 
          bg-slate-800 border border-slate-700 
          text-white font-medium
          transition-all duration-200
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 cursor-pointer'}
          ${isOpen ? 'border-blue-500 ring-2 ring-blue-500/20' : ''}
        `}
      >
        {selectedChain ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl">{getChainIcon(selectedChain)}</span>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span>{selectedChain.name}</span>
                {selectedChain.isTreasuryChain && (
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                    Treasury
                  </span>
                )}
              </div>
              {selectedChain.isTestnet && (
                <span className="text-xs text-yellow-400">Testnet</span>
              )}
            </div>
          </div>
        ) : (
          <span className="text-slate-400">Select chain...</span>
        )}
        
        {isLoading ? (
          <svg className="w-5 h-5 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg 
            className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-2 py-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider">
            Deposit From
          </div>
          
          {displayChains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => handleSelect(chain)}
              className={`
                w-full flex items-center gap-3 px-4 py-3
                text-left transition-colors
                ${selectedChain?.id === chain.id 
                  ? 'bg-blue-500/20 text-blue-400' 
                  : 'text-white hover:bg-slate-700'
                }
              `}
            >
              <span className="text-2xl">{getChainIcon(chain)}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{chain.name}</span>
                  {chain.isTreasuryChain && (
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                      Treasury
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {chain.type === 'solana' ? 'Solana' : 'EVM'} • {chain.nativeCurrency.symbol}
                </div>
              </div>
              
              {/* Bridge indicator */}
              {!chain.isTreasuryChain && (
                <div className="text-xs text-slate-400 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  Bridges to ETH
                </div>
              )}
              
              {selectedChain?.id === chain.id && (
                <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}

          {/* Testnet toggle hint */}
          <div className="px-4 pt-3 pb-1 border-t border-slate-700 mt-2">
            <p className="text-xs text-slate-500">
              {showTestnets 
                ? 'Showing testnet chains' 
                : 'All deposits route to Ethereum Treasury'
              }
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

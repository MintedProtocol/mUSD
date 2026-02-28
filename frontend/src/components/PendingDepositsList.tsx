/**
 * Pending Deposits List Component
 * 
 * Displays tracked cross-chain deposits with real-time status updates.
 */

import { useState } from 'react';
import { usePendingDeposits, TrackedDeposit, DepositStatus } from '@/hooks/usePendingDeposits';
import { getChainById } from '@/lib/chains';
import { formatToken } from '@/lib/format';

// Status display configuration
const STATUS_CONFIG: Record<DepositStatus, { label: string; color: string; icon: string }> = {
  pending: { label: 'Pending', color: 'text-yellow-400', icon: '⏳' },
  confirmed: { label: 'Confirmed', color: 'text-blue-400', icon: '✓' },
  signed: { label: 'Signed by Guardians', color: 'text-purple-400', icon: '🔐' },
  relaying: { label: 'Bridging...', color: 'text-cyan-400', icon: '🌉' },
  completed: { label: 'Completed', color: 'text-green-400', icon: '✓✓' },
  failed: { label: 'Failed', color: 'text-red-400', icon: '✗' },
};

interface PendingDepositsListProps {
  showCompleted?: boolean;
  maxItems?: number;
  compact?: boolean;
}

export default function PendingDepositsList({ 
  showCompleted = true, 
  maxItems,
  compact = false 
}: PendingDepositsListProps) {
  const { deposits, pendingCount, removeDeposit, clearCompleted, refreshStatus, isPolling } = usePendingDeposits();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filter deposits
  let displayDeposits = showCompleted 
    ? deposits 
    : deposits.filter(d => d.status !== 'completed');
  
  if (maxItems) {
    displayDeposits = displayDeposits.slice(0, maxItems);
  }

  if (displayDeposits.length === 0) {
    return null;
  }

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const getEstimatedRemaining = (deposit: TrackedDeposit) => {
    if (!deposit.estimatedCompletion) return null;
    const remaining = deposit.estimatedCompletion - Date.now();
    if (remaining <= 0) return 'Any moment...';
    const minutes = Math.ceil(remaining / 60000);
    return `~${minutes} min remaining`;
  };

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-400">Pending Deposits</h4>
          {pendingCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-brand-400">
              {isPolling && <span className="animate-pulse">●</span>}
              {pendingCount} active
            </span>
          )}
        </div>
        {displayDeposits.map(deposit => (
          <CompactDepositItem key={deposit.id} deposit={deposit} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-white">Cross-Chain Deposits</h3>
          {pendingCount > 0 && (
            <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-xs font-medium text-brand-400">
              {pendingCount} pending
            </span>
          )}
          {isPolling && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <span className="animate-pulse text-green-400">●</span>
              Live
            </span>
          )}
        </div>
        {deposits.some(d => d.status === 'completed') && (
          <button
            onClick={clearCompleted}
            className="text-xs text-gray-500 hover:text-white transition-colors"
          >
            Clear completed
          </button>
        )}
      </div>

      {/* Deposit List */}
      <div className="space-y-3">
        {displayDeposits.map(deposit => {
          const sourceChain = getChainById(deposit.sourceChainId);
          const destChain = getChainById(deposit.destinationChainId);
          const status = STATUS_CONFIG[deposit.status];
          const isExpanded = expandedId === deposit.id;

          return (
            <div
              key={deposit.id}
              className={`rounded-xl border transition-all ${
                deposit.status === 'completed'
                  ? 'border-green-500/20 bg-green-500/5'
                  : deposit.status === 'failed'
                  ? 'border-red-500/20 bg-red-500/5'
                  : 'border-white/10 bg-surface-800/50'
              }`}
            >
              {/* Main Row */}
              <div 
                className="flex items-center gap-4 p-4 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : deposit.id)}
              >
                {/* Chain Icons */}
                <div className="flex items-center">
                  <span className="text-xl">{getChainEmoji(deposit.sourceChainId)}</span>
                  <svg className="mx-1 h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <span className="text-xl">{getChainEmoji(deposit.destinationChainId)}</span>
                </div>

                {/* Amount */}
                <div className="flex-1">
                  <div className="font-medium text-white">
                    {formatToken(BigInt(deposit.amount), 6)} USDC
                  </div>
                  <div className="text-xs text-gray-500">
                    {sourceChain?.shortName || deposit.sourceChainId} → {destChain?.shortName || deposit.destinationChainId}
                  </div>
                </div>

                {/* Status */}
                <div className="text-right">
                  <div className={`flex items-center gap-1 ${status.color}`}>
                    <span>{status.icon}</span>
                    <span className="text-sm font-medium">{status.label}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {deposit.status === 'completed' || deposit.status === 'failed'
                      ? formatTimeAgo(deposit.updatedAt)
                      : getEstimatedRemaining(deposit) || formatTimeAgo(deposit.createdAt)
                    }
                  </div>
                </div>

                {/* Expand Arrow */}
                <svg 
                  className={`h-5 w-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="border-t border-white/10 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Source TX:</span>
                      <a
                        href={`${sourceChain?.explorerUrl}/tx/${deposit.sourceTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-brand-400 hover:underline"
                      >
                        {truncateHash(deposit.sourceTxHash)}
                      </a>
                    </div>
                    {deposit.destinationTxHash && (
                      <div>
                        <span className="text-gray-500">Destination TX:</span>
                        <a
                          href={`${destChain?.explorerUrl}/tx/${deposit.destinationTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-brand-400 hover:underline"
                        >
                          {truncateHash(deposit.destinationTxHash)}
                        </a>
                      </div>
                    )}
                    {deposit.wormholeSequence && (
                      <div>
                        <span className="text-gray-500">Wormhole Seq:</span>
                        <span className="ml-2 text-white">{deposit.wormholeSequence}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">Depositor:</span>
                      <span className="ml-2 text-white">{truncateHash(deposit.depositor)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {deposit.status !== 'completed' && deposit.status !== 'failed' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          refreshStatus(deposit.id);
                        }}
                        className="px-3 py-1.5 text-xs rounded-lg bg-surface-700 text-white hover:bg-surface-600 transition-colors"
                      >
                        Refresh Status
                      </button>
                    )}
                    {deposit.vaaId && (
                      <a
                        href={`https://wormholescan.io/#/tx/${deposit.vaaId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1.5 text-xs rounded-lg bg-surface-700 text-white hover:bg-surface-600 transition-colors"
                      >
                        View on Wormhole
                      </a>
                    )}
                    {(deposit.status === 'completed' || deposit.status === 'failed') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDeposit(deposit.id);
                        }}
                        className="px-3 py-1.5 text-xs rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Error Message */}
                  {deposit.errorMessage && (
                    <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                      {deposit.errorMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactDepositItem({ deposit }: { deposit: TrackedDeposit }) {
  const status = STATUS_CONFIG[deposit.status];
  
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-800/50 px-3 py-2">
      <span className="text-lg">{getChainEmoji(deposit.sourceChainId)}</span>
      <div className="flex-1">
        <span className="text-sm text-white">{formatToken(BigInt(deposit.amount), 6)} USDC</span>
      </div>
      <span className={`text-xs ${status.color}`}>{status.icon} {status.label}</span>
    </div>
  );
}

function getChainEmoji(chainId: string): string {
  const emojis: Record<string, string> = {
    'ethereum': '⟠',
    'sepolia': '⟠',
    'base': '🔵',
    'base-sepolia': '🔵',
    'arbitrum': '🔷',
    'arbitrum-sepolia': '🔷',
    'solana': '◎',
    'solana-devnet': '◎',
  };
  return emojis[chainId] || '🔗';
}

function truncateHash(hash: string): string {
  if (!hash) return '';
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

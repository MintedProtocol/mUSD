import { useState } from 'react';
import { useUnifiedWallet } from '@/hooks/useUnifiedWallet';
import { useLoopWallet } from '@/hooks/useLoopWallet';

interface WalletConnectorProps {
  mode?: 'ethereum' | 'canton' | 'both';
  showBalance?: boolean;
  compact?: boolean;
}

export default function WalletConnector({ 
  mode = 'both',
  showBalance = true,
  compact = false,
}: WalletConnectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showWalletOptions, setShowWalletOptions] = useState(false);
  
  const ethWallet = useUnifiedWallet();
  const loopWallet = useLoopWallet();

  // Format address for display
  const formatAddress = (addr: string) => 
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const handleMetaMaskConnect = async () => {
    try {
      setShowWalletOptions(false);
      await ethWallet.connectMetaMask();
    } catch (err) {
      console.error('Failed to connect MetaMask:', err);
    }
  };

  const handleWalletConnectConnect = async () => {
    try {
      setShowWalletOptions(false);
      await ethWallet.connectWalletConnect();
    } catch (err) {
      console.error('Failed to connect WalletConnect:', err);
    }
  };

  const handleCantonConnect = () => {
    loopWallet.connect();
  };

  // Check connection states
  const isEthConnected = ethWallet.isConnected && ethWallet.address;
  const isCantonConnected = loopWallet.isConnected && loopWallet.partyId;
  const anyConnected = isEthConnected || isCantonConnected;

  // Compact mode - just show connection status
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {mode !== 'canton' && (
          <div className="flex items-center relative">
            {isEthConnected ? (
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-sm"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-300">
                  {ethWallet.ensName || formatAddress(ethWallet.address!)}
                </span>
                {ethWallet.activeWallet === 'metamask' && (
                  <span className="text-xs text-orange-400">MM</span>
                )}
                {ethWallet.activeWallet === 'walletconnect' && (
                  <span className="text-xs text-blue-400">WC</span>
                )}
              </button>
            ) : (
              <button
                onClick={() => setShowWalletOptions(!showWalletOptions)}
                disabled={ethWallet.isConnecting}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {ethWallet.isConnecting ? 'Connecting...' : 'Connect ETH'}
              </button>
            )}
            
            {/* Wallet selection dropdown */}
            {showWalletOptions && !isEthConnected && (
              <div className="absolute top-full mt-2 right-0 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 min-w-[200px]">
                <button
                  onClick={handleMetaMaskConnect}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-700 transition-colors rounded-t-lg"
                >
                  <img src="/metamask-fox.svg" alt="MetaMask" className="w-6 h-6" onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }} />
                  <span className="text-white">MetaMask</span>
                  {ethWallet.isMetaMaskInstalled && (
                    <span className="ml-auto text-xs text-emerald-400">Installed</span>
                  )}
                </button>
                <button
                  onClick={handleWalletConnectConnect}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-700 transition-colors rounded-b-lg border-t border-slate-700"
                >
                  <img src="/walletconnect.svg" alt="WalletConnect" className="w-6 h-6" onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }} />
                  <span className="text-white">WalletConnect</span>
                </button>
              </div>
            )}
          </div>
        )}
        
        {mode !== 'ethereum' && (
          <div className="flex items-center">
            {isCantonConnected ? (
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/20 border border-purple-500/40 rounded-lg text-sm"
              >
                <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                <span className="text-purple-300 truncate max-w-[120px]">
                  {loopWallet.partyId}
                </span>
              </button>
            ) : (
              <button
                onClick={handleCantonConnect}
                disabled={loopWallet.isConnecting}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {loopWallet.isConnecting ? 'Connecting...' : 'Connect Canton'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Full mode - expandable panel with wallet options
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-6">
      <h3 className="text-xl font-semibold text-white mb-6">Connect Wallet</h3>
      
      <div className="space-y-4">
        {/* Ethereum Wallet Options */}
        {mode !== 'canton' && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Ethereum</h4>
            
            {isEthConnected ? (
              <div className="bg-slate-700/40 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-emerald-300">Connected via {ethWallet.activeWallet === 'metamask' ? 'MetaMask' : 'WalletConnect'}</span>
                  </div>
                  <span className="text-xs text-slate-400">{ethWallet.chainName}</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Address</span>
                    <span className="text-white font-mono">{ethWallet.ensName || formatAddress(ethWallet.address!)}</span>
                  </div>
                  {showBalance && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Balance</span>
                      <span className="text-white">{parseFloat(ethWallet.ethBalance).toFixed(4)} ETH</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => ethWallet.disconnect()}
                  className="w-full mt-4 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 rounded-lg text-sm transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {/* MetaMask Option */}
                <button
                  onClick={handleMetaMaskConnect}
                  disabled={ethWallet.isConnecting}
                  className="flex items-center gap-3 p-4 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-xl transition-all disabled:opacity-50"
                >
                  <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-orange-400" viewBox="0 0 35 33">
                      <path fill="currentColor" d="M32.9 0L19.4 9.9l2.5-5.9L32.9 0z"/>
                      <path fill="currentColor" d="M2.1 0l13.4 10L13.2 4 2.1 0zm29.1 23.5l-3.6 5.5 7.7 2.1 2.2-7.5-6.3-.1zm-30.3.2l2.2 7.5 7.7-2.1-3.6-5.5-6.3.1z"/>
                      <path fill="currentColor" d="M10.5 14.5l-2.1 3.2 7.6.3-.3-8.2-5.2 4.7zm14 0l-5.3-4.8-.2 8.3 7.6-.3-2.1-3.2zm-14 11.9l4.6-2.2-4-3.1-.6 5.3zm9.9-2.2l4.5 2.2-.6-5.3-3.9 3.1z"/>
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="text-white font-medium">MetaMask</div>
                    <div className="text-xs text-slate-400">
                      {ethWallet.isMetaMaskInstalled ? 'Installed' : 'Popular wallet'}
                    </div>
                  </div>
                </button>
                
                {/* WalletConnect Option */}
                <button
                  onClick={handleWalletConnectConnect}
                  disabled={ethWallet.isConnecting}
                  className="flex items-center gap-3 p-4 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-xl transition-all disabled:opacity-50"
                >
                  <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-400" viewBox="0 0 32 32" fill="none">
                      <path d="M9.58 11.58c3.54-3.47 9.28-3.47 12.84 0l.43.42a.44.44 0 010 .63l-1.46 1.43a.23.23 0 01-.32 0l-.59-.58a6.48 6.48 0 00-8.96 0l-.63.62a.23.23 0 01-.32 0l-1.46-1.43a.44.44 0 010-.63l.47-.46zm15.87 2.96l1.3 1.27a.44.44 0 010 .63l-5.86 5.74a.46.46 0 01-.64 0l-4.16-4.07a.12.12 0 00-.16 0l-4.16 4.07a.46.46 0 01-.64 0l-5.86-5.74a.44.44 0 010-.63l1.3-1.27a.46.46 0 01.64 0l4.16 4.07a.12.12 0 00.16 0l4.16-4.07a.46.46 0 01.64 0l4.16 4.07a.12.12 0 00.16 0l4.16-4.07a.46.46 0 01.64 0z" fill="currentColor"/>
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="text-white font-medium">WalletConnect</div>
                    <div className="text-xs text-slate-400">Scan with mobile</div>
                  </div>
                </button>
              </div>
            )}
            
            {ethWallet.error && (
              <p className="text-sm text-red-400 mt-2">{ethWallet.error}</p>
            )}
          </div>
        )}
        
        {/* Divider */}
        {mode === 'both' && (
          <div className="border-t border-slate-700 my-4" />
        )}
        
        {/* Canton Wallet */}
        {mode !== 'ethereum' && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Canton Network</h4>
            
            {isCantonConnected ? (
              <div className="bg-slate-700/40 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                    <span className="text-purple-300">Connected via Loop Wallet</span>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Party ID</span>
                    <span className="text-white font-mono text-xs truncate max-w-[180px]">
                      {loopWallet.partyId}
                    </span>
                  </div>
                  {loopWallet.email && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email</span>
                      <span className="text-white">{loopWallet.email}</span>
                    </div>
                  )}
                  {showBalance && loopWallet.holdings.length > 0 && (
                    <div className="mt-2 p-2 bg-slate-800/50 rounded">
                      <div className="text-xs text-slate-400 mb-1">Holdings</div>
                      {loopWallet.holdings.slice(0, 3).map((h, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-slate-300">{h.symbol}</span>
                          <span className="text-white">
                            {(Number(h.total_unlocked_coin) / Math.pow(10, h.decimals)).toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={loopWallet.disconnect}
                  className="w-full mt-4 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 rounded-lg text-sm transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleCantonConnect}
                disabled={loopWallet.isConnecting}
                className="flex items-center gap-3 p-4 w-full bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-xl transition-all disabled:opacity-50"
              >
                <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-white font-medium">Loop Wallet</div>
                  <div className="text-xs text-slate-400">Connect to Canton Network</div>
                </div>
                {loopWallet.isConnecting && (
                  <svg className="animate-spin w-5 h-5 ml-auto text-purple-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </button>
            )}
            
            {loopWallet.error && (
              <p className="text-sm text-red-400 mt-2">{loopWallet.error}</p>
            )}
          </div>
        )}
      </div>
      
      {/* Connection status summary */}
      {mode === 'both' && anyConnected && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-400">Status:</span>
            {isEthConnected && isCantonConnected ? (
              <span className="text-emerald-400">✓ Both networks connected</span>
            ) : isEthConnected ? (
              <span className="text-yellow-400">Ethereum only</span>
            ) : (
              <span className="text-yellow-400">Canton only</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

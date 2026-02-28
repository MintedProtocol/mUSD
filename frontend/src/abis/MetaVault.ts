// MetaVault ABI — Vault-of-Vaults aggregator
export const META_VAULT_ABI = [
  // View functions
  "function usdc() view returns (address)",
  "function active() view returns (bool)",
  "function totalPrincipal() view returns (uint256)",
  "function driftThresholdBps() view returns (uint256)",
  "function rebalanceCooldown() view returns (uint256)",
  "function lastRebalanceAt() view returns (uint256)",
  "function subStrategyCount() view returns (uint256)",
  "function getSubStrategy(uint256 index) view returns (address strategy, uint256 weightBps, uint256 capUsd, bool enabled, uint256 currentValue)",
  "function totalValue() view returns (uint256)",
  "function asset() view returns (address)",
  "function isActive() view returns (bool)",
  "function currentAllocations() view returns (uint256[])",
  "function currentDrift() view returns (uint256)",
  "function idleBalance() view returns (uint256)",
  "function paused() view returns (bool)",
  // IStrategy (called by Treasury)
  "function deposit(uint256 amount) returns (uint256)",
  "function withdraw(uint256 amount) returns (uint256)",
  "function withdrawAll() returns (uint256)",
  // Sub-strategy management (STRATEGIST_ROLE)
  "function addSubStrategy(address strategy, uint256 weightBps, uint256 capUsd)",
  "function removeSubStrategy(uint256 index)",
  "function setWeights(uint256[] weights)",
  "function setSubStrategyCap(uint256 index, uint256 newCap)",
  "function setDriftThreshold(uint256 newBps)",
  "function setRebalanceCooldown(uint256 seconds_)",
  "function setActive(bool _active)",
  // Circuit breaker (GUARDIAN_ROLE)
  "function toggleSubStrategy(uint256 index, bool enabled)",
  "function emergencyWithdrawFrom(uint256 index)",
  "function emergencyWithdrawAll()",
  // Governance
  "function pause()",
  "function unpause()",
  // Rebalance (KEEPER_ROLE)
  "function rebalance()",
  // Events
  "event Deposited(uint256 totalAmount, uint256[] subAmounts)",
  "event Withdrawn(uint256 totalAmount, uint256[] subAmounts)",
  "event SubStrategyAdded(uint256 indexed index, address strategy, uint256 weightBps)",
  "event SubStrategyRemoved(uint256 indexed index, address strategy)",
  "event SubStrategyToggled(uint256 indexed index, bool enabled)",
  "event WeightsUpdated(uint256[] newWeights)",
  "event Rebalanced(uint256[] deltas, uint256 drift)",
  "event EmergencyWithdrawn(uint256 indexed index, uint256 amount)",
  "event CapUpdated(uint256 indexed index, uint256 newCap)",
  "event DriftThresholdUpdated(uint256 oldBps, uint256 newBps)",
] as const;

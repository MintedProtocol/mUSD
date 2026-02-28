export const COLLATERAL_VAULT_ABI = [
  "function getDeposit(address user, address token) view returns (uint256)",
  "function getSupportedTokens() view returns (address[])",
  // Field order must match Solidity: (bool, uint256, uint256, uint256)
  "function getConfig(address token) view returns (bool enabled, uint256 collateralFactorBps, uint256 liquidationThresholdBps, uint256 liquidationPenaltyBps)",
  "function deposit(address token, uint256 amount)",
  "function withdraw(address token, uint256 amount, address user)",
  "function seize(address user, address token, uint256 amount, address liquidator)",
  "function addCollateral(address token, uint256 collateralFactorBps, uint256 liquidationThresholdBps, uint256 liquidationPenaltyBps)",
  "function updateCollateral(address token, uint256 collateralFactorBps, uint256 liquidationThresholdBps, uint256 liquidationPenaltyBps)",
  "event Deposited(address indexed user, address indexed token, uint256 amount)",
  "event Withdrawn(address indexed user, address indexed token, uint256 amount)",
  "event Seized(address indexed user, address indexed token, uint256 amount, address indexed liquidator)",
] as const;

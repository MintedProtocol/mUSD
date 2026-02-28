/**
 * ETHPool ABI — Multi-asset staking pool (ETH / USDC / USDT → smUSD-E)
 * Source: contracts/ETHPool.sol
 */
export const ETH_POOL_ABI = [
  // ── Staking ────────────────────────────────────────────────────────
  "function stake(uint8 tier) payable returns (uint256 positionId)",
  "function stakeWithToken(address token, uint256 amount, uint8 tier) returns (uint256 positionId)",
  "function unstake(uint256 positionId)",

  // ── View: Pool State ───────────────────────────────────────────────
  "function sharePrice() view returns (uint256)",
  "function totalETHDeposited() view returns (uint256)",
  "function totalStablecoinDeposited() view returns (uint256)",
  "function totalMUSDMinted() view returns (uint256)",
  "function totalSMUSDEIssued() view returns (uint256)",
  "function poolCap() view returns (uint256)",
  "function totalDeployedToStrategy() view returns (uint256)",

  // ── View: Positions ────────────────────────────────────────────────
  "function getPosition(address user, uint256 positionId) view returns (tuple(address depositAsset, uint256 depositAmount, uint256 musdMinted, uint256 smUsdEShares, uint8 tier, uint256 stakedAt, uint256 unlockAt, bool active))",
  "function canUnstake(address user, uint256 positionId) view returns (bool)",
  "function getRemainingLockTime(address user, uint256 positionId) view returns (uint256)",
  "function getPositionCount(address user) view returns (uint256)",

  // ── View: Tier Config ──────────────────────────────────────────────
  "function getTierConfig(uint8 tier) view returns (uint256 duration, uint256 multiplierBps)",

  // ── View: Stablecoin Registry ──────────────────────────────────────
  "function acceptedStablecoins(address token) view returns (bool)",
  "function stablecoinDecimals(address token) view returns (uint8)",

  // ── View: Strategy ─────────────────────────────────────────────────
  "function totalPoolValue() view returns (uint256)",
  "function strategyHealthFactor() view returns (uint256)",
  "function strategyPosition() view returns (uint256 collateral, uint256 borrowed, uint256 principal, uint256 netValue)",

  // ── Events ─────────────────────────────────────────────────────────
  "event Staked(address indexed user, uint256 indexed positionId, address indexed depositAsset, uint256 depositAmount, uint256 musdAmount, uint256 smUsdEShares, uint8 tier, uint256 unlockAt)",
  "event Unstaked(address indexed user, uint256 indexed positionId, address depositAsset, uint256 amountReturned, uint256 smUsdEBurned)",
  "event SharePriceUpdated(uint256 oldPrice, uint256 newPrice)",
] as const;

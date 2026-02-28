export const LIQUIDATION_ENGINE_ABI = [
  "function closeFactorBps() view returns (uint256)",
  "function fullLiquidationThreshold() view returns (uint256)",
  "function isLiquidatable(address borrower) view returns (bool)",
  "function estimateSeize(address borrower, address collateralToken, uint256 debtToRepay) view returns (uint256)",
  "function liquidate(address borrower, address collateralToken, uint256 debtToRepay)",
  "function setCloseFactor(uint256 _bps)",
  "function setFullLiquidationThreshold(uint256 _bps)",
  "event Liquidation(address indexed liquidator, address indexed borrower, address indexed collateralToken, uint256 debtRepaid, uint256 collateralSeized)",
  "event CloseFactorUpdated(uint256 oldFactor, uint256 newFactor)",
] as const;

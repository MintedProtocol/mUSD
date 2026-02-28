export const LeverageVaultABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "_swapRouter", "type": "address" },
      { "internalType": "address", "name": "_collateralVault", "type": "address" },
      { "internalType": "address", "name": "_borrowModule", "type": "address" },
      { "internalType": "address", "name": "_priceOracle", "type": "address" },
      { "internalType": "address", "name": "_musd", "type": "address" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "DEFAULT_ADMIN_ROLE",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "LEVERAGE_ADMIN_ROLE",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxLoops",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minBorrowPerLoop",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "defaultPoolFee",
    "outputs": [{ "internalType": "uint24", "name": "", "type": "uint24" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxSlippageBps",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxLeverageX10",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "leverageEnabled",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "tokenPoolFees",
    "outputs": [{ "internalType": "uint24", "name": "", "type": "uint24" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "positions",
    "outputs": [
      { "internalType": "address", "name": "collateralToken", "type": "address" },
      { "internalType": "uint256", "name": "initialDeposit", "type": "uint256" },
      { "internalType": "uint256", "name": "totalCollateral", "type": "uint256" },
      { "internalType": "uint256", "name": "totalDebt", "type": "uint256" },
      { "internalType": "uint256", "name": "loopsExecuted", "type": "uint256" },
      { "internalType": "uint256", "name": "targetLeverageX10", "type": "uint256" },
      { "internalType": "uint256", "name": "openedAt", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "collateralToken", "type": "address" },
      { "internalType": "uint256", "name": "initialAmount", "type": "uint256" },
      { "internalType": "uint256", "name": "targetLeverageX10", "type": "uint256" },
      { "internalType": "uint256", "name": "maxLoopsOverride", "type": "uint256" }
    ],
    "name": "openLeveragedPosition",
    "outputs": [
      { "internalType": "uint256", "name": "totalCollateral", "type": "uint256" },
      { "internalType": "uint256", "name": "totalDebt", "type": "uint256" },
      { "internalType": "uint256", "name": "loopsExecuted", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "minCollateralOut", "type": "uint256" }],
    "name": "closeLeveragedPosition",
    "outputs": [{ "internalType": "uint256", "name": "collateralReturned", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getPosition",
    "outputs": [
      {
        "components": [
          { "internalType": "address", "name": "collateralToken", "type": "address" },
          { "internalType": "uint256", "name": "initialDeposit", "type": "uint256" },
          { "internalType": "uint256", "name": "totalCollateral", "type": "uint256" },
          { "internalType": "uint256", "name": "totalDebt", "type": "uint256" },
          { "internalType": "uint256", "name": "loopsExecuted", "type": "uint256" },
          { "internalType": "uint256", "name": "targetLeverageX10", "type": "uint256" },
          { "internalType": "uint256", "name": "openedAt", "type": "uint256" }
        ],
        "internalType": "struct LeverageVault.LeveragePosition",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getEffectiveLeverage",
    "outputs": [{ "internalType": "uint256", "name": "leverageX10", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "collateralToken", "type": "address" },
      { "internalType": "uint256", "name": "initialAmount", "type": "uint256" },
      { "internalType": "uint256", "name": "targetLeverageX10", "type": "uint256" }
    ],
    "name": "estimateLoops",
    "outputs": [
      { "internalType": "uint256", "name": "estimatedLoops", "type": "uint256" },
      { "internalType": "uint256", "name": "estimatedDebt", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "_maxLoops", "type": "uint256" },
      { "internalType": "uint256", "name": "_minBorrowPerLoop", "type": "uint256" },
      { "internalType": "uint24", "name": "_defaultPoolFee", "type": "uint24" },
      { "internalType": "uint256", "name": "_maxSlippageBps", "type": "uint256" }
    ],
    "name": "setConfig",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "_maxLeverageX10", "type": "uint256" }],
    "name": "setMaxLeverage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "token", "type": "address" },
      { "internalType": "uint24", "name": "poolFee", "type": "uint24" }
    ],
    "name": "enableToken",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "token", "type": "address" }],
    "name": "disableToken",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "token", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "emergencyWithdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "collateralToken", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "initialDeposit", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "totalCollateral", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "totalDebt", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "loopsExecuted", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "effectiveLeverageX10", "type": "uint256" }
    ],
    "name": "LeverageOpened",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "collateralToken", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "collateralReturned", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "debtRepaid", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "profitOrLoss", "type": "uint256" }
    ],
    "name": "LeverageClosed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "uint256", "name": "maxLoops", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "minBorrowPerLoop", "type": "uint256" },
      { "indexed": false, "internalType": "uint24", "name": "defaultPoolFee", "type": "uint24" },
      { "indexed": false, "internalType": "uint256", "name": "maxSlippageBps", "type": "uint256" }
    ],
    "name": "ConfigUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "uint256", "name": "oldMaxLeverageX10", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "newMaxLeverageX10", "type": "uint256" }
    ],
    "name": "MaxLeverageUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "token", "type": "address" },
      { "indexed": false, "internalType": "uint24", "name": "poolFee", "type": "uint24" }
    ],
    "name": "TokenEnabled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "token", "type": "address" }],
    "name": "TokenDisabled",
    "type": "event"
  }
] as const;

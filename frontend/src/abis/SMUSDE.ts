/**
 * SMUSDE ABI — Staked mUSD ETH Pool receipt token (smUSD-E)
 * Source: contracts/SMUSDE.sol
 * Plain ERC-20 with POOL_ROLE mint/burn and compliance blacklist.
 */
export const SMUSDE_ABI = [
  // ── ERC-20 Standard ────────────────────────────────────────────────
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",

  // ── Compliance ─────────────────────────────────────────────────────
  "function isBlacklisted(address account) view returns (bool)",

  // ── Events ─────────────────────────────────────────────────────────
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Minted(address indexed to, uint256 amount)",
  "event Burned(address indexed from, uint256 amount)",
] as const;

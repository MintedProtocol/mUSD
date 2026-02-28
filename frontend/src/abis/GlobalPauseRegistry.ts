export const GLOBAL_PAUSE_REGISTRY_ABI = [
  // ── Read ──
  "function isGloballyPaused() view returns (bool)",
  "function lastPausedAt() view returns (uint256)",
  "function lastUnpausedAt() view returns (uint256)",
  "function GUARDIAN_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",

  // ── Write ──
  "function pauseGlobal()",
  "function unpauseGlobal()",

  // ── Events ──
  "event GlobalPauseStateChanged(bool indexed paused, address indexed actor)",
] as const;

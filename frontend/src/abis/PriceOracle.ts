export const PRICE_ORACLE_ABI = [
  "function getPrice(address token) view returns (uint256)",
  "function getValueUsd(address token, uint256 amount) view returns (uint256)",
  "function lastKnownPrice(address token) view returns (uint256)",
  "function isFeedHealthy(address token) view returns (bool)",
  "function setFeed(address token, address feed, uint256 stalePeriod, uint8 tokenDecimals)",
  "function removeFeed(address token)",
  "event FeedUpdated(address indexed token, address feed, uint256 stalePeriod, uint8 tokenDecimals)",
  "event FeedRemoved(address indexed token)",
] as const;

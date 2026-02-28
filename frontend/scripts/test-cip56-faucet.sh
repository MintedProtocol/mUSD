#!/usr/bin/env bash
# test-cip56-faucet.sh — Validate CIP-56 faucet create + balances reflection
#
# Usage:
#   cd frontend
#   bash scripts/test-cip56-faucet.sh [party] [amount]
#
# Defaults:
#   party  = minted-canary::1220...
#   amount = 100

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PARTY="${1:-minted-canary::122006df00c631440327e68ba87f61795bbcd67db26142e580137e5038649f22edce}"
AMOUNT="${2:-100}"

echo "=== CIP-56 Faucet Self-Test ==="
echo "  Base URL: $BASE_URL"
echo "  Party:    ${PARTY:0:40}..."
echo "  Amount:   $AMOUNT"
echo ""

# 1. Get balances BEFORE
echo "--- Step 1: Pre-mint balances ---"
BEFORE=$(curl -sf "${BASE_URL}/api/canton-balances?party=${PARTY}" || echo '{"error":"API unavailable"}')
BEFORE_CIP56=$(echo "$BEFORE" | jq -r '.cip56Balance // "0"')
BEFORE_COUNT=$(echo "$BEFORE" | jq -r '.tokenCount // 0')
echo "  cip56Balance: $BEFORE_CIP56"
echo "  tokenCount:   $BEFORE_COUNT"
echo ""

# 2. Mint CIP-56 mUSD via faucet
echo "--- Step 2: Mint CIP-56 mUSD ---"
MINT_RESP=$(curl -sf -X POST "${BASE_URL}/api/canton-command" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"create\",
    \"templateId\": \"CIP56MintedMUSD\",
    \"payload\": {
      \"issuer\": \"operator\",
      \"owner\": \"${PARTY}\",
      \"amount\": \"${AMOUNT}\",
      \"blacklisted\": false,
      \"observers\": []
    },
    \"party\": \"${PARTY}\"
  }" || echo '{"success":false,"error":"API unavailable"}')
MINT_SUCCESS=$(echo "$MINT_RESP" | jq -r '.success // false')
echo "  success: $MINT_SUCCESS"
if [ "$MINT_SUCCESS" != "true" ]; then
  MINT_ERR=$(echo "$MINT_RESP" | jq -r '.error // "unknown"')
  echo "  error: $MINT_ERR"
  echo ""
  echo "FAIL: CIP-56 faucet mint returned error."
  echo "Check: CIP56_FAUCET_AGREEMENT_HASH and CIP56_FAUCET_AGREEMENT_URI env vars."
  exit 1
fi
echo ""

# 3. Get balances AFTER (wait briefly for ACS to settle)
sleep 2
echo "--- Step 3: Post-mint balances ---"
AFTER=$(curl -sf "${BASE_URL}/api/canton-balances?party=${PARTY}" || echo '{"error":"API unavailable"}')
AFTER_CIP56=$(echo "$AFTER" | jq -r '.cip56Balance // "0"')
AFTER_COUNT=$(echo "$AFTER" | jq -r '.tokenCount // 0')
AFTER_TEMPLATES=$(echo "$AFTER" | jq '[.tokens[].template] | group_by(.) | map({template: .[0], count: length})')
echo "  cip56Balance: $AFTER_CIP56"
echo "  tokenCount:   $AFTER_COUNT"
echo "  templates:    $AFTER_TEMPLATES"
echo ""

# 4. Validate
echo "--- Step 4: Validation ---"
PASSED=true
if [ "$(echo "$AFTER_CIP56 > $BEFORE_CIP56" | bc -l)" != "1" ]; then
  echo "  FAIL: cip56Balance did not increase ($BEFORE_CIP56 -> $AFTER_CIP56)"
  PASSED=false
else
  echo "  PASS: cip56Balance increased ($BEFORE_CIP56 -> $AFTER_CIP56)"
fi

if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
  echo "  PASS: tokenCount increased ($BEFORE_COUNT -> $AFTER_COUNT)"
else
  echo "  FAIL: tokenCount did not increase ($BEFORE_COUNT -> $AFTER_COUNT)"
  PASSED=false
fi

echo ""
if [ "$PASSED" = true ]; then
  echo "=== ALL CHECKS PASSED ==="
else
  echo "=== SOME CHECKS FAILED ==="
  exit 1
fi

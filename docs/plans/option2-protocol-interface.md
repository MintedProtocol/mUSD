# Option 2 — Batch Choice Interface Contract

**Package:** `ble-protocol v1.2.0`
**Branch:** `option2/protocol`
**Status:** Implemented and tested (17/17 tests pass)

---

## Forfeit Policy — Governance Decision

> **Policy adopted:** FORFEIT-EXCESS (retain-all-archive-exact-pay)

All batch unstake choices (`ETHPool_BatchUnstake`, `Unstake_Batch`) archive ALL provided tokens unconditionally. The caller receives **exactly `requestedMusd`** mUSD. Any excess value in the provided tokens is **forfeited** — not returned to the caller.

### Rationale

Returning "change" would require re-minting new smUSD or smUSD-E tokens inside the choice, which introduces:
- Re-locking (new `unlockAt` / `stakedAt` timestamps — potentially extending lock periods against the user's intent)
- Tier-mismatch complexity for ETH pool positions
- Additional compliance calls for newly created tokens

The forfeit-excess model is deliberately simple and safe. It shifts the responsibility for minimal-covering-set selection to the **caller** (frontend or script).

### Caller obligations

- For `ETHPool_BatchUnstake` and `Unstake_Batch`: pass only the minimal set of tokens that covers `requestedMusd`. Use `SMUSDE_Split`/`SMUSD_Split` to pre-split if needed, or use the frontend helper `selectTokensForAmount` in `canton-balances.ts` which selects greedily by descending amount.
- For `Lending_BatchDepositSMUSD`/`Lending_BatchDepositSMUSDE`: all provided tokens are deposited in full — no forfeit, no partial deposit.

### Tests proving the policy (tests 15 and 16)

| Test | Proves |
|---|---|
| `test_ETHPool_BatchUnstake_ForfeitGovPolicy` | User gets exactly `requestedMusd`; all tokens archived; service `totalShares == 0` (all shares burned, not just `requestedMusd/sharePrice`); `currentUnstakeMinted == 150` not 300 |
| `test_Staking_UnstakeBatch_ForfeitGovPolicy` | User gets exactly `requestedMusd`; all tokens archived; service `totalShares == 0`; vault `pooledMusd == 150` (excess stays in pool) |

---

## Motivation

Users holding fragmented token positions (multiple small smUSD or smUSD-E contracts) were blocked from unstaking more than their single largest position or depositing collateral without pre-merging tokens first. Option 2 adds four batch choices that accept lists of contract IDs and execute atomically, eliminating the UX friction without breaking backward compatibility.

All four choices are **additive** — existing single-CID choices (`Unstake`, `ETHPool_Unstake`, `Lending_DepositSMUSD`, `Lending_DepositSMUSDE`) are unchanged.

---

## 1. `ETHPool_BatchUnstake`

**Template:** `CantonETHPoolService` (module `CantonETHPool`)

### Signature

```daml
choice ETHPool_BatchUnstake : (ContractId CantonETHPoolService, ContractId CantonMUSD)
  with
    user          : Party
    smusdeCids    : [ContractId CantonSMUSD_E]
    requestedMusd : Money
  controller user
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `user` | `Party` | The party exercising the choice; must own all tokens. |
| `smusdeCids` | `[ContractId CantonSMUSD_E]` | One or more smUSD-E positions to burn. |
| `requestedMusd` | `Money` | Exact amount of mUSD the user receives. Must be ≤ total value of provided positions. |

### Preconditions (abort codes)

| Code | Condition |
|---|---|
| `SERVICE_PAUSED` | Service must not be paused. |
| `NO_POSITIONS_PROVIDED` | `smusdeCids` must be non-empty. |
| `REQUESTED_AMOUNT_POSITIVE` | `requestedMusd > 0`. |
| `OWNER_MISMATCH` | Every smUSD-E token's `owner` must equal `user`. |
| `ISSUER_MISMATCH` | Every smUSD-E token's `issuer` must equal `operator`. |
| `POSITION_LOCKED` | Every token with `unlockAt = Some t` must satisfy `now >= t`. |
| `INSUFFICIENT_BALANCE` | `totalShares × sharePrice >= requestedMusd`. |
| `UNSTAKE_EXCEEDS_MUSD_MINT_CAP` | `currentUnstakeMinted + requestedMusd <= musdMintCap`. |

Compliance: `ValidateRedemption` is called on `complianceRegistryCid` (blacklist/freeze check).

### Postconditions

- All provided smUSD-E tokens are **archived**.
- A new `CantonMUSD` for exactly `requestedMusd` is created with `owner = user`.
- Service state updated:
  - `totalShares` reduced by `requestedMusd / sharePrice`
  - `totalMusdStaked` reduced proportionally
  - `currentUnstakeMinted` increased by `requestedMusd`

### Excess handling (FORFEIT POLICY)

If the combined value of provided tokens exceeds `requestedMusd`, the excess yield is **forfeited** — all tokens are archived but only `requestedMusd` mUSD is minted. No change is returned. See [Forfeit Policy](#forfeit-policy--governance-decision) for rationale. Use `SMUSDE_Split` beforehand to pre-split, or use `selectTokensForAmount` in `canton-balances.ts` to select the minimal covering set automatically.

---

## 2. `Unstake_Batch`

**Template:** `CantonStakingService` (module `CantonSMUSD`)

### Signature

```daml
choice Unstake_Batch : (ContractId CantonStakingService, ContractId CantonMUSD)
  with
    user          : Party
    smusdCids     : [ContractId CantonSMUSD]
    requestedMusd : Money
  controller user
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `user` | `Party` | The party exercising the choice; must own all tokens. |
| `smusdCids` | `[ContractId CantonSMUSD]` | One or more smUSD positions to redeem. |
| `requestedMusd` | `Money` | Exact amount of mUSD to withdraw from the vault. |

### Preconditions (abort codes)

| Code | Condition |
|---|---|
| `SERVICE_PAUSED` | Service must not be paused. |
| `NO_POSITIONS_PROVIDED` | `smusdCids` must be non-empty. |
| `REQUESTED_AMOUNT_POSITIVE` | `requestedMusd > 0`. |
| `OWNER_MISMATCH` | Every smUSD token's `owner` must equal `user`. |
| `ISSUER_MISMATCH` | Every smUSD token's `issuer` must equal `operator`. |
| `COOLDOWN_NOT_ELAPSED` | `now - stakedAt >= cooldownSeconds` for every token. |
| `INSUFFICIENT_BALANCE` | Combined vault value (pool-derived price) `>= requestedMusd`. |
| `NO_POOL_MUSD` | Service must have `poolMusdCid = Some _` (vault funded). |

Compliance: `ValidateRedemption` called on `complianceRegistryCid`.

### Postconditions

- All provided smUSD tokens are **archived**.
- The vault `CantonMUSD` (pool) is archived and recreated with `amount - requestedMusd` (split).
- A new `CantonMUSD` for exactly `requestedMusd` is created with `owner = user`.
- Service state updated:
  - `totalShares` reduced by shares consumed
  - `pooledMusd` reduced by `requestedMusd`

### Vault mechanics (FORFEIT POLICY)

Unlike `ETHPool_BatchUnstake`, this choice withdraws from an existing vault (vault-model staking). If the combined value of provided tokens exceeds `requestedMusd`, the excess stays in the vault for remaining stakers — the extra shares are burned, the extra mUSD remains in the pool, slightly increasing the remaining share price. No change is returned to the caller. See [Forfeit Policy](#forfeit-policy--governance-decision). Use `SMUSD_Split` beforehand if exact withdrawal is required.

---

## 3. `Lending_BatchDepositSMUSD`

**Template:** `CantonLendingService` (module `CantonLending`)

### Signature

```daml
nonconsuming choice Lending_BatchDepositSMUSD : (ContractId CantonLendingService, ContractId EscrowedCollateral)
  with
    user              : Party
    smusdCids         : [ContractId CantonSMUSD]
    existingEscrowCid : Optional (ContractId EscrowedCollateral)
    collateralAggCid  : Optional (ContractId LendingCollateralAggregate)
  controller user
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `user` | `Party` | The party depositing; must own all tokens. |
| `smusdCids` | `[ContractId CantonSMUSD]` | One or more smUSD positions to escrow as collateral. |
| `existingEscrowCid` | `Optional (ContractId EscrowedCollateral)` | If `Some`, adds to an existing escrow via `Escrow_AddCollateral`. If `None`, creates a fresh escrow. |
| `collateralAggCid` | `Optional (ContractId LendingCollateralAggregate)` | If `Some`, updates the aggregate via `Aggregate_AddDeposit`. If `None`, creates a new aggregate. |

### Preconditions (abort codes)

| Code | Condition |
|---|---|
| `SERVICE_PAUSED` | Service must not be paused. |
| `NO_POSITIONS_PROVIDED` | `smusdCids` must be non-empty. |
| `SMUSD_NOT_ENABLED` | `CTN_SMUSD` collateral type must be enabled in `configs`. |
| `NOT_OWNER` | Every smUSD token's `owner` must equal `user`. |
| `SMUSD_ISSUER_MUST_BE_OPERATOR` | Every smUSD token's `issuer` must equal `operator`. |

### Postconditions

- All provided smUSD tokens are **archived**.
- Their combined `shares` are deposited as collateral:
  - If `existingEscrowCid = Some cid`: `EscrowedCollateral` at `cid` is updated in-place (shares added).
  - If `existingEscrowCid = None`: a new `EscrowedCollateral` is created for `user`.
- The `LendingCollateralAggregate` is updated or created as specified.
- Returns `(ContractId CantonLendingService, ContractId EscrowedCollateral)`.

Note: This is a `nonconsuming` choice — the `CantonLendingService` contract ID is unchanged.

---

## 4. `Lending_BatchDepositSMUSDE`

**Template:** `CantonLendingService` (module `CantonLending`)

### Signature

```daml
nonconsuming choice Lending_BatchDepositSMUSDE : (ContractId CantonLendingService, ContractId EscrowedCollateral)
  with
    user              : Party
    smusdeCids        : [ContractId CantonSMUSD_E]
    existingEscrowCid : Optional (ContractId EscrowedCollateral)
    collateralAggCid  : Optional (ContractId LendingCollateralAggregate)
  controller user
```

Identical structure to `Lending_BatchDepositSMUSD` except it accepts `CantonSMUSD_E` (ETH Pool positions) and uses the `CTN_SMUSDE` collateral config. Error codes are `NOT_OWNER` / `SMUSDE_ISSUER_MUST_BE_OPERATOR` / `SMUSDE_NOT_ENABLED`.

---

## Frontend Integration Notes

### Token selection strategy

The frontend should select the minimal set of tokens that covers `requestedMusd` to avoid excess losses:

```typescript
// canton-balances.ts — existing helper, already handles ETH pool
function selectTokensForAmount(
  tokens: TokenWithAmount[],
  requestedAmount: number
): TokenWithAmount[] {
  // Sort descending by amount, greedily pick until covered
  const sorted = [...tokens].sort((a, b) => b.amount - a.amount);
  const selected: TokenWithAmount[] = [];
  let running = 0;
  for (const t of sorted) {
    if (running >= requestedAmount) break;
    selected.push(t);
    running += t.amount;
  }
  return selected;
}
```

### Command construction

Batch choices use the same `/v2/commands/submit-and-wait` endpoint as single-CID choices. The `commands` array contains a single `ExerciseCommand`:

```json
{
  "templateId": "ble-protocol-1.2.0:CantonETHPool:CantonETHPoolService",
  "contractId": "<poolSvcCid>",
  "choice": "ETHPool_BatchUnstake",
  "choiceArgument": {
    "user": "<aliceParty>",
    "smusdeCids": ["<e1>", "<e2>", "<e3>"],
    "requestedMusd": "300.000000000000000000"
  }
}
```

### Error surfacing

All abort codes surface as `FAILED_PRECONDITION` gRPC status with the abort message in `details`. The frontend should map known codes to user-facing messages:

| Abort code | User message |
|---|---|
| `SERVICE_PAUSED` | "This service is temporarily paused. Try again later." |
| `NO_POSITIONS_PROVIDED` | "No positions selected." |
| `INSUFFICIENT_BALANCE` | "Selected positions don't cover the requested amount." |
| `POSITION_LOCKED` | "One or more positions are still locked. Check unlock times." |
| `COOLDOWN_NOT_ELAPSED` | "One or more positions are still in the cooldown period." |
| `UNSTAKE_EXCEEDS_MUSD_MINT_CAP` | "Daily unstake cap reached. Try a smaller amount or try again tomorrow." |
| `OWNER_MISMATCH` | "One or more positions don't belong to your wallet." |

---

## Test Coverage

**File:** `BatchChoicesTest.daml` — 17 tests, all passing.

| # | Test | Choice |
|---|---|---|
| 1 | `test_ETHPool_BatchUnstake_HappyPath` | 3 positions → 300 mUSD |
| 2 | `test_Staking_UnstakeBatch_HappyPath` | 3 positions → 300 mUSD from vault |
| 3 | `test_Lending_BatchDepositSMUSD_HappyPath` | 2 smUSD → single escrow |
| 4 | `test_Lending_BatchDepositSMUSDE_HappyPath` | 2 smUSD-E → single escrow |
| 5 | `test_ETHPool_BatchUnstake_InsufficientBalance` | 150 requested from 100 total → INSUFFICIENT_BALANCE |
| 6 | `test_Staking_UnstakeBatch_InsufficientBalance` | 300 requested from 200 total → INSUFFICIENT_BALANCE |
| 7 | `test_ETHPool_BatchUnstake_MixedOwner` | Alice + Bob tokens → OWNER_MISMATCH |
| 8 | `test_Lending_BatchDepositSMUSD_MixedOwner` | Alice + Bob tokens → NOT_OWNER |
| 9 | `test_ETHPool_BatchUnstake_Paused` | Paused service → SERVICE_PAUSED |
| 10 | `test_Staking_UnstakeBatch_Paused` | Paused service → SERVICE_PAUSED |
| 11 | `test_ETHPool_BatchUnstake_EmptyList` | Empty list → NO_POSITIONS_PROVIDED |
| 12 | `test_Staking_UnstakeBatch_EmptyList` | Empty list → NO_POSITIONS_PROVIDED |
| 13 | `test_Lending_BatchDepositSMUSD_Idempotency` | Second deposit adds to existing escrow |
| 14 | `test_ETHPool_BatchUnstake_PartialRequest` | 3 positions (300 total), request 150 → 150 mUSD, all 3 archived |
| 15 | `test_ETHPool_BatchUnstake_ForfeitGovPolicy` | FORFEIT POLICY proof for ETH pool: user gets exactly requestedMusd, all shares burned |
| 16 | `test_Staking_UnstakeBatch_ForfeitGovPolicy` | FORFEIT POLICY proof for vault: user gets exactly requestedMusd, excess stays in vault |
| 17 | `setupParties` | Helper (allocates parties, creates registry) |

---

## Upgrade Compatibility

`ble-protocol v1.2.0` contains all 76 templates from `v1.1.0` plus the 4 new choices. Packages with the same `name + version` are rejected by `KNOWN_PACKAGE_VERSION`; the version bump to `1.2.0` is required for upload.

No existing contract on-ledger needs migration. The new choices are additive — existing workflows using single-CID choices continue to work unchanged.

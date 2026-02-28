# Option 2 — Batch Choices API Contract

Protocol version: **1.2.0** (ble-protocol v1.2.0)

## Overview

Option 2 adds four batch choices to the Canton DAML protocol. These allow
users to operate on multiple token positions in a single ledger command,
eliminating the fragmented-token UX problem (R6) where users must submit
one transaction per position.

All batch endpoints are **feature-gated** and default to OFF.

---

## Endpoints

### POST `/api/canton-batch-unstake`

Batch unstake multiple staked positions into a single mUSD output.

#### Request

```json
{
  "party": "<Canton party ID>",
  "pool": "ethpool" | "smusd",
  "contractIds": ["<contract-id-1>", "<contract-id-2>", ...],
  "requestedMusd": "<decimal string>"
}
```

| Field          | Type       | Required | Description                                      |
|----------------|------------|----------|--------------------------------------------------|
| `party`        | string     | yes      | Canton party ID (format: `name::1220<hex64>`)    |
| `pool`         | string     | yes      | `"ethpool"` for ETH Pool, `"smusd"` for smUSD    |
| `contractIds`  | string[]   | yes      | 1–50 contract IDs to unstake                     |
| `requestedMusd`| string     | yes      | Exact mUSD amount to receive (positive decimal)  |

#### DAML Choice Mapping

| `pool` value | DAML Choice           | Template                | CID Field    |
|-------------|----------------------|------------------------|-------------|
| `ethpool`   | `ETHPool_BatchUnstake`| `CantonETHPoolService` | `smusdeCids`|
| `smusd`     | `Unstake_Batch`       | `CantonStakingService` | `smusdCids` |

#### Response (200 OK)

```json
{
  "success": true,
  "mode": "batch",
  "pool": "ethpool",
  "commandId": "batch-unstake-ethpool-1709...-a1b2c3d4",
  "requestedMusd": "100.000000"
}
```

#### Errors

| Status | `errorType`                    | Cause                                          |
|--------|-------------------------------|-------------------------------------------------|
| 400    | `VALIDATION_ERROR`            | Missing/malformed input fields                  |
| 400    | `SERVICE_PAUSED`              | Pool service is paused                          |
| 400    | `NO_POSITIONS_PROVIDED`       | Empty `contractIds` array                       |
| 400    | `OWNER_MISMATCH`              | Token not owned by requesting party             |
| 400    | `ISSUER_MISMATCH`             | Token issuer is not the operator                |
| 400    | `POSITION_LOCKED`             | ETH Pool position still time-locked             |
| 400    | `COOLDOWN_NOT_ELAPSED`        | smUSD position still in cooldown                |
| 400    | `INSUFFICIENT_BALANCE`        | Total value of positions < requested amount     |
| 400    | `UNSTAKE_EXCEEDS_MUSD_MINT_CAP`| Would exceed mUSD mint cap                     |
| 400    | `REQUESTED_AMOUNT_POSITIVE`   | requestedMusd must be > 0                       |
| 404    | `FEATURE_DISABLED`            | Batch choices not enabled                       |
| 405    | (none)                        | Wrong HTTP method                               |
| 500    | `CONFIG_ERROR`                | Server misconfiguration                         |
| 502    | `SERVICE_NOT_FOUND`           | No service contract on ledger                   |
| 502    | `CANTON_ERROR`                | Unclassified Canton error                       |

---

### POST `/api/canton-batch-deposit`

Batch deposit multiple collateral positions into the lending service.

#### Request

```json
{
  "party": "<Canton party ID>",
  "collateralType": "smusd" | "smusde",
  "contractIds": ["<contract-id-1>", ...],
  "existingEscrowCid": "<contract-id>" | null,
  "collateralAggCid": "<contract-id>" | null
}
```

| Field              | Type         | Required | Description                                        |
|--------------------|--------------|----------|----------------------------------------------------|
| `party`            | string       | yes      | Canton party ID                                    |
| `collateralType`   | string       | yes      | `"smusd"` or `"smusde"`                            |
| `contractIds`      | string[]     | yes      | 1–50 contract IDs to deposit                       |
| `existingEscrowCid`| string\|null | no       | Existing escrow to add to (null → create new)      |
| `collateralAggCid` | string\|null | no       | Existing aggregate to update (null → create new)   |

#### DAML Choice Mapping

| `collateralType` | DAML Choice                 | CID Field    |
|------------------|-----------------------------|-------------|
| `smusd`          | `Lending_BatchDepositSMUSD` | `smusdCids` |
| `smusde`         | `Lending_BatchDepositSMUSDE`| `smusdeCids`|

Both are **nonconsuming** choices on `CantonLendingService`.

#### Response (200 OK)

```json
{
  "success": true,
  "mode": "batch",
  "collateralType": "smusd",
  "commandId": "batch-deposit-smusd-1709...-a1b2c3d4",
  "positionCount": 3
}
```

#### Errors

| Status | `errorType`                | Cause                                     |
|--------|---------------------------|-------------------------------------------|
| 400    | `VALIDATION_ERROR`         | Missing/malformed input fields            |
| 400    | `SERVICE_PAUSED`           | Lending service is paused                 |
| 400    | `NO_POSITIONS_PROVIDED`    | Empty `contractIds` array                 |
| 400    | `NOT_OWNER`                | Token not owned by requesting party       |
| 400    | `ISSUER_MISMATCH`          | Token issuer is not the operator          |
| 400    | `COLLATERAL_NOT_ENABLED`   | smUSD or smUSD-E collateral type disabled |
| 404    | `FEATURE_DISABLED`         | Batch choices not enabled                 |
| 405    | (none)                     | Wrong HTTP method                         |
| 500    | `CONFIG_ERROR`             | Server misconfiguration                   |
| 502    | `SERVICE_NOT_FOUND`        | No lending service contract on ledger     |
| 502    | `CANTON_ERROR`             | Unclassified Canton error                 |

---

### GET `/api/canton-batch-capability`

Reports which batch choices are available. Always returns 200.

#### Response

```json
{
  "batchChoicesEnabled": false,
  "choices": {
    "ETHPool_BatchUnstake": false,
    "Unstake_Batch": false,
    "Lending_BatchDepositSMUSD": false,
    "Lending_BatchDepositSMUSDE": false
  },
  "version": "1.2.0"
}
```

No authentication required. Callers use this to decide whether to
offer batch operations in the UI or fall back to single-position flows.

---

## Feature Flags

### Environment Variables

| Variable                        | Default   | Effect                                    |
|---------------------------------|-----------|-------------------------------------------|
| `ENABLE_BATCH_CHOICES`          | `"false"` | Master switch for all batch endpoints     |
| `DISABLE_ETHPOOL_BATCH_UNSTAKE` | `"false"` | Disables ETHPool_BatchUnstake only        |
| `DISABLE_SMUSD_BATCH_UNSTAKE`   | `"false"` | Disables Unstake_Batch only               |
| `DISABLE_LENDING_BATCH_DEPOSIT` | `"false"` | Disables both Lending_BatchDeposit* only  |

### Flag Behavior Matrix

| `ENABLE_BATCH_CHOICES` | Per-choice `DISABLE_*` | Result     |
|------------------------|------------------------|------------|
| unset / `"false"`      | (any)                  | **OFF**    |
| `"true"`               | unset / `"false"`      | **ON**     |
| `"true"`               | `"true"`               | **OFF** (that choice only) |

When a batch endpoint is OFF, it returns `404 FEATURE_DISABLED`. The
legacy single-position path remains the default and operational code path.

---

## Idempotency

Both batch endpoints use bounded in-memory idempotency stores:

- **Store capacity**: 500 entries per endpoint
- **TTL**: 5 minutes
- **Key derivation**: `SHA256(prefix + sorted_cids + amount_or_count + party)[0:32]`
- **Behavior**: If a request matches a cached key, the cached result is
  returned immediately (200 OK) without re-submitting to Canton.

Idempotency is process-scoped (not durable across restarts). This matches
the existing pattern used by `canton-cip56-redeem`.

---

## Relay Support

The relay service gains batch choice awareness via `relay/batch-support.ts`:

- **Template resolution**: `resolveBatchTemplateId(choiceName)` maps choice
  names to fully-qualified template IDs using configured package IDs.
- **Command building**: `buildBatchUnstakeCommand()` and
  `buildBatchDepositCommand()` produce Canton `ExerciseCommand` payloads.
- **Feature gate**: All command builders return `null` when
  `ENABLE_BATCH_CHOICES` is not `"true"`.
- **Health reporting**: `getBatchHealthReport()` returns the batch flag state
  and template resolution results, suitable for inclusion in `/health`.
- **Error codes**: `extractBatchErrorCode(message)` classifies Canton error
  messages into typed `BatchErrorCode` values.

---

## Settlement Safety

Batch choices preserve the same settlement safety guarantees as single-position
operations:

1. **Atomic execution**: All positions in a batch are processed in a single
   Canton command. Either all succeed or none do.
2. **Owner validation**: Every position is checked for `owner == user` before
   processing. Mixed-owner batches are rejected with `OWNER_MISMATCH`.
3. **Issuer validation**: Every position is checked for `issuer == operator`.
4. **Lock/cooldown enforcement**: ETH Pool positions must be unlocked;
   smUSD positions must have elapsed their cooldown period.
5. **Operator cosigning**: All batch commands include both `user` and
   `operator` in the `actAs` list, matching the existing cosigning pattern.

---

## Error Model

All responses use typed JSON (no HTML leaks):

```typescript
// Success
{ success: true, mode: "batch", ... }

// Business error
{ success: false, error: "<message>", errorType: "<CODE>", fallbackAllowed?: boolean }

// Config error
{ success: false, error: "<message>", errorType: "CONFIG_ERROR" }
```

The `fallbackAllowed` field (present on 5xx errors) tells callers whether
falling back to the legacy single-position path is safe. Business errors
(4xx) set `fallbackAllowed: false` because the same request would fail
on the legacy path too.

---

## Batch Size Limits

- Maximum positions per batch: **50** (enforced by input validation)
- Minimum positions per batch: **1** (empty list → `NO_POSITIONS_PROVIDED`)
- Duplicate contract IDs are rejected at the API level

---

## Version History

| Version | Date       | Changes                              |
|---------|------------|--------------------------------------|
| 1.2.0   | 2026-02-27 | Initial batch choices implementation |

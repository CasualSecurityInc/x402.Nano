---
title: "Track A: nanoTxn"
---

# Track A: nanoTxn — Signed-Block Method

## Summary

The `exact` scheme on Nano uses a **signed-block** model<sup>[1]</sup>. The client constructs a full Nano state send block, signs it with their account private key, and passes the complete signed block to the facilitator inside the `PaymentPayload`. The facilitator validates the block cryptographically and against the Nano ledger, then broadcasts it via the `process` RPC.

This is analogous to EVM's `exact` scheme, where the client pre-authorizes a transfer that the facilitator submits on-chain. On Nano, the client constructs and signs the block; the facilitator's role is **verify-and-broadcast**: it validates the signed block, then submits it to the Nano network and waits for confirmation.

**Known compromise:** Nano's frontier dilemma<sup>[1]</sup>. Because the block references a specific `previous` (the current frontier of the sending account), any unrelated activity on that account between block construction and facilitator broadcast will invalidate the block. This makes Track A best suited for **single-purpose or agent wallets** where the frontier is controlled.

---

## Network Identifier

```
nano:mainnet
```

The identifier `nano:mainnet` is used throughout this spec to identify Nano mainnet. Facilitator implementations MUST reject payloads specifying any other value in the `network` field.

---

## Asset

Nano has a single native asset (XNO). The `asset` field in `PaymentRequirements` MUST be set to the string `"XNO"`. No token contract address applies.

Amounts are expressed in **raw**, the smallest indivisible unit of Nano. 1 XNO = 10^24 Mnano = 10^30 raw. The `amount` field MUST be a base-10 integer string with no decimal point.

```
"amount": "1000000000000000000000000000"   // = 0.001 XNO
```

---

## Roles

| Role | Responsibility |
| --- | --- |
| **Client** | Constructs and signs the Nano state send block; places the full signed block in the `PaymentPayload` |
| **Resource Server** | Passes `PAYMENT-SIGNATURE` header to the facilitator unchanged; grants or denies access based on the facilitator response |
| **Facilitator** | Validates the signed block (signature, balance, destination, work); broadcasts via `process` RPC; waits for confirmation; tracks fork protection |

The resource server requires **no Nano-specific logic**. It is scheme-agnostic and treats this network identically to any other.

---

## PaymentRequirements

A server advertising Nano payment includes an entry in the `accepts` array of its `PaymentRequired` response. The full `PaymentRequired` object is base64-encoded and delivered in the `PAYMENT-REQUIRED` response header alongside the `402` status.

`PaymentRequirements` entry:

```json
{
  "scheme": "exact",
  "network": "nano:mainnet",
  "asset": "XNO",
  "amount": "1000000000000000000000000000",
  "payTo": "nano_3recv11111111111111111111111111111111111111111111111hifc8npp",
  "maxTimeoutSeconds": 60,
  "extra": {
    "validBefore": 1749111600
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `scheme` | string | Always `"exact"` |
| `network` | string | Always `"nano:mainnet"` |
| `asset` | string | Always `"XNO"` |
| `amount` | string | Required payment in raw, as a base-10 integer string. |
| `payTo` | string | Nano account address that must be the destination of the send block |
| `maxTimeoutSeconds` | number | Informational: recommended maximum seconds after the 402 is issued within which the block should be confirmed on-chain. The binding expiry is `extra.validBefore`. |
| `extra.validBefore` | number | Unix timestamp (seconds) after which the challenge is expired. The facilitator MUST reject payloads where `validBefore <= floor(Date.now() / 1000)`. |

---

## Block Construction<sup>[2]</sup>

The client constructs a Nano **state send block** using the challenge parameters:

1. **Fetch account frontier:** Call `account_info` RPC for the sending account to obtain:
   - `frontier` (hash of the current head block) → becomes `block.previous`
   - `balance` (current confirmed balance in raw) → used to compute `block.balance`
   - `representative` → becomes `block.representative`

2. **Compute block fields:**
   - `type`: `"state"`
   - `account`: sending account address
   - `previous`: `frontier` from step 1 (or zero hash for an open block, though send blocks always have a previous)
   - `representative`: current representative from step 1
   - `balance`: `currentBalance − accepted.amount` (as a base-10 raw string)
   - `link`: the `payTo` address decoded to 32 raw bytes, hex-encoded as 64 lowercase hex characters
   - `link_as_account`: the `payTo` address (convenience field; NOT used for verification)

3. **Sign the block:**
   - Compute `block_hash = Blake2b-256(account || previous || representative || balance || link)` per Nano state block encoding
   - `signature = NanoAccountSign(private_key, block_hash)`

4. **Generate proof-of-work:**
   - `work = PoW(block.previous)` using the appropriate PoW algorithm (threshold differs for open vs. non-open blocks)

5. **Amount validation:** The block's balance decrement (`previousBalance − newBalance`) MUST equal `accepted.amount` exactly. The client MUST NOT overpay or underpay.

---

## PaymentPayload<sup>[1]</sup>

The client places a base64-encoded JSON `PaymentPayload` in the `PAYMENT-SIGNATURE` request header. The scheme-specific data lives in the `payload` field.

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "nano:mainnet",
    "asset": "XNO",
    "amount": "1000000000000000000000000000",
    "payTo": "nano_3recv11111111111111111111111111111111111111111111111hifc8npp",
    "maxTimeoutSeconds": 60,
    "extra": {
      "validBefore": 1749111600
    }
  },
  "payload": {
    "block": {
      "type": "state",
      "account": "nano_1sender111111111111111111111111111111111111111111111sumx4abe",
      "previous": "F47B23107E5F34B2CE06F562B5C435DF72A533251CB414C51B2B62A8F63A00E4",
      "representative": "nano_1hza3f7wiiqa7ig3jczyxj5yo86yegcmqk3criaz838j91sxcckpfhbhhra1",
      "balance": "999000000000000000000000000",
      "link": "19D3D919475DEED4696B5D13018151D1AF88B2BD3BCFF048B45031C1F36D1858",
      "link_as_account": "nano_3recv11111111111111111111111111111111111111111111111hifc8npp",
      "signature": "3BFBA64A775550E6D49DF1EB8EEC2136DCD74F....77FFF15FD11E6E2162A1714731B743D1E941FA4560A",
      "work": "ffffffd2e1234567"
    }
  }
}
```

The `accepted` field is a verbatim copy of the `PaymentRequirements` entry the client selected from the `PaymentRequired` response, including `extra.validBefore`. This allows the facilitator to recover all challenge parameters without a separate lookup.

### `payload` field specification

| Field | Type | Description |
| --- | --- | --- |
| `block` | object | The full Nano state send block. All 8 fields MUST be present. |
| `block.type` | string | Always `"state"` |
| `block.account` | string | Sender's Nano account address |
| `block.previous` | string | Hash of the sender's current frontier block. 64 lowercase hex characters. |
| `block.representative` | string | Sender's current representative address |
| `block.balance` | string | Sender's new balance after the send, in raw, as a base-10 integer string |
| `block.link` | string | 32-byte raw public key bytes of the destination account, hex-encoded as 64 lowercase hex characters |
| `block.link_as_account` | string | Destination account as a `nano_` address (convenience field; facilitator MUST verify against `link`, not this) |
| `block.signature` | string | Ed25519 signature over the Blake2b-256 hash of the block fields. 128 lowercase hex characters. |
| `block.work` | string | Proof-of-work value. 16 lowercase hex characters. |

---

## Facilitator Verification (`POST /verify`)<sup>[1]</sup>

Checks are performed in order. Any failure returns:

```json
{ "success": false, "error": "<ERROR_CODE>" }
```

### 1. Parse and validate payload structure

* `payload.block` is present and contains all 8 required fields
* `block.type` is `"state"`
* `block.account` is a valid Nano account string
* `block.previous` is exactly 64 lowercase hex characters
* `block.balance` is a valid base-10 integer string
* `block.link` is exactly 64 lowercase hex characters
* `block.signature` is exactly 128 lowercase hex characters
* `block.work` is exactly 16 hex characters
* `accepted.extra.validBefore` is a positive integer

Failure: `MALFORMED_PAYLOAD`

### 2. Check expiry

If `accepted.extra.validBefore <= Math.floor(Date.now() / 1000)`: `PAYMENT_EXPIRED`

This check is performed before any cryptographic or RPC work.

### 3. Verify destination

Decode `block.link` (32 bytes) to a Nano account address. The decoded address MUST match `accepted.payTo`. Implementations MUST compare decoded public key bytes, not raw address strings.

Failure: `WRONG_DESTINATION`

### 4. Verify amount

* Fetch `account_info` for `block.account` to obtain the current confirmed balance and frontier.
* Compute `decrement = currentBalance − block.balance` (as arbitrary-precision integers).
* `decrement` MUST be exactly equal to `accepted.amount`.

Failure: `INSUFFICIENT_AMOUNT`

### 5. Verify frontier

`block.previous` MUST equal the current `frontier` of `block.account` as returned by `account_info`.

Failure: `STALE_FRONTIER`

### 6. Verify block signature

Compute `block_hash = Blake2b-256(state_block_encoding(block.account, block.previous, block.representative, block.balance, block.link))` per Nano state block encoding rules.

Derive the Ed25519 public key from `block.account`.

`NanoAccountVerify(public_key, block_hash, block.signature)`

Failure: `INVALID_SIGNATURE`

### 7. Verify work format

Check that `block.work` is exactly 16 hex characters. The facilitator MUST NOT regenerate or validate the PoW value against the difficulty threshold — only format validation is required.

Failure: `INVALID_WORK`

### 8. Fork protection check

If `block.previous` is already in the facilitator's active verification set: `DUPLICATE_FRONTIER`

This prevents two concurrent blocks with the same frontier from being verified simultaneously.

### 9. Record frontier

Insert `block.previous` into the fork-protection set. Entries MUST be retained until settlement completes or the challenge expires.

### Success response

```json
{
  "isValid": true,
  "payer": "nano_1sender111111111111111111111111111111111111111111111sumx4abe"
}
```

`payer` is the account address from `block.account` — the address that signed the send block.

---

## Facilitator Settlement (`POST /settle`)<sup>[1]</sup>

The facilitator:

1. **Broadcasts** the block by calling the `process` RPC with the full block JSON.
2. **Waits for confirmation** by polling `block_info` on the returned block hash until `confirmed` is `"true"`. Facilitators MAY retry with a short backoff (e.g., up to 5 attempts × 1s) to absorb the narrow window between broadcast and representative confirmation.
3. **Records the block hash** in a seen-set to prevent replay of the same settled block.

**Settlement request:**

```json
{
  "paymentPayload": { /* PaymentPayload */ },
  "paymentRequirements": { /* PaymentRequirements */ }
}
```

### Successful Settlement Response

```json
{
  "success": true,
  "payer": "nano_1sender111111111111111111111111111111111111111111111sumx4abe",
  "transaction": "A3F9D1E2B4C5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1",
  "network": "nano:mainnet"
}
```

`transaction` is the block hash of the confirmed send block. It is the transaction identifier carried in the `PAYMENT-RESPONSE` settlement receipt returned to the client by the resource server.

### Error Response

```json
{
  "success": false,
  "errorReason": "broadcast_failed",
  "payer": "nano_1sender111111111111111111111111111111111111111111111sumx4abe",
  "transaction": "",
  "network": "nano:mainnet"
}
```

### Settlement Error Codes

| Code | Meaning |
| --- | --- |
| `BROADCAST_FAILED` | The `process` RPC returned an error (e.g., block already exists, gap, fork) |
| `CONFIRMATION_TIMEOUT` | Block was broadcast but not confirmed within the retry window |
| `FRONTIER_CHANGED` | The account's frontier changed between verification and settlement (fork dilemma) |

---

## Replay Protection

### Fork Protection via `block.previous`

During verification, the facilitator tracks `block.previous` values in an active set. Two verification requests with the same `block.previous` MUST NOT both succeed — the second is rejected with `DUPLICATE_FRONTIER`. This prevents:

- Two different blocks from the same frontier being verified concurrently
- Accidental or malicious fork submission

After settlement completes, the `block.previous` entry MAY be evicted from the fork-protection set.

### Block Hash Seen-Set After Broadcast

After the facilitator broadcasts the block and obtains the confirmed block hash, it records the hash in a seen-set. Any subsequent request presenting the same block hash MUST be rejected with `DUPLICATE_BLOCK_HASH`.

---

## Fork Protection<sup>[1]</sup>

The facilitator MUST track `block.previous` values during the verification window. The lifecycle:

1. **Verification:** `block.previous` is recorded in the active set.
2. **Settlement succeeds:** `block.previous` is evicted; the confirmed block hash is recorded in the seen-set.
3. **Settlement fails (frontier changed):** `block.previous` is evicted. The client must construct a new block with the updated frontier.
4. **Challenge expires:** `block.previous` is evicted if still in the active set.

This is critical because Nano's block-lattice is account-specific. Each account has its own chain, and each block references the hash of the prior block (`previous`). If the account's frontier changes between block construction and facilitator broadcast, the block is invalid.

---

## Client Implementation Guide

1. Receive 402 response
2. Decode PAYMENT-REQUIRED header: base64 -> JSON (PaymentRequired)
3. Select the `accepts[]` entry where `scheme="exact"` and `network="nano:mainnet"`
4. Verify `extra.validBefore` is in the future — discard stale challenges
5. Extract from the selected PaymentRequirements:
   * `payTo` -> send destination
   * `amount` -> required amount in raw
   * `extra.validBefore` -> challenge expiry (Unix timestamp)
6. Call `account_info` RPC for the sending account:
   * `frontier` -> `block.previous`
   * `balance` -> current balance (used to compute `block.balance`)
   * `representative` -> `block.representative`
7. Construct the state send block:
   * `type`: `"state"`
   * `account`: sending account address
   * `previous`: frontier from step 6
   * `representative`: representative from step 6
   * `balance`: `currentBalance − accepted.amount` (as raw string)
   * `link`: `payTo` decoded to 32 bytes, hex-encoded
   * `link_as_account`: `payTo` (convenience)
8. Sign the block:
   * Compute `block_hash` per Nano state block encoding
   * `signature = NanoAccountSign(private_key, block_hash)`
9. Generate PoW: `work = PoW(block.previous)`
10. Construct PaymentPayload:
```json
{
  "x402Version": 2,
  "resource": "<PaymentRequired.resource, verbatim>",
  "accepted": "<the selected PaymentRequirements entry, verbatim>",
  "payload": {
    "block": {
      "type": "state",
      "account": "<sending account address>",
      "previous": "<64-char hex frontier hash>",
      "representative": "<representative address>",
      "balance": "<new balance in raw>",
      "link": "<64-char hex of payTo public key bytes>",
      "link_as_account": "<payTo address>",
      "signature": "<128-char hex Ed25519 signature>",
      "work": "<16-char hex PoW>"
    }
  }
}
```
11. Base64-encode the PaymentPayload JSON
12. Retry the original request with:
    * `PAYMENT-SIGNATURE`: `<base64 encoded PaymentPayload>`

---

## Error Codes Reference

| Code | Meaning |
| --- | --- |
| `MALFORMED_PAYLOAD` | Missing fields, wrong types, or values that fail format validation |
| `PAYMENT_EXPIRED` | `accepted.extra.validBefore` is in the past |
| `WRONG_DESTINATION` | `block.link` does not decode to `accepted.payTo` |
| `INSUFFICIENT_AMOUNT` | Balance decrement does not equal `accepted.amount` |
| `STALE_FRONTIER` | `block.previous` does not match the account's current frontier |
| `INVALID_SIGNATURE` | Block signature verification failed |
| `INVALID_WORK` | Work field is not 16 hex characters |
| `DUPLICATE_FRONTIER` | A block with this `block.previous` is already being verified |
| `DUPLICATE_BLOCK_HASH` | This block hash has already been settled |
| `BROADCAST_FAILED` | The `process` RPC returned an error |
| `CONFIRMATION_TIMEOUT` | Block was broadcast but not confirmed in time |
| `FRONTIER_CHANGED` | Account frontier changed between verification and settlement |

---

## Security Considerations

### The Frontier Dilemma

Nano's block-lattice is an account chain. Each block references the hash of the prior block (`previous`). If any transaction occurs on the sending account between block construction and facilitator broadcast, the block's `previous` will no longer match the account's frontier, and the block becomes invalid.

This is an inherent property of the signed-block approach. It does not affect correctness — the block simply fails to broadcast, and the client must retry — but it means Track A is **not suitable for accounts with high concurrent transaction volume**. Best for:
- Single-purpose payment wallets
- Agent wallets under programmatic control
- Accounts dedicated to x402 payments

### Block Signature as Proof

The block's Ed25519 signature is the proof of sender ownership. It commits to all block fields: account, previous, representative, balance, and link. This is the same signature mechanism used for all Nano transactions.

Unlike Track B (which uses NOMS domain separation), the block signature in Track A IS a Nano block signature — by design. The facilitator broadcasts this exact signed block.

### No Persistent State Required

Fork-protection entries and seen-set entries are short-lived. The fork-protection set lives only during the verification-to-settlement window. The seen-set lives only after settlement. Both can be implemented with standard in-process TTL caches.

### Address Comparison

Both `nano_` and `xrb_` address prefixes encode the same underlying 32-byte Ed25519 public key with a Blake2b checksum. All address comparisons in the facilitator MUST operate on the decoded public key bytes. String comparison of Nano addresses MUST NOT be used.

---

## References

<sup>[1]</sup> The signed-block flow, `payload.block` schema, facilitator verification checklist (balance, amount decrement, destination via `link`, block signature, work format), settlement via `process` RPC, and fork protection via `block.previous` tracking are adapted from the `exact` scheme specification by the x402nano project: [github.com/x402nano/schemes/exact.md](https://github.com/x402nano/schemes/blob/main/exact.md). Related implementation: [github.com/x402nano/exact](https://github.com/x402nano/exact).

<sup>[2]</sup> The block construction workflow (fetching account info, generating send blocks, publishing via `process` RPC) follows the patterns established by the `@x402nano/helper` module: [github.com/x402nano/helper](https://github.com/x402nano/helper).

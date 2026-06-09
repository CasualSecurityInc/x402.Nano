---
title: "Track B: nanoSignature"
---

# Track B: nanoSignature — NOMS Signature Method

## Summary

The `exact` scheme on Nano uses a **post-payment proof** model. The client sends a Nano transaction on-chain first, then proves to the facilitator that they were the sender by producing a [NOMS](https://github.com/OpenRai/Standards/blob/main/rfcs/ORIS-001.md) (Nano Off-chain Message Signing, ORIS-001) signature over the block hash of that send block.

This differs from EVM's `exact` scheme, where the client pre-authorizes a transfer that the facilitator submits on-chain. On Nano, the client submits the transaction themselves — the facilitator's role is **verify-only**: it checks the on-chain send, verifies the NOMS proof of sender ownership, and confirms the block is settled before returning a result to the resource server.

The facilitator never touches funds, never holds keys, and never submits anything to the Nano network.

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
| **Client** | Sends the Nano block on-chain; constructs the `PaymentPayload` with the block hash and NOMS proof |
| **Resource server** | Passes `PAYMENT-SIGNATURE` header to the facilitator unchanged; grants or denies access based on the facilitator response |
| **Facilitator** | Verifies the NOMS signature; queries Nano RPC to confirm the block; checks amount, destination, confirmation, and expiry; tracks seen block hashes within the validity window to prevent replay |

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
  "maxTimeoutSeconds": 120,
  "extra": {
    "nonce": "a94f3e2c1b084d7f9e5a2c6b3d1e4f8a2c5b7d9e1f3a5c7b9d2e4f6a8c1b3d5e",
    "validBefore": 1718123456
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `scheme` | string | Always `"exact"` |
| `network` | string | Always `"nano:mainnet"` |
| `asset` | string | Always `"XNO"` |
| `amount` | string | Minimum required payment in raw, as a base-10 integer string |
| `payTo` | string | Nano account address that must be the destination of the send block |
| `maxTimeoutSeconds` | number | Maximum seconds after the 402 is issued within which the send block must be confirmed on-chain. Informational; the hard expiry is `extra.validBefore`. |
| `extra.nonce` | string | Server-issued challenge nonce. MUST be 32 bytes of cryptographically random data, hex-encoded as 64 lowercase hex characters. Generated fresh for every 402 response. |
| `extra.validBefore` | number | Unix timestamp (seconds) after which the NOMS signature is invalid. MUST be set to approximately `floor(Date.now() / 1000) + maxTimeoutSeconds` at the time the 402 is issued. |

`extra.validBefore` is the cryptographic expiry of this payment challenge. Its presence in the signed NOMS message means the signature is mathematically dead after this timestamp, bounding the facilitator's seen-set TTL to the same short window used by all other `exact` scheme implementations.

---

## Payment Flow

```
Client                        Resource Server               Facilitator           Nano Network
  │                                  │                           │                      │
  │── GET /resource ────────────────>│                           │                      │
  │<── 402 + PAYMENT-REQUIRED hdr ───│                           │                      │
  │    (base64 PaymentRequired)      │                           │                      │
  │                                  │                           │                      │
  │  [pick nano:mainnet entry]       │                           │                      │
  │  [check validBefore > now]       │                           │                      │
  │  [extract payTo, amount,         │                           │                      │
  │   nonce, validBefore]            │                           │                      │
  │                                  │                           │                      │
  │── send block ────────────────────────────────────────────────────────────────────>│
  │<── block hash ───────────────────────────────────────────────────────────────────│
  │                                  │                           │                      │
  │  [construct NOMS message]        │                           │                      │
  │  [sign with account private key] │                           │                      │
  │  [build PaymentPayload]          │                           │                      │
  │                                  │                           │                      │
  │── GET /resource ────────────────>│                           │                      │
  │   PAYMENT-SIGNATURE: <b64>       │                           │                      │
  │                                  │── POST /verify ──────────>│                      │
  │                                  │                           │  [check validBefore] │
  │                                  │                           │  [verify NOMS sig]   │
  │                                  │                           │  [replay dedup]      │
  │                                  │                           │── block_info RPC ───>│
  │                                  │                           │<── block details ────│
  │                                  │                           │  [check sender]      │
  │                                  │                           │  [check destination] │
  │                                  │                           │  [check amount]      │
  │                                  │                           │  [check confirmed]   │
  │                                  │                           │  [record block hash] │
  │                                  │<── { success: true } ─────│                      │
  │<── 200 + PAYMENT-RESPONSE hdr ───│                           │                      │
```

---

## PaymentPayload

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
    "maxTimeoutSeconds": 120,
    "extra": {
      "nonce": "a94f3e2c1b084d7f9e5a2c6b3d1e4f8a2c5b7d9e1f3a5c7b9d2e4f6a8c1b3d5e",
      "validBefore": 1718123456
    }
  },
  "payload": {
    "blockHash": "a3f9d1e2b4c5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
    "account": "nano_1sender111111111111111111111111111111111111111111111sumx4abe",
    "signature": "535c745819d0f40056f3c46402b4fae4356b3a8897bde99c955d411920e740d781e6dddcbde228e8b86c4383a1003f9f315519ff73bd356f561d19865dc90f09"
  }
}
```

The `accepted` field is a verbatim copy of the `PaymentRequirements` entry the client selected from the `PaymentRequired` response, including `extra.nonce` and `extra.validBefore`. This allows the facilitator to recover all challenge parameters without a separate lookup.

### `payload` field specification

| Field | Type | Description |
| --- | --- | --- |
| `blockHash` | string | Lowercase hex block hash of the on-chain send block. No `0x` prefix. Exactly 64 characters. |
| `account` | string | Nano account address of the sending account (`nano_` or `xrb_` prefix accepted) |
| `signature` | string | NOMS signature per ORIS-001 over the canonical message (see below). 128 lowercase hex characters, no `0x` prefix. |

---

## NOMS Message Construction

The client signs a single canonical message string using NOMS (ORIS-001). The message is:

```
<blockHash>:<nonce>:<validBefore>
```

Where:

* `<blockHash>` is the lowercase hex block hash, exactly 64 characters, no `0x` prefix
* `<nonce>` is the `extra.nonce` value from the `PaymentRequirements` entry, exactly as received — 64 lowercase hex characters
* `<validBefore>` is the decimal string representation of `extra.validBefore` with no leading zeros, no decimal point, and no suffix (e.g. `"1718123456"`)
* `:` separators are literal ASCII colons (0x3A)

**Example message:**

```
a3f9d1e2b4c5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1:a94f3e2c1b084d7f9e5a2c6b3d1e4f8a2c5b7d9e1f3a5c7b9d2e4f6a8c1b3d5e:1718123456
```

This string (139 bytes as UTF-8 for a 10-digit timestamp; all characters are ASCII) becomes the `MESSAGE` field in the NOMS payload construction:

1. Encode the message string as UTF-8 bytes
2. Construct `NOMS_payload = MAGIC_HEADER || uint32be(len(message_bytes)) || message_bytes`
3. Compute `digest = Blake2b-256(NOMS_payload)`
4. `signature = NanoAccountSign(private_key, digest)`

The verifier reconstructs the identical message string from `payload.blockHash`, `accepted.extra.nonce`, and `accepted.extra.validBefore`, then applies steps 1–3 and calls:

```
NanoAccountVerify(public_key_from(payload.account), digest, payload.signature)
```

---

## Replay Protection

NOMS on its own does not prevent replay (ORIS-001 §Security Considerations). This scheme adds two complementary layers that together bound the facilitator's seen-set to a short, fixed TTL — identical in operational profile to all other `exact` scheme implementations.

### Layer 1 — Cryptographic expiry bound inside the signature

`extra.validBefore` is included in the signed NOMS message. Once `now >= validBefore`, the expected message string changes, so any prior signature over that message is permanently and cryptologically invalid — no seen-set lookup required. The seen-set only needs to cover the live window `[now, validBefore)`.

### Layer 2 — Facilitator block hash seen-set

The facilitator MUST track every `blockHash` that has been successfully verified within the current validity window. A second request presenting the same `blockHash` MUST be rejected with `DUPLICATE_BLOCK_HASH`.

**Seen-set TTL:** entries MUST be retained until `validBefore` and MAY be evicted any time after `validBefore` has passed, since Layer 1 guarantees that expired signatures cannot produce valid verification results. In practice, facilitators SHOULD add a small grace period (e.g. 5 seconds) beyond `validBefore` to absorb clock skew between resource server and facilitator.

The combination of Layer 1 and Layer 2 means:

| Scenario | Result |
| --- | --- |
| Same block hash + same nonce, within window | Blocked by Layer 2 |
| Same block hash + same nonce, after `validBefore` | Blocked by Layer 1 (invalid signature) |
| Same block hash + different nonce | Blocked by Layer 2 (block hash already seen) |
| Different block hash + same nonce | Client sent a second on-chain transaction; valid if all other checks pass |

---

## Facilitator: Verification (`POST /verify`)

Checks are performed in order. Any failure returns:

```json
{ "success": false, "error": "<ERROR_CODE>" }
```

### 1. Parse and validate payload structure

* `payload.blockHash` is exactly 64 lowercase hex characters
* `payload.account` is a valid Nano account string that decodes to a 32-byte Ed25519 public key
* `payload.signature` is exactly 128 lowercase hex characters
* `accepted.extra.nonce` is exactly 64 lowercase hex characters
* `accepted.extra.validBefore` is a positive integer

Failure: `MALFORMED_PAYLOAD`

### 2. Check expiry

If `accepted.extra.validBefore <= floor(now_unix_seconds)`: `PAYMENT_EXPIRED`

This check is performed before any cryptographic or RPC work.

### 3. Verify NOMS signature

Reconstruct the canonical message:

```
<payload.blockHash>:<accepted.extra.nonce>:<accepted.extra.validBefore>
```

Apply NOMS (ORIS-001):

1. UTF-8 encode the message string
2. Construct `MAGIC_HEADER || uint32be(len) || message_bytes`
3. `digest = Blake2b-256(...)`
4. `NanoAccountVerify(public_key_from(payload.account), digest, payload.signature)`

Failure: `INVALID_SIGNATURE`

### 4. Check block hash seen-set

If `payload.blockHash` is already in the facilitator's seen-set: `DUPLICATE_BLOCK_HASH`

### 5. Query Nano RPC — `block_info`

Call `block_info` with `json_block: true` on `payload.blockHash`.

If the block is not found: `BLOCK_NOT_FOUND`

### 6. Validate block type and subtype

* `block.type` MUST be `"state"`
* `block.subtype` MUST be `"send"`

Failure: `WRONG_BLOCK_TYPE`

### 7. Validate sender

`block.account` MUST decode to the same Ed25519 public key as `payload.account`. Implementations MUST compare decoded public key bytes, not raw address strings.

Failure: `SENDER_MISMATCH`

### 8. Validate destination

`block.contents.link_as_account` MUST decode to the same Ed25519 public key as `accepted.payTo`. Implementations MUST compare decoded public key bytes.

Failure: `WRONG_DESTINATION`

### 9. Validate amount

Parse `block.amount` (raw) and `accepted.amount` (raw) as arbitrary-precision integers. `block.amount` MUST be >= `accepted.amount`.

Failure: `INSUFFICIENT_AMOUNT`

### 10. Validate confirmation

`block.confirmed` in the `block_info` response MUST be `"true"`.

Failure: `UNCONFIRMED_BLOCK`

> **Implementation note:** Nano confirmation is typically final within 1–2 seconds under normal network conditions. Facilitators MAY retry this check with a short backoff (e.g., up to 3 attempts x 1s) before returning `UNCONFIRMED_BLOCK`, to absorb the narrow window between block broadcast and representative confirmation.

### 11. Record block hash

Insert `payload.blockHash` into the seen-set with TTL = `max(accepted.extra.validBefore - floor(now_unix_seconds) + 5, 5)` seconds.

### Success response

```json
{
  "success": true,
  "txHash": "a3f9d1e2b4c5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1"
}
```

`txHash` is `payload.blockHash`. It is the transaction identifier carried in the `PAYMENT-RESPONSE` settlement receipt returned to the client by the resource server.

---

## Facilitator: Settlement (`POST /settle`)

Because this scheme is post-payment — the client submitted the Nano block before the HTTP exchange — there is no on-chain action for the facilitator to perform at settlement time. **Settlement is verification.**

The `/settle` endpoint MUST perform all the same checks as `/verify` and return the same response shape.

**Handling sequential `/verify` + `/settle` calls:** The x402 base spec permits resource servers to call `/verify` first and `/settle` after granting access. To support this correctly, the facilitator MUST distinguish between two seen-set states for a block hash:

| State | Meaning |
| --- | --- |
| `VERIFIED` | `/verify` succeeded; resource access not yet confirmed granted |
| `SETTLED` | `/settle` succeeded; resource access granted |

A `/settle` call for a block hash in `VERIFIED` state MUST succeed and transition the entry to `SETTLED`. A `/verify` or `/settle` call for a block hash already in `SETTLED` state MUST return `DUPLICATE_BLOCK_HASH`.

Facilitators that expose a single combined endpoint MUST apply equivalent logic.

---

## Client Implementation Guide

1. Receive 402 response
2. Decode PAYMENT-REQUIRED header: base64 -> JSON (PaymentRequired)
3. Select the accepts[] entry where scheme="exact" and network="nano:mainnet"
4. Verify extra.validBefore > floor(Date.now() / 1000) — discard stale challenges
5. Extract from the selected PaymentRequirements:
   * payTo -> send destination
   * amount -> minimum in raw
   * extra.nonce -> challenge nonce (64 hex chars)
   * extra.validBefore -> Unix expiry (seconds)
6. Send a Nano state block:
   * subtype: "send"
   * destination: payTo
   * amount: >= required amount in raw
7. Obtain the confirmed block hash from the RPC process_response or wallet API
8. Construct NOMS message string:
   * `"<blockHash>:<nonce>:<validBefore>"`
   * blockHash: 64 lowercase hex chars
   * nonce: 64 lowercase hex chars
   * validBefore: decimal integer string, no leading zeros
   * separators: ASCII colon (0x3A)
9. Produce NOMS signature:
   * Per ORIS-001 using the sending account's private key
10. Construct PaymentPayload:
```json
{
  "x402Version": 2,
  "resource":  "<PaymentRequired.resource, verbatim>",
  "accepted":  "<the selected PaymentRequirements entry, verbatim>",
  "payload": {
    "blockHash": "<64-char lowercase hex>",
    "account":   "<sending account address, nano_ prefix>",
    "signature": "<128-char lowercase hex NOMS signature>"
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
| `INVALID_SIGNATURE` | NOMS signature verification failed |
| `DUPLICATE_BLOCK_HASH` | This block hash has already completed a payment |
| `BLOCK_NOT_FOUND` | Block hash not found on the Nano network |
| `WRONG_BLOCK_TYPE` | Block is not a state send block |
| `SENDER_MISMATCH` | Block sender does not match `payload.account` |
| `WRONG_DESTINATION` | Block destination does not match `accepted.payTo` |
| `INSUFFICIENT_AMOUNT` | Block send amount is less than `accepted.amount` |
| `UNCONFIRMED_BLOCK` | Block exists but has not been confirmed by the network |

---

## Security Considerations

### Why NOMS and not a raw Ed25519 signature

A raw Ed25519 signature over the block hash bytes would prove key ownership, but creates a domain-confusion risk: a Nano block is itself an Ed25519-signed object over a Blake2b-256 hash of its fields. Using NOMS applies ORIS-001's fixed domain-separation header (`\x18Nano Off-chain Message:\n`), ensuring the payment proof signature is categorically distinct from a block signature and cannot be repurposed as one.

### Seen-set operational profile

The seen-set TTL is bounded by `extra.validBefore`, which is set to `now + maxTimeoutSeconds` at 402-issuance time. With a typical `maxTimeoutSeconds` of 60–120, the seen-set window is identical in magnitude to the `validBefore`/`validAfter` window used by EVM EIP-3009 payments. No persistent storage is required. A standard in-process TTL cache or Redis with key expiry is sufficient.

### Overpayment

The client MAY send more raw than `accepted.amount`. The facilitator accepts any amount >= the required amount. This is a client-side concern; the spec does not restrict it.

### Block hash uniqueness

Nano's block-lattice is an account chain. Each block's hash commits to its `previous` field (the hash of the prior block on that account chain), making it impossible to produce the same block hash twice from different transactions. A given block hash is globally unique and permanent.

### Confirmation requirement

Nano blocks can be published to the network but not yet confirmed by principal representatives. Accepting an unconfirmed block would allow a client to receive a resource and subsequently fork their account chain to roll back the send. Facilitators MUST only accept blocks where `block_info` returns `"confirmed": "true"`.

### Address comparison

Both `nano_` and `xrb_` address prefixes encode the same underlying 32-byte Ed25519 public key with a Blake2b checksum. All address comparisons in the facilitator MUST operate on the decoded public key bytes. String comparison of Nano addresses MUST NOT be used.

---

## Test Vectors

These vectors use the ORIS-001 canonical test keypair:

```
private key : 681fd5ed71a9f81e9d29e3450f6cd8aacb87346fd21a26003389290b9d0cb173
public key  : d2b3c9d00ffb55e84e7979d67308a515fb07ca79e40a77eb1aafe62881781783
account     : nano_3noms9a1zytox399kygpge6cc7hu1z79ms1cgzojodz8741qi7w5u3nzb8mn
```

### Vector 1

```
blockHash    : a3f9d1e2b4c5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
nonce        : a94f3e2c1b084d7f9e5a2c6b3d1e4f8a2c5b7d9e1f3a5c7b9d2e4f6a8c1b3d5e
validBefore  : 1718123456

message      : a3f9d1e2b4c5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1:a94f3e2c1b084d7f9e5a2c6b3d1e4f8a2c5b7d9e1f3a5c7b9d2e4f6a8c1b3d5e:1718123456
msg length   : 139 bytes (all ASCII)

NOMS payload (hex):
  184e616e6f204f66662d636861696e204d6573736167653a0a    <- MAGIC_HEADER (25 bytes)
  0000008b                                               <- MESSAGE_LENGTH uint32be(139)
  613366...                                              <- 139 message bytes

Blake2b-256 digest : (pending reference implementation)
signature          : (pending reference implementation)
```

> Concrete digest and signature values are pending an ORIS-001 reference implementation. The message string, byte length, and NOMS payload prefix above are normative and sufficient to implement and cross-test against. Once a canonical implementation publishes these values they will be added here in the same format as ORIS-001's own test vectors.

---
title: Protocol Specification
---

# x402.Nano Specification

**Status:** Draft  
**Date:** June 2026

## Abstract

x402.Nano defines two Nano-specific `exact` payment mechanism variants for x402:

- **Track A: `nanoTxn`** — a signed-block approach where the client constructs a full Nano state send block, the facilitator validates it cryptographically, then broadcasts it to the network.
- **Track B: `nanoSignature`** — a post-payment proof where the client sends Nano on-chain first, then proves sender ownership via a NOMS (ORIS-001) signature over `blockHash:nonce:validBefore`.

Both tracks are `scheme: "exact"` mechanisms using `network: "nano:mainnet"` per OpenRai ORIS-006. A Facilitator MAY advertise one or both in the `accepts` array of a 402 response.

This document covers the shared mechanism architecture, threat model, and security analysis. Wire format and verification details are in the track specs:

- [Track A: nanoTxn](./extensions/track-a-nanotxn.md)
- [Track B: nanoSignature](./extensions/track-b-nanosignature.md)

---

## 0. x402 v2 Primer

x402 is an HTTP-native payment protocol. A server signals that a resource requires payment by responding with `402 Payment Required`. The client pays, then retries the original request with proof. No redirects, no out-of-band flows.

### 0.1 The 402/Retry Cycle

```
Client                          Server
  │                               │
  │── GET /resource ─────────────>│
  │<── 402 + PAYMENT-REQUIRED ────│
  │    (base64 PaymentRequired)   │
  │                               │
  │  [select payment track]       │
  │  [pay on-chain]               │
  │  [construct proof]            │
  │                               │
  │── GET /resource ─────────────>│
  │   PAYMENT-SIGNATURE: <b64>    │
  │<── 200 + PAYMENT-RESPONSE ────│
```

### 0.2 Headers

| Direction | Header | Contents |
| --- | --- | --- |
| Server → Client (402) | `PAYMENT-REQUIRED` | Base64-encoded `PaymentRequired` JSON |
| Client → Server (retry) | `PAYMENT-SIGNATURE` | Base64-encoded `PaymentPayload` JSON |
| Server → Client (200) | `PAYMENT-RESPONSE` | Base64-encoded `PaymentResponse` JSON |

### 0.3 PaymentRequired

The server's 402 response body contains a `PaymentRequired` object. Its `accepts` array lists one or more acceptable payment options. Each entry is a `PaymentRequirements` object:

```json
{
  "scheme": "exact",
  "network": "nano:mainnet",
  "asset": "XNO",
  "amount": "1000000000000000000000000000",
  "payTo": "nano_3recv...",
  "maxTimeoutSeconds": 60,
  "extra": { }
}
```

The client selects one entry, pays accordingly, and includes that entry verbatim as the `accepted` field in its `PaymentPayload`.

### 0.4 PaymentPayload

The client's retry carries a `PaymentPayload` in `PAYMENT-SIGNATURE`:

```json
{
  "x402Version": 2,
  "resource": { "url": "...", "description": "...", "mimeType": "..." },
  "accepted": { /* verbatim PaymentRequirements entry */ },
  "payload": { /* track-specific proof */ }
}
```

The `payload` field is where the two tracks diverge. Track A carries the full signed Nano block; Track B carries the block hash and NOMS signature.

### 0.5 Network Identifier

The Nano CAIP-2 chain ID for public x402 interoperability is `nano:mainnet`, per OpenRai ORIS-006. This specification does not define `nano:testnet`, `nano:beta`, `nano:devnet`, or `nano:local`.

---

## 1. Threat Model and Assumptions

The protocol is designed for the following realistic environment:

- The Nano ledger is public and fully observable.
- Attackers may obtain their own economically equivalent payment challenges.
- Attackers may watch public send blocks and attempt to reuse observed block hashes.
- The HTTP dialogue between client and server runs over authenticated and confidential transport (HTTPS).

The protocol does **not** attempt to remain secure if the entire x402 dialogue is exposed to a plaintext-sniffing network attacker. If the request and retry payloads are visible in transit, the deployment is already outside the intended security envelope.

---

## 2. Core Model

### 2.1 Track A: Signed-Block Model (`nanoTxn`)

The client constructs and signs a full Nano state send block. The block's Ed25519 signature commits to all block fields (account, previous, representative, balance, link), providing proof of sender ownership. The facilitator validates the block, then broadcasts it to the network via the `process` RPC.

This is analogous to EVM's `exact` scheme: the client pre-authorizes a transfer that the facilitator submits on-chain. The known compromise is Nano's frontier dilemma — unrelated account activity before broadcast invalidates the block.

### 2.2 Track B: Post-Payment Proof Model (`nanoSignature`)

The client sends a Nano transaction on-chain first, then proves to the facilitator that they were the sender by producing a NOMS (ORIS-001) signature over a canonical message:

```
<blockHash>:<nonce>:<validBefore>
```

This message binds:

- `blockHash`: the specific on-chain send block
- `nonce`: a server-issued challenge nonce (32 random bytes, hex-encoded)
- `validBefore`: a Unix timestamp after which the signature is cryptographically invalid

The NOMS domain-separation header ensures this signature cannot be confused with a Nano block signature.

### 2.3 Facilitator Role by Track

| | Track A (`nanoTxn`) | Track B (`nanoSignature`) |
| --- | --- | --- |
| Validates signed block | Yes (block signature, balance, destination) | No (block already on-chain) |
| Verifies NOMS signature | No | Yes |
| Broadcasts to network | Yes (via `process` RPC) | No (client already sent) |
| Waits for confirmation | Yes | Yes (via `block_info`) |
| Holds keys | Never | Never |

### 2.4 Replay Protection

**Track A:**
- Fork protection via `block.previous` tracking (prevents concurrent blocks from the same frontier)
- Block hash seen-set after broadcast (prevents reuse of settled blocks)
- Expiry via `extra.validBefore`

**Track B:**
- Cryptographic expiry bound (`validBefore` included in the signed NOMS message)
- Block hash seen-set within the validity window

---

## 3. Security Model

### 3.1 Sender Ownership Proof

Both tracks prove that the entity submitting the `PaymentPayload` controls the private key of the paying account:

- **Track A:** The block's Ed25519 signature commits to all block fields including the balance decrement and destination. This IS a Nano block signature — by design, since the facilitator broadcasts this exact block.
- **Track B:** The NOMS signature is categorically distinct from a Nano block signature (domain-separated via ORIS-001 header), preventing repurposing.

### 3.2 Replay Resistance

| Scenario | Track A | Track B |
| --- | --- | --- |
| Same block hash, same challenge | Block hash seen-set | Block hash seen-set |
| Same block hash, different challenge | Block hash seen-set | Block hash seen-set |
| Same frontier, concurrent blocks | `block.previous` fork protection | N/A (client pays on-chain) |
| Cross-challenge amount reuse | Block hash seen-set | N/A (nonce in signed message) |
| After expiry | `extra.validBefore` | Cryptographic expiry (`validBefore`) |

### 3.3 Transport Assumption

This specification does not claim to protect against:

- A plaintext-sniffing network attacker who can read the entire x402 dialogue.
- A compromised client endpoint that leaks the retry payload before redemption.

### 3.4 Block Hash Uniqueness

Nano's block-lattice is an account chain. Each block's hash commits to its `previous` field, making it impossible to produce the same block hash twice from different transactions. A given block hash is globally unique and permanent.

### 3.5 Confirmation Requirement

Nano blocks can be published but not yet confirmed by principal representatives. Accepting an unconfirmed block would allow a client to receive a resource and subsequently fork their account chain to roll back the send. Facilitators MUST only accept blocks where `block_info` returns `"confirmed": "true"`.

---

## 4. Attack Matrix

### Track A (`nanoTxn`)

Assume:
- `C_A` = challenge for ClientA (`validBefore_A`, `amount_A`, `payTo_A`)
- `B_A` = signed block matching `C_A`

| Presented | Challenge | Presenter | Expected |
| --- | --- | --- | --- |
| `B_A` | `C_A` | ClientA | ALLOW |
| `B_A` | `C_B` | ClientB | DENY (transport-secured; block not visible to ClientB) |
| Block with invalid signature | `C_A` | ClientA | DENY (`INVALID_SIGNATURE`) |
| `B_A` with stale frontier | `C_A` | ClientA | DENY (`STALE_FRONTIER`) |
| Duplicate frontier | `C_A` | ClientA | DENY (`DUPLICATE_FRONTIER`) |

### Track B (`nanoSignature`)

Assume:
- `C_A` = challenge for ClientA (`nonce_A`, `validBefore_A`, `amount_A`, `payTo_A`)
- `S_A` = real send block matching `C_A`
- `SIG_A` = valid NOMS signature for `C_A` from ClientA

| Presented | Challenge | Presenter | Expected |
| --- | --- | --- | --- |
| `S_A + SIG_A` | `C_A` | ClientA | ALLOW |
| `S_A + SIG_A` | `C_B` | ClientB | DENY (nonce differs; signature invalid for `C_B`'s message) |
| `S_A` + invalid signature | `C_A` | ClientA | DENY (`INVALID_SIGNATURE`) |
| Unrelated block + `SIG_A` | `C_A` | ClientA | DENY (block hash mismatch) |
| `S_A + SIG_A` (duplicate) | `C_A` | ClientA | DENY (seen-set) |
| `S_A + SIG_A` after `validBefore_A` | `C_A` | ClientA | DENY (cryptographic expiry) |

---

## See Also

- [Track A: nanoTxn](./extensions/track-a-nanotxn.md)
- [Track B: nanoSignature](./extensions/track-b-nanosignature.md)
- [ORIS-001: Nano Off-chain Message Signing (NOMS)](https://github.com/OpenRai/Standards/blob/main/rfcs/ORIS-001.md)
- [x402 Standard](https://github.com/x402-foundation/x402)

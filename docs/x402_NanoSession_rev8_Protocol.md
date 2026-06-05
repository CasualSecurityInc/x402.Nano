---
title: Protocol Specification
---

# x402.NanoSession Protocol Specification (Rev 8)

**Status:** Draft  
**Date:** June 2026

## Abstract

x402.NanoSession Rev 8 defines two Nano-specific `exact` payment tracks for x402:

- **Track A: `nanoTxn`** — a signed-block approach where the client constructs a full Nano state send block, the facilitator validates it cryptographically, then broadcasts it to the network. See [Track A: nanoTxn](./x402_NanoSession_rev8_Track_A_nanoTxn.md).
- **Track B: `nanoSignature`** — a stateless post-payment proof where the client sends Nano on-chain first, then proves sender ownership via a NOMS (ORIS-001) signature over `blockHash:nonce:validBefore`. See [Track B: nanoSignature](./x402_NanoSession_rev8_Track_B_nanoSignature.md).

Both tracks are `scheme: "exact"` mechanisms using `network: "nano:mainnet"` per OpenRai ORIS-006. They are not competing schemes — they are two mechanisms intended for different deployment constraints.

This document provides the shared protocol architecture, threat model, and security analysis.

## 0. Finalization Direction

Rev 8 is finalized as a dual-track Nano exact proposal for upstream x402 review:

- **Track A: `nanoTxn`** — a signed-block approach resembling EVM-style pre-authorization. Best for single-purpose or agent wallets. See [Track A: nanoTxn](./x402_NanoSession_rev8_Track_A_nanoTxn.md) for the full specification.
- **Track B: `nanoSignature`** — a stateless post-payment proof using NOMS (ORIS-001) signatures. Best for general-purpose wallets. See [Track B: nanoSignature](./x402_NanoSession_rev8_Track_B_nanoSignature.md) for the full specification.

A Facilitator MAY advertise one or both tracks in the `accepts` array of a 402 response.

### 0.1 Network Identifier

The Nano CAIP-2 chain ID for public x402 interoperability is `nano:mainnet`, per OpenRai ORIS-006. This specification does not define `nano:testnet`, `nano:beta`, `nano:devnet`, or `nano:local`.

## 1. Threat Model And Assumptions

Rev 8 is designed for the following realistic environment:

- the Nano ledger is public and fully observable
- attackers may obtain their own economically equivalent payment challenges
- attackers may watch public send blocks and attempt to reuse observed block hashes
- the HTTP dialogue between client and server is assumed to run over authenticated and confidential transport such as HTTPS

Rev 8 does **not** attempt to remain secure if the entire x402 dialogue is exposed to a plaintext-sniffing network attacker. If the request and retry payloads are visible in transit, the deployment is already outside the intended security envelope.

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

### 2.3 Verify-Only Facilitator (Track B) vs Verify-and-Broadcast Facilitator (Track A)

The facilitator's role differs by track:

| | Track A (`nanoTxn`) | Track B (`nanoSignature`) |
| --- | --- | --- |
| Validates signed block | Yes (block signature, balance, destination) | No (block already on-chain) |
| Verifies NOMS signature | No | Yes |
| Broadcasts to network | Yes (via `process` RPC) | No (client already sent) |
| Waits for confirmation | Yes | Yes (confirms via `block_info`) |
| Holds keys | Never | Never |

### 2.4 Replay Protection

Both tracks prevent replay through different mechanisms:

**Track A:**
- Fork protection via `block.previous` tracking (prevents concurrent blocks from the same frontier)
- Block hash seen-set after broadcast (prevents reuse of settled blocks)
- Expiry via `extra.validBefore` (Unix timestamp)

**Track B:**
- Cryptographic expiry bound (`validBefore` in the signed NOMS message)
- Block hash seen-set within the validity window

## 3. Protocol Flow

For the complete data types, payload format, and verification algorithm, see:
- [Track A: nanoTxn](./x402_NanoSession_rev8_Track_A_nanoTxn.md)
- [Track B: nanoSignature](./x402_NanoSession_rev8_Track_B_nanoSignature.md)

## 4. HTTP Headers

### 4.1 Server -> Client (402 Response)

**Header:** `PAYMENT-REQUIRED`

Base64-encoded `PaymentRequired` JSON.

### 4.2 Client -> Server (Retry)

**Header:** `PAYMENT-SIGNATURE`

Base64-encoded `PaymentPayload` JSON. Contains the signed block (Track A) or NOMS proof (Track B).

### 4.3 Server -> Client (Success)

**Header:** `PAYMENT-RESPONSE`

Base64-encoded `PaymentResponse` JSON.

## 5. Security Model

### 5.1 Sender Ownership Proof

Both tracks prove that the entity submitting the `PaymentPayload` controls the private key of the paying account:

- **Track A:** The block's Ed25519 signature commits to all block fields including the balance decrement and destination. This IS a Nano block signature — by design, since the facilitator will broadcast this exact block.
- **Track B:** The NOMS signature is categorically distinct from a Nano block signature (domain-separated via ORIS-001 header), preventing repurposing.

### 5.2 Replay Resistance

| Scenario | Track A | Track B |
| --- | --- | --- |
| Same block hash, same challenge | Block hash seen-set | Block hash seen-set |
| Same block hash, different challenge | Block hash seen-set | Block hash seen-set |
| Same frontier, concurrent blocks | `block.previous` fork protection | N/A (client pays on-chain) |
| Cross-challenge amount reuse | Block hash seen-set | N/A (nonce in signed message) |
| After expiry | Challenge `validBefore` | Cryptographic expiry (`validBefore`) |

### 5.3 Transport Assumption

Rev 8 assumes the request/response dialogue is not publicly readable in transit.

This specification does not claim to protect against:

- a plaintext-sniffing network attacker who can read the entire x402 dialogue
- a compromised client endpoint that leaks the retry payload before redemption

### 5.4 Block Hash Uniqueness

Nano's block-lattice is an account chain. Each block's hash commits to its `previous` field (the hash of the prior block on that account chain), making it impossible to produce the same block hash twice from different transactions. A given block hash is globally unique and permanent.

### 5.5 Confirmation Requirement

Nano blocks can be published to the network but not yet confirmed by principal representatives. Accepting an unconfirmed block would allow a client to receive a resource and subsequently fork their account chain to roll back the send. Facilitators MUST only accept blocks where `block_info` returns `"confirmed": "true"`.

## 6. Attack Matrix

### Track A (`nanoTxn`)

Assume:

- `C_A` = challenge for ClientA (validBefore_A, amount_A, payTo_A)
- `B_A` = signed block matching `C_A`
- `B_bad` = block with invalid signature
- `B_rand` = unrelated valid block

| Presented | Challenge | Presenter | Expected |
| --- | --- | --- | --- |
| `B_A` | `C_A` | ClientA | ALLOW |
| `B_A` | `C_B` | ClientB | DENY (transport-secured; block is not visible to ClientB) |
| `B_bad` | `C_A` | ClientA | DENY (invalid signature) |
| `B_A` (stale frontier) | `C_A` | ClientA | DENY (STALE_FRONTIER) |
| Duplicate frontier | `C_A` | ClientA | DENY (DUPLICATE_FRONTIER) |

### Track B (`nanoSignature`)

Assume:

- `C_A` = challenge for ClientA (nonce_A, validBefore_A, amount_A, payTo_A)
- `S_A` = real send block matching `C_A`
- `SIG_A` = valid NOMS signature for `C_A` from ClientA
- `SIG_bad` = random or mismatched NOMS signature
- `S_rand` = unrelated public send block

| Presented | Challenge | Presenter | Expected |
| --- | --- | --- | --- |
| `S_A + SIG_A` | `C_A` | ClientA | ALLOW |
| `S_A + SIG_A` | `C_B` | ClientB | DENY (nonce differs, signature invalid for C_B's message) |
| `S_A + SIG_bad` | `C_A` | ClientA | DENY (invalid signature) |
| `S_rand + SIG_A` | `C_A` | ClientA | DENY (block hash mismatch) |
| exact duplicate redemption of `S_A` for `C_A` | `C_A` | ClientA | DENY (seen-set) |
| `S_A + SIG_A` after `validBefore_A` | `C_A` | ClientA | DENY (cryptographic expiry) |

## 7. Scope Boundary

This document defines only:

- the dual-track Nano exact mechanism architecture
- the shared threat model and security analysis
- reference to [Track A: nanoTxn](./x402_NanoSession_rev8_Track_A_nanoTxn.md) and [Track B: nanoSignature](./x402_NanoSession_rev8_Track_B_nanoSignature.md) for wire format details

This document does not define:

- reusable access credentials
- application admission semantics after payment

## See Also

- [Track A: nanoTxn](./x402_NanoSession_rev8_Track_A_nanoTxn.md) — signed-block wire format and verification specification
- [Track B: nanoSignature](./x402_NanoSession_rev8_Track_B_nanoSignature.md) — NOMS post-payment proof wire format and verification specification
- [ORIS-001: Nano Off-chain Message Signing (NOMS)](https://github.com/OpenRai/Standards/blob/main/rfcs/ORIS-001.md)
- [x402 Standard](https://github.com/x402-foundation/x402)

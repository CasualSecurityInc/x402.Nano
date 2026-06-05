---
title: Intro
---

# x402.NanoSession (Rev 8) — Intro

x402.NanoSession defines a per-request HTTP 402 payment profile for access to web resources and APIs. In x402 layer terms, it provides `scheme: "exact"` with payments settled instantly and feelessly via Nano (XNO), avoiding gas fee calculations and other smart-contract overhead altogether.

> [!IMPORTANT]
> **Finalization note:** Rev 8 proposes two Nano exact **tracks** for upstream x402 review. Track A (`nanoTxn`) is the signed-block approach where the client constructs a full Nano send block, the facilitator validates and broadcasts it. Track B (`nanoSignature`) is the NOMS post-payment proof where the client sends on-chain first, then proves sender ownership via a NOMS (ORIS-001) signature. Both remain x402 `scheme: "exact"` mechanisms and both use `network: "nano:mainnet"` per OpenRai ORIS-006; no Nano testnet CAIP-2 identifier is defined for public interoperability.

## Upstream Proposal Shape

NanoSession Rev 8 proposes two complementary tracks for upstream x402 review:

- **Track A: `nanoTxn`** — a signed-block approach where the client constructs and signs a full Nano state send block, the facilitator validates it cryptographically, then broadcasts it to the network. This resembles other x402 exact mechanisms and is practical for controlled wallets or single-purpose payer accounts. Its compromise is Nano's frontier dilemma: unrelated account activity before broadcast can invalidate the signed block.
- **Track B: `nanoSignature`** — a stateless post-payment proof where the client sends Nano on-chain first, then proves sender ownership to the facilitator via a NOMS (ORIS-001) signature. The facilitator is verify-only: it checks the on-chain send, verifies the NOMS proof, and confirms the block is settled. It never touches funds, never holds keys, and never submits anything to the Nano network.

The two tracks are not competing schemes. They are two Nano mechanisms under the same x402 `exact` scheme, intended for different deployment constraints.

| Feature | Original x402 (x402.org) | x402.NanoSession Rev 8 |
| --- | --- | --- |
| Transport | HTTP 402 with x402 V2 headers | HTTP 402 with x402 V2 headers |
| Payment rail | Onchain stablecoins (e.g., USDC on Base) | Nano (XNO): feeless, sub-second finality |
| Client proof | Transfer authorization (EIP-3009) | `nanoTxn`: signed state block (Ed25519) |
|  |  | `nanoSignature`: NOMS signature over blockHash:nonce:validBefore |
| Request binding | Payment parameters signed via EIP-712 | `nanoTxn`: signed state block commits to all fields |
|  |  | `nanoSignature`: nonce + validBefore in signed NOMS message |
| Concurrency | Per-request wallet signature | `nanoTxn`: frontier-dependent (best for agent wallets) |
|  |  | `nanoSignature`: stateless — no server state required |

## Two Mechanism Tracks

Rev 8 introduces **two complementary mechanism tracks** addressing different deployment constraints. Throughout this specification, they are identified by their track letter and `extra` field keys:

- **Track A: `nanoTxn`** (signed-block): The client constructs and signs a full Nano state send block. The facilitator validates the block and broadcasts it on-chain. Best for single-purpose or agent wallets where the account frontier is controlled. Uses `extra.validBefore` for expiry.
- **Track B: `nanoSignature`** (stateless post-payment): The client sends Nano on-chain first, then proves sender ownership via a NOMS (ORIS-001) signature. The facilitator is verify-only. Best for general-purpose wallets and public resources. Uses `extra.nonce` + `extra.validBefore` for challenge binding.

A Facilitator MAY advertise one or both tracks in the `accepts` array of a 402 response.

## Why Two Tracks?

The two tracks address different deployment constraints:

The `nanoTxn` track follows the signed-block pattern familiar from EVM x402 implementations, where the client pre-authorizes a transfer that the facilitator submits on-chain. On Nano, this means the client constructs a full state block and the facilitator broadcasts it. Best for single-purpose or agent wallets where the account frontier is controlled.

The `nanoSignature` track uses a post-payment proof model with NOMS (ORIS-001) signatures. The client sends Nano on-chain first, then proves sender ownership to the facilitator. NOMS applies a fixed domain-separation header (`\x18Nano Off-chain Message:\n`), ensuring the payment proof signature is categorically distinct from a Nano block signature and cannot be repurposed as one. Best for general-purpose wallets and public resources.

## Protocol Flow

### Track A: nanoTxn (Signed Block)

The client constructs and signs a full Nano state send block. The facilitator validates and broadcasts it.

```
Client                        Resource Server               Facilitator           Nano Network
  │                                  │                           │                      │
  │── GET /resource ────────────────>│                           │                      │
  │<── 402 + PAYMENT-REQUIRED ───────│                           │                      │
  │    (validBefore, payTo,          │                           │                      │
  │     amount)                      │                           │                      │
  │                                  │                           │                      │
  │  [account_info RPC]              │                           │                      │
  │  [construct send block]          │                           │                      │
  │  [sign block]                    │                           │                      │
  │  [generate PoW]                  │                           │                      │
  │                                  │                           │                      │
  │── GET /resource ────────────────>│                           │                      │
  │   PAYMENT-SIGNATURE:             │── POST /verify ──────────>│                      │
  │   (full signed block)            │                           │  [validate structure]│
  │                                  │                           │  [check expiry]      │
  │                                  │                           │  [verify destination]│
  │                                  │                           │  [verify amount]     │
  │                                  │                           │  [verify frontier]   │
  │                                  │                           │  [verify signature]  │
  │                                  │                           │  [fork protection]   │
  │                                  │<── { isValid } ───────────│                      │
  │                                  │                           │                      │
  │                                  │── POST /settle ──────────>│                      │
  │                                  │                           │── process RPC ──────>│
  │                                  │                           │<── block hash ───────│
  │                                  │<── { success, tx } ───────│                      │
  │<── 200 + PAYMENT-RESPONSE ───────│                           │                      │
```

### Track B: nanoSignature (Stateless Post-Payment)

The client sends Nano on-chain, then proves sender ownership via a NOMS (ORIS-001) signature. The facilitator is verify-only.

```
Client                        Resource Server               Facilitator           Nano Network
  │                                  │                           │                      │
  │── GET /resource ────────────────>│                           │                      │
  │<── 402 + PAYMENT-REQUIRED ───────│                           │                      │
  │    (nonce, validBefore, payTo,   │                           │                      │
  │     amount)                      │                           │                      │
  │                                  │                           │                      │
  │── send block ──────────────────────────────────────────────────────────────────────>│
  │<── block hash ─────────────────────────────────────────────────────────────────────│
  │                                  │                           │                      │
  │  [construct NOMS message]        │                           │                      │
  │  [sign blockHash:nonce:validBefore]                         │                      │
  │                                  │                           │                      │
  │── GET /resource ────────────────>│                           │                      │
  │   PAYMENT-SIGNATURE:             │── POST /verify ──────────>│                      │
  │   (blockHash, account, signature)│                           │  [check validBefore] │
  │                                  │                           │  [verify NOMS sig]   │
  │                                  │                           │  [replay dedup]      │
  │                                  │                           │── block_info RPC ───>│
  │                                  │                           │  [check sender]      │
  │                                  │                           │  [check destination] │
  │                                  │                           │  [check amount]      │
  │                                  │                           │  [check confirmed]   │
  │                                  │<── success ───────────────│                      │
  │<── 200 + PAYMENT-RESPONSE ───────│                           │                      │
```

## Scheme vs Mechanism

NanoSession does **not** define a new x402 scheme id. It uses:
- `scheme: "exact"` (payment style)
- Two mechanism tracks:
  - Track A: `nanoTxn` — signed-block proof with `extra.validBefore` + `payload.block`
  - Track B: `nanoSignature` — NOMS-bound proof with `extra.nonce` + `extra.validBefore` + `payload.signature`

For the detailed wire format and verification rules:
- [Track A: nanoTxn](./x402_NanoSession_rev8_Track_A_nanoTxn.md)
- [Track B: nanoSignature](./x402_NanoSession_rev8_Track_B_nanoSignature.md)

## Core Architecture

Unlike many complex Web3 protocols, NanoSession builds exactly on the `HTTP 402` mechanics described by the `x402` spec, leveraging Nano's feeless and near-instant properties.

The architecture comprises three primary actors natively, and logically separates server-side responsibilities into two distinct roles to support massive scale:

1. **Client (User Agent)**: A browser, CLI, or app that attempts to access a protected HTTP resource, receives a 402 requirement, pays the Nano network, and retries the request with proof.
2. **Resource Server**: The entry point that receives public HTTP requests from the Client. It does *not* talk to the blockchain. Its only jobs are determining if a resource costs money, issuing the `402 Payment Required` headers, and serving the content once payment is verified.
3. **Facilitator**: An optional but recommended backend clearinghouse. In Track A, it validates signed blocks and broadcasts them to the network. In Track B, it verifies NOMS signatures and confirms on-chain blocks. It prevents double-spends and confirms settlement before granting resource access.

> [!NOTE]
> **Deployment Patterns**: While the protocol logically separates the *Resource Server* and *Facilitator* into distinct roles, it is entirely acceptable to deploy both roles together in a single **Monolithic Service (Embedded Facilitator)**. This is particularly useful for smaller applications, whereas larger enterprises may elect to use a **Standalone Facilitator** so the Resource Server never touches blockchain networking or keys.

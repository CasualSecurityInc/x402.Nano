---
title: Intro
---

# x402.NanoSession (Rev 7) — Intro

x402.NanoSession defines a per-request HTTP 402 payment profile for access to web resources and APIs. In x402 layer terms, it provides `scheme: "exact"` with payments settled instantly and feelessly via Nano (XNO), avoiding gas fee calculations and other smart-contract overhead altogether.

| Feature | Original x402 (x402.org) | x402.NanoSession Rev 7 |
| --- | --- | --- |
| Transport | HTTP 402 with x402 V2 headers | HTTP 402 with x402 V2 headers |
| Payment rail | Onchain stablecoins (e.g., USDC on Base) | Nano (XNO): feeless, sub-second finality |
| Client proof | Transfer authorization (EIP-3009) | Block hash + optional Ed25519 signature |
| Request binding | Payment parameters signed via EIP-712 | `nanoSession`: server-issued session id + tagged amount |
|  |  | `nanoSignature`: Ed25519 signature binding block hash to request URL |
| Concurrency | Per-request wallet signature | `nanoSession`: multiplexed via unique session + tagged amount per address |
|  |  | `nanoSignature`: stateless — no server state required |

## Two Mechanism Variants

Rev 7 introduces **two complementary mechanism variants** addressing different scalability and security needs. Throughout this specification, they are identified by their `extra` field key:

- **`nanoSession`** (stateful): The Facilitator issues a unique session per request. Best for high-throughput APIs with a dedicated Facilitator. The "session is the security primitive."
- **`nanoSignature`** (stateless): The client signs `block_hash + request_url` with their Nano account key. The Facilitator verifies the signature cryptographically without needing prior session state. An atomic **Settle-Before-Grant** routine (receive block broadcast) acts as the ledger-level mutex against double-spending.

A Facilitator MAY advertise one or both variants in the `accepts` array of a 402 response.

## Why "NanoSession"?

The name reflects a core architectural truth of the `nanoSession` variant: **the session is the security primitive**.

Nano's block-lattice is publicly observable in real-time. Anyone can see payments as they occur. A block hash alone proves only that *a payment happened* — not *who requested it*. Without binding payments to specific requests, an attacker could intercept a payment proof and claim it as their own.

The **session** provides this binding:

1. Server issues unique session `id` with each payment request
2. Client returns `id` (nested in `nanoSession`) alongside the block hash
3. Server verifies the block matches requirements for *that specific session*

## Protocol Flow

### Track 1: nanoSession (Stateful)

The Facilitator generates a unique session ID and tag for each request.

```
Client                    Server/Facilitator                 Nano
  │                                │                          │
  │  GET /resource                 │                          │
  │───────────────────────────────>│                          │
  │                                │                          │
  │  402 + PAYMENT-REQUIRED        │                          │
  │  (nanoSession.id, taggedAmount,│                          │
  │   payTo, transparent parts)    │                          │
  │<───────────────────────────────│                          │
  │                                │                          │
  │  send_block(taggedAmount)      │                          │
  │───────────────────────────────────────────────────────────>
  │                                │                          │
  │  GET /resource                 │                          │
  │  + PAYMENT-SIGNATURE           │                          │
  │    (blockHash, nanoSession.id) │  verify block + session  │
  │───────────────────────────────>│──────────────────────────>
  │                                │                          │
  │  200 OK                        │                          │
  │<───────────────────────────────│                          │
```

### Track 2: nanoSignature (Stateless)

The Client cryptographically binds the payment to the specific request URL in a way that keeps it closer to the original x402 EIP-centric flow.

```
Client                    Server/Facilitator                Nano
  │                               │                           │
  │  GET /resource                │                           │
  │──────────────────────────────>│                           │
  │                               │                           │
  │  402 + PAYMENT-REQUIRED       │                           │
  │  (nanoSignature.messageToSign,│                           │
  │   amount, payTo)              │                           │
  │<──────────────────────────────│                           │
  │                               │                           │
  │  send_block(amount)           │                           │
  │───────────────────────────────────────────────────────────>
  │                               │                           │
  │  GET /resource                │                           │
  │  + PAYMENT-SIGNATURE          │                           │
  │    (blockHash, signature)     │    verify sig + receive   │
  │──────────────────────────────>│───────────────────────────>
  │                               │                           │
  │  200 OK                       │                           │
  │<──────────────────────────────│                           │
```




## Scheme vs Mechanism

NanoSession does **not** define a new x402 scheme id. It uses:
- `scheme: "exact"` (payment style)
- Two mechanism variants:
  - `nanoSession`: session-bound proof with `extra.nanoSession` + `payload.proof`
  - `nanoSignature`: signature-bound proof with `extra.nanoSignature` + `payload.proof` + `payload.signature`

For the detailed rationale on why this differs from EVM-style pre-signed authorization flows, see [Protocol Specification §2.4–§2.5](./x402_NanoSession_rev7_Protocol.md#24-why-evm-style-exact-authorizations-are-unviable-for-nano).  
For interoperability and adapter guidance, see [Interoperability Matrix](./x402_NanoSession_rev7_Appendix_Interoperability_Matrix.md).

## Core Architecture

Unlike many complex Web3 protocols, NanoSession builds exactly on the `HTTP 402` mechanics described by the `x402` spec, leveraging Nano's feeless and near-instant properties.

The architecture comprises three primary actors natively, and logically separates server-side responsibilities into two distinct roles to support massive scale:

1. **Client (User Agent)**: A browser, CLI, or app that attempts to access a protected HTTP resource, receives a 402 requirement, pays the Nano network, and retries the request with proof.
2. **Resource Server**: The entry point that receives public HTTP requests from the Client. It does *not* talk to the blockchain. Its only jobs are determining if a resource costs money, issuing the `402 Payment Required` headers, and serving the content once payment is verified.
3. **Facilitator**: An optional but recommended backend clearinghouse. It holds the network accounts and API keys, listens to the Nano blockchain (via WebSocket or RPC), verifies block hashes, prevents double-spends (via the Spent Set), and cryptographically guarantees session validation.

> [!NOTE]
> **Deployment Patterns**: While the protocol logically separates the *Resource Server* and *Facilitator* into distinct roles, it is entirely acceptable to deploy both roles together in a single **Monolithic Service (Embedded Facilitator)**. This is particularly useful for smaller applications, whereas larger enterprises may elect to use a **Standalone Facilitator** (such as Coinbase's hosted APIs or an independent local service) so the Resource Server never touches blockchain networking or keys.


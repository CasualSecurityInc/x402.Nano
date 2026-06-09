---
title: Interop Matrix
---

# Appendix: Interoperability Matrix (CAIP & x402 v2)

This appendix documents the practical interoperability posture for NanoSession Rev 7:
- what is implemented now for x402 v2 wire compatibility,
- what third-party adapters should support for robust integration,
- what remains optional future work for deeper CAIP/SIWx alignment.

## Compatibility Matrix

| Interoperability Area | NanoSession Rev 7 (Current) | Interop Guidance |
| :--- | :--- | :--- |
| **[Scheme & Proof Model](#scheme--proof-model)** | `scheme: "exact"` with two mechanism variants: `nanoSession` (stateful, `extra.nanoSession` + `payload.proof`) and `nanoSignature` (stateless, `extra.nanoSignature` + `payload.proof` + `payload.signature`) | Treat both as `exact` mechanism variants, not separate scheme ids |
| **[x402 V2 Headers](#x402-v2-headers)** | Uses `PAYMENT-REQUIRED` and `PAYMENT-SIGNATURE` | Preserve standard headers and base64 JSON transport |
| **[Network, Account, Asset Fields](#network-account-asset-fields)** | `network: "nano:mainnet"`, `payTo: "nano_..."`, `asset: "XNO"` | Support current values now; CAIP-normalized profile is future/optional |
| **[Payload/Extra Tolerance](#payloadextra-tolerance)** | `payload.proof` is canonical; `extra.nanoSession` for stateful binding; `extra.nanoSignature` + `payload.signature` for stateless binding | Adapters SHOULD tolerate shape variants and both extra keys |
| **[Session Identity Extensions](#session-identity-extensions)** | Core flow is per-request payment | SIWx-style reusable identity is optional future extension work |

## Current Baseline (Implemented)

### Scheme & Proof Model
NanoSession implements x402 `exact` and does not introduce a separate protocol scheme name.
- Canonical values:
- `scheme: "exact"`
- `network: "nano:mainnet"`
- `payload.proof` carries the Nano block hash
- **`nanoSession` variant:** `extra.nanoSession` carries session-binding fields (`id`, `tag`, `resourceAmountRaw`, `tagAmountRaw`, optional `expiresAt`)
- **`nanoSignature` variant:** `extra.nanoSignature` carries `messageToSign` template; `payload.signature` carries the Ed25519 signature binding `block_hash + url`

### x402 V2 Headers
NanoSession is aligned with x402 v2 header transport.
- `PAYMENT-REQUIRED` for 402 negotiation payloads
- `PAYMENT-SIGNATURE` for retry requests with payment proof

### Network, Account, Asset Fields
Current Rev 7 wire values are:
- `network: "nano:mainnet"`
- `payTo: "nano_..."`
- `asset: "XNO"`
These are the interoperability baseline for current NanoSession implementations.

## Adapter Requirements (Recommended Now)

### Payload/Extra Tolerance
To maximize third-party compatibility, adapters SHOULD:
- accept `payload.proof` as canonical and MAY accept legacy `payload.blockHash`
- tolerate unknown top-level fields in payment payloads and requirements
- tolerate optional/absent metadata fields such as `resource`, `description`, `mimeType`
- tolerate optional/absent `extra.nanoSession.expiresAt` and derive expiry from timeout when needed

### Session-Binding Invariants
Adapters MUST preserve NanoSession security invariants:
- verify against issued session requirements (not caller-mutated copies)
- enforce exact amount and destination match
- enforce anti-replay via spent-set checks

### nanoSignature-Specific Invariants
Adapters handling `nanoSignature` payloads MUST additionally:
- verify Ed25519 signature over `block_hash + request_url` against the send block's source account public key
- verify the send block is still receivable (via `receivable_exists` RPC)
- pass the `url` context to the Facilitator's `handleVerify` / `handleSettle` calls

## Future Optional Interoperability Profile

### CAIP-2: Chain Identification
Potential future profile:
- namespace/chain normalization (for example, moving from `"nano:mainnet"` to a formally registered CAIP-2 identifier)
- formal registry process for Nano CAIP namespace and chain references

### CAIP-10: Account Identification
Potential future profile:
- CAIP-10-style account identifiers for destination addresses
- compatibility guidance for clients that currently validate only EVM/SVM-style account formats

### CAIP-19: Asset Identification
Potential future profile:
- CAIP-19-style asset identifiers in place of or alongside ticker-style identifiers like `"XNO"`
- dual-field transition strategy to avoid breaking existing clients

### CAIP-122: Sign-In With X (SIWx)
Potential future profile:
- wallet identity and reusable access sessions via a Nano-compatible SIWx pattern
- standardized message-signing conventions in Nano wallets for session reuse
- extension-driven rollout without changing core per-request payment semantics

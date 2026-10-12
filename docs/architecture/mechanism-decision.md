---
title: Mechanism decision
---

# Mechanism decision

**Status:** Proposed direction; implementation work remains
**Date:** 2026-10-12

## Decision

Use the repository's dual-track Rev 8 specification as the intended design direction, and prioritize Track B (`nanoSignature`) for the next conforming implementation. Keep Track A documented as an optional mechanism for controlled payer accounts. Do not label either track production-ready until the gaps in the [consistency audit](../audits/protocol-consistency-audit.md) are closed.

This is a local engineering decision, not an x402 Foundation or OpenRai standardization decision. `scheme: "exact"` remains the x402 scheme; the Nano-specific proof and settlement contract is the mechanism/profile.

## Why Track B first

Track A asks a facilitator to publish a block signed against a payer frontier that may have advanced. A client retry after unrelated account activity can fail and require a new payment construction. Track B pays before submitting proof, so it avoids facilitator broadcast of a stale prepared block. Track B still has account-chain ordering at the payer, payment/redeem recovery concerns, and an unresolved way to distinguish equal-value payments intended for different challenges.

The minimum acceptable Track B contract needs all of the following before implementation is called conforming:

1. A challenge has a server-issued unpredictable identifier/nonce, explicit `validBefore`, exact amount, destination, and resource binding.
2. The signed proof binds the confirmed send hash to that challenge data and payer account.
3. Verification checks ledger confirmation, sender, destination, exact amount, expiry, and challenge issuance.
4. Redemption is an atomic, durable, idempotent transition. A retry of the same redemption returns the same outcome; another challenge cannot consume it.
5. The server defines what happens when payment confirms after expiry, the response is lost, or redemption fails after the transaction is already irreversible.

The current public Track B document covers only part of this contract. In particular, do not assume that adding a nonce to a signature alone provides request binding if the ledger payment itself is indistinguishable across same-price challenges.

## Trade-offs

| Choice | Benefit | Cost / remaining risk |
|---|---|---|
| Track B, client sends first | Avoids facilitator broadcast against an old frontier; facilitator need not hold payer keys | Payment is irreversible before HTTP redemption; late or failed redemption needs recovery policy; challenge state and replay storage remain necessary |
| Track A, facilitator broadcasts | Server can validate an exact signed transfer before broadcasting | Frontier race remains; client wallet must support block construction/signing and retry after stale frontier |
| Shared payout address | Simple treasury operations and no per-challenge address derivation | On-ledger amount and destination may not identify which equal-price challenge was intended; server-side state or a binding mechanism is necessary |
| Per-challenge address | Ledger destination identifies the challenge | Address derivation, receive handling, monitoring, privacy, and recovery add operational state |

## Participant responsibilities

| Participant | Must do | Trust boundary |
|---|---|---|
| Client | Validate the challenge; authorize the exact payment; preserve proof for retry | Must trust challenge transport and verify destination, amount, and expiry before paying |
| Nano ledger/RPC | Establish whether a block is confirmed and its sender, destination, and amount | A facilitator relies on its RPC node(s); confirmation policy and failover must be explicit |
| Facilitator | Validate proof and atomically claim redemption; return a retry-safe result | Must use durable shared state when deployed across workers/restarts |
| Resource server | Issue challenge, bind it to resource, and grant access only after successful redemption | Must not equate confirmation alone with fulfillment of a particular HTTP request |

## Open decisions

- Whether challenge binding uses unique addresses, unique amounts, or a durable issuance registry plus another ledger-visible distinction.
- The precise grace/late-payment policy and whether expired but confirmed payments can be refunded or manually recovered.
- The storage contract for atomic idempotency, including multi-worker deployments and crash points around any receive operation.
- Exact canonicalization of resource identity and whether URL alone is sufficient when query, method, body, or origin semantics matter.
- Which x402 extension carries mechanism metadata without relying on undocumented `extra` behavior.

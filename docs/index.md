---
title: Intro
---

# x402.Nano

**Status: Draft specification.** x402.Nano proposes two Nano-specific payment mechanisms for the x402 v2 `exact` payment scheme. `exact` is the x402 payment scheme; `nanoTxn` and `nanoSignature` are proposed mechanisms under that scheme, not alternative schemes.

The `network: "nano:mainnet"` identifier follows [OpenRai Initiative Standard 006, Nano CAIP Identifiers](https://github.com/OpenRai/Standards/blob/main/rfcs/ORIS-006.md), which specifies the CAIP-2 chain ID for Nano mainnet and defines no testnet, beta, devnet, or local chain ID. ORIS-006 is itself an Implementation Draft. Assets are XNO, in raw units.

## Current review proposal

Read [Nano exact payments: concurrency and redemption](./review.md) for the
publishable discussion draft, general consumption rule, runnable model, and
optional NanoNyms/receive-acknowledgement profiles. It invites implementation
review; it does not claim a conforming mechanism or recommend migration.

## One wallet, concurrent purchases

The baseline is ten subagents making concurrent paid HTTP requests through one
logical wallet. Applications should not coordinate Nano frontiers or allocate
outbox accounts. Both tracks need a shared wallet writer; they differ in who
broadcasts and how long that writer spans remote submission. Read
[One wallet, ten concurrent purchases](./execution-model.md) for the trace,
comparison, source observations, and executable model.

## Resource-server boundary

The baseline must work with public receiving configuration and facilitator HTTP
calls. It must not require Nano RPC access, wallet private keys, invoice-account
allocation, or buyer sessions on the resource server. Ordinary Nano seed/index
derivation supplies no xpub interface.

The server-allocated invoice contract selected in the preceding local draft is
withdrawn as a generic baseline. The retained model still demonstrates account-chain
sequencing and one specialized attribution contract. NanoNyms client-derived
receiving accounts are a separate alternative under evaluation, not an implemented
replacement. See [the boundary correction](./execution-model.md#resource-server-boundary-correction).

## Implementation status

Neither the current packages nor the paused demo conforms to the revised
2026-10-16 drafts. The new deterministic model demonstrates execution and
redemption state transitions; it does not exercise Nano/NOMS cryptography, RPC,
OWS, production persistence, or mainnet. Read the
[implementation conformance status](./audits/protocol-consistency-audit.md).

The retained draft candidate specifies stateful issuance and unique invoice
destinations, but those are no longer the baseline. Request binding, durable
transactional redemption, and safe result retrieval remain required problems to solve.
SDK dispatch, payer negotiation, wallet persistence, cryptographic vectors, and
real adapter validation remain open. Neither track is production-ready or a
recommended deployment path.

## Proposed mechanisms

- **Track A — `nanoTxn/1`**: client-signed state send block, verified and broadcast
  by a facilitator. Verification is conditional; it cannot reserve a Nano frontier
  across independent facilitators.
- **Track B — `nanoSignature/2`**: wallet-coordinated send, followed by a NOMS proof
  binding its hash to the complete issued invoice digest. Account coordination
  ends after send confirmation; seller redemption and fulfillment remain concurrent.

Both use `scheme: "exact"`. Profile discriminators and revised invoice fields are
local draft proposals with no upstream registration or payload compatibility claim.
The previously selected seller invoice-destination profile is suspended. Optional
payer outbox lanes remain a separate wallet scaling pattern.

## Reading the draft

- [Review proposal](./review.md): concurrency and redemption contract for discussion.
- [Execution model](./execution-model.md): workload, failure trace, and comparison.
- [Specification](./protocol.md): shared requirements and security review.
- [Track A: nanoTxn](./extensions/track-a-nanotxn.md): facilitator broadcast.
- [Track B: nanoSignature](./extensions/track-b-nanosignature.md): payer broadcast and redemption.
- [Ecosystem](./ecosystem.md): dated external implementation observations.

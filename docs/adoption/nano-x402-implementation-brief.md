---
title: Nano and x402 implementation brief
---

# Nano and x402 implementation brief

This brief gives Nano × x402 implementers a way to evaluate payment designs by their actual contracts. It is not a compatibility claim or a claim that any one profile has completed independent review.

## Start with the x402 layer

Keep x402's `exact` scheme distinct from the Nano-specific mechanism. For v2 integrations, inspect the current x402 v2 requirements/payload shape and CAIP-2 network identifier; this repository uses `nano:mainnet`. Then decide who constructs, broadcasts, verifies, and settles the Nano send.

## Design comparison

| Design | What the payer submits | Main benefit | Main engineering cost |
|---|---|---|---|
| Signed-block facilitator broadcast (x402.Nano Track A) | A signed state block | Facilitator can validate the transfer before publishing | Stale-frontier failure when the payer account advances; signed-block and work support |
| Post-payment signed receipt (x402.Nano Track B) | Confirmed block reference plus sender signature bound to challenge | Facilitator need not broadcast the payer's send | The send is irreversible before redemption; durable challenge binding and idempotent recovery are required |
| Direct exact transfer (e.g. `x402nano/exact`) | Client-signed Nano send block, handled under its exact-scheme contract | Existing client/resource-server/facilitator stack and examples | Adopter must evaluate its own challenge binding, replay, expiry, and deployment assumptions against its needs |
| Custodial/pool facilitator (e.g. NanoRoute) | Payment routed through facilitator infrastructure | Integrated routing and settlement operations | Custody, ledger reconciliation, and operator trust become central |

The comparison describes broad design categories. It does not assert security equivalence or interoperability. Review the cited source and revision before relying on a specific behavior.

## Evaluation path

An independent implementation can compare candidates using the same cases:

1. Two equal-price challenges to the same destination; attempt to redeem one payment for the other.
2. Confirmation immediately before, at, and after `validBefore`.
3. Two concurrent submissions of one block hash, including across separate workers.
4. Process restart after the redemption is claimed but before the HTTP response is delivered.
5. Payer frontier advances between signing and broadcast.
6. Retry after timeout with the original proof; check that it returns the original outcome without granting a second resource.

Record the requirements, payload, RPC observations, state-store operations, and final response for each run. A passing in-process unit test does not establish multi-worker atomicity or mainnet behavior.

## Current x402.Nano state

The intended documents are [Protocol Specification](../protocol.md), [Track A](../extensions/track-a-nanotxn.md), and [Track B](../extensions/track-b-nanosignature.md). The package handlers and demo are not yet one conforming implementation; see the [audit](../audits/protocol-consistency-audit.md) and [decision record](../architecture/mechanism-decision.md). The canonical repository is [CasualSecurityInc/x402.Nano](https://github.com/CasualSecurityInc/x402.Nano); the evolving docs are published at [csi.ninzin.net/x402.Nano](https://csi.ninzin.net/x402.Nano/).

## External references checked

- [`x402nano/exact`](https://github.com/x402nano/exact) README identifies it as an implementation of the `exact` scheme, describes client/resource-server/facilitator roles, and warns that the software has limited production deployment. Repository page inspected 2026-10-12.
- [`x402nano/schemes`](https://github.com/x402nano/schemes) repository page describes schemes for `nano:*`. Repository page inspected 2026-10-12.
- [x402 documentation](https://docs.x402.org/) and [OpenRai Standards](https://github.com/OpenRai/Standards) should be checked at implementation time for current v2 and Nano signing/network requirements.

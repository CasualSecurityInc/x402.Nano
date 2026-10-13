---
title: Ecosystem
---

# Nano x402 ecosystem

**Last reviewed:** 2026-10-13

This page is a limited source comparison. It does not rank implementations, establish their security properties, or make a production-readiness claim.

## Scope

- [`@x402nano/exact`](https://github.com/x402nano/exact), reviewed at commit `13462c344c7f3c3971a483d6cf5efa780b0ca05f` (2026-09-13).
- This repository's draft specification and its [implementation conformance status](./audits/protocol-consistency-audit.md).

Both describe Nano payments under x402 v2's `scheme: "exact"`. This is useful interoperability context; it does not prove that their payloads, lifecycle behavior, or deployments are interchangeable.

Two related projects named in earlier revisions of this page are outside the scope of this snapshot and were not reviewed here: [NanoRoute](https://github.com/robgilmore26/nanoroute) and `isac-0000/x402Nano-API`. No link is given for the second, because that repository path did not resolve when checked on 2026-10-13. Nothing here characterizes either project.

## Observed design choices

| Area | `@x402nano/exact` | x402.Nano draft |
| --- | --- | --- |
| Payment model | Client creates a signed Nano state send block. | Track A also uses a signed block; Track B proposes an on-chain payment followed by a NOMS proof. |
| Facilitator role | Verifies a supplied block against the current account state and submits it through Nano RPC. | Track A describes verify-and-broadcast; Track B describes verify-only proof checking. |
| Challenge data | Standard x402 payment requirements, including `maxTimeoutSeconds`. | Adds proposed track-specific fields under `extra`, including expiry and, for Track B, a nonce. |
| Current status | An independently maintained implementation. | Draft specification; this repository has no end-to-end conforming implementation. |

The `@x402nano/exact` facilitator source checks the supplied block's destination, frontier, balance decrement, proof of work, and signature before calling its block-processing helper. That is the facilitator implementation inside the `exact` package (`src/typescript/facilitator/scheme.ts`), which is a different artifact from the separately published `@x402nano/facilitator` package; the latter was not reviewed for this page. The reviewed source does not by itself define the resource server's issuance, replay, or recovery policy. Those are deployment and integration questions, not conclusions about the package's security.

## Open interoperability work

Implementers need compatible answers for at least these lifecycle questions:

1. How a resource server preserves the payment requirements it issued and matches a retry to them.
2. What happens when a Nano node accepted a block but the facilitator or client lost the response.
3. How duplicate or concurrent settlement attempts are made idempotent across restarts and workers.
4. How challenge expiry is enforced without accepting a payment for a different request.

The x402.Nano draft proposes answers for some of these questions, while the [implementation conformance status](./audits/protocol-consistency-audit.md) records where the checked code does not yet demonstrate them. Cross-implementation tests covering these cases may help interoperability without introducing another wire dialect.

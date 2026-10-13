---
title: Implementation conformance status
---

# Implementation conformance status

**Status:** Historical audit snapshot, 2026-10-12
**Checkout:** `main`, `ade8af2` (`site: comment out demo links, update x402 link to x402.org`)

> **Scope recheck — 2026-10-13:** A path-level comparison of `ade8af2..01d091c` found no intervening changes under `packages/`, `examples/`, `site/protected-resource-demo-server/`, or `test/` since the audited checkout. The code-specific findings therefore remain applicable to those unchanged paths. This comparison was not a new end-to-end conformance review.

## Finding

There is no single implementation in this checkout that conforms end to end to the current dual-track specification. The latest canonical documents describe Track A (`nanoTxn`) and Track B (`nanoSignature`), but the main `@nanosession/client` and `@nanosession/facilitator` packages implement the older `nanoSession` tagged-amount flow plus a different URL-signature flow. The newer site demo has its own Track A/B handlers. Types still expose nanoMacaroon structures as well. Treat the documents as the intended design direction, not a production-ready protocol/implementation pair.

## Evidence and lineage

The document history for `docs/protocol.md` begins with Rev 8 material, with the June 2026 commits `079b18c` and `a7211a4` rewriting the public documents into the current two-track `nanoTxn` / `nanoSignature` framing. Earlier history includes Rev 7 (`59bdc7e`) and a May 2026 pivot commit `9f3fd15` explicitly describing nanoMacaroon as primary. Commit `073aed7` subsequently introduced demo changes labeled Rev 8 Track A/B. This establishes sequence and supersession in the public docs; the history does not, by itself, establish that each past revision was accepted or formally cancelled. No explicit cancellation record was found in the current docs or commit subjects inspected.

Current authority within this repository is `docs/protocol.md`, `docs/track-a-nanotxn.md`, and `docs/track-b-nanosignature.md`, subject to this audit's conformance finding. `docs/AGENTS.md` points to ORIS-001 and ORIS-006 as external normative references; local text should bind those standards rather than redefine them.

## Specification and code comparison

| Area | Current documents | Package implementation | Demo implementation |
|---|---|---|---|
| Track A | Full client-signed state block, facilitator verifies and broadcasts | Main client broadcasts its own block before submitting proof; facilitator verifies a block hash against stored `nanoSession` requirements | `/routes/demo-tracks.ts` has a separate signed-block path |
| Track B | Confirmed send plus NOMS signature over `blockHash:nonce:validBefore` | Client signs `blockHash + url`; facilitator verifies that legacy message and may receive funds during settlement | Demo constructs the colon-delimited message and verifies it when signature/account are present |
| Challenge binding | Exact challenge fields and expiry | `nanoSession` relies on an in-memory/session registry; signature path uses URL metadata and no challenge nonce/validBefore fields in the exported type | Demo keeps process-local challenge/session maps and sends nonce/validBefore for Track B |
| Expiry | Both track documents require `validBefore` enforcement | `nanoSession` checks an optional ISO expiry when retrieving stored requirements; `nanoSignature`'s typed metadata has no expiry | Demo checks stored `validBefore` in request/session handling |
| Replay | Track documents require block-hash replay rejection | `handleSettle` calls `SpentSetStorage.addIfNotExists`; default storage is process-local with a 30-day TTL | Demo uses process-local `Set`; check-then-add is not atomic across concurrent requests |

Useful source locations: `packages/client/src/handler.ts` (`executePayment`), `packages/facilitator/src/handler.ts` (`getRequirements`, `getSignatureRequirements`, `handleVerify`, `handleSettle`, `verifyNanoSignature`), `packages/facilitator/src/spent-set.ts`, `packages/core/src/types.ts`, and `site/protected-resource-demo-server/routes/demo-tracks.ts`.

## Security and recovery gaps

- Expiry of the documented challenges cannot currently be claimed for the package Track B. Its `NanoSignatureExtra` has `url` and optional `messageToSign`, not nonce or expiry.
- The default spent set and default session registry do not survive restart or coordinate multiple workers. The interface requires `addIfNotExists`, but distributed atomicity is the storage adapter's responsibility and is not demonstrated here.
- Verification and settlement are separate calls. A payment may be verified twice; only settlement's atomic spent-set insertion is intended to serialize redemption. A process crash after marking spent but before a receive operation can strand an otherwise valid payment. Retrying then fails as already spent.
- The demo's `Set.has` followed later by `Set.add` is a race under concurrent redemptions. Its test coverage for sequential duplicate replay does not establish concurrent safety.
- The main client sends first and waits for confirmation before returning proof. A timeout after broadcast can leave a paid block without a completed HTTP redemption. Retrying must reuse the same proof and the server must make the settlement response idempotent; current code does not establish that end-to-end behavior.
- Track A's signed-block construction necessarily races any independent send from the payer account between frontier read and facilitator processing.
- Track B's generic public spec currently has a critical requirement ambiguity: a single shared payout address plus equal price, even with a signed block hash and challenge nonce, does not prove that the transfer was intended for this HTTP challenge unless challenge binding is encoded in the payment destination/amount or enforced by server-side issuance state. The signature proves control of the sender key, not purchase intent.

## Checks reviewed

Existing tests include package-level duplicate settlement and session-spoofing cases (`packages/facilitator/src/__tests__/handler.test.ts`), client signature behavior (`packages/client/src/__tests__/handler.test.ts`), and demo duplicate replay (`site/protected-resource-demo-server/__tests__/routes.test.ts`). They do not establish the full documented expiry, concurrent redemption, restart, frontier-race recovery, wrong-challenge, or lost-response properties. Real-mainnet integration tests target the legacy package flow, so passing them would not prove Rev 8 conformance.

## Required next step

Before describing either track as a conforming reference implementation, select a challenge-binding and idempotent settlement contract, then port one track end to end across public types, client, facilitator, examples, tests, and docs. This audit does not select a production candidate.

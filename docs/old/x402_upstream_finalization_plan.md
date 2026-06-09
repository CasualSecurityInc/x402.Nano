---
title: x402 Upstream Finalization Plan
---

# x402.NanoSession Upstream Finalization Plan

**Status:** Implementation handoff  
**Date:** June 3, 2026  
**Target upstream:** `x402-foundation/x402`  
**Nano CAIP authority:** `OpenRai/Standards` ORIS-006  
**NanoNym authority:** `OpenRai/Standards`

## Executive Summary

x402.NanoSession should be proposed upstream as a Nano-specific implementation of the existing x402 `exact` scheme, not as a new scheme. The proposal should deliberately include two Nano paths:

1. **Path A: signed-block exact** — the simple compatibility path where the client ships a signed Nano send block or equivalent block material, and the facilitator broadcasts it after verification.
2. **Path B: NanoNym receipt exact** — the advanced path where the client broadcasts first, then submits a confirmed send hash plus NanoNym witness material as settlement evidence.

The two-path shape is intentional. Path A is easier for upstream reviewers to compare with EVM, SVM, Stellar, TON, and NEAR mechanisms because it looks like "client signs, facilitator verifies and settles." Path B is the path that actually leans into Nano's strengths: feeless settlement, fast confirmation, public block-hash receipts, and session/challenge binding that resists receipt theft.

## Rationale

Nano does not map cleanly to EIP-3009-style authorizations. Nano blocks chain directly to an account frontier, and any unrelated wallet activity changes that frontier. A pre-signed but unbroadcast Nano send can become permanently invalid if the payer receives funds, changes representative, or pays something else first.

That is the **frontier dilemma**. It does not make a signed-block exact path useless, but it does make it knowingly narrower than EVM-style exact authorizations.

The receipt-based path solves a different problem. It treats the Nano ledger as the settlement source of truth: the client pays first, then redeems a confirmed send hash that is bound to the issued challenge by exact raw amount and NanoNym-derived destination verification.

## Advantages And Known Compromises

### Path A: Signed-Block Exact

Advantages:

- Familiar to upstream x402 reviewers.
- Similar review shape to TON, Stellar, SVM, and NEAR sponsored-settlement mechanisms.
- Lets a facilitator perform full verification before broadcasting.
- Useful for controlled wallets, agent wallets, or single-purpose payment accounts where frontier changes are managed.

Known compromises:

- Frontier-dependent: any prior account activity invalidates the signed block.
- Poor fit for general consumer wallets that may receive or send concurrently.
- Requires strict duplicate-settlement mitigation even though the chain itself rejects invalid frontier replays.
- Should be presented as a compatibility and implementation bridge, not the recommended public-resource security story.

### Path B: NanoNym Receipt Exact

Advantages:

- Uses Nano's natural confirmed-send receipt model.
- Avoids the signed-block frontier dilemma because the payment is already confirmed before redemption.
- Supports delegated or human-in-the-loop funding.
- Combines exact raw tagging with NanoNym-derived one-time destinations to resist cross-challenge receipt borrowing.
- Provides a stronger story for public resources where many clients can request economically equivalent challenges.

Known compromises:

- Less familiar to EVM-oriented x402 reviewers.
- Requires NanoNym witness semantics to be specified clearly enough for independent facilitators.
- Assumes the x402 HTTP dialogue is private, for example over HTTPS.
- Needs spent-set/replay tracking at the facilitator or resource-server layer.

## Upstream PR Strategy

### PR 1: Spec-Only Nano Exact

Open a small spec-only PR in `x402-foundation/x402`:

- Add `specs/schemes/exact/scheme_exact_nano.md`.
- Update `specs/schemes/exact/scheme_exact.md` to list Nano validation requirements.
- Do not add TypeScript, Python, or Go implementation code in this first PR.
- Use x402 v2 only.
- Use `scheme: "exact"`.
- Use `network: "nano:mainnet"` only. ORIS-006 does not define `nano:testnet`, `nano:beta`, `nano:devnet`, or `nano:local` for public interoperability.
- Use ORIS-006 for CAIP-2 and CAIP-10 rules.
- Use `asset: "xno"` unless upstream maintainers request uppercase asset notation. ORIS-005 uses lowercase `"xno"` in its x402 NanoNym profile.
- Use raw-unit decimal strings for `amount`.

The spec should define both Nano paths in one document:

- `nano-signed-block-exact`
- `nano-nym-receipt-exact`

The document should explicitly say that `nano-nym-receipt-exact` is the recommended path for public-resource receipt-theft resistance, while `nano-signed-block-exact` is retained for compatibility, controlled wallets, and reviewer familiarity.

The NanoNym receipt path should align with ORIS-005, "Utilizing NanoNyms for x402 Exact Pre-payment Verification", rather than inventing a second incompatible NanoNym payload shape.

OpenRai/Standards is the authoritative source for the NanoNym specification that underpins the advanced receipt-passing path in Rev 8. The x402 upstream PR should reference the relevant ORIS documents and should not redefine NanoNym encoding, derivation, or witness semantics except where x402-specific binding rules are required.

### PR 2: Conformance Fixtures

After maintainers agree on the shape, add fixtures:

- valid signed-block exact payload
- signed-block invalidated by frontier mismatch
- valid NanoNym receipt payload
- receipt reuse rejected
- receipt from different challenge rejected
- wrong raw amount rejected
- wrong derived destination rejected

Fixtures should follow upstream's emerging `fixtures/<suite>/<version>/` style.

### PR 3: TypeScript Mechanism Package

Add `typescript/packages/mechanisms/nano` only after the spec shape is accepted:

- client, server, and facilitator modules
- unit tests for both paths
- integration tests guarded by Nano RPC environment variables
- changeset for publishable package
- examples only if maintainers request them

### PR 4+: Runtime Integrations

Optional later work:

- x402 examples using Nano
- docs site pages in upstream x402 docs
- Python or Go support if maintainers ask for multi-language parity

## Managing The New x402 Repository

The submodule at `docs/references/x402-foundation` is a **read-only reference checkout** for this repository. Do not use it as the working tree for upstream PR development.

Recommended long-term workflow:

1. Keep `docs/references/x402-foundation` pinned to a known upstream commit for local comparison and citation.
2. Periodically update it with `git submodule update --remote docs/references/x402-foundation` when reviewing upstream changes.
3. Use a separate fork or worktree for actual upstream PR branches.
4. Maintain one branch per upstream PR, for example:
   - `nano/spec-exact`
   - `nano/fixtures`
   - `nano/typescript-mechanism`
5. Lift changes from this repo into upstream manually or with `git apply`, not by copying generated site files.
6. Keep upstream PRs small and independently reviewable.
7. Rebase each upstream branch on `x402-foundation/x402:main` before review.
8. After an upstream PR merges, update this repo's submodule pointer and reconcile any local docs or package naming drift.

Avoid:

- editing the submodule directly and expecting those changes to persist
- opening one large PR that includes spec, implementation, docs, examples, and fixtures
- using the old Coinbase repo as the primary authority for new x402 work
- presenting NanoSession as a separate x402 scheme
- inventing Nano CAIP identifiers that ORIS-006 does not define
- forking or re-specifying NanoNyms outside OpenRai/Standards

## Local Cleanup Before Upstreaming

Before drafting PR 1, resolve these local issues:

- Align Rev 8 docs, package comments, and type names around NanoNyms instead of old `nanoMacaroon` wording.
- Decide final path identifiers and use them consistently.
- Align network identifiers with ORIS-006: public x402/Nano interoperability uses `nano:mainnet` only.
- Treat OpenRai/Standards as normative for NanoNym encoding, derivation, event, and x402 receipt-profile details.
- Make the active docs site revision explicit. The site generator requires `SPEC_REV`; the current generated site still reflects Rev 7 unless regenerated.
- Update tests so the two-path distinction is visible in test names.
- Keep the security checklist centered on receipt theft, replay, session spoofing, double settlement, and frontier invalidation.

## Proposed Spec Skeleton

`scheme_exact_nano.md` should use this structure:

1. Summary
2. Versions supported
3. Supported networks
4. Why Nano needs two exact paths
5. Shared `PaymentRequirements`
6. Path A: `nano-signed-block-exact`
7. Path B: `nano-nym-receipt-exact`
8. Facilitator verification rules
9. Settlement logic
10. Duplicate settlement mitigation
11. Security considerations
12. Examples

## Open Decisions

- Final upstream network identifier: `nano:mainnet`, per ORIS-006. Any future non-mainnet identifier should be standardized in OpenRai/Standards before use in production x402 docs.
- Final mechanism selector location: likely `accepted.extra.nano.mechanism`, but upstream may prefer a different convention.
- Whether Path A should be marked "MAY implement" while Path B is "SHOULD implement" for production public-resource deployments.
- How much NanoNym detail to summarize in the x402 spec while preserving OpenRai/Standards as the authoritative NanoNym source.

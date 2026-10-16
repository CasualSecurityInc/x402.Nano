# REVIVAL_PLAN

**Status:** Live working note — rewritten 2026-10-15
**Original authored:** 2026-06-10, as a work order
**Scope:** x402.Nano specification direction, conformance status, and ecosystem posture

**Internal. Not published. Not committed. Contains third-party project strategy —
keep untracked.**

> This file began as an imperative work order ("Your job is to…"). That framing
> is gone because the strategy it prescribed changed mid-flight. What follows is
> a record of where things actually stand, what changed and why, and what is
> still open. Sections marked **STALE** contradict current reality and are kept
> only so the reversal is traceable.

---

## 1. Where things stand

| | |
|---|---|
| Canonical repo | `CasualSecurityInc/x402.Nano` |
| Published site | https://csi.ninzin.net/x402.Nano/ |
| Current branch tip | `main` @ `3d86055` |
| Specification status | **Draft.** No conforming reference implementation exists. |
| Mechanism candidates | Track A `nanoTxn`, Track B `nanoSignature` |
| Blocking issue | Track B proof-of-purchase binding is unresolved |

The published site was corrected and deployed on 2026-10-14. The public
introduction now leads with draft status, states that neither track is
implemented end to end, cites ORIS-006 for `nano:mainnet`, and carries no
production-readiness or comparative-security claims.

**No npm release has shipped from `main` since the spec was declared a draft.**
`release.yml` is `workflow_dispatch`-only by deliberate decision.

---

## 2. The strategy reversal

This is the most important thing in this file.

### 2.1 What the original plan said

**STALE — do not act on this.**

The June work order set the goal as making our mechanism the option an
independent implementer would *prefer*, and named two deliverables:
`docs/adoption/pursekeeper-architecture-brief.md` (a comparison arguing our
design's advantages) and `docs/adoption/pursekeeper-outreach-draft.md` (an
outreach message). The framing was competitive: demonstrate our mechanism is
better, invite adoption.

### 2.2 What actually happened

The strategy was reversed after inspecting the actual target implementation.

An inspection of `x402nano/exact` and Pursekeeper's own facilitator showed:

- Their `verify()` already checks destination, frontier, exact balance
  decrement, proof of work, and signature.
- Their facilitator **already** implements per-hash locking, a durable
  file-backed broadcast record, and regression tests for the lost-`process`-reply
  case — the exact gap we had assumed was open.
- Their stated goal is explicitly to adopt the existing x402 v2 ecosystem rather
  than add a fourth Nano dialect.

So the honest technical finding was the opposite of the assumed one: **the
ecosystem is further along than our documents claimed, and our differentiator
was not the recovery gap we had identified.**

The proposal that came out of that is compatibility-first: contribute a shared,
implementation-agnostic recovery contract and test vector for the Nano `exact`
mechanism **already in use**, rather than asking anyone to adopt ours.

Artifact: `/private/tmp/pursekeeper-x402-v2-recovery-proposal.md` — outside the
repo, untracked, never published, never sent. It has **not** been delivered to
anyone. That remains a human decision.

### 2.3 What this changed about our own posture

| Then | Now |
|---|---|
| Compete on mechanism superiority | Contribute to interoperability; credit others' work |
| "Production-oriented" vs "reference-style" framing | Dropped entirely — unverifiable and self-serving |
| Ecosystem page ranking implementations | Dated, commit-pinned, no rankings, no security claims |
| Track B described as "recommended" | Explicitly not recommended; unready |

---

## 3. Deliverables: requested vs actual

| Original ask | Actual | State |
|---|---|---|
| `docs/audits/protocol-consistency-audit.md` | same path | **Done.** Published under "Implementation conformance status" |
| `docs/architecture/mechanism-decision.md` | same path | Exists but **contradicts published docs** — see 5.1. Unpublished |
| `docs/adoption/pursekeeper-architecture-brief.md` | `docs/adoption/nano-x402-implementation-brief.md` | Renamed. Unpublished |
| `docs/adoption/pursekeeper-outreach-draft.md` | *(none)* | Never created in this form; superseded by the recovery proposal |
| Adversarial test matrix (§5 of the work order) | — | **NOT DONE** — see 4 |
| Implementation report | `docs/implementation-report.md` | Unpublished |
| Reconcile spec with implementation | — | **NOT DONE** — explicitly deferred, see 4 |

Four documents are deliberately **unpublished from the site** while remaining in
the repository as engineering record: the mechanism decision, the implementation
brief, the implementation report, and this file.

---

## 4. The two biggest open gaps

### 4.1 No adversarial test coverage

The work order specified a ten-scenario matrix. Almost none of it exists.
Verified against `packages/*/src/__tests__/` and `test/`:

| Scenario | Status |
|---|---|
| Normal successful purchase | Partial — unit level only |
| Stale frontier from concurrent account activity | **Missing** |
| Payment arriving after challenge expiry | **Missing** |
| Correct payment against the wrong challenge | **Missing** |
| Two concurrent equal-price challenges, shared destination | **Missing** |
| Duplicate / concurrent settlement | Partial — sequential only |
| Failed response then legitimate retry | **Missing** |
| Facilitator restart with duplicate evidence | **Missing** |
| Concurrent workers consuming one payment | **Missing** |
| Malformed proof / invalid work / insufficient balance | Partial |

Nothing establishes multi-worker atomicity. Mainnet integration tests exercise the
legacy `nanoSession` flow, so passing them would prove nothing about either track.
They also require `NANO_TEST_SEED` and spend real XNO, so they are not in the
default run.

This is the gap most likely to produce a false confidence claim.

### 4.2 The mechanism decision contradicts the published spec

`docs/architecture/mechanism-decision.md:12` says:

> "prioritize Track B (`nanoSignature`) for the next conforming implementation"

The published audit says:

> "This audit does not select a production candidate."

And the live introduction says Track B "must not be treated as production-ready
or as a recommended deployment path."

**These cannot all be true.** The decision record was unpublished from the site
but never reconciled. Someone must decide which position is current and make the
other match. Right now the repository contains a document that tells an agent to
do the opposite of what the public site says.

---

## 5. Findings that are not recorded anywhere else

### 5.1 `isac-0000/x402Nano-API` does not exist

The previous ecosystem page linked it. The **GitHub account itself returns 404**,
not just the repository. This is not a stale link; the account is gone. Any
comparison built on it was unsound.

### 5.2 ORIS-006 is itself an Implementation Draft

`docs/index.md` states this. Nothing else in the repository records it, and it
matters: we cite ORIS-006 as the basis for `nano:mainnet` while the standard is
not final. Do not present it as settled, and re-check its status before citing it
in an ORIS submission.

### 5.3 The packages implement neither track

`@nanosession/client` and `@nanosession/facilitator` implement the older
`nanoSession` tagged-amount flow plus a *different* URL-signature flow.
`packages/core/src/types.ts` still exposes `nanoMacaroon` structures. The site
demo has its own separate Track A/B handlers. Three divergent implementations.

### 5.4 The demo's original UX is incompatible with both tracks

Full analysis in `DEMO_REVIVAL.md`. Summary: the original scan-a-QR-to-the-
destination loop is **post-payment**, while both tracks are **authorization-flow**
mechanisms. Track A cannot verify an already-published block; Track B cannot
verify intent from a third-party sender. The demo cannot present that loop as a
track. Links are paused pending a decision.

### 5.5 CI state

- `release.yml`: manual dispatch only, by deliberate decision.
- All actions pinned to full commit SHAs, Dependabot tracking weekly.
- All jobs on `ubuntu-24.04`, Node 24.
- Deploy permissions narrowed per job; checkout uses `persist-credentials: false`.
- Pages deploys from `main` only, so **branch pushes give no hosted preview** —
  use `pnpm --dir site site:preview` locally.

---

## 6. Terminology — still binding

These held throughout and were enforced in the published docs.

- **x402 is the protocol; x402.Nano is a specification effort** defining
  mechanisms for it. Not "the x402.Nano protocol."
- **`exact` is the x402 payment scheme.** `nanoTxn` and `nanoSignature` are
  proposed mechanisms *under* that scheme, not alternative schemes. (The original
  plan said "mechanism" singular; the docs correctly say two.)
- **Do not invent a wire-level `mechanism` field.** The mechanism is expressed
  through the `PaymentRequirements` contract.
- **Mechanism ≠ method.** Use "mechanism" throughout.
- **`network: "nano:mainnet"` per ORIS-006.** Do not emit `nano:testnet`,
  `nano:beta`, `nano:devnet`, or `nano:local`.
- **NanoNym is a distinct payment construct**, not one of our mechanisms. Its
  claims are withheld from public docs pending its own mechanism declaration.
- **Do not claim standards status that does not exist.** ORIS-006 is an
  Implementation Draft; no x402 Nano scheme has been accepted upstream.
- **Do not disparage other implementations** or invent claims about their authors.

---

## 7. What comes next

Unordered; the point is that nothing here is started.

1. **Resolve 4.2** — pick a position on Track B and make the decision record
   match the published audit, or delete the decision record.
2. **Write the missing tests** (4.1), at minimum expiry, wrong-challenge,
   stale-frontier, and concurrent settlement.
3. **Decide the demo** — see `DEMO_REVIVAL.md` §9.4 on whether the paused pages
   keep shipping.
4. **Decide the Pursekeeper proposal** — it exists, has never been sent, and is
   a human call. Note the draft asks for a shared test vector, not adoption, so
   there is no competitive exposure in delivering it.
5. **Resolve `protected-resource-demo-server/routes/protected.ts:119`**, which
   still serves a NanoNym string to visitors of the legacy route.
6. **Remove this file's dependency on being read.** If the project reaches an
   ORIS submission, the audit and test evidence should stand alone.

---

## 8. Standing constraints

- Never commit the Pursekeeper proposal, this file, or the outreach strategy.
- Never publish internal work notes to the site. Check `prepare-rev.js` and
  `config.mts` before assuming a repo document appears publicly.
- Preserve unrelated local work. Reconcile deliberately; do not `reset` or
  `stash --discard`.
- Do not declare conformance from a passing build.
- Do not run mainnet integration tests casually; they spend real XNO.
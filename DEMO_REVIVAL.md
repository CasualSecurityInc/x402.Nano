# DEMO_REVIVAL

**Status:** Proposal — no option chosen, nothing implemented
**Date:** 2026-10-14 (updated 2026-10-15)
**Scope:** Interactive payment UX for the protected-resource demo

Internal design note. Not published to the site, and not specification. For the
mechanism contracts themselves see `docs/protocol.md` and the track documents;
this file only covers how a visitor pays in the demo.

> Sections 1–8 are the original analysis and options. Section 9 records what
> changed after the site was paused. Read 9 before acting on anything here.

---

## 1. The problem

The original demo worked like this:

1. The server hands out a `nano_...` payment address.
2. The page renders a `nano:` payment-intent QR for it.
3. The visitor pays from **any external wallet** by scanning.
4. The page polls the payment address, sees the deposit cold, and immediately
   re-triggers its request with payment details and the session id.

The whole loop is one on-chain transaction, and the visitor never gives the
browser a key.

That loop no longer exists in the current demo. The QR at
`site/.vitepress/theme/components/TrackCheckout.vue:54` still encodes
`nano:${currentDeposit}?amount=…` — the **destination**, not a visitor wallet —
but the submit paths behind it no longer accept a plain externally-paid send.
The browser-payer route exists, but only as a secondary path behind a manual
"fund the payer, then click submit" step (`TrackCheckout.vue:647`).

---

## 2. Why neither track can carry the original loop

This is a lifecycle mismatch, not a missing wallet feature.

Both proposed tracks are **authorization-flow** mechanisms. x402's `exact` works
because the client pre-signs a transfer that a facilitator later broadcasts: the
payer's key participates, but the money has not moved. The original demo is
**post-payment**: the visitor's wallet moves the funds, and only then does
anything tell the server.

That inverts the verification question, and each track fails at a different step.

### Track A (`nanoTxn`) — cannot verify an already-published block

The specification requires `block.previous` to equal the account's current
frontier, precisely so the facilitator can broadcast
(`docs/track-a-nanotxn.md`, facilitator verification steps 5–9). A block
published by the visitor's own wallet has already become the frontier, so
verification yields `STALE_FRONTIER` and the facilitator's `process` call
fails on a block the node already knows.

**The demo currently masks this.** At
`site/protected-resource-demo-server/routes/demo-tracks.ts:375`, when
`broadcastOk` is false the route still returns `success: true` with the note
*"demo bypass — this RPC view differed from the receive node"*. That bypass is
hiding exactly this failure mode. It is fine as a test affordance and wrong as
a happy path.

### Track B (`nanoSignature`) — cannot verify intent from a third-party sender

Track B requires a NOMS signature over
`${blockHash}:${nonce}:${validBefore}` (`demo-tracks.ts:486`) **from the sending
account**, and then asserts the on-chain sender matches the signed account
(`demo-tracks.ts:492`).

If the visitor's phone wallet published the send, that wallet would have to
produce an arbitrary-message signature over the challenge nonce. Mainstream Nano
wallets do not expose arbitrary signing with the account key. And even if one
did, this is precisely the proof-of-purchase binding requirement that
`docs/audits/protocol-consistency-audit.md` records as unresolved for Track B.

### Conclusion

Scan-a-QR-to-the-destination is a legitimate and common Nano commerce pattern.
It is **not** Track A or Track B, and neither track can be made to accept it
without either weakening verification or inventing a third mechanism. The demo
must either rearchitect or relabel — it cannot present it as a track.

---

## 3. What already exists in the code

Most of the rearchitecture is present but not wired into the primary flow.

`TrackCheckout.vue` already implements the browser-purse model:

| Capability | Location |
|---|---|
| Ephemeral seed generated in-browser, persisted per deposit in `localStorage` | `TrackCheckout.vue:279`, `:287` |
| Block signing | `TrackCheckout.vue:369`, `:504`, `:549` |
| NOMS signing | `TrackCheckout.vue:419` |
| Client-side PoW (no RPC work generation) | `nano-rspow-web`, `TrackCheckout.vue:7` |
| Open-account handling (`frontier` absent → zero hash) | `doRealTempKeyFlow` |

What is missing is the *flow*: the QR still targets the destination, and reaching
the wallet path requires a manual fund-then-submit step instead of continuing
automatically when funding confirms.

Server-side scaffolding also already exists: `destination-pool.ts` provides
`allocatePerInvoiceDeposit` / `reserveDeposit` / `releaseDeposit` for
per-invoice destination stability, and `index.ts` mounts `/api/protected`,
`/api/poll-for-demo`, and `/api/demo`.

---

## 4. Options

### Option A — Wallet-less path as the demo's primary story

Keep the original loop exactly as it was: QR to the destination, external wallet
pays, page retriggers. Present it as a general Nano receipt-style flow with no
track claim. Track demos move to a secondary page.

- **For:** keeps the moment that convinces people it works; zero new code.
- **Against:** the mechanism demo becomes second-class, and the Track A bypass at
  `demo-tracks.ts:375` stays hidden behind an honest-looking page.

### Option B — Browser-purse as primary; drop the wallet-less path

Every visitor generates a browser wallet, funds it, and the page continues
automatically into the real x402 dance.

```
(demo visitor) → (browser purse) → (demo payment address)
```

- **For:** the track demo exercises the real mechanism end to end — real PoW,
  real signature, real frontier. No bypass needed.
- **Against:** two on-chain transactions per visitor; every visitor needs an
  account opened; abandoned purses accumulate dust.

### Option C — Three labelled routes on the same page (recommended)

Keep both, index them by *which wallet is paying*, and label each for what it
actually is:

1. **Run the full mechanism** — QR funds the browser purse; continue
   automatically on confirmation. Default for the track pages.
2. **Pay from a wallet you control** — the original loop, QR to destination.
   Presented as legacy receipt-style, with **no** Track A/B claim.
3. **MetaMask / Xnap** — real wallet, real flow.

- **For:** route 2 keeps the persuasive moment; route 1 makes the mechanism demo
  honest; route 3 is the closest analogue to a production agent.
- **Against:** three paths is more UI to keep correct and document.

---

## 5. Recommendation

**Option C.**

The demo exists to show that these mechanisms work, and the current primary path
cannot do that without a bypass. But the persuasive value of "scan, pay, content
appears" is real and worth keeping. They are compatible as long as neither is
presented as the other.

Concretely, Option C also requires removing the `demo bypass` branch from the
Track A happy path (`:375`), so a genuine broadcast failure stops rendering as
success.

---

## 6. Compromises accepted

These apply whichever option is chosen.

### 6.1 Self-funding is a demo affordance, not a mechanism property

The visitor-funds-a-purse step exists because the browser holds no key. It is
**not** how `exact` is meant to work in production:

- EVM accounts are pre-funded by convention; Nano's open-account cost makes
  self-funding per-request uneconomic.
- A production agent pays from an existing funded account and never funds a
  wallet to buy something.

If implemented, this must be documented as a demo affordance. It must not appear
in the specification or mechanism documents, or readers will infer a requirement
that does not exist.

### 6.2 The wallet-less path has no mechanism coverage

Route 2 exercises the ledger but not the specification. Anyone reading the demo
will conflate the two unless it is labelled explicitly. This is a permanent
documentation cost, not a one-off.

### 6.3 Purse lifecycle and dust

Browser-generated seeds are unopened accounts. Each needs an open block before
its first send, and every abandoned funded purse is dust the demo operator
eventually inherits.

Two approaches, with a real trade-off:

| Approach | Isolation | Sweepable |
|---|---|---|
| Random seed per browser (`localStorage`) | Honest — nobody but the browser can spend it | No. Requires a sweep-by-pattern approach that cannot know the seed |
| Seed-derived index from the demo seed | Nominal — the operator can derive and spend from any visitor purse | Yes |

The second is sweepable but means the operator controls visitor funds. At the
current 0.001 XNO demo amount that is acceptable **only if stated on the page**.
A fully honest variant is random seeds plus an explicit abandon/dust disclaimer.

### 6.4 Two transactions instead of one

Route 1 and route 3 are one transaction; route 2 is also one. Only the
fund-then-pay sequence (6.1) costs two. This is real added friction and should
be counted as demo cost, not mechanism cost.

### 6.5 The Xnap path is unproven

`useXnapSnap.ts` targets MetaMask Snaps. It has no test coverage in this
repository and no demonstrated path through either track. Treat route 3 as
best-effort until it is exercised end to end.

---

## 7. Open questions

1. Which purse scheme — random per browser, or sweepable seed-derived index?
2. Does route 1 fund the purse by QR, or by asking the visitor to paste an
   address? QR is closer to the original experience but needs a "watch my purse"
   poller bound to the deposit.
3. Should route 1 resume a purse across sessions, or mint a fresh one per visit?
   Reuse is friendlier; a fresh wallet per visit is cleaner for isolation.
4. Is route 2 retired once route 1 is solid, or kept indefinitely as the
   wallet-less case?
5. Does the Track A bypass get removed entirely, or kept behind an explicit
   test-only flag?

---

## 8. Non-goals

- Implementing either payment mechanism.
- Changing any wire format or `PaymentRequirements` shape.
- Adding a third Nano payment dialect to make the wallet-less path formally
  verifiable. If that is ever wanted it needs its own mechanism declaration,
  reviewed on its own terms — which is also where NanoNym belongs. The NanoNym
  text has since been withheld from `site/protected.md`; see 9.2.

---

## 9. Status after the site was paused

### 9.1 What shipped

| Commit | Change |
|---|---|
| `40b3bff` | Demo links replaced with a "🚧 returning shortly" marker; NanoNym withheld |
| `4e95c84` | NanoNym withheld from `site/protected.md` |
| `3d86055` | This document committed (unpublished) |

Deployed and live. No anchor anywhere in the built site points to `/protected`,
`/demo-track-a`, or `/demo-track-b`. All visitor-facing entry points now show the
marker instead.

This is a genuine pause, not a concealment: the marker states plainly that the
demos are being rebuilt.

### 9.2 NanoNym is now withheld

Both NanoNym references were removed from `site/protected.md` by commenting them
out rather than deleting. The comments record that NanoNym is a distinct payment
construct needing its own reviewed mechanism declaration. Section 8's pointer to
that file is therefore now a pointer to withheld text.

The NanoNym string still appears in demo **server** code at
`site/protected-resource-demo-server/routes/protected.ts:119` ("Unlocked via
NanoNym receipt settlement"), which is served to visitors of the legacy
`/api/protected` route. Still unresolved.

### 9.3 Stale claims in the paused demo pages

Both pages describe behaviour that no longer matches the code. They are unlinked
and paused, so this is low urgency, but both statements are wrong:

| File | Line | Problem |
|---|---|---|
| `site/demo-track-a.md` | 12 | "In the final implementation the browser will use an ephemeral payer key (LocalStorage)" — it already does, at `TrackCheckout.vue:287`. Stale future tense. |
| `site/demo-track-b.md` | 13 | "The protocol log is intended to show the complete decoded client-side flow" — aspirational; the flow is implemented. |

Both also still render the live `<TrackCheckout />` component, so they are live
pages with stale copy, not archived pages.

### 9.4 Open decision: orphan pages still ship

`protected.md`, `demo-track-a.md`, and `demo-track-b.md` remain in
`prepare-rev.js`, so they are still built into `gen/dist` and reachable by direct
URL. Nothing links to them and navigation has them commented out
(`config.mts:25,33,54,55`).

Two defensible states, not yet chosen:

1. **Keep building them.** Preserves direct-URL access for anyone who bookmarked
   the demo, at the cost of shipping pages whose copy is stale (9.3).
2. **Drop them from the copy map.** Cleanest — the pause becomes real rather than
   navigational — but the demo server and `TrackCheckout.vue` become entirely
   unreferenced by the site, and a reviewer loses any way to see the current demo
   state without reading the source.

Recommendation: option 1 until the rework lands, because the pages are the only
remaining visual record of the demo, then drop them together with the rework.

### 9.5 Unchanged by the pause

Everything in sections 2–3 still holds. The lifecycle mismatch in section 2 is a
property of the mechanisms, not of the demo UI, so it will not be resolved by
rebuilding the page. The Track A `demo bypass` at `demo-tracks.ts:375` is still
in the code and still reports success on a failed broadcast.

---
title: "Track A: nanoTxn"
---

# Track A: nanoTxn

**Status:** Draft `nanoTxn/1`, revised 2026-10-16. No conforming implementation.
This revision supersedes the earlier unversioned draft. It changes issuance and
redemption requirements and is not wire-compatible with that draft.

The payer constructs a signed Nano state send block. A facilitator checks and
broadcasts it. This profile retains the account-frontier constraint. Its intended
use is a wallet adapter that coordinates outstanding facilitator submissions
without making applications manage Nano account chains.

The [shared specification](../protocol.md) defines invoice issuance, exact raw
amounts, request binding, unique invoice destinations, expiry, and storage rules.
Those requirements are normative for this draft. Read the
[execution-model analysis](../execution-model.md) before implementing.


> **Boundary correction, 2026-10-16:** The server-allocated invoice binding and
> mandatory payer/session requirements below are withdrawn as a generic x402
> baseline. This version is a retained specialized candidate, not an active
> integration recommendation. The resource server must be able to use only public
> receiving configuration and facilitator HTTP calls, without wallet secrets or
> Nano RPC. Attribution/profile selection is being reevaluated; the signed-block
> versus payer-broadcast execution distinction remains valid. See the
> [shared correction](../protocol.md#resource-server-boundary-correction).

## Payment requirements and proof

`scheme`, `network`, and `asset` are `exact`, `nano:mainnet`, and `XNO`.
`amount` is exact; `payTo` is the never-reused invoice destination.
`maxTimeoutSeconds` bounds a processing wait; it is not ledger-enforced expiry.
`extra.nanoProfile` MUST be `nanoTxn/1`; all other `extra` fields come from the
shared invoice contract. Clients reject unknown profiles.

The selected requirements are copied verbatim into `PaymentPayload.accepted`.
The payload is this proposed shape (placeholders are illustrative):

```json
{
  "block": {
    "type": "state",
    "account": "<payer address>",
    "previous": "<64 hex predecessor>",
    "representative": "<representative address>",
    "balance": "<resulting raw balance>",
    "link": "<destination public key hex>",
    "signature": "<128 hex Nano block signature>",
    "work": "<16 hex work>"
  }
}
```

Use the Nano block format and Nano account signature algorithm; never generic
Ed25519 defaults. Decode addresses to public keys for comparison; a supplied
`link_as_account` display field is not authoritative. The signature covers the
block fields defined by Nano, not HTTP metadata, invoice digest, or expiry.
The exclusive destination supplies the ledger-visible invoice binding. A public
block signature proves the sender authorized the transfer, not that its current
presenter controls that account. Issuance and result retrieval MUST be bound to
the original authenticated buyer session or an equivalent private capability.

## Client and wallet flow

1. Request and persist an authenticated invoice bound to this HTTP request and payer.
2. Enter the wallet's shared account writer and persist this operation's intent.
3. Fetch confirmed frontier, balance, and representative. Require sufficient funds.
4. Construct a send with exactly the invoice balance decrement and destination.
5. Compute its Nano hash, sign, provide valid work, and persist the complete block.
6. Retry the HTTP request with the x402 v2 payload containing this block.
7. Keep account coordination until the remote broadcast outcome is resolved.
8. Resolve uncertain outcomes by hash before authorizing a replacement send.

The wallet can release coordination after confirmed settlement while the resource
request continues. If a seller performs expensive work between verification and
settlement, that interval extends how long this account is occupied. A wallet
must impose bounded waits and backpressure. One-agent or single-purpose labels
do not supply coordination when ten subagents use that same wallet.

## Facilitator verification

`/verify` MUST:

1. Validate x402 version, supported profile, block format, and trusted invoice issuance.
2. Compare requirements and actual request binding with the issued invoice.
3. Check payer and destination by decoded public key and validate the block signature.
4. If this invoice is already settled, authenticate the same proof and return its recorded status.
5. Reject a different payment hash associated with an already-settled invoice.
6. For a new payment, check invoice expiry and load the payer's confirmed account state.
7. Require `previous` equal to that frontier and the balance decrement equal to `amount`.
8. Validate proof of work against the block root and current network send threshold.

This result establishes conditional executability only. Verification MUST NOT
consume the invoice, claim that payment is confirmed, or authorize irreversible
resource fulfillment. A local `(account, previous)` reservation MAY reduce races
inside that facilitator; it cannot coordinate independent facilitators or wallet
writers elsewhere. Reservations require bounded lifetime and crash cleanup.

## Settlement and ambiguous outcomes

`/settle` MUST revalidate issuance and block evidence, then coordinate the invoice
and payment attempt in durable shared state. Persist the attempt and hash before
broadcast. Recheck state immediately before `process`; this still is not a ledger
reservation. A different account update can win between the check and processing.

Wait for confirmation of the exact send hash. Verify confirmed sender, destination,
subtype, and amount against the invoice. Commit the redemption association and
result under the shared specification's uniqueness/deadline rules. Seller
fulfillment starts only after this commit.

On transport failure, query the submitted hash. If confirmed, reconcile that
payment; if accepted but unconfirmed, continue bounded polling or return pending;
if RPC evidence is unavailable, return an unknown outcome. Do not report a
transport timeout as evidence that the payer did not pay. Do not automatically
construct a new payment while the old one might still execute.

If a different confirmed account continuation makes the old block permanently
inapplicable and that payment hash is absent, the wallet may rebuild against the
new frontier for the same invoice. Rebuilding requires a fresh signature and
work. A missing block from one lagging RPC alone is insufficient evidence.

An identical retry after committed settlement returns the original transaction
outcome; it MUST NOT execute fulfillment a second time. An expired signed block
can still be broadcast outside this application. Late payment enters the shared
recovery policy, not automatic access or a promise of an automatic refund.

## Acceptance gates

Before claiming conformance, demonstrate ten concurrent callers through one wallet,
coordination across processes and receives, stale-frontier recovery, hash-based
resolution after lost replies, atomic settlement across workers, restart recovery,
and exact request/result attribution. Validate Nano signatures, work, confirmation,
and SDK dispatch against real adapters. The deterministic model covers only the
abstract execution and redemption contract.

---
title: "Track B: nanoSignature"
---

# Track B: nanoSignature

**Status:** Draft `nanoSignature/2`, revised 2026-10-16. Research candidate; no
conforming implementation or deployment recommendation. This revision replaces
the old `blockHash:nonce:validBefore` proof and short-lived spent-set design.
It is intentionally incompatible with the earlier unversioned draft.

The payer wallet owns the full send lifecycle: coordinate account writes, submit
the send, resolve ambiguous outcomes, and confirm the payment. It then signs an
invoice redemption proof using [NOMS, ORIS-001](https://github.com/OpenRai/Standards/blob/main/rfcs/ORIS-001.md).
The facilitator verifies evidence and commits redemption; it does not broadcast
the payer's block or possess payer keys. The seller controls invoice destinations
and their receiving keys.

This moves sequencing into the wallet. Ten HTTP purchases may be in flight while
one account executes ordered sends. Receives and representative changes share
that writer. Track B does not enable parallel account-chain updates, and a
signing API or shared keystore alone does not implement this writer.

The [shared specification](../protocol.md) is normative for issuance, payer and
request binding, destination allocation, transactional consumption, and recovery.
Read [the execution-model analysis](../execution-model.md) for the caller workload.


> **Boundary correction, 2026-10-16:** The server-allocated invoice binding and
> mandatory payer/session requirements below are withdrawn as a generic x402
> baseline. This version is a retained specialized candidate, not an active
> integration recommendation. The resource server must be able to use only public
> receiving configuration and facilitator HTTP calls, without wallet secrets or
> Nano RPC. Attribution/profile selection is being reevaluated; the signed-block
> versus payer-broadcast execution distinction remains valid. See the
> [shared correction](../protocol.md#resource-server-boundary-correction).

## Payment requirements

Use x402 v2 with `scheme: "exact"`, `network: "nano:mainnet"`, `asset: "XNO"`,
exact positive integer raw `amount`, and the unique invoice destination `payTo`.
`extra.nanoProfile` is `nanoSignature/2`. The other required `extra` fields are
`invoiceId`, `invoiceDigest`, `requestDigest`, `audience`, `payer`, `issuedAt`,
and `validBefore`, exactly as issued under the shared contract.

`maxTimeoutSeconds` bounds a confirmation/processing wait. The exclusive
`validBefore` is an application admission deadline, not a signature or ledger
property. The client MUST validate the complete invoice before authorizing funds.
The seller MUST disclose the paid-but-unredeemed recovery policy before payment.

## Client flow

1. Request an invoice for the actual HTTP request and the wallet's payer account.
2. Verify audience, request digest, price, destination, timestamps, and invoice digest.
3. Persist the invoice and a durable wallet operation ID.
4. Through the shared account writer, construct, sign, and persist the exact send.
5. Submit and resolve that hash until confirmed or definitively rejected.
6. Release account coordination immediately after confirmation; other purchases may pay.
7. Sign the canonical redemption message below with the sending account through NOMS.
8. Persist the proof, then retry the original HTTP request with PAYMENT-SIGNATURE.
9. Retry the same invoice/payment after failures; never pay again merely because HTTP timed out.

Queue expiry before any send should return an unpaid failure. Once a send might
have been submitted, resolve its hash even if the caller cancels. A cancellation
cannot revoke a Nano send already confirmed. The wallet's persistent operation
journal is necessary to resume after restart.

## Proof and canonical signing message

The x402 `PaymentPayload` copies the selected requirements into `accepted`.
Its proposed `payload` contains:

| Field | Type and constraint |
| --- | --- |
| blockHash | Confirmed send hash, 64 lowercase hex characters |
| account | Sending Nano address, decoded to the issued payer public key |
| signature | ORIS-001 NOMS signature, 128 lowercase hex characters |

The exact application message is UTF-8 text:

```text
x402.Nano/nanoSignature/2:<invoiceDigest>:<blockHash>
```

Both placeholders are 64 lowercase hex characters without prefixes. Colons are
literal ASCII; no spaces, newline, or normalization are allowed. The invoice
digest commits to the profile, seller audience, payer, request, destination, exact
amount, issuance time, and deadline. Apply ORIS-001 framing, hashing, and Nano
account signing to this complete text. Do not replace NOMS with a block signature
or generic Ed25519 message signing. ORIS-001 remains the authority for its encoding.

The signature proves the sender authorized this redemption. It does not prove
the order in which the payment and signing occurred. The unique issued destination
and trusted invoice record provide the invoice association; durable consumption
and fulfillment records prevent replay.

## Verification

`/verify` MUST perform these checks without consuming payment:

1. Validate x402 v2, supported profile, required fields, addresses, hex encodings, and raw integers.
2. Load the invoice from trusted issuance and compare every requirement and digest.
3. Match the actual HTTP request to its issued request digest and seller audience.
4. Require the proof account to equal the invoice payer by decoded public key.
5. Reconstruct the canonical text and verify the NOMS signature against that public key.
6. If a redemption exists, require this invoice/hash association and return its recorded status.
7. Otherwise reject new admission at or after `validBefore`.
8. Load `block_info` with JSON contents and require a confirmed state send.
9. Compare the ledger sender, destination, and exact amount with the trusted invoice.

Missing fields, untrusted issuance, unconfirmed blocks, and unavailable RPC data
must fail closed or return a pending/unavailable outcome. Do not count an RPC
error as evidence that funds were not sent. Compare addresses as decoded keys,
not display strings. Overpayment is outside this exact profile and enters recovery.

## Settlement, replay, and fulfillment

`/settle` repeats verification and atomically commits invoice/hash consumption
with a final deadline check, as defined in the shared specification. A read-only
`/verify` success cannot reserve the payment for a worker or prove fulfillment.

| Existing state | Submitted evidence | Required result |
| --- | --- | --- |
| No redemption, before deadline | Valid confirmed invoice payment | Commit and return settlement success |
| Same invoice/hash committed | Same authenticated proof, including after deadline | Return stored settlement success |
| Invoice committed to another hash | Different hash | Reject conflicting payment; reconcile extra funds separately |
| Hash committed to another invoice | Fresh signature or nonce | Reject conflicting redemption |
| No redemption, deadline passed | Valid but late payment | Record recovery case; no automatic fulfillment |
| Fulfillment already claimed/completed | Same invoice/hash | Resume or retrieve existing work/result; never launch a second job |

All workers for one redemption authority MUST use shared atomic uniqueness.
Keep destination tombstones and settlement associations durably; a TTL cache is
not the authoritative replay store. Expiry does not make a signature invalid,
and the payer can generate another signature later. New challenge data must not
allow the same ledger payment to fund another purchase.

The store commit is the admission boundary. If a process dies before the commit
and the deadline passes, recovery may require operator reconciliation. If it dies
after commit, authenticated retry must return the recorded result after restart.
Resource delivery has its own durable invoice-keyed state, with downstream
idempotency where needed. A settlement record alone does not establish exactly-once
external side effects.

## Operational costs and remaining gates

Unique receiving addresses add seller state, receive work, key derivation, and
consolidation. They are independent from payer outbox lanes. No additional payer
account is required by this profile. No shared-destination variant is specified.

Payer discovery/negotiation, SDK profile dispatch, cross-language canonicalization
vectors, NOMS signature vectors, persistent wallet coordination, production store
transactions, and real adapter tests remain unimplemented. The simulator tests
the revised state model, not these integrations. The existing packages and paused
demo do not conform to this revision.

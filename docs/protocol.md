---
title: Mechanism specification
---

# x402.Nano specification

**Status:** Draft under revision, 2026-10-16. The server-allocated invoice
contract in this revision is **withdrawn as a generic x402 baseline**. Neither
track has a conforming package implementation.

## Resource-server boundary correction

The default integration MUST work with public receiving configuration and HTTP
facilitator calls. A resource server MUST NOT be required to connect to Nano RPC,
hold wallet spend/view secrets, allocate invoice accounts, negotiate payer identity,
or retain buyer sessions. Recipient wallet operations belong outside that process.
Ordinary Nano seed/index derivation provides no xpub interface.

The authenticated-invoice and unique-destination sections retained below describe
the previous specialized stateful candidate, not mandatory baseline requirements.
They are suspended pending an attribution-profile decision. The local
`nanoTxn/1` and `nanoSignature/2` contracts MUST NOT be presented as upstream-ready
or implemented. Their deterministic model remains execution/state evidence only.

[The execution-model correction](./execution-model.md#resource-server-boundary-correction)
describes the required role separation. NanoNyms is a distinct specialized
alternative under evaluation, not an implicit replacement for either track.
It can move destination derivation to clients, but does not remove payer sequencing,
facilitator consumption state, or recipient notification/recovery requirements.


x402.Nano proposes two Nano mechanisms under x402 v2's `scheme: "exact"`:

- **Track A — nanoTxn:** the payer signs a state send block for facilitator broadcast.
- **Track B — nanoSignature:** the payer wallet broadcasts and confirms its own
  send, then signs a proof for invoice redemption.

The baseline workload is ten concurrent paid HTTP requests from subagents sharing
one logical wallet. Applications MUST NOT need to allocate outbox accounts or
coordinate frontiers. A wallet adapter MUST coordinate all account-chain writes.
HTTP concurrency does not imply parallel writes to one Nano account chain.

Read [the execution-model analysis](./execution-model.md) for the counterexample
and [implementation conformance status](./audits/protocol-consistency-audit.md)
for the existing code's limitations.

## General consumption rule

A reusable proof of completed payment intended for single-use redemption requires
an authoritative consumption decision somewhere. Its representation may be a
spent-hash set, on-chain nonce state, redemption journal, credit ledger, or equivalent
state. The resource server need not host it. Multi-use entitlements require
remaining-use accounting. Retention must follow payment admissibility; a short
HTTP timeout alone does not make a still-redeemable payment safe to forget.

A controlled receive block can be a specialized on-chain consumed marker when
the facilitator owns the destination signing authority. This changes custody and
requires deterministic receiving behavior; it does not by itself bind the consumed
payment to a request or prove fulfillment. See the
[review proposal](./review.md#optional-receive-acknowledgement) for scope and failure cases.

## x402 binding and draft compatibility

Use `x402Version: 2`, `scheme: "exact"`, `network: "nano:mainnet"`, `asset: "XNO"`,
and positive decimal integer raw amounts. One XNO is 10^30 raw. The network
identifier follows [ORIS-006](https://github.com/OpenRai/Standards/blob/main/rfcs/ORIS-006.md),
an Implementation Draft when reviewed. This proposal defines no alternative
Nano network identifiers.

| Direction | HTTP header | Base64-encoded object |
| --- | --- | --- |
| Server issues 402 | PAYMENT-REQUIRED | PaymentRequired |
| Client retries | PAYMENT-SIGNATURE | PaymentPayload |
| Server returns settlement result | PAYMENT-RESPONSE | SettleResponse |

`PaymentRequired.accepts` contains `PaymentRequirements`. A payload copies the
selected entry into `accepted`; that copy MUST be checked against authenticated
issuance and MUST NOT be treated as proof of issuance. The resource description
alone is not an authorization binding to HTTP method, query, or body.

The revised profiles propose `extra.nanoProfile` values `nanoTxn/1` and
`nanoSignature/2`. These are local draft discriminators, not registered x402
extensions or a new top-level `mechanism` field. Clients MUST select only a
profile they support and MUST NOT infer the profile from scheme/network alone.
Unsupported or absent discriminators MUST NOT silently select these revisions.
There is no compatibility claim with earlier x402.Nano payloads or `@x402nano/exact`.
The x402 SDK registration/dispatch adapter remains to be implemented and tested.

## Previous candidate: authenticated invoice (suspended)

The previous specialized candidate used the following proposed issuance record. The resource server
persists it before issuing the 402. A facilitator loads it through an authenticated
server-to-server interface or a shared trusted store; the public payload cannot
create or replace it. This draft does not standardize that private interface.

| Field | Requirement |
| --- | --- |
| profile | Exactly the selected `extra.nanoProfile` |
| invoiceId | 32 random bytes as 64 lowercase hex characters |
| audience | HTTPS seller origin; URL serialization of its origin, without trailing slash |
| network, asset | `nano:mainnet`, `XNO` |
| payer | Expected sender, expressed in the digest as decoded lowercase public-key hex |
| destination | Seller-controlled, unique invoice address; digest uses decoded public-key hex |
| amount | Exact positive raw amount, canonical decimal without leading zeros |
| requestDigest | Lowercase hex SHA-256 of the request tuple defined below |
| issuedAt | Nonnegative Unix seconds, safe integer |
| validBefore | Exclusive admission deadline, Unix seconds, greater than issuedAt |

The buyer supplies its payer address when requesting the invoice. The seller
validates and binds it before issuance. A missing payer requires an unpaid
challenge negotiation round; clients MUST NOT transfer funds until they have a
complete invoice. The concrete negotiation header/API is unresolved and prevents
claiming drop-in SDK or curl integration today.

The request tuple is UTF-8 `JSON.stringify([method, target, bodyDigest])`, with no
added whitespace. `method` is the uppercase ASCII HTTP method. `target` is the
seller's absolute HTTPS request URL as issued, without a fragment; path and query
bytes MUST be preserved without sorting or percent-decoding. `bodyDigest` is
lowercase hex SHA-256 of the exact HTTP body bytes, including an empty body.
The seller MUST verify the actual request against this tuple and its configured
audience origin; untrusted Host/forwarding headers cannot define that authority. Endpoints whose
output or authorization depends on other headers or identity MUST bind those
inputs through an additional application contract, or reject this profile. Such
endpoints are outside this first revision's interoperable request model.

The invoice digest is lowercase hex SHA-256 of UTF-8 `JSON.stringify` of this
ordered array, with no whitespace or trailing newline:

```text
["x402.Nano/invoice/1", profile, invoiceId, audience, network, asset,
 payerPublicKeyHex, destinationPublicKeyHex, amount, requestDigest, issuedAt, validBefore]
```

All textual elements are strings; only the two timestamps are JSON integers.
No arbitrary JSON-object canonicalization is implied. SHA-256 is the invoice
binding hash, not a replacement for Nano block hashing or NOMS hashing.
`extra` carries `nanoProfile`, `invoiceId`, `invoiceDigest`, `requestDigest`,
`audience`, `payer`, `issuedAt`, and `validBefore`. The server checks every value
and standard payment field against its persisted invoice.

### Destination allocation

For this first concrete profile, destinations MUST be allocated exclusively to
one invoice and MUST NOT be reused, including after expiry or settlement.
Allocation must be coordinated across all issuers sharing destination keys.
Retain a durable tombstone for every issued destination. If the issuance store
is lost or rolled back, stop issuance/redemption until it is recovered; do not
reconstruct authority from client claims. A shared treasury address or amount tag
is a different binding profile and is not specified here.

The seller, not the verification facilitator, controls receiving keys. Sellers
must account for address derivation, receives, monitoring, and consolidation.
Invoice addresses do not require separate payer outbox accounts. A confirmed
send establishes payment; waiting for the recipient's receive is not required.

## Wallet execution invariant

Every process using an account MUST share a writer that coordinates sends,
receives, and representative changes. Before broadcasting, persist operation ID,
invoice digest, signed block, and computed block hash. On an unknown outcome,
query that hash and reconcile before constructing a replacement send. Persisted
intents must survive service restart. A leased writer must fence stale holders;
a process-local mutex is insufficient across independent processes. A duplicate operation returns its existing
send. One operation cannot silently change invoice or amount on retry.

Track A keeps coordination until the remote submission outcome is resolved.
Track B keeps it through the wallet's own send confirmation, then releases it
before seller proof submission or fulfillment. Either implementation MUST provide
queue limits and timeout behavior. Multiple lane accounts MAY be hidden inside a
wallet; callers MUST NOT be required to manage them.

## Redemption and fulfillment invariant

The authoritative seller store MUST atomically enforce both uniqueness rules:

- one invoice maps to at most one payment hash;
- one `(network, paymentHash)` maps to at most one invoice in the redemption authority.

For the selected destination profile, distinct sellers' exclusive addresses also
prevent a single send from satisfying their independent invoices. Duplicate
workers sharing one seller must share its transactional redemption store.

`/verify` checks evidence and issuance; it MUST NOT consume payment or grant access.
Its result is advisory and may become stale. `/settle` revalidates and commits
redemption before successful fulfillment. An identical authenticated retry returns
the recorded settlement result, including after the admission deadline. A different
invoice/payment association is rejected. Do not equate a second successful status
query with permission to execute the purchased work again.

Use a durable fulfillment record keyed by invoice digest. Workers claim work
atomically; repeated requests resume or retrieve the same result. External side
effects require downstream idempotency or a transactional outbox. This proposal
does not claim exactly-once execution across arbitrary external systems. Delivery
of an existing result must authenticate the original buyer through the same proof
or a separately authorized application session. For Track A, the block is public
after broadcast and MUST NOT be treated as a secret buyer credential; bind issuance
and result retrieval to an authenticated buyer session or equivalent capability.

## Expiry and recovery

Expiry is an application check. A NOMS signature remains mathematically valid
after its timestamp. A signed Nano block has no ledger-enforced expiry.

A new redemption MUST be admitted and committed before `validBefore`, using the
store authority's clock and a final transactional deadline check. RPC-local block
timestamps are not proof of confirmation before a global deadline. A previously
committed redemption remains recoverable after expiry. If payment exists but
redemption was never committed in time, record a paid-but-unredeemed recovery
case, grant no automatic access, and expose it to authenticated buyer/operator
reconciliation. No automatic refund is promised. Disclose this policy before payment.

Keep issuance, destination tombstones, payment associations, and settlement
outcomes durably. A short-lived proof does not justify a short-lived replay cache.
Archival MAY compact records only if uniqueness and retry evidence remain available.

## Threat model and security review

Assume public ledger observation, malicious buyers, concurrent workers, retries,
restarts, and equal-price invoices. Use authenticated HTTPS and trusted RPC data;
keys and an authenticated store are trusted. A compromised wallet or seller is
outside the claimed protection. Fail closed when issuance or consumption state
cannot be read reliably.

| Attempt | Required protection |
| --- | --- |
| Steal another buyer's public payment | Invoice payer/destination binding; Track B sender signature |
| Redeem for another equal-price resource | Unique destination, actual request digest, issued invoice digest |
| Forge or alter a challenge | Trusted issuance lookup and full field comparison |
| Redeem concurrently on two workers | Transactional uniqueness and one fulfillment claim |
| Retry after lost success | Recorded settlement plus authenticated result retrieval |
| Re-sign an old block for a fresh challenge | Different never-reused destination; durable associations |
| Publish after expiry | Ledger may accept; server refuses new admission and records recovery case |
| Advance payer frontier before broadcast | Wallet coordination; revalidation and unknown-outcome recovery |

The [model](./execution-model.md) covers these state transitions with simulated
authentication. It does not complete a cryptographic review, real-mainnet attack
coverage, production database validation, or SDK integration. Both tracks remain
unready for production claims until those gates are satisfied.

## Track specifications

- [Track A: nanoTxn](./extensions/track-a-nanotxn.md)
- [Track B: nanoSignature](./extensions/track-b-nanosignature.md)

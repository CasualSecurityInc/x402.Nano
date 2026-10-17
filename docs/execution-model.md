---
title: One wallet, ten concurrent purchases
---

# One wallet, ten concurrent purchases

**Status:** Draft analysis, 2026-10-16. Executable evidence is a deterministic model,
not an integration test or a benchmark of another implementation.

An agent must be able to launch ten paid HTTP requests from ten subagents sharing
one logical wallet. Callers should supply a URL, request, spending policy, and
wallet reference. They should not allocate accounts, manage frontiers, or retry
payments whose outcome is unknown. Multiple HTTP requests must remain in flight
while the wallet orders the ledger operations they require.

This workload exposes two independent problems:

1. **Wallet execution:** avoid conflicting account-chain updates across callers.
2. **Purchase attribution:** bind each payment to its seller, invoice, request,
   and durable result, including when replies are lost.

Fixing either problem does not fix the other.

## Resource-server boundary correction

The resource server must be able to advertise public receiving configuration and
use facilitator HTTP calls without Nano RPC access, wallet private keys, invoice
account allocation, or buyer sessions. Its receiving wallet is a separate component.
Ordinary Nano seed/index derivation has no xpub interface.

The earlier selection of server-allocated invoice destinations is withdrawn as a
generic baseline. The executable model retains that specialized attribution
contract as a counterexample/test fixture. It does not prove an acceptable
resource-server integration. Its account sequencing results remain applicable.

NanoNyms is a distinct alternative: a client can derive destinations from public
payment-code keys, while a facilitator verifies a disclosed per-payment witness.
[ORIS-005](https://github.com/OpenRai/Standards/blob/256f9186271d2ea414e7e35fef65446fa0a151c5/rfcs/ORIS-005.md)
already specifies a Working Draft for that pay-first flow. It is being evaluated,
not adopted here. Destination membership, HTTP purchase attribution, persistent
consumption, and recipient notification are separate requirements. No NanoNyms
code is exercised by this model.

## Why a signed Nano block differs from an authorization

A Nano state block signs an account, predecessor, representative, resulting
balance, and link. Two independent sends prepared against the same predecessor
are alternative continuations of one account chain. Once one confirms, the other
cannot extend that chain. A receive or representative change can also advance the
frontier. Funds merely becoming receivable do not advance the payer's chain.

EIP-3009 authorizations identify transfers with independent random nonces. A
successful authorization does not inherently invalidate another authorization
through a shared predecessor. Balance, expiry, cancellation, and execution rules
can still prevent payment. Neither model guarantees funds from a signature alone.

x402's `exact` scheme is broader than EIP-3009. A Nano signed-block mechanism can
implement exact payments, but cannot inherit EIP-3009 execution properties merely
by using the same HTTP envelope.

### Decisive trace

| Step | Seller A | Seller B | Payer account |
| --- | --- | --- | --- |
| 1 | Issues invoice A | Issues invoice B | Confirmed frontier H, sufficient funds |
| 2 | Receives signed block A, previous H | Receives signed block B, previous H | Both blocks individually fit H |
| 3 | Verifies A | Verifies B | No transfer yet |
| 4 | Broadcasts A successfully | Waits | Frontier becomes hash(A) |
| 5 | — | Broadcasts B; rejected | B still references H |

A lock keyed by block hash does not coordinate A and B: their hashes differ.
A lock local to one facilitator does not reserve an account at another facilitator.
Even a global wallet lock around signing alone is insufficient if it is released
before the wallet knows which block extended its account chain.

## Two proposed contracts

| Property | Track A: nanoTxn | Track B: nanoSignature |
| --- | --- | --- |
| Who broadcasts | Facilitator | Payer wallet |
| Who coordinates payer writes | Wallet, across outstanding facilitator submissions | Wallet, through its own send service |
| What verification establishes | Conditional executability; no network reservation | Evidence of a confirmed invoice payment and sender control |
| Safe fulfillment gate | Confirmed settlement | Confirmed payment plus committed redemption |
| Main failure boundary | Prepared block becomes stale before broadcast | Payment succeeds but redemption or fulfillment fails |
| Ten simultaneous HTTP requests | Needs wallet coordination spanning remote submission | Needs wallet coordination through local send confirmation |

Track B moves account-chain coordination into the component that controls the
account. It does not make the chain parallel. After a send confirms, the wallet
releases its account lock while that purchase continues through proof submission
and seller fulfillment. Other purchases can pay during that interval.

Track A can also hide coordination inside a wallet adapter, but the adapter must
track outstanding blocks until remote broadcast resolves. That is an explicit
implementation cost, not a reason to require callers to coordinate themselves.

## Wallet service boundary

The proposed caller contract is one asynchronous paid request per operation.
This is a requirement for a future adapter, not an existing OWS API:

1. Assign a durable operation ID before requesting payment.
2. Preserve the issued invoice and validate its destination, price, and audience.
3. Route every send, receive, and representative change through the same writer.
4. Persist a prepared block and operation association before any broadcast.
5. On timeout, resolve that block hash before authorizing a replacement payment.
6. Release account coordination once the ledger result is known; keep HTTP work concurrent.
7. Resume the same operation and invoice after a caller or service restart.

Ten processes sharing a keystore are not automatically sharing a scheduler. A
cross-process service or shared transactional coordinator is required. An OWS-like
wallet is the motivating integration surface; no OWS concurrency or Nano signing
capability is asserted by this proposal.

Multiple outbox lane accounts are an optional wallet scaling pattern applicable
to both tracks. They add funding, selection, receive handling, policy accounting,
and recovery state. They must not become a requirement of an application making
a paid HTTP request. One-account operation must work correctly before lanes are
considered. A serialized account imposes a throughput limit; backpressure and
queue deadlines must be visible rather than represented as unlimited capacity.

## Attribution is a separate contract

A signature proving control of a sender does not identify what a payment bought.
The previous specialized Track B candidate assigned a never-reused destination
to each invoice; that choice is now withdrawn as a generic baseline. An authenticated issuance record binds that destination to an exact
amount, request digest, payer, seller audience, and expiry. NOMS signs the payment
hash and invoice digest. Durable redemption prevents a second fulfillment.

A shared destination with facilitator-managed durable allocation is a simpler
alternative to evaluate alongside client-derived NanoNyms destinations. It must define how old payments are excluded,
how competing invoice claims resolve, and which stores coordinate consumption.
A nonce signed after payment alone does not establish those properties.

Signatures do not stop verifying when a timestamp passes. Expiry is verifier
policy. Neither a short proof lifetime nor a unique block hash permits forgetting
that a payment was consumed. A Nano block also has no ledger-enforced challenge
expiry: a signed block may still be published after the server stops accepting it.

## Executable evidence and limits

From the repository root, with dependencies installed:

```bash
pnpm exec tsx test/model/compare.ts
pnpm exec vitest run test/model/execution-model.test.ts
```

The comparison requires no seed, network, RPC service, or real funds. It models
a single account chain, ten independent sellers, wallet coordination, invoice
binding, and transactional redemption. It reports expected failures for ten
uncoordinated signed blocks, successful coordinated sends, and the identical
frontier failure for uncoordinated Track B sends. Tests also exercise an intervening
receive, lost replies, expiry, restart snapshots, and multiple redemption workers.

The model uses an explicitly simulated authenticator. It does not validate Nano
block encoding, Ed25519, NOMS, proof of work, RPC confirmation, production store
isolation, real OWS behavior, or the code of any other project. Snapshot reload
models acknowledged persistent state, not filesystem durability or crash safety.
It makes no throughput claim. Those require separate adapter and integration tests.

## Source observations and adoption path

Reviewed 2026-10-16:

- [Nano block format](https://docs.nano.org/protocol-design/blocks/) defines the
  predecessor and resulting balance.
- [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) defines random authorization
  nonces, validity checks, and on-chain consumption state.
- [Pursekeeper x402 source at 7f3d4d9](https://github.com/pursekeeper/api/blob/7f3d4d9dbdf520930b8aa02b25ff1b523106832a/x402.js)
  checks frontier changes and recovers already-landed sends by hash.
- [Its facilitator at the same revision](https://github.com/pursekeeper/api/blob/7f3d4d9dbdf520930b8aa02b25ff1b523106832a/facilitator.js)
  coordinates identical hashes and remembers broadcast outcomes. Those controls
  address different cases from distinct competing sends out of one account.
- [Nano exact proposal #3432](https://github.com/x402-foundation/x402/pull/3432)
  was open at head `6b9e1457880cdd437b1717493da0d01d0123e242`. It is a proposal,
  not an accepted standard.

These observations do not establish whether Pursekeeper's full wallet stack
coordinates all account writers. The useful collaboration is to run the same
one-wallet workload against real adapters and compare lifecycle guarantees.
Existing recovery work deserves credit; the frontier constraint also applies to
our own Track A.

See the [shared specification](./protocol.md), [Track A](./extensions/track-a-nanotxn.md),
and [Track B](./extensions/track-b-nanosignature.md). No adoption outreach is part
of this artifact.

# Execution and redemption model

**Scope:** deterministic design comparison for the 2026-10-16 draft. No network,
wallet access, seed, environment file, or real payment is used.

From the repository root with its existing dependencies installed:

```bash
pnpm exec tsx test/model/compare.ts
pnpm exec vitest run test/model/execution-model.test.ts
```

The comparison asserts these results:

| Model configuration | Completed ledger payments / requests |
| --- | --- |
| Track A, ten blocks prepared independently at one frontier | 1 / 10 |
| Track B, ten sends prepared independently at one frontier | 1 / 10 |
| Track A, shared writer held across facilitator submission | 10 / 10 |
| Track B, shared writer held through wallet send confirmation | 10 / 10 |

These are outcomes under a forced conflicting schedule, not observed failure
rates or performance measurements. A separate test holds all ten seller results
behind a barrier: all ten sends and redemptions complete before any fulfillment
starts. This demonstrates the intended difference between concurrent purchases
and ordered account writes.

`model.ts` supplies:

- A single-account ledger requiring the correct predecessor and balance decrement.
- A simulated signing oracle and deterministic block identities.
- A shared writer and operation journal used by simulated wallet processes.
- Authenticated issuance by direct trusted store insertion, unique invoice
  destinations, exact payments, and request-bound redemption proofs.
- One synchronous atomic store authority shared by simulated seller workers.
- Store snapshots preserving issuance, destination tombstones, settlement,
  recovery cases, and completed fulfillment.

`execution-model.test.ts` exercises frontier conflicts, an intervening receive,
separate wallet instances sharing keys with and without coordination, concurrent
operation retries, lost process replies and wallet restart, ten seller workers,
wrong-resource and wrong-payer proofs, forged issuance, lost fulfillment replies,
expiry boundaries, deadline changes between verification and commit, and old
payment re-signing after restart and expiry.

## Resource-server boundary correction

The server-allocated unique-destination contract modeled here has been withdrawn
as a generic x402 baseline. It assumes trusted issuance/allocation state and does
not demonstrate a resource server using only public receiving configuration and
facilitator HTTP calls. The tests remain evidence about payer sequencing and that
specialized attribution contract. No NanoNyms derivation, witness verification,
notification, or sessionless resource-server integration is implemented here.
See `docs/architecture/nanonyms-evaluation.md`.

## Deliberate abstractions

The identity oracle uses a hash over a model key and message. It is neither NOMS
nor Nano block signing. Account/destination labels and block hashing are not Nano
wire encodings. The ledger treats processing as immediate confirmation and cannot
represent RPC disagreement, forks, confirmation latency, or work validity. The
request digest fixture uses symbolic inputs; production HTTP canonicalization
must be tested independently. The Track A comparison models its account-writer
boundary; it is not a complete Track A facilitator or HTTP implementation.

The synchronous store critical section stands for a transaction. Promise scheduling
allows all workers to verify before committing, but is not a real multi-process
database test. Snapshot restore models acknowledged durable data; it does not test
fsync, storage failure, WAL recovery, lease fencing, or lost commits. Fulfillment
is one atomic deterministic operation; arbitrary external effects require their
own idempotency contract. Existing results are looked up through the model's
simulated proof authentication, not a production HTTP authentication adapter.

No production code or external implementation is imported by these tests. Passing
them provides a regression check for the proposed abstract contract. It does not
establish package conformance, OWS behavior, cryptographic security, mainnet
behavior, distributed durability, or throughput.

## Next adapter evidence

Run the same workload through actual Nano block/NOMS encoders, a persistent wallet
service shared by ten processes, x402 SDK profile dispatch, a transactional seller
store, and RPC fault injection. Include uncertain broadcast resolution before
replacement signing, server crashes at every store boundary, lease loss, queue
expiry, caller cancellation, slow sellers, and request header/body canonicalization.
Credit existing facilitator recovery mechanisms when comparing results.

---
title: Nano exact payments — concurrency and redemption
---

# Nano exact payments: concurrency and redemption

**Status:** Discussion draft, 2026-10-16. Runnable model; no conforming reference
implementation or migration recommendation.

We propose a common review workload and payment-lifecycle contract for Nano under
x402 v2's `exact` scheme. The goal is one paid-request API that ten subagents can
use through one logical wallet, with a resource server configured only with public
receiving information and a facilitator HTTP client.

Two questions need separate answers: who orders the payer's account-chain writes,
and how a payment becomes one purchase with a recoverable result?

## One wallet, ten callers

A Nano state send block commits to a predecessor and resulting balance. Ten
independent sends prepared against one frontier are competing continuations of
that account chain. Confirming one prevents the others extending that frontier.
Per-hash facilitator locks coordinate retries of the same block; they do not
coordinate distinct competing blocks from one payer.

Both execution patterns need a shared wallet writer:

| Pattern | Coordination boundary | What remains concurrent |
| --- | --- | --- |
| Client signs, facilitator broadcasts | Through resolution of remote submission and confirmation | Independent HTTP requests and seller work after the account is released |
| Wallet signs and broadcasts, then submits proof | Through resolution and confirmation of its own send | Proof redemption and seller work after the account is released |

The writer must include receives and representative changes. Multiple processes
sharing signing keys are not automatically sharing coordination. Applications
should not manage frontiers or choose outbox lanes. Multiple funded lane accounts
remain an optional internal scaling pattern for either execution pattern.

[The execution paper](./execution-model.md) explains the forced conflict schedule.
The deterministic model can be run from the repository root:

```bash
pnpm exec tsx test/model/compare.ts
pnpm exec vitest run test/model/execution-model.test.ts
```

It produces 1/10 completed payments for each uncoordinated pattern and 10/10 for
each coordinated pattern under that schedule. A separate test completes ten
payments while all seller responses remain outstanding. These are model outcomes,
not observed failure rates or performance measurements of an external project.
The attribution fixture uses a specialized server-allocation contract that is
not our generic resource-server baseline. It does not implement NanoNyms.

## General consumption rule

**A reusable proof of completed payment intended for single-use redemption requires
authoritative consumption accounting somewhere.** This can be a spent-hash set,
on-chain nonce mapping, redemption journal, credit ledger, or equivalent state.
A multi-use entitlement requires accounting for its permitted remaining uses.
The resource server need not store that payment-consumption state.

A prepared authorization also has consumption state: EIP-3009 uses on-chain
nonces. A Nano send proves funds moved but does not record which HTTP access was
purchased. Pay-first redemption therefore needs additional accounting. A short
HTTP timeout does not justify discarding consumption evidence while the same
payment can still be introduced under another proof or operation ID.

## Purchase association and retry contract

Core x402 does not universally require a ledger payment to commit to URL, method,
or body. The usual EIP-3009 authorization signs transfer terms and a nonce, not
those HTTP fields. Stronger commitment before payment is an optional profile.

For the baseline, validate the actual resource's expected payment terms and
allocate an unused qualifying payment to one operation at redemption:

1. Verify legitimate proof possession, recipient, exact amount, and confirmation.
2. Compare profile metadata with the actual request's expected requirements.
3. Atomically associate the payment with one operation ID and request fingerprint.
4. Return the recorded outcome for matching authenticated retries.
5. Reject a different operation/context consuming the same payment, even with a new ID.

Use v2's [payment-identifier extension](https://github.com/x402-foundation/x402/blob/faa1c694c66a3732aaabbce93bdae140e521a67d/specs/extensions/payment_identifier.md)
for retry identity and request fingerprinting. `PaymentRequirements.extra` carries
profile metadata; envelope-level `extensions` carry optional extension data.
Neither location automatically signs its contents. Profiles must define what is
verified, compared, and recorded. Claiming service delivery exactly once still
requires appropriate application idempotency; settlement status alone cannot
make arbitrary external side effects atomic.

All replicas and authorized facilitator paths for a merchant must share a
consumption authority or an equivalent coordination mechanism. Define ambiguous
broadcast outcomes, deadlines, late payments, restart recovery, and lost successful
replies. `/verify` is advisory; it must not consume a payment or grant access.

## Public-only receiving configuration

The resource-server baseline requires no Nano RPC connection, wallet private
keys, invoice-account allocator, buyer login, or buyer session registry. Ordinary
Nano seed/index derivation provides no xpub interface. Wallet coordination and
receiving operations belong outside the resource-server process.

Two pay-first proof candidates merit implementation review:

- **Fixed receiving address plus contextual sender proof:** simpler receiving
  operations, with facilitator-managed allocation and durable consumption.
- **NanoNyms specialization:** clients derive destinations from a public payment
  code; a facilitator verifies the disclosed per-payment witness. The recipient's
  separate wallet handles private keys, notifications, receiving, and recovery.

NanoNyms has a deployed proof of concept. Its x402 application is speculative;
[ORIS-005](https://github.com/OpenRai/Standards/blob/256f9186271d2ea414e7e35fef65446fa0a151c5/rfcs/ORIS-005.md)
is a Working Draft we can revise directly. It should specify expected-term checks,
payment-identifier integration, consumption authority, retry/expiry policy, and
notification recovery while retaining ORIS-002 derivation. It need not introduce
a cryptographic commitment to the HTTP request unless a particular application
requires that stronger property.

### Optional receive acknowledgement

A different profile can use a confirmed receive block as an on-chain consumed
marker when the facilitator controls the destination signing keys. This is
[ORIS-007 Receive Acknowledgement](https://github.com/OpenRai/Standards/blob/256f9186271d2ea414e7e35fef65446fa0a151c5/rfcs/ORIS-007.md#receive-acknowledgement),
a context-dependent pattern, not the public-only verification baseline.

The application must control all receiving behavior: wallet auto-receive must
not consume an entitlement accidentally. Check the confirmed receive linked to
the exact send; absence from a receivables list is not sufficient evidence.
Receiving-account signing authority can also spend its funds, so this changes
custody/trust. The receive marks ledger consumption but does not encode which
request won or whether service was delivered. Concurrent duplicate submissions,
crashes after receive, and lost replies still require operation association and
recovery. Destination-chain writes also need coordination.

## Review request and evidence limits

Pursekeeper already checks moved frontiers, recognizes previously landed payments,
locks identical hashes, and remembers broadcast outcomes in the
[reviewed source](https://github.com/pursekeeper/api/blob/7f3d4d9dbdf520930b8aa02b25ff1b523106832a/facilitator.js).
That work addresses real failures. This review asks a separate question: what
contract does the full wallet integration provide when ten independent purchases
and receives share one payer account?

A useful first collaboration is running that workload against actual adapters
and comparing retry/consumption behavior, alongside the
[open Nano exact proposal](https://github.com/x402-foundation/x402/pull/3432).
The model does not establish that Pursekeeper lacks wallet coordination. It uses
simulated authentication and ledger behavior, not Nano/NOMS/NanoNyms cryptography,
RPC faults, production persistence, OWS, or a real-mainnet integration.

A recommendation to adopt a new mechanism needs more evidence: a persistent
multi-process wallet adapter, actual cryptographic vectors and SDK dispatch,
transactional consumption, and crash/retry integration tests. Those are gates
for deployment claims, not prerequisites to discussing this workload and contract.

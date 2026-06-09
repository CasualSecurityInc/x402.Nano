---
title: Generational Sharded Pools
---

# Extension A: Generational Sharded Pools

**Status:** Draft / Proposal **Date:** March 11, 2026  
**Type:** Optional Opt-in Extension  
**Track Applicability:** Both `nanoSession` and `nanoSignature` (track-independent — address pool mechanics apply regardless of verification variant)  
**Base Specification:** `x402_NanoSession_rev7_Protocol.md`

## 1. Abstract

This extension defines the **Sharded Pool** architecture for high-volume services. While the Base Specification uses a single address, services processing >1 TPS may encounter ledger contention when the "Janitor" attempts to pocket funds. Sharded Pools distribute this load across 20-100 addresses using deterministic mapping based on Session ID.

## 2. Motivation: Single-Chain Concurrency

The primary motivation for this extension is **Throughput**, not privacy.

*   **Head-of-Line Blocking:** In Nano's Block Lattice, each account has its own blockchain. Blocks must be appended sequentially. To "pocket" a pending payment, the server must generate a Receive Block that references the previous block on that account.
*   **The Bottleneck:** If a single address receives 1,000 payments/sec, the server must sign and publish 1,000 receive blocks *in order*. Network propagation and PoW generation (even with acceleration) create a hard physical limit on the confirmation rate of a single chain.
*   **The Solution:** By distributing sessions across $N$ addresses (shards), the Facilitator can process $N$ receive chains in parallel, effectively multiplying the maximum settlement throughput by $N$.

## 3. Architecture

### 3.1. The Facilitator: Generational Sharded Pool
The Facilitator maintains a pool of $N$ addresses. To ensure operational hygiene and mitigate long-term fingerprinting, the pool rotates periodically using Hierarchical Deterministic (HD) derivation.

**Address Derivation (Normative):**
The Facilitator derives addresses using the following path:
`m / 44' / 165' / <Generation>' / <Pool_Index>'`

*   `Generation = floor(UnixTimestamp / Rotation_Period)` (Default `Rotation_Period`: 1 Week).
*   `Pool_Index = Hash(id) % Pool_Size` (Recommended Pool_Size: 20-100).

### 3.2. Session Mapping
When a client requests a resource, the Facilitator uses their session `id` to determine the correct `Pool_Index`.

**Resource Server Response (402)**:
*   `payTo`: The specific pool address derived from `Pool_Index` (in `PAYMENT-REQUIRED`).
*   `nanoSession.id`: The mandatory session identifier (in `PAYMENT-REQUIRED`).

### 3.3. The Janitor
To ensure the Facilitator's pool accounts are always ready to move funds, the "Janitor" process SHOULD pre-compute PoW for the next expected `receive` block for **every address in the pool**. This parallelism allows the Facilitator to settle funds 20-100x faster than a single address.

## 4. Rotation & Grace Period

Facilitators MUST monitor addresses for both the **Current** and **Previous** Generations. This ensures that clients who started a session right before a generation flip can still complete their payment.

## 5. Session Binding in Pooled Mode

Session binding (per Rev 7 security requirements) works identically in pooled mode:

1. Facilitator generates `id` and determines `Pool_Index` from session
2. Facilitator stores: `id → { payTo: poolAddress[Pool_Index], amount, resourceAmountRaw, tagAmountRaw, tag, expiresAt }`
3. Client returns `id` (nested in `nanoSession`) with block hash
4. Facilitator verifies block matches the pool address in stored requirements

The pool architecture is transparent to the security model.

## 6. Privacy Considerations

The Sharded Pool model provides limited privacy against an active observer. An attacker can enumerate the Facilitator's entire active pool by making repeated requests with different session IDs. This extension primarily addresses **throughput**, not privacy. For privacy, see **Extension B**.

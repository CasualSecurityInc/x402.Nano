---
title: Dust Return (Janitor Policy)
---

# Extension D: Dust Return (Janitor Policy)

**Status:** Draft / Proposal **Date:** March 11, 2026  
**Type:** Optional Opt-in Extension  
**Track Applicability:** `nanoSession` only (janitor dust-return is a consequence of Raw Tagging; `nanoSignature` does not generate dust)  
**Base Specification:** `x402_NanoSession_rev7_Protocol.md`

## 1. Abstract

The `x402.NanoSession` protocol relies on "Dust Tagging" to bind a generic payment to a specific HTTP session. For example, if a resource costs `0.001 XNO`, the server might append a tag of `12345` raw, requiring the client to send a `block_amount` of `1000000000000000000012345` raw to the destination address.

While this cryptographically secures the session against receipt-stealing attacks, it leaves a microscopic amount of "dust" in the destination account on every single HTTP action. In Nano, every raw is spendable at the protocol level; however, some nodes and wallets may choose to ignore tiny balances operationally. Because the Nano network is completely feeless, there is zero network cost to returning this dust to the original sender.

This extension formalizes the standard mechanism by which a server announces its intention to sweep and return this dust asynchronously.

## 2. Server Announcement (`dustRebate`)

A server that adheres to Extension D MUST announce its intention during the Initial `402 Payment Required` Phase.

The Resource Server MUST add the boolean flag `dustRebate: true` to the `extra` requirements object:

```json
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: [Base64 Encoded JSON]

{
  "network": "nano:mainnet",
  "asset": "XNO",
  "amount": "1000000000000000000000000",
  "payTo": "nano_1os1h4tzx...",
  "maxTimeoutSeconds": 600,
  "extra": {
    "nanoSession": {
      "id": "a1b2c3d4e5f6",
      "tag": 12345,
      "resourceAmountRaw": "1000000000000000000000000",
      "tagAmountRaw": "12345"
    },
    "dustRebate": true
  }
}
```

### Client Interpretation

When a Client sees `dustRebate: true`, it can conceptually model the transaction as:
`amount = resourceAmountRaw + tagAmountRaw`.

## 3. The Janitor Role

Returning 12,345 raw synchronously during the `POST /settle` Phase would vastly slow down the HTTP request execution time, as the server would need to generate PoW, sign, and broadcast a return block before completing the user's initial API call.

With the core default `tagModulus` of `10_000_000`, a typical tag like `4_271_593` raw is only `4.271593e-24 XNO` (since `1 raw = 1e-30 XNO`). The default tag modulus uses tag values as small as `1e-24 XNO`, which is effectively dust.

Therefore, dust return MUST be asynchronous. This is the domain of the **Janitor**.

### Janitor Responsibilities:
1. **Sweep Tracking:** The Facilitator (or dedicated Janitor service connecting to the Facilitator's database) maintains a ledger of incoming Send Blocks, tracking the sender `account`, the base `amount`, and the `tag` dust.
2. **Thresholding / Batching:** The Janitor MAY wait until a specific sender has accumulated a minimum amount of dust, or it MAY execute sweeps on a cron schedule (e.g., nightly).
3. **Execution:** The Janitor generates a SEND block from the Facilitator's active payment wallet back to the `sender` account identified in the original payment block, containing exactly the sum of the dust owed.

### Execution Environments
Due to the intense nature of Nano Proof-of-Work (PoW) generation, the Janitor is almost never run inside the Resource Server's HTTP request loop. It is strictly a Facilitator-level scheduled background job, allowing the Resource Server to remain entirely stateless and fast.

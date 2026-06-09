---
title: Asynchronous Dust Rebates
---

# Extension C: Asynchronous Dust Rebates

**Status:** Draft / Proposal **Date:** March 11, 2026  
**Type:** Optional Opt-in Extension  
**Track Applicability:** `nanoSession` only (dust rebates apply to the tag component in stateful sessions; `nanoSignature` does not use tagged amounts)  
**Base Specification:** `x402_NanoSession_rev7_Protocol.md`

## Abstract

In the core `x402.NanoSession` protocol, the trailing decimals attached to a Nano transaction (the "dust") represent a cryptographically deterministic routing tag rather than profit for the Resource Server.

This extension defines an **opt-in mechanism** whereby a Facilitator formally promises to return (rebate) the dust tag back to the Client after the payment has been validated, maintaining absolute "feeless" economic purity. 

## 1. Architectural Considerations & Trade-offs

Rebating dust is strictly **optional** and is generally discouraged for low-resource or high-throughput generic servers due to the following systemic trade-offs:

1. **PoW Compute Cost:** Returning the dust requires the Facilitator to compute Proof of Work (PoW) on the Nano network. Generating PoW to return `0.000007 XNO` often costs the host more in CPU compute (or external PoW API credits) than the dust is worth. With the core default `tagModulus` of `10_000_000`, a typical tag like `6_284_017` raw is only `6.284017e-24 XNO` (since `1 raw = 1e-30 XNO`). The default tag modulus uses tag values as small as `1e-24 XNO`, which is effectively dust.
2. **Ledger Bloat:** A standard interaction takes 2 blocks (Client Send, Server Receive). Refunding dust doubles this to 4 blocks on the global Nano ledger for fractions of a cent.
3. **Queue Complexity:** Facilitators must ensure asynchronous task idempotency—if the Facilitator crashes while processing a rebate queue, it must not accidentally refund the same dust twice upon rebooting.

However, for premium services or Facilitators intending to perfectly respect Nano's feeless philosophy, this extension provides the standardized flow for rebates.

## 2. Communication Protocol

### 2.1 The 402 Requirements Advertisement

A Resource Server opts into this extension by advertising the promise in the `extra` object of the `PAYMENT-REQUIRED` HTTP 402 response.

```json
{
  "network": "nano:mainnet",
  "amount": "10000000000000000000000000042",
  "payTo": "nano_3merchantserveraddress...",
  "extra": {
    "nanoSession": {
       "id": "a1b2c3d4-e5f6-7890",
       "tag": 42,
       "resourceAmountRaw": "10000000000000000000000000000",
       "tagAmountRaw": "42"
    },
    "dustRebate": true
  }
}
```

The presence of `"dustRebate": true` acts as a formal protocol promise that the Facilitator will asynchronously return exactly `tagAmountRaw` to the sender account.

### 2.2 Client Initiated Return Address (Optional)

By default, the Facilitator MUST return the dust to the `nano_` address that authored the Send block. 

If the Client is paying from an exchange wallet, a shared proxy account, or a rotating mnemonic wallet where they cannot receive incoming transactions, the Client MAY specify a custom return address in the retry request headers:

| Header | Required | Description |
|--------|----------|-------------|
| `X-PAYMENT-REBATE-TO` | Optional | Nano address to receive the dust refund |

## 3. Facilitator Implementation (Normative)

### 3.1 Idempotent Refund Queue

Facilitators implementing Extension C MUST ensure rebates are not duplicated.

Because the tag component (`tagAmountRaw`) is bound to the specific `sessionId` and block hash `ABC123`, the Facilitator can detect redundant rebate attempts by checking its own account history:

```
reboot_rebate_queue_worker():
  for pending_rebate in db.get_pending_rebates():
     // Ensure we haven't already sent exactly this dust back!
     recent_sends = nano_rpc.account_history(server_address, count=100)
     
     already_refunded = recent_sends.some(block => 
        block.type == 'send' && 
        block.amount == pending_rebate.tag_amount &&
        block.link_as_account == pending_rebate.return_address
     )
     
     if already_refunded:
        db.mark_completed(pending_rebate.id)
     else:
        execute_refund(pending_rebate)
```

### 3.2 Time Restrictions

The Facilitator MAY execute the dust rebate asynchronously at its complete convenience (e.g., waiting for low-traffic PoW periods or batching work queue processing). The Client MUST NOT block resource access expecting the rebate to arrive concurrently.

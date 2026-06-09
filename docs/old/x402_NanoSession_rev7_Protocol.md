---
title: Protocol Specification
---

# x402.NanoSession Protocol Specification (Rev 7)

**Status:** Draft / Proposal **Date:** March 7, 2026

## Abstract

x402.NanoSession (Rev 7) is a protocol for high-frequency, machine-to-machine (M2M) payments over HTTP using the Nano (XNO) network. It formalizes two approaches to settlement: **Deterministic Raw Tagging** for stateful, session-bound verification (`nanoSession`), and **URL-Bound Cryptographic Signatures** for lean, stateless verification (`nanoSignature`). Both mechanisms allow a single Nano address to process high volumes of concurrent payments without unique address generation per request.

## 1. x402 Layer Mapping (Rev 7)

To keep terminology consistent with x402 v2 layering:
- **Scheme (payment style):** NanoSession uses `scheme: "exact"`.
- **Mechanisms (transfer/auth implementation):** NanoSession Rev 7 introduces a **Dual-Track** approach:
  1. `nano-exact-broadcast-tag` (Track 1 / Compatibility): Uses a session-bound Nano block-hash proof (`payload.proof` + `extra.nanoSession`).
  2. `nano-exact-broadcast-signature` (Track 2 / Stateless Gold Standard): Uses a cryptographically signed receipt bypassing the session registry (`payload.signature` + `extra.nanoSignature`).
- **Network / Asset baseline:** `network: "nano:mainnet"`, `asset: "XNO"`.

This specification defines the normative wire/security behavior.  
Interoperability migration options and optional future CAIP/SIWx profiles are centralized in [Appendix: Interoperability Matrix](./x402_NanoSession_rev7_Appendix_Interoperability_Matrix.md).

## 2. Security Model

### 2.1. The Receipt-Stealing Attack

Nano's block-lattice is **publicly observable in real-time**. Any observer can see payments as they occur. This creates a fundamental security challenge:

```
1. Resource Server issues payment requirements (via Facilitator) to Client A (tag 42)
2. Resource Server issues payment requirements (via Facilitator) to Client B (tag 77)
3. Client A broadcasts payment (tag 42), block hash = ABC123
4. Attacker observes ABC123 on-chain
5. Attacker submits ABC123 to Resource Server claiming it as proof
6. Facilitator validates: block exists ✓ correct destination ✓ not spent ✓
7. Resource Server grants access to Attacker
8. Client A submits ABC123 — Facilitator rejects as "already spent"
```

**Result:** Client A paid. Attacker received the resource. Client A received nothing.

This attack is analogous to a grocery store where all receipts are printed on a public board. An attacker can grab someone else's receipt and present it to the security guard, who has no way to verify the receipt belongs to the person presenting it.

### 2.2. The Session Binding Invariant

**MANDATORY:** A payment proof MUST be cryptographically bound to the specific client that was issued the payment request.

The Resource Server / Facilitator MUST verify **three conditions** before granting access:

1. Block exists on-chain and is confirmed
2. Block hash is not in the Spent Set (anti-replay)
3. **Block corresponds to requirements issued to THIS client** (session binding)

### 2.3. The Shift to True Statelessness (Track 2)

Earlier revisions concluded that stateless solutions explicitly fail because Nano blocks have no memo field. However, Rev 7 formalizes **Track 2: `nano-exact-broadcast-signature`**, which achieves true statelessness without degrading Nano ledger efficiency.

Instead of maintaining a Facilitator session, the client provides a cryptographic signature binding the Nano block hash to the HTTP request URL. 
To prevent cross-server replay attacks without requiring a shared Redis-style lock between Resource Servers, the Facilitator utilizes the Nano Network itself as the global mutex via a **Settle-Before-Grant** routine (see Section 3.3).

### 2.4. Why EVM-Style "Exact" Authorizations Are Unviable for Nano

The x402 "exact" scheme is intended for one-off payments of a precise amount. However, EVM-based reference implementations of the "exact" scheme typically use **EIP-3009 transfer authorizations** (or Permit2) where the client signs a message binding the payment to a specific request. This works because:

1. EVM transactions can include arbitrary signed data
2. The signature proves the wallet owner authorized *this specific* payment

Nano's architecture prevents this approach:

- **No memo field:** Nano blocks contain only: previous, representative, balance, link (destination), work, signature
- **Signature scope:** The block signature covers block content, not external request context
- **Frontier dependency:** Creating a valid send block requires knowing the account's current frontier (previous block hash), which changes with every transaction — making pre-signed authorizations impractical

The pre-signed authorization approach (as explored in projects like x402nano) encounters these **frontier issues**: a pre-signed block becomes invalid if any other transaction occurs on the account before broadcast.

### 2.5. The Frontier Dilemma (Why Authorizations Must Be Broadcast)
Critics of NanoSession sometimes suggest mimicking Ethereum's EIP-3009 by having the client sign a Nano Send block and pass it directly to the server *without broadcasting it*, allowing the server to asynchronously settle. 
While "delayed settlement" risk exists in both ecosystems, the Nano version—the **Frontier Dilemma**—is mechanically far worse:
- **EVM Nonces:** An unbroadcasted Ethereum authorization (`nonce=123`) remains perfectly valid even if the user subsequently uses their wallet for other transactions (`nonce=124`, `nonce=125`), until the authorization explicitly expires or is deliberately revoked.
- **Nano Frontiers:** Every Nano block mathematically chains to the exact hash of the previous block (the frontier). If a client generates an unbroadcasted block based on `Frontier A`, and then performs **any** other wallet activity (changes representative, receives a pending deposit, or pays a different service), their frontier instantly advances to `Block B`. The server's unbroadcasted block is permanently and irrevocably invalidated by the network.

NanoSession Rev 7 avoids this accidental self-invalidation entirely by mandating that the **client must broadcast the block to the network first** in BOTH tracks. For Track 1, it relies on **Raw Tagging**. For Track 2, it relies on a discrete Ed25519 signature binding the *confirmed receipt* (the block hash) to the request.

## 3. Communication Flow

### 3.1. Overview

> **Deployment Note:** The `Resource Server` and the `Facilitator` are logically separated as distinct roles in this specification, where the Facilitator is an optional but recommended service. However, they may be deployed distinctly (Standalone Facilitator) OR combined into a single running process (Embedded Facilitator).

> **Variant Separation:** A Facilitator supporting both `nanoSession` and `nanoSignature` MUST advertise them as **separate** `PaymentRequirements` objects in the `accepts` array. The `extra.nanoSession` and `extra.nanoSignature` keys are **mutually exclusive** within a single requirement object. This is necessary because the two variants produce different `amount` values: `nanoSession` adds a tag component to the resource price, while `nanoSignature` uses the clean resource price.
```text
┌────────┐          ┌─────────────────┐       ┌─────────────┐        ┌──────────┐
│ Client │          │ Resource Server │       │ Facilitator │        │   Nano   │
└───┬────┘          └────────┬────────┘       └──────┬──────┘        └────┬─────┘
    │  GET /resource         │                       │                    │
    │───────────────────────>│                       │                    │
    │                        │   Init Session        │                    │
    │                        │──────────────────────>│                    │
    │                        │ {reqs w/ nanoSession} │                    │
    │                        │<──────────────────────│                    │
    │ 402 + PAYMENT-REQUIRED │                       │                    │
    │  (incl nanoSession.id) │                       │                    │
    │<───────────────────────│                       │                    │
    │                    Send Block (Broadcast)                           │
    │────────────────────────────────────────────────────────────────────>│
    │  GET /resource         │                       │                    │
    │  + PAYMENT-SIGNATURE   │                       │                    │
    │───────────────────────>│                       │                    │
    │                        │ Verify(hash,          │                    │
    │                        │        nanoSession.id)│                    │
    │                        │──────────────────────>│                    │
    │                        │                       │   Fetch Block      │
    │                        │                       │───────────────────>│
    │                        │                       │   Confirmed?       │
    │                        │                       │<───────────────────│
    │                        │ Verify OK (Set Spent) │                    │
    │                        │<──────────────────────│                    │
    │  200 OK                │                       │                    │
    │<───────────────────────│                       │                    │
```

### 3.2. Track 1 Payment Flow (`nanoSession` — Stateful)

1. Client requests protected resource from the Resource Server.
2. Resource Server requests payment requirements from the Facilitator.
3. Facilitator generates unique session `id` and payment requirements (including `tag`).
4. Facilitator stores mapping: `id → { payTo, amount, resourceAmountRaw, tagAmountRaw, tag, expiresAt }`.
5. Resource Server returns HTTP 402 with requirements including `nanoSession.id`.
6. Client reads the normative send amount: `amount` (exact raw value to send).
7. Client signs and broadcasts Nano send block to the network.
8. Client retries request to Resource Server with `PAYMENT-SIGNATURE` mapping `proof` to the block hash.
9. Resource Server forwards the proof to the Facilitator.
10. Facilitator retrieves stored requirements using session `id`.
11. Facilitator verifies block features and ensures block hash is not in Spent Set.
12. Facilitator adds block hash to Spent Set and deletes the session constraint.
13. Facilitator responds "Valid" to Resource Server.
14. Resource Server grants access to Client.

### 3.3. Track 2 Payment Flow (`nanoSignature` — Stateless, Settle-Before-Grant)

In this Track, the Facilitator serves purely as a stateless verifier and relies on the Nano Ledger as the definitive "Spent Set".

1. Client requests protected resource from the Resource Server.
2. Resource Server returns HTTP 402 containing `extra.nanoSignature`.
3. Client broadcasts a standard Nano send block for the requested amount.
4. Client generates an Ed25519 signature binding the `block_hash` to the `request_url` using their Nano account private key.
5. Client retries request with `PAYMENT-SIGNATURE` containing `proof` (block hash) and `signature`.
6. Resource Server forwards proof+signature to the Facilitator.
7. Facilitator **cryptographically verifies** the Ed25519 signature against the source account of the send block.
8. Facilitator **verifies the send block is confirmed** on-chain.
9. Facilitator **checks that the block is still receivable** (funds have not been pocketed by any receive block). If the block is no longer receivable, it has already been settled and MUST be rejected.
10. *The Atomic Lock*: After the spent set check, the Facilitator generates and broadcasts a `receive` block for the pending hash.
11. If broadcast succeeds (network accepts the receive): Facilitator responds "Valid & Settled" to the Resource Server.
12. Resource Server grants access to Client.

### 3.4. Required Headers (x402 V2 Standard)

NanoSession natively adopts the standard Coinbase x402 V2 API definition for payment negotiations, utilizing Base64-encoded JSON objects passed in standard headers.

#### 402 Response (Server → Client)

**Header:** `PAYMENT-REQUIRED`

Servers MUST return a Base64-encoded `PaymentRequired` JSON object. The `accepts` array can offer Track 1 (via `nanoSession`), Track 2 (via `nanoSignature`), or both simultaneously:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://example.com/api/protected"
  },
  "accepts": [
    {
       "scheme": "exact",
       "network": "nano:mainnet",
       "asset": "XNO",
       "amount": "18000000000000000000000000000",
       "payTo": "nano_123...",
       "maxTimeoutSeconds": 180,
       "extra": {
           "nanoSignature": { }
       }
    },
    {
       "scheme": "exact",
       "network": "nano:mainnet",
       "asset": "XNO",
       "amount": "18007000000000000000000000000",
       "payTo": "nano_123...",
       "maxTimeoutSeconds": 180,
       "extra": {
           "nanoSession": {
               "tag": 1234,
               "id": "uuid-1234",
               "resourceAmountRaw": "10000000000000000000000000000",
               "tagAmountRaw": "8007000000000000000000000000"
           }
       }
    }
  ]
}
```

#### Retry Request (Client → Server)

**Header:** `PAYMENT-SIGNATURE`

Clients MUST retry the HTTP request with a Base64-encoded `PaymentPayload` JSON object asserting the block proof. The `accepted` block must echo back the exact requirement chosen from the Server response.

For Track 1 (`nano-exact-broadcast-tag`), the `payload` requires only the `proof`:
```json
{
  "x402Version": 2,
  "accepted": { /* ... */ },
  "payload": {
     "proof": "64_CHARACTER_HEX_BLOCK_HASH"
  }
}
```

For Track 2 (`nano-exact-broadcast-signature`), the `payload` MUST also include the Ed25519 `signature` binding the hash to the URL:
```json
{
  "x402Version": 2,
  "accepted": { /* ... */ },
  "payload": {
     "proof": "64_CHARACTER_HEX_BLOCK_HASH",
     "signature": "128_CHARACTER_HEX_ED25519_SIGNATURE"
  }
}
```

## 4. Technical Specification

### 4.1. Session ID Requirements

- **Format:** Opaque string, recommended UUID v4 or 128-bit random hex
- **Uniqueness:** MUST be unique per payment request
- **Lifetime:** Valid until expiration or successful settlement
- **Single-use:** MUST be invalidated after successful payment verification
- **Storage:** Facilitator MUST store `nanoSession.id`→requirements mapping

### 4.2. Raw Tagging (Normative)

To distinguish concurrent payments sent to the same address:

1. Facilitator selects a `tag` using any collision-safe strategy (random or deterministic).
2. Facilitator computes a tag amount component: `tagAmountRaw` (implementation-defined).
3. Facilitator computes the normative total: `amount = resourceAmountRaw + tagAmountRaw`.
4. Facilitator includes all three transparency fields in `extra.nanoSession`.
5. Clients MUST send `amount` exactly (clients do not derive totals from parts).
6. Facilitator MUST reject active-session collisions on `(payTo, amount)`.

### 4.3. Spent Set (Normative)

- **Purpose:** Prevent double-spending and replay attacks
- **Key:** Block hash (64-character hex)
- **Persistence:** MUST survive server restarts
- **TTL:** Entries MAY be pruned after reasonable period (e.g., 30 days)

### 4.4. Session Storage (Normative)

Facilitators MUST maintain a mapping of active sessions:

```
sessions[id] = {
  payTo: string,        // Destination address
  amount: string,       // Total required send amount (raw)
  resourceAmountRaw: string, // Underlying resource price (raw)
  tagAmountRaw: string, // Tag component encoded into amount (raw)
  tag: number,          // Generated tag
  expiresAt: string,    // ISO 8601 expiration
  createdAt: string     // For debugging/metrics
}
```

Session entries MUST be:
- Created atomically with tag generation
- Deleted after successful verification OR expiration
- Indexed for O(1) lookup by `id`

## 5. Security Considerations

### 5.1. Receipt-Stealing Prevention

The mandatory session binding prevents the receipt-stealing attack by ensuring:
- Only the client that received a specific session `id` can claim the corresponding payment
- The attacker cannot forge or guess a valid session `id`
- Even if the attacker observes the payment on-chain, they lack the session `id` to claim it

### 5.2. Session id Confidentiality

- Session ids SHOULD be transmitted over HTTPS only
- Session ids SHOULD NOT be logged in plaintext on client systems
- Session ids SHOULD have sufficient entropy (128+ bits)

### 5.3. Timing Considerations

- Sessions SHOULD expire within a reasonable window (default: 300 seconds)
- Expired sessions MUST be rejected even if the payment is valid
- Clock skew between client and server should be accounted for

### 5.4. Spent Set Persistence

- The Spent Set MUST be durable (survive crashes/restarts)
- Loss of Spent Set data enables replay attacks
- Distributed deployments MUST synchronize Spent Set state

## 6. Extensions

### 6.1. NanoSession-Specific Extensions

For high-volume services, privacy-sensitive implementations, or dust lifecycle management:

- **[Extension A: Generational Sharded Pools](x402_NanoSession_rev7_Extension_A_Pools.md)**: Scale to 20-100 addresses
- **[Extension B: Stochastic Rotation](x402_NanoSession_rev7_Extension_B_Stochastic.md)**: Privacy via address rotation
- **[Extension D: Dust Return (Janitor)](x402_NanoSession_rev7_Extension_D_DustReturn.md)**: Formalized sweeping of un-spendable tags

### 6.2. Supported x402 Core Extensions

NanoSession supports the standard x402 `extensions` field on both `PaymentRequired` and `PaymentPayload` objects. The following upstream x402 extensions are compatible and have helper utilities in `@nanosession/core`:

- **`payment-identifier`**: Client-generated idempotency key for HTTP request deduplication. Orthogonal to NanoSession's blockchain-layer anti-replay (spent set, session binding, signature binding). See the [upstream spec](https://docs.x402.org/) for the extension definition.

## 7. Implementation Notes

### 7.1. Minimum Viable Implementation Flow

```
resource_server_on_request(req):
  if req.has_header('PAYMENT-SIGNATURE'):
    payload = parse_base64_json(req.header['PAYMENT-SIGNATURE'])
    verify_resp = facilitator.verify(payload.proof, payload.accepted.extra.nanoSession.id)
    if verify_resp.isValid:
      return 200 "Access granted"
    else:
      return 402 verify_resp.error
  else:
    session = facilitator.create_session(price)
    requirements = build_payment_required_json(session)
    return 402 with PAYMENT-REQUIRED header (base64)

facilatator_verify(block_hash, id):
  session = sessions.get(id)
  if not session:
    return false, "Unknown session"
  if session.expired():
    sessions.delete(id)
    return false, "Session expired"
    
  block = nano_rpc.get_block(block_hash)
  expected_amount = session.amount
    
  if block.destination != session.payTo:
    return false, "Destination mismatch"
  if block.amount != expected_amount:
    return false, "Amount mismatch"
  if spent_set.contains(block.hash):
    return false, "Already spent"
  if not block.confirmed:
    return false, "Not confirmed"
    
  spent_set.add(block.hash)
  sessions.delete(id)
  return true, "Valid"
```

## See Also

- [x402 Standard](https://github.com/coinbase/x402)
- [Nano Documentation](https://docs.nano.org/)
- [Nano Foundation](https://nano.org/)

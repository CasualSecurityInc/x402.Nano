---
title: Protected Content Demo
---

# x402.Nano — Protected Content Demos

**New dedicated flows (recommended):**

- [Track A (nanoTxn) Demo](/demo-track-a) — signed-block path with stable per-invoice deposit
- [Track B (nanoSignature) Demo](/demo-track-b) — NOMS post-payment proof path with stable per-invoice deposit

Both flows give you:
- A unique deposit address that is **stable until you click the big red "Restart session"** button (reloads, network hiccups, Cmd-R all preserve the session = deposit = x402 challenge).
- The original twin-tab layout (Manual/QR + MetaMask/Xnap).
- An educational demonstration of receipt-reuse protection.

---

## Legacy single demo (being phased out)

The content below describes the older undifferentiated flow. Use the two dedicated pages above for accurate Track A / Track B experiences.

## Flow

```
(external wallet app) ← deposit QR ← (demo page JS) ← 402 → (protected demo server)
                                        ⤷ retry with send hash → 200
```

The important sequence is:

1. Your first request for the protected resource returns `402 Payment Required` with a `PAYMENT-REQUIRED` header containing the exact amount and a destination address.
2. The browser shows the challenge details and a QR code encoding `nano:<destination>?amount=<raw>`.
3. Pay the exact amount from any Nano wallet to the displayed destination address.
4. Enter your wallet's `nano_...` address in the demo page so the browser can poll for a matching confirmed send.
5. The demo-only `/api/poll-for-demo` helper looks up recent sends from that account and checks for a match by destination + amount.
6. When a match is found, the browser retries the protected resource request with a `PAYMENT-SIGNATURE` header containing the confirmed send hash.
7. The server verifies the send on-chain (destination and amount), marks the hash as spent to prevent replay, and returns `200 OK` with the exclusive content.

## Demo Notes

- This demo uses a server-chosen `nano_...` destination address as the pay-to target (in production, a NanoNym root `nnym_...` would be used for stealth derivation).
- The `/api/poll-for-demo` endpoint is a demo-only helper. In a production x402 client, the wallet or payment agent would return the send hash directly after publishing the block.
- Settlement policy and access policy are separate concerns. This demo grants per-payment access; a deployment could instead issue a reusable credential after settlement.

## Security

This flow implements the NanoNym receipt exact path (Path B) from the protocol:

- **Pay first**: the client pays before receiving access, avoiding the frontier dilemma of pre-signed blocks.
- **Exact raw amounts**: the challenge amount includes a unique tag to prevent cross-challenge borrowing.
- **Spent-hash tracking**: the server rejects duplicate send hashes, preventing replay across challenges.

This demo does **not** implement NanoNym witness verification (the client would need to derive a stealth destination from a `nnym_...` root and submit witness material in the retry). In production, NanoNym witness material adds receipt-theft resistance by binding the payment to a specific challenge's derivation path.

See the [Protocol Specification](/protocol) for the full wire format and verification rules.

---
title: Track A Demo
---

# Rev 8 Track A (nanoTxn) — Live Demo Checkout

This page demonstrates a **stable per-invoice deposit** checkout flow for **Track A**.

- The server issues a proper Rev 8 `exact` PaymentRequirements with `extra.validBefore`.
- You get a unique deposit address that remains stable across reloads (Cmd-R) until you explicitly click the big red **Restart session** button.
- The twin-tab UI (Manual/QR + Xnap) is preserved exactly as in the previous demo.
- The protocol log shows the x402 dance. In the final implementation the browser will use an ephemeral payer key (LocalStorage) to construct the real signed-block payload for Track A.

<TrackCheckout track="a" />

See the [Track A specification](/extensions/track-a-nanotxn) for the full wire format and verification rules.
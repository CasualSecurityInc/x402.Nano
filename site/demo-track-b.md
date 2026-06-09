---
title: Track B Demo
---

# Rev 8 Track B (nanoSignature) — Live Demo Checkout

This page demonstrates a **stable per-invoice deposit** checkout flow for **Track B**.

- The server issues a proper Rev 8 `exact` PaymentRequirements with `extra.nonce` + `extra.validBefore`.
- The deposit address is stable for the lifetime of the checkout session (reload-safe).
- Use the Manual tab with any external wallet, or the Xnap tab for a more capable wallet integration.
- The big red **Restart session** button at the bottom releases the current deposit and starts fresh.
- The protocol log is intended to show the complete decoded client-side flow (including the NOMS signature when using a key the page controls via LocalStorage or the snap).

<TrackCheckout track="b" />

See the [Track B specification](/extensions/track-b-nanosignature) for the NOMS message construction, verification rules, and receipt-reuse protection details.
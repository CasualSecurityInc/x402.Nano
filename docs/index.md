---
title: Intro
---

# x402.NanoSession (Rev 8) — Intro

x402.NanoSession defines a per-request HTTP 402 payment profile for access to web resources and APIs using Nano (XNO) as the payment rail. It implements `scheme: "exact"` with payments settled instantly and feelessly, eliminating gas calculations and smart-contract overhead.

## Why Nano for x402?

Nano's feeless, sub-second finality makes it a natural fit for per-request micropayments. Unlike EVM-based exact schemes that rely on pre-signed contract calls, Nano's block-lattice design allows direct account-to-account transfers that can be verified on-ledger in real time. This spec provides two concrete mechanisms for binding those payments to HTTP requests, each optimized for different deployment constraints.

## Two Complementary Mechanisms

Rev 8 introduces two mechanism tracks under the same `scheme: "exact"` framework, each optimized for different deployment constraints:

- **Track A — `nanoTxn`** (signed-block): The client constructs and signs a full Nano state send block and passes it to the Facilitator, which validates and broadcasts it via the `process` RPC. Analogous to EVM's exact scheme. Best suited for single-purpose or agent wallets where the sending account's frontier is under programmatic control, as unrelated account activity between block construction and broadcast will invalidate the block.

- **Track B — `nanoSignature`** (post-payment proof): The client submits the Nano transaction on-chain themselves, then proves sender ownership to the Facilitator via a NOMS (ORIS-001) signature over the block hash. The Facilitator is verify-only — it never touches funds, holds keys, or submits anything to the network. Avoids the frontier dilemma entirely and is the recommended path for public-facing resources.

A Facilitator MAY advertise one or both tracks in the `accepts` array of a 402 response, allowing flexibility across different integration scenarios.

Both mechanisms use `network: "nano:mainnet"` per OpenRai ORIS-006.

## Protocol Structure

Both tracks follow the HTTP 402 flow:
1. Client requests a protected resource
2. Server responds with `402 Payment Required` and payment parameters
3. Client sends a Nano block to the specified account
4. Client retries the request with proof of payment
5. Server verifies and grants access

The mechanism track determines what "proof" means and how the Facilitator validates it. Full protocol details and implementation guidance are available in the detailed specification.

## Architecture

The protocol defines three primary actors:

- **Client**: A user agent (browser, CLI, app) that receives 402 challenges, pays on Nano, and retries with proof.
- **Resource Server**: The public HTTP endpoint that issues 402 challenges and serves content. It does not touch the blockchain directly.
- **Facilitator**: A backend service that interfaces with the Nano network — verifying blocks, checking confirmation status, and preventing double-spends. It holds no keys and controls no funds.

These can be deployed as a single monolithic service or as separate components, depending on scale and operational needs.

## Next Steps

- **[Protocol Specification](./protocol.md)**: Shared architecture, threat model, and security analysis.
- **[Track A: nanoTxn](./extensions/track-a-nanotxn.md)**: Signed-block wire format and verification.
- **[Track B: nanoSignature](./extensions/track-b-nanosignature.md)**: NOMS post-payment proof wire format and verification.

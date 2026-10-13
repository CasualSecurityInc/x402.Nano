---
title: Intro
---

# x402.Nano

**Status: Draft specification.** x402.Nano proposes two Nano-specific payment mechanisms for the x402 v2 `exact` payment scheme. `exact` is the x402 payment scheme; `nanoTxn` and `nanoSignature` are proposed mechanisms under that scheme, not alternative schemes.

The `network: "nano:mainnet"` identifier follows [OpenRai Initiative Standard 006, Nano CAIP Identifiers](https://github.com/OpenRai/Standards/blob/main/rfcs/ORIS-006.md), which specifies the CAIP-2 chain ID for Nano mainnet and defines no testnet, beta, devnet, or local chain ID. ORIS-006 is itself an Implementation Draft. Assets are XNO, in raw units.

## Implementation status

The current packages and demo do not implement either proposed track end to end. They contain older and divergent flows. Track B also has unresolved challenge-binding, durable idempotency, and recovery requirements. It must not be treated as production-ready or as a recommended deployment path.

Read the [implementation conformance status](./audits/protocol-consistency-audit.md) before using the draft as an implementation contract.

## Proposed mechanisms

- **Track A — `nanoTxn`**: a client signs a Nano state send block; a facilitator validates and broadcasts it. The payer's account frontier can change before broadcast, so callers need a recovery path for stale blocks.
- **Track B — `nanoSignature`**: a client pays on-chain and presents a signed proof tied to a challenge. The draft describes the proof format, but its security and recovery requirements have not yet been demonstrated in this repository.

## Reading the draft

- [Specification](./protocol.md): shared model, constraints, and security requirements.
- [Track A: nanoTxn](./extensions/track-a-nanotxn.md): signed-block mechanism.
- [Track B: nanoSignature](./extensions/track-b-nanosignature.md): post-payment proof mechanism.
- [Ecosystem](./ecosystem.md): a limited, source-backed comparison.

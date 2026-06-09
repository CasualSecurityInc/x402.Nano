# AGENTS.md for `docs/`

## 📖 Specifications

This directory contains the **Canonical Source of Truth** for the x402.NanoSession protocol. All changes to the protocol must happen here.

**🚨 CRITICAL RULE:** **NEVER modify files under `docs/old/`**. The maintainer will gradually move previous versions of the spec in under there for archival purposes only.

## 📚 Reference Materials

### Upstream x402 Specification (PRIMARY)

**Location**: `docs/references/x402-foundation/` (git submodule)

This is a git submodule tracking `https://github.com/x402-foundation/x402.git` (main branch). It contains the current authoritative upstream x402 specification and reference implementation ecosystem.

**This submodule takes precedence over the old Coinbase reference and the whitepaper** when looking for current x402-spec reference material.

### Legacy x402 Reference

**Location**: `docs/references/coinbase-x402/` (git submodule)

This tracks `https://github.com/coinbase/x402.git` and is retained for historical comparison only. Do not use it as the authority for new upstream proposals.

### Nano CAIP And NOMS Standards

Use `OpenRai/Standards` as the authoritative Nano standards reference:

- **ORIS-001**: Nano Off-chain Message Signing (NOMS)
- **ORIS-006**: Nano CAIP identifiers

For x402/Nano public interoperability, use `network: "nano:mainnet"` per ORIS-006. Do not invent or emit `nano:testnet`, `nano:beta`, `nano:devnet`, or `nano:local` unless a future ORIS document standardizes them.

For Rev 8's `nanoSignature` track, treat OpenRai/Standards ORIS-001 as normative for NOMS. Local x402.NanoSession docs may define x402 binding and deployment policy, but should not fork NOMS encoding or signing semantics.

### Ecosystem References (SECONDARY)

The following repositories provide alternative or complementary implementations of the x402 protocol for the Nano network:

- **`docs/references/facilitator`**: Reference facilitator implementation for Nano (`x402nano/facilitator`).
- **`docs/references/exact`**: Exact payment scheme implementation for Nano (`x402nano/exact`).
- **`docs/references/helper`**: Shared logic and utilities for Nano x402 components (`x402nano/helper`).
- **`docs/references/typescript-common`**: Shared type definitions and schemas (`x402nano/typescript-common`).
- **`docs/references/schemes`**: Registry for x402 payment schemes on Nano (`x402nano/schemes`).
- **`docs/references/x402Nano-API`**: Integrated payment gateway API for AI agents (`isac-0000/x402Nano-API`).
- **`docs/references/xnap`**: MetaMask Snap for Nano supporting x402 payloads (`ObsidiaHQ/xnap`).
- **`docs/references/faremeter`**: Metered billing and sessions implementation (`faremeter/faremeter`).

To initialize after cloning:
```bash
git submodule update --init --recursive
```

To update to latest:
```bash
git submodule update --remote docs/references/x402-foundation
```

### x402 v1 vs v2 Transport Note

When using upstream x402 references, default to **v2 transport semantics**, not the older v1 draft.

- **Use v2 header names for new work:** `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`
- **Treat v1 headers as legacy/migration-only:** `X-PAYMENT`, `X-PAYMENT-RESPONSE`
- **Do not assume v1 body-centric 402s:** in **v2**, machine-readable payment requirements belong in the Base64-encoded `PAYMENT-REQUIRED` header, not the response body
- **Expect `x402Version: 2`** in decoded v2 payloads
- **Use CAIP-2 network identifiers** in v2, not casual names like `base-sepolia`
- **New implementations in this repo should use v2 naming and CAIP-2 identifiers exclusively**, even if upstream libraries still support v1 during transition

Quick mapping:

| Concern | x402 v1 draft | x402 v2 standard |
| --- | --- | --- |
| Payment submission | `X-PAYMENT` | `PAYMENT-SIGNATURE` |
| Payment status | `X-PAYMENT-RESPONSE` | `PAYMENT-RESPONSE` |
| Payment requirements | JSON body on `402` | `PAYMENT-REQUIRED` header |

### 📝 Naming Convention

Files follow a strict pattern to support multiple revisions and automated site generation:

`x402_NanoSession_rev<X>_<Role>.md`

*   **revX**: Revision number (e.g., `rev3`). Allows historical versions to coexist.
*   **Role**:
    *   `Protocol`: The core specification. There is only ONE per revision.
    *   `Extension_<Name>`: Optional extension documents.

### 🔗 Relationships

*   **Protocol**: Defines the base layer (Single Address, HTTP headers).
*   **Extensions**: Modify or extend the base layer (e.g., Sharded Pools, Privacy).
    *   Extensions MUST backlink to the Protocol.
    *   Extensions inherit the base layer unless explicitly overridden.

### 🛠️ Workflow

1.  **Drafting**: Start a new file with `Status: Draft`.
2.  **Review**: Once reviewed, update to `Status: Proposed` or `Accepted`.
3.  **Site Gen**: The build script in `../site/scripts/prepare-rev.js` automatically picks up files matching the `SPEC_REV` environment variable.

### 🔐 Security Review Requirements

**All protocol changes MUST undergo security review.**

The Rev 7 specification includes the formal Security Model for the **Receipt-Stealing Attack** — a vulnerability where attackers could steal payment proofs from the public blockchain.

#### Mandatory Review Checklist

Before finalizing any protocol change:

1. **Read §1 Security Model** in `x402_NanoSession_Rev 7_Protocol.md`
2. **Review the Session Binding Invariant** — sessions are security primitives
3. **Check attack vectors**:
   - Receipt theft (hash from different session)
   - Replay attacks (same hash reused)
   - Session spoofing (forged/guessed sessionId)
   - Timing attacks (race conditions)
4. **Verify attack test coverage** exists in `test/integration/`

#### Why This Matters

NanoSession handles real financial transactions. A security flaw means:
- Users lose money
- Attackers get free access
- Protocol trust is destroyed

**When in doubt, add more session binding, not less.**

# AGENTS.md for `docs/`

## 📖 Specifications

This directory contains the **Canonical Source of Truth** for the x402.Nano specification. All changes to the specification must happen here.

## 📚 Reference Materials

### Upstream x402 Specification (PRIMARY)

**Location**: `docs/references/x402-foundation/` (git submodule)

This is a git submodule tracking `https://github.com/x402-foundation/x402.git` (main branch). It contains the current authoritative upstream x402 specification, SDK implementations, and reference ecosystem.

To initialize after cloning:
```bash
git submodule update --init
```

To update to latest:
```bash
git submodule update --remote docs/references/x402-foundation
```

### Nano CAIP And NOMS Standards

Use `OpenRai/Standards` as the authoritative Nano standards reference:

- **ORIS-001**: Nano Off-chain Message Signing (NOMS)
- **ORIS-006**: Nano CAIP identifiers

For x402/Nano public interoperability, use `network: "nano:mainnet"` per ORIS-006. Do not invent or emit `nano:testnet`, `nano:beta`, `nano:devnet`, or `nano:local` unless a future ORIS document standardizes them.

For the `nanoSignature` track, treat OpenRai/Standards ORIS-001 as normative for NOMS. Local x402.Nano docs may define x402 binding and deployment policy, but should not fork NOMS encoding or signing semantics.

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

Active specification documents use simple flat names:

*   `index.md` — Introduction and overview
*   `protocol.md` — Core specification
*   `track-a-nanotxn.md` — Track A extension
*   `track-b-nanosignature.md` — Track B extension
*   `nano-x402-landscape.md` — Ecosystem landscape

### 🛠️ Workflow

1.  **Drafting**: Start a new file with `Status: Draft`.
2.  **Review**: Once reviewed, update to `Status: Proposed` or `Accepted`.
3.  **Site Gen**: The build script in `../site/scripts/prepare-rev.js` copies docs to the VitePress source directory.

### 🔐 Security Review Requirements

**All specification changes MUST undergo security review.**

The specification includes the formal Security Model for the **Receipt-Stealing Attack** — a vulnerability where attackers could steal payment proofs from the public blockchain.

#### Mandatory Review Checklist

Before finalizing any specification change:

1. **Read §1 Security Model** in `protocol.md`
2. **Review the Session Binding Invariant** — sessions are security primitives
3. **Check attack vectors**:
   - Receipt theft (hash from different session)
   - Replay attacks (same hash reused)
   - Session spoofing (forged/guessed sessionId)
   - Timing attacks (race conditions)
4. **Verify attack test coverage** exists in `test/integration/`

#### Why This Matters

x402.Nano handles real financial transactions. A security flaw means:
- Users lose money
- Attackers get free access
- Protocol trust is destroyed

**When in doubt, add more session binding, not less.**

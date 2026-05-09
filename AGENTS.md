# AGENTS.md

**Project**: x402.NanoSession  
**Generated**: 2026-03-02  
**Goal**: Feeless, instant machine-to-machine payments via HTTP 402 using Nano cryptocurrency

---

## OVERVIEW

TypeScript monorepo implementing the NanoSession protocol — a session-bound payment system for HTTP 402 using Nano cryptocurrency.

**Goals:**
- **x402 Compatible**: Implements the [coinbase/x402](https://docs.x402.org/) specification for HTTP 402 Payment Required flows
- **Direct Integration**: `@nanosession/facilitator` (FacilitatorHandler) and `@nanosession/client` (PaymentHandler) packages for direct use in Node.js applications
- **Faremeter Integration**: `@nanosession/faremeter` plugin for [Faremeter](https://github.com/faremeter/faremeter) middleware (experimental)

**⚠️ Handles real financial transactions — security is mandatory.**

---

## STRUCTURE

```
./
├── packages/          # Library packages (@nanosession/*)
│   ├── core/          # Types, constants, schema mapping
│   ├── rpc/           # Nano RPC client with failover
│   ├── facilitator/   # FacilitatorHandler for servers
│   ├── client/        # PaymentHandler for clients
│   └── faremeter-plugin/  # Faremeter middleware adapter
├── examples/          # Working demos (server, client, faremeter)
├── docs/              # Protocol specs (source of truth)
├── site/              # VitePress docs + live demo server
└── test/integration/  # E2E tests with real Nano mainnet
```

---

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| **Protocol specs** | `docs/x402_NanoSession_rev6_Protocol.md` | Current active revision |
| **Core types** | `packages/core/src/index.ts` | Exports all public types |
| **Server handler** | `packages/facilitator/src/handler.ts` | FacilitatorHandler implementation |
| **Client handler** | `packages/client/src/handler.ts` | PaymentHandler implementation |
| **RPC client** | `packages/rpc/src/client.ts` | NanoRpcClient with failover |
| **Unit tests** | `packages/*/src/__tests__/*.test.ts` | Vitest, per-package |
| **E2E tests** | `test/integration/payment-flow.test.ts` | Real Nano transactions |
| **Faremeter adapter** | `packages/faremeter-plugin/src/` | Middleware bridge |
| **Example server** | `examples/standalone-facilitator/src/index.ts` | Reference implementation |
| **Demo server** | `site/protected-resource-demo-server/` | Live x402 facilitator |

---

## CODE MAP

| Symbol | Type | Package | Location |
|--------|------|---------|----------|
| `NanoSessionFacilitatorHandler` | Class | @nanosession/facilitator | `facilitator/src/handler.ts` |
| `NanoSessionPaymentHandler` | Class | @nanosession/client | `client/src/handler.ts` |
| `NanoRpcClient` | Class | @nanosession/rpc | `rpc/src/client.ts` |
| `SCHEME`, `NETWORK` | Constants | @nanosession/core | `core/src/constants.ts` |
| `PaymentRequirements` | Interface | @nanosession/core | `core/src/types.ts` |
| `createFacilitatorHandler` | Function | @nanosession/faremeter | `faremeter-plugin/src/facilitator.ts` |
| `createPaymentHandler` | Function | @nanosession/faremeter | `faremeter-plugin/src/client.ts` |

---

## X402 TERMINOLOGY (CANONICAL)

Use these terms consistently across code and docs:

1. **Scheme = payment style/semantics**
   - Examples: `exact`, deferred, subscription-like, prepaid.

2. **Mechanism = how funds/proof move for that scheme on a network**
   - Examples: EIP-3009, Permit2, Solana fee-payer flows, Nano block-hash proof with session binding.

3. **NanoSession positioning**
   - NanoSession is an `exact` **mechanism/profile**, not a separate scheme id.

4. **Terminology rule**
   - Do not use "method" when "mechanism" is intended.

### Layers Of x402 (ASCII Reference)

```
+-------------+----------------------------------------------------+----------------------------------------------+
| Concept     | Description                                        | Example                                      |
+-------------+----------------------------------------------------+----------------------------------------------+
| Application | Buyers and sellers exchanging x402 data            | Client pays server for access to content     |
| Declaration | Information representation for an x402 transaction | x402 v1/v2 type specifications               |
| Transport   | How x402 information is exchanged                  | HTTP, MCP, A2A                               |
| Scheme      | Logical payment style                              | exact, upto, deferred                        |
| Network     | Payment ledger                                     | Solana, Base, Polygon, AVAX                 |
| Asset       | Unit of value transferred                          | USDC, USDT, SOL, ETH                        |
| Mechanism   | Transfer/auth implementation for one transaction   | EIP-3009, Permit2, Solana fee payer,        |
|             |                                                    | Nano block-hash proof + session binding      |
+-------------+----------------------------------------------------+----------------------------------------------+
```

---

## CONVENTIONS

**TypeScript:**
- Target: ES2022, Module: NodeNext, `strict: true`
- Use `.js` extension in all imports (ESM requirement)

**Imports:**
```typescript
// 1. Node built-ins
import { randomBytes } from 'crypto';

// 2. External packages
import { z } from 'zod';

// 3. Workspace packages
import { SCHEME } from '@nanosession/core';
import type { PaymentRequirements } from '@nanosession/core';

// 4. Relative imports with .js
import { InMemorySpentSet } from './spent-set.js';
```

**Naming:**
- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Types/Interfaces: `PascalCase`

**Workspace Protocol:**
Internal deps use `workspace:*` in package.json.

---

## ANTI-PATTERNS

**CRITICAL (Security):**

1. **Never skip session binding verification**
   ```typescript
   // WRONG: Only checking block exists
   if (await rpc.blockExists(hash)) { accept(); }
   
   // RIGHT: Verify THIS session's exact expected amount
   const expectedAmount = sessions[sessionId].amount;
   if (blockAmount !== expectedAmount) { reject(); }
   ```

2. **Never omit spent-set checks**
   - Same block hash must be rejected on second attempt
   - Enables replay attacks (double spend)

3. **Never rely on IP addresses or sender addresses for security**
   - NAT, proxies, VPNs make IP unreliable
   - Attacker can intercept and replay

4. **Never commit seeds or private keys**
   - `.env*.example` files show structure but never real values
   - Integration tests use mainnet with real XNO

**Code:**

5. **Don't use implicit any** — `strict: true` is enforced
6. **Don't omit .js extension** in relative imports (ESM requirement)
7. **Don't import without type prefix** when only importing types

---

## SECURITY MODEL

**The Receipt-Stealing Attack (Rev6 Protection):**

Before this protection, attackers could steal payment proofs from the public blockchain and reuse them. NanoSession prevents this via **session binding**:

1. Server generates unique `sessionId` + `tag` for each request
2. Server emits `amount` as the exact send amount and transparency fields (`resourceAmountRaw`, `tagAmountRaw`, `tag`)
3. Server verifies block amount matches the issued session amount before acceptance
4. Server tracks spent block hashes to prevent replay

**Mandatory Security Checklist** (from `AGENTS.md`):
- [ ] Receipt theft: Can attacker use someone else's payment?
- [ ] Replay attack: Can receipt be reused in same session?
- [ ] Session spoofing: Can attacker forge session IDs?
- [ ] Double spend: Can same payment satisfy multiple requests?
- [ ] Timing attack: Is there a race condition window?

**Attack Test Coverage** (in `test/integration/payment-flow.test.ts`):
- ATTACK TEST: Frontrun (receipt stealing)
- ATTACK TEST: Receipt reuse (double spend)
- ATTACK TEST: Session spoofing

---

## PRE-PUSH CHECKLIST

**CRITICAL: Run these before every `git push`:**

- [ ] `pnpm install` - Ensure `pnpm-lock.yaml` is up-to-date (CI uses `--frozen-lockfile`)
- [ ] `pnpm test:run` - All unit tests pass
- [ ] `pnpm typecheck` - No TypeScript errors

**Why this matters:** CI fails if lockfile doesn't match package.json. This happens when:
- Adding/removing packages
- Changing package dependencies
- Adding new workspace packages

---

## COMMANDS

```bash
# Development
pnpm install              # Install all dependencies
pnpm test                 # Unit tests (watch mode)
pnpm test:run             # Unit tests once (CI)
pnpm test:integration     # E2E tests (real Nano mainnet!)
pnpm typecheck            # Type-check without emit

# Build
pnpm build                # Build all packages
pnpm clean                # Remove dist folders

# Docs + Demo
pnpm dev:demo             # Docs + demo servers concurrently
pnpm site:dev             # VitePress dev server (set SPEC_REV=rev6)
pnpm site:build           # Build static site (set SPEC_REV=rev6)

# Single package
cd packages/core
pnpm test                 # Test specific package
```

**Running specific tests:**
```bash
pnpm vitest run packages/core/src/__tests__/mapping.test.ts
pnpm vitest run test/integration/payment-flow.test.ts
```

---

## INTEGRATION TESTS

**⚠️ Uses real XNO on mainnet.**

- The environment variable providing the wallet seed for real mainnet E2E tests must be `NANO_TEST_SEED`.
- It is always declared in 64 hex character secret recovery seed format.

Setup:
```bash
cp .env.example .env
# Edit with your test wallet seed
```

**RPC URL with credentials** (for paid RPC services):
```bash
NANO_RPC_URL=https://rpc.nano.to?key=YOUR-API-KEY
```

The test auto-detects credentials:
- URL has query params → Uses RPC `work_generate`
- URL has no params → Uses local `nanocurrency.computeWork()`

**Multiple endpoints** (failover):
```bash
NANO_RPC_URLS=https://primary.example.com?key=ABC,https://backup.example.com
```

---

## NOTES

- **pnpm required**: Enforced via `packageManager` field
- **ESM only**: Pure ESM project (no CommonJS)
- **Rev6**: Current active protocol revision
- **Session = Security**: Sessions are security primitives, not implementation details
- **Feeless**: Nano has zero transaction fees
- **Sub-second**: Nano confirms in <1 second

---

## SUBDIRECTORY AGENTS.md

| Directory | Purpose |
|-----------|---------|
| [docs/](./docs/AGENTS.md) | Protocol specifications (canonical source) |
| [site/](./site/AGENTS.md) | VitePress docs site + demo server |

# Fill Test Coverage Gaps — Both Tracks

## Problem

`pnpm test:run` shows 101 pass / 35 fail. All 35 failures share one root cause: **`@nanosession/core`'s `index.ts` doesn't export the functions consumers import.** The builders were rewritten to use nanoMacaroon types but never provided a compatibility layer.

Beyond the broken exports, the test survey identified **genuinely untested code paths** that need new tests.

---

## Part A: Fix Broken Exports (prerequisite)

### A.1 Functions that exist in source but aren't exported

| Function | Source file | Callsite from… |
|---|---|---|
| `assertValidRawAmount` | `core/src/utils.ts:26` | `facilitator/src/handler.ts:181` |
| `assertValidPaymentRequirements` | `core/src/utils.ts:36` | `client/src/handler.ts:91`, `facilitator/src/handler.ts:287,314` |
| `calculateTaggedAmount` | `core/src/utils.ts:84` | (implicit in other tests) |

**Fix:** Add `export { assertValidRawAmount, assertValidPaymentRequirements, calculateTaggedAmount } from './utils.js';` to `core/src/index.ts`.

### A.2 Functions that DON'T exist — need compatibility shims

| Old function name (tests import this) | NanoMacaroon equivalent | Parameters differ? |
|---|---|---|
| `createPaymentRequirements(opts)` | `buildPaymentRequired(resourceUrl, challenge, options)` | Completely different API shape |
| `createSignatureRequirements(opts)` | _none_ | No nanoMacaroon equivalent for this |
| `createPaymentPayload(opts)` | `buildPaymentSettlementPayload(requirements, proof)` | Different params |
| `assertValidPaymentPayload(payload)` | _none_ | — |
| `createPaymentRequired(opts)` | `buildPaymentRequired(resourceUrl, challenge, options)` | Different params |

**Fix:** Create `core/src/compat.ts` with thin wrapper functions that accept the old API shapes and delegate to nanoMacaroon builders where possible. These preserve the old parameter names so tests and production code don't need to change.

```typescript
// compat.ts — backward-compatible wrappers
export function createPaymentRequirements(opts: { payTo, maxTimeoutSeconds, id, tag, resourceAmountRaw, tagAmountRaw, amount, expiresAt, scheme?, network?, asset? }) { ... }
export function createSignatureRequirements(opts: { payTo, maxTimeoutSeconds, amount, url, messageToSign?, scheme?, network?, asset? }) { ... }
export function createPaymentPayload(opts: { accepted, proof }) { ... }
export function assertValidPaymentPayload(payload: any) { ... }
```

Then re-export from `core/src/index.ts`.

---

## Part B: New Test Cases (truly untested code)

### B.1 Signing module (`packages/client/src/__tests__/signing.test.ts`)

**`verifyMessage` — no test exists (only `signMessage` is tested)**

```
describe('verifyMessage')
  test('verifies a valid NOMS signature')
    → sign("msg", sk) → verifyMessage("msg", sig, pk) === true
  test('rejects tampered message')
    → sign("msg", sk): verifying against "msg2" returns false
  test('rejects wrong public key')
    → sign with keyA, verify with keyB → false
  test('rejects truncated signature')
    → 64-char hex instead of 128 → false
```

**`deriveKeyPair` — test independently (only tested transitively via `signMessage`)**

```
describe('deriveKeyPair')
  test('produces 32-byte secret key and 32-byte public key')
  test('deterministic for same seed + index')
  test('different seeds produce different keypairs')
  test('different indices produce different keypairs')
```

**`createSendBlock` / `signBlock` — no tests at all**

```
describe('createSendBlock')
  test('returns object with account, previous, representative, balance, link')

describe('signBlock')
  test('produces 128-char hex signature for valid block params')
  test('signature changes when any field changes')
  test('signature changes when balance changes')
```

### B.2 Core builders (`packages/core/src/__tests__/builders.2.test.ts`)

**Builders with ZERO test coverage:**

```
test('buildPaymentAccessPayload wraps access proof')
  → input AccessProof → output has x402Version: 2, payload equals input

test('buildPaymentResponse wraps settlement result')
  → input result + success flag → output has x402Version: 2, result, success

test('buildPaymentResponse sets success=false for failed settlement')

test('encodePaymentResponse round-trips symmetrically')
  → encode → decode → matches original

test('decodePaymentResponse rejects missing x402Version')
  → wrong version returns null

test('decodePaymentResponse rejects missing result.mode')
  → returns null

test('parsePaymentRequired rejects missing resource.url')
  → returns null

test('parsePaymentRequired rejects non-array accepts')
  → returns null

test('parsePaymentPayload rejects missing payload.mode')
  → returns null

test('encodePaymentRequired round-trips with decodePaymentRequired')
  → encode(decode(payload)) identity
```

### B.3 Core utils (`packages/core/src/__tests__/utils.2.test.ts`)

**`deriveAddressFromSeed` — used in production but never tested directly:**

```
test('deriveAddressFromSeed returns nano_ prefixed address')
test('deriveAddressFromSeed with index 0 returns known address for known seed')
test('deriveAddressFromSeed with index 1 returns different address')
test('deriveAddressFromSeed is deterministic')
```

**`assertValidPaymentRequirements` — additional edge cases not tested:**

```
test('rejects both nanoSession AND nanoSignature on same requirements')
test('rejects nanoSession without id field')
test('rejects nanoSession with non-integer tag')
test('rejects nanoSession with negative tag')
test('rejects nanoSession with fraction tag (float)')
test('rejects nanoSignature without url field')
```

### B.4 Facilitator Track B NOMS verification (`packages/facilitator/src/__tests__/handler.test.ts`)

The existing Track B test mocks `verifyBlock` entirely — it never exercises real NOMS verification. New tests:

```
describe('handleVerify — Track B (nanoSignature) with real crypto')
  test('accepts valid NOMS signature')
    → use real NOMS sign/verify, proper blockHash + url message
  test('rejects signature where block hash was tampered')
    → sign over hash1, submit with hash2
  test('rejects signature where URL was tampered')
    → sign over url1, submit with url2
  test('rejects missing signature in payload')
    → payload.proof with no payload.signature
  test('rejects block that is already spent (receivable check fails)')
    → receivableExists returns false
  test('rejects block with wrong destination')
    → blockInfo.link_as_account !== requirements.payTo
  test('rejects block with insufficient amount')
    → blockInfo.amount < requirements.amount
  test('handles signature verification with malformed input')
    → invalid hex signature → returns error, not thrown
```

### B.5 Facilitator `getSignatureRequirements` (`packages/facilitator/src/__tests__/handler.test.ts`)

```
describe('getSignatureRequirements')
  test('returns PaymentRequirements with nanoSignature extra')
  test('returns correct amount, payTo, maxTimeoutSeconds')
  test('sets url in extra.nanoSignature.url')
  test('sets default messageToSign when not provided')
  test('preserves explicit messageToSign when provided')
  test('defaults maxTimeoutSeconds to 600')
```

### B.6 Facilitator `handleSettle — Track B receive block` (new file or existing test)

These test the `settleReceiveBlock` code path (requires seed config):

```
describe('handleSettle — Track B (nanoSignature) with seed')
  test('broadcasts receive block on successful verify + settle')
    → handler with seed, mock RPC → handleSettle → transactionHash received
  test('rejects Track B settle when facilitator has no seed')
    → handler without seed → error 'not configured with seed'
  test('rejects Track B settle when seed address ≠ payTo')
    → seed for different address → error
  test('double settles the same payment hash')
    → first settle succeeds (receive block broadcast), second fails (hash already spent)
```

### B.7 Faremeter plugin Track B (`packages/faremeter-plugin/src/__tests__/adapter.test.ts`)

The adapter currently has ZERO tests for Track B (nanoSignature). The `toNanoRequirements` helper in `facilitator.ts:74` only handles `nanoSession` extra — it silently returns `null` for `nanoSignature` extras. Add:

```
describe('createFacilitatorHandler — Track B (nanoSignature)')
  test('handleVerify works with nanoSignature requirements')
  test('handleSettle works with nanoSignature requirements')
```

### B.8 Track B attack tests (`test/integration/` or facilitator unit tests)

```
describe('ATTACK TEST — Track B (nanoSignature)')
  test('SIGNATURE FORGERY: attacker submits real blockHash with fake signature')
    → server issues Track B challenge with nonce + url
    → attacker pays to correct destination with correct amount
    → attacker submits payment with forged signature
    → handleVerify returns { isValid: false, error: 'Cryptographic signature is invalid' }
  test('URL SUBSTITUTION: attacker signs for url1, submits to url2')
    → signature over (blockHash + url1), verification uses url2
    → handleVerify returns { isValid: false }
  test('REPLAY: same proof+signature reused on different session')
    → first settle succeeds, second handleSettle fails with 'already spent'
  test('EXPIRED PAYMENT: block not confirmed within timeout')
    → getBlockInfo returns not confirmed after retries
    → handleVerify returns { isValid: false, error: 'Block not confirmed' }
```

---

## Execution Order

1. **Create `packages/core/src/compat.ts`** — compatibility wrappers for the old API
2. **Update `packages/core/src/index.ts`** — re-export utils + compat
3. **Run `pnpm test:run`** — verify existing 35 tests now pass
4. **Add tests from Part B** in order: B.1 → B.2 → B.3 → B.4 → B.5 → B.6 → B.7 → B.8
5. **Run `pnpm test:run`** after each batch to verify
6. **Run `pnpm typecheck`** — ensure no new TS errors

## Verification

```bash
pnpm test:run    # all existing + new tests pass
pnpm typecheck   # no TypeScript errors
```

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/compat.ts` | NEW — compatibility wrappers |
| `packages/core/src/index.ts` | Add exports from `utils.js` and `compat.js` |
| `packages/client/src/__tests__/signing.test.ts` | 10+ new tests (B.1) |
| `packages/core/src/__tests__/builders.test.ts` | 12+ new tests (B.2) — or builders.2.test.ts |
| `packages/core/src/__tests__/utils.test.ts` | 10+ new tests (B.3) — or utils.2.test.ts |
| `packages/facilitator/src/__tests__/handler.test.ts` | 15+ new tests (B.4, B.5, B.6, B.8) |
| `packages/faremeter-plugin/src/__tests__/adapter.test.ts` | 2 new tests (B.7) |

## Out of Scope

- Rewriting the nanoMacaroon builders themselves
- Integration tests requiring real XNO on mainnet
- Playwright browser E2E tests
- Changing the production handler code behavior (only adding compat wrappers)

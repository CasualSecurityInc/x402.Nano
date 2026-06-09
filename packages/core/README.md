# @nanosession/core

Shared types, constants, builders, and utilities for the NanoSession x402 protocol.

## Installation

```bash
pnpm add @nanosession/core
```

## Usage

```typescript
import { SCHEME, NETWORK, createPaymentRequirements } from '@nanosession/core';
import type { PaymentRequirements, PaymentPayload } from '@nanosession/core';

const requirements = createPaymentRequirements({
  payTo: 'nano_1abc...',
  amountRaw: '1000000000000000000000000000',
  description: 'Access to protected resource',
});
```

## What's Included

- **Constants**: `SCHEME`, `NETWORK`, `ASSET`, `VERSION`, `TAG_MODULUS`, `TAG_MULTIPLIER`
- **Types**: `PaymentRequirements`, `PaymentPayload`, `NanoSessionExtra`, `NanoSignatureExtra`
- **Builders**: `createPaymentRequirements()`, `createPaymentPayload()`, `createPaymentRequired()`
- **Utilities**: `calculateTaggedAmount()`, `deriveAddressFromSeed()`, `assertValidRawAmount()`
- **Extensions**: `payment-identifier` helpers (see x402 Extensions below)

### x402 Extensions

The `payment-identifier` extension allows servers to attach a stable payment ID to a payment requirements object, enabling idempotent payment tracking across requests.

```typescript
import { declarePaymentIdentifierExtension } from '@nanosession/core';

const ext = declarePaymentIdentifierExtension({ required: true });
```

## Documentation

[Full protocol specification and guides](https://csi.ninzin.net/x402.Nano/)

## License

MIT

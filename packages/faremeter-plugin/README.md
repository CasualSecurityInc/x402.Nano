# @nanosession/faremeter

> Faremeter adapter for NanoSession x402 payments

This package provides adapters that bridge NanoSession's payment handlers to the [Faremeter](https://github.com/faremeter/faremeter) x402 middleware interface.

## Installation

```bash
npm install @nanosession/faremeter
# or
pnpm add @nanosession/faremeter
```

**Peer dependencies:** This package requires `@nanosession/core`, `@nanosession/facilitator`, `@nanosession/client`, and `@nanosession/rpc` to be installed.

## Usage

### Server-Side: FacilitatorHandler

The `createFacilitatorHandler` function creates a Faremeter-compatible `FacilitatorHandler` that verifies and settles NanoSession payments.

```typescript
import { createFacilitatorHandler } from '@nanosession/faremeter';
import { NanoRpcClient } from '@nanosession/rpc';

const rpcClient = new NanoRpcClient({ endpoints: ['https://rpc.nano.to'] });

const facilitatorHandler = createFacilitatorHandler({
  rpcClient,
  payTo: 'nano_your_receiving_address',
  defaultResourceAmountRaw: '1000000000000000000000000', // 0.001 XNO in raw
  maxTimeoutSeconds: 300,
});

// Use with Faremeter middleware:
// app.use(faremeter({ facilitatorHandler }));
```

#### FacilitatorHandler Methods

| Method | Description |
|--------|-------------|
| `getSupported()` | Returns supported payment schemes (nano-session on nano:mainnet) |
| `getRequirements(accepts)` | Enriches payment requirements with session ID and tag |
| `handleVerify(req, payment)` | Verifies a payment without marking as spent |
| `handleSettle(req, payment)` | Verifies and settles a payment (marks as spent) |

### Client-Side: PaymentHandler

The `createPaymentHandler` function creates a Faremeter-compatible `PaymentHandler` that creates and broadcasts Nano payments.

```typescript
import { createPaymentHandler } from '@nanosession/faremeter';
import { NanoRpcClient } from '@nanosession/rpc';

const rpcClient = new NanoRpcClient({ endpoints: ['https://rpc.nano.to'] });

const paymentHandler = createPaymentHandler({
  rpcClient,
  seed: process.env.NANO_WALLET_SEED!, // 64-char hex seed
  maxSpend: '100000000000000000000000000', // Optional: max spend limit per request
});

// Use with Faremeter client:
// const client = createClient({ paymentHandler });
```

## Security Model

NanoSession uses **session-bound payments** to prevent receipt theft attacks:

1. Each payment request includes a unique `sessionId` and `tag`
2. Requirements expose a normative send amount: `amount` (exact raw to send)
3. Transparent fields in `extra.nanoSession` include `resourceAmountRaw`, `tagAmountRaw`, and `tag`
4. Server verifies the block against the issued session requirements before accepting payment

This prevents attackers from stealing payment proofs (block hashes) and reusing them for different sessions.

**Critical**: The server MUST maintain a spent set to prevent replay attacks. See [PRODUCTION.md](./PRODUCTION.md) for production deployment requirements.

## x402 Extensions

NanoSession supports x402 protocol extensions via the `extensions` field on `PaymentRequired` and `PaymentPayload`. The `@nanosession/core` package provides helpers for the upstream [`payment-identifier`](https://docs.x402.org/) extension, which enables client-generated idempotency keys for request deduplication.

```typescript
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  extractPaymentIdentifier,
  validatePaymentIdentifierRequirement,
  isPaymentIdentifierRequired,
} from '@nanosession/core';

// In your server: advertise support in the 402 response extensions
const extensions = {
  [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension() // required: false by default
};

// In your settle/verify handler: extract the client's idempotency key
const id = extractPaymentIdentifier(paymentPayload);
if (id) {
  const cached = await idempotencyStore.get(id);
  if (cached) return cached; // Return cached response on retry
}
```

This extension is orthogonal to NanoSession's session binding and spent set — it provides HTTP-layer retry deduplication, not blockchain-layer anti-replay.

## API Reference

### `createFacilitatorHandler(options: FacilitatorOptions)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `rpcClient` | `NanoRpcClient` | Yes | Nano RPC client instance |
| `payTo` | `string` | Yes | Receiving Nano address |
| `defaultResourceAmountRaw` | `string` | No | Default resource amount in raw (before tag amount) |
| `maxTimeoutSeconds` | `number` | No | Session timeout (default: 300) |
| `spentSet` | `SpentSetStorage` | No | Custom spent set storage |

### `createPaymentHandler(options: PaymentHandlerOptions)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `rpcClient` | `NanoRpcClient` | Yes | Nano RPC client instance |
| `seed` | `string` | Yes | 64-character hex wallet seed |
| `maxSpend` | `string` | No | Maximum spend per request in raw |

## Example

See [`examples/faremeter-server/`](../../examples/faremeter-server/) for a complete working example with:
- Express server using Faremeter middleware
- NanoSession facilitator service
- 402 Payment Required flow

## Documentation

Full protocol specification and guides: <https://csi.ninzin.net/x402.Nano/>

## License

MIT

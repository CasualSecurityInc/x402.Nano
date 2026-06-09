# @nanosession/client

Client-side payment handler for x402 NanoSession — creates and broadcasts Nano payments to satisfy HTTP 402 requirements.

## Installation

```bash
pnpm add @nanosession/client
```

Peer dependencies: `@nanosession/core`, `@nanosession/rpc`

## Usage

```typescript
import { NanoSessionPaymentHandler } from '@nanosession/client';
import { NanoRpcClient } from '@nanosession/rpc';

const rpcClient = new NanoRpcClient({ endpoints: ['https://rpc.nano.to'] });

const paymentHandler = new NanoSessionPaymentHandler({
  rpcClient,
  seed: process.env.NANO_SEED!,
  accountIndex: 0,
});

// Create a payment payload from server-issued requirements
const payload = await paymentHandler.createPayment(paymentRequirements);
```

## API

### `NanoSessionPaymentHandler`

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rpcClient` | `NanoRpcClient` | (required) | Nano RPC client for broadcasting blocks |
| `seed` | `string` | (required) | 64-character hex seed for the paying account |
| `accountIndex` | `number` | `0` | BIP44-style account index derived from seed |

#### Methods

- `createPayment(requirements: PaymentRequirements): Promise<PaymentPayload>` — Creates and broadcasts a Nano send block, returns a `PaymentPayload`
- `supports(requirements: PaymentRequirements): boolean` — Returns whether this handler can satisfy given requirements

## Documentation

Full protocol documentation: [https://csi.ninzin.net/x402.Nano/](https://csi.ninzin.net/x402.Nano/)

## License

MIT

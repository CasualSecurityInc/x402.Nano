# @nanosession/x402

This package provides the official adapter between the [NanoSession](../../docs/protocol.md) protocol and the Coinbase [x402](https://github.com/coinbase/x402) ecosystem.

It implements the core `SchemeNetworkServer`, `SchemeNetworkFacilitator`, and `SchemeNetworkClient` interfaces required by `@x402/core` and `@x402/next`, allowing you to use Nano (XNO) seamlessly within standard x402 middlewares.

## Why this package?

The core NanoSession packages (`@nanosession/client`, `@nanosession/facilitator`) are built to be standalone, lightweight, and completely free of external x402 abstractions. They handle the raw mechanics of Nano block tracking, spent sets, and cryptography.

`@nanosession/x402` exists to bridge those core primitives into the polymorphic world of the official `x402` libraries.

If you are building a native Nano application and only care about Nano, use `@nanosession/client` and `@nanosession/facilitator` directly.

If you are building a generic Web3 application using `@x402/next` or `@x402/express` that accepts USDC on Base, SOL on Solana, *and* XNO on Nano simultaneously, use this package to plug NanoSession into that ecosystem.

## Installation

```bash
npm install @nanosession/x402
```

## Usage

### Server / Middleware Implementation
Use `ExactNanoScheme` to register Nano's parsing capabilities with your x402 Server setup.

```typescript
import { ExactNanoScheme } from '@nanosession/x402/server';

const nanoScheme = new ExactNanoScheme();

// Register with your `@x402/next` or `@x402/express` config...
```

### Facilitator Implementation
Wrap the native NanoSessionFacilitatorHandler using `ExactNanoFacilitator`.

```typescript
import { ExactNanoFacilitator } from '@nanosession/x402/facilitator';
import { NanoRpcClient } from '@nanosession/rpc';

const rpcClient = new NanoRpcClient({ endpoints: ['https://rpc.nano.to'] });

const nanoFacilitator = new ExactNanoFacilitator({
  rpcClient
});

// Pass to your `@x402/core` Facilitator registry
```

### Client Implementation
Wrap the native NanoSessionPaymentHandler using `ExactNanoClient`.

```typescript
import { ExactNanoClient } from '@nanosession/x402/client';
import { NanoRpcClient } from '@nanosession/rpc';

const rpcClient = new NanoRpcClient({ endpoints: ['https://rpc.nano.to'] });

const nanoClient = new ExactNanoClient({
  rpcClient,
  seed: process.env.NANO_SEED
});

// Pass to your `@x402/core` Client registry
```

## Architecture

This adapter handles key translation duties:
1. **Price Parsing:** Converts decimal USD/FIAT values into appropriate Nano raw amounts (30 decimals) via `ExactNanoScheme`.
2. **Type Wrapping:** Translates the generic `PaymentRequirements` and `PaymentPayload` objects from `@x402/core` into the specific `NanoSession` formats required by the core protocol logic.
3. **Execution Mapping:** Proxies the `verify`, `settle`, and `createPaymentPayload` lifecycle methods down to the native `NanoSessionFacilitatorHandler` and `NanoSessionPaymentHandler`.

## x402 Extensions

The adapter passes `extensions` through to the underlying NanoSession handlers without modification. This means x402 core extensions like [`payment-identifier`](https://docs.x402.org/) (idempotency keys) work transparently when used with this adapter.

`@nanosession/core` provides utility helpers for declaring, appending, and extracting payment identifiers — see the [root README](../../README.md#x402-extensions) for usage.

## Documentation

Full protocol specification and guides: <https://csi.ninzin.net/x402.Nano/>

## License

MIT

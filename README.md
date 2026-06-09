# x402.NanoSession

> **Feeless, instant machine-to-machine payments via HTTP 402**

Implement the [HTTP 402](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402) status code using [Nano](https://nano.org/) (XNO) cryptocurrency. Zero fees. Sub-second settlement. High-frequency M2M payments.

This repository contains the **x402-style HTTP binding** for the `nanoMacaroon` mechanism plus a protected-resource demo and supporting site/docs.

## Why Nano for x402?

- **Feeless**: Nano has no transaction fees — pay exactly what you owe
- **Instant**: Sub-second confirmation, no block wait times
- **Protocol-Bound**: Payment settlement is bound to an issued challenge and redeemed into a reusable capability
- **Simple**: `PAYMENT-REQUIRED` -> pay -> `PAYMENT-SIGNATURE` retry -> `PAYMENT-RESPONSE`

The active direction in this repository is a single-track x402 binding built on top of `nanoMacaroon`. Older `nanoSession` / `nanoSignature` material should be treated as legacy or archival context, not the current protocol direction.

## Repository Layout

```
x402.NanoSession/
├── packages/                   # TypeScript libraries (@nanosession/*)
│   ├── core/                   # Types, constants, schema mapping
│   ├── rpc/                    # Nano RPC client with endpoint failover
│   ├── facilitator/            # NanoSessionFacilitatorHandler
│   ├── client/                 # NanoSessionPaymentHandler
│   └── faremeter-plugin/       # Faremeter adapter (@nanosession/faremeter)
├── examples/                   # Working demos (server, client, faremeter)
│   ├── standalone-facilitator/ # Reference standalone facilitator server
│   ├── client/                 # Reference paying client
│   └── faremeter-server/       # Express + Faremeter integration example
├── docs/                       # Active protocol docs (source of truth)
├── site/                       # VitePress docs + protected-resource demo server
└── test/integration/           # E2E tests with real Nano mainnet transactions
```

## Quick Start

This is a **pnpm monorepo**. All projects share dependencies installed at the root.

### Initial Setup (Required Once)

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Install all dependencies for all projects
pnpm install
```

### Documentation Site

Generate and preview the protocol specification website:

```bash
cd site
pnpm site:build    # Build static site from docs/
pnpm site:preview  # Preview at localhost:4173
```

For development with hot reload:
```bash
cd site
pnpm site:dev      # Dev server at localhost:5173
```

### Protected Resource Demo

Run the docs site and protected-resource demo:

```bash
cd site
pnpm dev:demo
```

Then open the protected demo page and inspect the browser Network panel to see the flow:

1. initial protected resource request returns `402` with `PAYMENT-REQUIRED`
2. the demo server allocates a per-challenge destination from a bounded derived address pool when `NANO_TEST_SEED` is configured, otherwise it falls back to `NANO_SERVER_ADDRESS`
3. browser polls for a matching send from a user-supplied payer account
3. browser retries the protected resource request with `PAYMENT-SIGNATURE`
4. server returns `200` with `PAYMENT-RESPONSE`

### Faremeter Integration

For projects using [Faremeter](https://github.com/faremeter/faremeter) x402 middleware:

```bash
# Terminal 1: Start the facilitator service
cd examples/faremeter-server
NANO_SERVER_ADDRESS=nano_your_address pnpm start:facilitator

# Terminal 2: Start the Express server with Faremeter middleware
cd examples/faremeter-server
pnpm start

# Terminal 3: Test the 402 response
curl -i http://localhost:3000/api/resource
```

See [packages/faremeter-plugin/README.md](./packages/faremeter-plugin/README.md) for API documentation.

### Library Packages

Build and test the `@nanosession/*` packages:

```bash
# From repository root:
pnpm build          # Build all packages
pnpm test           # Run unit tests (watch mode)
pnpm test:run       # Run unit tests once
```

### E2E Integration Tests

Run real Nano transactions on mainnet:

```bash
# Setup (once)
cp .env.example .env
# Edit .env with your test wallet seed

# Run integration tests
pnpm test:integration
```

⚠️ Uses real XNO (tiny amounts). See [test/integration/README.md](./test/integration/README.md).

## Documentation

| Resource | Description |
|----------|-------------|
| **[Protocol Spec](./docs/protocol.md)** | Active x402 binding spec for `nanoMacaroon` |
| **[Examples](./examples/)** | Working server and client with step-by-step instructions |
| **[Integration Tests](./test/integration/)** | Real Nano transactions on mainnet |

The documentation website is built from `docs/` and deployed automatically.

## Packages

| Package | Description |
|---------|-------------|
| `@nanosession/core` | Types, constants, and schema mapping |
| `@nanosession/rpc` | Nano RPC client with endpoint failover |
| `@nanosession/facilitator` | `NanoSessionFacilitatorHandler` for servers |
| `@nanosession/client` | `NanoSessionPaymentHandler` for clients |
| `@nanosession/faremeter` | [Faremeter](https://github.com/faremeter/faremeter) x402 middleware adapter |

All packages are published under the `@nanosession` scope.

### x402 Extensions

`@nanosession/core` includes utility helpers for the upstream x402 [`payment-identifier`](https://docs.x402.org/) extension, which provides client-generated idempotency keys for deduplicating payment requests. This is orthogonal to NanoSession's built-in anti-replay mechanisms (spent set, session binding, signature binding) and operates at the HTTP request layer only.

```typescript
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  appendPaymentIdentifierToExtensions,
  extractPaymentIdentifier,
} from '@nanosession/core';

// Server: advertise support in 402 response
const extensions = { [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension() };

// Client: attach idempotency key before sending payment
appendPaymentIdentifierToExtensions(extensions);

// Server: extract key for deduplication
const id = extractPaymentIdentifier(paymentPayload);
```

## Contributing

Contributions welcome. This implementation is designed to integrate with [x402](https://github.com/coinbase/x402) ecosystem tooling.

## License

MIT

## Acknowledgments

- [x402](https://github.com/coinbase/x402) — The payment-required standard
- [Nano](https://nano.org/) — Feeless, instant cryptocurrency

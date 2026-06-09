# @nanosession/facilitator

Server-side facilitator handler for x402 NanoSession — verifies and settles Nano payments for HTTP 402 flows.

## Installation

```bash
pnpm add @nanosession/facilitator
```

Peer dependencies: `@nanosession/core`, `@nanosession/rpc`

## Usage

```typescript
import { NanoSessionFacilitatorHandler } from '@nanosession/facilitator';
import { NanoRpcClient } from '@nanosession/rpc';

const rpcClient = new NanoRpcClient({ endpoints: ['https://rpc.nano.to'] });

const facilitator = new NanoSessionFacilitatorHandler({
  rpcClient,
  payTo: 'nano_3your_receiving_address...',
  resourceAmountRaw: '1000000000000000000000000', // 0.001 XNO
});

// Issue payment requirements for a 402 response
const requirements = await facilitator.createRequirements();

// Verify and settle an incoming payment
const result = await facilitator.settle(paymentPayload);
```

## API

### `NanoSessionFacilitatorHandler`

#### Methods

- `createRequirements()` — Generates session-bound payment requirements to include in a 402 response
- `verify(payload)` — Verifies a payment without marking the block hash as spent
- `settle(payload)` — Verifies and settles a payment (marks block hash as spent, preventing reuse)

## Security

NanoSessionFacilitatorHandler uses **session binding** to prevent receipt-stealing attacks — each set of payment requirements includes a unique session ID and tag amount that the client must encode into the Nano send block. An internal **spent set** ensures every block hash can only be accepted once, eliminating replay and double-spend attacks.

## Documentation

Full protocol specification and guides: <https://csi.ninzin.net/x402.Nano/>

## License

MIT

# @nanosession/rpc

Nano RPC client with multi-endpoint failover and exponential backoff retry.

## Installation

```bash
pnpm add @nanosession/rpc
```

## Usage

```typescript
import { NanoRpcClient } from '@nanosession/rpc';

const client = new NanoRpcClient({
  endpoints: ['https://rpc.nano.to'],
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 30000
});

// Get block info
const blockInfo = await client.getBlockInfo('BLOCK_HASH');

// Get account info
const accountInfo = await client.getAccountInfo('nano_address');

// Generate proof-of-work
const work = await client.generateWork('FRONTIER_HASH');
```

## URL Query Parameter Convention

RPC endpoint URLs support query parameters that are **automatically merged into each RPC request body**. This enables API key authentication for paid RPC services:

```typescript
// API key is extracted from URL and merged into every RPC body
const client = new NanoRpcClient({
  endpoints: ['https://rpc.nano.to?key=YOUR_API_KEY']
});

// The request body will include: { action: "block_info", key: "YOUR_API_KEY", ... }
const info = await client.getBlockInfo('HASH');
```

### Multiple Parameters

All query parameters are extracted and merged:

```typescript
const client = new NanoRpcClient({
  endpoints: ['https://rpc.example.com?key=ABC&token=XYZ']
});
// Every request body includes: { ..., key: "ABC", token: "XYZ" }
```

### Failover with Different Credentials

Each endpoint can have its own credentials:

```typescript
const client = new NanoRpcClient({
  endpoints: [
    'https://primary.example.com?key=PRIMARY_KEY',
    'https://backup.example.com?key=BACKUP_KEY'
  ]
});
```

## API

### `NanoRpcClient`

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoints` | `string[]` | (required) | RPC endpoint URLs (query params extracted and merged into body) |
| `maxRetries` | `number` | `3` | Maximum retries per endpoint |
| `retryDelayMs` | `number` | `1000` | Initial retry delay (doubles each retry) |
| `timeoutMs` | `number` | `30000` | Request timeout in milliseconds |

#### Methods

- `getBlockInfo(hash: string): Promise<BlockInfo>` - Get block information by hash
- `receivableExists(hash: string): Promise<boolean>` - Check if a send block is still receivable
- `confirmBlock(hash: string): Promise<void>` - Trigger election for a block
- `getAccountInfo(address: string): Promise<AccountInfo>` - Get account information
- `getAccountHistory(account: string, count?: number): Promise<AccountHistoryEntry[]>` - Get transaction history
- `processBlock(block: Record<string, unknown>): Promise<string>` - Broadcast a signed block
- `generateWork(hash: string, difficulty?: string): Promise<string>` - Request PoW generation
- `getActiveDifficulty(): Promise<string \| undefined>` - Get current network difficulty

## Documentation

Full protocol specification and guides: <https://csi.ninzin.net/x402.Nano/>

## License

MIT

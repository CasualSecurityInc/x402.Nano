# @nanosession/facilitator-service

Standalone Express-based facilitator service for x402 NanoSession — a deployable server that verifies and settles Nano payments.

## Installation

```bash
pnpm add @nanosession/facilitator-service
```

## Usage

```bash
# Configure via environment variables
export NANO_RPC_URL=https://rpc.nano.to
export NANO_SEED=your_64_char_hex_seed
export PORT=4000

# Start the service
npx @nanosession/facilitator-service
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/supported` | Returns supported payment schemes |
| `POST` | `/verify` | Verifies a payment payload |
| `POST` | `/settle` | Verifies and settles a payment |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NANO_RPC_URL` | Nano node RPC URL | `https://rpc.nano.to` |
| `NANO_SEED` | 64-char hex wallet seed (optional, for receive mode) | — |
| `NANO_ACCOUNT_INDEX` | HD account index | `0` |
| `PORT` | Server port | `4000` |
| `CORS_ORIGIN` | CORS origin | `*` |

## Documentation

[https://csi.ninzin.net/x402.Nano/](https://csi.ninzin.net/x402.Nano/)

## License

MIT

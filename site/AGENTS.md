# AGENTS.md for `site/`

---

## 🛠️ Environment & Node.js

- **Node.js**: Always use the default system Node version (**v25.7.0+**).
- **nvm**: Do **NOT** use `nvm` commands (`nvm use`, `nvm ls`, etc.) in this project.
- **Package Manager**: Always use `pnpm` (v10+).

---

## 🌐 Documentation Website

This directory contains the VitePress project for the x402.Nano documentation.

---

## 🚀 Deployment Architecture

**Two separate deployment targets:**

| Component | Platform | URL | Workflow |
|-----------|----------|-----|----------|
| **Static Docs** | GitHub Pages | `https://csi.ninzin.net/x402.Nano/` | `.github/workflows/deploy.yml` |
| **Demo Server(s)** | fly.io | Separate subdomain(s) | Manual / `pnpm deploy:fly:*` |

**Important:** The Protected Resource demo server(s) deploy to an **external hosting platform (fly.io)** and must be treated separately from the docs site. The static docs are served from GitHub Pages (CasualSecurityInc org) behind a CloudFlare proxy.

---

### 🏗️ Build System (`scripts/prepare-rev.js`)

We do **not** edit markdown files in `site/gen/docs/` directly. Instead, we generate them from `../docs/` at build time.

**The Script Logic:**
1.  **Cleans**: Deletes `site/gen/docs/`.
2.  **Copies**:
    *   `../docs/index.md` -> `site/gen/docs/index.md`
    *   `../docs/protocol.md` -> `site/gen/docs/protocol.md`
    *   `../docs/track-a-nanotxn.md` -> `site/gen/docs/extensions/track-a-nanotxn.md`
    *   `../docs/track-b-nanosignature.md` -> `site/gen/docs/extensions/track-b-nanosignature.md`
3.  **Copies Demo Pages**: `protected.md`, `demo-track-a.md`, `demo-track-b.md`

**⚠️ AGENT POLICY**
1. **Hardcoded Protocol References**: The build script does not perform magic string replacement for document bodies. You must manually grep and update any hardcoded string matches (e.g. `using the x402.Nano protocol flow`) across `site/*.md` whenever you change the protocol.
2. **No NVM**: Never attempt to change Node versions using `nvm`. Stick to the system default node.
3. **Calculation Logic**: Always use the `@nanosession/core` utility `calculateTaggedAmount` for anything involving payment amounts. Never calculate BigInt sums for payment decomposition (`resourceAmountRaw + tagAmountRaw`) manually in UI or server code.

### 🎨 Theme & Config

*   **Config**: `.vitepress/config.mts`
    *   Defines the Sidebar and Nav menu.
    *   **CRITICAL**: The paths in `config.mts` MUST match the generated paths from `prepare-rev.js`.
*   **Theme**: `.vitepress/theme/`
    *   Custom CSS (`custom.css`) for "Modern, Serious, Responsive" look.
    *   **Paywall Components**: Contains `NanoPaywall.vue` and composables (`usePaymentStatus.ts`, `useXnapSnap.ts`) for the live 402 demo.

### 🚀 Demo Server (Protected Resource Facilitator)

**Location**: `site/protected-resource-demo-server/`

The demo server is a live backend Node.js server that acts as an x402 Facilitator. It runs concurrently with VitePress in dev mode via `pnpm run dev:demo`.

**Deployment**: Fly.io (separate from docs site)
- Mainnet: `pnpm deploy:fly:mainnet`

**Core Mechanics:**
1. **Requirements Generation**: `routes/protected.ts` receives client requests, generates a cryptographically secure `sessionId` + `tag` via `@nanosession/facilitator`, and returns the `HTTP 402 Payment Required` payload.
2. **Demo Destination Allocation**: `protected-resource-demo-server/destination-pool.ts` can derive a bounded low-index pay-to address pool from `NANO_TEST_SEED` for per-challenge demo destinations. If no test seed is configured, the demo falls back to `NANO_SERVER_ADDRESS`.
3. **Polling Helper**: `routes/poll.ts` lets the browser demo look up a matching send by `payerAccount + payTo + amount` after an external wallet payment.

**Configuration (`.env`):**

To run the server, `site/.env` MUST be configured (see `site/.env.example`):
- `NANO_RPC_URL` (for REST verification)
- `NANO_SERVER_ADDRESS` (fixed fallback demo destination if no test seed is configured)
- `NANO_TEST_SEED` (preferred for deriving a bounded per-challenge demo destination pool)

### 🖥️ Local Development with tmux

**Always use tmux to run the demo servers** for persistent, detachable sessions.

```bash
# Create a new tmux session named "demo" and start servers
tmux new -s demo
cd /Users/conny/Developer/CasualSecurityInc/x402.NanoSession/site
pnpm dev:demo

# Detach: Ctrl+B then D
# Reattach: tmux attach -t demo
# Kill session: tmux kill-session -t demo
```

**Commands:**
| Command | Purpose |
|---------|---------|
| `pnpm dev:demo` | All: site watcher + VitePress (5173) + demo server (3001) |
| `pnpm site:dev` | Site only: source watcher + VitePress (5173) |
| `pnpm site:build` | Build static site |
| `pnpm demo:mainnet` | Demo server only: mainnet (3001) |

**Note:** `site:dev` watches `../docs/*.md` and `protected.md` for changes and rebuilds automatically.

**Restarting servers in tmux:**
```bash
tmux send-keys -t demo C-c          # Stop current process
tmux send-keys -t demo 'pnpm dev:demo' Enter  # Start servers
```

### 🐛 Known Issues / Debugging

*   **404 Errors**: If the site returns 404s, it usually means `prepare-rev.js` failed to generate files OR the `config.mts` paths don't match the generated filenames.
*   **Dead Links**: VitePress build will FAIL if there are broken internal links.
    *   *Fix*: Ensure `prepare-rev.js` correctly rewrites links from the source Markdown to the new web paths.
*   **EADDRINUSE (Port 3001)**: If `pnpm run dev:demo` fails saying port 3001 is in use, an old `tsx demo-server/index.ts` process is still running. Use `killall -9 node tsx` to free the port.
*   **Wallet Precision Truncation Bug (Nault)**: The Nault consumer wallet currently has a bug where it truncates outgoing fractions to 6 decimal places, destroying the required x402.Nano dust tag and causing payments to be ignored by the WebSocket. Test using Natrium, the Xnap plugin, or `scripts/test-payment.ts`.

# AGENTS.md for `site/`

Scope: this file describes **how the site is built, published, and previewed**. It
deliberately does not restate the payment mechanism, verification rules, or
expiry semantics. Those live in `../docs/` and are owned by
[`docs/AGENTS.md`](../docs/AGENTS.md). If you need a spec fact, read it there
rather than adding a second copy here.

---

## 🛠️ Environment & Tooling

- **Node.js**: use the system default `node`. Do **not** run `nvm use`, `nvm ls`,
  or any other `nvm` command in this project. CI pins `24.x`; local versions may
  be newer. `engines` requires `>=18`.
- **Package Manager**: `pnpm`. The pinned version is in the root `package.json`
  `packageManager` field — let pnpm enforce it, do not install a global pnpm.
- **Install**: always `pnpm install --frozen-lockfile`. CI fails on a lockfile that
  does not match `package.json`.

---

## 🌐 What This Directory Is

`site/` holds the VitePress project plus the live demo facilitator server. The
canonical documents are **not** here — they are in `../docs/`. This directory only
copies, renders, and serves them.

---

## 🏗️ Documentation Pipeline

```
../docs/*.md  ──►  scripts/prepare-rev.js  ──►  gen/docs/  ──►  VitePress  ──►  gen/dist/
   (source)            (copy + rename)          (generated)                  (output)
```

**Never edit `gen/`.** It is deleted and regenerated on every build. Edit the
source under `../docs/`, then rebuild.

### Current copy map

`scripts/prepare-rev.js` performs these copies. This list is the authority — if
it drifts, the build will 404.

| Source | Destination |
|---|---|
| `../docs/index.md` | `index.md` |
| `../docs/protocol.md` | `protocol.md` |
| `../docs/execution-model.md` | `execution-model.md` |
| `../docs/nano-x402-review.md` | `review.md` |
| `../docs/nano-x402-landscape.md` | `ecosystem.md` |
| `../docs/audits/protocol-consistency-audit.md` | `audits/protocol-consistency-audit.md` |
| `../docs/track-a-nanotxn.md` | `extensions/track-a-nanotxn.md` |
| `../docs/track-b-nanosignature.md` | `extensions/track-b-nanosignature.md` |
| `protected.md`, `demo-track-a.md`, `demo-track-b.md` | same basename at site root |

Note the **renames**: `nano-x402-landscape.md` is served as `/ecosystem`, and the
audit keeps a nested `audits/` path. Relative links inside `../docs/*.md` must
match the *destination* layout, not the source layout.

### Publication policy

Three documents are intentionally **repository-only**. They are not copied into
`gen/docs`, so they never appear on the site:

- `../docs/architecture/mechanism-decision.md`
- `../docs/adoption/nano-x402-implementation-brief.md`
- `../docs/implementation-report.md`

They are internal engineering records, not specification. Keep them in the repo;
do not add them to `prepare-rev.js` without an explicit decision.

**Publishing a new page requires three coordinated edits:**

1. Add the file to `coreFiles` or `extensionFiles` in `scripts/prepare-rev.js`.
2. Add a matching entry to `themeConfig.sidebar` in `.vitepress/config.mts`.
3. Link it from an existing page, or readers cannot reach it.

Omitting step 2 produces a silent orphan page: it builds, but nothing navigates
to it.

### ⚠️ Agent policy

1. **Sidebar paths must match generated paths.** `config.mts` links are resolved
   against `gen/dist`. A typo is a build failure, not a cosmetic issue.
2. **No string rewriting.** `prepare-rev.js` copies files verbatim. It does not
   rewrite hardcoded prose. If a phrase appears in several `site/*.md` files, you
   must update each one by hand.
3. **Run `site:preview` before you trust a local build.** See below.

---

## 🚀 Build & Preview

```bash
pnpm --dir site site:build     # prepare + build static output
pnpm --dir site site:preview   # serve the built output
```

`site:preview` serves at **`http://localhost:4173/x402.Nano/`** — the
`/x402.Nano/` base path comes from `base` in `.vitepress/config.mts` and is
required. Requesting `/` returns 404; that is expected, not a broken build.

Use `site:preview` rather than `site:dev` when you are checking what will
actually ship. `site:dev` serves from memory and will not catch link problems the
static build treats as fatal.

> **Build order matters.** CI runs `pnpm build` *before* `site:build`, because the
> site depends on the workspace packages. Running `pnpm typecheck` against a tree
> with no `dist/` fails with TS6305 "Output file has not been built from source
> file". Run `pnpm build` first.

---

## 🚀 Deployment Architecture

Two independent targets. Deploying one does not deploy the other.

| Component | Platform | URL | Trigger |
|---|---|---|---|
| **Static docs** | GitHub Pages (via Cloudflare) | `https://csi.ninzin.net/x402.Nano/` | `.github/workflows/deploy.yml`, **push to `main` only** |
| **Demo server** | fly.io | separate subdomain | manual, `pnpm --dir site deploy:fly:mainnet` |

### Before you push

- **The Pages workflow only runs on `main`.** Pushing a feature branch does not
  deploy, and therefore gives you no hosted preview. To check a branch visually,
  build and `site:preview` it locally.
- **Actions are pinned to full commit SHAs** and Dependabot tracks them weekly.
  When bumping one, update the `# vX.Y.Z` comment next to it in the same commit.
- **Runner and Node are pinned** to `ubuntu-24.04` / Node 24. Do not drift these
  casually; `main` publishes from this workflow.
- **npm release is manual.** `release.yml` is `workflow_dispatch` only, by
  deliberate decision while the specification is a draft. Do not re-add a `push`
  trigger without saying so in the commit.

---

## 🚀 Demo Server

**Location**: `protected-resource-demo-server/` — an Express server that acts as
an x402 facilitator for the interactive demo pages.

Mounted routes (`index.ts`):

| Path | Router |
|---|---|
| `/health` | inline |
| `/api/protected` | `routes/protected.ts` |
| `/api/poll-for-demo` | `routes/poll.ts` |
| `/api/demo` | `routes/demo-tracks.ts` |

`routes/status.ts` exists but is **not** mounted in `index.ts`. If you add a
route, mount it there too, or it is dead code.

### Configuration

Read from the **repository root `.env`** — there is no `site/.env`.
`demo:mainnet` sets `DOTENV_CONFIG_PATH=../.env`, and `index.ts` falls back to
`../../.env`.

```bash
cp .env.example .env
```

Required at startup — the process exits without them:

- `NANO_RPC_URL`
- `NANO_SERVER_ADDRESS` **or** `NANO_TEST_SEED`

If `NANO_TEST_SEED` is set, the demo derives a bounded pool of per-invoice
destination addresses from it; otherwise it falls back to the single
`NANO_SERVER_ADDRESS`. Never commit a real seed. `.env` is gitignored.

The listen port defaults to `3001` but is parsed from
`VITE_TEST_AND_DEMO_SERVER_URL` when set.

---

## 🖥️ Local Development

Run the servers in tmux so they survive detachment.

```bash
tmux new -s demo
cd /Users/conny/Developer/CasualSecurityInc/x402.Nano/site
pnpm dev:demo

# Detach: Ctrl+B then D
# Reattach: tmux attach -t demo
# Kill: tmux kill-session -t demo
```

| Command | Purpose |
|---|---|
| `pnpm --dir site dev:demo` | site watcher + VitePress + demo server |
| `pnpm --dir site site:dev` | site only, hot reload on `../docs/*.md` changes |
| `pnpm --dir site site:build` | production build |
| `pnpm --dir site site:preview` | serve the production build |
| `pnpm --dir site demo:mainnet` | demo server only |
| `pnpm --dir site test:server` | demo server tests |

Ports: VitePress **5173**, demo server **3001**.

Restarting inside an existing session:

```bash
tmux send-keys -t demo C-c
tmux send-keys -t demo 'pnpm dev:demo' Enter
```

---

## 🐛 Known Issues

- **Dead links fail the build.** VitePress treats a broken internal link as a
  build error, which fails CI. After adding or moving a page, run
  `site:build` locally before pushing.
- **404s usually mean the copy map drifted.** If a page 404s, check
  `prepare-rev.js` and `config.mts` agree on that path before debugging anything
  else.
- **Port conflicts.** Both development ports can be left occupied by a previous
  session: 5173 by a VitePress dev server, 3001 by a demo server. Check with
  `lsof -nP -iTCP:5173 -sTCP:LISTEN` before assuming your own run failed, and
  confirm with the owner before killing a process you did not start.
- **`dev:demo` breaks if `VITE_ENABLE_TESTNET_TAB=true`.** `scripts/dev-demo.sh`
  calls `pnpm demo:testnet`, which is not defined in `site/package.json`. Leave
  the flag unset unless you add that script.
- **`typecheck` fails with TS6305 on a clean tree.** Run `pnpm build` first —
  see Build & Preview above.
- **Mainnet integration tests are not part of the default test run.** They need
  `NANO_TEST_SEED` and spend real XNO. Do not run them casually, and do not
  report them as passing if they were skipped.
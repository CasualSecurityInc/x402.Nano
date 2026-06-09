# Drop multi-revision support — make Rev 8 the single revision

## Goal
Remove all `SPEC_REV` environment variable switching, `_revX` file naming conventions, and parallel-revision infrastructure. Make Rev 8 the only protocol revision, rename to x402.Nano branding.

---

## Phase 1: Rename docs files (drop `_rev8` prefix)

| Old Name (`docs/`) | New Name (`docs/`) |
|---|---|
| `x402_NanoSession_rev8_Intro.md` | `index.md` |
| `x402_NanoSession_rev8_Protocol.md` | `protocol.md` |
| `x402_NanoSession_rev8_Track_A_nanoTxn.md` | `track-a-nanotxn.md` |
| `x402_NanoSession_rev8_Track_B_nanoSignature.md` | `track-b-nanosignature.md` |

Also update internal cross-reference links in these 4 files:
- `./x402_NanoSession_rev8_Protocol.md` → `./protocol.md`
- `./x402_NanoSession_rev8_Track_A_nanoTxn.md` → `./track-a-nanotxn.md`
- `./x402_NanoSession_rev8_Track_B_nanoSignature.md` → `./track-b-nanosignature.md`

## Phase 2: Move rev7 docs to `docs/old/`

Move all 8 `docs/x402_NanoSession_rev7_*` files into `docs/old/`:
- `x402_NanoSession_rev7_Intro.md`
- `x402_NanoSession_rev7_Protocol.md`
- `x402_NanoSession_rev7_Glossary.md`
- `x402_NanoSession_rev7_Extension_A_Pools.md`
- `x402_NanoSession_rev7_Extension_B_Stochastic.md`
- `x402_NanoSession_rev7_Extension_C_Rebates.md`
- `x402_NanoSession_rev7_Extension_D_DustReturn.md`
- `x402_NanoSession_rev7_Appendix_Interoperability_Matrix.md`
- `x402_NanoSession_rev7_Appendix_Wallet_UX.md`

## Phase 3: Simplify `site/scripts/prepare-rev.js`

- Remove `SPEC_REV` env var requirement
- Hardcode source files: `index.md`, `protocol.md`, `track-a-nanotxn.md`, `track-b-nanosignature.md`
- Simplify link rewriting (no regex-based `_rev\d+` stripping needed)
- Copy `index.md` → `gen/docs/index.md`
- Copy `protocol.md` → `gen/docs/protocol.md`
- Copy `track-a-nanotxn.md` → `gen/docs/extensions/track-a-nanotxn.md`
- Copy `track-b-nanosignature.md` → `gen/docs/extensions/track-b-nanosignature.md`

## Phase 4: Update VitePress config (`site/.vitepress/config.mts`)

- `title`: `"x402.NanoSession"` → `"x402.Nano"`
- `base`: `"/x402.NanoSession/"` → `"/x402.Nano/"`
- GitHub nav link: → `https://github.com/CasualSecurityInc/x402.Nano`
- Social icon link: → `https://github.com/CasualSecurityInc/x402.Nano`
- Rename sidebar heading `"Live Demos (Rev 8)"` → `"Live Demos"`

## Phase 5: Clean up environment/CI

- `.github/workflows/deploy.yml`: remove `SPEC_REV: ${{ vars.SPEC_REV }}` line (keep other VITE_* vars)
- **Manual step**: Delete `SPEC_REV` repository variable from both repos:
  - `CasualSecurityInc/x402.Nano` (Settings → Secrets and variables → Actions → Variables)
  - `CasualSecurityInc/x402.NanoSession` (same)

## Phase 6: Update documentation / config references

| File | Changes |
|------|---------|
| `AGENTS.md` (root) | Remove `SPEC_REV=rev6` from site commands; update protocol spec link to `docs/protocol.md`; remove `- **Rev6**: Current active protocol revision` |
| `docs/AGENTS.md` | Remove `_revX` naming convention section (lines 79-88); update workflow to reflect flat naming; update security review references |
| `site/AGENTS.md` | Remove `SPEC_REV` references; update site commands |
| `README.md` | Remove `SPEC_REV=rev8` from all commands; update spec link to `./docs/protocol.md` |
| `packages/x402-adapter/README.md` | Update rev7 protocol link → rev8 (or remove revision reference) |
| `site/package.json` | `"description"`: `"x402.NanoSession"` → `"x402.Nano"` |
| All package `package.json` files | `repository.url`: → `https://github.com/CasualSecurityInc/x402.Nano` |
| `site/demo-track-a.md` | Check for hardcoded repo name references |
| `site/demo-track-b.md` | Check for hardcoded repo name references |
| `site/protected.md` | Check for x402.NanoSession references |

## Phase 7: Update internal code references

| File | Changes |
|------|---------|
| `site/protected-resource-demo-server/routes/demo-tracks.ts` | Change `version: 'rev8'` to `version: '1.0'` (or just remove `version` field) |
| `packages/core/src/index.ts` | docstring `"x402.NanoSession Core - Rev 8"` → `"x402.Nano Core"` |
| `packages/core/src/builders.ts` | docstring `"x402.NanoSession Rev 8 Builders"` → `"x402.Nano Builders"` |
| `packages/core/src/types.ts` | docstring `"x402.NanoSession Rev 8 Types"` → `"x402.Nano Types"` |
| `packages/core/src/constants.ts` | docstring `"x402.NanoSession Rev 8 Constants"` → `"x402.Nano Constants"` |
| `packages/x402-adapter/src/index.ts` | docstring `"x402.NanoSession Rev 8 Adapter"` → `"x402.Nano Adapter"` |
| `packages/facilitator/src/__tests__/handler.test.ts:229` | Update `"In NanoSession Rev 7, nanoSignature..."` comment |
| `site/e2e/protected.spec.ts:3` | `'NanoSession Protected Demo Page'` → `'x402.Nano Protected Demo Page'` |

## Out of scope
- `docs/old/` (all archival content, no changes)
- `docs/references/` (git submodules, no changes)
- `docs/proposal_review.md`, `docs/architecture_diagrams.md`, `docs/nano-x402-landscape.md` (standalone docs)
- Protocol content rewrites (only link/file path updates)
- `@nanosession/*` npm package scope name (rebranding the npm scope is a separate task)

## Verification
1. `pnpm site:build` — should build without SPEC_REV env var
2. `pnpm vitepress build site` — no dead links
3. `pnpm typecheck` — no TypeScript errors
4. Manual check: VitePress dev server loads all pages correctly

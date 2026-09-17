# Phase 0 — Repository Investigation

Date: 2026-09-17

## Findings

| Item | Found | Notes |
|---|---|---|
| `manifest.json` | No | Must be created (Manifest V3 per spec §4) |
| `package.json` | No | Must be created |
| `vite.config` | No | Must be created |
| `tsconfig` | No | Must be created |
| `src/`, `assets/`, `tests/`, `storage/`, `scripts/` | No | Must be created |
| Build configuration | No | — |
| Git repository | No | Initialized during Phase 1 |
| Existing files | `webinel.md` only | The authoritative implementation contract |

**Current architecture:** none — greenfield project. There is no existing stack to
preserve, so the preferred stack from spec §4 is adopted without conflict.

## Environment

| Tool | Version |
|---|---|
| Node.js | 22.23.2 |
| npm / pnpm / yarn | 10.9.8 / 11.20.0 / 1.22.22 (all present, no lockfile existed) |
| Browsers on machine | Firefox only (no Chromium binary) |
| ImageMagick | present (`convert`) — used to rasterize SVG icons |

## Decisions forced by the empty repository

| Decision | Choice | Reason |
|---|---|---|
| Package manager | npm | Ships with Node; no lockfile indicated another choice |
| Language / bundler | TypeScript 7 + Vite 8 | Spec §4 preferred stack |
| Test runner | Vitest 5 + jsdom | Shares the Vite pipeline; no extra transpiler needed |
| Browser API types | `@types/chrome` | Only runtime-free dependency needed for typing |
| Runtime dependencies | **None** | Spec §4 "never introduce unnecessary dependencies" |
| Manifest version | V3 | Spec §4 |
| Target browsers | Chromium (primary) + Firefox ≥ 121 | One manifest declares both `service_worker` and `scripts`; each browser uses the key it supports |

## Extension entry points (to be created)

- `src/background/index.ts` — service worker (threat engine host, message router)
- `src/popup/index.html` — 440×600 popup shell hosting all screens
- `src/warning/Warning.html` — interstitial for blocked sites
- `src/content/index.ts` — page-signal collector (built as a standalone IIFE)
- `src/legal/Legal.html` — Privacy & Terms pages linked from the footer (later moved into the popup: `src/popup/Legal/`)

## Risks

1. **VirusTotal public quota** (4 req/min, 500/day). Real-time scanning of every
   full URL would exhaust it. Mitigation: real-time uses *domain* reports, Smart
   Cache, and a persisted rate limiter; full URL reports are user-triggered.
2. **MV3 cannot synchronously block navigation** with an async lookup.
   Mitigation: heuristics run instantly; verdicts from cache are near-instant;
   dangerous verdicts redirect the tab to the warning page.
3. **Content scripts cannot be ES modules** — built separately as IIFE.
4. **Submitting a URL to VirusTotal makes it public on VT.** Unknown URLs are
   never auto-submitted; submission is an explicit user action.
5. **Registrable-domain detection without the Public Suffix List** is approximate
   (a small curated multi-part suffix list is used).
6. **Timeline / cache could become browsing history.** Mitigation: cache keys are
   SHA-256 hashes, activity records store domains only, lists are capped.

## TBD items

- Developer contact address for "Contact Developer" — resolved later: kukkalajeevansai@gmail.com and https://github.com/jeevansai-k
- Store listing / publisher ID / Firefox add-on ID — **Status: TBD** (placeholder gecko id used for local loading)
- Legal text reviewed by counsel — **Status: TBD** (plain-language drafts provided)

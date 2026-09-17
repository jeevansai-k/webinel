# Webinel Architecture (Phase 1 — locked)

> Protect first. Respect privacy always.

## 1. Contexts

```
┌────────────── Browser ──────────────┐
│ tab navigation / downloads / redirects
└──────┬──────────────────────────────┘
       │ webNavigation, webRequest (observe), downloads, content-script signals
┌──────▼──────────── background (service worker) ─────────────────────┐
│ MessageRouter ── ThreatEngine ── SmartCache ── VirusTotalService    │
│      │               │   └─ HeuristicEngine                         │
│      │               └─ DecisionEngine → Allow / Warn / Block       │
│      ├─ ProtectionController (navigation → verdict → action)       │
│      ├─ DownloadGuard, RedirectTracker                             │
│      └─ Stores: settings, whitelist, stats, timeline, bookmarks    │
└──────▲───────────────────────────────▲──────────────────────────────┘
       │ runtime messages (typed)      │
┌──────┴───── popup (440×600) ─┐  ┌────┴──── warning page ────┐
│ Home, Settings, Statistics,  │  │ ContinueGate (3 s glass   │
│ Bookmarks, Whitelist, Timeline│  │ overlay), Whitelist site │
│ AdvancedAnalysis, DocScanner │  └───────────────────────────┘
└──────────────────────────────┘
```

Only the background context ever reads the VirusTotal key or talks to the network.
UI contexts send typed messages (`src/shared/messages.ts`) and render results.

## 2. Folder layout

```
src/
  api/          VirusTotalClient (HTTP only), url-id encoding
  background/   service-worker entry, router, controllers (navigation, downloads, redirects)
  content/      page-signal collector (IIFE build)
  services/     ThreatEngine, HeuristicEngine, DecisionEngine, SmartCache, RateLimiter,
                VirusTotalService, UrlScanner, FileScanner, HashService, ReportBuilder,
                UploadStaging, LinkExtractor
  storage/      typed wrappers over chrome.storage (+ SecretStore for the API key)
  shared/       message/verdict/scan types, error model, config, icons/, styles/, components/
  utils/        url normalization, domain parsing, time formatting, hashing
  popup/        index.html shell + router; one folder per screen
  warning/      Warning.html/.css/.ts + ContinueGate
  legal/        Privacy & Terms page
  assets/       logo SVG, generated PNG icons
tests/          integration + security tests (unit tests live beside their source)
scripts/        icon generation
```

Every popup screen folder holds `<Screen>.html` (template fragment, imported `?raw`),
`<Screen>.css`, `<Screen>.ts` (exports `mount(root, ctx)`), `README.md`, `<Screen>.test.ts`.

## 3. Threat pipeline

1. **Whitelist** → Safe (user-trusted), no network.
2. **Heuristic engine** (local, synchronous): score 0–100 + human-readable signals.
3. **Smart Cache** (keyed by SHA-256 of normalized host/URL; never stores raw URLs).
4. **VirusTotal** (only if key configured, cache miss, and rate limiter allows).
5. **Decision engine** merges VT stats + heuristics → verdict + action.

| Verdict | Meaning | Action |
|---|---|---|
| Safe | VT reports clean and heuristics low | Allow |
| Suspicious | VT 1 malicious / ≥1 suspicious, or heuristics ≥ 40 | Warn (badge, activity) — Block if the user enables "Block suspicious" |
| Dangerous | VT ≥ 2 malicious, or heuristics ≥ 75 | Block (warning page) |
| Unknown | No VT data and heuristics low | Allow, shown as **Unknown**, never Safe |
| Error | VT failure / quota / invalid key and heuristics low | Allow, shown as **Error** |

`Unknown` and `Error` render with neutral/amber styling — never the green shield.

## 4. VirusTotal usage

- Real-time: `GET /api/v3/domains/{host}` (one request per host, cached).
  Navigations are picked up from `webNavigation.onBeforeNavigate`, `onCommitted` and
  `tabs.onUpdated`; `ProtectionController` evaluates each navigation once and tracks each
  tab's latest navigation itself. It does not ask `chrome.tabs.get()` whether the tab
  moved on, because that API can still report the previous page (e.g. `chrome://newtab/`)
  and used to cancel blocks.
- On demand: `GET /api/v3/urls/{base64url(url)}`; `GET /api/v3/files/{sha256}` for documents.
- `POST /api/v3/urls` + `GET /api/v3/analyses/{id}` only from Scan Now (unknown links) and Advanced Analysis.
- `POST /api/v3/files` only after the user consents to uploading a specific file.
- Health check: `GET /api/v3/domains/virustotal.com` → Online / Invalid key / Quota exceeded / Unreachable.
- Rate limiter: 4 requests / 60 s sliding window, persisted in `storage.session`.
- The key is sent only in the `x-apikey` header, never in a URL, never logged.

## 5. Smart Cache

Superseded by the scanning-engine rules — see [SCANNING_ENGINE.md](SCANNING_ENGINE.md#smart-cache):
URLs/domains 24 h, files 7 days, dangerous re-checked on every lookup, unknown 1 h,
failures never cached, 500 entries, one storage key per entry, identifying fields stripped.

## 6. Storage model (`chrome.storage.local`, never `sync`)

| Key | Content |
|---|---|
| `vt.secret` | API key, AES-GCM encrypted; the non-extractable key lives in extension IndexedDB |
| `settings` | toggles + theme |
| `whitelist` | hosts |
| `stats` | counters + 7-day buckets |
| `timeline` | security events (domain only), max 500 |
| `activity` | last 20 scan results (domain only) |
| `cache:<ns>:<sha256>` + `cache.index` | Smart Cache entries (no URLs, domains or file names) |
| `bookmarks` | secure bookmarks |

Never stored: email bodies, raw clipboard contents, full browsing history, document contents.

## 7. Feature → implementation map

| Feature | Where |
|---|---|
| Fake website / phishing / malware / suspicious domain | HeuristicEngine + VT + ProtectionController |
| Real-time URL scanner | `background/ProtectionController.ts` |
| Scan Now (6 s) / Advanced Analysis (full, background) | `services/UrlScanner.ts`, `background/AnalysisJobs.ts`, `popup/Home/ScanNow`, `popup/AdvancedAnalysis` |
| Redirect chain analysis | `background/RedirectTracker.ts` (webRequest observe-only, in-memory/session) |
| Download reputation | `background/DownloadGuard.ts` |
| Email link scanner | AdvancedAnalysis → `scripting.executeScript` extracts `href`s only |
| Clipboard scanner | Popup, user-enabled; reads clipboard only when the user presses Scan |
| Document scanner | `services/FileScanner.ts`: local SHA-256 → hash lookup → consented upload → poll |
| API health checker | Settings refresh icon |

## 8. Continue Anyway contract

`ContinueGate` owns the button state. On `start()` the button is disabled and a white
glass overlay covers it; the overlay's width shrinks from 100 % to 0 % anchored on the
left, so its right edge travels right → left like a depleting health bar, for exactly
3 000 ms. Only then is the button enabled; clicks before that are ignored. `reset()`
restarts the sequence for every new warning.

# VirusTotal URL & File Scanning Engine

Contract: `webinel temp/webinel-antivend-listadd.md`. This document records the
Phase 0 findings and the architecture that was implemented.

## Phase 0 — starting point

- The existing extension already had an isolated VirusTotal client, a rate limiter,
  a hashed Smart Cache and a one-click "Scan now" that returned a verdict-level
  summary only.
- Gaps against the new spec: no analysis submission/polling, no file upload,
  no vendor table, no DNS/SSL/WHOIS, cache TTLs differed (12 h / 6 h), no
  reusable report components, no dedicated error screens.
- Stack unchanged (TypeScript + Vite + Vitest, no runtime dependencies).

## Two workflows

| | Scan Now (Home) | Advanced Analysis |
|---|---|---|
| Entry | Home → **Scan now** (current tab or pasted link) | Advanced Analysis tile, or "Run complete Advanced Analysis" from Scan Now |
| Flow | normalize → validate → Smart Cache → URL lookup → *if unknown:* submit → poll every 2 s | normalize → validate → submit → analysis id → poll (5 s, then 15 s) → URL object + fresh domain object |
| Time limit | **Hard 6 s**: a timer aborts anything still in flight | **None** — cancellable |
| Runs in | background, answered through one message | background job; progress in `storage.session`, popup can close |
| Result | detection ratio, vendors so far, reputation, last analysis, processing state | full report (below) |

## Document Scanner

validate type/size locally → SHA-256 on the device → Smart Cache → hash lookup →
*if unknown:* consent card → (only on **Upload to VirusTotal**) stage the file in the
extension's IndexedDB → background uploads → poll → report.
Supported: PDF, DOCX, XLSX, ZIP, EXE, APK, PNG, JPG, GIF, TXT; max 32 MB.
Consent is enforced three times: in the UI, in `AnalysisJobs.startFileUpload`, and in
`FileScanner.upload`. The uploaded bytes must hash to the approved SHA-256.

## Layers

```
popup screens (render only)
  └─ shared/components: DetectionCircle, ResultHeader, VendorTable, MetadataGrid,
     AnalysisProgress, ErrorState, ReportViews (quick / full / file layouts)
background
  ├─ AnalysisJobs          long-running jobs, cancel, restart recovery
  ├─ services/UrlScanner   quickScan (6 s) · fullScan (no limit) · pollAnalysis
  ├─ services/FileScanner  lookup · upload (consent required)
  ├─ services/VirusTotalService  cache → limiter → client; stale fallback
  ├─ services/SmartCache   per-entry storage keys + index
  └─ api/VirusTotalClient + api/parsers   HTTP + pure JSON parsing
```

Business logic never lives in UI components; screens call background messages and
pure helpers (`UrlValidation`, `FileValidation`, `HashService`).

## API layer

`VirusTotalClient`: domain/IP, URL and file lookups, URL submit, file upload,
analysis polling. Every HTTP failure becomes a status (401 invalid key, 403 forbidden,
404 not found, 429 quota, 5xx error, network unreachable). `shared/scanErrors.ts` maps
statuses to fixed, friendly messages — raw API errors never reach the UI.

## Smart Cache

| Rule | Value |
|---|---|
| URLs / domains | fresh for 24 h |
| Files | fresh for 7 days |
| Dangerous | never fresh — re-checked on every lookup; cached copy only used if VirusTotal fails |
| Unknown | 1 h |
| Failures | never cached |
| Offline | expired entries served for up to 30 days, clearly labelled *stale*; a stale clean result is never shown as Safe |
| Size | 500 entries, oldest evicted |

Each entry stores the target hash, detection ratio, analysis id, timestamp and verdict,
plus the parsed report. **Identifying fields (URL, final URL, title, redirect chain, file
name, domain, DNS, WHOIS, certificate) are stripped before storage** and rebuilt from the
lookup key, so the cache never becomes a readable history. Advanced Analysis therefore
always fetches domain intelligence fresh.

## Report sections (Advanced Analysis)

Detection summary · URL metadata (URL, domain, IP, HTTP status, content type, first seen,
last analysis) · Threat classification · Community reputation · Antivirus vendors ·
Categories · Redirect chain (timeline) · DNS (A/AAAA/MX/NS) · SSL certificate · WHOIS
summary · Raw metadata (collapsed).

## Error screens

Missing API key (→ Open Settings) · Invalid key · Rate limited (4/min, 500/day, retry
guidance) · Offline (cache only, never a fake fresh scan) · Invalid URL · File too large ·
Unsupported file · Timeout (Scan Now) · Cancelled · Interrupted (worker restarted).

## Performance

| Target | How |
|---|---|
| Popup UI < 150 ms | no network on mount; screens read local stores |
| Cache lookup < 50 ms | one storage key per entry (tested with a full cache) |
| Scan result ~6 s | hard deadline timer; partial results returned |
| Advanced Analysis non-blocking | background job + session-storage progress + cancel |

## Privacy notes

- Submitting a URL or uploading a file makes it visible to VirusTotal's community. Scan
  Now discloses this under its input; Advanced Analysis likewise; file uploads require
  explicit consent with a warning about confidential documents.
- A staged upload lives in extension IndexedDB only until the background takes it; staging
  is cleared on worker start.

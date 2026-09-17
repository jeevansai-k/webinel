# Testing

Run everything with `npm test` (Vitest + jsdom). `tests/fixtures/virustotal.ts` holds recorded-shape VirusTotal payloads.
`tests/setup/chromeMock.ts` provides an
in-memory `chrome.*` (storage with change events, runtime messaging, tabs, downloads…),
reset before every test.

| Area | Files |
|---|---|
| **Unit** — URL normalization | `src/utils/url.test.ts`, `src/utils/domain.test.ts` |
| **Unit** — Cache | `src/services/SmartCache.test.ts`, `src/services/RateLimiter.test.ts` |
| **Unit** — Whitelist | `src/storage/WhitelistStore.test.ts` |
| **Unit** — Heuristics & decisions | `src/services/HeuristicEngine.test.ts`, `src/services/DecisionEngine.test.ts`, `src/background/DownloadGuard.test.ts` |
| **Integration** — VirusTotal client/service | `tests/integration/virustotal-client.test.ts`, `tests/integration/virustotal-service.test.ts` |
| **Integration** — Storage | `tests/integration/storage.test.ts` |
| **Integration** — Background messaging | `tests/integration/messaging.test.ts` |
| **Integration** — Pipeline | `tests/integration/threat-engine.test.ts`, `tests/integration/protection-controller.test.ts` |
| **UI** — Main popup | `src/popup/Home/Home.test.ts`, `tests/ui/popup-frame.test.ts` (440×600, 20px footer, manifest) |
| **UI** — Settings | `src/popup/Settings/Settings.test.ts` |
| **UI** — Other screens | `src/popup/*/*.test.ts` |
| **UI** — Warning popup | `tests/ui/warning-page.test.ts` |
| **Unit** — SHA-256, vendor parsing, verdict mapping | `src/services/HashService.test.ts`, `src/api/parsers.test.ts`, `src/services/ReportBuilder.test.ts` |
| **Integration** — URL lookup, analysis polling, file upload, jobs | `tests/integration/url-scanner.test.ts`, `tests/integration/file-scanner.test.ts`, `tests/integration/analysis-jobs.test.ts` |
| **UI** — Detection circle, vendor table, result cards, error states | `tests/ui/report-components.test.ts`, `src/popup/Home/ScanNow/ScanNow.test.ts` |
| **Security** — Continue Anyway | `tests/security/continue-gate.test.ts` |
| **Security** — Scanning engine | `tests/security/scanning.test.ts`: key never exposed, local storage only, upload requires consent, 6-second timeout (including hung requests), Unknown ≠ Safe |

## Mandatory Continue Anyway checks

All live in `tests/security/continue-gate.test.ts`, driven by a deterministic `FakeClock`:

- disabled on appearance (and already in the static HTML)
- exactly 3-second delay (still disabled at 2 990 ms, enabled at 3 000 ms)
- overlay shrinks right → left, anchored left, proportional to elapsed time
- no spinner / countdown / percentage
- early clicks prevented, even with `disabled` removed
- early-firing timers cannot open the gate
- button enables correctly (overlay hidden, `aria-disabled` removed)
- resets on a new warning, including mid-countdown

## Manual verification

1. `npm run build`, load `dist/` unpacked.
2. Type `http://paypal.com.secure-login.verify-account.invalid/signin` into the address bar
   (`.invalid` is reserved and never resolves). Heuristics alone rate it Dangerous, so the
   warning page appears; the Continue button unlocks only after the glass overlay drains.
3. Popup → Settings → paste key → refresh shows **Online · N ms**.
4. Download a file named `invoice.pdf.exe` from any site — it is cancelled with a notification.
5. Home → **Scan now** → a result appears within about 6 seconds.
6. Advanced Analysis → Analyze → close the popup → reopen: progress continues; Cancel works.
7. Document Scanner → drop a new text file → consent card appears; **Don't upload** sends nothing.

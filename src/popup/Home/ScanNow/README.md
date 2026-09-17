# Scan Now

Fast VirusTotal check opened from Home (**Scan now**). Prefills the current tab or accepts
a pasted link.

1. Validate and normalize locally (`services/UrlValidation`).
2. `scan:quick` → background `UrlScanner.quickScan`: Smart Cache → URL lookup → if unknown,
   submit and poll every 2 s.
3. Hard stop at **6 seconds** — in-flight requests are aborted; whatever vendors finished are shown
   with a "still running" notice. Clean-so-far results are **Unverified**, never Safe.

Shows: DetectionCircle, URL, domain, IP (from cached domain data when available), HTTP status,
content type, last analysis, VendorTable, and a hand-off to Advanced Analysis.
Errors render with `ErrorState` (missing key → Open Settings, rate limit/timeout → retry).

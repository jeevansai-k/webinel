# Advanced Analysis

Complete VirusTotal analysis with no time limit.

- **Analyze** → `analysis:start-url` → background job (`AnalysisJobs` + `UrlScanner.fullScan`):
  submit → analysis id → poll (5 s, then every 15 s, rate-limit aware) → URL object + fresh domain object.
- Progress (`AnalysisProgress`) comes from `storage.session` (`analysis.jobs`), so the popup can close
  and reopen onto the latest job. **Cancel** sends `analysis:cancel`.
- Report (`fullUrlReportHtml`): detection summary, URL metadata, threat classification, community
  reputation, vendor table, categories, redirect-chain timeline, DNS, SSL certificate, WHOIS, raw
  metadata (collapsed).
- Also here: **Scan email links** (Settings toggle; `href`s only), **Scan clipboard** (Settings toggle;
  read on click; a single link is pasted, never auto-submitted), and the current tab's observed
  redirect chain.

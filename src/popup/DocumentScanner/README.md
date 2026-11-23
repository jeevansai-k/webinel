# Document Scanner

Same report design as URL scans (`fileReportHtml` → DetectionCircle, ResultHeader, VendorTable).

1. Drop a file onto the popup, or click / press Enter to choose one. Firefox, and Chrome on Windows/Linux,
   close toolbar popups while a native file chooser is open, so clicking opens the scanner in the browser's
   **side panel** (Firefox `sidebar_action`, Chrome `side_panel`; page `popup/index.html?mode=panel#documents`)
   and closes the popup. The panel stays open while the chooser is up; the consent card and upload run there.
   Chrome on macOS keeps the popup open, so the chooser opens in place. If no side panel API is available,
   a small 440 × 600 Webinel window (`?mode=window`) is the fallback. Supported: PDF, DOCX, XLSX, ZIP, EXE, APK, PNG, JPG, GIF, TXT, max 32 MB — anything
   else is rejected locally.
2. SHA-256 computed on the device → `file:lookup` (Smart Cache, then VirusTotal hash lookup).
3. Unknown file → **consent card**. Nothing is uploaded unless the user presses **Upload to VirusTotal**;
   **Don't upload** leaves the file Unverified.
4. On consent (the buttons disable after one press): the file is staged in extension IndexedDB →
   `file:upload` → the background reads and deletes it in one transaction and keeps an in-memory copy →
   the job uploads, polls and reports; progress and Cancel via `AnalysisProgress`. While a job runs the
   background pings an extension API every 20 s so Firefox does not suspend its event page. Only a real
   Cancel shows "Analysis cancelled"; a failed handoff says so ("The file could not reach Webinel's background").
5. TXT files also have their links extracted locally and checked with `scan:links`.

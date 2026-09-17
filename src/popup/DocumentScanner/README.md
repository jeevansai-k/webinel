# Document Scanner

Same report design as URL scans (`fileReportHtml` → DetectionCircle, ResultHeader, VendorTable).

1. Drop a file onto the popup, or click / press Enter to choose one. On macOS the chooser opens in the popup.
   On Windows/Linux Chrome closes toolbar popups while a native file chooser is open, so clicking opens
   (or focuses) a small Webinel scanner window — `popup/index.html?mode=window#documents`, sized to 440 × 600,
   not a browser tab — where the chooser, consent card and upload all work. Supported: PDF, DOCX, XLSX, ZIP, EXE, APK, PNG, JPG, GIF, TXT, max 32 MB — anything
   else is rejected locally.
2. SHA-256 computed on the device → `file:lookup` (Smart Cache, then VirusTotal hash lookup).
3. Unknown file → **consent card**. Nothing is uploaded unless the user presses **Upload to VirusTotal**;
   **Don't upload** leaves the file Unverified.
4. On consent: the file is staged in extension IndexedDB → `file:upload` → background job uploads, polls,
   and reports; progress and Cancel via `AnalysisProgress`.
5. TXT files also have their links extracted locally and checked with `scan:links`.

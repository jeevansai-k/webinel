# Home

Main popup screen (440 × 600).

- **Header** — Webinel sentinel-eye logo, name, tagline; settings icon → Settings.
- **Protection Status** — first and largest element: a radar scope with the shield, current domain, real-time state, the current site's verdict and **Scan now**, which opens the [Scan Now](ScanNow/README.md) screen (6-second VirusTotal check). The card turns amber for a suspicious page or paused protection ("Be careful on this page" / "Protection Paused") and red for a dangerous page ("Threat on this page"). Without an API key it shows a **Set up** nudge that opens Settings.
- **Navigation** — 2 × 3 compact tiles: Whitelist, Statistics, Bookmarks / Advanced Analysis, Document Scanner, Timeline.
- **Recent Activity** — last 20 hosts with Safe / Warning / Blocked / Unverified.
- **Footer** — version, Privacy, Terms (20px).

Unknown verdicts render as **Unverified** (grey), never as Safe.
Data: `activityStore`, `settingsStore`, `tab:current-report`.

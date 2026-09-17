# Home

Main popup screen (440 × 600).

- **Header** — Webinel W logo, name, tagline; settings icon → Settings.
- **Navigation** — 2 × 3 glass tiles: Whitelist, Statistics, Bookmarks / Advanced Analysis, Document Scanner, Timeline.
- **Protection Status** — largest element: shield, current domain, "You're Protected", real-time state, the current site's real-time verdict and **Scan now**, which opens the [Scan Now](ScanNow/README.md) screen (6-second VirusTotal check).
- **Recent Activity** — last 20 hosts with Safe / Warning / Blocked / Unverified.
- **Footer** — version, Privacy, Terms (20px).

Unknown verdicts render as **Unverified** (grey), never as Safe.
Data: `activityStore`, `settingsStore`, `tab:current-report`.

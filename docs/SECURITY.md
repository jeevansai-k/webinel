# Security & Privacy Hardening (Phase 9)

## API key

- Pasted manually; validated as 64 hex characters.
- Encrypted with AES-GCM (random 96-bit IV) before it is written to `chrome.storage.local`.
  The AES key is **non-extractable** and lives in the extension origin's IndexedDB.
- Never written to `storage.sync`, never logged (`utils/logger.ts` redacts 64-hex strings),
  never returned to any UI context. The Settings page only learns `configured: true/false`.
- Sent only as the `x-apikey` header to `https://www.virustotal.com` with
  `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`.
- If the AES key is lost, the unusable ciphertext is deleted rather than retried.

## Extension surface

- CSP: `script-src 'self'; object-src 'self'; connect-src https://www.virustotal.com; img-src 'self' data:; style-src 'self'`.
  No inline styles in markup, no remote code, no fonts or images from the network.
- Message router only accepts messages from this extension; content scripts may send
  **only** `page:signals`. Everything privileged (key, scans, warnings, whitelist) requires an extension page.
- The warning page receives an opaque one-time id; the blocked URL is kept in
  `storage.session` (not reachable by content scripts) and never appears in the warning page's address.
  A warning id can be used once.
- `Continue Anyway` grants a 30-minute, host-scoped, session-only bypass.
- All dynamic text rendered with `innerHTML` passes through `escapeHtml`.
- `clipboardRead` is an optional permission, requested only when the user enables the Clipboard Scanner.

## Continue Anyway gate

The button is disabled in the static HTML (so it is locked before any script runs), a
capture-phase click guard swallows clicks until the gate opens (even if `disabled` is
removed with devtools), early-firing timers are re-armed for the remaining time, and the gate
restarts on every new warning and on back/forward-cache restores.

## Scanning engine

- Scan Now is hard-limited to 6 seconds: a timer aborts every in-flight VirusTotal request.
- Files are never uploaded without consent — enforced in the UI, the background job runner
  and the file scanner — and the uploaded bytes must match the approved SHA-256.
- Raw VirusTotal error bodies are never displayed; statuses map to fixed messages.
- "View on VirusTotal" only opens `https://www.virustotal.com/` links.
- Offline results come only from the Smart Cache and are labelled stale; a stale clean
  result is shown as Unverified, a stale dangerous one keeps protecting.

## Data minimisation

| Stored | Not stored |
|---|---|
| Hashed cache keys, verdicts, detection ratios, vendor results | URLs, domains, file names, DNS/WHOIS/certificate details in the cache |
| Recent activity (domain only, 20 max) | Browsing history |
| Timeline (domain / file name, 500 max) | Email bodies, subjects, senders |
| Redirect hops without query strings (session only) | Clipboard contents |
| Secure bookmarks the user saved | Document contents (only a SHA-256 leaves the device unless the user consents to an upload) |
| Analysis jobs (session only, 10 max) | — |

Real-time protection never submits anything. URLs are submitted only when the user runs
Scan Now on a link VirusTotal has not seen, or Advanced Analysis — both screens say that
submitted links become visible to the VirusTotal community.

## Known limitations

- MV3 cannot hold a navigation while an async lookup runs. Cached and heuristic verdicts are
  immediate; a first-time VirusTotal lookup may let the page begin loading before the tab is
  redirected to the warning page.
- Registrable-domain detection uses a curated suffix list rather than the full Public Suffix List.
- Chromium ignores the Firefox-only `background.scripts` / `browser_specific_settings` keys and shows a warning for them on the extensions page; this is expected.

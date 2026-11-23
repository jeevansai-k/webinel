<div align="center">

<img src="src/assets/logo.svg" alt="Webinel logo" width="112" height="112" />

# Webinel

### 🛡️ Your Web Sentinel

**A privacy-first browser security extension that stops phishing, malware, fake sites and unsafe downloads — before you click the wrong thing.**

<br />

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4cc2ff?style=for-the-badge&labelColor=070c16)
![TypeScript](https://img.shields.io/badge/TypeScript-7-4cc2ff?style=for-the-badge&logo=typescript&logoColor=white&labelColor=070c16)
![Vite](https://img.shields.io/badge/Vite-8-4cc2ff?style=for-the-badge&logo=vite&logoColor=white&labelColor=070c16)
![Vitest](https://img.shields.io/badge/Tested_with-Vitest-4cc2ff?style=for-the-badge&logo=vitest&logoColor=white&labelColor=070c16)

![Chromium](https://img.shields.io/badge/Chromium-supported-4cc2ff?style=flat-square&logo=googlechrome&logoColor=white&labelColor=070c16)
![Firefox](https://img.shields.io/badge/Firefox_121%2B-supported-4cc2ff?style=flat-square&logo=firefoxbrowser&logoColor=white&labelColor=070c16)
![No telemetry](https://img.shields.io/badge/telemetry-none-4cc2ff?style=flat-square&labelColor=070c16)
![No accounts](https://img.shields.io/badge/accounts-none-4cc2ff?style=flat-square&labelColor=070c16)

<br />

> *Protect first. Respect privacy always.*

[Features](#-what-webinel-does) •
[Build](#-build-the-extension) •
[Chromium](#-install-on-chromium-browsers) •
[Firefox](#-install-on-firefox) •
[Setup](#-first-run-setup) •
[How it works](#-how-it-works) •
[Structure](#-project-structure) •
[Development](#-development)

</div>

---

## 🔭 At a glance

|  |  |
|---|---|
| 🧠 **Thinks before you click** | Every page you open is checked against local heuristics, a Smart Cache and VirusTotal — and dangerous pages are stopped. |
| 🔐 **Private by design** | No backend, no accounts, no sign-in, no telemetry, no analytics. VirusTotal is the **only** outside service — and only with **your own** API key. |
| 🧩 **One edition** | No "Premium", no "Community". Every feature is included. |
| 🎨 **Feels like a security product** | The *Nightwatch* design: a 440 × 600 popup in blue-ink surfaces (`#0a101b`) with one signal-azure accent (`#4cc2ff`), a radar-sweep status hero and locally bundled Inter, Space Grotesk and JetBrains Mono. Green, amber and red are reserved for security verdicts. Auto, Dark and Light themes. |

---

## ✨ What Webinel does

<table>
<tr>
<td width="50%" valign="top">

### 🚦 Real-time protection
- Checks every page you open.
- Detects **look-alike and homoglyph domains** (`paypa1`, `rnicrosoft`), brand names on foreign domains, raw IP hosts, punycode tricks and risky TLDs.
- Watches for **password forms** that post to another site or load over plain HTTP.
- **Dangerous → blocked** with a full-page warning.
- **Suspicious → warned** (or blocked, if you choose).

### ⏳ The warning page
- Red shield, reasons, **Back to safety** and **Whitelist this Site**.
- **Continue Anyway** stays locked for exactly **3 seconds** while a white glass overlay drains right-to-left like a health bar — no rushing past a real threat.

### ⚡ Scan Now
- One click from Home, or paste any link.
- A VirusTotal verdict in about **6 seconds**: detection ratio, vendors, reputation, HTTP status and content type.

</td>
<td width="50%" valign="top">

### 🔬 Advanced Analysis
- A **complete** VirusTotal report with no time limit. It runs in the background, so you can close the popup.
- Detection summary · URL metadata · threat classification · community reputation · **scrollable vendor list** · categories · redirect chain · DNS · SSL certificate · WHOIS · raw metadata.
- **Current site** button, **email link scanner** and **clipboard scanner**.

### 📄 Document Scanner
- PDF, DOCX, XLSX, ZIP, EXE, APK, PNG, JPG, GIF, TXT — up to **32 MB**.
- Files are fingerprinted (SHA-256) **on your device**. Nothing is uploaded unless **you** press **Upload to VirusTotal**.

### 🧰 And more
- **Download guard** — cancels disguised programs like `invoice.pdf.exe`.
- **Whitelist**, **Statistics**, **Timeline** and **Secure Bookmarks** (re-checked before opening).
- **API health check**, plus Auto (follows your system), Dark and Light themes.

</td>
</tr>
</table>

---

## ✅ Requirements

| You need | Version | Why |
|---|---|---|
| [Node.js](https://nodejs.org/) | **20.19+** or **22.12+** | Builds the extension (required by Vite 8) |
| npm | Comes with Node.js | Installs the build tools |
| Git | Any recent version | Clones the repository |
| A browser | A current **Chromium** browser (Chrome, Edge, Brave, Opera, Vivaldi — version 121+ recommended) **or Firefox 121+** | Runs the extension |
| A free [VirusTotal](https://www.virustotal.com/) account | — | Provides the API key for reputation checks (optional, but recommended) |

> [!NOTE]
> The installable extension is generated into `dist/`, which is **not** committed to this repository. Build it once before loading it — it only takes a few seconds.

---

## 🔨 Build the extension

These steps are the same for every browser.

**1. Clone the repository:**

```bash
git clone https://github.com/jeevansai-k/webinel.git
```

**2. Enter the project folder:**

```bash
cd webinel
```

**3. Install the build tools** (exact versions from `package-lock.json`):

```bash
npm ci
```

**4. Build:**

```bash
npm run build
```

This type-checks the code and writes the ready-to-load extension to **`dist/`**:

```text
dist/
├── manifest.json        ← the browser loads this
├── background.js        ← service worker
├── content.js           ← page-signal collector
├── popup/index.html     ← the 440 × 600 popup
├── warning/Warning.html ← the block page
├── assets/              ← bundled JavaScript and CSS
└── icons/               ← toolbar icons
```

---

## 🟠 Install on Chromium browsers

Works with **Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi** and other Chromium-based browsers.

**1. Open the extensions page** by typing the address for your browser into the address bar:

| Browser | Address |
|---|---|
| Google Chrome | `chrome://extensions` |
| Microsoft Edge | `edge://extensions` |
| Brave | `brave://extensions` |
| Opera | `opera://extensions` |
| Vivaldi | `vivaldi://extensions` |

**2. Turn on _Developer mode_.** In Chrome, Brave, Opera and Vivaldi the switch is at the top right; in Edge it is in the left sidebar.

**3. Click _Load unpacked_** and select the **`dist`** folder inside the project (the folder that contains `manifest.json`).

**4. Pin Webinel to the toolbar.** Click the puzzle-piece (Extensions) icon, then the pin next to **Webinel**.

**5. Add your VirusTotal key** — see [First-run setup](#-first-run-setup).

> [!TIP]
> The Webinel card may show a warning about `background.scripts` or `browser_specific_settings`. Those manifest keys exist only for Firefox and Chromium ignores them, so the warning is harmless.

**Updating:** pull the latest code, run `npm run build` again, then click the **↻ reload** icon on the Webinel card.

---

## 🦊 Install on Firefox

Requires **Firefox 121 or newer**.

### Option A — Temporary install (quickest, for testing)

**1.** Open this address in Firefox:

```text
about:debugging#/runtime/this-firefox
```

**2.** Click **Load Temporary Add-on…**

**3.** Open the project's **`dist`** folder and select **`manifest.json`**.

**4. Pin it:** click the Extensions (puzzle-piece) button in the toolbar → the ⚙ gear next to **Webinel** → **Pin to Toolbar**.

**5. Allow website access:** open `about:addons` → **Webinel** → **Permissions** tab, and make sure **"Access your data for all websites"** is switched **on**. Firefox lets you control this per extension, and real-time protection needs it.

> [!IMPORTANT]
> Firefox removes temporary add-ons when it closes. Repeat these steps after restarting Firefox, or use Option B.

**Updating:** run `npm run build` again, then click **Reload** next to Webinel on the `about:debugging` page.

### Option B — Keep it installed

Release versions of Firefox only keep **signed** add-ons installed. There are two routes:

- **Sign it (works in every Firefox edition).** Package `dist/` as a ZIP (see below) and submit it on [addons.mozilla.org](https://addons.mozilla.org/developers/). Choose the *"On your own"* distribution option to receive a signed `.xpi` without publishing a public listing. Install the signed file from `about:addons` → ⚙ → **Install Add-on From File…**
- **Firefox Developer Edition, Nightly or ESR only:** open `about:config`, set `xpinstall.signatures.required` to **false**, then install the ZIP from `about:addons` → ⚙ → **Install Add-on From File…**

Create the ZIP from the project folder (`manifest.json` must sit at the root of the archive):

```bash
cd dist && zip -r ../webinel.zip . && cd ..
```

Afterwards, complete step 5 of Option A (website access).

---

## 🔑 First-run setup

1. Sign in at [virustotal.com](https://www.virustotal.com/), open your profile menu → **API key**, and copy the key.
2. Click the **Webinel** icon → ⚙ **Settings** → the ✏ **pencil** on the *VirusTotal API* card.
3. Paste the key and press **Save**. It is encrypted and stored **only on this device** — from then on you will only ever see `••••••••••••••••`.
4. Press the 🔄 **refresh** icon. You should see **Online · _N_ ms**.

Free VirusTotal keys allow **4 requests per minute and 500 per day**. Webinel's Smart Cache and rate limiter keep you within those limits.

> Without a key, Webinel still runs its local heuristics, but anything it cannot verify is shown as **Unverified** — never as Safe.

### 🧪 Try it safely

Type this into the address bar of a new tab. The `.invalid` domain is reserved and can never resolve, so no real site is visited:

```text
http://paypal.com.secure-login.verify-account.invalid/signin
```

Webinel's heuristics rate it **Dangerous** and show the warning page. Watch **Continue Anyway** unlock after 3 seconds.

---

## 🧬 How it works

```mermaid
flowchart LR
    A([🌐 You open a page]) --> B{On your<br/>whitelist?}
    B -- yes --> SAFE([✅ Allow])
    B -- no --> C[🧠 Local heuristics<br/>look-alikes · IPs · punycode<br/>password forms]
    C --> D[(🗄 Smart Cache<br/>hashed keys only)]
    D -- fresh result --> F
    D -- missing or dangerous --> E[☁ VirusTotal<br/>your own API key]
    E --> F{⚖ Decision engine}
    F -- Safe --> SAFE
    F -- Unknown or Error --> INFO([❔ Allow · shown as Unverified])
    F -- Suspicious --> WARN([⚠ Warn])
    F -- Dangerous --> BLOCK([⛔ Warning page<br/>3-second Continue gate])
```

| Verdict | When | What you see |
|---|---|---|
| ✅ **Safe** | VirusTotal reports it clean **and** the heuristics are calm | Green ✓ badge |
| ⚠ **Suspicious** | One vendor flags it as malicious, any vendor flags it as suspicious, or the heuristic score is 40+ | Yellow ! badge — or a block, if *Block suspicious sites* is on |
| ⛔ **Dangerous** | Two or more vendors flag it as malicious, or the heuristic score is 75+ | Full-page warning |
| ❔ **Unverified** | VirusTotal has no data (or no key is set) | Grey ? badge — **never** shown as Safe |
| ❔ **Check failed** | VirusTotal could not be reached or refused the request | Grey ? badge — **never** shown as Safe |

**Smart Cache rules:** URLs and domains stay fresh for 24 hours and files for 7 days. Dangerous results are re-checked on every lookup, unknown results last 1 hour, and failures are never cached. Cache keys are SHA-256 hashes, and entries contain **no addresses, domains or file names**.

---

## 🔒 Privacy promises

- 🚫 **No** servers, accounts, sign-in, OAuth, telemetry or analytics.
- 🗝 Your API key is **AES-GCM encrypted**, stored locally, never synced, never logged, never displayed after saving, and sent **only** to VirusTotal in a request header.
- 🌍 Real-time protection sends VirusTotal only the **domain** of the page you open.
- 🔗 Links are submitted for new analysis only when **you** run *Scan Now* on a link VirusTotal hasn't seen, or run *Advanced Analysis*.
- 📄 Files never leave your device unless **you** press **Upload to VirusTotal**. Otherwise only a SHA-256 fingerprint is checked.
- ✉ The email and clipboard scanners are **off by default**, run only when you press scan, and read **links only**.
- 🧹 Webinel never stores email bodies, clipboard contents or your browsing history.

Full details: [`docs/SECURITY.md`](docs/SECURITY.md), plus the in-app **Privacy** and **Terms** pages.

---

## 📁 Project structure

```text
webinel/
├── public/
│   ├── manifest.json               # Manifest V3 (Chromium + Firefox 121+)
│   └── icons/                      # 16 / 32 / 48 / 128 px toolbar icons
│
├── src/
│   ├── api/
│   │   ├── VirusTotalClient.ts     # the only HTTP client (key sent in a header only)
│   │   └── parsers.ts              # VirusTotal JSON → Webinel's scan model
│   │
│   ├── background/                 # service worker — the only place the key is read
│   │   ├── index.ts                # entry: message handlers + browser event listeners
│   │   ├── MessageRouter.ts        # typed messages; web pages may only send page signals
│   │   ├── ProtectionController.ts # real-time Allow / Warn / Block
│   │   ├── AnalysisJobs.ts         # background Advanced Analysis and file uploads
│   │   ├── DownloadGuard.ts        # download reputation checks
│   │   ├── RedirectTracker.ts      # redirect-chain observer
│   │   ├── SessionState.ts         # per-session tab state and pending warnings
│   │   └── Badge.ts                # toolbar badge
│   │
│   ├── content/
│   │   └── index.ts                # spots risky password forms (never reads page text)
│   │
│   ├── services/                   # business logic — no UI code
│   │   ├── ThreatEngine.ts         # whitelist → heuristics → cache → VirusTotal → decision
│   │   ├── HeuristicEngine.ts      # local URL risk scoring
│   │   ├── DecisionEngine.ts       # verdicts and actions (Unknown ≠ Safe)
│   │   ├── VirusTotalService.ts    # cache + rate limiter + client
│   │   ├── SmartCache.ts           # hashed, expiring result cache
│   │   ├── RateLimiter.ts          # 4 requests per minute
│   │   ├── UrlScanner.ts           # Scan Now (6 s) and Advanced Analysis
│   │   ├── FileScanner.ts          # hash lookups and consented uploads
│   │   ├── ReportBuilder.ts        # assembles scan reports
│   │   ├── HashService.ts          # on-device SHA-256
│   │   ├── UploadStaging.ts        # hands approved files to the background
│   │   ├── UrlValidation.ts        # URL checks before anything is sent
│   │   ├── FileValidation.ts       # file type and size checks
│   │   ├── LinkExtractor.ts        # pulls links (only links) out of an open email
│   │   └── *.test.ts               # unit tests live next to their code
│   │
│   ├── storage/                    # typed wrappers over chrome.storage (never sync)
│   │   ├── LocalStore.ts           # base store with serialized updates
│   │   ├── SecretStore.ts          # encrypted API key
│   │   └── …Store.ts               # settings, whitelist, stats, timeline, activity,
│   │                               # bookmarks, analysis jobs
│   │
│   ├── shared/
│   │   ├── components/             # DetectionCircle, ResultHeader, VendorTable,
│   │   │                           # MetadataGrid, AnalysisProgress, ErrorState,
│   │   │                           # ReportViews, VerdictChip, ScreenHeader, Toast
│   │   ├── styles/                 # theme.css (design tokens) and report.css
│   │   ├── icons/                  # inline SVG icon set and logo
│   │   ├── messages.ts             # popup ⇄ background contract
│   │   ├── scan.ts, verdict.ts     # shared types
│   │   ├── scanErrors.ts           # friendly error messages
│   │   └── config.ts, dom.ts, theme.ts
│   │
│   ├── popup/                      # the 440 × 600 popup
│   │   ├── index.html, main.ts, router.ts, popup.css, Footer.ts
│   │   ├── Home/                   # protection status, tiles, recent activity
│   │   │   └── ScanNow/            # the 6-second scan
│   │   ├── AdvancedAnalysis/       # full VirusTotal report
│   │   ├── DocumentScanner/        # file fingerprinting and consented upload
│   │   ├── Settings/               # API key, toggles, theme
│   │   ├── Statistics/
│   │   ├── Timeline/
│   │   ├── Whitelist/
│   │   ├── Bookmarks/
│   │   └── Legal/                  # Privacy and Terms, shown inside the popup
│   │                               # each screen: .html · .css · .ts · .test.ts · README.md
│   │
│   ├── warning/
│   │   ├── Warning.html, Warning.css, Warning.ts
│   │   └── ContinueGate.ts         # the 3-second glass-overlay gate
│   │
│   ├── utils/                      # url, domain, hash, time, format, logger helpers
│   └── assets/logo.svg             # source artwork for the icons
│
├── tests/
│   ├── integration/                # VirusTotal client/service, scanners, jobs, storage, messaging
│   ├── security/                   # Continue gate, key secrecy, upload consent,
│   │                               # 6-second limit, Unknown ≠ Safe
│   ├── ui/                         # popup frame, report components, warning page
│   ├── fixtures/                   # VirusTotal-shaped payloads and sample reports
│   └── setup/                      # in-memory chrome.* mock and fake clocks
│
├── preview/                        # dev-only popup preview with a stubbed chrome API
├── scripts/build-icons.mjs         # logo.svg → PNG icons (uses Playwright's Chromium)
├── docs/                           # architecture, scanning engine, security, testing
├── vite.config.ts                  # builds the pages and the service worker
├── vite.content.config.ts          # builds the content script as a single file
├── vite.preview.config.ts          # dev preview server
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

---

## 💻 Development

| Command | What it does |
|---|---|
| `npm run build` | Type-check, then build everything into `dist/` |
| `npm test` | Run the full test suite once |
| `npm run test:watch` | Re-run tests as you edit |
| `npm run typecheck` | Run the TypeScript checks only |
| `npm run build:icons` | Regenerate the PNG icons from `src/assets/logo.svg` (renders with Playwright's Chromium) |

**Preview the popup in a normal browser tab (no extension install needed):**

```bash
npx vite --config vite.preview.config.ts
```

Then open `http://localhost:5178/preview/popup.html`. Add `?screen=settings`, `?screen=advanced`, `?screen=documents` (and so on) or `?theme=light`, or open `http://localhost:5178/preview/warning.html`. The preview runs on sample data and never uses a real key.

**Stack:** TypeScript · Vite · Vitest + jsdom · plain HTML/CSS · **zero runtime dependencies**.

📚 **Deeper reading:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/SCANNING_ENGINE.md`](docs/SCANNING_ENGINE.md) · [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/TESTING.md`](docs/TESTING.md) · each popup screen's own `README.md`.

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| **"Manifest file is missing or unreadable"** | You selected the project root. Select the **`dist`** folder (run `npm run build` first). |
| `npm ci` or `npm run build` fails straight away | Run `node --version` — you need **20.19+** or **22.12+**. |
| Settings shows **No key added**, or scans say *API key required* | Add your VirusTotal key — see [First-run setup](#-first-run-setup). |
| **Invalid key** after pressing refresh | Copy the key again from your VirusTotal profile; it is 64 characters long. |
| **Daily API limit reached** | Free keys allow 4 requests per minute and 500 per day. Wait a minute; the daily quota resets at 00:00 UTC. |
| Firefox never shows warnings | `about:addons` → Webinel → **Permissions** → turn on access to all websites. Also check that **Real-time Protection** is on in Settings. |
| Webinel disappeared from Firefox | Temporary add-ons are removed when Firefox closes. Load it again, or use [Option B](#option-b--keep-it-installed). |
| Document Scanner opens a small **Webinel window** | Expected on Windows and Linux: the browser closes toolbar popups while a file chooser is open, so the chooser runs in this window. Dragging a file onto the popup also works. |
| A file shows no **Upload to VirusTotal** button | VirusTotal already has that exact file, so its existing report is shown and no upload is needed. |
| A known-bad page on a large shared site isn't blocked | Real-time checks look up the **domain** only, for privacy. Use **Scan Now** or **Advanced Analysis** to check the full address. |
| Your changes don't show up | Run `npm run build`, then reload the extension (↻ in Chromium, **Reload** in Firefox's `about:debugging`). |

---

## 🗺 Status

- [x] Real-time protection and the warning page with the 3-second gate
- [x] Scan Now, Advanced Analysis and Document Scanner
- [x] Smart Cache, rate limiting and encrypted key storage
- [x] Chromium and Firefox support
- [x] Developer contact from Settings (email + GitHub)
- [ ] Store listings and the final Firefox add-on ID (`browser_specific_settings.gecko.id` in `public/manifest.json`)
- [ ] Legal review of the Privacy and Terms text (`src/popup/Legal/Legal.html`)
- [ ] Choose a license

---

## 📬 Contact

- ✉ **Email:** [kukkalajeevansai@gmail.com](mailto:kukkalajeevansai@gmail.com) — or use **Settings → Contact Developer** inside the extension.
- 🐙 **GitHub:** [github.com/jeevansai-k](https://github.com/jeevansai-k)

Found a false positive or a missed threat? Please include the domain (never a private link) and what Webinel showed.

---

## 🤝 Contributing

1. Fork the repository and create a branch.
2. Keep business logic in `src/services/` and UI in `src/popup/` — screens only render and send messages.
3. Run `npm run typecheck` and `npm test` before opening a pull request.
4. Never add a backend, analytics, or any network destination other than VirusTotal.

---

<div align="center">

**Webinel** — protect first, respect privacy always.

<sub>VirusTotal is a trademark of its respective owner. Webinel is an independent project and is not affiliated with VirusTotal.</sub>

</div>

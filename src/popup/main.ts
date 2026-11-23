import '../shared/styles/theme.css';
import './popup.css';
import { initTheme } from '../shared/theme';
import { mount as mountAdvancedAnalysis } from './AdvancedAnalysis/AdvancedAnalysis';
import { mount as mountBookmarks } from './Bookmarks/Bookmarks';
import { mount as mountDocumentScanner, pageMode } from './DocumentScanner/DocumentScanner';
import { mount as mountHome } from './Home/Home';
import { mount as mountLegal } from './Legal/Legal';
import { mount as mountScanNow } from './Home/ScanNow/ScanNow';
import { Router, type ScreenMount, type ScreenName } from './router';
import { mount as mountSettings } from './Settings/Settings';
import { mount as mountStatistics } from './Statistics/Statistics';
import { mount as mountTimeline } from './Timeline/Timeline';
import { mount as mountWhitelist } from './Whitelist/Whitelist';

const SCREENS = {
  home: mountHome,
  scan: mountScanNow,
  settings: mountSettings,
  statistics: mountStatistics,
  bookmarks: mountBookmarks,
  whitelist: mountWhitelist,
  timeline: mountTimeline,
  advanced: mountAdvancedAnalysis,
  documents: mountDocumentScanner,
  privacy: (root, ctx) => mountLegal(root, ctx, 'privacy'),
  terms: (root, ctx) => mountLegal(root, ctx, 'terms'),
} satisfies Record<ScreenName, ScreenMount>;

/** The scanner window sizes itself so its page area is exactly 440 × 600. */
async function fitScannerWindow(): Promise<void> {
  const current = await chrome.windows.getCurrent();
  if (current.id === undefined) return;
  const extraWidth = window.outerWidth - window.innerWidth;
  const extraHeight = window.outerHeight - window.innerHeight;
  await chrome.windows.update(current.id, { width: 440 + extraWidth, height: 600 + extraHeight });
}

async function start(): Promise<void> {
  await initTheme();
  const mode = pageMode();
  if (mode !== 'popup') document.documentElement.dataset.mode = mode;
  if (mode === 'window') void fitScannerWindow().catch(() => undefined);
  // Optional deep link (used by the dev preview), e.g. popup/index.html#settings.
  const initial = location.hash.slice(1) as ScreenName;
  const router = new Router(document.getElementById('app')!, SCREENS);
  if (initial in SCREENS && initial !== 'home') router.navigate(initial);
  else void router.show('home', false);
}

void start();

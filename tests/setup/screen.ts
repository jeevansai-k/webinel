import { vi, type Mock } from 'vitest';
import type { ScreenMount, ScreenName } from '../../src/popup/router';
import { chromeFake } from './chromeMock';

export function fakeContext(): { navigate: Mock<(screen: ScreenName) => void>; back: Mock<() => void> } {
  return { navigate: vi.fn<(screen: ScreenName) => void>(), back: vi.fn<() => void>() };
}

export async function mountScreen(mount: ScreenMount) {
  const root = document.createElement('section');
  document.body.append(root);
  const ctx = fakeContext();
  const cleanup = await mount(root, ctx);
  return { root, ctx, cleanup };
}

export function setActiveTab(url: string, title = 'Page', id = 11): void {
  chromeFake().tabs.query.mockResolvedValue([{ id, url, title } as chrome.tabs.Tab]);
}

export const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

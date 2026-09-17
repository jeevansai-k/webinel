import type { Verdict } from '../shared/verdict';
import { getHost, normalizeUrl } from '../utils/url';
import { LocalStore } from './LocalStore';

export interface SecureBookmark {
  id: string;
  title: string;
  url: string;
  host: string;
  createdAt: number;
  lastVerdict: Verdict | null;
  lastCheckedAt: number | null;
}

class BookmarkStore extends LocalStore<SecureBookmark[]> {
  constructor() {
    super('bookmarks', () => []);
  }

  add(rawUrl: string, title: string): Promise<SecureBookmark[]> {
    const url = normalizeUrl(rawUrl);
    const host = url ? getHost(url) : null;
    if (!url || !host) return Promise.reject(new Error('Only http(s) pages can be bookmarked.'));
    return this.update((bookmarks) => {
      if (bookmarks.some((bookmark) => bookmark.url === url)) return bookmarks;
      const bookmark: SecureBookmark = {
        id: crypto.randomUUID(),
        title: title.trim().slice(0, 120) || host,
        url,
        host,
        createdAt: Date.now(),
        lastVerdict: null,
        lastCheckedAt: null,
      };
      return [bookmark, ...bookmarks];
    });
  }

  remove(id: string): Promise<SecureBookmark[]> {
    return this.update((bookmarks) => bookmarks.filter((bookmark) => bookmark.id !== id));
  }

  markChecked(id: string, verdict: Verdict): Promise<SecureBookmark[]> {
    return this.update((bookmarks) =>
      bookmarks.map((bookmark) =>
        bookmark.id === id ? { ...bookmark, lastVerdict: verdict, lastCheckedAt: Date.now() } : bookmark,
      ),
    );
  }
}

export const bookmarkStore = new BookmarkStore();

/** One-shot values passed between popup screens (e.g. a URL to scan). */
export interface Handoffs {
  scanUrl: { url: string; autostart: boolean };
  advancedUrl: { url: string; autostart: boolean };
}

const pending = new Map<keyof Handoffs, unknown>();

export function handOff<K extends keyof Handoffs>(key: K, value: Handoffs[K]): void {
  pending.set(key, value);
}

export function takeHandoff<K extends keyof Handoffs>(key: K): Handoffs[K] | null {
  const value = pending.get(key) as Handoffs[K] | undefined;
  pending.delete(key);
  return value ?? null;
}

const PREFIX = 'vgmini.';

export function loadNumber(key: string): number {
  try {
    return Number(localStorage.getItem(PREFIX + key)) || 0;
  } catch {
    return 0;
  }
}

export function saveNumber(key: string, value: number) {
  try {
    localStorage.setItem(PREFIX + key, String(value));
  } catch {
    // Storage blocked (private mode etc.): progress just won't persist.
  }
}

/** Parsed JSON, or `fallback` if missing, unreadable or blocked. */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Same as saveNumber: silently non-persistent.
  }
}

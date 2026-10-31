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

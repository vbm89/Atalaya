import type { WatchBook } from "./memory";
import { EXPIRED_HOLD_MS } from "./memory";

const KEY = "atalaya:watch-memory:v1";

export function readWatchBook(now = Date.now()): WatchBook {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as WatchBook;
    const out: WatchBook = {};
    for (const id of Object.keys(parsed) as (keyof WatchBook)[]) {
      const row = parsed[id];
      if (!row) continue;
      if (row.phase === "expired" && row.expiredAt != null && now - row.expiredAt >= EXPIRED_HOLD_MS) {
        continue;
      }
      out[id] = row;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeWatchBook(book: WatchBook) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    /* quota */
  }
}

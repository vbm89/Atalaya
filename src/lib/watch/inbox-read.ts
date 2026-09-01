import { inboxItemKey, type InboxItem } from "./inbox";

export const INBOX_READ_KEY = "atalaya:inbox-read:v1";

export function loadReadKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(INBOX_READ_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function persistReadKeys(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INBOX_READ_KEY, JSON.stringify([...keys].slice(0, 200)));
  } catch {
    /* ignore quota */
  }
}

export function markInboxRead(row: InboxItem, existing = loadReadKeys()): Set<string> {
  const next = new Set(existing);
  next.add(inboxItemKey(row));
  persistReadKeys(next);
  return next;
}

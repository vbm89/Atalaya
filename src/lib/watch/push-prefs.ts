import type { SetupState } from "../trading/types";

export interface PushPrefs {
  enabled: boolean;
  entry: boolean;
  pending: boolean;
  map: boolean;
  expired: boolean;
  /** "HH:MM" Europe/Madrid. Null = no quiet window. */
  quietStart: string | null;
  quietEnd: string | null;
  /** Epoch ms. Push skipped until this instant. Events still stored. */
  pausedUntilMs: number | null;
}

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  enabled: true,
  entry: true,
  pending: true,
  map: false,
  expired: false,
  quietStart: null,
  quietEnd: null,
  pausedUntilMs: null,
};

function hm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

export function parsePushPrefs(raw: unknown): PushPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PUSH_PREFS };
  const o = raw as Record<string, unknown>;
  const paused =
    typeof o.pausedUntilMs === "number" && Number.isFinite(o.pausedUntilMs) && o.pausedUntilMs > 0
      ? o.pausedUntilMs
      : null;
  return {
    enabled: o.enabled !== false,
    entry: o.entry !== false,
    pending: o.pending !== false,
    map: o.map === true,
    expired: o.expired === true,
    quietStart: hm(o.quietStart),
    quietEnd: hm(o.quietEnd),
    pausedUntilMs: paused,
  };
}

function madridMinutes(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mi = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + mi;
}

function parseMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function inQuietWindow(nowMs: number, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const s = parseMinutes(start);
  const e = parseMinutes(end);
  if (s == null || e == null || s === e) return false;
  const n = madridMinutes(nowMs);
  if (s < e) return n >= s && n < e;
  return n >= s || n < e;
}

export function shouldPushWithPrefs(
  to: SetupState,
  prefs: PushPrefs = DEFAULT_PUSH_PREFS,
  nowMs = Date.now(),
): boolean {
  if (!prefs.enabled) return false;
  if (prefs.pausedUntilMs != null && nowMs < prefs.pausedUntilMs) return false;
  if (inQuietWindow(nowMs, prefs.quietStart, prefs.quietEnd)) return false;
  /** Caducidad/ESPERAR: bandeja sí, Push nunca — aunque prefs.expired esté a true. */
  if (to === "wait") return false;
  if (to === "entry") return prefs.entry;
  if (to === "pending") return prefs.pending;
  if (to === "map") return prefs.map;
  return false;
}

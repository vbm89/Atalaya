import type { AssetId, DataStatus, SetupState } from "../trading/types";
import { isCmeSessionOpen } from "../trading/integrity";

/**
 * Product session clock. Same zone as Atalaya clocks, quiet hours and
 * Asia/Londres/NY labels — not UTC, not the broker, not the browser.
 */
export const SESSION_TZ = "Europe/Madrid";

export type MarketSessionKind = "open" | "closed" | "unknown";

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function madridCivilTime(now: number): { weekday: number; minutes: number } | null {
  if (!Number.isFinite(now)) return null;
  const bag: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: SESSION_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now))) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const weekday = WEEKDAY[bag.weekday ?? ""];
  let hour = Number(bag.hour);
  const minute = Number(bag.minute);
  if (weekday == null || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour === 24) hour = 0;
  return { weekday, minutes: hour * 60 + minute };
}

/**
 * Fri 23:00 → Mon 00:01 Europe/Madrid (inclusive start, exclusive end).
 * Shared by XAUUSD, US100 and WTI. BTCUSD is not in this window.
 */
export function isMadridWeekendClose(now: number): boolean | null {
  const t = madridCivilTime(now);
  if (!t) return null;
  if (t.weekday === 6 || t.weekday === 0) return true;
  if (t.weekday === 5 && t.minutes >= 23 * 60) return true;
  if (t.weekday === 1 && t.minutes < 1) return true;
  return false;
}

/**
 * Clock-only: is the underlying tradable right now.
 * Last price / proxy ticks are ignored. null = clock could not be read.
 */
export function underlyingSessionOpen(id: AssetId, now = Date.now()): boolean | null {
  if (id === "BTCUSD") return true;
  const weekend = isMadridWeekendClose(now);
  if (weekend == null) return null;
  if (weekend) return false;
  if (id === "XAUUSD") return true;
  if (id === "US100" || id === "WTI") return isCmeSessionOpen(now);
  return null;
}

/**
 * Single source of truth for Inicio tiles and Alertas.
 *
 * Closed session always wins over a last available price.
 * Feed error/insufficient while the clock is open → ESTADO NO DISPONIBLE.
 * Feed `session_closed` is an extra closed signal, not the weekend clock.
 */
export function marketSessionKind(args: {
  id: AssetId;
  dataStatus?: DataStatus | null;
  now?: number;
}): MarketSessionKind {
  const open = underlyingSessionOpen(args.id, args.now ?? Date.now());
  if (open == null) return "unknown";
  if (!open) return "closed";
  const st = args.dataStatus;
  if (st === "error" || st === "insufficient") return "unknown";
  if (st === "session_closed") return "closed";
  return "open";
}

export function marketSessionLabel(kind: MarketSessionKind, compact = false): string {
  if (kind === "open") return compact ? "ABIERTO" : "MERCADO ABIERTO";
  if (kind === "closed") return compact ? "CERRADO" : "MERCADO CERRADO";
  return compact ? "NO DISPONIBLE" : "ESTADO NO DISPONIBLE";
}

export interface SessionChip {
  kind: MarketSessionKind;
  label: string;
}

export interface SetupChip {
  key: "entry" | "pending" | "map" | "wait" | "dir";
  label: string;
  current: boolean;
}

/**
 * Visual hierarchy for a home tile. ENTRY stays first-class even if the
 * underlying is closed. MAPA/PENDING stay visible as last recorded data
 * but are not presented as an active hunt while closed/unknown.
 * WAIT/"Vigilando" only appears when the session is open.
 */
export function tileStatusChips(args: {
  id: AssetId;
  dataStatus?: DataStatus | null;
  setupState: SetupState;
  direction?: "buy" | "sell" | null;
  now?: number;
}): {
  session: SessionChip;
  setups: SetupChip[];
  hunting: boolean;
  dim: boolean;
} {
  const kind = marketSessionKind({
    id: args.id,
    dataStatus: args.dataStatus,
    now: args.now,
  });
  const hunting = kind === "open";
  const setups: SetupChip[] = [];

  if (args.setupState === "entry") {
    setups.push({ key: "entry", label: "ENTRY", current: true });
  } else if (args.setupState === "pending") {
    setups.push({ key: "pending", label: "PENDING", current: hunting });
  } else if (args.setupState === "map") {
    setups.push({ key: "map", label: "MAPA", current: hunting });
  } else if (hunting) {
    setups.push({ key: "wait", label: "Vigilando", current: true });
  }

  if (args.direction && args.setupState !== "wait") {
    setups.push({
      key: "dir",
      label: args.direction === "buy" ? "BUY ↗" : "SELL ↘",
      current: hunting || args.setupState === "entry",
    });
  }

  return {
    session: {
      kind,
      label: kind === "unknown" ? marketSessionLabel(kind, false) : marketSessionLabel(kind, true),
    },
    setups,
    hunting,
    dim: kind === "closed" && args.setupState !== "entry",
  };
}

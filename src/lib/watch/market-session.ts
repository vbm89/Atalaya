import type { AssetId, DataStatus, SetupState } from "../trading/types";
import { isCmeSessionOpen } from "../trading/integrity";

/**
 * Product session clock. Same zone as Atalaya clocks, quiet hours and
 * Asia/Londres/NY labels — not UTC, not the broker, not the browser.
 */
export const SESSION_TZ = "Europe/Madrid";

export type MarketSessionKind = "open" | "closed" | "unknown";

export const CLOSED_PENDING_CAPTION = "Configuración registrada. El mercado está cerrado.";
export const CLOSED_PENDING_EXPLAIN =
  "Existe una configuración pendiente registrada por V1, pero el mercado está cerrado.";

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

export function episodeStateLabel(state: SetupState): string {
  if (state === "entry") return "ENTRY";
  if (state === "pending") return "PENDIENTE";
  if (state === "map") return "MAPA";
  return "ESPERAR";
}

export interface EpisodeMarketView {
  session: MarketSessionKind;
  sessionLabel: string;
  sessionLabelCompact: string;
  episodeLabel: string;
  operable: boolean;
  closedPending: boolean;
  caption: string | null;
  explain: string | null;
}

/**
 * Episode state (V1) vs market session (UI clock). Never mutates V1.
 * A PENDING/MAPA on a closed market stays PENDING/MAPA — it is not operable.
 */
export function episodeMarketView(args: {
  id: AssetId;
  setupState: SetupState;
  dataStatus?: DataStatus | null;
  now?: number;
}): EpisodeMarketView {
  const session = marketSessionKind({
    id: args.id,
    dataStatus: args.dataStatus,
    now: args.now,
  });
  const closedPending =
    session === "closed" && (args.setupState === "pending" || args.setupState === "map");
  const operable =
    session === "open" &&
    (args.setupState === "entry" || args.setupState === "pending" || args.setupState === "map");
  return {
    session,
    sessionLabel: marketSessionLabel(session, false),
    sessionLabelCompact: marketSessionLabel(session, true),
    episodeLabel: episodeStateLabel(args.setupState),
    operable,
    closedPending,
    caption: closedPending ? CLOSED_PENDING_CAPTION : null,
    explain: closedPending ? CLOSED_PENDING_EXPLAIN : null,
  };
}

export type OpportunityCandidate = {
  id: AssetId;
  setupState: SetupState;
  dataStatus?: DataStatus | null;
  label?: string;
  setup?: { direction: "buy" | "sell"; quality: string; riskReward?: number } | null;
};

/**
 * Presentation overlay of V1 pickBest. Does not change V1 ranking stored on
 * the snapshot. A PENDING/MAPA whose market is closed is not an operable
 * current opportunity; when the session reopens the same V1 state can show.
 */
export function pickPresentedOpportunity<T extends OpportunityCandidate>(
  assets: T[],
  v1BestId: AssetId | null,
  now?: number,
): { asset: T | null; note: string } {
  const rank = (s: SetupState) =>
    s === "entry" ? 3 : s === "pending" ? 2 : s === "map" ? 1 : 0;
  const operable = (a: T) =>
    episodeMarketView({
      id: a.id,
      setupState: a.setupState,
      dataStatus: a.dataStatus,
      now,
    }).operable;
  const scored = [...assets].filter(operable).sort((a, b) => {
    const d = rank(b.setupState) - rank(a.setupState);
    if (d !== 0) return d;
    return (b.setup?.riskReward ?? 0) - (a.setup?.riskReward ?? 0);
  });
  const v1 = v1BestId ? scored.find((a) => a.id === v1BestId) : undefined;
  const top = v1 ?? scored[0] ?? null;
  if (!top) {
    return { asset: null, note: "NO HAY NINGUNA ENTRADA CLARA AHORA." };
  }
  const dir =
    top.setup?.direction === "buy" ? "LONG" : top.setup?.direction === "sell" ? "SHORT" : "";
  const state =
    top.setupState === "entry"
      ? "ENTRADA"
      : top.setupState === "pending"
        ? "TRIGGER PENDIENTE"
        : "MAPA";
  const q = top.setup?.quality ? ` · calidad ${String(top.setup.quality).toUpperCase()}` : "";
  const name = top.label ?? top.id;
  const bits = [name, state, dir].filter(Boolean).join(" · ");
  return { asset: top, note: `${bits}${q}` };
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
  operable: boolean;
} {
  const kind = marketSessionKind({
    id: args.id,
    dataStatus: args.dataStatus,
    now: args.now,
  });
  const view = episodeMarketView({
    id: args.id,
    dataStatus: args.dataStatus,
    setupState: args.setupState,
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
    operable: view.operable,
  };
}

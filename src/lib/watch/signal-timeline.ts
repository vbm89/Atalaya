import type { AssetId, SetupState } from "../trading/types";

/**
 * Presentation of V1 identity events. Never invents BOS / zona / T2.
 * MAPA, PENDING and ENTRADA come only from signal_events.to_state.
 * TP1/TP2/SL come only from a timestamped first-touch AFTER a real ENTRY event.
 * EXPIRADA comes from closed_at when outcome is expired — MAPA/PENDING can expire
 * without having been a trade.
 */

export type TimelineKind =
  | "map"
  | "pending"
  | "entry"
  | "tp1"
  | "tp2"
  | "sl"
  | "expired"
  | "wait";

export type TimelineTone = "buy" | "sell" | "wait" | "map" | "muted";

export interface TimelineEvent {
  id: string;
  atMs: number;
  kind: TimelineKind;
  title: string;
  detail: string;
  tone: TimelineTone;
}

export interface TimelineTransition {
  episodeId: string;
  assetId: AssetId;
  fromState: SetupState;
  toState: SetupState;
  atMs: number;
}

export interface TimelineHistoryRow {
  episode: {
    episodeId: string;
    assetId: AssetId;
    openedAtMs: number;
    openedState: SetupState;
    closedAtMs: number | null;
  };
  outcome: string | null;
  firstTouch: string | null;
  firstTouchAtMs: number | null;
  hadV1Entry?: boolean;
}

/** Mockup steps that V1 does not persist as timestamped events. Never become nodes. */
export const UNREGISTERED_TIMELINE_STEPS = ["BOS 4H", "zona de origen", "T2"] as const;

const KIND_RANK: Record<TimelineKind, number> = {
  map: 1,
  pending: 2,
  entry: 3,
  tp1: 4,
  tp2: 5,
  sl: 6,
  wait: 7,
  expired: 8,
};

/** Chart freeze uses episodeId="live" when there is no Neon episode. Not a real id. */
export function resolveTimelineEpisodeId(
  ...ids: Array<string | null | undefined>
): string | null {
  for (const raw of ids) {
    const id = raw?.trim() ?? "";
    if (id.length >= 8 && id !== "live") return id;
  }
  return null;
}

export function formatTimelineHm(atMs: number): string {
  if (!Number.isFinite(atMs)) return "—";
  const raw = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Madrid",
  }).format(new Date(atMs));
  const m = raw.match(/(\d{1,2})\D(\d{2})/);
  if (!m) return raw;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

function specForState(
  to: SetupState,
): { kind: TimelineKind; title: string; detail: string; tone: TimelineTone } | null {
  if (to === "map") return { kind: "map", title: "MAPA", detail: "Zona en vigilancia.", tone: "map" };
  if (to === "pending") {
    return { kind: "pending", title: "PENDING", detail: "Condiciones casi completas.", tone: "wait" };
  }
  if (to === "entry") {
    return { kind: "entry", title: "ENTRADA", detail: "Se registra la entrada.", tone: "buy" };
  }
  if (to === "wait") {
    return {
      kind: "wait",
      title: "ESPERAR",
      detail: "El motor deja de dar el setup por válido.",
      tone: "muted",
    };
  }
  return null;
}

export function buildSignalTimeline(args: {
  assetId: AssetId;
  episodeId: string | null;
  events: TimelineTransition[];
  history: TimelineHistoryRow[];
}): TimelineEvent[] {
  const episodeId = resolveTimelineEpisodeId(args.episodeId);
  if (!episodeId) return [];

  const events = args.events
    .filter((e) => e.episodeId === episodeId && e.assetId === args.assetId)
    .slice()
    .sort((a, b) => a.atMs - b.atMs);

  const focused =
    args.history.find(
      (r) => r.episode.episodeId === episodeId && r.episode.assetId === args.assetId,
    ) ?? null;

  const expiredAt =
    focused?.outcome === "expired" && focused.episode.closedAtMs != null
      ? focused.episode.closedAtMs
      : null;

  const out: TimelineEvent[] = [];

  for (const row of events) {
    const spec = specForState(row.toState);
    if (!spec) continue;
    if (spec.kind === "wait" && expiredAt != null) continue;
    out.push({
      id: `${row.episodeId}-${row.fromState}-${row.toState}-${row.atMs}`,
      atMs: row.atMs,
      ...spec,
    });
  }

  const entryAt = events.find((e) => e.toState === "entry")?.atMs ?? null;
  const hadEntryEvent = entryAt != null;

  if (focused && hadEntryEvent) {
    const touch = focused.firstTouch;
    const at = focused.firstTouchAtMs;
    if (at != null && Number.isFinite(at) && at >= entryAt) {
      if (touch === "tp1") {
        out.push({
          id: `${episodeId}-tp1`,
          atMs: at,
          kind: "tp1",
          title: "TP1",
          detail: "Primer objetivo alcanzado.",
          tone: "buy",
        });
      } else if (touch === "tp2") {
        out.push({
          id: `${episodeId}-tp2`,
          atMs: at,
          kind: "tp2",
          title: "TP2",
          detail: "Segundo objetivo alcanzado.",
          tone: "buy",
        });
      } else if (touch === "sl") {
        out.push({
          id: `${episodeId}-sl`,
          atMs: at,
          kind: "sl",
          title: "SL",
          detail: "Stop alcanzado.",
          tone: "sell",
        });
      }
    }
  }

  if (expiredAt != null) {
    out.push({
      id: `${episodeId}-expired`,
      atMs: expiredAt,
      kind: "expired",
      title: "EXPIRADA",
      detail: "Cerrada sin toque de SL ni TP.",
      tone: "muted",
    });
  }

  out.sort((a, b) => {
    const d = a.atMs - b.atMs;
    if (d !== 0) return d;
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });

  const seen = new Set<string>();
  return out.filter((e) => {
    const key = `${e.kind}-${Math.round(e.atMs / 1000)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

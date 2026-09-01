import type { AssetId, CalendarEvent } from "../trading/types";
import type { EpisodeFreeze } from "../watch/freeze";
import { madridStamp, sessionFromStamp, type SessionName } from "./session";

const CAL_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface CalendarSnap {
  id: string;
  title: string;
  at: string;
  impact: string;
  country: string;
}

export interface FeedSnap {
  dataStatus: string | null;
  dataSource: string | null;
  feedSymbol: string | null;
  instrumentKind: string | null;
}

export interface EpisodeContext {
  episodeId: string;
  capturedAtMs: number;
  madridDate: string | null;
  madridTime: string | null;
  weekday: string | null;
  session: SessionName | null;
  calendar: CalendarSnap[];
  basis: number | null;
  dataStatus: string | null;
  warnings: string[] | null;
  feed: FeedSnap;
  gitSha: string | null;
  v1Label: string;
}

function eventMs(at: string): number | null {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : null;
}

export function nearbyCalendar(
  events: CalendarEvent[] | undefined,
  assetId: AssetId,
  atMs: number,
): CalendarSnap[] {
  if (!events?.length || !Number.isFinite(atMs)) return [];
  const out: CalendarSnap[] = [];
  for (const e of events) {
    const t = eventMs(e.at);
    if (t == null) continue;
    if (Math.abs(t - atMs) > CAL_WINDOW_MS) continue;
    if (e.assets?.length && !e.assets.includes(assetId)) continue;
    out.push({
      id: e.id,
      title: e.title,
      at: e.at,
      impact: e.impact,
      country: e.country,
    });
  }
  return out.sort((a, b) => (eventMs(a.at) ?? 0) - (eventMs(b.at) ?? 0));
}

export function snapshotContext(args: {
  episodeId: string;
  assetId: AssetId;
  openedAtMs: number;
  freeze: EpisodeFreeze | null;
  calendar: CalendarEvent[] | undefined;
  gitSha: string | null;
  v1Label: string;
}): EpisodeContext {
  const stamp = madridStamp(args.openedAtMs);
  const freeze = args.freeze;
  return {
    episodeId: args.episodeId,
    capturedAtMs: args.openedAtMs,
    madridDate: stamp?.date ?? null,
    madridTime: stamp?.time ?? null,
    weekday: stamp?.weekday ?? null,
    session: stamp ? sessionFromStamp(stamp) : null,
    calendar: nearbyCalendar(args.calendar, args.assetId, args.openedAtMs),
    basis: freeze?.basis ?? null,
    dataStatus: freeze?.dataStatus ?? null,
    warnings: freeze?.warnings ?? null,
    feed: {
      dataStatus: freeze?.dataStatus ?? null,
      dataSource: freeze?.dataSource ?? null,
      feedSymbol: freeze?.feedSymbol ?? null,
      instrumentKind: freeze?.instrumentKind ?? null,
    },
    gitSha: args.gitSha,
    v1Label: args.v1Label,
  };
}

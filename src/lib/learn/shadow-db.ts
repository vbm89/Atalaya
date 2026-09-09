import type { SqlQuery } from "../watch/store";
import type { ShadowCaseInput } from "./shadow-features";
import type { ShadowEpisode, ShadowSignalEvent, ShadowTapeBar } from "./shadow-replay";

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v !== "") return Number(v);
  return 0;
}

function nullableNum(v: unknown): number | null {
  if (v == null) return null;
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}

function ms(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" || typeof v === "number") {
    const n = new Date(v).getTime();
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function json<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function entryPrice(direction: "buy" | "sell", low: number, high: number): number {
  return direction === "sell" ? low : high;
}

export async function loadShadowEpisodes(sql: SqlQuery): Promise<ShadowEpisode[]> {
  const episodes = await sql.query<Record<string, unknown>>(
    `select * from signal_episodes order by opened_at asc, episode_id asc`,
  );
  if (!episodes.length) return [];
  const ids = episodes.map((r) => String(r.episode_id));

  const events = await sql.query<Record<string, unknown>>(
    `select episode_id, from_state, to_state, at, slot
       from signal_events
      where episode_id = any($1::text[])
      order by episode_id, slot, id`,
    [ids],
  );

  const tape = await sql.query<Record<string, unknown>>(
    `select episode_id, tf, t, o, h, l, c, v, role
       from episode_tape_bars
      where episode_id = any($1::text[])
      order by episode_id, tf, t`,
    [ids],
  );

  // The Watch archive accumulates every seen M15 candle. Use it as a
  // read-only backfill for the 72h horizon so a closed episode keeps gaining
  // future tape as time passes. This never rewrites V1 or signal outcomes.
  const minOpened = Math.min(...episodes.map((r) => ms(r.opened_at)).filter((v) => v > 0));
  const archive = Number.isFinite(minOpened) && minOpened > 0
    ? await sql.query<Record<string, unknown>>(
        `select asset_id, t, o, h, l, c, v
           from market_m15
          where t >= floor(extract(epoch from $1::timestamptz))::bigint
          order by asset_id, t`,
        [new Date(minOpened - 72 * 60 * 60 * 1000).toISOString()],
      )
    : [];

  const outcomes = await sql.query<Record<string, unknown>>(
    `select episode_id, outcome from signal_outcomes where episode_id = any($1::text[])`,
    [ids],
  );

  const eventMap = new Map<string, ShadowSignalEvent[]>();
  for (const r of events) {
    const id = String(r.episode_id);
    const list = eventMap.get(id) ?? [];
    list.push({
      episodeId: id,
      fromState: String(r.from_state),
      toState: String(r.to_state),
      atMs: ms(r.at),
      slot: num(r.slot),
    });
    eventMap.set(id, list);
  }

  const tapeMap = new Map<string, ShadowTapeBar[]>();
  for (const r of tape) {
    const id = String(r.episode_id);
    const list = tapeMap.get(id) ?? [];
    list.push({
      episodeId: id,
      tf: r.tf as ShadowTapeBar["tf"],
      t: num(r.t),
      o: num(r.o),
      h: num(r.h),
      l: num(r.l),
      c: num(r.c),
      v: nullableNum(r.v),
      role: r.role as ShadowTapeBar["role"],
    });
    tapeMap.set(id, list);
  }

  const outcomeMap = new Map(outcomes.map((r) => [String(r.episode_id), String(r.outcome)]));
  const episodeMeta = new Map(episodes.map((r) => [String(r.episode_id), {
    assetId: r.asset_id as ShadowCaseInput["assetId"],
    openedSlot: num(r.opened_slot),
  }]));

  // Add archived M15 forward bars per episode, without duplicating rows already
  // stored in the episode tape. Limit each episode to its own 72h horizon.
  for (const r of archive) {
    const assetId = r.asset_id as ShadowCaseInput["assetId"];
    const t = num(r.t);
    for (const [id, meta] of episodeMeta) {
      if (meta.assetId !== assetId || t <= meta.openedSlot) continue;
      const openedMs = episodes.find((e) => String(e.episode_id) === id)?.opened_at;
      const openedAtMs = openedMs == null ? 0 : ms(openedMs);
      if (!openedAtMs || t > Math.floor((openedAtMs + 72 * 60 * 60 * 1000) / 1000)) continue;
      const list = tapeMap.get(id) ?? [];
      if (list.some((b) => b.tf === "15m" && b.t === t)) continue;
      list.push({
        episodeId: id,
        tf: "15m",
        t,
        o: num(r.o),
        h: num(r.h),
        l: num(r.l),
        c: num(r.c),
        v: nullableNum(r.v),
        role: "forward",
      });
      tapeMap.set(id, list);
    }
  }

  return episodes.map((r) => {
    const id = String(r.episode_id);
    const direction = r.direction as ShadowCaseInput["direction"];
    const freeze = json<Record<string, unknown> | null>(r.episode_freeze, null);
    const c: ShadowCaseInput = {
      episodeId: id,
      assetId: r.asset_id as ShadowCaseInput["assetId"],
      direction,
      kind: String(r.kind),
      openedAtMs: ms(r.opened_at),
      openedSlot: num(r.opened_slot),
      openedState: r.opened_state as ShadowCaseInput["openedState"],
      currentState: r.current_state as ShadowCaseInput["currentState"],
      closedAtMs: r.closed_at == null ? null : ms(r.closed_at),
      bias4hLabel: freeze?.bias4hLabel == null ? null : String(freeze.bias4hLabel),
      qualityPhase: freeze?.qualityPhase == null ? null : String(freeze.qualityPhase),
      volumeRatio15: nullableNum(freeze?.volumeRatio15),
      volumeAvailable15: bool(freeze?.volumeAvailable15),
      volumeRatio4h: nullableNum(freeze?.volumeRatio4h),
      volumeAvailable4h: bool(freeze?.volumeAvailable4h),
      highImpact: bool(freeze?.highImpact),
      underlyingClosed: bool(freeze?.underlyingClosed),
      dataStatus: freeze?.dataStatus == null ? null : String(freeze.dataStatus),
      zoneLow: num(r.zone_low),
      zoneHigh: num(r.zone_high),
      entry: entryPrice(direction, num(r.zone_low), num(r.zone_high)),
      sl: num(r.sl),
      tp1: num(r.tp1),
      tp2: nullableNum(r.tp2),
      invalidation: nullableNum(freeze?.invalidation),
      riskReward: nullableNum(freeze?.riskReward),
      quality: freeze?.quality == null ? null : String(freeze.quality),
      slWide: bool(freeze?.slWide),
    };
    return {
      case: c,
      events: eventMap.get(id) ?? [],
      bars: (tapeMap.get(id) ?? []).sort((a, b) => a.t - b.t),
      observedOutcome: outcomeMap.get(id) ?? null,
    };
  });
}

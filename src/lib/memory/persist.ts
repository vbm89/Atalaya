import type { AssetId, CalendarEvent, Candle } from "../trading/types";
import type { EpisodeDraft } from "../watch/episode";
import type { HistoryRow, SqlQuery } from "../watch/store";
import { snapshotContext, type EpisodeContext } from "./context";
import { mergeJournal, type JournalClearField, type JournalEntry } from "./journal";
import { buildPostMortem, type PostMortem } from "./postmortem";
import { V1_LABEL, readGitSha } from "./sha";
import {
  detectGaps,
  forwardOf,
  lookbackOf,
  uniqueByTime,
  type TapeBar,
  type TapeTf,
} from "./tape";

const CHUNK = 80;
const TERMINAL = new Set(["tp1", "tp2", "sl", "expired"]);

function parseJsonField<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function validOhlc(c: Candle): boolean {
  return [c.time, c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n));
}

function valuesClause(rowCount: number, colCount: number, casts: Record<number, string> = {}): string {
  const parts: string[] = [];
  for (let r = 0; r < rowCount; r += 1) {
    const cells: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      cells.push(`$${r * colCount + c + 1}${casts[c] ?? ""}`);
    }
    parts.push(`(${cells.join(",")})`);
  }
  return parts.join(",");
}

async function insertChunks(
  sql: SqlQuery,
  prefix: string,
  colCount: number,
  rows: unknown[][],
  casts: Record<number, string>,
  returning: string,
): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params = slice.flat();
    const result = await sql.query(
      `${prefix} ${valuesClause(slice.length, colCount, casts)}
       on conflict do nothing
       returning ${returning}`,
      params,
    );
    n += result.length;
  }
  return n;
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.info("[memory] step failed", {
      label,
      error: e instanceof Error ? e.message : "error",
    });
  }
}

export async function persistEvalVersion(
  sql: SqlQuery,
  slot: number,
  nowMs: number,
  gitSha: string | null,
): Promise<void> {
  await sql.query(
    `insert into watch_eval_versions (slot, git_sha, v1_label, recorded_at)
     values ($1, $2, $3, $4::timestamptz)
     on conflict (slot) do nothing`,
    [slot, gitSha, V1_LABEL, iso(nowMs)],
  );
}

export async function persistArchiveM15(
  sql: SqlQuery,
  assetId: AssetId,
  candles: Candle[] | undefined,
  source: string | null,
  instrument: string | null,
  nowMs: number,
): Promise<number> {
  if (!candles?.length) return 0;
  const seen = new Set<number>();
  const rows: unknown[][] = [];
  const ingested = iso(nowMs);
  for (const c of candles) {
    if (!validOhlc(c) || c.time <= 0 || seen.has(c.time)) continue;
    seen.add(c.time);
    rows.push([
      assetId,
      c.time,
      c.open,
      c.high,
      c.low,
      c.close,
      Number.isFinite(c.volume) ? c.volume : null,
      source,
      instrument,
      ingested,
    ]);
  }
  if (!rows.length) return 0;
  return insertChunks(
    sql,
    `insert into market_m15 (asset_id, t, o, h, l, c, v, source, instrument, ingested_at) values`,
    10,
    rows,
    { 9: "::timestamptz" },
    "t",
  );
}

async function insertTapeBars(
  sql: SqlQuery,
  episodeId: string,
  bars: TapeBar[],
  nowMs: number,
): Promise<number> {
  const unique = uniqueByTime(bars);
  if (!unique.length) return 0;
  const ingested = iso(nowMs);
  const rows = unique.map((b) => [
    episodeId,
    b.tf,
    b.t,
    b.o,
    b.h,
    b.l,
    b.c,
    b.v,
    b.role,
    ingested,
  ]);
  return insertChunks(
    sql,
    `insert into episode_tape_bars (
       episode_id, tf, t, o, h, l, c, v, role, ingested_at
     ) values`,
    10,
    rows,
    { 9: "::timestamptz" },
    "t",
  );
}

async function insertGaps(
  sql: SqlQuery,
  episodeId: string,
  tf: TapeTf,
  role: "lookback" | "forward",
  times: number[],
  nowMs: number,
): Promise<void> {
  const gaps = detectGaps(times, tf);
  if (!gaps.length) return;
  const noted = iso(nowMs);
  const rows = gaps.map((t) => [episodeId, tf, t, role, noted]);
  await insertChunks(
    sql,
    `insert into episode_tape_gaps (episode_id, tf, t, role, noted_at) values`,
    5,
    rows,
    { 4: "::timestamptz" },
    "t",
  );
}

export async function persistTapeForEpisode(
  sql: SqlQuery,
  episode: EpisodeDraft,
  series: Partial<Record<TapeTf, Candle[]>>,
  nowMs: number,
): Promise<void> {
  const tfs: TapeTf[] = ["15m", "1h", "4h"];
  for (const tf of tfs) {
    const candles = series[tf] ?? [];
    const look = lookbackOf(candles, tf, episode.openedSlot);
    const fwd = forwardOf(candles, tf, episode.openedSlot);
    await insertTapeBars(sql, episode.episodeId, look, nowMs);
    await insertTapeBars(sql, episode.episodeId, fwd, nowMs);
    await insertGaps(sql, episode.episodeId, tf, "lookback", look.map((b) => b.t), nowMs);
    await insertGaps(sql, episode.episodeId, tf, "forward", fwd.map((b) => b.t), nowMs);
  }
}

export async function persistContextOnce(sql: SqlQuery, ctx: EpisodeContext): Promise<boolean> {
  const rows = await sql.query(
    `insert into episode_context (
       episode_id, captured_at, madrid_date, madrid_time, weekday, session,
       calendar, basis, data_status, warnings, feed, git_sha, v1_label
     ) values (
       $1, $2::timestamptz, $3, $4, $5, $6,
       $7::jsonb, $8, $9, $10::jsonb, $11::jsonb, $12, $13
     )
     on conflict (episode_id) do nothing
     returning episode_id`,
    [
      ctx.episodeId,
      iso(ctx.capturedAtMs),
      ctx.madridDate,
      ctx.madridTime,
      ctx.weekday,
      ctx.session,
      JSON.stringify(ctx.calendar),
      ctx.basis,
      ctx.dataStatus,
      JSON.stringify(ctx.warnings),
      JSON.stringify(ctx.feed),
      ctx.gitSha,
      ctx.v1Label,
    ],
  );
  return rows.length > 0;
}

export async function persistPostMortemOnce(
  sql: SqlQuery,
  body: PostMortem,
  nowMs: number,
): Promise<boolean> {
  if (body.outcome === "PENDIENTE") return false;
  const rows = await sql.query(
    `insert into episode_postmortem (episode_id, generated_at, body)
     values ($1, $2::timestamptz, $3::jsonb)
     on conflict (episode_id) do nothing
     returning episode_id`,
    [body.episodeId, iso(nowMs), JSON.stringify(body)],
  );
  return rows.length > 0;
}

export async function upsertJournal(
  sql: SqlQuery,
  row: JournalEntry,
  clear: readonly JournalClearField[] = [],
): Promise<JournalEntry> {
  const existing = await loadJournal(sql, row.episodeId);
  const merged = mergeJournal(existing, row, clear);
  await sql.query(
    `insert into episode_journal (
       episode_id, action, lots, entry_price, exit_price, note, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz)
     on conflict (episode_id) do update set
       action = excluded.action,
       lots = excluded.lots,
       entry_price = excluded.entry_price,
       exit_price = excluded.exit_price,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    [merged.episodeId, merged.action, merged.lots, merged.entryPrice, merged.exitPrice, merged.note, iso(merged.updatedAtMs)],
  );
  return merged;
}

export interface MemoryLoad {
  m15ByAsset: Partial<Record<AssetId, Candle[]>>;
  h1ByAsset?: Partial<Record<AssetId, Candle[]>>;
  h4ByAsset?: Partial<Record<AssetId, Candle[]>>;
  calendar?: CalendarEvent[];
  sourceByAsset?: Partial<Record<AssetId, string | null>>;
  instrumentByAsset?: Partial<Record<AssetId, string | null>>;
}

export interface MemoryTickWork {
  slot: number;
  nowMs: number;
  loaded: MemoryLoad;
  born: EpisodeDraft[];
  touched: EpisodeDraft[];
}

export async function rememberAfterTick(sql: SqlQuery, work: MemoryTickWork): Promise<void> {
  const gitSha = readGitSha();
  await step("eval-version", () => persistEvalVersion(sql, work.slot, work.nowMs, gitSha));

  const ids: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];
  for (const id of ids) {
    await step(`archive-${id}`, async () => {
      await persistArchiveM15(
        sql,
        id,
        work.loaded.m15ByAsset[id],
        work.loaded.sourceByAsset?.[id] ?? null,
        work.loaded.instrumentByAsset?.[id] ?? null,
        work.nowMs,
      );
    });
  }

  for (const ep of work.touched) {
    await step(`tape-${ep.episodeId}`, () =>
      persistTapeForEpisode(
        sql,
        ep,
        {
          "15m": work.loaded.m15ByAsset[ep.assetId],
          "1h": work.loaded.h1ByAsset?.[ep.assetId],
          "4h": work.loaded.h4ByAsset?.[ep.assetId],
        },
        work.nowMs,
      ),
    );
  }

  for (const ep of work.born) {
    await step(`context-${ep.episodeId}`, async () => {
      const ctx = snapshotContext({
        episodeId: ep.episodeId,
        assetId: ep.assetId,
        openedAtMs: ep.openedAtMs,
        freeze: ep.freeze,
        calendar: work.loaded.calendar,
        gitSha,
        v1Label: V1_LABEL,
      });
      await persistContextOnce(sql, ctx);
    });
  }
}

export async function loadTape(sql: SqlQuery, episodeId: string): Promise<TapeBar[]> {
  const rows = await sql.query<Record<string, unknown>>(
    `select tf, t, o, h, l, c, v, role from episode_tape_bars
     where episode_id = $1 order by tf, t`,
    [episodeId],
  );
  return rows.map((r) => ({
    tf: r.tf as TapeTf,
    t: Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.v == null ? null : Number(r.v),
    role: r.role as "lookback" | "forward",
  }));
}

export async function loadContext(sql: SqlQuery, episodeId: string): Promise<EpisodeContext | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select * from episode_context where episode_id = $1`,
    [episodeId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    episodeId,
    capturedAtMs: new Date(String(r.captured_at)).getTime(),
    madridDate: (r.madrid_date as string) ?? null,
    madridTime: (r.madrid_time as string) ?? null,
    weekday: (r.weekday as string) ?? null,
    session: (r.session as EpisodeContext["session"]) ?? null,
    calendar: parseJsonField(r.calendar, []),
    basis: r.basis == null ? null : Number(r.basis),
    dataStatus: (r.data_status as string) ?? null,
    warnings: parseJsonField(r.warnings, null),
    feed: parseJsonField(r.feed, {
      dataStatus: null,
      dataSource: null,
      feedSymbol: null,
      instrumentKind: null,
    }),
    gitSha: (r.git_sha as string) ?? null,
    v1Label: String(r.v1_label ?? V1_LABEL),
  };
}

export async function loadJournal(sql: SqlQuery, episodeId: string): Promise<JournalEntry | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select * from episode_journal where episode_id = $1`,
    [episodeId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    episodeId,
    action: r.action as JournalEntry["action"],
    lots: r.lots == null ? null : Number(r.lots),
    entryPrice: r.entry_price == null ? null : Number(r.entry_price),
    exitPrice: r.exit_price == null ? null : Number(r.exit_price),
    note: (r.note as string) ?? null,
    updatedAtMs: new Date(String(r.updated_at)).getTime(),
  };
}

export async function loadPostMortem(sql: SqlQuery, episodeId: string): Promise<PostMortem | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select body from episode_postmortem where episode_id = $1`,
    [episodeId],
  );
  const body = rows[0]?.body;
  if (body == null) return null;
  return parseJsonField<PostMortem | null>(body, null);
}

async function loadHistoryRow(sql: SqlQuery, episodeId: string): Promise<HistoryRow | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select e.episode_id, e.asset_id, e.direction, e.kind, e.zone_low, e.zone_high, e.sl, e.tp1, e.tp2,
            e.opened_at, e.opened_state, e.current_state, e.closed_at, e.levels_key, e.opened_slot, e.episode_freeze,
            o.outcome, o.first_touch, o.first_touch_at, o.mfe, o.mae
     from signal_episodes e
     left join signal_outcomes o on o.episode_id = e.episode_id
     where e.episode_id = $1`,
    [episodeId],
  );
  const r = rows[0];
  if (!r) return null;
  const openedAt = new Date(String(r.opened_at)).getTime();
  const closedAt = r.closed_at == null ? null : new Date(String(r.closed_at)).getTime();
  const freeze = parseJsonField<EpisodeDraft["freeze"]>(r.episode_freeze, null);
  return {
    episode: {
      episodeId: String(r.episode_id),
      assetId: r.asset_id as EpisodeDraft["assetId"],
      direction: r.direction as "buy" | "sell",
      kind: String(r.kind),
      zoneLow: Number(r.zone_low),
      zoneHigh: Number(r.zone_high),
      sl: Number(r.sl),
      tp1: Number(r.tp1),
      tp2: r.tp2 == null ? null : Number(r.tp2),
      openedAtMs: openedAt,
      openedState: r.opened_state as EpisodeDraft["openedState"],
      currentState: r.current_state as EpisodeDraft["currentState"],
      closedAtMs: closedAt,
      levelsKey: String(r.levels_key),
      openedSlot: Number(r.opened_slot),
      freeze,
    },
    outcome: r.outcome == null ? null : String(r.outcome),
    firstTouch: r.first_touch == null ? null : String(r.first_touch),
    firstTouchAtMs: r.first_touch_at == null ? null : new Date(String(r.first_touch_at)).getTime(),
    mfe: r.mfe == null ? null : Number(r.mfe),
    mae: r.mae == null ? null : Number(r.mae),
  };
}

export async function loadHistoryRowForMemory(sql: SqlQuery, episodeId: string): Promise<HistoryRow | null> {
  return loadHistoryRow(sql, episodeId);
}

async function writeOnePostMortem(
  sql: SqlQuery,
  episodeId: string,
  nowMs: number,
  freeze: EpisodeDraft["freeze"] | undefined,
): Promise<void> {
  const existing = await loadPostMortem(sql, episodeId);
  if (existing) return;
  const row = await loadHistoryRow(sql, episodeId);
  if (!row) return;
  const outcome = row.outcome;
  if (!outcome || !TERMINAL.has(outcome)) return;
  const tape = await loadTape(sql, episodeId);
  const context = await loadContext(sql, episodeId);
  const journal = await loadJournal(sql, episodeId);
  const body = buildPostMortem({
    row,
    context,
    tape,
    journal,
    freeze: freeze ?? row.episode.freeze,
  });
  await persistPostMortemOnce(sql, body, nowMs);
}

export async function writeTerminalPostMortems(
  sql: SqlQuery,
  touched: EpisodeDraft[],
  nowMs: number,
): Promise<void> {
  const seen = new Set<string>();
  for (const ep of touched) {
    if (seen.has(ep.episodeId)) continue;
    seen.add(ep.episodeId);
    await step(`postmortem-${ep.episodeId}`, () => writeOnePostMortem(sql, ep.episodeId, nowMs, ep.freeze));
  }
  try {
    const pending = await sql.query<{ episode_id: string }>(
      `select e.episode_id
         from signal_episodes e
         join signal_outcomes o on o.episode_id = e.episode_id
         left join episode_postmortem p on p.episode_id = e.episode_id
        where o.outcome in ('tp1', 'tp2', 'sl', 'expired')
          and p.episode_id is null
        limit 20`,
    );
    for (const row of pending) {
      if (seen.has(row.episode_id)) continue;
      seen.add(row.episode_id);
      await step(`postmortem-sweep-${row.episode_id}`, () =>
        writeOnePostMortem(sql, row.episode_id, nowMs, undefined),
      );
    }
  } catch (e) {
    console.info("[memory] postmortem sweep failed", {
      error: e instanceof Error ? e.message : "error",
    });
  }
}

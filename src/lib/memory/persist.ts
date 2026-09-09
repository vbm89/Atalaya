import type { AssetId, CalendarEvent, Candle } from "../trading/types";
import type { EpisodeDraft } from "../watch/episode";
import type { HistoryRow, SqlQuery } from "../watch/store";
import { diagnoseBornSidecar, logCaptureIssues } from "../watch/capture-issues";
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
const HORIZON_TAPE_MS = 72 * 60 * 60 * 1000;

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

/**
 * Extend the forward 15M tape for every episode opened in the last 72h.
 * `market_m15` is the immutable Watch archive; this only copies already-seen
 * candles into the episode tape and never changes V1 state or outcomes.
 */
export async function persistHorizonTape72h(sql: SqlQuery, nowMs: number): Promise<void> {
  await sql.query(
    `insert into episode_tape_bars (
       episode_id, tf, t, o, h, l, c, v, role, ingested_at
     )
     select e.episode_id, '15m', m.t, m.o, m.h, m.l, m.c, m.v, 'forward', $1::timestamptz
       from signal_episodes e
       join market_m15 m on m.asset_id = e.asset_id
      where e.opened_at >= $2::timestamptz
        and m.t > e.opened_slot
        and m.t <= floor(extract(epoch from $1::timestamptz))::bigint
      on conflict do nothing`,
    [iso(nowMs), iso(nowMs - HORIZON_TAPE_MS)],
  );
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

  await step("horizon-tape-72h", () => persistHorizonTape72h(sql, work.nowMs));

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

  try {
    const sidecar: Array<{ episodeId: string; tape15mCount: number; hasContext: boolean }> = [];
    for (const ep of work.born) {
      const tape = await loadTape(sql, ep.episodeId);
      const ctx = await loadContext(sql, ep.episodeId);
      sidecar.push({
        episodeId: ep.episodeId,
        tape15mCount: tape.filter((b) => b.tf === "15m").length,
        hasContext: ctx != null,
      });
    }
    logCaptureIssues(diagnoseBornSidecar(sidecar));
  } catch (e) {
    console.info("[capture] diagnose failed", {
      error: e instanceof Error ? e.message : "error",
      repair: false,
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
    note: (r.note as string | null) ?? null,
    updatedAtMs: new Date(String(r.updated_at)).getTime(),
  };
}

export async function writeTerminalPostMortems(
  sql: SqlQuery,
  episodes: EpisodeDraft[],
  nowMs: number,
): Promise<void> {
  for (const ep of episodes) {
    const rows = await sql.query<Record<string, unknown>>(
      `select e.*, o.outcome, o.first_touch, o.first_touch_at, o.mfe, o.mae,
              exists (
                select 1 from signal_events ev
                where ev.episode_id = e.episode_id and ev.to_state = 'entry'
              ) as had_v1_entry
       from signal_episodes e
       left join signal_outcomes o on o.episode_id = e.episode_id
       where e.episode_id = $1
       limit 1`,
      [ep.episodeId],
    );
    const row = rows[0];
    if (!row || !TERMINAL.has(String(row.outcome ?? ""))) continue;
    const history: HistoryRow = {
      episode: {
        ...ep,
        openedAtMs: new Date(String(row.opened_at)).getTime(),
        closedAtMs: row.closed_at == null ? null : new Date(String(row.closed_at)).getTime(),
      },
      outcome: row.outcome == null ? null : String(row.outcome),
      firstTouch: row.first_touch == null ? null : String(row.first_touch),
      firstTouchAtMs: row.first_touch_at == null ? null : new Date(String(row.first_touch_at)).getTime(),
      mfe: row.mfe == null ? null : Number(row.mfe),
      mae: row.mae == null ? null : Number(row.mae),
      hadV1Entry: row.had_v1_entry === true,
    };
    const body = buildPostMortem(history);
    await step(`postmortem-${ep.episodeId}`, () => persistPostMortemOnce(sql, body, nowMs).then(() => undefined));
  }
}

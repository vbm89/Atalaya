import type { AssetId, SetupProposal, SetupState } from "../trading/types";
import type { EpisodeFreeze } from "./freeze";
import type { InboxItem } from "./inbox";
import type { OutcomeResult } from "./outcome";
import type { EpisodeDraft, SignalEventDraft, SnapshotDraft } from "./episode";
import { DEFAULT_PUSH_PREFS, parsePushPrefs, type PushPrefs } from "./push-prefs";

export interface HistoryRow {
  episode: EpisodeDraft;
  outcome: string | null;
  firstTouch: string | null;
  firstTouchAtMs: number | null;
  mfe: number | null;
  mae: number | null;
}

export type EvalStatus = "pending" | "ok" | "failed" | "lag";

export interface EvalRow {
  slot: number;
  startedAtMs: number;
  ranAtMs: number;
  status: EvalStatus;
  error: string | null;
  durationMs: number | null;
  retryCount: number;
  assets: unknown;
}

export type Claim =
  | { kind: "acquired"; retryCount: number }
  | { kind: "duplicate"; eval: EvalRow }
  | { kind: "in_flight"; eval: EvalRow }
  | { kind: "exhausted"; eval: EvalRow };

export interface PushSubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NotifyDebugRow {
  episodeId: string;
  assetId: AssetId;
  fromState: SetupState;
  toState: SetupState;
  atMs: number;
  notified: boolean;
  notifyStatus: string;
  notifyAttempts: number;
  notifyLastError: string | null;
}

export interface WatchStore {
  claimEval(slot: number, nowMs: number): Promise<Claim>;
  completeEval(
    slot: number,
    nowMs: number,
    status: "ok" | "failed" | "lag",
    error: string | null,
    durationMs: number,
    assets: unknown,
  ): Promise<void>;
  getEval(slot: number): Promise<EvalRow | null>;
  lastCompletedEval(): Promise<EvalRow | null>;
  lastOkEval(): Promise<EvalRow | null>;
  getOpenEpisode(assetId: AssetId): Promise<EpisodeDraft | null>;
  getEpisode(episodeId: string): Promise<EpisodeDraft | null>;
  upsertEpisode(row: EpisodeDraft): Promise<void>;
  insertEvent(row: SignalEventDraft): Promise<boolean>;
  claimNotify(
    episodeId: string,
    slot: number,
    fromState: SetupState,
    toState: SetupState,
    nowMs: number,
  ): Promise<boolean>;
  markNotifySent(
    episodeId: string,
    slot: number,
    fromState: SetupState,
    toState: SetupState,
    nowMs: number,
  ): Promise<void>;
  markNotifyFailed(
    episodeId: string,
    slot: number,
    fromState: SetupState,
    toState: SetupState,
    error: string,
  ): Promise<void>;
  listRetryableEvents(nowMs: number): Promise<SignalEventDraft[]>;
  getAlertPinHash(): Promise<string | null>;
  setAlertPinHash(hash: string): Promise<boolean>;
  upsertOutcome(episodeId: string, nowMs: number, result: OutcomeResult): Promise<void>;
  listHistory(limit: number): Promise<HistoryRow[]>;
  listInbox(limit: number): Promise<InboxItem[]>;
  getPushPrefs(): Promise<PushPrefs>;
  setPushPrefs(prefs: PushPrefs): Promise<void>;
  upsertSnapshot(row: SnapshotDraft): Promise<void>;
  listSnapshots(): Promise<SnapshotDraft[]>;
  countOpenEpisodes(): Promise<number>;
  getSnapshot(assetId: AssetId): Promise<SnapshotDraft | null>;
  upsertPushSub(row: PushSubRow, userAgent: string | null): Promise<void>;
  listActivePushSubs(): Promise<PushSubRow[]>;
  disablePushSub(endpoint: string, error: string | null): Promise<void>;
  deletePushSub(endpoint: string): Promise<void>;
  countPushSubs(): Promise<{ active: number; disabled: number }>;
  hasPushSub(endpoint: string): Promise<boolean>;
  listNotifyDebug(limit: number): Promise<NotifyDebugRow[]>;
}

export const MAX_LAG_RETRIES = 2;
export const STALE_PENDING_MS = 90_000;
export const MAX_NOTIFY_ATTEMPTS = 5;
export const NOTIFY_CLAIM_STALE_MS = 120_000;

export interface SqlQuery {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

function num(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") return Number(v);
  return 0;
}

function ms(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" || typeof v === "number") {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function parseJson<T>(v: unknown, fallback: T): T {
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

function iso(msValue: number): string {
  return new Date(msValue).toISOString();
}

function rowToEval(r: Record<string, unknown>): EvalRow {
  return {
    slot: num(r.slot),
    startedAtMs: ms(r.started_at),
    ranAtMs: ms(r.ran_at),
    status: r.status as EvalStatus,
    error: (r.error as string | null) ?? null,
    durationMs: r.duration_ms == null ? null : num(r.duration_ms),
    retryCount: num(r.retry_count),
    assets: parseJson(r.assets, []),
  };
}

function rowToEpisode(r: Record<string, unknown>): EpisodeDraft {
  return {
    episodeId: String(r.episode_id),
    assetId: r.asset_id as AssetId,
    direction: r.direction as "buy" | "sell",
    kind: String(r.kind),
    zoneLow: num(r.zone_low),
    zoneHigh: num(r.zone_high),
    sl: num(r.sl),
    tp1: num(r.tp1),
    tp2: r.tp2 == null ? null : num(r.tp2),
    openedAtMs: ms(r.opened_at),
    openedState: r.opened_state as SetupState,
    currentState: r.current_state as SetupState,
    closedAtMs: r.closed_at == null ? null : ms(r.closed_at),
    levelsKey: String(r.levels_key),
    openedSlot: num(r.opened_slot),
    freeze: parseJson<EpisodeFreeze | null>(r.episode_freeze, null),
  };
}

function rowToSnapshot(r: Record<string, unknown>): SnapshotDraft {
  return {
    assetId: r.asset_id as AssetId,
    state: r.state as SetupState,
    setup: parseJson<SetupProposal | null>(r.setup, null),
    waitReason: (r.wait_reason as string | null) ?? null,
    evaluatedAtMs: ms(r.evaluated_at),
    slot: num(r.slot),
    episodeId: r.episode_id == null ? null : String(r.episode_id),
    openedAtMs: r.ep_opened_at == null ? null : ms(r.ep_opened_at),
    closedAtMs: r.ep_closed_at == null ? null : ms(r.ep_closed_at),
  };
}

export function createPgStore(sql: SqlQuery): WatchStore {
  return {
    async claimEval(slot, nowMs) {
      const inserted = await sql.query(
        `insert into watch_evals (slot, status, started_at, ran_at, retry_count)
         values ($1, 'pending', $2::timestamptz, $2::timestamptz, 0)
         on conflict (slot) do nothing
         returning slot`,
        [slot, iso(nowMs)],
      );
      if (inserted.length) return { kind: "acquired", retryCount: 0 };
      const existing = await sql.query<Record<string, unknown>>(
        `select * from watch_evals where slot = $1`,
        [slot],
      );
      const row = existing[0] ? rowToEval(existing[0]) : null;
      if (!row) return { kind: "acquired", retryCount: 0 };
      if (row.status === "ok") return { kind: "duplicate", eval: row };
      const canRetry =
        (row.status === "lag" || row.status === "failed") && row.retryCount < MAX_LAG_RETRIES;
      const stalePending = row.status === "pending" && nowMs - row.startedAtMs > STALE_PENDING_MS;
      if (canRetry || stalePending) {
        const taken = await sql.query<Record<string, unknown>>(
          `update watch_evals
           set status = 'pending',
               started_at = $2::timestamptz,
               ran_at = $2::timestamptz,
               retry_count = retry_count + 1,
               error = null
           where slot = $1
             and (
               (status in ('lag', 'failed') and retry_count < $3)
               or (status = 'pending' and started_at < $4::timestamptz)
             )
           returning *`,
          [slot, iso(nowMs), MAX_LAG_RETRIES, iso(nowMs - STALE_PENDING_MS)],
        );
        if (taken[0]) return { kind: "acquired", retryCount: rowToEval(taken[0]).retryCount };
        const again = await sql.query<Record<string, unknown>>(
          `select * from watch_evals where slot = $1`,
          [slot],
        );
        const latest = again[0] ? rowToEval(again[0]) : row;
        if (latest.status === "ok") return { kind: "duplicate", eval: latest };
        if (latest.status === "pending") return { kind: "in_flight", eval: latest };
        return { kind: "exhausted", eval: latest };
      }
      if (row.status === "pending") return { kind: "in_flight", eval: row };
      return { kind: "exhausted", eval: row };
    },

    async completeEval(slot, nowMs, status, error, durationMs, assets) {
      await sql.query(
        `update watch_evals
         set status = $2,
             ran_at = $3::timestamptz,
             error = $4,
             duration_ms = $5,
             assets = $6::jsonb
         where slot = $1`,
        [slot, status, iso(nowMs), error, durationMs, JSON.stringify(assets)],
      );
    },

    async getEval(slot) {
      const rows = await sql.query<Record<string, unknown>>(
        `select * from watch_evals where slot = $1`,
        [slot],
      );
      return rows[0] ? rowToEval(rows[0]) : null;
    },

    async lastCompletedEval() {
      const rows = await sql.query<Record<string, unknown>>(
        `select * from watch_evals
         where status in ('ok', 'failed', 'lag')
         order by slot desc
         limit 1`,
      );
      return rows[0] ? rowToEval(rows[0]) : null;
    },

    async lastOkEval() {
      const rows = await sql.query<Record<string, unknown>>(
        `select * from watch_evals
         where status = 'ok'
         order by slot desc
         limit 1`,
      );
      return rows[0] ? rowToEval(rows[0]) : null;
    },

    async getEpisode(episodeId) {
      const rows = await sql.query<Record<string, unknown>>(
        `select * from signal_episodes where episode_id = $1 limit 1`,
        [episodeId],
      );
      return rows[0] ? rowToEpisode(rows[0]) : null;
    },

    async getOpenEpisode(assetId) {
      const rows = await sql.query<Record<string, unknown>>(
        `select * from signal_episodes
         where asset_id = $1 and closed_at is null
         limit 1`,
        [assetId],
      );
      return rows[0] ? rowToEpisode(rows[0]) : null;
    },

    async upsertEpisode(row) {
      await sql.query(
        `insert into signal_episodes (
           episode_id, asset_id, direction, kind, zone_low, zone_high, sl, tp1, tp2,
           opened_at, opened_state, current_state, closed_at, levels_key, opened_slot, episode_freeze
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10::timestamptz, $11, $12, $13::timestamptz, $14, $15, $16::jsonb
         )
         on conflict (episode_id) do update set
           current_state = excluded.current_state,
           closed_at = excluded.closed_at`,
        [
          row.episodeId,
          row.assetId,
          row.direction,
          row.kind,
          row.zoneLow,
          row.zoneHigh,
          row.sl,
          row.tp1,
          row.tp2,
          iso(row.openedAtMs),
          row.openedState,
          row.currentState,
          row.closedAtMs == null ? null : iso(row.closedAtMs),
          row.levelsKey,
          row.openedSlot,
          JSON.stringify(row.freeze),
        ],
      );
    },

    async insertEvent(row) {
      const rows = await sql.query(
        `insert into signal_events (episode_id, from_state, to_state, at, slot, notified)
         values ($1, $2, $3, $4::timestamptz, $5, $6)
         on conflict (episode_id, slot, from_state, to_state) do nothing
         returning id`,
        [row.episodeId, row.fromState, row.toState, iso(row.atMs), row.slot, row.notified],
      );
      return rows.length > 0;
    },

    async upsertSnapshot(row) {
      await sql.query(
        `insert into watch_snapshots (
           asset_id, state, setup, wait_reason, evaluated_at, slot, episode_id
         ) values ($1, $2, $3::jsonb, $4, $5::timestamptz, $6, $7)
         on conflict (asset_id) do update set
           state = excluded.state,
           setup = excluded.setup,
           wait_reason = excluded.wait_reason,
           evaluated_at = excluded.evaluated_at,
           slot = excluded.slot,
           episode_id = excluded.episode_id`,
        [
          row.assetId,
          row.state,
          JSON.stringify(row.setup),
          row.waitReason,
          iso(row.evaluatedAtMs),
          row.slot,
          row.episodeId,
        ],
      );
    },

    async listSnapshots() {
      const rows = await sql.query<Record<string, unknown>>(
        `select s.*, e.opened_at as ep_opened_at, e.closed_at as ep_closed_at
         from watch_snapshots s
         left join signal_episodes e on e.episode_id = s.episode_id
         order by s.asset_id`,
      );
      return rows.map(rowToSnapshot);
    },

    async countOpenEpisodes() {
      const rows = await sql.query<{ n: string | number }>(
        `select count(*)::int as n from signal_episodes where closed_at is null`,
      );
      return Number(rows[0]?.n ?? 0);
    },

    async getSnapshot(assetId) {
      const rows = await sql.query<Record<string, unknown>>(
        `select * from watch_snapshots where asset_id = $1`,
        [assetId],
      );
      return rows[0] ? rowToSnapshot(rows[0]) : null;
    },

    async claimNotify(episodeId, slot, fromState, toState, nowMs) {
      const rows = await sql.query(
        `update signal_events
         set notify_status = 'claimed',
             notify_claimed_at = $5::timestamptz,
             notify_attempts = notify_attempts + 1
         where episode_id = $1
           and slot = $2
           and from_state = $3
           and to_state = $4
           and notified = false
           and notify_attempts < $6
           and (
             notify_status in ('pending', 'failed')
             or (notify_status = 'claimed' and notify_claimed_at < $7::timestamptz)
           )
         returning id`,
        [
          episodeId,
          slot,
          fromState,
          toState,
          iso(nowMs),
          MAX_NOTIFY_ATTEMPTS,
          iso(nowMs - NOTIFY_CLAIM_STALE_MS),
        ],
      );
      return rows.length > 0;
    },

    async markNotifySent(episodeId, slot, fromState, toState, nowMs) {
      await sql.query(
        `update signal_events
         set notified = true,
             notify_status = 'sent',
             notified_at = $5::timestamptz,
             notify_last_error = null
         where episode_id = $1 and slot = $2 and from_state = $3 and to_state = $4`,
        [episodeId, slot, fromState, toState, iso(nowMs)],
      );
    },

    async markNotifyFailed(episodeId, slot, fromState, toState, error) {
      await sql.query(
        `update signal_events
         set notify_status = 'failed',
             notify_last_error = $5
         where episode_id = $1 and slot = $2 and from_state = $3 and to_state = $4
           and notified = false`,
        [episodeId, slot, fromState, toState, error],
      );
    },

    async listRetryableEvents(nowMs) {
      const rows = await sql.query<Record<string, unknown>>(
        `select episode_id, from_state, to_state, at, slot
         from signal_events
         where notified = false
           and notify_attempts < $1
           and (
             notify_status in ('pending', 'failed')
             or (notify_status = 'claimed' and notify_claimed_at < $2::timestamptz)
           )
         order by at`,
        [MAX_NOTIFY_ATTEMPTS, iso(nowMs - NOTIFY_CLAIM_STALE_MS)],
      );
      return rows.map((r) => ({
        episodeId: String(r.episode_id),
        fromState: r.from_state as SetupState,
        toState: r.to_state as SetupState,
        atMs: ms(r.at),
        slot: num(r.slot),
        notified: false as const,
      }));
    },

    async getAlertPinHash() {
      const rows = await sql.query<{ value: string }>(
        `select value from watch_config where key = 'alert_pin_hash' limit 1`,
      );
      return rows[0]?.value ?? null;
    },

    async setAlertPinHash(hash) {
      const taken = await sql.query<{ key: string }>(
        `insert into watch_config (key, value)
         values ('alert_pin_hash', $1)
         on conflict (key) do nothing
         returning key`,
        [hash],
      );
      return taken.length > 0;
    },

    async upsertOutcome(episodeId, nowMs, result) {
      await sql.query(
        `insert into signal_outcomes (
           episode_id, rule, outcome, first_touch, first_touch_at, exit_at,
           mfe, mae, evaluated_at, details
         ) values (
           $1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
           $7, $8, $9::timestamptz, $10::jsonb
         )
         on conflict (episode_id) do update set
           outcome = excluded.outcome,
           first_touch = excluded.first_touch,
           first_touch_at = excluded.first_touch_at,
           exit_at = excluded.exit_at,
           mfe = excluded.mfe,
           mae = excluded.mae,
           evaluated_at = excluded.evaluated_at,
           details = excluded.details
         where signal_outcomes.outcome in ('pending', 'none')`,
        [
          episodeId,
          result.rule,
          result.outcome,
          result.firstTouch,
          result.firstTouchAtSec == null ? null : iso(result.firstTouchAtSec * 1000),
          result.exitAtSec == null ? null : iso(result.exitAtSec * 1000),
          result.mfe,
          result.mae,
          iso(nowMs),
          JSON.stringify({ rule: result.rule }),
        ],
      );
    },

    async listHistory(limit) {
      const rows = await sql.query<Record<string, unknown>>(
        `select e.*, o.outcome, o.first_touch, o.first_touch_at, o.mfe, o.mae
         from signal_episodes e
         left join signal_outcomes o on o.episode_id = e.episode_id
         order by e.opened_at desc
         limit $1`,
        [limit],
      );
      return rows.map((r) => ({
        episode: rowToEpisode(r),
        outcome: r.outcome == null ? null : String(r.outcome),
        firstTouch: r.first_touch == null ? null : String(r.first_touch),
        firstTouchAtMs: r.first_touch_at == null ? null : ms(r.first_touch_at),
        mfe: r.mfe == null ? null : num(r.mfe),
        mae: r.mae == null ? null : num(r.mae),
      }));
    },

    async listInbox(limit) {
      const rows = await sql.query<Record<string, unknown>>(
        `select ev.episode_id, ev.from_state, ev.to_state, ev.at, ev.slot, ev.notified,
                ev.notify_status, ev.notify_attempts, ev.notify_last_error,
                e.asset_id, e.direction, e.closed_at
         from signal_events ev
         join signal_episodes e on e.episode_id = ev.episode_id
         order by ev.at desc
         limit $1`,
        [limit],
      );
      return rows.map((r) => ({
        episodeId: String(r.episode_id),
        assetId: r.asset_id as AssetId,
        direction: r.direction as "buy" | "sell",
        fromState: r.from_state as SetupState,
        toState: r.to_state as SetupState,
        atMs: ms(r.at),
        slot: num(r.slot),
        notified: r.notified === true,
        live: r.closed_at == null,
        notifyStatus: r.notify_status == null ? null : String(r.notify_status),
        notifyAttempts: r.notify_attempts == null ? null : num(r.notify_attempts),
        notifyLastError: r.notify_last_error == null ? null : String(r.notify_last_error),
      }));
    },

    async getPushPrefs() {
      const rows = await sql.query<{ value: string }>(
        `select value from watch_config where key = 'push_prefs' limit 1`,
      );
      if (!rows[0]?.value) return { ...DEFAULT_PUSH_PREFS };
      try {
        return parsePushPrefs(JSON.parse(rows[0].value));
      } catch {
        return { ...DEFAULT_PUSH_PREFS };
      }
    },

    async setPushPrefs(prefs) {
      await sql.query(
        `insert into watch_config (key, value) values ('push_prefs', $1)
         on conflict (key) do update set value = excluded.value`,
        [JSON.stringify(prefs)],
      );
    },

    async upsertPushSub(row, userAgent) {
      await sql.query(
        `insert into push_subscriptions (endpoint, p256dh, auth, user_agent, updated_at, disabled_at, last_error)
         values ($1, $2, $3, $4, now(), null, null)
         on conflict (endpoint) do update set
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           updated_at = now(),
           disabled_at = null,
           last_error = null`,
        [row.endpoint, row.p256dh, row.auth, userAgent],
      );
    },

    async listActivePushSubs() {
      const rows = await sql.query<Record<string, unknown>>(
        `select endpoint, p256dh, auth from push_subscriptions where disabled_at is null`,
      );
      return rows.map((r) => ({
        endpoint: String(r.endpoint),
        p256dh: String(r.p256dh),
        auth: String(r.auth),
      }));
    },

    async disablePushSub(endpoint, error) {
      await sql.query(
        `update push_subscriptions
         set disabled_at = now(), last_error = $2
         where endpoint = $1`,
        [endpoint, error],
      );
    },

    async deletePushSub(endpoint) {
      await sql.query(`delete from push_subscriptions where endpoint = $1`, [endpoint]);
    },

    async countPushSubs() {
      const rows = await sql.query<{ active: string | number; disabled: string | number }>(
        `select
           count(*) filter (where disabled_at is null)::int as active,
           count(*) filter (where disabled_at is not null)::int as disabled
         from push_subscriptions`,
      );
      return {
        active: Number(rows[0]?.active ?? 0),
        disabled: Number(rows[0]?.disabled ?? 0),
      };
    },

    async hasPushSub(endpoint) {
      const rows = await sql.query<{ n: string | number }>(
        `select count(*)::int as n from push_subscriptions
         where endpoint = $1 and disabled_at is null`,
        [endpoint],
      );
      return Number(rows[0]?.n ?? 0) > 0;
    },

    async listNotifyDebug(limit) {
      const rows = await sql.query<Record<string, unknown>>(
        `select ev.episode_id, ev.from_state, ev.to_state, ev.at, ev.notified,
                ev.notify_status, ev.notify_attempts, ev.notify_last_error,
                e.asset_id
         from signal_events ev
         join signal_episodes e on e.episode_id = ev.episode_id
         order by ev.at desc
         limit $1`,
        [limit],
      );
      return rows.map((r) => ({
        episodeId: String(r.episode_id),
        assetId: r.asset_id as AssetId,
        fromState: r.from_state as SetupState,
        toState: r.to_state as SetupState,
        atMs: ms(r.at),
        notified: r.notified === true,
        notifyStatus: r.notify_status == null ? "pending" : String(r.notify_status),
        notifyAttempts: num(r.notify_attempts),
        notifyLastError: r.notify_last_error == null ? null : String(r.notify_last_error),
      }));
    },
  };
}

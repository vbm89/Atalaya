import type { Sql } from "../db.ts";
import {
  ASSETS,
  appendDecision,
  appendSettle,
  appendSignal,
  blankBoard,
  emptyState,
  hasDecision,
  readSignals,
  readState,
  writeState,
  type DecisionMode,
  type PaperState,
  type PaperView,
  type PaperViewSignal,
  type StoredDecision,
  type StoredSignal,
} from "./store.ts";
import type { AssetId } from "../learn/price-behaviour/types.ts";

/** Una pasada de cron puede llegar hasta 16 min después de la anterior. */
export const SERVERLESS_FRESH_SEC = 16 * 60;

export interface PaperLedger {
  readState(): Promise<PaperState>;
  writeState(state: PaperState): Promise<void>;
  hasDecision(asset: AssetId, lastBarT: number, mode: DecisionMode): Promise<boolean>;
  appendDecision(row: StoredDecision): Promise<boolean>;
  readSignals(): Promise<StoredSignal[]>;
  appendSignal(row: StoredSignal): Promise<boolean>;
  appendSettle(signalId: string, result: StoredSignal["result"], at: number): Promise<void>;
}

export function fileLedger(dir: string): PaperLedger {
  return {
    async readState() {
      return readState(dir);
    },
    async writeState(state) {
      writeState(dir, state);
    },
    async hasDecision(asset, lastBarT, mode) {
      return hasDecision(dir, asset, lastBarT, mode);
    },
    async appendDecision(row) {
      appendDecision(dir, row);
      return true;
    },
    async readSignals() {
      return readSignals(dir);
    },
    async appendSignal(row) {
      appendSignal(dir, row);
      return true;
    },
    async appendSettle(signalId, result, at) {
      appendSettle(dir, signalId, result, at);
    },
  };
}

function asState(value: unknown): PaperState {
  if (!value || typeof value !== "object") return emptyState();
  const row = value as Partial<PaperState>;
  return { ...emptyState(), ...row, assets: row.assets ?? {}, liveTrading: false, validatedEdge: false, version: 1, role: "paper" };
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

export function sqlLedger(sql: Sql): PaperLedger {
  return {
    async readState() {
      const rows = await sql.query<{ body: PaperState | string }>("select body from paper_bot_state where id = 1");
      const body = rows[0]?.body;
      if (body == null) return emptyState();
      return asState(typeof body === "string" ? JSON.parse(body) : body);
    },
    async writeState(state) {
      await sql.query(
        `insert into paper_bot_state (id, body)
         values (1, $1::jsonb)
         on conflict (id) do update set body = excluded.body, updated_at = now()`,
        [jsonValue(state)],
      );
    },
    async hasDecision(asset, lastBarT, mode) {
      const rows = await sql.query<{ asset: string }>(
        "select asset from paper_bot_decision where asset = $1 and timeframe = '15m' and last_bar_t = $2 and mode = $3",
        [asset, lastBarT, mode],
      );
      return rows.length > 0;
    },
    async appendDecision(row) {
      const inserted = await sql.query<{ asset: string }>(
        `insert into paper_bot_decision
           (asset, timeframe, last_bar_t, mode, decision, reason, provider, data_status, evaluated_at, price, entry_px, stop_px, target_px, rr, setup)
         values ($1, '15m', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (asset, timeframe, last_bar_t, mode) do nothing
         returning asset`,
        [
          row.asset,
          row.lastBarT,
          row.mode,
          row.decision,
          row.reason,
          row.provider,
          row.dataStatus,
          row.evaluatedAt,
          row.price ?? null,
          row.entry ?? null,
          row.stop ?? null,
          row.target ?? null,
          row.rr ?? null,
          row.setup ?? null,
        ],
      );
      return inserted.length > 0;
    },
    async readSignals() {
      const rows = await sql.query<{ body: StoredSignal | string; result: StoredSignal["result"] }>(
        "select body, result from paper_bot_signal order by last_bar_t asc, signal_id asc",
      );
      return rows.map((row) => {
        const body = typeof row.body === "string" ? (JSON.parse(row.body) as StoredSignal) : row.body;
        return { ...body, result: row.result ?? body.result };
      });
    },
    async appendSignal(row) {
      const inserted = await sql.query<{ signal_id: string }>(
        `insert into paper_bot_signal (signal_id, asset, timeframe, last_bar_t, direction, body, result)
         values ($1, $2, '15m', $3, $4, $5::jsonb, $6)
         on conflict (asset, timeframe, last_bar_t, direction) do nothing
         returning signal_id`,
        [row.signalId, row.asset, row.lastBarT, row.direction, jsonValue(row), row.result],
      );
      return inserted.length > 0;
    },
    async appendSettle(signalId, result) {
      await sql.query(
        `update paper_bot_signal
         set result = $2,
             body = case
               when jsonb_typeof(body->'study') = 'object' then
                 jsonb_set(
                   jsonb_set(
                     jsonb_set(body, '{result}', to_jsonb($2::text)),
                     '{resultR}',
                     case when $2 = 'TP' then to_jsonb((body->>'RR')::double precision) when $2 = 'SL' then '-1'::jsonb else 'null'::jsonb end
                   ),
                   '{study,resultR}',
                   case when $2 = 'TP' then to_jsonb((body->>'RR')::double precision) when $2 = 'SL' then '-1'::jsonb else 'null'::jsonb end
                 )
               else
                 jsonb_set(
                   jsonb_set(body, '{result}', to_jsonb($2::text)),
                   '{resultR}',
                   case when $2 = 'TP' then to_jsonb((body->>'RR')::double precision) when $2 = 'SL' then '-1'::jsonb else 'null'::jsonb end
                 )
             end
         where signal_id = $1 and result = 'ABIERTA'`,
        [signalId, result],
      );
    },
  };
}

/** En Vercel no hay proceso residente. Activo si el último ciclo cabe en la ventana del cron. */
export function serverlessLiveness(state: PaperState | null, nowMs = Date.now()): "ACTIVO" | "DETENIDO" {
  if (state?.lastCycleAt == null || state.storageStatus === "error") return "DETENIDO";
  if (nowMs / 1000 - state.lastCycleAt > SERVERLESS_FRESH_SEC) return "DETENIDO";
  return "ACTIVO";
}

export function paperViewFrom(state: PaperState, signals: StoredSignal[], nowMs = Date.now()): PaperView {
  const viewSignals: PaperViewSignal[] = signals
    .slice()
    .reverse()
    .map((row) => ({
      id: row.signalId,
      asset: row.asset,
      timeframe: "15m" as const,
      timestamp: row.timestamp,
      lastBarT: row.lastBarT,
      direction: row.direction,
      entry: row.entry,
      stop: row.stop,
      target: row.target,
      rr: row.RR,
      setup: row.setup,
      tier: row.tier,
      marketState: row.marketState,
      event: row.event,
      confirmation: row.confirmation,
      evidence: row.evidence ?? {},
      rationale: row.rationale,
      provider: row.provider,
      revisionOf: row.revisionOf,
      result: row.result,
      resultR: row.resultR ?? null,
      study: row.study ?? null,
      createdAt: row.createdAt,
    }));
  return {
    updatedAt: nowMs,
    mode: "learning",
    validatedEdge: false,
    liveTrading: false,
    bot: serverlessLiveness(state, nowMs),
    workerRunning: state.lastCycleAt != null && serverlessLiveness(state, nowMs) === "ACTIVO",
    lastCycleAt: state.lastCycleAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    lastProcessedBar: state.lastProcessedBar,
    nextBarClose: state.nextBarClose,
    lastSignalAt: state.lastSignalAt,
    storageStatus: state.storageStatus,
    assets: ASSETS.map((asset) => state.assets[asset] ?? blankBoard(asset)),
    signals: viewSignals,
  };
}

export async function readDurableView(sql: Sql, nowMs = Date.now()): Promise<PaperView> {
  const ledger = sqlLedger(sql);
  const state = await ledger.readState();
  const signals = await ledger.readSignals();
  return paperViewFrom(state, signals, nowMs);
}

export function usesDurableStore(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export type { AssetSnapshot };

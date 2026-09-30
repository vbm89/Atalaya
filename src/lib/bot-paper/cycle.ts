import { presentAsset, type AssetBoard, type AttemptView } from "../learn/price-behaviour/board.ts";
import { admitSignal, settleSignal, type PaperSignal } from "../learn/price-behaviour/journal.ts";
import { PARAMS } from "../learn/price-behaviour/params.ts";
import type { AssetId, Bar } from "../learn/price-behaviour/types.ts";
import { fileLedger, type PaperLedger } from "./ledger.ts";
import {
  ASSETS,
  type AssetSnapshot,
  type DecisionMode,
  type PaperState,
  type StoredSignal,
} from "./store.ts";

export const CLOSE_GRACE_SEC = 15;
export const STALE_GIVEUP_SEC = 180;
export const MAX_CATCHUP_BARS = 16;

export function lastClosedOpen(nowSec: number, barSec = PARAMS.barSec): number {
  return Math.floor(nowSec / barSec) * barSec - barSec;
}

export function nextClose(nowSec: number, barSec = PARAMS.barSec): number {
  return Math.floor(nowSec / barSec) * barSec + barSec;
}

export function planBars(lastProcessed: number | null, latestClosed: number, barSec = PARAMS.barSec): { catchup: number[]; live: number; omitted: number } {
  if (lastProcessed == null || latestClosed <= lastProcessed) return { catchup: [], live: latestClosed, omitted: 0 };
  const pending: number[] = [];
  for (let t = lastProcessed + barSec; t <= latestClosed; t += barSec) pending.push(t);
  if (pending.length > MAX_CATCHUP_BARS + 1) {
    return { catchup: [], live: latestClosed, omitted: pending.length - 1 };
  }
  return { catchup: pending.slice(0, -1), live: pending[pending.length - 1]!, omitted: 0 };
}

export interface PaperTape {
  bars: readonly (Bar & { source?: string })[];
  source: string;
  note: string | null;
  attempts: AttemptView[];
}

export interface CycleReport {
  nowSec: number;
  expected: number;
  decisions: number;
  signalsNew: number;
  duplicates: number;
  waited: AssetId[];
  processed: AssetId[];
}

function failureText(attempts: AttemptView[]): string | null {
  const failed = attempts.filter((row) => !row.fresh);
  if (!failed.length) return null;
  return failed
    .map((row) => `${row.provider}${row.httpStatus != null ? ` HTTP ${row.httpStatus}` : ""}${row.error ? ` ${row.error}` : ""}`)
    .join(" · ");
}

function toPaper(row: StoredSignal): PaperSignal {
  return {
    id: row.signalId,
    asset: row.asset,
    timeframe: "15m",
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
    rationale: row.rationale,
    provider: row.provider,
    revisionOf: row.revisionOf,
    result: row.result,
  };
}

function fromBoard(board: AssetBoard, createdAt: number): StoredSignal | null {
  if (board.action === "ESPERAR") return null;
  if (board.lastBarT == null || board.entry == null || board.stop == null || board.target == null || board.rr == null || board.tier == null) return null;
  return {
    kind: "signal",
    signalId: `${board.asset}|15m|${board.lastBarT}|${board.action}`,
    asset: board.asset,
    timeframe: "15m",
    timestamp: board.lastBarT + PARAMS.barSec,
    provider: board.provider ?? "unknown",
    lastBarT: board.lastBarT,
    direction: board.action,
    entry: board.entry,
    stop: board.stop,
    target: board.target,
    RR: board.rr,
    setup: board.setup ?? "SETUP",
    marketState: board.marketState,
    event: board.event,
    confirmation: board.confirmation,
    evidence: board.evidence,
    rationale: board.rationale,
    createdAt,
    tier: board.tier,
    result: "ABIERTA",
    revisionOf: null,
  };
}

function snapshot(board: AssetBoard, mode: DecisionMode, evaluatedAt: number): AssetSnapshot {
  return { ...board, mode, evaluatedAt };
}

async function recordDecision(
  ledger: PaperLedger,
  row: {
    asset: AssetId;
    lastBarT: number;
    decision: "COMPRA" | "VENTA" | "ESPERAR";
    reason: string;
    provider: string | null;
    dataStatus: AssetBoard["status"];
    mode: DecisionMode;
    evaluatedAt: number;
    price?: number | null;
    entry?: number | null;
    stop?: number | null;
    target?: number | null;
    rr?: number | null;
    setup?: string | null;
  },
): Promise<boolean> {
  if (await ledger.hasDecision(row.asset, row.lastBarT, row.mode)) return false;
  return ledger.appendDecision({ timestamp: row.lastBarT + PARAMS.barSec, ...row });
}

function blockedBoard(asset: AssetId, status: "DATA_STALE" | "DATA_ERROR", reason: string, provider: string | null, attempts: AttemptView[], lastBarT: number, nowSec: number, error: string | null): AssetBoard {
  return {
    asset,
    price: null,
    status,
    provider,
    lastBarT,
    updatedAt: nowSec,
    bars: 0,
    freshnessSec: null,
    error,
    attempts,
    action: "ESPERAR",
    direction: null,
    entry: null,
    stop: null,
    target: null,
    rr: null,
    setup: null,
    tier: null,
    marketState: "UNCLEAR",
    event: "NO_EVENT",
    confirmation: false,
    evidence: {},
    rationale: reason,
    wait: status === "DATA_STALE" ? "Datos desactualizados" : "Datos no disponibles",
    validatedEdge: false,
    liveTrading: false,
    candles: [],
  };
}

function levels(board: AssetBoard) {
  return {
    price: board.price,
    entry: board.entry,
    stop: board.stop,
    target: board.target,
    rr: board.rr,
    setup: board.setup,
  };
}

/**
 * Una pasada. El motor solo corre sobre la última vela cerrada.
 * Las velas intermedias perdidas quedan como LIVE_CATCHUP / ESPERAR, sin señal retrospectiva.
 */
export async function runCycle(opts: { dir?: string; ledger?: PaperLedger; nowSec: number; load: (asset: AssetId) => Promise<PaperTape> }): Promise<CycleReport> {
  const ledger = opts.ledger ?? fileLedger(opts.dir ?? "");
  const { nowSec } = opts;
  const expected = lastClosedOpen(nowSec);
  const sinceClose = nowSec - (expected + PARAMS.barSec);
  const state = await ledger.readState();
  const report: CycleReport = { nowSec, expected, decisions: 0, signalsNew: 0, duplicates: 0, waited: [], processed: [] };
  const loaded = await Promise.allSettled(ASSETS.map((asset) => opts.load(asset)));

  for (let i = 0; i < ASSETS.length; i++) {
    const asset = ASSETS[i]!;
    const result = loaded[i]!;
    const previous = state.assets[asset]?.lastBarT ?? null;
    if (result.status === "rejected") {
      if (sinceClose < STALE_GIVEUP_SEC && previous !== expected) {
        report.waited.push(asset);
        continue;
      }
      const board = blockedBoard(asset, "DATA_ERROR", "Proveedor no disponible. ESPERAR.", null, [], expected, nowSec, result.reason instanceof Error ? result.reason.message : "error");
      if (await recordDecision(ledger, { asset, lastBarT: expected, decision: "ESPERAR", reason: board.wait, provider: null, dataStatus: "DATA_ERROR", mode: "LIVE", evaluatedAt: nowSec, ...levels(board) })) report.decisions += 1;
      state.assets[asset] = snapshot(board, "LIVE", nowSec);
      report.processed.push(asset);
      continue;
    }

    const tape = result.value;
    const closed = tape.bars.filter((bar) => bar.t <= expected);
    const tapeLast = closed.length ? closed[closed.length - 1]!.t : null;
    const sourceLive = tape.source === "LIVE" && closed.length > 0;
    const attempts = tape.attempts ?? [];
    const provider = closed[closed.length - 1]?.source ?? null;
    const error = !sourceLive ? failureText(attempts) || tape.note : failureText(attempts);

    if (!sourceLive || tapeLast == null || tapeLast < expected) {
      if (previous === expected) {
        report.processed.push(asset);
        continue;
      }
      if (sinceClose < STALE_GIVEUP_SEC) {
        report.waited.push(asset);
        continue;
      }
      const status = sourceLive ? "DATA_STALE" : "DATA_ERROR";
      const reason = status === "DATA_STALE" ? "El proveedor no entregó la vela cerrada. DATA_STALE. ESPERAR." : "Fuente live no disponible. ESPERAR.";
      const board = blockedBoard(asset, status, reason, provider, attempts, expected, nowSec, error);
      if (await recordDecision(ledger, { asset, lastBarT: expected, decision: "ESPERAR", reason: board.wait, provider, dataStatus: status, mode: "LIVE", evaluatedAt: nowSec, ...levels(board) })) report.decisions += 1;
      state.assets[asset] = snapshot(board, "LIVE", nowSec);
      report.processed.push(asset);
      continue;
    }

    const seen = state.assets[asset]?.lastBarT ?? null;
    if (seen != null && seen >= expected) {
      report.processed.push(asset);
      continue;
    }

    const plan = planBars(seen, expected);
    if (plan.omitted > 0) {
      const reason = `LIVE_CATCHUP: parada de ${plan.omitted} velas. No se reconstruyen señales antiguas. ESPERAR.`;
      const marker = seen != null ? seen + PARAMS.barSec : expected;
      if (await recordDecision(ledger, { asset, lastBarT: marker, decision: "ESPERAR", reason, provider, dataStatus: "DATA_OK", mode: "LIVE_CATCHUP", evaluatedAt: nowSec })) report.decisions += 1;
    }
    for (const missed of plan.catchup) {
      const reason = "LIVE_CATCHUP: vela cerrada no evaluada en directo. No se genera señal retrospectiva. ESPERAR.";
      if (await recordDecision(ledger, { asset, lastBarT: missed, decision: "ESPERAR", reason, provider, dataStatus: "DATA_OK", mode: "LIVE_CATCHUP", evaluatedAt: nowSec })) report.decisions += 1;
    }

    const rawBoard = presentAsset({
      asset,
      bars: closed.map((bar) => ({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v })),
      provider,
      sourceLive: true,
      error,
      attempts,
      nowSec,
    });

    // XAUUSD paper profile: keep only complete setups while we collect evidence.
    // The recent tape showed the gold winners as FULL and the losing gold trade as PARTIAL.
    // This is PAPER-only; protected V1 is untouched.
    const board: AssetBoard =
      asset === "XAUUSD" && rawBoard.action !== "ESPERAR" && rawBoard.tier === "PARTIAL"
        ? {
            ...rawBoard,
            action: "ESPERAR",
            direction: rawBoard.direction,
            entry: null,
            stop: null,
            target: null,
            rr: null,
            rationale: "XAUUSD PAPER: setup parcial descartado. Se exige setup completo para esta fase.",
            wait: "Setup parcial descartado",
          }
        : rawBoard;

    const decisionReason = board.action === "ESPERAR" ? board.wait : board.rationale;
    if (await recordDecision(ledger, { asset, lastBarT: expected, decision: board.action, reason: decisionReason, provider: board.provider, dataStatus: board.status, mode: "LIVE", evaluatedAt: nowSec, ...levels(board) })) {
      report.decisions += 1;
    }
    if (board.status === "DATA_OK") {
      const incoming = fromBoard(board, nowSec * 1000);
      if (incoming) {
        const book = (await ledger.readSignals()).map(toPaper);
        const admitted = admitSignal(book, toPaper(incoming));
        if (admitted.status === "DUPLICATE") report.duplicates += 1;
        else {
          const created = admitted.book[admitted.book.length - 1]!;
          const stored = { ...incoming, signalId: created.id, revisionOf: created.revisionOf };
          const wrote = await ledger.appendSignal(stored);
          if (!wrote) report.duplicates += 1;
          else {
            report.signalsNew += 1;
            state.lastSignalAt = nowSec;
          }
        }
      }
    }
    const bars = closed.map((bar) => ({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v }));
    for (const row of await ledger.readSignals()) {
      if (row.asset !== asset || row.result !== "ABIERTA") continue;
      const settled = settleSignal(toPaper(row), bars);
      if (settled !== row.result) await ledger.appendSettle(row.signalId, settled, nowSec);
    }
    state.assets[asset] = snapshot(board, "LIVE", nowSec);
    report.processed.push(asset);
  }

  const allCaught = ASSETS.every((asset) => (state.assets[asset]?.lastBarT ?? -1) >= expected);
  if (allCaught) state.lastProcessedBar = expected;
  state.lastCycleAt = nowSec;
  state.nextBarClose = nextClose(nowSec);
  state.storageStatus = "ok";
  state.workerRunning = true;
  state.lastHeartbeatAt = Date.now();
  state.lastError = null;
  if (state.pid !== process.pid) state.startedAt = nowSec;
  state.pid = process.pid;
  state.liveTrading = false;
  state.validatedEdge = false;
  if (state.startedAt == null) state.startedAt = nowSec;
  await ledger.writeState(state);
  return report;
}

export function secondsUntilNextLook(nowSec: number, waiting: boolean): number {
  if (waiting) return 15;
  const target = nextClose(nowSec) + CLOSE_GRACE_SEC;
  return Math.max(1, target - nowSec);
}

export async function touchHeartbeat(dir: string, nowMs = Date.now()): Promise<PaperState> {
  const ledger = fileLedger(dir);
  const state = await ledger.readState();
  const nowSec = Math.floor(nowMs / 1000);
  if (state.pid !== process.pid) state.startedAt = nowSec;
  state.workerRunning = true;
  state.pid = process.pid;
  state.lastHeartbeatAt = nowMs;
  state.nextBarClose = nextClose(nowSec);
  state.liveTrading = false;
  state.validatedEdge = false;
  if (state.startedAt == null) state.startedAt = nowSec;
  await ledger.writeState(state);
  return state;
}

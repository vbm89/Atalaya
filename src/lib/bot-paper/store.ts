import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { AssetBoard } from "../learn/price-behaviour/board.ts";
import type { AssetId } from "../learn/price-behaviour/types.ts";
import type { ClosePath, PaperStudy } from "./study.ts";

export const ASSETS: readonly AssetId[] = ["XAUUSD", "US100", "WTI", "BTCUSD"];
export const HEARTBEAT_STALE_MS = 90_000;

export type DecisionMode = "LIVE" | "LIVE_CATCHUP";

export interface StoredDecision {
  timestamp: number;
  asset: AssetId;
  lastBarT: number;
  decision: "COMPRA" | "VENTA" | "ESPERAR";
  reason: string;
  provider: string | null;
  dataStatus: "DATA_OK" | "DATA_STALE" | "DATA_ERROR";
  mode: DecisionMode;
  evaluatedAt: number;
  price?: number | null;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  rr?: number | null;
  setup?: string | null;
}

export interface StoredSignal {
  kind: "signal";
  signalId: string;
  asset: AssetId;
  timeframe: "15m";
  timestamp: number;
  provider: string;
  lastBarT: number;
  direction: "COMPRA" | "VENTA";
  entry: number;
  stop: number;
  target: number;
  RR: number;
  setup: string;
  marketState: string;
  event: string;
  confirmation: boolean;
  evidence: Record<string, boolean>;
  rationale: string;
  createdAt: number;
  tier: "FULL" | "PARTIAL";
  result: "ABIERTA" | "SL" | "TP";
  resultR: number | null;
  mfeR?: number | null;
  maeR?: number | null;
  mfeBeforeExitR?: number | null;
  exitBarT?: number | null;
  barsHeld?: number | null;
  episodeId?: string | null;
  study: PaperStudy | null;
  revisionOf: string | null;
}

export interface AssetSnapshot extends AssetBoard {
  mode: DecisionMode | null;
  evaluatedAt: number | null;
}

export interface PaperState {
  version: 1;
  role: "paper";
  liveTrading: false;
  validatedEdge: false;
  workerRunning: boolean;
  pid: number | null;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
  lastError: string | null;
  lastCycleAt: number | null;
  lastProcessedBar: number | null;
  lastSignalAt: number | null;
  nextBarClose: number | null;
  storageStatus: "ok" | "error";
  assets: Partial<Record<AssetId, AssetSnapshot>>;
}

export function paperDir(): string {
  const fromEnv = process.env.PAPER_DIR?.trim();
  return fromEnv || join(process.cwd(), "artifacts", "paper-bot");
}

export function paperPaths(dir = paperDir()) {
  return {
    dir,
    signals: join(dir, "signals.jsonl"),
    decisions: join(dir, "decisions.jsonl"),
    state: join(dir, "state.json"),
  };
}

export function emptyState(): PaperState {
  return {
    version: 1,
    role: "paper",
    liveTrading: false,
    validatedEdge: false,
    workerRunning: false,
    pid: null,
    startedAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    lastCycleAt: null,
    lastProcessedBar: null,
    lastSignalAt: null,
    nextBarClose: null,
    storageStatus: "ok",
    assets: {},
  };
}

export function blankBoard(asset: AssetId, wait = "Sin evaluación"): AssetSnapshot {
  return {
    asset,
    price: null,
    status: "DATA_ERROR",
    provider: null,
    lastBarT: null,
    updatedAt: 0,
    bars: 0,
    freshnessSec: null,
    error: null,
    attempts: [],
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
    rationale: wait,
    wait,
    validatedEdge: false,
    liveTrading: false,
    candles: [],
    mode: null,
    evaluatedAt: null,
  };
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readJsonl(file: string): unknown[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const rows: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // línea a medias: se ignora hasta que el writer termine
    }
  }
  return rows;
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(join(file, ".."));
  appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

export function readState(dir = paperDir()): PaperState {
  const file = paperPaths(dir).state;
  if (!existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PaperState>;
    return {
      ...emptyState(),
      ...parsed,
      version: 1,
      role: "paper",
      liveTrading: false,
      validatedEdge: false,
      storageStatus: parsed.storageStatus === "error" ? "error" : "ok",
      assets: parsed.assets ?? {},
    };
  } catch {
    const broken = emptyState();
    broken.storageStatus = "error";
    return broken;
  }
}

export function writeState(dir: string, state: PaperState): void {
  const file = paperPaths(dir).state;
  ensureDir(dir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), "utf8");
  renameSync(tmp, file);
}

export function readDecisions(dir = paperDir()): StoredDecision[] {
  const rows: StoredDecision[] = [];
  for (const row of readJsonl(paperPaths(dir).decisions)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<StoredDecision>;
    if (item.asset == null || item.lastBarT == null || item.decision == null || item.mode == null) continue;
    rows.push(item as StoredDecision);
  }
  return rows;
}

export function hasDecision(dir: string, asset: AssetId, lastBarT: number, mode: DecisionMode): boolean {
  return readDecisions(dir).some((row) => row.asset === asset && row.lastBarT === lastBarT && row.mode === mode);
}

export function appendDecision(dir: string, row: StoredDecision): void {
  appendJsonl(paperPaths(dir).decisions, row);
}

export function readSignals(dir = paperDir()): StoredSignal[] {
  const book = new Map<string, StoredSignal>();
  for (const row of readJsonl(paperPaths(dir).signals)) {
    if (!row || typeof row !== "object") continue;
    const item = row as { kind?: string; signalId?: string; result?: StoredSignal["result"] };
    if (item.kind === "settle" && item.signalId && item.result) {
      const prev = book.get(item.signalId);
      if (prev && prev.result === "ABIERTA") {
        const resultR = item.result === "TP" ? prev.RR : item.result === "SL" ? -1 : null;
        const settle = item as Partial<ClosePath>;
        const hasExcursion = Object.prototype.hasOwnProperty.call(item, "mfeR");
        const hasClose = Object.prototype.hasOwnProperty.call(item, "exitBarT");
        book.set(item.signalId, {
          ...prev,
          result: item.result,
          resultR,
          mfeR: hasExcursion ? (settle.mfeR ?? null) : (prev.mfeR ?? null),
          maeR: hasExcursion ? (settle.maeR ?? null) : (prev.maeR ?? null),
          mfeBeforeExitR: hasClose ? (settle.mfeBeforeExitR ?? null) : (prev.mfeBeforeExitR ?? null),
          exitBarT: hasClose ? (settle.exitBarT ?? null) : (prev.exitBarT ?? null),
          barsHeld: hasClose ? (settle.barsHeld ?? null) : (prev.barsHeld ?? null),
          study: prev.study
            ? {
                ...prev.study,
                resultR,
                ...(hasExcursion ? { mfeR: settle.mfeR ?? null, maeR: settle.maeR ?? null } : {}),
                ...(hasClose
                  ? {
                      mfeBeforeExitR: settle.mfeBeforeExitR ?? null,
                      exitBarT: settle.exitBarT ?? null,
                      barsHeld: settle.barsHeld ?? null,
                    }
                  : {}),
              }
            : prev.study ?? null,
        });
      }
      continue;
    }
    if (item.signalId && (item.kind === "signal" || item.kind == null)) {
      book.set(item.signalId, row as StoredSignal);
    }
  }
  return [...book.values()];
}

export function appendSignal(dir: string, row: StoredSignal): void {
  appendJsonl(paperPaths(dir).signals, row);
}

export function appendSettle(
  dir: string,
  signalId: string,
  result: StoredSignal["result"],
  at: number,
  excursion?: Partial<ClosePath> & { mfeR: number | null; maeR: number | null },
): void {
  appendJsonl(paperPaths(dir).signals, {
    kind: "settle",
    signalId,
    result,
    at,
    ...(excursion
      ? {
          mfeR: excursion.mfeR,
          maeR: excursion.maeR,
          ...("exitBarT" in excursion
            ? {
                mfeBeforeExitR: excursion.mfeBeforeExitR ?? null,
                exitBarT: excursion.exitBarT ?? null,
                barsHeld: excursion.barsHeld ?? null,
              }
            : {}),
        }
      : {}),
  });
}

export function pidAlive(pid: number | null): boolean {
  if (pid == null || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function lockPath(dir = paperDir()): string {
  return join(dir, "worker.lock");
}

export function readLockPid(dir = paperDir()): number | null {
  const file = lockPath(dir);
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) ? pid : null;
}

/** Reclama el worker. false si otro proceso vivo ya lo tiene. */
export function claimWorkerLock(dir = paperDir()): boolean {
  mkdirSync(dir, { recursive: true });
  const file = lockPath(dir);
  const current = readLockPid(dir);
  if (current != null && current !== process.pid && pidAlive(current)) return false;
  if (existsSync(file)) unlinkSync(file);
  const fd = openSync(file, "wx");
  try {
    writeSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }
  return true;
}

export function releaseWorkerLock(dir = paperDir()): void {
  const file = lockPath(dir);
  if (readLockPid(dir) !== process.pid) return;
  try {
    unlinkSync(file);
  } catch {
    // ya no está
  }
}

export function botLiveness(state: PaperState | null, nowMs = Date.now()): "ACTIVO" | "DETENIDO" {
  if (!state?.workerRunning || state.lastHeartbeatAt == null) return "DETENIDO";
  if (nowMs - state.lastHeartbeatAt > HEARTBEAT_STALE_MS) return "DETENIDO";
  if (!pidAlive(state.pid)) return "DETENIDO";
  return "ACTIVO";
}

export interface PaperViewSignal {
  id: string;
  asset: AssetId;
  timeframe: "15m";
  timestamp: number;
  lastBarT: number;
  direction: "COMPRA" | "VENTA";
  entry: number;
  stop: number;
  target: number;
  rr: number;
  setup: string;
  tier: "FULL" | "PARTIAL";
  marketState: string;
  event: string;
  confirmation: boolean;
  evidence: Record<string, boolean>;
  rationale: string;
  provider: string;
  revisionOf: string | null;
  result: "ABIERTA" | "SL" | "TP";
  resultR: number | null;
  mfeR: number | null;
  maeR: number | null;
  mfeBeforeExitR: number | null;
  exitBarT: number | null;
  barsHeld: number | null;
  episodeId: string | null;
  /** true solo si este cierre escribió la telemetría de recorrido. */
  pathRecorded: boolean;
  study: PaperStudy | null;
  createdAt: number;
}

export interface PaperView {
  updatedAt: number;
  mode: "learning";
  validatedEdge: false;
  liveTrading: false;
  bot: "ACTIVO" | "DETENIDO";
  workerRunning: boolean;
  lastCycleAt: number | null;
  lastHeartbeatAt: number | null;
  lastProcessedBar: number | null;
  nextBarClose: number | null;
  lastSignalAt: number | null;
  storageStatus: "ok" | "error";
  assets: AssetSnapshot[];
  signals: PaperViewSignal[];
}

export function readPaperView(dir = paperDir(), nowMs = Date.now()): PaperView {
  const state = readState(dir);
  const signals = readSignals(dir)
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
      mfeR: row.mfeR ?? null,
      maeR: row.maeR ?? null,
      mfeBeforeExitR: row.mfeBeforeExitR ?? null,
      exitBarT: row.exitBarT ?? null,
      barsHeld: row.barsHeld ?? null,
      episodeId: row.episodeId ?? null,
      pathRecorded: Object.prototype.hasOwnProperty.call(row, "exitBarT"),
      study: row.study ?? null,
      createdAt: row.createdAt,
    }));
  return {
    updatedAt: nowMs,
    mode: "learning",
    validatedEdge: false,
    liveTrading: false,
    bot: botLiveness(state, nowMs),
    workerRunning: state.workerRunning,
    lastCycleAt: state.lastCycleAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    lastProcessedBar: state.lastProcessedBar,
    nextBarClose: state.nextBarClose,
    lastSignalAt: state.lastSignalAt,
    storageStatus: state.storageStatus,
    assets: ASSETS.map((asset) => state.assets[asset] ?? blankBoard(asset)),
    signals,
  };
}

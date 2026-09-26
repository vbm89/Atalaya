import { writeSync } from "node:fs";
import { loadTape } from "../shadow-entry/data.ts";
import type { AssetId } from "../learn/price-behaviour/types.ts";
import { runCycle, secondsUntilNextLook, touchHeartbeat } from "./cycle.ts";
import { claimWorkerLock, paperDir, readState, releaseWorkerLock, writeState, type PaperTape } from "./store.ts";

async function tapeOf(asset: AssetId): Promise<PaperTape> {
  const tape = await loadTape(asset, "15m", "live", "paper");
  return {
    bars: tape.bars,
    source: tape.source,
    note: tape.note,
    attempts: tape.attempts.map((row) => ({
      provider: row.provider,
      httpStatus: row.httpStatus,
      error: row.error,
      bars: row.bars,
      lastBarT: row.lastBarT,
      ok: row.ok,
      fresh: row.fresh,
    })),
  };
}

function logLine(message: string): void {
  writeSync(1, `${message}\n`);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const stop = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}

async function heartbeatSleep(dir: string, seconds: number, signal: AbortSignal): Promise<void> {
  let left = seconds;
  while (left > 0 && !signal.aborted) {
    const step = Math.min(10, left);
    await sleep(step * 1000, signal);
    left -= step;
    if (!signal.aborted) await touchHeartbeat(dir);
  }
}

export async function runWorker(opts: { dir?: string; signal: AbortSignal; load?: (asset: AssetId) => Promise<PaperTape> }): Promise<void> {
  const dir = opts.dir ?? paperDir();
  const load = opts.load ?? tapeOf;
  if (!claimWorkerLock(dir)) {
    const existing = readState(dir);
    logLine(`[paper] ya activo pid ${existing.pid}`);
    return;
  }
  await touchHeartbeat(dir);
  logLine(`[paper] worker ${process.pid} ${dir}`);
  while (!opts.signal.aborted) {
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      const report = await runCycle({ dir, nowSec, load });
      logLine(
        `[paper] ciclo ${new Date(nowSec * 1000).toISOString()} barra ${report.expected} decisiones+${report.decisions} señales+${report.signalsNew} duplicados ${report.duplicates} espera ${report.waited.join(",") || "-"}`,
      );
      await heartbeatSleep(dir, secondsUntilNextLook(nowSec, report.waited.length > 0), opts.signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logLine(`[paper] ciclo falló ${message}`);
      const state = readState(dir);
      state.lastError = message;
      state.workerRunning = true;
      state.pid = process.pid;
      state.lastHeartbeatAt = Date.now();
      writeState(dir, state);
      await sleep(15_000, opts.signal);
    }
  }
  const state = readState(dir);
  if (state.pid === process.pid) {
    state.workerRunning = false;
    state.lastHeartbeatAt = Date.now();
    writeState(dir, state);
  }
  releaseWorkerLock(dir);
  logLine("[paper] worker detenido");
}

export async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await runWorker({ signal: controller.signal });
}

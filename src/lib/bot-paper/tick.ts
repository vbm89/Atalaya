import { getSql } from "../db.ts";
import { loadTape } from "../shadow-entry/data.ts";
import type { AssetId } from "../learn/price-behaviour/types.ts";
import { runCycle, type CycleReport, type PaperTape } from "./cycle.ts";
import { readDurableView, sqlLedger } from "./ledger.ts";
import type { PaperView } from "./store.ts";

async function liveTape(asset: AssetId): Promise<PaperTape> {
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

export async function runDurableTick(nowSec = Math.floor(Date.now() / 1000), load: (asset: AssetId) => Promise<PaperTape> = liveTape): Promise<{ report: CycleReport; view: PaperView }> {
  const sql = await getSql();
  const ledger = sqlLedger(sql);
  const report = await runCycle({ ledger, nowSec, load });
  const view = await readDurableView(sql);
  return { report, view };
}

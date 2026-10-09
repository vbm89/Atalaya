import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Bar } from "../learn/price-behaviour/types.ts";
import { cronAuthorized } from "./cron-auth.ts";
import { runCycle, type PaperTape } from "./cycle.ts";
import { readDurableView, serverlessLiveness, sqlLedger } from "./ledger.ts";
import { emptyState } from "./store.ts";

const T0 = Date.parse("2026-03-02T00:00:00Z") / 1000;

function trend(points: Array<[number, number]>, half = 0.6): Bar[] {
  const last = points[points.length - 1]![0];
  const px = new Array<number>(last + 1).fill(points[0]![1]);
  for (let p = 0; p < points.length - 1; p++) {
    const [i0, y0] = points[p]!;
    const [i1, y1] = points[p + 1]!;
    for (let i = i0; i <= i1; i++) px[i] = y0 + ((y1 - y0) * (i - i0)) / (i1 - i0);
  }
  return px.map((c, i) => ({ t: T0 + i * 900, o: c, h: c + half, l: c - half, c, v: 1 }));
}

function buyBars(): Bar[] {
  const bars = trend([
    [0, 100],
    [20, 108],
    [30, 102],
    [45, 116],
    [55, 108],
    [70, 124],
    [82, 112],
  ]);
  const buyLow = 107.4;
  const i = 83;
  bars.push({ t: T0 + i * 900, o: buyLow + 0.3, h: buyLow + 1.15, l: buyLow - 0.25, c: buyLow + 1, v: 1 });
  return bars;
}

function tape(bars: Bar[]): PaperTape {
  return { bars: bars.map((row) => ({ ...row, source: "test" })), source: "LIVE", note: null, attempts: [] };
}

async function db() {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(readFileSync(new URL("../../../migrations/0001_paper_bot.sql", import.meta.url), "utf8"));
  const sql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0] ?? "";
      for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
      const result = await pg.query(text, values);
      return result.rows;
    },
    {
      query: async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows,
    },
  );
  return { pg, sql, ledger: sqlLedger(sql) };
}

describe("paper durable", () => {
  it("rechaza el cron sin secreto y acepta el bearer", () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    assert.equal(cronAuthorized(new Request("http://local/api/paper/cron")), false);
    process.env.CRON_SECRET = "solo-test";
    assert.equal(cronAuthorized(new Request("http://local/api/paper/cron", { headers: { authorization: "Bearer otro" } })), false);
    assert.equal(cronAuthorized(new Request("http://local/api/paper/cron", { headers: { authorization: "Bearer solo-test" } })), true);
    if (prev == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it("el cron sin ciclo reciente queda detenido", () => {
    assert.equal(serverlessLiveness(emptyState(), 1_000_000), "DETENIDO");
    const fresh = { ...emptyState(), lastCycleAt: 1_000, storageStatus: "ok" as const };
    assert.equal(serverlessLiveness(fresh, 1_000 * 1000 + 60_000), "ACTIVO");
    assert.equal(serverlessLiveness(fresh, 1_000 * 1000 + 20 * 60_000), "DETENIDO");
  });

  it("persiste la vela cerrada y no duplica si el cron se repite", async () => {
    const { sql, ledger } = await db();
    const bars = buyBars();
    const expected = bars[bars.length - 1]!.t;
    const now = expected + 900 + 40;
    const load = async (asset: string) => (asset === "XAUUSD" ? tape(bars) : tape(bars.map((row) => ({ ...row, c: 50, o: 50, h: 51, l: 49 }))));
    const first = await runCycle({ ledger, nowSec: now, load });
    const second = await runCycle({ ledger, nowSec: now, load });
    const view = await readDurableView(sql, now * 1000);
    const decisions = await sql.query<{ asset: string; decision: string; last_bar_t: number }>(
      "select asset, decision, last_bar_t from paper_bot_decision order by asset",
    );
    assert.equal(second.decisions, 0);
    assert.equal(second.signalsNew, 0);
    assert.equal(decisions.length, 4);
    assert.equal(new Set(decisions.map((row) => row.last_bar_t)).size, 1);
    const xau = view.assets.find((row) => row.asset === "XAUUSD");
    assert.ok(xau);
    assert.equal(xau.status === "DATA_OK" || xau.action === "ESPERAR" || xau.action === "COMPRA", true);
    assert.equal(view.bot, "ACTIVO");
    assert.equal(view.liveTrading, false);
    assert.ok(first.processed.includes("XAUUSD"));
    if (xau.action === "COMPRA") {
      assert.equal(view.signals.length, 1);
      assert.equal(view.signals[0]?.direction, "COMPRA");
      const again = await ledger.appendSignal({
        ...{
          kind: "signal" as const,
          signalId: view.signals[0]!.id,
          asset: "XAUUSD" as const,
          timeframe: "15m" as const,
          timestamp: expected + 900,
          provider: "test",
          lastBarT: expected,
          direction: "COMPRA" as const,
          entry: view.signals[0]!.entry,
          stop: view.signals[0]!.stop,
          target: view.signals[0]!.target,
          RR: view.signals[0]!.rr,
          setup: view.signals[0]!.setup,
          marketState: "TREND",
          event: "SWEEP",
          confirmation: true,
          evidence: {},
          rationale: "dup",
          createdAt: 1,
          tier: "FULL" as const,
          result: "ABIERTA" as const,
          revisionOf: null,
        },
      });
      assert.equal(again, false);
    }
  });
});

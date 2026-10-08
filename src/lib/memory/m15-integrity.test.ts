import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Candle } from "../trading/types.ts";
import type { EpisodeDraft } from "../watch/episode.ts";
import { createPgStore } from "../watch/store.ts";
import { closedBars, closedM15, M15_SEC, persistArchiveM15, persistTapeForEpisode } from "./persist.ts";

function bar(t: number, close: number, extra: Partial<Candle> = {}): Candle {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1, ...extra };
}

async function boot() {
  const pg = new PGlite();
  await pg.waitReady;
  for (const f of ["0002_watch.sql", "0003_watch_push.sql", "0004_watch_v10.sql", "0005_memory.sql"]) {
    await pg.exec(readFileSync(new URL(`../../../migrations/${f}`, import.meta.url), "utf8"));
  }
  const sql = {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows as T[],
  };
  return { sql, store: createPgStore(sql) };
}

/** A slot close (multiple of 900 and of 14400) and the tick 8 s later. */
const SLOT = 1_788_868_800;
const TICK_MS = SLOT * 1000 + 8_000;

describe("closed-bar rule", () => {
  it("t + 900 <= ref is closed; t + 900 = ref + 1 is not", () => {
    const bars = [bar(SLOT - 900, 10), bar(SLOT - 899, 20), bar(SLOT, 30)];
    assert.deepEqual(closedM15(bars, SLOT).map((c) => c.time), [SLOT - 900]);
    assert.equal(M15_SEC, 900);
    assert.deepEqual(closedM15(undefined, SLOT), []);
    assert.deepEqual(closedM15(bars, Number.NaN), []);
  });

  it("1h and 4h use their own step", () => {
    assert.deepEqual(closedBars([bar(SLOT - 3600, 10), bar(SLOT, 20)], 3600, SLOT).map((c) => c.time), [SLOT - 3600]);
    assert.deepEqual(closedBars([bar(SLOT - 14400, 10), bar(SLOT - 3600, 20)], 14400, SLOT).map((c) => c.time), [SLOT - 14400]);
  });
});

describe("market_m15 archive", () => {
  it("drops the forming bar at slot + 8 s (refSec = slot)", async () => {
    const { sql } = await boot();
    const n = await persistArchiveM15(sql, "BTCUSD", [bar(SLOT - 900, 10), bar(SLOT, 11)], "Bitget", "BTCUSDT", TICK_MS, SLOT);
    assert.equal(n, 1);
    const rows = await sql.query<{ t: number }>("select t from market_m15 where asset_id = 'BTCUSD' order by t");
    assert.deepEqual(rows.map((r) => Number(r.t)), [SLOT - 900]);
  });

  it("the next slot archives the now-closed bar with its full OHLC", async () => {
    const { sql } = await boot();
    await persistArchiveM15(sql, "BTCUSD", [bar(SLOT, 11)], "Bitget", "BTCUSDT", TICK_MS, SLOT);
    const next = SLOT + 900;
    await persistArchiveM15(sql, "BTCUSD", [bar(SLOT, 12, { high: 20, low: 5 })], "Bitget", "BTCUSDT", next * 1000 + 8000, next);
    const rows = await sql.query<{ h: number; l: number; c: number }>("select h, l, c from market_m15 where t = $1", [SLOT]);
    assert.deepEqual(rows.map((r) => [Number(r.h), Number(r.l), Number(r.c)]), [[20, 5, 12]]);
  });

  it("an archived closed bar is still never overwritten", async () => {
    const { sql } = await boot();
    const t = SLOT - 900;
    await persistArchiveM15(sql, "WTI", [bar(t, 10)], null, null, TICK_MS, SLOT);
    assert.equal(await persistArchiveM15(sql, "WTI", [bar(t, 20)], null, null, TICK_MS, SLOT), 0);
    const kept = await sql.query<{ c: number }>("select c from market_m15 where asset_id = 'WTI'");
    assert.equal(Number(kept[0]?.c), 10);
  });
});

describe("episode tape", () => {
  it("persistTapeForEpisode skips the forming 15m and 1h bars", async () => {
    const { sql, store } = await boot();
    const ep = {
      episodeId: "ep-test-1",
      assetId: "BTCUSD",
      direction: "buy",
      kind: "continuation",
      zoneLow: 1,
      zoneHigh: 2,
      sl: 0.5,
      tp1: 3,
      tp2: null,
      openedAtMs: (SLOT - 1800) * 1000,
      openedState: "entry",
      currentState: "entry",
      closedAtMs: null,
      levelsKey: "k",
      openedSlot: SLOT - 1800,
      freeze: null,
    } as unknown as EpisodeDraft;
    await store.upsertEpisode(ep);
    await persistTapeForEpisode(
      sql,
      ep,
      { "15m": [bar(SLOT - 900, 10), bar(SLOT, 20)], "1h": [bar(SLOT - 3600, 10), bar(SLOT, 20)] },
      TICK_MS,
      SLOT,
    );
    const rows = await sql.query<{ tf: string; t: number }>("select tf, t from episode_tape_bars order by tf, t");
    assert.equal(rows.some((r) => Number(r.t) === SLOT), false);
    assert.ok(rows.some((r) => r.tf === "15m" && Number(r.t) === SLOT - 900));
  });
});

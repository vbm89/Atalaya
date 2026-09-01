import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildSetup, closedCandles } from "../trading/engine.ts";
import { TF_STEP_SEC } from "../trading/integrity.ts";
import type { AssetId, Candle, SetupProposal, SetupState } from "../trading/types.ts";
import { foldEpisode, type EpisodeDraft } from "./episode.ts";
import { episodeId, levelsKey, slotSecFromNow } from "./identity.ts";
import { authorizeWatchRequest, watchSecret } from "./secret.ts";
import { createPgStore } from "./store.ts";
import { createMemoryStore } from "./store-memory.ts";
import { m15CoversSlot, runWatchTick, type WatchLoad } from "./tick.ts";
import { FEED_GRACE_MS } from "./schedule.ts";

type Pack = { m15: number[][]; h1: number[][]; h4: number[][] };

function inflate(rows: number[][]): Candle[] {
  return rows.map((k) => ({
    time: k[0]!,
    open: k[1]!,
    high: k[2]!,
    low: k[3]!,
    close: k[4]!,
    volume: k[5]!,
  }));
}

function atClose(barTimeSec: number): number {
  return (barTimeSec + TF_STEP_SEC["15m"]) * 1000 + 1;
}

function runAt(pack: { m15: Candle[]; h1: Candle[]; h4: Candle[] }, now: number) {
  return buildSetup({
    now,
    price: pack.m15.filter((c) => c.time * 1000 < now).at(-1)?.close ?? 0,
    digits: 2,
    m15: closedCandles(
      pack.m15.filter((c) => c.time * 1000 < now),
      "15m",
      now,
    ),
    h1: closedCandles(
      pack.h1.filter((c) => c.time * 1000 < now),
      "1h",
      now,
    ),
    h4: closedCandles(
      pack.h4.filter((c) => c.time * 1000 < now),
      "4h",
      now,
    ),
    highImpactNewsAt: null,
    newsTitle: null,
    underlyingClosed: false,
  });
}

const WAIT: Record<AssetId, WatchLoad["assets"][number]> = {
  XAUUSD: { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
  BTCUSD: { id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
  US100: { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
  WTI: { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
};

function loadAll(
  btc: { setupState: SetupState; setup: SetupProposal | null; waitReason: string | null },
  m15: Candle[],
): WatchLoad {
  return {
    assets: [{ ...WAIT.XAUUSD }, { ...WAIT.BTCUSD, ...btc, id: "BTCUSD" }, { ...WAIT.US100 }, { ...WAIT.WTI }],
    m15ByAsset: { BTCUSD: m15 },
    errors: [],
  };
}

function memoryStore() {
  return createMemoryStore();
}

const sampleSetup: SetupProposal = {
  state: "entry",
  kind: "continuation",
  direction: "sell",
  zone: { low: 77626.01, high: 77731.43 },
  invalidation: 81478.87,
  stopLoss: 77747,
  takeProfit1: 76888,
  takeProfit2: 76670.01,
  riskReward: 6.1,
  quality: "media",
  qualityPhase: "final",
  supersedeLevel: null,
  missingForEntry: null,
  slWide: false,
  warnings: [],
  managementNote: "",
  entryLabel: "77626.01",
};

describe("watch identity", () => {
  it("builds a stable levels_key with asset digits", () => {
    const key = levelsKey(sampleSetup, 2);
    assert.equal(key, "sell|continuation|77626.01|77731.43|77747.00|76888.00|76670.01");
    assert.equal(episodeId("BTCUSD", 1787991300, key), episodeId("BTCUSD", 1787991300, key));
  });
});

describe("foldEpisode", () => {
  const slot = 1_787_991_300;

  it("opens one episode on ESPERAR → ENTRADA", () => {
    const r = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup: sampleSetup, waitReason: null, digits: 2 },
      slot,
      10,
    );
    assert.ok(r.episode);
    assert.equal(r.episode.currentState, "entry");
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0]?.fromState, "wait");
    assert.equal(r.events[0]?.toState, "entry");
  });

  it("keeps the same episode_id when levels do not change", () => {
    const a = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup: sampleSetup, waitReason: null, digits: 2 },
      slot,
      10,
    );
    const b = foldEpisode(
      a.episode,
      { id: "BTCUSD", setupState: "entry", setup: sampleSetup, waitReason: null, digits: 2 },
      slot + 900,
      20,
    );
    assert.equal(b.episode?.episodeId, a.episode?.episodeId);
    assert.equal(b.events.length, 0);
  });

  it("records ENTRADA → PENDIENTE on the same episode", () => {
    const a = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup: sampleSetup, waitReason: null, digits: 2 },
      slot,
      10,
    );
    const pending = { ...sampleSetup, state: "pending" as const };
    const b = foldEpisode(
      a.episode,
      { id: "BTCUSD", setupState: "pending", setup: pending, waitReason: null, digits: 2 },
      slot + 900,
      20,
    );
    assert.equal(b.episode?.episodeId, a.episode?.episodeId);
    assert.equal(b.events[0]?.fromState, "entry");
    assert.equal(b.events[0]?.toState, "pending");
  });

  it("closes the episode on ESPERAR", () => {
    const a = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "pending", setup: sampleSetup, waitReason: null, digits: 2 },
      slot,
      10,
    );
    const b = foldEpisode(
      a.episode,
      { id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
      slot + 900,
      20,
    );
    assert.ok(b.episode?.closedAtMs);
    assert.equal(b.events[0]?.toState, "wait");
  });

  it("keeps the episode when SL only drifts by float/ATR noise", () => {
    const a = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup: sampleSetup, waitReason: null, digits: 2 },
      slot,
      10,
    );
    const drifted = { ...sampleSetup, state: "pending" as const, stopLoss: 77746.976 };
    const b = foldEpisode(
      a.episode,
      { id: "BTCUSD", setupState: "pending", setup: drifted, waitReason: null, digits: 2 },
      slot + 900,
      20,
    );
    assert.equal(b.episode?.episodeId, a.episode?.episodeId);
    assert.equal(b.events[0]?.toState, "pending");
  });

  it("opens a new episode when the zone changes", () => {
    const a = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup: sampleSetup, waitReason: null, digits: 2 },
      slot,
      10,
    );
    const other = {
      ...sampleSetup,
      zone: { low: 77000, high: 77100 },
      stopLoss: 77200,
    };
    const b = foldEpisode(
      a.episode,
      { id: "BTCUSD", setupState: "entry", setup: other, waitReason: null, digits: 2 },
      slot + 900,
      20,
    );
    assert.notEqual(b.episode?.episodeId, a.episode?.episodeId);
    assert.ok(b.closePrevious?.closedAtMs);
    assert.equal(b.events.length, 2);
  });
});

describe("watch tick idempotency + lag", () => {
  const now = Date.parse("2026-08-29T08:15:08.000Z");
  const slot = slotSecFromNow(now);
  const bar: Candle = {
    time: slot - 900,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  };

  it("does not eval before grace", async () => {
    const store = memoryStore();
    const r = await runWatchTick({
      nowMs: Date.parse("2026-08-29T08:15:00.000Z"),
      store,
      load: async () => {
        throw new Error("should not load");
      },
    });
    assert.equal(r.status, "too_early");
  });

  it("marks lag when the closed 15M is missing and does not create an episode", async () => {
    const store = memoryStore();
    const r = await runWatchTick({
      nowMs: now,
      store,
      load: async () => loadAll({ setupState: "wait", setup: null, waitReason: "ESPERAR" }, []),
    });
    assert.equal(r.status, "lag");
    assert.equal(await store.getOpenEpisode("BTCUSD"), null);
  });

  it("second call of the same ok slot is duplicate and writes no extra events", async () => {
    const store = memoryStore();
    const load = async (): Promise<WatchLoad> =>
      loadAll(
        { setupState: "entry", setup: sampleSetup, waitReason: null },
        [bar],
      );
    const a = await runWatchTick({ nowMs: now, store, load });
    const b = await runWatchTick({ nowMs: now, store, load });
    assert.equal(a.status, "ok");
    assert.equal(b.status, "duplicate");
    assert.equal(b.duplicate, true);
    const snaps = await store.listSnapshots();
    const btc = snaps.find((s) => s.assetId === "BTCUSD");
    assert.equal(btc?.state, "entry");
  });

  it("covers a slot only when the 15M open exists", () => {
    assert.equal(m15CoversSlot([bar], slot), true);
    assert.equal(m15CoversSlot([], slot), false);
    assert.equal(m15CoversSlot([{ ...bar, time: slot - 1800 }], slot), false);
  });
});

describe("WATCH_SECRET", () => {
  it("rejects missing secret and wrong bearer", () => {
    const prev = process.env.WATCH_SECRET;
    delete process.env.WATCH_SECRET;
    const missing = authorizeWatchRequest(new Request("http://local/api/watch/tick"));
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 503);

    process.env.WATCH_SECRET = "test-watch-secret-32chars-min";
    const bad = authorizeWatchRequest(
      new Request("http://local/api/watch/tick", { headers: { authorization: "Bearer no" } }),
    );
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.status, 401);

    const good = authorizeWatchRequest(
      new Request("http://local/api/watch/tick", {
        headers: { authorization: "Bearer test-watch-secret-32chars-min" },
      }),
    );
    assert.equal(good.ok, true);
    assert.ok(watchSecret());
    if (prev === undefined) delete process.env.WATCH_SECRET;
    else process.env.WATCH_SECRET = prev;
  });
});

describe("BTCUSD 29 ago 2026 — tick reproduce ENTRADA real", () => {
  const raw = JSON.parse(
    readFileSync(new URL("./fixtures/btc-2026-08-29.json", import.meta.url), "utf8"),
  ) as Pack;
  const pack = { m15: inflate(raw.m15), h1: inflate(raw.h1), h4: inflate(raw.h4) };
  const entryBar = Date.parse("2026-08-29T08:00:00.000Z") / 1000;
  const pendingBar = Date.parse("2026-08-29T08:15:00.000Z") / 1000;
  const expiredBar = Date.parse("2026-08-29T09:45:00.000Z") / 1000;

  function loadAt(now: number): WatchLoad {
    const r = runAt(pack, now);
    const m15 = pack.m15.filter((c) => c.time * 1000 < now);
    return loadAll({ setupState: r.state, setup: r.setup, waitReason: r.waitReason }, m15);
  }

  it("10:15 Madrid → ENTRADA SHORT, un episodio, mismos niveles", async () => {
    const store = memoryStore();
    const now = atClose(entryBar) + FEED_GRACE_MS;
    const engine = runAt(pack, atClose(entryBar));
    assert.equal(engine.state, "entry");
    assert.equal(engine.setup?.direction, "sell");
    assert.ok(engine.setup && Math.abs(engine.setup.zone.low - 77626.01) < 0.05);

    const tick = await runWatchTick({
      nowMs: now,
      store,
      load: async () => loadAt(atClose(entryBar)),
    });
    assert.equal(tick.status, "ok");
    const btc = tick.assets.find((a) => a.id === "BTCUSD");
    assert.equal(btc?.state, "entry");
    assert.ok(btc?.episodeId);
    assert.equal(btc.events, 1);

    const again = await runWatchTick({
      nowMs: now,
      store,
      load: async () => loadAt(atClose(entryBar)),
    });
    assert.equal(again.status, "duplicate");
  });

  it("siguiente 15M PENDIENTE mismo episode_id; 12:00 Madrid cierra el episodio", async () => {
    const store = memoryStore();
    const tEntry = atClose(entryBar) + FEED_GRACE_MS;
    const tPending = atClose(pendingBar) + FEED_GRACE_MS;
    const tDead = atClose(expiredBar) + FEED_GRACE_MS;

    const a = await runWatchTick({ nowMs: tEntry, store, load: async () => loadAt(atClose(entryBar)) });
    const id = a.assets.find((x) => x.id === "BTCUSD")?.episodeId;
    assert.ok(id);

    const enginePending = runAt(pack, atClose(pendingBar));
    assert.equal(enginePending.state, "pending");

    const b = await runWatchTick({
      nowMs: tPending,
      store,
      load: async () => loadAt(atClose(pendingBar)),
    });
    assert.equal(b.assets.find((x) => x.id === "BTCUSD")?.episodeId, id);
    assert.equal(b.assets.find((x) => x.id === "BTCUSD")?.state, "pending");
    assert.equal(b.assets.find((x) => x.id === "BTCUSD")?.events, 1);

    const engineDead = runAt(pack, atClose(expiredBar));
    assert.equal(engineDead.state, "wait");

    const c = await runWatchTick({
      nowMs: tDead,
      store,
      load: async () => loadAt(atClose(expiredBar)),
    });
    assert.equal(c.assets.find((x) => x.id === "BTCUSD")?.state, "wait");
    assert.ok((await store.getOpenEpisode("BTCUSD")) == null);
  });
});

describe("watch store PGLite unique slot / events", () => {
  it("two claims of the same slot yield one evaluation", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    const sqlText = readFileSync(new URL("../../../migrations/0002_watch.sql", import.meta.url), "utf8");
    await pg.exec(sqlText);
    await pg.exec(readFileSync(new URL("../../../migrations/0004_watch_v10.sql", import.meta.url), "utf8"));
    const sql = {
      query: async <T>(text: string, params: unknown[] = []) => {
        const r = await pg.query<T>(text, params);
        return r.rows as T[];
      },
    };
    const store = createPgStore(sql);
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = slotSecFromNow(now);
    const bar: Candle = {
      time: slot - 900,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    };
    const load = async (): Promise<WatchLoad> =>
      loadAll({ setupState: "entry", setup: sampleSetup, waitReason: null }, [bar]);

    const a = await runWatchTick({ nowMs: now, store, load });
    const b = await runWatchTick({ nowMs: now, store, load });
    assert.equal(a.status, "ok");
    assert.equal(b.status, "duplicate");

    const evals = await sql.query<{ n: number }>("select count(*)::int as n from watch_evals");
    assert.equal(Number(evals[0]?.n), 1);
    const events = await sql.query<{ n: number }>("select count(*)::int as n from signal_events");
    assert.equal(Number(events[0]?.n), 1);
    const episodes = await sql.query<{ n: number }>("select count(*)::int as n from signal_episodes");
    assert.equal(Number(episodes[0]?.n), 1);
  });
});

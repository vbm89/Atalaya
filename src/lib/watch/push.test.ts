import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildSetup, closedCandles } from "../trading/engine.ts";
import { TF_STEP_SEC } from "../trading/integrity.ts";
import type { AssetId, Candle, SetupProposal, AssetAnalysis } from "../trading/types.ts";
import { chartSetupLevels, hasChartableSetup, setupChartTf } from "../chart/setup-overlay.ts";
import { parseWatchLink, watchLinkPath } from "./link.ts";
import { dispatchEventPushes, formatPushSendError, pushEndpointHost } from "./notify.ts";
import { buildPushPayload } from "./payload.ts";
import { shouldPushState } from "./policy.ts";
import { DEFAULT_PUSH_PREFS } from "./push-prefs.ts";
import { FEED_GRACE_MS } from "./schedule.ts";
import { createMemoryStore } from "./store-memory.ts";
import { createPgStore } from "./store.ts";
import { runWatchTick, type WatchLoad } from "./tick.ts";
import { foldEpisode } from "./episode.ts";

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
  btc: Partial<WatchLoad["assets"][number]> & { setupState: WatchLoad["assets"][number]["setupState"] },
  m15: Candle[],
): WatchLoad {
  return {
    assets: [
      WAIT.XAUUSD,
      { ...WAIT.BTCUSD, ...btc, id: "BTCUSD" },
      WAIT.US100,
      WAIT.WTI,
    ],
    m15ByAsset: { BTCUSD: m15 },
    errors: [],
  };
}

describe("push policy", () => {
  it("pushes ENTRADA and TRIGGER PENDIENTE only", () => {
    assert.equal(shouldPushState("entry"), true);
    assert.equal(shouldPushState("pending"), true);
    assert.equal(shouldPushState("map"), false);
    assert.equal(shouldPushState("wait"), false);
  });

  it("maps Apple 403 to a stored HTTP error, 410 to gone", () => {
    assert.equal(formatPushSendError({ statusCode: 410, body: "Gone" }), "gone");
    assert.equal(formatPushSendError({ statusCode: 404 }), "gone");
    assert.match(formatPushSendError({ statusCode: 403, body: "BadJwtToken" }), /HTTP 403/);
    assert.match(formatPushSendError({ statusCode: 403, body: "BadJwtToken" }), /BadJwtToken/);
    assert.equal(pushEndpointHost("https://web.push.apple.com/abc"), "web.push.apple.com");
  });

  it("payload is brief and is not an order", () => {
    const p = buildPushPayload(
      {
        episodeId: "ep-1",
        assetId: "BTCUSD",
        direction: "sell",
        kind: "continuation",
        zoneLow: 77626.01,
        zoneHigh: 77731.43,
        sl: 77747,
        tp1: 76888,
        tp2: 76670.01,
        openedAtMs: 1,
        openedState: "entry",
        currentState: "entry",
        closedAtMs: null,
        levelsKey: "k",
        openedSlot: 1,
        freeze: null,
      },
      "entry",
    );
    assert.equal(p.title, "ATALAYA · BTCUSD");
    assert.match(p.body, /ENTRADA VENTA/);
    assert.match(p.body, /ENTRADA 77\.626/);
    assert.doesNotMatch(p.body, /Zona /);
    assert.doesNotMatch(p.body, /COMPRA AHORA|VENDE AHORA|EJECUTA/i);
    assert.equal(p.url, "/?asset=BTCUSD&episode=ep-1");
    assert.equal(p.episodeId, "ep-1");
    assert.equal(p.assetId, "BTCUSD");
    assert.equal(p.state, "entry");
  });

  it("pending notification says it is not an order", () => {
    const p = buildPushPayload(
      {
        episodeId: "ep-2",
        assetId: "WTI",
        direction: "buy",
        kind: "continuation",
        zoneLow: 1,
        zoneHigh: 2,
        sl: 0.5,
        tp1: 3,
        tp2: null,
        openedAtMs: 1,
        openedState: "pending",
        currentState: "pending",
        closedAtMs: null,
        levelsKey: "k",
        openedSlot: 1,
        freeze: null,
      },
      "pending",
    );
    assert.match(p.body, /TRIGGER PENDIENTE/);
    assert.match(p.body, /no es orden/);
  });
});

describe("deep link", () => {
  it("parses asset + episode and rejects junk", () => {
    assert.deepEqual(parseWatchLink("/?asset=BTCUSD&episode=ep-12345678"), {
      assetId: "BTCUSD",
      episodeId: "ep-12345678",
    });
    assert.equal(parseWatchLink("?asset=EURUSD&episode=ep-12345678"), null);
    assert.equal(parseWatchLink("?asset=BTCUSD&episode=x"), null);
    assert.equal(watchLinkPath("BTCUSD", "abc"), "/?asset=BTCUSD&episode=abc");
  });
});

describe("notify claim is one-shot", () => {
  it("ESPERAR → ENTRADA sends one push; same event none; pending one more; caducity none", async () => {
    const store = createMemoryStore();
    const sent: string[] = [];
    const send = async () => {
      sent.push("x");
      return "ok" as const;
    };
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);

    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = Math.floor(now / 1000);
    const setup: SetupProposal = {
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
      entryLabel: "77731.43",
    };

    const wait = { id: "BTCUSD" as const, setupState: "wait" as const, setup: null, waitReason: "ESPERAR", digits: 2 };
    const entry = { ...wait, setupState: "entry" as const, setup, waitReason: null };
    const pending = { ...wait, setupState: "pending" as const, setup: { ...setup, state: "pending" as const }, waitReason: null };

    const f1 = foldEpisode(null, entry, slot, now);
    assert.equal(f1.episode?.currentState, "entry");
    await store.upsertEpisode(f1.episode!);
    for (const ev of f1.events) await store.insertEvent(ev);
    const n1 = await dispatchEventPushes(store, f1.events, send);
    assert.equal(n1.claimed, 1);
    assert.equal(sent.length, 1);

    const n1b = await dispatchEventPushes(store, f1.events, send);
    assert.equal(n1b.claimed, 0);
    assert.equal(sent.length, 1);

    const f2 = foldEpisode(f1.episode, pending, slot + 900, now + 900_000);
    await store.upsertEpisode(f2.episode!);
    for (const ev of f2.events) await store.insertEvent(ev);
    const n2 = await dispatchEventPushes(store, f2.events, send);
    assert.equal(n2.claimed, 1);
    assert.equal(sent.length, 2);

    const f3 = foldEpisode(f2.episode, wait, slot + 1800, now + 1_800_000);
    if (f3.closePrevious) await store.upsertEpisode(f3.closePrevious);
    for (const ev of f3.events) await store.insertEvent(ev);
    const n3 = await dispatchEventPushes(store, f3.events, send);
    assert.equal(n3.claimed, 0);
    assert.equal(sent.length, 2);
    assert.ok(f3.closePrevious?.closedAtMs);
  });

  it("failed send stays unsent and retries once", async () => {
    const store = createMemoryStore();
    const sent: string[] = [];
    let fail = true;
    const send = async () => {
      if (fail) {
        fail = false;
        return "error" as const;
      }
      sent.push("ok");
      return "ok" as const;
    };
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);
    const setup: SetupProposal = {
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
      entryLabel: "77731.43",
    };
    const entry = {
      id: "BTCUSD" as const,
      setupState: "entry" as const,
      setup,
      waitReason: null,
      digits: 2,
    };
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = Math.floor(now / 1000);
    const f1 = foldEpisode(null, entry, slot, now);
    await store.upsertEpisode(f1.episode!);
    for (const ev of f1.events) await store.insertEvent(ev);
    const n1 = await dispatchEventPushes(store, f1.events, send, now);
    assert.equal(n1.claimed, 1);
    assert.equal(n1.failed, 1);
    assert.equal(sent.length, 0);
    const n2 = await dispatchEventPushes(store, [], send, now + 1);
    assert.equal(n2.claimed, 1);
    assert.equal(n2.failed, 0);
    assert.equal(sent.length, 1);
  });

  it("stores the provider HTTP detail instead of a bare proveedor", async () => {
    const store = createMemoryStore();
    const send = async () => "proveedor HTTP 403 · BadJwtToken";
    await store.upsertPushSub({ endpoint: "https://web.push.apple.com/1", p256dh: "a", auth: "b" }, null);
    const setup: SetupProposal = {
      state: "pending",
      kind: "continuation",
      direction: "buy",
      zone: { low: 1, high: 2 },
      invalidation: 0.5,
      stopLoss: 0.5,
      takeProfit1: 3,
      takeProfit2: null,
      riskReward: 2,
      quality: "media",
      qualityPhase: "final",
      supersedeLevel: null,
      missingForEntry: null,
      slWide: false,
      warnings: [],
      managementNote: "",
      entryLabel: "2",
    };
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const f = foldEpisode(
      null,
      { id: "XAUUSD", setupState: "pending", setup, waitReason: null, digits: 2 },
      Math.floor(now / 1000),
      now,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    const n = await dispatchEventPushes(store, f.events, send, now);
    assert.equal(n.failed, 1);
    const inbox = await store.listInbox(20);
    assert.equal(inbox[0]?.notifyLastError, "proveedor HTTP 403 · BadJwtToken");
  });

  it("new episode_id gets a new push", async () => {
    const store = createMemoryStore();
    const sent: string[] = [];
    const send = async (_s: { endpoint: string }, p: { episodeId: string }) => {
      sent.push(p.episodeId);
      return "ok" as const;
    };
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);
    const setup: SetupProposal = {
      state: "entry",
      kind: "continuation",
      direction: "sell",
      zone: { low: 1, high: 2 },
      invalidation: 3,
      stopLoss: 2.1,
      takeProfit1: 0.5,
      takeProfit2: null,
      riskReward: 2,
      quality: "media",
      qualityPhase: "final",
      supersedeLevel: null,
      missingForEntry: null,
      slWide: false,
      warnings: [],
      managementNote: "",
      entryLabel: "2",
    };
    const a = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      100,
      1,
    );
    await store.upsertEpisode(a.episode!);
    for (const ev of a.events) await store.insertEvent(ev);
    await dispatchEventPushes(store, a.events, send);

    const other = {
      ...setup,
      zone: { low: 10, high: 20 },
      stopLoss: 21,
      takeProfit1: 5,
    };
    const b = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup: other, waitReason: null, digits: 2 },
      200,
      3,
    );
    await store.upsertEpisode(b.episode!);
    for (const ev of b.events) await store.insertEvent(ev);
    await dispatchEventPushes(store, b.events, send);
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0], sent[1]);
  });

  it("gone subscription is disabled and does not fail the batch", async () => {
    const store = createMemoryStore();
    await store.upsertPushSub({ endpoint: "https://push.example/dead", p256dh: "a", auth: "b" }, null);
    await store.upsertPushSub({ endpoint: "https://push.example/live", p256dh: "a", auth: "b" }, null);
    const setup: SetupProposal = {
      state: "entry",
      kind: "continuation",
      direction: "sell",
      zone: { low: 1, high: 2 },
      invalidation: 3,
      stopLoss: 2.1,
      takeProfit1: 0.5,
      takeProfit2: null,
      riskReward: 2,
      quality: "media",
      qualityPhase: "final",
      supersedeLevel: null,
      missingForEntry: null,
      slWide: false,
      warnings: [],
      managementNote: "",
      entryLabel: "2",
    };
    const f = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      1,
      1,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    const n = await dispatchEventPushes(store, f.events, async (sub) =>
      sub.endpoint.includes("dead") ? "gone" : "ok",
    );
    assert.equal(n.claimed, 1);
    assert.equal(n.sent, 1);
    const left = await store.listActivePushSubs();
    assert.equal(left.length, 1);
    assert.equal(left[0]?.endpoint, "https://push.example/live");
  });

  it("quiet hours skip without claiming so the event retries later", async () => {
    const store = createMemoryStore();
    const sent: string[] = [];
    const send = async () => {
      sent.push("x");
      return "ok" as const;
    };
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);
    await store.setPushPrefs({ ...DEFAULT_PUSH_PREFS, quietStart: "23:00", quietEnd: "08:00" });
    const setup: SetupProposal = {
      state: "entry",
      kind: "continuation",
      direction: "sell",
      zone: { low: 1, high: 2 },
      invalidation: 3,
      stopLoss: 2.1,
      takeProfit1: 0.5,
      takeProfit2: null,
      riskReward: 2,
      quality: "media",
      qualityPhase: "final",
      supersedeLevel: null,
      missingForEntry: null,
      slWide: false,
      warnings: [],
      managementNote: "",
      entryLabel: "2",
    };
    const f = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      1,
      1,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    const night = Date.parse("2026-08-30T23:30:00+02:00");
    const n1 = await dispatchEventPushes(store, f.events, send, night);
    assert.equal(n1.claimed, 0);
    assert.equal(sent.length, 0);
    const inbox = await store.listInbox(20);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.notified, false);
    const day = Date.parse("2026-08-31T10:00:00+02:00");
    const n2 = await dispatchEventPushes(store, f.events, send, day);
    assert.equal(n2.claimed, 1);
    assert.equal(sent.length, 1);
  });
});

describe("push_subscriptions uniqueness", () => {
  it("upserts the same endpoint once", async () => {
    const db = new PGlite();
    await db.waitReady;
    await db.exec(readFileSync(new URL("../../../migrations/0002_watch.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../../../migrations/0003_watch_push.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../../../migrations/0004_watch_v10.sql", import.meta.url), "utf8"));
    const store = createPgStore({
      query: async <T>(text: string, params: unknown[] = []) => {
        const r = await db.query<T>(text, params);
        return r.rows as T[];
      },
    });
    await store.upsertPushSub(
      { endpoint: "https://push.example/iphone", p256dh: "aa", auth: "bb" },
      "ios",
    );
    await store.upsertPushSub(
      { endpoint: "https://push.example/iphone", p256dh: "cc", auth: "dd" },
      "ios-2",
    );
    const all = await store.listActivePushSubs();
    assert.equal(all.length, 1);
    assert.equal(all[0]?.p256dh, "cc");

    const ev = {
      episodeId: "ep-race",
      fromState: "wait" as const,
      toState: "entry" as const,
      atMs: 1,
      slot: 1,
      notified: false as const,
    };
    await store.upsertEpisode({
      episodeId: "ep-race",
      assetId: "BTCUSD",
      direction: "sell",
      kind: "continuation",
      zoneLow: 1,
      zoneHigh: 2,
      sl: 3,
      tp1: 0,
      tp2: null,
      openedAtMs: 1,
      openedState: "entry",
      currentState: "entry",
      closedAtMs: null,
      levelsKey: "k",
      openedSlot: 1,
      freeze: null,
    });
    await store.insertEvent(ev);
    const now = Date.now();
    const [x, y] = await Promise.all([
      store.claimNotify("ep-race", 1, "wait", "entry", now),
      store.claimNotify("ep-race", 1, "wait", "entry", now),
    ]);
    assert.equal([x, y].filter(Boolean).length, 1);
  });
});

describe("BTCUSD 29 ago 2026 — tick → push → deep link → setup", () => {
  const raw = JSON.parse(
    readFileSync(new URL("./fixtures/btc-2026-08-29.json", import.meta.url), "utf8"),
  ) as Pack;
  const pack = { m15: inflate(raw.m15), h1: inflate(raw.h1), h4: inflate(raw.h4) };
  const entryBar = Date.parse("2026-08-29T08:00:00.000Z") / 1000;
  const expiredBar = Date.parse("2026-08-29T09:45:00.000Z") / 1000;

  it("watch/tick ENTRADA sends one simulated push; replay sends zero; caducada is not live", async () => {
    const store = createMemoryStore();
    const payloads: Array<{ episodeId: string; state: string; url: string }> = [];
    const send = async (_s: { endpoint: string }, p: { episodeId: string; state: string; url: string }) => {
      payloads.push(p);
      return "ok" as const;
    };
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);

    const entryNow = atClose(entryBar) + FEED_GRACE_MS;
    const engine = runAt(pack, atClose(entryBar));
    assert.equal(engine.state, "entry");
    assert.equal(engine.setup?.direction, "sell");
    assert.ok(engine.setup && Math.abs(engine.setup.zone.low - 77626.01) < 0.05);
    assert.ok(engine.setup && Math.abs(engine.setup.stopLoss - 77747) < 0.05);
    assert.ok(engine.setup && Math.abs(engine.setup.takeProfit1 - 76888) < 0.05);

    const m15 = pack.m15.filter((c) => c.time * 1000 < entryNow);
    const first = await runWatchTick({
      nowMs: entryNow,
      store,
      load: async () =>
        loadAll({ setupState: engine.state, setup: engine.setup, waitReason: engine.waitReason }, m15),
      notify: async (events) => {
        const r = await dispatchEventPushes(store, events, send);
        return r.sent;
      },
    });
    assert.equal(first.status, "ok");
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]?.state, "entry");
    const ep = await store.getOpenEpisode("BTCUSD");
    assert.ok(ep);
    assert.equal(parseWatchLink(payloads[0]!.url)?.assetId, "BTCUSD");
    assert.equal(parseWatchLink(payloads[0]!.url)?.episodeId, ep.episodeId);

    const replay = await runWatchTick({
      nowMs: entryNow,
      store,
      load: async () =>
        loadAll({ setupState: engine.state, setup: engine.setup, waitReason: engine.waitReason }, m15),
      notify: async (events) => {
        const r = await dispatchEventPushes(store, events, send);
        return r.sent;
      },
    });
    assert.equal(replay.status, "duplicate");
    assert.equal(payloads.length, 1);

    const a = await runWatchTick({
      nowMs: entryNow,
      store,
      load: async () =>
        loadAll({ setupState: engine.state, setup: engine.setup, waitReason: engine.waitReason }, m15),
    });
    const b = await runWatchTick({
      nowMs: entryNow,
      store,
      load: async () =>
        loadAll({ setupState: engine.state, setup: engine.setup, waitReason: engine.waitReason }, m15),
    });
    assert.equal(a.status, "duplicate");
    assert.equal(b.status, "duplicate");
    assert.equal(payloads.length, 1);

    const liveAsset = {
      id: "BTCUSD",
      setupState: engine.state,
      setup: engine.setup,
      digits: 2,
      basis: null,
    } as AssetAnalysis;
    assert.equal(hasChartableSetup(liveAsset), true);
    assert.equal(setupChartTf(liveAsset), "15m");
    const lv = chartSetupLevels(liveAsset);
    assert.ok(lv);
    assert.equal(lv.direction, "sell");
    assert.ok(Math.abs(lv.zoneLow - 77626.01) < 0.05);
    assert.ok(Math.abs(lv.stopLoss - 77747) < 0.05);
    assert.ok(Math.abs(lv.takeProfit1 - 76888) < 0.05);

    const expNow = atClose(expiredBar) + FEED_GRACE_MS;
    const expired = runAt(pack, atClose(expiredBar));
    assert.equal(expired.state, "wait");
    const expTick = await runWatchTick({
      nowMs: expNow,
      store,
      load: async () =>
        loadAll(
          { setupState: expired.state, setup: expired.setup, waitReason: expired.waitReason },
          pack.m15.filter((c) => c.time * 1000 < expNow),
        ),
      notify: async (events) => {
        const r = await dispatchEventPushes(store, events, send);
        return r.sent;
      },
    });
    assert.equal(expTick.status, "ok");
    assert.equal(payloads.length, 1);
    const closed = await store.getEpisode(ep.episodeId);
    assert.ok(closed?.closedAtMs);
    assert.equal(closed.currentState, "wait");
    const closedAsset = { ...liveAsset, setupState: "wait" as const, setup: null };
    assert.equal(hasChartableSetup(closedAsset), false);
  });
});

describe("horas silenciosas y pausa 24h no paran V1", () => {
  const setup: SetupProposal = {
    state: "entry",
    kind: "continuation",
    direction: "sell",
    zone: { low: 1, high: 2 },
    invalidation: 3,
    stopLoss: 2.1,
    takeProfit1: 0.5,
    takeProfit2: null,
    riskReward: 2,
    quality: "media",
    qualityPhase: "final",
    supersedeLevel: null,
    missingForEntry: null,
    slWide: false,
    warnings: [],
    managementNote: "",
    entryLabel: "2",
  };

  it("quiet hours skip Push, keep the tray, watch tick still ok", async () => {
    const store = createMemoryStore();
    const sent: string[] = [];
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);
    await store.setPushPrefs({
      ...DEFAULT_PUSH_PREFS,
      quietStart: "23:00",
      quietEnd: "08:00",
    });
    const night = Date.parse("2026-08-30T23:30:00+02:00");
    const f = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      Math.floor(night / 1000),
      night,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    const n = await dispatchEventPushes(store, f.events, async () => {
      sent.push("x");
      return "ok";
    }, night);
    assert.equal(n.skipped, 1);
    assert.equal(sent.length, 0);
    const inbox = await store.listInbox(20);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.notified, false);
  });

  it("pause 24h skips Push and does not stop evaluation", async () => {
    const store = createMemoryStore();
    const sent: string[] = [];
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);
    const now = Date.parse("2026-08-30T12:00:00Z");
    await store.setPushPrefs({
      ...DEFAULT_PUSH_PREFS,
      pausedUntilMs: now + 24 * 60 * 60 * 1000,
    });
    const f = foldEpisode(
      null,
      { id: "WTI", setupState: "pending", setup: { ...setup, state: "pending" }, waitReason: null, digits: 2 },
      Math.floor(now / 1000),
      now,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    const n = await dispatchEventPushes(store, f.events, async () => {
      sent.push("x");
      return "ok";
    }, now);
    assert.equal(sent.length, 0);
    assert.ok(n.skipped >= 1);
    const inbox = await store.listInbox(20);
    assert.equal(inbox[0]?.assetId, "WTI");
    assert.equal(inbox[0]?.notified, false);
  });
});

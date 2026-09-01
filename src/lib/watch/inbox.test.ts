import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetAnalysis, SetupProposal } from "../trading/types.ts";
import { foldEpisode } from "./episode.ts";
import { inboxItemKey, inboxPushLabel, inboxStateLabel } from "./inbox.ts";
import { episodeShareText, setupShareText, shareContainsSecrets } from "./share-setup.ts";
import { createMemoryStore } from "./store-memory.ts";
import { dispatchEventPushes } from "./notify.ts";
import { parseWatchLink } from "./link.ts";
import { DEFAULT_PUSH_PREFS } from "./push-prefs.ts";

const setup: SetupProposal = {
  state: "entry",
  kind: "continuation",
  direction: "sell",
  zone: { low: 77626.01, high: 77731.43 },
  invalidation: 77747,
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

describe("bandeja de avisos", () => {
  it("labels match V1 states", () => {
    assert.equal(inboxStateLabel("entry"), "ENTRADA");
    assert.equal(inboxStateLabel("pending"), "TRIGGER PENDIENTE");
    assert.equal(inboxStateLabel("map"), "MAPA");
    assert.equal(inboxStateLabel("wait"), "ESPERAR");
  });

  it("push label keeps MAPA as bandeja-only and PENDING as unsent until notified", () => {
    const base = {
      episodeId: "x",
      assetId: "XAUUSD" as const,
      direction: "sell" as const,
      fromState: "wait" as const,
      atMs: 1,
      slot: 1,
      live: false,
    };
    assert.equal(inboxPushLabel({ ...base, toState: "map", notified: false }), "solo bandeja");
    assert.equal(inboxPushLabel({ ...base, toState: "wait", notified: false }), "solo bandeja");
    assert.equal(inboxPushLabel({ ...base, toState: "pending", notified: false }), "Push no enviado");
    assert.equal(inboxPushLabel({ ...base, toState: "entry", notified: true }), "Push enviado");
    assert.equal(
      inboxPushLabel({ ...base, toState: "pending", notified: false, notifyStatus: "failed", notifyLastError: "gone" }),
      "Push falló · gone",
    );
  });

  it("stores events even if push is never sent", async () => {
    const store = createMemoryStore();
    const f = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      100,
      1_000,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    const inbox = await store.listInbox(20);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.assetId, "BTCUSD");
    assert.equal(inbox[0]?.toState, "entry");
    assert.equal(inbox[0]?.notified, false);
    assert.equal(inbox[0]?.live, true);
    assert.equal(inboxItemKey(inbox[0]!), `${inbox[0]!.episodeId}|100|wait|entry`);
  });

  it("does not duplicate the same transition", async () => {
    const store = createMemoryStore();
    const f = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      100,
      1_000,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) {
      assert.equal(await store.insertEvent(ev), true);
      assert.equal(await store.insertEvent(ev), false);
    }
    const inbox = await store.listInbox(20);
    assert.equal(inbox.length, 1);
  });

  it("keeps a caducado episode in the tray", async () => {
    const store = createMemoryStore();
    const open = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      100,
      1_000,
    );
    await store.upsertEpisode(open.episode!);
    for (const ev of open.events) await store.insertEvent(ev);
    const closed = foldEpisode(
      open.episode,
      { id: "BTCUSD", setupState: "wait", setup: null, waitReason: "caducado", digits: 2 },
      200,
      2_000,
    );
    if (closed.closePrevious) await store.upsertEpisode(closed.closePrevious);
    for (const ev of closed.events) await store.insertEvent(ev);
    const inbox = await store.listInbox(20);
    assert.ok(inbox.some((r) => r.toState === "entry" && r.live === false));
    const link = parseWatchLink(`?asset=BTCUSD&episode=${open.episode!.episodeId}`);
    assert.equal(link?.episodeId, open.episode!.episodeId);
  });

  it("failed push still leaves the event in the tray", async () => {
    const store = createMemoryStore();
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);
    const f = foldEpisode(
      null,
      { id: "XAUUSD", setupState: "pending", setup: { ...setup, state: "pending" }, waitReason: null, digits: 2 },
      50,
      1_000,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    const n = await dispatchEventPushes(store, f.events, async () => "error");
    assert.equal(n.failed, 1);
    const inbox = await store.listInbox(20);
    assert.equal(inbox[0]?.notified, false);
    assert.equal(inbox[0]?.toState, "pending");
  });

  it("second dispatch of the same episode transition does not send again", async () => {
    const store = createMemoryStore();
    await store.upsertPushSub({ endpoint: "https://push.example/2", p256dh: "a", auth: "b" }, null);
    const f = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      100,
      1_000,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    let sends = 0;
    const send = async () => {
      sends += 1;
      return "ok" as const;
    };
    const first = await dispatchEventPushes(store, f.events, send);
    const second = await dispatchEventPushes(store, f.events, send);
    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0);
    assert.equal(sends, 1);
    const inbox = await store.listInbox(20);
    assert.equal(inbox.length, 1);
  });

  it("caducidad stays in the tray and never becomes Push, even if expired=true", async () => {
    const store = createMemoryStore();
    await store.setPushPrefs({ ...DEFAULT_PUSH_PREFS, expired: true });
    await store.upsertPushSub({ endpoint: "https://push.example/3", p256dh: "a", auth: "b" }, null);
    const open = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      100,
      1_000,
    );
    await store.upsertEpisode(open.episode!);
    for (const ev of open.events) await store.insertEvent(ev);
    let sends = 0;
    const send = async () => {
      sends += 1;
      return "ok" as const;
    };
    const openedPush = await dispatchEventPushes(store, open.events, send);
    assert.equal(openedPush.sent, 1);
    const closed = foldEpisode(
      open.episode,
      { id: "BTCUSD", setupState: "wait", setup: null, waitReason: "caducado", digits: 2 },
      200,
      2_000,
    );
    if (closed.closePrevious) await store.upsertEpisode(closed.closePrevious);
    for (const ev of closed.events) await store.insertEvent(ev);
    const afterOpen = sends;
    const n = await dispatchEventPushes(store, closed.events, send);
    assert.equal(sends, afterOpen);
    assert.ok(n.skipped >= 1);
    const inbox = await store.listInbox(20);
    assert.ok(inbox.some((r) => r.toState === "wait"));
  });
});

describe("compartir setup", () => {
  it("is analysis not an order and includes data lamp", () => {
    const asset = {
      id: "BTCUSD",
      setupState: "pending",
      setup: { ...setup, state: "pending" },
      waitReason: null,
      digits: 2,
      instrumentKind: "proxy",
      feedSymbol: "BTCUSDT",
      dataStatus: "ok",
      lastDataAt: new Date().toISOString(),
      price: 77000,
    } as AssetAnalysis;
    const text = setupShareText(asset);
    assert.match(text, /ATALAYA/);
    assert.match(text, /TRIGGER PENDIENTE/);
    assert.match(text, /Zona:/);
    assert.match(text, /SL:/);
    assert.match(text, /TP1:/);
    assert.match(text, /Estado de datos: DATOS OK/);
    assert.match(text, /Proxy\/fuente: PROXY · BTCUSDT/);
    assert.match(text, /ANÁLISIS — NO ES UNA ORDEN/);
    assert.equal(shareContainsSecrets(text), false);
    assert.doesNotMatch(text, /WATCH_SECRET|VAPID|DATABASE_URL|API_KEY/i);
  });

  it("frozen episode uses stored levels, not a rebuilt signal", () => {
    const ep = {
      episodeId: "ep-frozen-1",
      assetId: "BTCUSD" as const,
      direction: "sell" as const,
      kind: "continuation",
      zoneLow: 77626.01,
      zoneHigh: 77731.43,
      sl: 77747,
      tp1: 76888,
      tp2: 76670.01,
      openedAtMs: 1,
      openedState: "entry" as const,
      currentState: "wait" as const,
      closedAtMs: 2,
      levelsKey: "k",
      openedSlot: 1,
      freeze: {
        slotClosePrice: 77600,
        quality: "media",
        riskReward: 6.1,
        dataSource: "Binance",
        feedSymbol: "BTCUSDT",
        instrumentKind: "proxy",
        basis: null,
        dataStatus: "ok",
        waitReason: null,
        highImpact: false,
        underlyingClosed: false,
        timeframe: "15m" as const,
        setupKind: "continuation",
        capturedAtMs: 1,
      },
    };
    const text = episodeShareText(ep, 2);
    assert.match(text, /ENTRADA/);
    assert.match(text, /77\.747/);
    assert.match(text, /76\.888/);
    assert.doesNotMatch(text, /WATCH_SECRET|VAPID|DATABASE_URL/);
  });

  it("zero subscriptions skip pushable PENDING and leave notified false", async () => {
    const store = createMemoryStore();
    const counts0 = await store.countPushSubs();
    assert.equal(counts0.active, 0);
    const f = foldEpisode(
      null,
      { id: "XAUUSD", setupState: "pending", setup: { ...setup, state: "pending" }, waitReason: null, digits: 2 },
      50,
      1_000,
    );
    await store.upsertEpisode(f.episode!);
    for (const ev of f.events) await store.insertEvent(ev);
    const n = await dispatchEventPushes(store, f.events, async () => "ok");
    assert.equal(n.sent, 0);
    assert.ok(n.skipped >= 1);
    const inbox = await store.listInbox(20);
    assert.equal(inbox[0]?.notified, false);
    assert.equal(inbox[0]?.notifyStatus, "pending");
    await store.upsertPushSub({ endpoint: "https://push.example/z", p256dh: "a", auth: "b" }, null);
    assert.equal((await store.countPushSubs()).active, 1);
    assert.equal(await store.hasPushSub("https://push.example/z"), true);
  });
});

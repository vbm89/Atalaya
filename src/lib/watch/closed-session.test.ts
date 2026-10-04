import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetId, SetupProposal } from "../trading/types.ts";
import { buildMomentumContinuation } from "./continuation.ts";
import { foldEpisode } from "./episode.ts";
import { slotOpenSec, slotSecFromNow } from "./identity.ts";
import { inboxPushLabel } from "./inbox.ts";
import { entrySessionOpen, underlyingSessionOpen } from "./market-session.ts";
import { dispatchEventPushes } from "./notify.ts";
import { createMemoryStore } from "./store-memory.ts";
import { CLOSED_ENTRY_BLOCK, mayOpenWatchContinuation, runWatchTick, type WatchLoad } from "./tick.ts";

/** Sunday 4 Oct 2026 17:45:20 Madrid — the XAU push in this audit. */
const SUN = Date.parse("2026-10-04T15:45:20.922Z");
/** Tuesday 8 Sep 2026 12:00 Madrid. Cash session open. */
const TUE = Date.UTC(2026, 8, 8, 10, 0, 0);
/** Same slot, after the 8s feed grace, so the tick is allowed to run. */
const TUE_TICK = TUE + 20_000;
/** Monday 5 Oct 2026 10:00 Madrid — session already open. */
const MON = Date.parse("2026-10-05T08:00:00.000Z");

function barAt(slot: number) {
  return {
    time: slotOpenSec(slot),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  };
}

const setup: SetupProposal = {
  state: "entry",
  kind: "continuation",
  direction: "sell",
  zone: { low: 4142.52, high: 4142.52 },
  invalidation: 4145.61,
  stopLoss: 4145.61,
  takeProfit1: 4134.26,
  takeProfit2: null,
  riskReward: 2.6,
  quality: "media",
  qualityPhase: "final",
  supersedeLevel: null,
  missingForEntry: null,
  slWide: false,
  warnings: ["MOMENTUM CONTINUATION — capa Watch independiente de V1"],
  managementNote: "",
  entryLabel: "4142.52",
};

describe("continuation fuera de sesión", () => {
  it("Sunday afternoon blocks XAU, US100 and WTI even with the just-closed 15M bar", () => {
    const slot = slotSecFromNow(SUN);
    const m15 = [barAt(slot)];
    assert.equal(underlyingSessionOpen("XAUUSD", SUN), false);
    assert.equal(underlyingSessionOpen("US100", SUN), false);
    assert.equal(underlyingSessionOpen("WTI", SUN), false);
    assert.equal(mayOpenWatchContinuation("XAUUSD", SUN, m15, slot), false);
    assert.equal(mayOpenWatchContinuation("US100", SUN, m15, slot), false);
    assert.equal(mayOpenWatchContinuation("WTI", SUN, m15, slot), false);
    assert.equal(mayOpenWatchContinuation("BTCUSD", SUN, m15, slot), true);
  });

  it("a missing 15M bar blocks continuation even when the clock is open", () => {
    const slot = slotSecFromNow(TUE);
    assert.equal(mayOpenWatchContinuation("US100", TUE, [], slot), false);
    assert.equal(mayOpenWatchContinuation("XAUUSD", TUE, [barAt(slot)], slot), true);
    assert.equal(mayOpenWatchContinuation("US100", TUE, [barAt(slot)], slot), true);
    assert.equal(mayOpenWatchContinuation("WTI", TUE, [barAt(slot)], slot), true);
  });

  it("Sunday tick keeps V1 wait and does not notify", async () => {
    const store = createMemoryStore();
    const slot = slotSecFromNow(SUN);
    const bar = barAt(slot);
    const sent: string[] = [];
    const result = await runWatchTick({
      nowMs: SUN,
      store,
      load: async () => ({
        assets: [
          { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
        ],
        m15ByAsset: { XAUUSD: [bar], BTCUSD: [bar], US100: [bar], WTI: [bar] },
        errors: [],
      }),
      notify: async (events) => {
        for (const ev of events) sent.push(ev.episodeId);
        return events.length;
      },
    });
    assert.equal(result.status, "ok");
    assert.deepEqual(
      result.assets.map((a) => a.state),
      ["wait", "wait", "wait", "wait"],
    );
    assert.equal(sent.length, 0);
  });
});

describe("push con el mercado cerrado", () => {
  it("does not send a Sunday XAU entry and does not retry it on Monday", async () => {
    const store = createMemoryStore();
    await store.upsertPushSub({ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }, null);
    const slot = slotSecFromNow(SUN);
    const folded = foldEpisode(
      null,
      { id: "XAUUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      slot,
      SUN,
    );
    await store.upsertEpisode(folded.episode!);
    for (const ev of folded.events) await store.insertEvent(ev);
    let sends = 0;
    const send = async () => {
      sends += 1;
      return "ok" as const;
    };
    const sunday = await dispatchEventPushes(store, folded.events, send, SUN);
    assert.equal(sunday.sent, 0);
    assert.equal(sunday.claimed, 0);
    assert.ok(sunday.skipped >= 1);
    assert.equal(sends, 0);
    const inbox = await store.listInbox(20);
    assert.equal(inbox[0]?.notified, false);
    assert.equal(inbox[0]?.notifyStatus, "skipped");
    assert.equal(
      inboxPushLabel(inbox[0]!),
      "Push no enviado · mercado cerrado",
    );
    const monday = await dispatchEventPushes(store, [], send, MON);
    assert.equal(monday.sent, 0);
    assert.equal(monday.claimed, 0);
    assert.equal(sends, 0);
  });

  it("still pushes BTC on Sunday", async () => {
    const store = createMemoryStore();
    await store.upsertPushSub({ endpoint: "https://push.example/btc", p256dh: "a", auth: "b" }, null);
    const slot = slotSecFromNow(SUN);
    const folded = foldEpisode(
      null,
      {
        id: "BTCUSD",
        setupState: "entry",
        setup: { ...setup, zone: { low: 64000, high: 64100 }, stopLoss: 64500, takeProfit1: 62000 },
        waitReason: null,
        digits: 2,
      },
      slot,
      SUN,
    );
    await store.upsertEpisode(folded.episode!);
    for (const ev of folded.events) await store.insertEvent(ev);
    let sends = 0;
    const n = await dispatchEventPushes(store, folded.events, async () => {
      sends += 1;
      return "ok";
    }, SUN);
    assert.equal(n.sent, 1);
    assert.equal(sends, 1);
  });
});

const CASH = ["XAUUSD", "US100", "WTI"] as const;
/** Monday 5 Oct 2026 00:00:20 Madrid = Sunday 18:00:20 ET. Bar 17:45–18:00 ET is still the weekend. */
const MON_0000 = Date.parse("2026-10-04T22:00:20.000Z");
/** Monday 5 Oct 2026 00:15:20 Madrid = Sunday 18:15:20 ET. Bar 18:00–18:15 ET is the first in-session bar. */
const MON_0015 = Date.parse("2026-10-04T22:15:20.000Z");
/** Monday 5 Oct 2026 00:30:20 Madrid. Bar 00:15–00:30 is fully inside the session. */
const MON_0030 = Date.parse("2026-10-04T22:30:20.000Z");

function seriesEnding(slot: number, n = 30) {
  const open = slotOpenSec(slot);
  return Array.from({ length: n }, (_, i) => ({
    time: open - (n - 1 - i) * 900,
    open: 100 + i * 0.1,
    high: 101 + i * 0.1,
    low: 99 + i * 0.1,
    close: 100.2 + i * 0.1,
    volume: 10,
  }));
}

function loadEntries(nowMs: number, ids: readonly AssetId[], fresh: boolean): WatchLoad {
  const slot = slotSecFromNow(nowMs);
  const freshBar = barAt(slot);
  const staleBar = { ...freshBar, time: slotOpenSec(slot) - 900 };
  const m15ByAsset: WatchLoad["m15ByAsset"] = { BTCUSD: [freshBar] };
  for (const id of ids) m15ByAsset[id] = [fresh || id === "BTCUSD" ? freshBar : staleBar];
  return {
    assets: ids.map((id) => ({
      id,
      setupState: "entry" as const,
      setup: { ...setup },
      waitReason: null,
      digits: 2,
    })),
    m15ByAsset,
    errors: [],
  };
}

describe("la función de continuación no crea la entrada", () => {
  it("returns null for XAU, US100 and WTI while the underlying is closed", () => {
    const slot = slotSecFromNow(SUN);
    const candles = seriesEnding(slot);
    for (const id of CASH) {
      assert.equal(entrySessionOpen(id, SUN, slotOpenSec(slot), slot), false);
      assert.equal(
        buildMomentumContinuation({
          id,
          m15: candles,
          h1: candles,
          h4: candles,
          nowMs: SUN,
          digits: 2,
        }),
        null,
      );
    }
  });

  it("does not reject BTC on Sunday and rejects a stale bar on an open Tuesday", () => {
    const sunSlot = slotSecFromNow(SUN);
    assert.equal(entrySessionOpen("BTCUSD", SUN, slotOpenSec(sunSlot), sunSlot), true);
    const tueSlot = slotSecFromNow(TUE);
    const stale = seriesEnding(tueSlot).map((c) => ({ ...c, time: c.time - 900 }));
    assert.equal(
      buildMomentumContinuation({
        id: "BTCUSD",
        m15: stale,
        h1: stale,
        h4: stale,
        nowMs: TUE,
        digits: 2,
      }),
      null,
    );
    assert.equal(mayOpenWatchContinuation("BTCUSD", TUE, stale, tueSlot), false);
  });
});

describe("registro de entradas", () => {
  it("does not store a V1 entry for XAU, US100 or WTI on Sunday, and still stores BTC", async () => {
    const store = createMemoryStore();
    const ids = ["XAUUSD", "US100", "WTI", "BTCUSD"] as const;
    const sent: string[] = [];
    const result = await runWatchTick({
      nowMs: SUN,
      store,
      load: async () => loadEntries(SUN, ids, true),
      notify: async (events) => {
        for (const ev of events) sent.push(ev.episodeId);
        return events.length;
      },
    });
    assert.equal(result.status, "ok");
    for (const id of CASH) {
      const row = result.assets.find((a) => a.id === id);
      assert.equal(row?.state, "wait");
      assert.equal(row?.events, 0);
      assert.equal(row?.waitReason, CLOSED_ENTRY_BLOCK);
      assert.equal(await store.getOpenEpisode(id), null);
      const snap = await store.getSnapshot(id);
      assert.equal(snap?.state, "wait");
      assert.equal(snap?.setup, null);
      assert.equal(snap?.waitReason, CLOSED_ENTRY_BLOCK);
    }
    const btc = result.assets.find((a) => a.id === "BTCUSD");
    assert.equal(btc?.state, "entry");
    assert.equal(btc?.events, 1);
    const episode = await store.getOpenEpisode("BTCUSD");
    assert.ok(episode);
    assert.equal(episode?.sl, setup.stopLoss);
    assert.equal(episode?.tp1, setup.takeProfit1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0], episode?.episodeId);
    const inbox = await store.listInbox(20);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.assetId, "BTCUSD");
    assert.equal(inbox.every((row) => row.assetId !== "XAUUSD"), true);
  });

  it("stores the same V1 levels for all four when Tuesday's bar is fresh and the session is open", async () => {
    const store = createMemoryStore();
    const ids = ["XAUUSD", "US100", "WTI", "BTCUSD"] as const;
    const result = await runWatchTick({
      nowMs: TUE_TICK,
      store,
      load: async () => loadEntries(TUE_TICK, ids, true),
    });
    assert.equal(result.status, "ok");
    for (const id of ids) {
      const row = result.assets.find((a) => a.id === id);
      assert.equal(row?.state, "entry", id);
      assert.equal(row?.events, 1, id);
      const episode = await store.getOpenEpisode(id);
      assert.equal(episode?.sl, setup.stopLoss, id);
      assert.equal(episode?.tp1, setup.takeProfit1, id);
      assert.equal(episode?.zoneLow, setup.zone.low, id);
    }
  });

  it("does not store a cash entry from a stale bar even if the session is open", async () => {
    const store = createMemoryStore();
    const result = await runWatchTick({
      nowMs: TUE_TICK,
      store,
      load: async () => loadEntries(TUE_TICK, CASH, false),
    });
    assert.equal(result.status, "ok");
    assert.equal(await store.countOpenEpisodes(), 0);
    assert.equal((await store.listInbox(20)).length, 0);
    for (const id of CASH) {
      assert.equal(result.assets.find((a) => a.id === id)?.state, "wait");
      assert.equal((await store.getSnapshot(id))?.waitReason, CLOSED_ENTRY_BLOCK);
    }
    assert.equal(mayOpenWatchContinuation("BTCUSD", TUE_TICK, [{ ...barAt(slotSecFromNow(TUE_TICK)), time: slotOpenSec(slotSecFromNow(TUE_TICK)) - 900 }], slotSecFromNow(TUE_TICK)), false);
  });

  it("a second Sunday tick does not create a duplicate entry", async () => {
    const store = createMemoryStore();
    const load = async () => loadEntries(SUN, ["XAUUSD"], true);
    const first = await runWatchTick({ nowMs: SUN, store, load });
    const second = await runWatchTick({ nowMs: SUN, store, load });
    assert.equal(first.status, "ok");
    assert.equal(second.status, "duplicate");
    assert.equal(await store.countOpenEpisodes(), 0);
    assert.equal((await store.listInbox(20)).length, 0);
  });
});

describe("reapertura del lunes", () => {
  it("the bar that ends at the Sunday 18:00 ET reopen is not a session bar; the next M15 is", () => {
    const early = slotSecFromNow(MON_0000);
    const first = slotSecFromNow(MON_0015);
    const later = slotSecFromNow(MON_0030);
    for (const id of CASH) {
      assert.equal(entrySessionOpen(id, MON_0000, slotOpenSec(early), early), false, id);
      assert.equal(entrySessionOpen(id, MON_0015, slotOpenSec(first), first), true, id);
      assert.equal(entrySessionOpen(id, MON_0030, slotOpenSec(later), later), true, id);
    }
    assert.equal(entrySessionOpen("BTCUSD", MON_0000, slotOpenSec(early), early), true);
    assert.equal(mayOpenWatchContinuation("XAUUSD", MON_0000, [barAt(early)], early), false);
    assert.equal(mayOpenWatchContinuation("US100", MON_0015, [barAt(first)], first), true);
    assert.equal(mayOpenWatchContinuation("WTI", MON_0030, [barAt(later)], later), true);
  });

  it("does not store a daily-break entry and does not replay it after the reopen", async () => {
    const store = createMemoryStore();
    const during = Date.parse("2026-09-08T21:15:20Z");
    const after = Date.parse("2026-09-08T22:15:20Z");
    const blocked = await runWatchTick({
      nowMs: during,
      store,
      load: async () => loadEntries(during, ["XAUUSD", "US100", "WTI"], true),
    });
    assert.equal(blocked.status, "ok");
    assert.equal(await store.countOpenEpisodes(), 0);
    assert.equal((await store.listInbox(20)).length, 0);
    const sent: string[] = [];
    const opened = await runWatchTick({
      nowMs: after,
      store,
      load: async () => loadEntries(after, ["XAUUSD"], true),
      notify: async (events) => {
        for (const ev of events) sent.push(`${ev.slot}:${ev.toState}`);
        return events.length;
      },
    });
    assert.equal(opened.assets.find((a) => a.id === "XAUUSD")?.state, "entry");
    const ep = await store.getOpenEpisode("XAUUSD");
    assert.equal(ep?.sl, setup.stopLoss);
    assert.equal(ep?.tp1, setup.takeProfit1);
    assert.equal(ep?.zoneLow, setup.zone.low);
    assert.equal(ep?.zoneHigh, setup.zone.high);
    assert.deepEqual(sent, [`${slotSecFromNow(after)}:entry`]);
    assert.equal(await store.countOpenEpisodes(), 1);
  });

  it("does not send or duplicate a Sunday entry when the market reopens", async () => {
    const store = createMemoryStore();
    await store.upsertPushSub({ endpoint: "https://push.example/mon", p256dh: "a", auth: "b" }, null);
    const sunSlot = slotSecFromNow(SUN);
    const historical = foldEpisode(
      null,
      { id: "XAUUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      sunSlot,
      SUN,
    );
    const before = historical.episode!;
    await store.upsertEpisode(before);
    for (const ev of historical.events) await store.insertEvent(ev);

    let sends = 0;
    const monday = await runWatchTick({
      nowMs: MON_0030,
      store,
      load: async () => loadEntries(MON_0030, ["XAUUSD"], true),
      notify: async (events) => {
        const out = await dispatchEventPushes(store, events, async () => {
          sends += 1;
          return "ok";
        }, MON_0030);
        return out.sent;
      },
    });
    assert.equal(monday.status, "ok");
    assert.equal(sends, 0);
    assert.equal(await store.countOpenEpisodes(), 1);
    const still = await store.getOpenEpisode("XAUUSD");
    assert.equal(still?.episodeId, before.episodeId);
    assert.equal(still?.openedSlot, before.openedSlot);
    assert.equal(still?.sl, before.sl);
    assert.equal(still?.tp1, before.tp1);
    assert.equal(still?.closedAtMs, null);
    const inbox = await store.listInbox(20);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.episodeId, before.episodeId);
    assert.equal(inbox[0]?.notified, false);
    assert.equal(inbox[0]?.notifyStatus, "skipped");
    assert.equal(monday.assets.find((a) => a.id === "XAUUSD")?.events, 0);
  });

  it("leaves an already sent Sunday row untouched", async () => {
    const store = createMemoryStore();
    const sunSlot = slotSecFromNow(SUN);
    const historical = foldEpisode(
      null,
      { id: "US100", setupState: "entry", setup, waitReason: null, digits: 2 },
      sunSlot,
      SUN,
    );
    await store.upsertEpisode(historical.episode!);
    for (const ev of historical.events) await store.insertEvent(ev);
    await store.markNotifySent(historical.episode!.episodeId, historical.events[0]!.slot, "wait", "entry", SUN);
    const monday = await dispatchEventPushes(store, [], async () => "ok", MON_0030);
    assert.equal(monday.sent, 0);
    const inbox = await store.listInbox(20);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.notified, true);
    assert.equal(inbox[0]?.notifyStatus, "sent");
    assert.equal(inboxPushLabel(inbox[0]!), "Push enviado");
  });
});

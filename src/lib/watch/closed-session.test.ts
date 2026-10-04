import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SetupProposal } from "../trading/types.ts";
import { foldEpisode } from "./episode.ts";
import { slotOpenSec, slotSecFromNow } from "./identity.ts";
import { inboxPushLabel } from "./inbox.ts";
import { underlyingSessionOpen } from "./market-session.ts";
import { dispatchEventPushes } from "./notify.ts";
import { createMemoryStore } from "./store-memory.ts";
import { mayOpenWatchContinuation, runWatchTick } from "./tick.ts";

/** Sunday 4 Oct 2026 17:45:20 Madrid — the XAU push in this audit. */
const SUN = Date.parse("2026-10-04T15:45:20.922Z");
/** Tuesday 8 Sep 2026 12:00 Madrid. Cash session open. */
const TUE = Date.UTC(2026, 8, 8, 10, 0, 0);
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

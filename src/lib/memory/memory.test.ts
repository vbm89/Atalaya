import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Candle, SetupProposal } from "../trading/types.ts";
import { slotSecFromNow } from "../watch/identity.ts";
import { createPgStore } from "../watch/store.ts";
import { runWatchTick, type WatchLoad } from "../watch/tick.ts";
import { OUTCOME_RULE } from "../watch/outcome.ts";
import { buildPostMortem } from "./postmortem.ts";
import {
  journalIncomplete,
  mergeJournal,
  parseClearFields,
  parseJournalInput,
  sheetJournalEpisodeId,
} from "./journal.ts";
import {
  rememberAfterTick,
  persistArchiveM15,
  persistEvalVersion,
  persistPostMortemOnce,
  upsertJournal,
  writeTerminalPostMortems,
  loadTape,
  loadContext,
  loadPostMortem,
  loadJournal,
} from "./persist.ts";
import { readGitSha, V1_LABEL } from "./sha.ts";
import { sessionFromStamp, madridStamp } from "./session.ts";
import { detectGaps, forwardOf, lookbackOf } from "./tape.ts";
import type { EpisodeDraft } from "../watch/episode.ts";

function bar(t: number, close: number, extra: Partial<Candle> = {}): Candle {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1, ...extra };
}

describe("memory sha", () => {
  it("reads VERCEL_GIT_COMMIT_SHA and rejects garbage", () => {
    assert.equal(
      readGitSha({ VERCEL_GIT_COMMIT_SHA: "947717a74b8d9782d4b3245cbda3ef0b92725921" }),
      "947717a74b8d9782d4b3245cbda3ef0b92725921",
    );
    assert.equal(readGitSha({ GIT_SHA: "not-a-sha" }), null);
    assert.equal(readGitSha({}), null);
    assert.equal(V1_LABEL, "V1");
  });
});

describe("memory session", () => {
  it("maps 10:15 Madrid (08:15Z summer) to Londres", () => {
    const stamp = madridStamp(Date.parse("2026-08-29T08:15:00.000Z"));
    assert.ok(stamp);
    assert.equal(stamp.time, "10:15");
    assert.equal(sessionFromStamp(stamp), "londres");
  });

  it("maps 16:00 Madrid to solape", () => {
    const stamp = madridStamp(Date.parse("2026-08-29T14:00:00.000Z"));
    assert.ok(stamp);
    assert.equal(sessionFromStamp(stamp), "solape");
  });
});

describe("memory tape", () => {
  it("splits lookback/forward on the decision bar and does not invent gaps", () => {
    const openedSlot = 1_000 + 900;
    const candles = [bar(100, 10), bar(1000, 20), bar(1900, 30), bar(2800, 40)];
    const look = lookbackOf(candles, "15m", openedSlot);
    const fwd = forwardOf(candles, "15m", openedSlot);
    assert.deepEqual(look.map((b) => b.t), [100, 1000]);
    assert.deepEqual(fwd.map((b) => b.t), [1900, 2800]);
    assert.deepEqual(detectGaps([100, 1000], "15m"), []);
  });

  it("detects a missing 15m open without filling it", () => {
    const gaps = detectGaps([1000, 1000 + 1800], "15m");
    assert.deepEqual(gaps, [1900]);
  });
});

describe("memory journal + postmortem", () => {
  it("rejects invalid journal and does not invent prices", () => {
    const bad = parseJournalInput({ episodeId: "x", action: "took" });
    assert.ok("error" in bad);
    const ok = parseJournalInput({ episodeId: "BTCUSD-123456-abcd", action: "skipped" });
    assert.ok(!("error" in ok));
    if (!("error" in ok)) {
      assert.equal(ok.action, "skipped");
      assert.equal(ok.lots, null);
      assert.equal(ok.entryPrice, null);
    }
  });

  it("merge keeps stored numbers when the new payload is blank", () => {
    const existing = parseJournalInput({
      episodeId: "WTI-1788354900-83d68711",
      action: "took",
      lots: 0.1,
      entryPrice: 88.41,
      exitPrice: 89.1,
      note: "7,68€",
    });
    assert.ok(!("error" in existing));
    if ("error" in existing) return;
    const blank = parseJournalInput({
      episodeId: existing.episodeId,
      action: "took",
    });
    assert.ok(!("error" in blank));
    if ("error" in blank) return;
    const merged = mergeJournal(existing, blank);
    assert.equal(merged.lots, 0.1);
    assert.equal(merged.entryPrice, 88.41);
    assert.equal(merged.exitPrice, 89.1);
    assert.equal(merged.note, "7,68€");
    const wiped = mergeJournal(existing, blank, ["lots"]);
    assert.equal(wiped.lots, null);
    assert.equal(wiped.entryPrice, 88.41);
  });

  it("TOMÉ without lot or fill is incomplete; NO TOMÉ is not", () => {
    assert.equal(journalIncomplete({ action: "took", lots: null, entryPrice: null }), true);
    assert.equal(journalIncomplete({ action: "partial", lots: 0.1, entryPrice: null }), true);
    assert.equal(journalIncomplete({ action: "took", lots: 0.1, entryPrice: 88.4 }), false);
    assert.equal(journalIncomplete({ action: "skipped", lots: null, entryPrice: null }), false);
    assert.deepEqual(parseClearFields(["lots", "nope", "note", "lots"]), ["lots", "note"]);
  });

  it("live sheet journal attaches only to MAPA/PENDING/ENTRADA with episode_id", () => {
    const id = "BTCUSD-1787991300-abcd1234";
    for (const state of ["map", "pending", "entry"] as const) {
      assert.equal(
        sheetJournalEpisodeId({
          assetId: "BTCUSD",
          setupState: state,
          snapshotEpisodeId: id,
        }),
        id,
      );
    }
    assert.equal(
      sheetJournalEpisodeId({
        assetId: "WTI",
        setupState: "wait",
        snapshotEpisodeId: "WTI-1788354900-83d68711",
      }),
      null,
    );
    assert.equal(
      sheetJournalEpisodeId({
        assetId: "BTCUSD",
        setupState: "entry",
        snapshotEpisodeId: null,
      }),
      null,
    );
    assert.equal(
      sheetJournalEpisodeId({
        assetId: "BTCUSD",
        setupState: "wait",
        snapshotEpisodeId: null,
        focus: { assetId: "BTCUSD", episodeId: id, live: true },
      }),
      id,
    );
    assert.equal(
      sheetJournalEpisodeId({
        assetId: "BTCUSD",
        setupState: "wait",
        snapshotEpisodeId: id,
        focus: { assetId: "BTCUSD", episodeId: id, live: false },
      }),
      null,
    );
  });

  it("marks missing tape/context as PENDIENTE, never causal", () => {
    const ep: EpisodeDraft = {
      episodeId: "BTCUSD-1000-deadbeef",
      assetId: "BTCUSD",
      direction: "sell",
      kind: "continuation",
      zoneLow: 10,
      zoneHigh: 12,
      sl: 13,
      tp1: 8,
      tp2: 6,
      openedAtMs: 1,
      openedState: "entry",
      currentState: "wait",
      closedAtMs: 2,
      levelsKey: "k",
      openedSlot: 1000,
      freeze: null,
    };
    const pm = buildPostMortem({
      row: { episode: ep, outcome: "tp1", firstTouch: "tp1", firstTouchAtMs: 2, mfe: 4, mae: 0.5 },
      context: null,
      tape: [],
      journal: null,
      freeze: null,
    });
    assert.equal(pm.outcome, "TP1");
    assert.ok(pm.pending.length > 0);
    assert.match(pm.disclaimer, /No es una explicación causal/);
    assert.ok(pm.facts.some((f) => f.key === "tape15" && f.value === "PENDIENTE"));
    assert.ok(!pm.facts.some((f) => /porque/i.test(f.value)));
  });
});

describe("memory persist PGLite", () => {
  async function boot() {
    const pg = new PGlite();
    await pg.waitReady;
    for (const name of ["0002_watch.sql", "0003_watch_push.sql", "0004_watch_v10.sql", "0005_memory.sql"]) {
      await pg.exec(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
    }
    const sql = {
      query: async <T>(text: string, params: unknown[] = []) => {
        const r = await pg.query<T>(text, params);
        return r.rows as T[];
      },
    };
    return { pg, sql, store: createPgStore(sql) };
  }

  const setup: SetupProposal = {
    state: "entry",
    kind: "continuation",
    direction: "sell",
    zone: { low: 100, high: 110 },
    invalidation: 120,
    stopLoss: 112,
    takeProfit1: 90,
    takeProfit2: 80,
    riskReward: 5,
    quality: "media",
    qualityPhase: "final",
    supersedeLevel: null,
    missingForEntry: null,
    slWide: false,
    warnings: ["aviso de prueba"],
    managementNote: "",
    entryLabel: "110",
  };

  it("archives M15 without duplicates and keeps first OHLC", async () => {
    const { sql } = await boot();
    const t = 1_787_991_000;
    const n1 = await persistArchiveM15(sql, "BTCUSD", [bar(t, 10), bar(t, 11)], "bitget", "BTCUSDT", Date.now());
    const n2 = await persistArchiveM15(
      sql,
      "BTCUSD",
      [bar(t, 99, { high: 200 })],
      "bitget",
      "BTCUSDT",
      Date.now(),
    );
    assert.equal(n1, 1);
    assert.equal(n2, 0);
    const rows = await sql.query<{ c: number }>("select c from market_m15 where asset_id = $1 and t = $2", [
      "BTCUSD",
      t,
    ]);
    assert.equal(Number(rows[0]?.c), 10);
  });

  it("records SHA once and does not rewrite it", async () => {
    const { sql, store } = await boot();
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = slotSecFromNow(now);
    await store.claimEval(slot, now);
    await store.completeEval(slot, now, "ok", null, 1, {});
    process.env.VERCEL_GIT_COMMIT_SHA = "c3d53a4f4366add2c8a284d4f068ea5d2826a36e";
    await persistEvalVersion(sql, slot, now, readGitSha());
    await persistEvalVersion(sql, slot, now + 1000, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const rows = await sql.query<{ git_sha: string }>("select git_sha from watch_eval_versions where slot = $1", [
      slot,
    ]);
    assert.equal(rows[0]?.git_sha, "c3d53a4f4366add2c8a284d4f068ea5d2826a36e");
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("tick remember writes tape + context; freeze stays unchanged", async () => {
    const { sql, store } = await boot();
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = slotSecFromNow(now);
    const open = slot - 900;
    const m15 = [bar(open - 900, 108), bar(open, 110), bar(open + 900, 109)];
    const load = async (): Promise<WatchLoad> => ({
      assets: [
        { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
        {
          id: "BTCUSD",
          setupState: "entry",
          setup,
          waitReason: null,
          digits: 2,
          freeze: {
            slotClosePrice: 110,
            quality: "media",
            riskReward: 5,
            dataSource: "bitget",
            feedSymbol: "BTCUSDT",
            instrumentKind: "proxy",
            basis: null,
            dataStatus: "ok",
            waitReason: null,
            highImpact: false,
            underlyingClosed: false,
            timeframe: "15m",
            setupKind: "continuation",
            capturedAtMs: now,
            warnings: ["aviso de prueba"],
          },
        },
        { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
        { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
      ],
      m15ByAsset: { BTCUSD: m15, XAUUSD: m15, US100: m15, WTI: m15 },
      h1ByAsset: { BTCUSD: [bar(open - 3600, 100)] },
      h4ByAsset: { BTCUSD: [bar(open - 14400, 90)] },
      errors: [],
    });
    const tick = await runWatchTick({
      nowMs: now,
      store,
      load,
      remember: (work) => rememberAfterTick(sql, work),
    });
    assert.equal(tick.status, "ok");
    const ep = await store.getOpenEpisode("BTCUSD");
    assert.ok(ep);
    const freeze = ep.freeze;
    assert.equal(freeze?.warnings?.[0], "aviso de prueba");
    const tape = await loadTape(sql, ep.episodeId);
    assert.ok(tape.some((b) => b.tf === "15m" && b.role === "lookback" && b.t === open));
    assert.ok(tape.some((b) => b.tf === "1h" && b.role === "lookback"));
    const ctx = await loadContext(sql, ep.episodeId);
    assert.ok(ctx);
    assert.equal(ctx.session, "londres");
    assert.equal(ctx.warnings?.[0], "aviso de prueba");
    const archived = await sql.query<{ n: number }>("select count(*)::int as n from market_m15");
    assert.equal(Number(archived[0]?.n), 12);
    const shaRows = await sql.query<{ slot: number }>("select slot from watch_eval_versions where slot = $1", [slot]);
    assert.equal(shaRows.length, 1);
    const again = await runWatchTick({
      nowMs: now,
      store,
      load,
      remember: (work) => rememberAfterTick(sql, work),
    });
    assert.equal(again.status, "duplicate");
    const tape2 = await loadTape(sql, ep.episodeId);
    assert.equal(tape2.length, tape.length);
    const ep2 = await store.getEpisode(ep.episodeId);
    assert.deepEqual(ep2?.freeze, freeze);
  });

  it("remember failure never fails V1 tick", async () => {
    const { store } = await boot();
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = slotSecFromNow(now);
    const open = slot - 900;
    const m15 = [bar(open, 110)];
    const tick = await runWatchTick({
      nowMs: now,
      store,
      load: async () => ({
        assets: [
          { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
        ],
        m15ByAsset: { BTCUSD: m15, XAUUSD: m15, US100: m15, WTI: m15 },
        errors: [],
      }),
      remember: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(tick.status, "ok");
    const evalRow = await store.getEval(slot);
    assert.equal(evalRow?.status, "ok");
  });

  it("journal upsert does not change V1 outcome", async () => {
    const { sql, store } = await boot();
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = slotSecFromNow(now);
    const open = slot - 900;
    const m15 = [bar(open, 110)];
    await runWatchTick({
      nowMs: now,
      store,
      load: async () => ({
        assets: [
          { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          {
            id: "BTCUSD",
            setupState: "entry",
            setup,
            waitReason: null,
            digits: 2,
          },
          { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
        ],
        m15ByAsset: { BTCUSD: m15, XAUUSD: m15, US100: m15, WTI: m15 },
        errors: [],
      }),
    });
    const ep = await store.getOpenEpisode("BTCUSD");
    assert.ok(ep);
    const before = await sql.query("select outcome, mfe, mae from signal_outcomes where episode_id = $1", [
      ep.episodeId,
    ]);
    const parsed = parseJournalInput({
      episodeId: ep.episodeId,
      action: "took",
      lots: 0.1,
      entryPrice: 110.5,
    });
    assert.ok(!("error" in parsed));
    if (!("error" in parsed)) await upsertJournal(sql, parsed);
    const after = await sql.query("select outcome, mfe, mae from signal_outcomes where episode_id = $1", [
      ep.episodeId,
    ]);
    assert.deepEqual(after, before);
    const ep2 = await store.getEpisode(ep.episodeId);
    assert.deepEqual(ep2, ep);
  });

  it("journal blank save does not null existing lots; Vaciar does", async () => {
    const { sql, store } = await boot();
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = slotSecFromNow(now);
    const open = slot - 900;
    const m15 = [bar(open, 110)];
    await runWatchTick({
      nowMs: now,
      store,
      load: async () => ({
        assets: [
          { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "BTCUSD", setupState: "map", setup, waitReason: null, digits: 2 },
          { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
        ],
        m15ByAsset: { BTCUSD: m15, XAUUSD: m15, US100: m15, WTI: m15 },
        errors: [],
      }),
    });
    const ep = await store.getOpenEpisode("BTCUSD");
    assert.ok(ep);
    assert.equal(ep.openedState, "map");
    const first = parseJournalInput({
      episodeId: ep.episodeId,
      action: "took",
      lots: 0.25,
      entryPrice: 110.5,
      note: "keep me",
    });
    assert.ok(!("error" in first));
    if ("error" in first) return;
    await upsertJournal(sql, first);
    const blank = parseJournalInput({
      episodeId: ep.episodeId,
      action: "took",
      note: "only note",
    });
    assert.ok(!("error" in blank));
    if ("error" in blank) return;
    const kept = await upsertJournal(sql, blank);
    assert.equal(kept.lots, 0.25);
    assert.equal(kept.entryPrice, 110.5);
    assert.equal(kept.note, "only note");
    const skipped = parseJournalInput({ episodeId: ep.episodeId, action: "skipped" });
    assert.ok(!("error" in skipped));
    if ("error" in skipped) return;
    const asSkip = await upsertJournal(sql, skipped);
    assert.equal(asSkip.action, "skipped");
    assert.equal(asSkip.lots, 0.25);
    const emptyTook = parseJournalInput({ episodeId: ep.episodeId, action: "took" });
    assert.ok(!("error" in emptyTook));
    if ("error" in emptyTook) return;
    const incomplete = await upsertJournal(sql, emptyTook, ["lots", "entryPrice"]);
    assert.equal(incomplete.lots, null);
    assert.equal(incomplete.entryPrice, null);
    assert.equal(incomplete.note, "only note");
    assert.equal(journalIncomplete(incomplete), true);
    const stillMap = await store.getEpisode(ep.episodeId);
    assert.equal(stillMap?.openedState, "map");
    assert.equal(stillMap?.currentState, ep.currentState);
  });

  it("live MAPA/PENDING/ENTRADA share one journal; TOMÉ does not change V1", async () => {
    for (const state of ["map", "pending", "entry"] as const) {
      const { sql, store } = await boot();
      const now = Date.parse("2026-08-29T08:15:08.000Z");
      const slot = slotSecFromNow(now);
      const open = slot - 900;
      const m15 = [bar(open, 110)];
      await runWatchTick({
        nowMs: now,
        store,
        load: async () => ({
          assets: [
            { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
            { id: "BTCUSD", setupState: state, setup: { ...setup, state }, waitReason: null, digits: 2 },
            { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
            { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          ],
          m15ByAsset: { BTCUSD: m15, XAUUSD: m15, US100: m15, WTI: m15 },
          errors: [],
        }),
      });
      const ep = await store.getOpenEpisode("BTCUSD");
      assert.ok(ep);
      assert.equal(ep.currentState, state);
      assert.equal(ep.openedState, state);
      const snap = await store.getSnapshot("BTCUSD");
      assert.equal(snap?.state, state);
      assert.equal(snap?.episodeId, ep.episodeId);
      assert.equal(
        sheetJournalEpisodeId({
          assetId: "BTCUSD",
          setupState: snap?.state ?? "wait",
          snapshotEpisodeId: snap?.episodeId ?? null,
        }),
        ep.episodeId,
      );
      const waitHidden = sheetJournalEpisodeId({
        assetId: "BTCUSD",
        setupState: "wait",
        snapshotEpisodeId: ep.episodeId,
      });
      assert.equal(waitHidden, null);
      const first = parseJournalInput({
        episodeId: ep.episodeId,
        action: "took",
        lots: 0.1,
        entryPrice: 110.5,
        note: "keep me",
      });
      assert.ok(!("error" in first));
      if ("error" in first) return;
      await upsertJournal(sql, first);
      const blank = parseJournalInput({ episodeId: ep.episodeId, action: "took" });
      assert.ok(!("error" in blank));
      if ("error" in blank) return;
      const kept = await upsertJournal(sql, blank);
      assert.equal(kept.lots, 0.1);
      assert.equal(kept.entryPrice, 110.5);
      assert.equal(kept.note, "keep me");
      const wiped = await upsertJournal(sql, blank, ["lots"]);
      assert.equal(wiped.lots, null);
      assert.equal(wiped.entryPrice, 110.5);
      const loaded = await loadJournal(sql, ep.episodeId);
      assert.equal(loaded?.action, "took");
      assert.equal(loaded?.entryPrice, 110.5);
      const history = await store.listHistory(80);
      const hist = history.find((row) => row.episode.episodeId === ep.episodeId);
      assert.ok(hist);
      const fromHistory = await loadJournal(sql, hist.episode.episodeId);
      assert.deepEqual(fromHistory, loaded);
      const still = await store.getEpisode(ep.episodeId);
      assert.equal(still?.currentState, state);
      assert.equal(still?.openedState, state);
      assert.equal(still?.closedAtMs, null);
    }
  });

  it("post-mortem first write wins and sweep fills a miss", async () => {
    const { sql, store } = await boot();
    const now = Date.parse("2026-08-29T08:15:08.000Z");
    const slot = slotSecFromNow(now);
    const open = slot - 900;
    await runWatchTick({
      nowMs: now,
      store,
      load: async () => ({
        assets: [
          { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
          { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
          { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 },
        ],
        m15ByAsset: {
          BTCUSD: [bar(open, 110)],
          XAUUSD: [bar(open, 110)],
          US100: [bar(open, 110)],
          WTI: [bar(open, 110)],
        },
        errors: [],
      }),
    });
    const ep = await store.getOpenEpisode("BTCUSD");
    assert.ok(ep);
    await store.upsertOutcome(ep.episodeId, now, {
      rule: OUTCOME_RULE,
      outcome: "tp1",
      firstTouch: "tp1",
      firstTouchAtSec: Math.floor(now / 1000),
      exitAtSec: Math.floor(now / 1000),
      mfe: 4,
      mae: 0.2,
    });
    await writeTerminalPostMortems(sql, [ep], now);
    const first = await loadPostMortem(sql, ep.episodeId);
    assert.ok(first);
    assert.equal(first.outcome, "TP1");
    await persistPostMortemOnce(
      sql,
      { ...first, outcome: "SL", facts: first.facts, pending: [], complete: true, episodeId: ep.episodeId, disclaimer: first.disclaimer },
      now + 1,
    );
    const second = await loadPostMortem(sql, ep.episodeId);
    assert.equal(second?.outcome, "TP1");
  });
});

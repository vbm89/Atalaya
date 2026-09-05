import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetId, SetupState } from "../trading/types.ts";
import {
  buildSignalTimeline,
  formatTimelineHm,
  resolveTimelineEpisodeId,
  UNREGISTERED_TIMELINE_STEPS,
  type TimelineHistoryRow,
  type TimelineTransition,
} from "./signal-timeline.ts";

const A = "XAUUSD" as AssetId;
const B = "BTCUSD" as AssetId;

function ev(
  episodeId: string,
  from: SetupState,
  to: SetupState,
  atMs: number,
  assetId: AssetId = A,
): TimelineTransition {
  return { episodeId, assetId, fromState: from, toState: to, atMs };
}

function hist(
  episodeId: string,
  extra: Partial<TimelineHistoryRow["episode"]> &
    Partial<Omit<TimelineHistoryRow, "episode">> = {},
): TimelineHistoryRow {
  const { outcome, firstTouch, firstTouchAtMs, hadV1Entry, ...ep } = extra;
  return {
    episode: {
      episodeId,
      assetId: A,
      openedAtMs: 1_000,
      openedState: "map",
      closedAtMs: null,
      ...ep,
    },
    outcome: outcome ?? null,
    firstTouch: firstTouch ?? null,
    firstTouchAtMs: firstTouchAtMs ?? null,
    hadV1Entry,
  };
}

describe("resolveTimelineEpisodeId", () => {
  it("ignores the chart placeholder 'live' and falls through to the real id", () => {
    assert.equal(
      resolveTimelineEpisodeId("live", "XAUUSD-1788599700-2d4c80b0"),
      "XAUUSD-1788599700-2d4c80b0",
    );
    assert.equal(resolveTimelineEpisodeId("live"), null);
    assert.equal(resolveTimelineEpisodeId("short"), null);
    assert.equal(resolveTimelineEpisodeId(null, "  ", "episode-real"), "episode-real");
  });
});

describe("buildSignalTimeline", () => {
  it("1. MAPA → PENDING → ENTRY in recorded order", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-a",
      events: [
        ev("episode-a", "pending", "entry", 3_000),
        ev("episode-a", "wait", "map", 1_000),
        ev("episode-a", "map", "pending", 2_000),
      ],
      history: [hist("episode-a", { openedState: "map", openedAtMs: 1_000, hadV1Entry: true })],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["map", "pending", "entry"],
    );
    assert.deepEqual(
      rows.map((r) => r.atMs),
      [1_000, 2_000, 3_000],
    );
    assert.deepEqual(
      rows.map((r) => r.title),
      ["MAPA", "PENDING", "ENTRADA"],
    );
  });

  it("2. PENDING without ENTRY does not invent ENTRY", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-p",
      events: [ev("episode-p", "wait", "pending", 5_000)],
      history: [hist("episode-p", { openedState: "pending", openedAtMs: 5_000, hadV1Entry: false })],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["pending"],
    );
    assert.ok(!rows.some((r) => r.kind === "entry"));
  });

  it("3. ENTRY + TP1 shows ENTRY then TP1", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-tp",
      events: [ev("episode-tp", "pending", "entry", 10_000)],
      history: [
        hist("episode-tp", {
          openedState: "entry",
          openedAtMs: 10_000,
          hadV1Entry: true,
          firstTouch: "tp1",
          firstTouchAtMs: 12_000,
          outcome: "tp1",
        }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["entry", "tp1"],
    );
    assert.equal(rows[1]?.title, "TP1");
    assert.equal(rows[1]?.atMs, 12_000);
  });

  it("4. ENTRY + SL shows ENTRY then SL", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-sl",
      events: [ev("episode-sl", "map", "entry", 8_000)],
      history: [
        hist("episode-sl", {
          openedState: "entry",
          hadV1Entry: true,
          firstTouch: "sl",
          firstTouchAtMs: 9_000,
          outcome: "sl",
        }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["entry", "sl"],
    );
    assert.equal(rows[1]?.tone, "sell");
  });

  it("5. different episodes of the same asset are not mixed", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-new",
      events: [
        ev("episode-old", "wait", "map", 100),
        ev("episode-old", "map", "entry", 200),
        ev("episode-new", "wait", "pending", 9_000),
      ],
      history: [
        hist("episode-old", {
          openedAtMs: 100,
          openedState: "map",
          hadV1Entry: true,
          firstTouch: "tp1",
          firstTouchAtMs: 300,
          outcome: "tp1",
        }),
        hist("episode-new", { openedAtMs: 9_000, openedState: "pending" }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["pending"],
    );
    assert.ok(!rows.some((r) => r.kind === "map" || r.kind === "entry" || r.kind === "tp1"));
  });

  it("6. missing BOS / zona / T2 are not invented", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-a",
      events: [ev("episode-a", "wait", "map", 1_000), ev("episode-a", "map", "pending", 2_000)],
      history: [hist("episode-a")],
    });
    const titles = rows.map((r) => r.title).join(" ");
    assert.doesNotMatch(titles, /BOS|Zona detectada|T2/i);
    assert.ok(!rows.some((r) => /bos|zona|t2/i.test(r.kind)));
    assert.deepEqual([...UNREGISTERED_TIMELINE_STEPS], ["BOS 4H", "zona de origen", "T2"]);
  });

  it("7. events with timestamps stay chronological", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-a",
      events: [
        ev("episode-a", "pending", "entry", 30_000),
        ev("episode-a", "wait", "map", 10_000),
        ev("episode-a", "map", "pending", 20_000),
      ],
      history: [
        hist("episode-a", {
          hadV1Entry: true,
          firstTouch: "tp2",
          firstTouchAtMs: 40_000,
          outcome: "tp2",
        }),
      ],
    });
    const times = rows.map((r) => r.atMs);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["map", "pending", "entry", "tp2"],
    );
  });

  it("8. no events / no episode → empty, never a fake now-node", () => {
    assert.deepEqual(
      buildSignalTimeline({ assetId: A, episodeId: null, events: [ev("x", "wait", "map", 1)], history: [] }),
      [],
    );
    assert.deepEqual(
      buildSignalTimeline({ assetId: A, episodeId: "missing", events: [], history: [] }),
      [],
    );
    assert.deepEqual(
      buildSignalTimeline({
        assetId: A,
        episodeId: "episode-a",
        events: [ev("episode-a", "wait", "map", 1, B)],
        history: [],
      }),
      [],
    );
    assert.deepEqual(
      buildSignalTimeline({
        assetId: A,
        episodeId: "live",
        events: [ev("live", "wait", "pending", 1)],
        history: [],
      }),
      [],
    );
  });

  it("does not treat a TP1 badge as ENTRY, nor an ENTRY flag without the event", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-a",
      events: [ev("episode-a", "wait", "map", 1_000)],
      history: [
        hist("episode-a", {
          openedState: "entry",
          hadV1Entry: true,
          outcome: "tp1",
          firstTouch: "tp1",
          firstTouchAtMs: 2_000,
        }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["map"],
    );
    assert.ok(!rows.some((r) => r.kind === "entry" || r.kind === "tp1"));
  });

  it("PENDING wick TP1 is not a trade result", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-p",
      events: [ev("episode-p", "wait", "pending", 5_000)],
      history: [
        hist("episode-p", {
          openedState: "pending",
          hadV1Entry: false,
          firstTouch: "tp1",
          firstTouchAtMs: 6_000,
          outcome: "tp1",
        }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["pending"],
    );
  });

  it("EXPIRADA uses closedAt, not a synthesized wait", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-x",
      events: [ev("episode-x", "wait", "pending", 1_000), ev("episode-x", "pending", "wait", 5_000)],
      history: [
        hist("episode-x", {
          openedState: "pending",
          closedAtMs: 5_000,
          outcome: "expired",
        }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["pending", "expired"],
    );
    assert.equal(rows[1]?.title, "EXPIRADA");
  });

  it("first-touch before ENTRY is not a trade result", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-tp",
      events: [ev("episode-tp", "pending", "entry", 10_000)],
      history: [
        hist("episode-tp", {
          hadV1Entry: true,
          firstTouch: "tp1",
          firstTouchAtMs: 9_000,
          outcome: "tp1",
        }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["entry"],
    );
  });

  it("TP2 does not invent a TP1 node", () => {
    const rows = buildSignalTimeline({
      assetId: A,
      episodeId: "episode-tp",
      events: [ev("episode-tp", "pending", "entry", 10_000)],
      history: [
        hist("episode-tp", {
          hadV1Entry: true,
          firstTouch: "tp2",
          firstTouchAtMs: 14_000,
          outcome: "tp2",
        }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["entry", "tp2"],
    );
    assert.ok(!rows.some((r) => r.kind === "tp1"));
  });

  it("formatTimelineHm is Europe/Madrid HH:MM", () => {
    assert.equal(formatTimelineHm(1_788_599_700_000), "11:15");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildShadowFrequencyDensity } from "./shadow-frequency.ts";

const ep = (id: string, day: string, entry = false) => ({
  case: { episodeId: id, openedAtMs: Date.parse(`${day}T10:00:00Z`) },
  events: entry
    ? [{ episodeId: id, fromState: "pending", toState: "entry", atMs: Date.parse(`${day}T10:15:00Z`), slot: 1 }]
    : [],
  bars: [],
});

describe("buildShadowFrequencyDensity", () => {
  it("separates V1 entries from EXTRA candidates and counts expired as undecided", () => {
    const episodes = [ep("a", "2026-09-10", true), ep("b", "2026-09-10", false)] as any;
    const results = [
      { episodeId: "a", outcome: "tp1" },
      { episodeId: "b", outcome: "expired" },
    ] as any;
    const report = buildShadowFrequencyDensity(episodes, results);
    assert.equal(report.days[0]?.v1Entries, 1);
    assert.equal(report.days[0]?.shadowCandidates, 2);
    assert.equal(report.days[0]?.shadowDecided, 1);
    assert.equal(report.days[0]?.extraCandidates, 1);
    assert.equal(report.days[0]?.extraDecided, 0);
  });
});

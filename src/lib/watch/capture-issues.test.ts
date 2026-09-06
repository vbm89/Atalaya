import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diagnoseBornFreeze, diagnoseBornSidecar, logCaptureIssues } from "./capture-issues.ts";
import type { EpisodeDraft } from "./episode.ts";

function ep(id: string, freeze: EpisodeDraft["freeze"]): EpisodeDraft {
  return {
    episodeId: id,
    assetId: "XAUUSD",
    direction: "sell",
    kind: "continuation",
    zoneLow: 1,
    zoneHigh: 2,
    sl: 3,
    tp1: 0,
    tp2: null,
    openedAtMs: 1,
    openedState: "map",
    currentState: "map",
    closedAtMs: null,
    levelsKey: "k",
    openedSlot: 1,
    freeze,
  };
}

describe("capture issues", () => {
  it("flags a born episode without freeze and never repairs", () => {
    const issues = diagnoseBornFreeze([ep("a", null), ep("b", { capturedAtMs: 1 } as EpisodeDraft["freeze"])]);
    assert.deepEqual(issues, [{ episodeId: "a", kind: "missing_freeze" }]);
  });

  it("flags missing 15m tape and context independently", () => {
    const issues = diagnoseBornSidecar([
      { episodeId: "x", tape15mCount: 0, hasContext: false },
      { episodeId: "y", tape15mCount: 3, hasContext: true },
      { episodeId: "z", tape15mCount: 2, hasContext: false },
    ]);
    assert.deepEqual(
      issues.map((i) => `${i.episodeId}:${i.kind}`),
      ["x:missing_tape_15m", "x:missing_context", "z:missing_context"],
    );
  });

  it("logs repair:false and does not throw", () => {
    const lines: unknown[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args);
    };
    try {
      logCaptureIssues([{ episodeId: "gap", kind: "missing_freeze" }]);
    } finally {
      console.info = original;
    }
    assert.equal(lines.length, 1);
    const payload = (lines[0] as unknown[])[1] as { repair: boolean; kind: string };
    assert.equal(payload.repair, false);
    assert.equal(payload.kind, "missing_freeze");
  });
});

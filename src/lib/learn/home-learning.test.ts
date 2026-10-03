import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  LEARNING_HYPOTHESIS_MIN,
  LEARNING_MFE_MIN,
  entryHint,
  hasCompleteTelemetry,
  hypothesisRadar,
  learningRowsFrom,
  summarizeEpisodes,
  summarizeLearning,
  type LearningRow,
} from "./home-learning.ts";

function row(partial: Partial<LearningRow> & Pick<LearningRow, "id">): LearningRow {
  return {
    timestamp: 1_791_000_000,
    asset: "XAUUSD",
    direction: "VENTA",
    result: "SL",
    resultR: -1,
    mfeR: 0.2,
    maeR: -1,
    mfeBeforeExitR: 0.2,
    episodeId: partial.id,
    setup: "FAILED_BREAKOUT",
    pathRecorded: true,
    ...partial,
  };
}

describe("home learning", () => {
  it("does not turn a missing path into a measured zero", () => {
    const parsed = learningRowsFrom([
      { id: "a", timestamp: 1_791_000_000, result: "SL", resultR: -1, setup: "FAILED_BREAKOUT" },
    ]);
    assert.equal(parsed[0]?.mfeR, null);
    assert.equal(parsed[0]?.maeR, null);
    assert.equal(parsed[0]?.mfeBeforeExitR, null);
    assert.equal(parsed[0]?.pathRecorded, false);
    assert.equal(hasCompleteTelemetry(parsed[0]!), false);
    const summary = summarizeLearning(parsed);
    assert.equal(summary.complete, 0);
    assert.equal(summary.meanMfeR, null);
    assert.equal(summary.netR, null);
    assert.equal(entryHint(summary), "Evidencia insuficiente");
  });

  it("keeps the diagnosis hidden until 30 complete closes", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row({ id: `s${i}`, timestamp: 1_791_000_000 + i * 900 }));
    const summary = summarizeLearning(rows);
    assert.equal(summary.complete, 11);
    assert.equal(summary.min, LEARNING_MFE_MIN);
    assert.equal(summary.enough, false);
    assert.equal(summary.meanMfeR, null);
    assert.equal(summary.meanMaeR, null);
    assert.equal(summary.slReachedPct, null);
    assert.equal(summary.netR, null);
    assert.equal(summary.tp, 0);
    assert.equal(summary.sl, 11);
    assert.equal(entryHint(summary), "Evidencia insuficiente");
  });

  it("counts a first-bar SL as not having reached +0.5R before the close", () => {
    const rows = Array.from({ length: LEARNING_MFE_MIN }, (_, i) =>
      row({
        id: `s${i}`,
        timestamp: 1_791_000_000 + i * 86_400,
        result: i < 10 ? "TP" : "SL",
        resultR: i < 10 ? 1.5 : -1,
        mfeR: i < 10 ? 1.5 : 0.9,
        maeR: i < 10 ? -0.2 : -1,
        mfeBeforeExitR: i < 10 ? 1 : i < 20 ? 0.6 : null,
      }),
    );
    const summary = summarizeLearning(rows);
    assert.equal(summary.enough, true);
    assert.equal(summary.tp, 10);
    assert.equal(summary.sl, 20);
    assert.equal(summary.slReachedHalf, 10);
    assert.equal(summary.slReachedPct, 50);
    assert.equal(summary.slMissedPct, 50);
    assert.ok(Math.abs((summary.meanMfeR ?? 0) - (10 * 1.5 + 20 * 0.9) / 30) < 1e-9);
    assert.equal(summary.netR, 10 * 1.5 + 20 * -1);
    assert.match(entryHint(summary), /Indicio: 50% de los SL no alcanzaron \+0,5R/);
    assert.match(entryHint(summary), /no una regla/);
    assert.doesNotMatch(entryHint(summary), /el problema está en la entrada|COMPRA|VENTA|ESPERAR/);
  });

  it("counts one result per episode and ignores signals without episodeId", () => {
    const rows = [
      row({ id: "a", episodeId: "ep", timestamp: 100, result: "SL", resultR: -1, mfeR: 0.1, maeR: -1 }),
      row({ id: "b", episodeId: "ep", timestamp: 200, result: "TP", resultR: 2, mfeR: 2, maeR: -0.2, mfeBeforeExitR: 1 }),
      row({ id: "c", episodeId: null, timestamp: 300, result: "TP", resultR: 3, mfeR: 3, maeR: 0 }),
    ];
    const episodes = summarizeEpisodes(rows);
    assert.equal(episodes.episodes, 1);
    assert.equal(episodes.repeatedSignals, 1);
    assert.equal(episodes.withoutEpisodeId, 1);
    assert.equal(episodes.rows[0]?.resultR, -1);
    assert.equal(episodes.rows[0]?.mfeR, 0.1);
    const radar = hypothesisRadar(episodes);
    assert.equal(radar.length, 1);
    assert.equal(radar[0]?.episodes, 1);
    assert.equal(radar[0]?.netR, -1);
    assert.equal(radar[0]?.enough, false);
    assert.match(radar[0]?.label ?? "", /Evidencia insuficiente: 1 \/ 40/);
  });

  it("marks a setup as an out-of-sample candidate only at the episode minimum", () => {
    const rows = Array.from({ length: LEARNING_HYPOTHESIS_MIN }, (_, i) =>
      row({ id: `h${i}`, episodeId: `ep${i}`, timestamp: 1_000 + i, resultR: -0.18, mfeR: 0.1, maeR: -1 }),
    );
    const radar = hypothesisRadar(summarizeEpisodes(rows));
    assert.equal(radar[0]?.episodes, 40);
    assert.equal(radar[0]?.enough, true);
    assert.equal(radar[0]?.label, "Hipótesis candidata para test OOS");
    assert.ok(Math.abs((radar[0]?.netR ?? 0) - -7.2) < 1e-9);
  });

  it("stays a reader: no trading or watch imports", () => {
    const source = readFileSync(new URL("./home-learning.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /decide\(|runWatchTick|runDurableTick|appendSignal|appendSettle|process\.env/);
  });
});

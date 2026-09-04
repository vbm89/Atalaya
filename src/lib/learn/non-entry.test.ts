import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LearningCase } from "./case.ts";
import {
  classifyNonEntry,
  explainNonEntries,
  exampleChecks,
} from "./non-entry.ts";

function lc(partial: Partial<LearningCase>): LearningCase {
  return {
    episodeId: "XAUUSD-e1",
    assetId: "XAUUSD",
    direction: "buy",
    kind: "continuation",
    timeframe: "15m",
    openedAtMs: 1,
    closedAtMs: 2,
    openedState: "pending",
    currentState: "wait",
    waitReason: null,
    missingForEntry: null,
    bias4hLabel: "ALCISTA LOCAL",
    warnings: null,
    qualityPhase: "preliminar",
    volumeRatio15: 0.08,
    volumeAvailable15: true,
    volumeRatio4h: 1.2,
    volumeAvailable4h: true,
    highImpact: false,
    underlyingClosed: false,
    dataStatus: "ok",
    zoneLow: 1,
    zoneHigh: 2,
    entry: 2,
    sl: 0.5,
    tp1: 4,
    tp2: null,
    invalidation: 0.4,
    riskReward: 2,
    quality: "media",
    basis: null,
    outcome: "sl",
    firstTouch: "sl",
    firstTouchAtMs: 9,
    mfe: 0,
    mae: 1,
    durationMs: 1,
    trainable: true,
    exclusionReason: null,
    complete: true,
    hadV1Entry: false,
    ...partial,
  };
}

describe("non-entry gates", () => {
  it("an episode with real ENTRY is not a non-entry", () => {
    const c = lc({
      hadV1Entry: true,
      missingForEntry: "Falta: volumen 15M insuficiente.",
      outcome: "sl",
    });
    assert.equal(classifyNonEntry(c), null);
    assert.equal(explainNonEntries([c]).total, 0);
  });

  it("MAP/PENDING without ENTRY is included", () => {
    const map = lc({
      openedState: "map",
      hadV1Entry: false,
      missingForEntry: "Falta: salida 15M de la zona a favor.",
      outcome: "expired",
    });
    const row = classifyNonEntry(map);
    assert.ok(row);
    assert.deepEqual(row!.gates, ["armed"]);
    assert.equal(explainNonEntries([map]).total, 1);
  });

  it("later SL is not a non-entry motive", () => {
    const c = lc({
      outcome: "sl",
      firstTouch: "sl",
      missingForEntry: "Falta: volumen 15M insuficiente.",
      hadV1Entry: false,
    });
    const row = classifyNonEntry(c);
    assert.deepEqual(row!.gates, ["vol15"]);
    assert.equal(row!.gates.includes("t2"), false);
  });

  it("later EXPIRADA is not a non-entry motive", () => {
    const c = lc({
      outcome: "expired",
      firstTouch: null,
      missingForEntry: "Falta: cierre 15M de fallo de aceptación o rechazo.",
      hadV1Entry: false,
    });
    assert.deepEqual(classifyNonEntry(c)!.gates, ["t2"]);
  });

  it("uses freeze missingForEntry, not freeze volumeRatio15", () => {
    const c = lc({
      volumeRatio15: 0.002,
      missingForEntry: "Falta: cierre 15M de fallo de aceptación o rechazo.",
      hadV1Entry: false,
    });
    assert.deepEqual(classifyNonEntry(c)!.gates, ["t2"]);
  });

  it("multiple missing gates: one setup, several hits", () => {
    const c = lc({
      missingForEntry:
        "Falta: cierre 15M de fallo de aceptación o rechazo; volumen 15M insuficiente; señal tardía.",
      hadV1Entry: false,
    });
    const report = explainNonEntries([c]);
    assert.equal(report.total, 1);
    assert.equal(report.exclusiveMultiple, 1);
    assert.equal(report.exclusiveSingle, 0);
    assert.equal(report.gateHits.t2, 1);
    assert.equal(report.gateHits.vol15, 1);
    assert.equal(report.gateHits.late, 1);
    assert.equal(report.gateHits.vol4h, 0);
  });

  it("unknown freeze text is not invented", () => {
    const c = lc({
      missingForEntry: "Falta: unicornio cuantico.",
      hadV1Entry: false,
    });
    const row = classifyNonEntry(c)!;
    assert.equal(row.unknown, true);
    assert.deepEqual(row.gates, []);
    assert.ok(row.unknownParts.some((p) => p.includes("unicornio")));
    assert.equal(explainNonEntries([c]).unknown, 1);
  });

  it("null missingForEntry is unknown, not a fake gate", () => {
    const c = lc({ missingForEntry: null, hadV1Entry: false, outcome: "sl" });
    const row = classifyNonEntry(c)!;
    assert.equal(row.unknown, true);
    assert.equal(explainNonEntries([c]).gateHits.vol15, 0);
  });

  it("ENTRY is detected only via hadV1Entry, not via outcome TP", () => {
    const tpNoEvent = lc({
      outcome: "tp1",
      firstTouch: "tp1",
      hadV1Entry: false,
      missingForEntry: "Falta: volumen 4H muerto.",
    });
    const report = explainNonEntries([tpNoEvent]);
    assert.equal(report.total, 1);
    assert.equal(report.gateHits.vol4h, 1);
  });

  it("example checks mark only the missing V1 gates", () => {
    const row = classifyNonEntry(
      lc({
        missingForEntry: "Falta: volumen 15M insuficiente.",
        hadV1Entry: false,
      }),
    )!;
    const checks = exampleChecks(row);
    assert.equal(checks.find((x) => x.id === "vol15")?.missing, true);
    assert.equal(checks.find((x) => x.id === "t2")?.missing, false);
    assert.equal(checks.find((x) => x.id === "news")?.missing, false);
  });
});

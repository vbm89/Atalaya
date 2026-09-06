import { describe, expect, it } from "vitest";
import { buildShadowAutopsy } from "./shadow-autopsy";
import type { ShadowRadar } from "./shadow-radar";

const radar: ShadowRadar = {
  rule: "test",
  stats: { evaluated: 3, missed: 2, favorable: 2, tp1OrBetter: 1, favorableRate: 66.7, byAsset: [] },
  cases: [
    { episodeId: "a", assetId: "XAUUSD", direction: "buy", openedAtMs: 1, state: "mapa", hadV1Entry: false, outcome: null, firstTouch: "tp1", mfe: 2, mae: 0.2, riskUnit: 1, mfeR: 2, maeR: 0.2, waitReason: "falta_confirmacion", bias4h: "alcista", setupKind: "rebote", quality: "A", warnings: [], highImpact: false, missingForEntry: "confirmacion", volumeRatio15: 1, volumeRatio4h: 1, replay: { entry: 1, sl: 0, tp1: 2, tp2: 3, zoneLow: 1, zoneHigh: 1.5 } },
    { episodeId: "b", assetId: "XAUUSD", direction: "buy", openedAtMs: 2, state: "mapa", hadV1Entry: false, outcome: null, firstTouch: null, mfe: 1.5, mae: 0.3, riskUnit: 1, mfeR: 1.5, maeR: 0.3, waitReason: "falta_confirmacion", bias4h: "alcista", setupKind: "rebote", quality: "B", warnings: [], highImpact: false, missingForEntry: "confirmacion", volumeRatio15: 1, volumeRatio4h: 1, replay: { entry: 1, sl: 0, tp1: 2, tp2: null, zoneLow: 1, zoneHigh: 1.5 } },
  ],
};

describe("buildShadowAutopsy", () => {
  it("groups repeated missed-opportunity patterns", () => {
    const result = buildShadowAutopsy(radar);
    expect(result.cases).toHaveLength(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].cases).toBe(2);
    expect(result.groups[0].tp1OrBetter).toBe(1);
    expect(result.groups[0].avgMfeR).toBe(1.75);
  });
});

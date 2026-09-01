import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { distanceUnavailableLabel, setupDistance, zoneDistance } from "./zone-distance.ts";

describe("distancia a zona", () => {
  it("inside", () => {
    const d = zoneDistance(77700, 77626, 77731);
    assert.equal(d?.relation, "inside");
    assert.match(d!.label, /DENTRO/);
  });
  it("above as percent", () => {
    const d = zoneDistance(78000, 77626, 77731);
    assert.equal(d?.relation, "above");
    assert.match(d!.label, /DE LA ZONA/);
  });
  it("missing price is not invented", () => {
    assert.equal(zoneDistance(null, 77626, 77731), null);
    assert.equal(setupDistance({ analysisPrice: null, zoneLow: 77626, zoneHigh: 77731 }), null);
    assert.match(distanceUnavailableLabel(false), /NO CALCULABLE/);
  });
});

describe("distancia congelada vs precio posterior", () => {
  const zone = { zoneLow: 77626, zoneHigh: 77731, entry: 77626 };

  it("frozen uses freeze price, never a later live print", () => {
    const d = setupDistance({
      analysisPrice: 80_000,
      freezePrice: 77_700,
      frozen: true,
      ...zone,
    });
    assert.ok(d);
    assert.equal(d.source, "frozen");
    assert.equal(d.relation, "inside");
    assert.equal(d.proximal, true);
    assert.match(d.label, /Al cierre del análisis/);
    assert.match(d.label, /PROXIMIDAD/);
  });

  it("without freeze price, frozen distance stays NO CALCULABLE", () => {
    const d = setupDistance({
      analysisPrice: 80_000,
      freezePrice: null,
      frozen: true,
      ...zone,
    });
    assert.equal(d, null);
    assert.match(distanceUnavailableLabel(true), /precio posterior/);
  });

  it("live setup uses analysis price, not a fabricated tick", () => {
    const d = setupDistance({
      analysisPrice: 78_000,
      freezePrice: 77_700,
      frozen: false,
      ...zone,
    });
    assert.equal(d?.source, "analysis");
    assert.equal(d?.relation, "above");
    assert.equal(d?.proximal, false);
  });

  it("proximity is inside the V1 zone, not a new engine threshold", () => {
    const inside = setupDistance({ analysisPrice: 77_700, frozen: false, ...zone });
    const away = setupDistance({ analysisPrice: 79_000, frozen: false, ...zone });
    assert.equal(inside?.proximal, true);
    assert.equal(away?.proximal, false);
  });
});

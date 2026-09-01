import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHART_MIN_BAR_SPACING,
  centerLogicalRange,
  defaultLogicalRange,
  defaultVisibleBars,
  maxBarsAtMinSpacing,
  zoomLogicalRange,
} from "./view.ts";

describe("chart view range", () => {
  it("M1 with 1000 bars opens on ~120, not the full series", () => {
    assert.equal(defaultVisibleBars("1m", 1000), 120);
    const r = defaultLogicalRange(1000, 120);
    assert.equal(r.from, 880);
    assert.equal(r.to, 1005);
  });

  it("short series is not padded with empty history", () => {
    assert.equal(defaultVisibleBars("1m", 50), 50);
    const r = defaultLogicalRange(50, 50);
    assert.equal(r.from, 0);
    assert.equal(r.to, 55);
  });

  it("setup focus keeps current bar in view without dumping 180 tiny candles", () => {
    assert.equal(defaultVisibleBars("15m", 1000, true), 100);
  });

  it("pinch-out on iPhone 390px can show the full 1000-bar history", () => {
    const max = maxBarsAtMinSpacing(390, CHART_MIN_BAR_SPACING);
    assert.ok(max >= 1000, `expected ≥1000 bars, got ${max}`);
  });

  it("landscape width shows more bars without going to the full series", () => {
    const n = defaultVisibleBars("1m", 1000, false, 844);
    assert.ok(n > 120 && n < 1000, `got ${n}`);
  });

  it("zoom out from 240 bars reaches the full loaded history", () => {
    let range = { from: 760, to: 1005 };
    for (let i = 0; i < 8; i++) range = zoomLogicalRange(range, 1.85, 1000);
    assert.ok(range.from <= 1, `from=${range.from}`);
    assert.ok(range.to - range.from >= 900, `span=${range.to - range.from}`);
  });

  it("zoom in does not go below ~12 bars", () => {
    let range = { from: 760, to: 1005 };
    for (let i = 0; i < 12; i++) range = zoomLogicalRange(range, 1 / 1.85, 1000);
    assert.ok(range.to - range.from >= 12);
    assert.ok(range.to - range.from <= 20);
  });

  it("CENTRAR keeps the zoom span and snaps to the live edge", () => {
    const r = centerLogicalRange(1000, 80);
    assert.equal(r.to, 1005);
    assert.equal(r.from, 920);
  });
});

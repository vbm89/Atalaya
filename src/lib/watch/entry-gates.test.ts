import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureEntryGates } from "./entry-gates.ts";
import { freezeField, type EpisodeFreeze } from "./freeze.ts";

describe("captureEntryGates", () => {
  it("MAP: only armed is known false; other gates unevaluated", () => {
    const g = captureEntryGates("map", "Falta: salida 15M de la zona a favor.");
    assert.equal(g?.armed, false);
    assert.equal(g?.t2, null);
    assert.equal(g?.volume15, null);
    assert.equal(g?.volume4h, null);
    assert.equal(g?.news, null);
  });

  it("ENTRY: all evaluated gates passed from V1 state, not reconstructed", () => {
    const g = captureEntryGates("entry", null);
    assert.equal(g?.armed, true);
    assert.equal(g?.t2, true);
    assert.equal(g?.volume15, true);
    assert.equal(g?.late, true);
  });

  it("PENDING: false only for snippets V1 listed in missingForEntry", () => {
    const g = captureEntryGates(
      "pending",
      "Falta: cierre 15M de fallo de aceptación o rechazo; volumen 15M insuficiente.",
    );
    assert.equal(g?.armed, true);
    assert.equal(g?.t2, false);
    assert.equal(g?.volume15, false);
    assert.equal(g?.volume4h, true);
    assert.equal(g?.news, true);
    assert.equal(g?.late, true);
  });

  it("PENDING without missing text does not invent gate booleans", () => {
    const g = captureEntryGates("pending", null);
    assert.equal(g?.armed, true);
    assert.equal(g?.t2, null);
    assert.equal(g?.volume15, null);
  });

  it("WAIT is not captured", () => {
    assert.equal(captureEntryGates("wait", "ESPERAR — no hay BOS 4H por cierre."), undefined);
  });

  it("old freeze JSON without entryGates still loads", () => {
    const raw = {
      slotClosePrice: 1,
      quality: "media",
      riskReward: 2,
      dataSource: "binance",
      feedSymbol: "XAUUSDT",
      instrumentKind: "proxy",
      basis: null,
      dataStatus: "ok",
      waitReason: null,
      highImpact: false,
      underlyingClosed: false,
      timeframe: "15m",
      setupKind: "continuation",
      capturedAtMs: 1,
    };
    const freeze = JSON.parse(JSON.stringify(raw)) as EpisodeFreeze;
    assert.equal("entryGates" in freeze, false);
    assert.equal(freezeField(freeze.entryGates), null);
  });
});

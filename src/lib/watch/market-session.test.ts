import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marketSessionKind, marketSessionLabel, tileStatusChips } from "./market-session.ts";

describe("estado de mercado (UI, sin inventar horarios)", () => {
  it("ok → abierto", () => {
    assert.equal(marketSessionKind("ok"), "open");
    assert.equal(marketSessionLabel("open", true), "ABIERTO");
  });

  it("stale is delayed, not closed", () => {
    assert.equal(marketSessionKind("stale"), "open");
  });

  it("session_closed → cerrado", () => {
    assert.equal(marketSessionKind("session_closed"), "closed");
    assert.equal(marketSessionLabel("closed"), "MERCADO CERRADO");
  });

  it("error and insufficient → estado no disponible", () => {
    assert.equal(marketSessionKind("error"), "unknown");
    assert.equal(marketSessionKind("insufficient"), "unknown");
    assert.equal(marketSessionKind(undefined), "unknown");
    assert.equal(marketSessionKind(null), "unknown");
    assert.equal(marketSessionLabel("unknown"), "ESTADO NO DISPONIBLE");
  });
});

describe("jerarquía visual de la tarjeta", () => {
  it("1. abierto sin señal → vigilando ahora", () => {
    const r = tileStatusChips({ dataStatus: "ok", setupState: "wait" });
    assert.equal(r.hunting, true);
    assert.equal(r.dim, false);
    assert.equal(r.session.label, "ABIERTO");
    assert.deepEqual(
      r.setups.map((s) => s.label),
      ["Vigilando"],
    );
  });

  it("2. abierto con MAPA → MAPA es actual", () => {
    const r = tileStatusChips({ dataStatus: "ok", setupState: "map", direction: "buy" });
    assert.equal(r.hunting, true);
    const mapa = r.setups.find((s) => s.key === "map");
    assert.equal(mapa?.current, true);
    assert.equal(mapa?.label, "MAPA");
  });

  it("3. abierto con PENDING → PENDING es actual", () => {
    const r = tileStatusChips({ dataStatus: "stale", setupState: "pending", direction: "sell" });
    assert.equal(r.hunting, true);
    assert.equal(r.setups.find((s) => s.key === "pending")?.current, true);
  });

  it("4. abierto con ENTRY → ENTRY destaca y sigue actual", () => {
    const r = tileStatusChips({ dataStatus: "ok", setupState: "entry", direction: "buy" });
    assert.equal(r.setups[0]?.key, "entry");
    assert.equal(r.setups[0]?.current, true);
    assert.equal(r.dim, false);
  });

  it("5. cerrado con eventos históricos → CERRADO manda; MAPA no es caza actual", () => {
    const r = tileStatusChips({ dataStatus: "session_closed", setupState: "map", direction: "buy" });
    assert.equal(r.session.kind, "closed");
    assert.equal(r.hunting, false);
    assert.equal(r.dim, true);
    const mapa = r.setups.find((s) => s.key === "map");
    assert.equal(mapa?.label, "MAPA");
    assert.equal(mapa?.current, false);
    assert.equal(r.setups.some((s) => s.key === "wait"), false);
  });

  it("6. cerrado sin eventos → solo CERRADO, no Vigilando", () => {
    const r = tileStatusChips({ dataStatus: "session_closed", setupState: "wait" });
    assert.equal(r.setups.length, 0);
    assert.equal(r.hunting, false);
    assert.equal(r.dim, true);
    assert.equal(r.session.label, "CERRADO");
  });

  it("7. estado no disponible no se inventa ni como abierto ni como cerrado", () => {
    const r = tileStatusChips({ dataStatus: "error", setupState: "pending" });
    assert.equal(r.session.kind, "unknown");
    assert.equal(r.session.label, "ESTADO NO DISPONIBLE");
    assert.equal(r.hunting, false);
    assert.equal(r.setups.find((s) => s.key === "pending")?.current, false);
  });

  it("ENTRY en mercado cerrado sigue siendo prioridad máxima y no se apaga", () => {
    const r = tileStatusChips({ dataStatus: "session_closed", setupState: "entry", direction: "sell" });
    assert.equal(r.setups[0]?.key, "entry");
    assert.equal(r.setups[0]?.current, true);
    assert.equal(r.dim, false);
    assert.equal(r.session.kind, "closed");
  });
});

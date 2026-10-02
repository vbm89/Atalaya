import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listPaperOpportunities, type PaperAssetDecision } from "./paper-opportunities.ts";

function row(partial: Partial<PaperAssetDecision> & Pick<PaperAssetDecision, "asset" | "action">): PaperAssetDecision {
  return {
    status: "DATA_OK",
    provider: "yahoo:GC=F",
    entry: partial.action === "ESPERAR" ? null : 100,
    stop: partial.action === "ESPERAR" ? null : 99,
    target: partial.action === "ESPERAR" ? null : 102,
    rr: partial.action === "ESPERAR" ? null : 1.5,
    setup: "BREAKOUT_ACCEPTANCE",
    rationale: "",
    wait: "Sin lectura",
    ...partial,
  };
}

describe("HOME opportunity list", () => {
  it("shows none, one, two, three and keeps the rest behind the first three", () => {
    assert.equal(listPaperOpportunities([]).length, 0);
    assert.equal(listPaperOpportunities([row({ asset: "XAUUSD", action: "ESPERAR" })]).length, 0);
    const one = listPaperOpportunities([row({ asset: "BTCUSD", action: "COMPRA", rr: 2 })]);
    assert.deepEqual(one.map((r) => r.asset), ["BTCUSD"]);
    const two = listPaperOpportunities([
      row({ asset: "WTI", action: "VENTA", rr: 1.4 }),
      row({ asset: "XAUUSD", action: "COMPRA", rr: 2.1 }),
    ]);
    assert.deepEqual(two.map((r) => r.asset), ["XAUUSD", "WTI"]);
    const three = listPaperOpportunities([
      row({ asset: "BTCUSD", action: "COMPRA", rr: 1.7 }),
      row({ asset: "US100", action: "VENTA", rr: 2.4 }),
      row({ asset: "XAUUSD", action: "COMPRA", rr: 1.9 }),
    ]);
    assert.deepEqual(three.map((r) => r.asset), ["US100", "XAUUSD", "BTCUSD"]);
    assert.equal(three.slice(0, 3).length, 3);
    const many = listPaperOpportunities([
      row({ asset: "WTI", action: "VENTA", rr: 1.6 }),
      row({ asset: "XAUUSD", action: "COMPRA", rr: 3 }),
      row({ asset: "US100", action: "VENTA", rr: 2.2 }),
      row({ asset: "BTCUSD", action: "COMPRA", rr: 1.8 }),
      row({ asset: "XAUUSD", action: "ESPERAR" }),
    ]);
    assert.deepEqual(many.map((r) => r.asset), ["XAUUSD", "US100", "BTCUSD", "WTI"]);
    assert.deepEqual(many.slice(0, 3).map((r) => r.asset), ["XAUUSD", "US100", "BTCUSD"]);
  });
});

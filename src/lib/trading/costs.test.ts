import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { costEstimateLabel, costImpactNote, emptyCosts } from "./costs.ts";

describe("costes fuera de risk.ts", () => {
  it("empty book has null spread and commission for every asset", () => {
    const book = emptyCosts();
    assert.equal(book.BTCUSD.spreadTicks, null);
    assert.equal(book.XAUUSD.commissionEur, null);
    assert.equal(book.US100.spreadTicks, null);
    assert.equal(book.WTI.commissionEur, null);
  });

  it("no note when the user has not entered costs", () => {
    assert.equal(costImpactNote({ spreadTicks: null, commissionEur: null }, 1, 10), null);
  });

  it("missing costs are NO CALCULABLE — never invented", () => {
    const r = costEstimateLabel({ spreadTicks: null, commissionEur: null }, 1, 10);
    assert.equal(r.calculable, false);
    assert.equal(r.text, "NO CALCULABLE");
  });

  it("spread without tick value cannot invent euros", () => {
    const r = costEstimateLabel({ spreadTicks: 12, commissionEur: null }, null, null);
    assert.equal(r.calculable, false);
    assert.match(r.text, /NO CALCULABLE/);
    assert.match(r.text, /spread 12 ticks/);
  });

  it("note is informational and does not claim a V1 R:R change", () => {
    const note = costImpactNote({ spreadTicks: 20, commissionEur: 1.5 }, 1, 100);
    assert.ok(note);
    assert.match(note, /spread 20 ticks \(manual\)/);
    assert.match(note, /comisión 1,5 € \(manual\)|comisión 1.5 € \(manual\)/);
    assert.match(note, /No modifican el R:R de V1/);
  });
});

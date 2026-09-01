import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateRisk,
  draftFromUnknown,
  isDraftComplete,
  quoteTickSize,
  specFromDraft,
} from "./risk.ts";

describe("contract drafts — known vs pending", () => {
  it("tick size is the feed increment, not an invented broker tick", () => {
    assert.equal(quoteTickSize(2), 0.01);
  });

  it("unknown broker fields stay null — never invented", () => {
    const d = draftFromUnknown(null, 2);
    assert.equal(d.tickSize, 0.01);
    assert.equal(d.tickValue, null);
    assert.equal(d.minLot, null);
    assert.equal(d.lotStep, null);
    assert.equal(isDraftComplete(d), false);
    assert.equal(specFromDraft(d), null);
  });

  it("complete draft becomes ContractSpec for existing risk math", () => {
    const d = draftFromUnknown(
      { tickSize: 0.01, tickValue: 1, minLot: 0.01, lotStep: 0.01 },
      2,
    );
    const spec = specFromDraft(d);
    assert.ok(spec);
    const calc = calculateRisk({ capital: 200, spec, slDistance: 10 });
    assert.equal(calc.calculable, true);
  });

  it("tick size alone does not make risk calculable", () => {
    const spec = specFromDraft(draftFromUnknown({ tickSize: 0.01 }, 2));
    const calc = calculateRisk({ capital: 200, spec, slDistance: 10 });
    assert.equal(calc.calculable, false);
    assert.match(calc.reason ?? "", /CONFIGURA EL CONTRATO/);
  });
});

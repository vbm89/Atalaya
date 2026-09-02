import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_ACCOUNT, calculateRisk, isDraftComplete, specFromDraft } from "./risk.ts";
import { emptyCosts } from "./costs.ts";
import {
  CAPTURED,
  effectiveContractDraft,
  isDecimalTyping,
  missingContractFields,
  parseDecimalPositive,
  seedContracts,
  seedCosts,
} from "./contract-seed.ts";
import { BROKER_CONTRACTS } from "./broker-contract.ts";

describe("capturas de contrato", () => {
  it("seeds confirmed T4Trade values including minLot/lotStep", () => {
    const seeded = seedContracts(EMPTY_ACCOUNT);
    assert.equal(seeded.contracts.XAUUSD.tickValue, 1);
    assert.equal(seeded.contracts.XAUUSD.tickSize, 0.01);
    assert.equal(seeded.contracts.XAUUSD.minLot, 0.01);
    assert.equal(seeded.contracts.XAUUSD.lotStep, 0.01);
    assert.equal(seeded.contracts.US100.tickValue, 0.01);
    assert.equal(seeded.contracts.US100.minLot, 0.1);
    assert.equal(seeded.contracts.US100.lotStep, 0.01);
    assert.equal(seeded.contracts.WTI.tickValue, 10);
    assert.equal(seeded.contracts.WTI.minLot, 0.01);
    assert.equal(isDraftComplete(seeded.contracts.XAUUSD), true);
    assert.equal(isDraftComplete(seeded.contracts.US100), true);
    assert.equal(isDraftComplete(seeded.contracts.WTI), true);
    assert.equal(isDraftComplete(seeded.contracts.BTCUSD), true);
  });

  it("BTC tick size/value come from the MT4 card, not from 0.01/0.01 invented tick value", () => {
    const seeded = seedContracts(EMPTY_ACCOUNT);
    assert.equal(CAPTURED.BTCUSD.tickSize, 0.01);
    assert.equal(CAPTURED.BTCUSD.tickValue, 1);
    assert.equal(seeded.contracts.BTCUSD.tickValue, 1);
    assert.equal(seeded.contracts.BTCUSD.minLot, 0.01);
    assert.equal(seeded.contracts.BTCUSD.lotStep, 0.01);
    assert.notEqual(seeded.contracts.BTCUSD.tickValue, 0.01);
  });

  it("clears the old invented BTC tickValue 0.01", () => {
    const cleared = seedContracts({
      ...EMPTY_ACCOUNT,
      contracts: {
        ...EMPTY_ACCOUNT.contracts,
        BTCUSD: { tickSize: 0.01, tickValue: 0.01, minLot: 0.01, lotStep: 0.01 },
      },
    });
    assert.equal(cleared.contracts.BTCUSD.tickValue, 1);
    assert.equal(cleared.contracts.BTCUSD.minLot, 0.01);
    assert.equal(cleared.contracts.BTCUSD.lotStep, 0.01);
  });

  it("does not overwrite a value the user already typed", () => {
    const kept = seedContracts({
      ...EMPTY_ACCOUNT,
      contracts: {
        ...EMPTY_ACCOUNT.contracts,
        XAUUSD: { tickSize: 0.01, tickValue: 9, minLot: 0.1, lotStep: 0.01 },
      },
    });
    assert.equal(kept.contracts.XAUUSD.tickValue, 9);
    assert.equal(kept.contracts.XAUUSD.minLot, 0.1);
    assert.equal(kept.contracts.XAUUSD.lotStep, 0.01);
  });

  it("does not deduce minLot from contract size — values are owner-confirmed", () => {
    assert.equal(CAPTURED.XAUUSD.contractSize, 100);
    assert.equal(CAPTURED.XAUUSD.minLot, 0.01);
    assert.equal(CAPTURED.WTI.contractSize, 1000);
    assert.equal(CAPTURED.WTI.lotStep, 0.01);
    const d = seedContracts(EMPTY_ACCOUNT).contracts.XAUUSD;
    assert.deepEqual(missingContractFields(d, "XAUUSD"), []);
  });

  it("floating spreads stay empty — 48 ticks was a snapshot, not the contract", () => {
    const costs = seedCosts(emptyCosts());
    assert.equal(costs.XAUUSD.spreadTicks, null);
    assert.equal(costs.US100.spreadTicks, null);
    assert.equal(costs.WTI.spreadTicks, null);
    assert.equal(costs.BTCUSD.spreadTicks, null);
    assert.equal(CAPTURED.XAUUSD.spreadFloating, true);
    const kept = seedCosts({
      ...emptyCosts(),
      XAUUSD: { spreadTicks: 12, commissionEur: null },
    });
    assert.equal(kept.XAUUSD.spreadTicks, 12);
  });

  it("US100Cash / WTICash are instrument labels, not asset keys", () => {
    assert.equal(CAPTURED.US100.instrument, "US100Cash");
    assert.equal(CAPTURED.WTI.instrument, "WTICash");
    assert.equal(CAPTURED.XAUUSD.instrument, "XAUUSD");
    assert.equal(CAPTURED.BTCUSD.instrument, "BTCUSD");
  });
});

describe("contrato efectivo desde BROKER_CONTRACTS, no reescritura manual", () => {
  const empty = { tickSize: null, tickValue: null, minLot: null, lotStep: null };

  it("persisted Pendiente drafts become complete without the user retyping", () => {
    for (const id of ["XAUUSD", "BTCUSD", "US100", "WTI"] as const) {
      assert.equal(isDraftComplete(empty), false, `${id} raw empty`);
      const eff = effectiveContractDraft(id, empty);
      assert.equal(isDraftComplete(eff), true, `${id} effective`);
      assert.deepEqual(missingContractFields(empty, id), []);
      assert.ok(specFromDraft(eff), `${id} spec`);
    }
  });

  it("XAUUSD effective: tick 0.01 / value 1 / min 0.01 / step 0.01", () => {
    const d = effectiveContractDraft("XAUUSD", empty);
    assert.equal(d.tickSize, 0.01);
    assert.equal(d.tickValue, 1);
    assert.equal(d.minLot, 0.01);
    assert.equal(d.lotStep, 0.01);
  });

  it("BTCUSD effective: tick 0.01 / value 1 / min 0.01 / step 0.01", () => {
    const d = effectiveContractDraft("BTCUSD", empty);
    assert.equal(d.tickSize, 0.01);
    assert.equal(d.tickValue, 1);
    assert.equal(d.minLot, 0.01);
    assert.equal(d.lotStep, 0.01);
  });

  it("US100 effective: tick 0.01 / value 0.01 / min 0.10 / step 0.01", () => {
    const d = effectiveContractDraft("US100", empty);
    assert.equal(d.tickSize, 0.01);
    assert.equal(d.tickValue, 0.01);
    assert.equal(d.minLot, 0.1);
    assert.equal(d.lotStep, 0.01);
  });

  it("WTI effective: tick 0.01 / value 10 / min 0.01 / step 0.01", () => {
    const d = effectiveContractDraft("WTI", empty);
    assert.equal(d.tickSize, 0.01);
    assert.equal(d.tickValue, 10);
    assert.equal(d.minLot, 0.01);
    assert.equal(d.lotStep, 0.01);
  });

  it("seed of a stored account with null capture fields completes all four", () => {
    const stored = {
      ...EMPTY_ACCOUNT,
      contracts: {
        XAUUSD: { tickSize: 0.01, tickValue: null, minLot: null, lotStep: null },
        BTCUSD: { tickSize: 0.01, tickValue: null, minLot: null, lotStep: null },
        US100: { tickSize: 0.01, tickValue: null, minLot: null, lotStep: null },
        WTI: { tickSize: 0.01, tickValue: null, minLot: null, lotStep: null },
      },
    };
    const seeded = seedContracts(stored);
    for (const id of ["XAUUSD", "BTCUSD", "US100", "WTI"] as const) {
      assert.equal(isDraftComplete(seeded.contracts[id]), true, id);
      assert.equal(seeded.contracts[id].tickSize, BROKER_CONTRACTS[id].tickSize);
      assert.equal(seeded.contracts[id].tickValue, BROKER_CONTRACTS[id].tickValueUsd);
      assert.equal(seeded.contracts[id].minLot, BROKER_CONTRACTS[id].minLot);
      assert.equal(seeded.contracts[id].lotStep, BROKER_CONTRACTS[id].lotStep);
    }
  });

  it("effective draft is what risk.ts consumes — XAU 10 $ SL · 10 000 € → lote 0,05", () => {
    const spec = specFromDraft(effectiveContractDraft("XAUUSD", empty));
    assert.ok(spec);
    assert.equal(spec.tickSize, 0.01);
    assert.equal(spec.tickValue, 1);
    assert.equal(spec.minLot, 0.01);
    assert.equal(spec.lotStep, 0.01);
    const calc = calculateRisk({ capital: 10_000, spec, slDistance: 10 });
    assert.equal(calc.calculable, true);
    assert.equal(calc.usedLot, 0.05);
    assert.equal(calc.realEur, 50);
  });
});

describe("paso de lote decimal", () => {
  it("accepts 0.1 and 0.01 without converting to integer", () => {
    assert.equal(parseDecimalPositive("0.1"), 0.1);
    assert.equal(parseDecimalPositive("0.01"), 0.01);
    assert.equal(parseDecimalPositive("0.001"), 0.001);
    assert.equal(parseDecimalPositive("0,01"), 0.01);
    assert.equal(parseDecimalPositive("1"), 1);
    assert.notEqual(parseDecimalPositive("0.01"), 1);
    assert.equal(Number.isInteger(parseDecimalPositive("0.01") as number), false);
  });

  it("keeps 0.1 / 0.01 through JSON persist", () => {
    const stored = JSON.parse(
      JSON.stringify({
        lotStep: parseDecimalPositive("0.01"),
        minLot: parseDecimalPositive("0.1"),
      }),
    ) as { lotStep: number; minLot: number };
    assert.equal(stored.lotStep, 0.01);
    assert.equal(stored.minLot, 0.1);
  });

  it("does not treat typing 0. as a finished value", () => {
    assert.equal(isDecimalTyping("0"), true);
    assert.equal(isDecimalTyping("0."), true);
    assert.equal(parseDecimalPositive("0"), null);
    assert.equal(parseDecimalPositive("0."), null);
    assert.equal(parseDecimalPositive(""), null);
  });
});

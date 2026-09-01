import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_ACCOUNT, isDraftComplete } from "./risk.ts";
import { emptyCosts } from "./costs.ts";
import {
  CAPTURED,
  isDecimalTyping,
  missingContractFields,
  parseDecimalPositive,
  seedContracts,
  seedCosts,
} from "./contract-seed.ts";

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

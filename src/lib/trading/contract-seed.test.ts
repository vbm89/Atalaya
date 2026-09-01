import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_ACCOUNT, isDraftComplete } from "./risk.ts";
import { emptyCosts } from "./costs.ts";
import {
  CAPTURED,
  isDecimalTyping,
  missingContractFields,
  missingContractLabel,
  parseDecimalPositive,
  seedContracts,
  seedCosts,
} from "./contract-seed.ts";

describe("capturas de contrato", () => {
  it("seeds only values visible in the broker cards", () => {
    const seeded = seedContracts(EMPTY_ACCOUNT);
    assert.equal(seeded.contracts.XAUUSD.tickValue, 1);
    assert.equal(seeded.contracts.XAUUSD.tickSize, 0.01);
    assert.equal(seeded.contracts.US100.tickValue, 0.01);
    assert.equal(seeded.contracts.WTI.tickValue, 10);
    assert.equal(seeded.contracts.XAUUSD.minLot, null);
    assert.equal(seeded.contracts.XAUUSD.lotStep, null);
    assert.equal(seeded.contracts.US100.minLot, null);
    assert.equal(seeded.contracts.WTI.lotStep, null);
    assert.equal(isDraftComplete(seeded.contracts.XAUUSD), false);
    assert.equal(isDraftComplete(seeded.contracts.US100), false);
    assert.equal(isDraftComplete(seeded.contracts.WTI), false);
  });

  it("does not invent BTC tick size or tick value", () => {
    const seeded = seedContracts(EMPTY_ACCOUNT);
    assert.equal(CAPTURED.BTCUSD.tickSize, null);
    assert.equal(CAPTURED.BTCUSD.tickValue, null);
    assert.equal(seeded.contracts.BTCUSD.tickValue, null);
    assert.equal(seeded.contracts.BTCUSD.minLot, null);
    assert.equal(seeded.contracts.BTCUSD.lotStep, null);
    assert.equal(isDraftComplete(seeded.contracts.BTCUSD), false);
  });

  it("clears the old BTC example triple 0.01/0.01/0.01", () => {
    const cleared = seedContracts({
      ...EMPTY_ACCOUNT,
      contracts: {
        ...EMPTY_ACCOUNT.contracts,
        BTCUSD: { tickSize: 0.01, tickValue: 0.01, minLot: 0.01, lotStep: 0.01 },
      },
    });
    assert.equal(cleared.contracts.BTCUSD.tickValue, null);
    assert.equal(cleared.contracts.BTCUSD.minLot, null);
    assert.equal(cleared.contracts.BTCUSD.lotStep, null);
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

  it("does not deduce minLot or lotStep from contract size", () => {
    assert.equal(CAPTURED.XAUUSD.contractSize, 100);
    assert.equal(CAPTURED.XAUUSD.minLot, null);
    assert.equal(CAPTURED.WTI.contractSize, 1000);
    assert.equal(CAPTURED.WTI.lotStep, null);
    const d = seedContracts(EMPTY_ACCOUNT).contracts.XAUUSD;
    assert.deepEqual(missingContractFields(d), ["minLot", "lotStep"]);
    assert.match(missingContractLabel(d) ?? "", /lote mínimo/);
    assert.match(missingContractLabel(d) ?? "", /paso de lote/);
  });

  it("XAU spread 48 is from the card; floating spreads stay empty", () => {
    const costs = seedCosts(emptyCosts());
    assert.equal(costs.XAUUSD.spreadTicks, 48);
    assert.equal(costs.US100.spreadTicks, null);
    assert.equal(costs.WTI.spreadTicks, null);
    assert.equal(costs.BTCUSD.spreadTicks, null);
    const kept = seedCosts({
      ...emptyCosts(),
      XAUUSD: { spreadTicks: 12, commissionEur: null },
    });
    assert.equal(kept.XAUUSD.spreadTicks, 12);
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
    assert.equal(stored.lotStep, 0.01);
  });

  it("does not treat typing 0. as a finished value", () => {
    assert.equal(isDecimalTyping("0"), true);
    assert.equal(isDecimalTyping("0."), true);
    assert.equal(parseDecimalPositive("0"), null);
    assert.equal(parseDecimalPositive("0."), null);
    assert.equal(parseDecimalPositive(""), null);
  });
});

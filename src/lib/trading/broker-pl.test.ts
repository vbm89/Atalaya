import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BROKER_CONTRACTS } from "./broker-contract.ts";
import { calculateTradePl, signedPriceMove } from "./broker-pl.ts";

describe("dirección BUY/SELL", () => {
  it("buy profits when exit > entry", () => {
    assert.equal(signedPriceMove("buy", 100, 110), 10);
    assert.equal(signedPriceMove("sell", 100, 90), 10);
    assert.equal(signedPriceMove("sell", 100, 110), -10);
  });
});

describe("P/L USD — fórmula MT4 tickValue/tickSize", () => {
  it("XAU SELL 0.01 · 10 dólares de precio = 10 USD", () => {
    const r = calculateTradePl({
      assetId: "XAUUSD",
      direction: "sell",
      entry: 3400,
      exit: 3390,
      volume: 0.01,
    });
    assert.equal(r.calculable, true);
    assert.equal(r.ticks, 1000);
    assert.equal(r.grossUsd, 10);
    assert.equal(r.netUsd, 10);
    assert.equal(r.brokerSymbol, "XAUUSD");
  });

  it("XAU BUY 0.01 opposite move is a 10 USD loss", () => {
    const r = calculateTradePl({
      assetId: "XAUUSD",
      direction: "buy",
      entry: 3400,
      exit: 3390,
      volume: 0.01,
    });
    assert.equal(r.grossUsd, -10);
  });

  it("US100 SELL 0.10 · 50 puntos = 5 USD", () => {
    const r = calculateTradePl({
      assetId: "US100",
      direction: "sell",
      entry: 20000,
      exit: 19950,
      volume: 0.1,
    });
    assert.equal(r.calculable, true);
    assert.equal(r.brokerSymbol, "US100Cash");
    assert.equal(r.grossUsd, 5);
  });

  it("US100 0.11 volume is accepted and scales linearly", () => {
    const a = calculateTradePl({
      assetId: "US100",
      direction: "buy",
      entry: 20000,
      exit: 20010,
      volume: 0.1,
    });
    const b = calculateTradePl({
      assetId: "US100",
      direction: "buy",
      entry: 20000,
      exit: 20010,
      volume: 0.11,
    });
    assert.equal(a.grossUsd, 1);
    assert.ok(b.grossUsd != null);
    assert.ok(Math.abs((b.grossUsd ?? 0) - 1.1) < 1e-9);
  });

  it("WTI BUY 0.01 · 1.00 de precio = 10 USD", () => {
    const r = calculateTradePl({
      assetId: "WTI",
      direction: "buy",
      entry: 90,
      exit: 91,
      volume: 0.01,
    });
    assert.equal(r.brokerSymbol, "WTICash");
    assert.equal(r.grossUsd, 10);
  });

  it("BTC uses tickValue 1.00 not contractSize 1 — 100 USD per 1.00 of price per lot", () => {
    const r = calculateTradePl({
      assetId: "BTCUSD",
      direction: "sell",
      entry: 80_000,
      exit: 79_900,
      volume: 0.01,
    });
    assert.equal(r.calculable, true);
    assert.equal(r.tickValueUsd, 1);
    assert.equal(r.contractSize, 1);
    assert.equal(r.usdPerPricePerLot, 100);
    assert.equal(r.grossUsd, 100);
    const wrongContractSize = 100 * 1 * 0.01;
    assert.notEqual(r.grossUsd, wrongContractSize);
  });
});

describe("EUR — no se inventa el cambio", () => {
  it("without EURUSD marks EUR NO CALCULABLE and still returns USD", () => {
    const r = calculateTradePl({
      assetId: "XAUUSD",
      direction: "sell",
      entry: 3400,
      exit: 3390,
      volume: 0.01,
    });
    assert.equal(r.netUsd, 10);
    assert.equal(r.netEur, null);
    assert.match(r.eurReason ?? "", /falta tipo de cambio/);
  });

  it("with EURUSD 1.10, 11 USD = 10 EUR", () => {
    const r = calculateTradePl({
      assetId: "XAUUSD",
      direction: "sell",
      entry: 3400,
      exit: 3389,
      volume: 0.01,
      usdPerEur: 1.1,
    });
    assert.equal(r.grossUsd, 11);
    assert.ok(r.netEur != null);
    assert.ok(Math.abs((r.netEur ?? 0) - 10) < 1e-9);
  });
});

describe("swap y spread flotante", () => {
  it("nightsHeld 0 → swap 0, not the card value", () => {
    const r = calculateTradePl({
      assetId: "XAUUSD",
      direction: "buy",
      entry: 3400,
      exit: 3400,
      volume: 1,
      nightsHeld: 0,
    });
    assert.equal(r.swapUsd, 0);
    assert.equal(r.netUsd, 0);
  });

  it("XAU buy 1.0 lot one night applies swap long -50.80 USD", () => {
    const r = calculateTradePl({
      assetId: "XAUUSD",
      direction: "buy",
      entry: 3400,
      exit: 3400,
      volume: 1,
      nightsHeld: 1,
    });
    assert.equal(r.swapUsd, -50.8);
    assert.equal(r.netUsd, -50.8);
  });

  it("does not subtract an invented spread", () => {
    const r = calculateTradePl({
      assetId: "US100",
      direction: "buy",
      entry: 20000,
      exit: 20000,
      volume: 0.1,
    });
    assert.equal(r.grossUsd, 0);
    assert.equal(r.netUsd, 0);
    assert.equal(BROKER_CONTRACTS.US100.spreadType, "floating");
  });
});

describe("no inventar si falta un campo crítico", () => {
  it("unknown tickValue refuses instead of assuming 0 or 1", () => {
    const r = calculateTradePl({
      assetId: "BTCUSD",
      direction: "buy",
      entry: 100,
      exit: 101,
      volume: 0.01,
      contract: { ...BROKER_CONTRACTS.BTCUSD, tickValueUsd: null },
    });
    assert.equal(r.calculable, false);
    assert.match(r.reason ?? "", /tickValue no confirmado/);
    assert.equal(r.grossUsd, null);
  });
});

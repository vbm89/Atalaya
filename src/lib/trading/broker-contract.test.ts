import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  BROKER_CONTRACTS,
  contractReady,
  isValidLot,
  isValidLotForAsset,
  lotInvalidReason,
  unknownFields,
  usdPerPricePerLot,
} from "./broker-contract.ts";

const V1 = {
  "src/lib/trading/engine.ts":
    "c3d53a4f4366add2c8a284d4f068ea5d2826a36e3aa259b460d74b37c36ce618",
  "src/lib/trading/signals.ts":
    "dfb2d2cd188b18daaebed5e843bd8dbefb1e1c6672be86d2092390a8b3bc019b",
  "src/lib/trading/structure.ts":
    "e72ba478f524170c7f6c1c6916e033c3fafb418b874aa33565e32dbd01b54170",
  "src/lib/trading/risk.ts":
    "4aa406c0061149486532e9f787d20c3cc9f845362dd5497fd42b42563b5d385e",
  "src/lib/watch/outcome.ts":
    "fdad185119978866d6bec772091e2d6d0d0af49a5207a7bae061d2d840453c90",
  "src/lib/market/xau-spot.ts":
    "393d01945077190a7745ad7cabc3b87bfb170f55fad82a4189a5ee661c678068",
} as const;

describe("V1 checksums — broker layer must not touch them", () => {
  for (const [file, expected] of Object.entries(V1)) {
    it(file, () => {
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
      assert.equal(hash, expected);
    });
  }
});

describe("claves internas vs símbolo de bróker", () => {
  it("US100Cash is the broker symbol, asset key stays US100", () => {
    assert.equal(BROKER_CONTRACTS.US100.assetKey, "US100");
    assert.equal(BROKER_CONTRACTS.US100.brokerSymbol, "US100Cash");
    assert.equal("US100Cash" in BROKER_CONTRACTS, false);
  });

  it("WTICash is the broker symbol, asset key stays WTI", () => {
    assert.equal(BROKER_CONTRACTS.WTI.assetKey, "WTI");
    assert.equal(BROKER_CONTRACTS.WTI.brokerSymbol, "WTICash");
    assert.equal("WTICash" in BROKER_CONTRACTS, false);
  });

  it("XAUUSD and BTCUSD keep the same key and symbol", () => {
    assert.equal(BROKER_CONTRACTS.XAUUSD.brokerSymbol, "XAUUSD");
    assert.equal(BROKER_CONTRACTS.BTCUSD.brokerSymbol, "BTCUSD");
  });
});

describe("captura MT4 — tamaños y ticks", () => {
  it("XAUUSD contract 100 / tick 0.01 / tick value 1", () => {
    const c = BROKER_CONTRACTS.XAUUSD;
    assert.equal(c.contractSize, 100);
    assert.equal(c.tickSize, 0.01);
    assert.equal(c.tickValueUsd, 1);
    assert.equal(usdPerPricePerLot(c), 100);
  });

  it("BTCUSD tick size 0.01 and tick value 1.00 from the card — not invented 0.01/0.01", () => {
    const c = BROKER_CONTRACTS.BTCUSD;
    assert.equal(c.tickSize, 0.01);
    assert.equal(c.tickValueUsd, 1);
    assert.notEqual(c.tickValueUsd, 0.01);
    assert.equal(c.contractSize, 1);
    assert.equal(usdPerPricePerLot(c), 100);
    assert.notEqual(usdPerPricePerLot(c), c.contractSize);
  });

  it("US100Cash tick 0.01 / tick value 0.01 / contract 1", () => {
    const c = BROKER_CONTRACTS.US100;
    assert.equal(c.contractSize, 1);
    assert.equal(c.tickSize, 0.01);
    assert.equal(c.tickValueUsd, 0.01);
    assert.equal(usdPerPricePerLot(c), 1);
  });

  it("WTICash contract 1000 / tick 0.01 / tick value 10", () => {
    const c = BROKER_CONTRACTS.WTI;
    assert.equal(c.contractSize, 1000);
    assert.equal(c.tickSize, 0.01);
    assert.equal(c.tickValueUsd, 10);
    assert.equal(usdPerPricePerLot(c), 1000);
  });

  it("all four are ready — no silent unknown critical field", () => {
    for (const id of ["XAUUSD", "BTCUSD", "US100", "WTI"] as const) {
      assert.equal(unknownFields(BROKER_CONTRACTS[id]).length, 0, id);
      assert.equal(contractReady(id), true, id);
    }
  });

  it("spread is floating on all four — no invented tick count", () => {
    for (const id of ["XAUUSD", "BTCUSD", "US100", "WTI"] as const) {
      assert.equal(BROKER_CONTRACTS[id].spreadType, "floating");
    }
  });
});

describe("lote mínimo y paso", () => {
  it("XAU 0.01 válido", () => {
    assert.equal(isValidLotForAsset("XAUUSD", 0.01), true);
  });
  it("BTC 0.01 válido", () => {
    assert.equal(isValidLotForAsset("BTCUSD", 0.01), true);
  });
  it("WTI 0.01 válido", () => {
    assert.equal(isValidLotForAsset("WTI", 0.01), true);
  });
  it("US100 0.10 válido", () => {
    assert.equal(isValidLotForAsset("US100", 0.1), true);
  });
  it("US100 0.11 válido", () => {
    assert.equal(isValidLotForAsset("US100", 0.11), true);
  });
  it("US100 0.12 válido", () => {
    assert.equal(isValidLotForAsset("US100", 0.12), true);
  });
  it("US100 0.20 válido", () => {
    assert.equal(isValidLotForAsset("US100", 0.2), true);
  });
  it("US100 0.105 inválido", () => {
    assert.equal(isValidLotForAsset("US100", 0.105), false);
    assert.match(lotInvalidReason("US100", 0.105) ?? "", /paso/);
  });
  it("US100 0.09 inválido", () => {
    assert.equal(isValidLotForAsset("US100", 0.09), false);
    assert.match(lotInvalidReason("US100", 0.09) ?? "", /lote mínimo/);
  });
  it("does not snap 0.11 to 0.10", () => {
    assert.equal(isValidLot(0.11, 0.1, 0.01), true);
    assert.equal(isValidLot(0.1, 0.1, 0.01), true);
    assert.notEqual(0.11, 0.1);
  });
});

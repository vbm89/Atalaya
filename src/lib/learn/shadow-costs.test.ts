import assert from "node:assert/strict";
import test from "node:test";
import { qualifiesFill, shadowCostR } from "./shadow-costs";

test("unknown spread/commission never becomes zero cost", () => {
  const result = shadowCostR(0.5, { spreadPrice: null, commissionPrice: 0.01, riskPrice: 1 });
  assert.equal(result.known, false);
  assert.equal(result.costUnknown, true);
  assert.equal(result.netR, null);
});

test("net R subtracts spread, fixed commission and predefined slippage", () => {
  const result = shadowCostR(1, { spreadPrice: 0.1, commissionPrice: 0.1, riskPrice: 1 }, 0.5);
  assert.equal(result.known, true);
  assert.equal(result.costR, 0.25);
  assert.equal(result.netR, 0.75);
});

test("touch and close-through are distinct fill models", () => {
  const observation = { touched: true, closedThrough: false };
  assert.equal(qualifiesFill(observation, "touch"), true);
  assert.equal(qualifiesFill(observation, "close_through"), false);
});

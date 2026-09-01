import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPin, normalizePin, pinEqual, pinMatches } from "./pin.ts";

describe("PIN de avisos", () => {
  it("rejects short or non-numeric", () => {
    assert.equal(normalizePin("12"), null);
    assert.equal(normalizePin("abcd"), null);
    assert.equal(normalizePin("1234"), "1234");
  });

  it("hashes stably and compares", () => {
    const h = hashPin("2468");
    assert.equal(h.length, 64);
    assert.equal(pinEqual(h, hashPin("2468")), true);
    assert.equal(pinEqual(h, hashPin("0000")), false);
  });

  it("matches stored hash when no env pin", () => {
    const stored = hashPin("1357");
    assert.equal(pinMatches("1357", stored), true);
    assert.equal(pinMatches("0000", stored), false);
    assert.equal(pinMatches("1357", null), false);
  });
});

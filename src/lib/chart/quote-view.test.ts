import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visualCardPrice, visualDelayed, wsTickIsFresh } from "./quote-view.ts";

describe("visual card prices", () => {
  it("never uses Bitget live as the XAUUSD main price", () => {
    const v = visualCardPrice({
      id: "XAUUSD",
      live: 4389.04,
      snapshotPrice: 4381.9,
      snapshotSpot: 4381.9,
    });
    assert.equal(v.main, 4381.9);
    assert.equal(v.proxy, 4389.04);
  });

  it("uses live as main for BTC/US100/WTI", () => {
    assert.equal(
      visualCardPrice({ id: "BTCUSD", live: 77900, snapshotPrice: 77800, snapshotSpot: null }).main,
      77900,
    );
    assert.equal(
      visualCardPrice({ id: "US100", live: 29187, snapshotPrice: 29227, snapshotSpot: null }).main,
      29187,
    );
    assert.equal(
      visualCardPrice({ id: "WTI", live: null, snapshotPrice: 87.7, snapshotSpot: null }).main,
      87.7,
    );
  });
});

describe("live freshness", () => {
  it("treats a tick younger than 8s as fresh WS", () => {
    assert.equal(wsTickIsFresh(1_000, 8_999), true);
    assert.equal(wsTickIsFresh(1_000, 9_000), false);
    assert.equal(wsTickIsFresh(undefined, 1_000), false);
  });

  it("marks rest and snapshot as delayed", () => {
    assert.equal(visualDelayed("ws", true), false);
    assert.equal(visualDelayed("rest", true), true);
    assert.equal(visualDelayed("snapshot", true), true);
    assert.equal(visualDelayed("ws", false), true);
  });
});

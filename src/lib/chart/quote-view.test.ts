import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visualCardPrice, visualDelayed, wsTickIsFresh, xauSpotIsFresh, XAU_SPOT_STALE_MS } from "./quote-view.ts";

describe("visual card prices", () => {
  it("shows XAU spot only — never a PROXY field", () => {
    const liveSpot = visualCardPrice({
      id: "XAUUSD",
      live: 4379.2,
      snapshotPrice: 4381.9,
      snapshotSpot: 4381.9,
    });
    assert.equal(liveSpot.main, 4379.2);
    assert.equal(liveSpot.proxy, null);
    const frozen = visualCardPrice({
      id: "XAUUSD",
      live: null,
      snapshotPrice: 4381.9,
      snapshotSpot: 4381.9,
    });
    assert.equal(frozen.main, 4381.9);
    assert.equal(frozen.proxy, null);
  });

  it("does not treat Bitget last as XAU card price even if passed as snapshotPrice", () => {
    const shown = visualCardPrice({
      id: "XAUUSD",
      live: 4354.2,
      snapshotPrice: 4361.13,
      snapshotSpot: 4354.2,
    });
    assert.equal(shown.main, 4354.2);
    assert.equal(shown.proxy, null);
  });

  it("never falls back to Bitget snapshotPrice when live and snapshotSpot are empty", () => {
    const shown = visualCardPrice({
      id: "XAUUSD",
      live: null,
      snapshotPrice: 4361.13,
      snapshotSpot: null,
    });
    assert.equal(shown.main, null);
    assert.equal(shown.proxy, null);
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

  it("treats XAU gold-api fetch under 36s as fresh", () => {
    assert.equal(XAU_SPOT_STALE_MS, 36_000);
    assert.equal(xauSpotIsFresh(1_000, 36_999), true);
    assert.equal(xauSpotIsFresh(1_000, 37_000), false);
    assert.equal(xauSpotIsFresh(undefined, 1_000), false);
    assert.equal(xauSpotIsFresh(0, 1_000), false);
  });
});

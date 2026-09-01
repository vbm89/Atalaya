import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WATCH_STALE_MS, assetDataLamp, watchLamp, worstDataLamp } from "./feed-lamp.ts";

describe("semáforo de datos", () => {
  it("ok when feed is ok and price exists", () => {
    const r = assetDataLamp({ dataStatus: "ok", lastDataAt: new Date().toISOString(), price: 100 });
    assert.equal(r.lamp, "ok");
    assert.equal(r.label, "DATOS OK");
  });

  it("delayed when feed marks stale — V1 state is not used", () => {
    const r = assetDataLamp({ dataStatus: "stale", lastDataAt: new Date().toISOString(), price: 100 });
    assert.equal(r.lamp, "delayed");
    assert.match(r.label, /RETRASADOS/);
  });

  it("unavailable on error even if a last price exists", () => {
    const r = assetDataLamp({ dataStatus: "error", lastDataAt: null, price: 100 });
    assert.equal(r.lamp, "unavailable");
  });

  it("unavailable on insufficient", () => {
    const r = assetDataLamp({ dataStatus: "insufficient", lastDataAt: null, price: null });
    assert.equal(r.lamp, "unavailable");
  });

  it("session closed is not UNAVAILABLE", () => {
    const r = assetDataLamp({ dataStatus: "session_closed", lastDataAt: new Date().toISOString(), price: 80 });
    assert.equal(r.lamp, "ok");
    assert.match(r.label, /cerrado/);
  });
});

describe("semáforo de vigilancia", () => {
  const now = Date.parse("2026-08-29T10:20:00Z");

  it("ok after a recent successful tick", () => {
    const r = watchLamp(
      { lastStatus: "ok", lastOkMs: now - 60_000, stale: false, watchSecretConfigured: true },
      now,
    );
    assert.equal(r.lamp, "ok");
  });

  it("stale after 20 min without ok eval", () => {
    const r = watchLamp(
      {
        lastStatus: "ok",
        lastOkMs: now - WATCH_STALE_MS - 1,
        stale: true,
        watchSecretConfigured: true,
      },
      now,
    );
    assert.equal(r.lamp, "stale");
  });

  it("stale on lag (BTC 15M missing) even if last ok is recent", () => {
    const r = watchLamp(
      { lastStatus: "lag", lastOkMs: now - 30_000, stale: false, watchSecretConfigured: true },
      now,
    );
    assert.equal(r.lamp, "stale");
  });

  it("error on failed tick", () => {
    const r = watchLamp(
      { lastStatus: "failed", lastOkMs: now - 30_000, stale: false, watchSecretConfigured: true },
      now,
    );
    assert.equal(r.lamp, "error");
  });
});

describe("tres dimensiones independientes", () => {
  it("worst lamp does not use V1 setupState", () => {
    const r = worstDataLamp([
      { dataStatus: "ok", lastDataAt: new Date().toISOString(), price: 1 },
      { dataStatus: "stale", lastDataAt: new Date().toISOString(), price: 1 },
    ]);
    assert.equal(r.lamp, "delayed");
    assert.match(r.note ?? "", /retrasado/);
  });

  it("BTC delayed does not paint US100 as delayed", () => {
    const btc = assetDataLamp({ dataStatus: "stale", lastDataAt: new Date().toISOString(), price: 1 });
    const us100 = assetDataLamp({ dataStatus: "ok", lastDataAt: new Date().toISOString(), price: 1 });
    assert.equal(btc.lamp, "delayed");
    assert.equal(us100.lamp, "ok");
    const worst = worstDataLamp([
      { dataStatus: "stale", lastDataAt: new Date().toISOString(), price: 1 },
      { dataStatus: "ok", lastDataAt: new Date().toISOString(), price: 1 },
    ]);
    assert.equal(worst.lamp, "delayed");
  });

  it("all providers down → DATOS NO DISPONIBLES, not ESPERAR", () => {
    const r = worstDataLamp([
      { dataStatus: "error", lastDataAt: null, price: null },
      { dataStatus: "error", lastDataAt: null, price: null },
    ]);
    assert.equal(r.lamp, "unavailable");
    assert.match(r.note ?? "", /No es un ESPERAR de V1/);
  });
});

describe("cron / recuperación", () => {
  const now = Date.parse("2026-08-29T10:20:00Z");

  it("cron caído (sin ok en 20 min) → vigilancia retrasada", () => {
    const r = watchLamp(
      {
        lastStatus: "none",
        lastOkMs: null,
        stale: true,
        watchSecretConfigured: true,
      },
      now,
    );
    assert.equal(r.lamp, "stale");
  });

  it("recuperación del feed: lag y luego ok", () => {
    const lag = watchLamp(
      { lastStatus: "lag", lastOkMs: now - 30_000, stale: false, watchSecretConfigured: true },
      now,
    );
    assert.equal(lag.lamp, "stale");
    const ok = watchLamp(
      { lastStatus: "ok", lastOkMs: now, stale: false, watchSecretConfigured: true },
      now,
    );
    assert.equal(ok.lamp, "ok");
  });
});


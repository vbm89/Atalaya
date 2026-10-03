import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { authorizeWatchRequest, watchSecret } from "./secret.ts";
import { emptyPublicHealth, toPublicWatchHealth, type WatchHealth } from "./health.ts";
import { secretConfigured, secretStatusLabel } from "./secret-status.ts";
import { vapidConfigured, vapidEnvKeys } from "./vapid.ts";

describe("OPS auth", () => {
  it("missing WATCH_SECRET → 503, never open", () => {
    const prev = process.env.WATCH_SECRET;
    delete process.env.WATCH_SECRET;
    const r = authorizeWatchRequest(new Request("http://x/api/watch/tick"));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 503);
      assert.doesNotMatch(r.error, /Bearer |test-watch/);
    }
    if (prev === undefined) delete process.env.WATCH_SECRET;
    else process.env.WATCH_SECRET = prev;
  });

  it("wrong bearer → 401; correct → ok", () => {
    const prev = process.env.WATCH_SECRET;
    process.env.WATCH_SECRET = "ops-test-secret-16chars";
    const none = authorizeWatchRequest(new Request("http://x/api/watch/tick"));
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.status, 401);
    const bad = authorizeWatchRequest(
      new Request("http://x/api/watch/tick", { headers: { authorization: "Bearer wrong-secret-16xx" } }),
    );
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.status, 401);
    const good = authorizeWatchRequest(
      new Request("http://x/api/watch/tick", {
        headers: { authorization: "Bearer ops-test-secret-16chars" },
      }),
    );
    assert.equal(good.ok, true);
    if (prev === undefined) delete process.env.WATCH_SECRET;
    else process.env.WATCH_SECRET = prev;
  });
});

describe("OPS health", () => {
  it("public payload never includes secrets", () => {
    process.env.WATCH_SECRET = "super-secret-watch-key-xxx";
    const now = Date.parse("2026-08-31T12:00:00Z");
    const h: WatchHealth = {
      lastTickAt: "2026-08-31T11:55:00.000Z",
      lastSlot: 1,
      lastStatus: "ok",
      lastError: "WATCH_SECRET leaked?",
      lastEvalMs: now - 60_000,
      lastOkMs: now - 60_000,
      nextEvalMs: now + 60_000,
      stale: false,
      watchSecretConfigured: true,
      snapshots: [{ assetId: "BTCUSD", state: "entry", episodeId: "ep1", evaluatedAtMs: now }],
    };
    const pub = toPublicWatchHealth(h, now, { persistence: "ok", openEpisodes: 2 });
    const text = JSON.stringify(pub);
    assert.equal(pub.watchSecret, "CONFIGURED");
    assert.equal(pub.openEpisodes, 2);
    assert.equal(pub.lastTickAgeMs, 60_000);
    assert.doesNotMatch(text, /super-secret-watch-key/);
    assert.doesNotMatch(text, /ep1/);
    assert.doesNotMatch(text, /WATCH_SECRET leaked/);
    assert.equal("snapshots" in pub, false);
    const down = emptyPublicHealth(now, "error");
    assert.equal(down.persistence, "error");
    assert.doesNotMatch(JSON.stringify(down), /super-secret/);
    delete process.env.WATCH_SECRET;
  });

  it("HOME follows the same configured flag as /api/watch/health and never the secret value", () => {
    const now = Date.parse("2026-10-03T08:00:00Z");
    const configured: WatchHealth = {
      lastTickAt: "2026-10-03T07:55:00.000Z",
      lastSlot: 1,
      lastStatus: "ok",
      lastError: null,
      lastEvalMs: now - 60_000,
      lastOkMs: now - 60_000,
      nextEvalMs: now + 60_000,
      stale: false,
      watchSecretConfigured: true,
      snapshots: [],
    };
    const pub = toPublicWatchHealth(configured, now, { persistence: "ok" });
    assert.equal(secretConfigured(pub), true);
    assert.equal(secretConfigured({ watchSecretConfigured: true }), true);
    assert.equal(secretConfigured({ watchSecret: "CONFIGURED" }), true);
    assert.equal(secretStatusLabel(secretConfigured(pub)), "SECRETO CONFIGURADO");
    assert.equal(secretConfigured({ watchSecret: "NOT_CONFIGURED", watchSecretConfigured: true }), false);
    assert.equal(secretStatusLabel(false), "SIN SECRETO");
    assert.equal(secretConfigured(null), null);
    assert.equal(secretStatusLabel(null), null);
    assert.equal(secretConfigured({}), null);
    const home = readFileSync(new URL("../../components/dashboard/home-feed.tsx", import.meta.url), "utf8");
    const dash = readFileSync(new URL("../../components/dashboard/dashboard.tsx", import.meta.url), "utf8");
    const fn = readFileSync(new URL("./watch.fn.ts", import.meta.url), "utf8");
    assert.match(home, /secretConfigured\(server\)/);
    assert.match(dash, /secretConfigured\(server\)/);
    assert.doesNotMatch(home, /WATCH_SECRET|process\.env/);
    assert.doesNotMatch(dash, /WATCH_SECRET|process\.env/);
    assert.match(fn, /readWatchHealth/);
    assert.doesNotMatch(fn, /process\.env\.WATCH_SECRET/);
    assert.doesNotMatch(JSON.stringify(pub), /super-secret|WATCH_SECRET=/);
  });
});

describe("OPS VAPID", () => {
  it("does not invent keys when env is empty", () => {
    const prevPub = process.env.VAPID_PUBLIC_KEY;
    const prevPriv = process.env.VAPID_PRIVATE_KEY;
    const prevVite = process.env.VITE_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VITE_VAPID_PUBLIC_KEY;
    assert.equal(vapidEnvKeys(), null);
    assert.equal(vapidConfigured(), false);
    if (prevPub !== undefined) process.env.VAPID_PUBLIC_KEY = prevPub;
    if (prevPriv !== undefined) process.env.VAPID_PRIVATE_KEY = prevPriv;
    if (prevVite !== undefined) process.env.VITE_VAPID_PUBLIC_KEY = prevVite;
  });
});

describe("OPS secret helper", () => {
  it("watchSecret ignores short values", () => {
    const prev = process.env.WATCH_SECRET;
    process.env.WATCH_SECRET = "short";
    assert.equal(watchSecret(), null);
    if (prev === undefined) delete process.env.WATCH_SECRET;
    else process.env.WATCH_SECRET = prev;
  });
});

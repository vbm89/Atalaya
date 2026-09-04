import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  SHADOW_REPLAY_HOST,
  authorizeShadowReplay,
  handleShadowReplay,
} from "./shadow-replay-http.ts";

const TOKEN = "shadow-replay-test-token-32chars";

function restore(key: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[key];
  else process.env[key] = prev;
}

const prevEnabled = process.env.SHADOW_REPLAY_ENABLED;
const prevToken = process.env.SHADOW_REPLAY_TOKEN;
const prevDb = process.env.DATABASE_URL;

afterEach(() => {
  restore("SHADOW_REPLAY_ENABLED", prevEnabled);
  restore("SHADOW_REPLAY_TOKEN", prevToken);
  restore("DATABASE_URL", prevDb);
});

function req(method: string, host: string, authorization?: string): Request {
  const headers: Record<string, string> = { host };
  if (authorization) headers.authorization = authorization;
  return new Request(`https://${host}/api/learn/shadow-replay`, { method, headers });
}

describe("shadow replay http gate", () => {
  it("disabled → 404 even with token and correct host", async () => {
    delete process.env.SHADOW_REPLAY_ENABLED;
    process.env.SHADOW_REPLAY_TOKEN = TOKEN;
    const r = authorizeShadowReplay(req("POST", SHADOW_REPLAY_HOST, `Bearer ${TOKEN}`));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 404);
    const res = await handleShadowReplay(req("POST", SHADOW_REPLAY_HOST, `Bearer ${TOKEN}`));
    assert.equal(res.status, 404);
  });

  it("wrong host → 404 even when enabled", () => {
    process.env.SHADOW_REPLAY_ENABLED = "true";
    process.env.SHADOW_REPLAY_TOKEN = TOKEN;
    const prod = authorizeShadowReplay(req("POST", "atalaya-nu.vercel.app", `Bearer ${TOKEN}`));
    assert.equal(prod.ok, false);
    if (!prod.ok) assert.equal(prod.status, 404);
    const preview = authorizeShadowReplay(
      req("POST", "atalaya-git-research-shadow-v2-phase-a-atalaya2.vercel.app", `Bearer ${TOKEN}`),
    );
    assert.equal(preview.ok, false);
    if (!preview.ok) assert.equal(preview.status, 404);
  });

  it("GET on the allowed host → 405", async () => {
    process.env.SHADOW_REPLAY_ENABLED = "true";
    process.env.SHADOW_REPLAY_TOKEN = TOKEN;
    const r = authorizeShadowReplay(req("GET", SHADOW_REPLAY_HOST, `Bearer ${TOKEN}`));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 405);
    const res = await handleShadowReplay(req("GET", SHADOW_REPLAY_HOST, `Bearer ${TOKEN}`));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });

  it("POST without/invalid bearer → 401; does not echo the token", async () => {
    process.env.SHADOW_REPLAY_ENABLED = "true";
    process.env.SHADOW_REPLAY_TOKEN = TOKEN;
    const none = authorizeShadowReplay(req("POST", SHADOW_REPLAY_HOST));
    assert.equal(none.ok, false);
    if (!none.ok) {
      assert.equal(none.status, 401);
      assert.doesNotMatch(none.error, /Bearer |shadow-replay-test/);
    }
    const bad = await handleShadowReplay(req("POST", SHADOW_REPLAY_HOST, "Bearer wrong-token-16xx"));
    assert.equal(bad.status, 401);
    const body = await bad.text();
    assert.doesNotMatch(body, /shadow-replay-test-token|DATABASE_URL|postgresql:\/\//i);
  });

  it("authorized POST without DATABASE_URL → 503, no secret leak", async () => {
    process.env.SHADOW_REPLAY_ENABLED = "true";
    process.env.SHADOW_REPLAY_TOKEN = TOKEN;
    delete process.env.DATABASE_URL;
    const auth = authorizeShadowReplay(req("POST", SHADOW_REPLAY_HOST, `Bearer ${TOKEN}`));
    assert.equal(auth.ok, true);
    const res = await handleShadowReplay(req("POST", SHADOW_REPLAY_HOST, `Bearer ${TOKEN}`));
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.doesNotMatch(body, /DATABASE_URL|postgresql:\/\/|SHADOW_REPLAY_TOKEN/i);
  });
});

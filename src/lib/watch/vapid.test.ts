import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_VAPID_SUBJECT, resolveVapidSubject } from "./vapid.ts";

describe("VAPID subject — Apple rejects .local", () => {
  it("empty uses the production https origin", () => {
    const r = resolveVapidSubject(undefined);
    assert.equal(r.subject, DEFAULT_VAPID_SUBJECT);
    assert.equal(r.kind, "https");
    assert.equal(r.overridden, false);
  });

  it("overrides mailto:noreply@atalaya.local", () => {
    const r = resolveVapidSubject("mailto:noreply@atalaya.local");
    assert.equal(r.subject, DEFAULT_VAPID_SUBJECT);
    assert.equal(r.kind, "https");
    assert.equal(r.overridden, true);
  });

  it("keeps a real mailto", () => {
    const r = resolveVapidSubject("mailto:ops@example.com");
    assert.equal(r.subject, "mailto:ops@example.com");
    assert.equal(r.kind, "mailto");
    assert.equal(r.overridden, false);
  });

  it("keeps the production https subject", () => {
    const r = resolveVapidSubject("https://atalaya-nu.vercel.app");
    assert.equal(r.overridden, false);
    assert.equal(r.kind, "https");
  });

  it("overrides https://….local", () => {
    const r = resolveVapidSubject("https://atalaya.local");
    assert.equal(r.overridden, true);
    assert.equal(r.subject, DEFAULT_VAPID_SUBJECT);
  });
});

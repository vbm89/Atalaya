import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { describe, it } from "node:test";
import {
  DEFAULT_VAPID_SUBJECT,
  VAPID_EXPIRATION_SECONDS,
  isApplePushHost,
  normalizeVapidB64,
  pushServiceOrigin,
  resolveVapidSubject,
  vapidEnvKeys,
  vapidJwtPreview,
  vapidKeyPairMatches,
  vapidPublicFromPrivate,
  vapidSubjectForEndpoint,
} from "./vapid.ts";
import { formatPushSendError } from "./notify.ts";

function pair(): { publicKey: string; privateKey: string } {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  return {
    publicKey: Buffer.from(curve.getPublicKey()).toString("base64url"),
    privateKey: Buffer.from(curve.getPrivateKey()).toString("base64url"),
  };
}

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

  it("keeps a real mailto for non-Apple config", () => {
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

describe("Apple JWT claims", () => {
  const apple = "https://web.push.apple.com/Q/abc123";

  it("aud is the push service origin, not the app host or full endpoint", () => {
    assert.equal(pushServiceOrigin(apple), "https://web.push.apple.com");
    assert.equal(isApplePushHost("web.push.apple.com"), true);
    const jwt = vapidJwtPreview(apple, "mailto:ops@example.com", 1_700_000_000_000);
    assert.equal(jwt.aud, "https://web.push.apple.com");
    assert.notEqual(jwt.aud, "https://atalaya-nu.vercel.app");
    assert.notEqual(jwt.aud, apple);
  });

  it("Apple sub is always the https origin — mailto becomes BadJwtToken on Apple", () => {
    const jwt = vapidJwtPreview(apple, "mailto:ops@example.com", 1_700_000_000_000);
    assert.equal(jwt.sub, DEFAULT_VAPID_SUBJECT);
    assert.equal(jwt.appleHost, true);
    assert.equal(vapidSubjectForEndpoint("mailto:ops@example.com", apple).overridden, true);
  });

  it("iat and exp are unix seconds, exp is 12h and under 24h", () => {
    const now = 1_700_000_000_000;
    const jwt = vapidJwtPreview(apple, DEFAULT_VAPID_SUBJECT, now);
    assert.equal(jwt.iat, Math.floor(now / 1000));
    assert.equal(jwt.exp, jwt.iat + VAPID_EXPIRATION_SECONDS);
    assert.equal(jwt.secondsUntilExp, 12 * 60 * 60);
    assert.ok(jwt.secondsUntilExp < 24 * 60 * 60);
    assert.equal(jwt.alg, "ES256");
    assert.equal(jwt.typ, "JWT");
    assert.equal(jwt.kid, null);
  });

  it("does not treat Date.now() ms as exp", () => {
    const jwt = vapidJwtPreview(apple, DEFAULT_VAPID_SUBJECT, Date.now());
    assert.ok(jwt.iat < 4_000_000_000, "iat must be seconds not ms");
    assert.ok(jwt.exp - jwt.iat === VAPID_EXPIRATION_SECONDS);
  });
});

describe("VAPID key pair", () => {
  it("matching P-256 pair verifies", () => {
    const k = pair();
    assert.equal(k.publicKey, vapidPublicFromPrivate(k.privateKey));
    assert.equal(vapidKeyPairMatches(k.publicKey, k.privateKey), true);
  });

  it("mismatched pair is detected — never assumed", () => {
    const a = pair();
    const b = pair();
    assert.equal(vapidKeyPairMatches(a.publicKey, b.privateKey), false);
  });

  it("normalizes padded standard base64", () => {
    const k = pair();
    const padded = Buffer.from(k.publicKey, "base64url").toString("base64");
    assert.equal(normalizeVapidB64(padded), k.publicKey);
  });

  it("when env public does not match private, derived public is used so the JWT can verify", () => {
    const a = pair();
    const b = pair();
    const prevPub = process.env.VAPID_PUBLIC_KEY;
    const prevPriv = process.env.VAPID_PRIVATE_KEY;
    const prevVite = process.env.VITE_VAPID_PUBLIC_KEY;
    process.env.VAPID_PUBLIC_KEY = a.publicKey;
    process.env.VAPID_PRIVATE_KEY = b.privateKey;
    delete process.env.VITE_VAPID_PUBLIC_KEY;
    try {
      const keys = vapidEnvKeys();
      assert.ok(keys);
      assert.equal(keys!.privateKey, b.privateKey);
      assert.equal(keys!.publicKey, b.publicKey);
      assert.notEqual(keys!.publicKey, a.publicKey);
      assert.equal(vapidKeyPairMatches(keys!.publicKey, keys!.privateKey), true);
    } finally {
      if (prevPub === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = prevPub;
      if (prevPriv === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = prevPriv;
      if (prevVite === undefined) delete process.env.VITE_VAPID_PUBLIC_KEY;
      else process.env.VITE_VAPID_PUBLIC_KEY = prevVite;
    }
  });
});

describe("Apple error mapping", () => {
  it("403 BadJwtToken is stored with HTTP and reason, not a bare proveedor", () => {
    const s = formatPushSendError({
      statusCode: 403,
      body: '{"reason":"BadJwtToken"}',
    });
    assert.equal(s, 'proveedor HTTP 403 · {"reason":"BadJwtToken"}');
  });

  it("201 is not an error path", () => {
    const s = formatPushSendError({ statusCode: 201, body: "" });
    assert.notEqual(s, "gone");
  });

  it("410 is gone", () => {
    assert.equal(formatPushSendError({ statusCode: 410, body: "" }), "gone");
  });
});

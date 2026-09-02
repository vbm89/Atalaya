import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PUSH_PREFS,
  inQuietWindow,
  parsePushPrefs,
  shouldPushWithPrefs,
} from "./push-prefs.ts";

describe("horas silenciosas (Europe/Madrid)", () => {
  it("false when start or end is missing", () => {
    assert.equal(inQuietWindow(Date.now(), null, "08:00"), false);
    assert.equal(inQuietWindow(Date.now(), "23:00", null), false);
    assert.equal(inQuietWindow(Date.now(), "10:00", "10:00"), false);
  });

  it("same-day window", () => {
    const inside = Date.parse("2026-08-30T12:00:00+02:00");
    const before = Date.parse("2026-08-30T09:59:00+02:00");
    const after = Date.parse("2026-08-30T14:00:00+02:00");
    assert.equal(inQuietWindow(inside, "10:00", "14:00"), true);
    assert.equal(inQuietWindow(before, "10:00", "14:00"), false);
    assert.equal(inQuietWindow(after, "10:00", "14:00"), false);
  });

  it("overnight window wraps midnight", () => {
    const night = Date.parse("2026-08-30T23:30:00+02:00");
    const morning = Date.parse("2026-08-31T07:00:00+02:00");
    const day = Date.parse("2026-08-31T10:00:00+02:00");
    assert.equal(inQuietWindow(night, "23:00", "08:00"), true);
    assert.equal(inQuietWindow(morning, "23:00", "08:00"), true);
    assert.equal(inQuietWindow(day, "23:00", "08:00"), false);
  });
});

describe("shouldPushWithPrefs", () => {
  it("defaults push ENTRADA only — never MAPA, PENDING or ESPERAR", () => {
    assert.equal(shouldPushWithPrefs("entry", DEFAULT_PUSH_PREFS), true);
    assert.equal(shouldPushWithPrefs("pending", DEFAULT_PUSH_PREFS), false);
    assert.equal(shouldPushWithPrefs("map", DEFAULT_PUSH_PREFS), false);
    assert.equal(shouldPushWithPrefs("wait", DEFAULT_PUSH_PREFS), false);
  });

  it("prefs cannot re-enable PENDING or MAPA", () => {
    const prefs = { ...DEFAULT_PUSH_PREFS, pending: true, map: true, expired: true };
    assert.equal(shouldPushWithPrefs("pending", prefs), false);
    assert.equal(shouldPushWithPrefs("map", prefs), false);
    assert.equal(shouldPushWithPrefs("wait", prefs), false);
    assert.equal(shouldPushWithPrefs("entry", prefs), true);
  });

  it("CADUCIDAD checkbox never turns ESPERAR into a Push", () => {
    const prefs = { ...DEFAULT_PUSH_PREFS, expired: true };
    assert.equal(shouldPushWithPrefs("wait", prefs), false);
    assert.equal(shouldPushWithPrefs("entry", prefs), true);
  });

  it("quiet hours skip push without inventing a V1 state", () => {
    const prefs = { ...DEFAULT_PUSH_PREFS, quietStart: "23:00", quietEnd: "08:00" };
    const night = Date.parse("2026-08-30T23:30:00+02:00");
    assert.equal(shouldPushWithPrefs("entry", prefs, night), false);
    assert.equal(shouldPushWithPrefs("pending", prefs, night), false);
  });

  it("pause 24h skips all push", () => {
    const now = Date.parse("2026-08-30T12:00:00Z");
    const prefs = { ...DEFAULT_PUSH_PREFS, pausedUntilMs: now + 60_000 };
    assert.equal(shouldPushWithPrefs("entry", prefs, now), false);
    assert.equal(shouldPushWithPrefs("entry", prefs, now + 60_001), true);
  });

  it("parsePushPrefs ignores junk quiet times", () => {
    const p = parsePushPrefs({ quietStart: "25:99", quietEnd: "abc", pausedUntilMs: "x" });
    assert.equal(p.quietStart, null);
    assert.equal(p.quietEnd, null);
    assert.equal(p.pausedUntilMs, null);
  });
});

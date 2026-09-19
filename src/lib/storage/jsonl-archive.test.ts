import assert from "node:assert/strict";
import test from "node:test";
import {
  JsonlShaWriter,
  barToJsonlLine,
  discoveryDayObjectKey,
  encodeBarsJsonl,
  parseJsonlBars,
  sha256Utf8,
  utcDayFromT,
} from "./jsonl-archive";
import type { ArchiveBar } from "./types";

const sample: ArchiveBar[] = [
  { assetId: "XAUUSD", tf: "15m", t: 1_700_000_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, source: "test" },
  { assetId: "XAUUSD", tf: "15m", t: 1_700_000_900, o: 1.5, h: 2.5, l: 1, c: 2, v: null },
];

test("object key is asset/tf/day jsonl", () => {
  assert.equal(
    discoveryDayObjectKey("XAUUSD", "15m", "2024-01-15"),
    "discovery/XAUUSD/15m/2024-01-15.jsonl",
  );
});

test("utcDayFromT handles seconds and ms", () => {
  assert.equal(utcDayFromT(1_700_000_000), "2023-11-14");
  assert.equal(utcDayFromT(1_700_000_000_000), "2023-11-14");
});

test("JSONL roundtrip + sha256", () => {
  const enc = encodeBarsJsonl(sample, 1);
  assert.equal(enc.rowCount, 2);
  assert.ok(enc.byteSize > 0);
  assert.equal(enc.sha256, sha256Utf8(enc.text));
  const back = parseJsonlBars(enc.text);
  assert.equal(back.length, 2);
  assert.equal(back[0].assetId, "XAUUSD");
  assert.equal(back[1].v, null);
  assert.equal(barToJsonlLine(sample[0]).includes("\n"), false);
});

test("JsonlShaWriter matches encodeBarsJsonl sha", () => {
  const w = new JsonlShaWriter();
  w.writeBars([sample[0]]);
  w.writeBars([sample[1]]);
  const a = w.finish();
  const b = encodeBarsJsonl(sample);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.rowCount, b.rowCount);
  assert.equal(a.text, b.text);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseCursor, serializeCursor } from "./checkpoints";

test("checkpoint cursor serialize roundtrip", () => {
  const cursor = { scopeIndex: 2, afterT: 1700000900, assetId: "XAUUSD", tf: "15m" };
  const raw = serializeCursor(cursor);
  assert.equal(typeof raw, "string");
  const back = parseCursor(raw);
  assert.deepEqual(back, cursor);
});

test("parseCursor accepts object or empty", () => {
  assert.deepEqual(parseCursor({ a: 1 }), { a: 1 });
  assert.deepEqual(parseCursor(null), {});
  assert.deepEqual(parseCursor("not-json"), {});
  assert.deepEqual(parseCursor('{"x":true}'), { x: true });
});

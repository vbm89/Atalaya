import assert from "node:assert/strict";
import test from "node:test";
import { InactiveStorageError } from "./types";

test("InactiveStorageError has stable code", () => {
  const err = new InactiveStorageError();
  assert.equal(err.name, "InactiveStorageError");
  assert.equal(err.code, "INACTIVE_STORAGE");
  assert.match(err.message, /inactive/i);
});

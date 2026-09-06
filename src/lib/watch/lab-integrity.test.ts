import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectV1Sha } from "./lab-integrity-read.ts";
import {
  LAB_COUNTS_SQL,
  LAB_UNAVAILABLE,
  displayLabValue,
  labUnavailable,
  parseLabCounts,
  tickIntegrityLabel,
} from "./lab-integrity.ts";

describe("lab integrity", () => {
  it("missing values display as No disponible, never as false", () => {
    assert.equal(displayLabValue(null), LAB_UNAVAILABLE);
    assert.equal(displayLabValue(undefined), LAB_UNAVAILABLE);
    assert.equal(displayLabValue(""), LAB_UNAVAILABLE);
    assert.equal(displayLabValue(0), "0");
    assert.equal(displayLabValue(4), "4");
    const empty = labUnavailable();
    assert.equal(empty.episodes, null);
    assert.equal(empty.lastShadowReplayAt, null);
    assert.equal(empty.extraTestN, null);
    assert.equal(empty.lastReplayInsufficient, null);
    assert.equal(displayLabValue(empty.lastShadowReplayResult), LAB_UNAVAILABLE);
  });

  it("tick label uses health, not invented status", () => {
    assert.equal(tickIntegrityLabel(null), LAB_UNAVAILABLE);
    assert.equal(tickIntegrityLabel({ lastStatus: "none", stale: true }), LAB_UNAVAILABLE);
    assert.equal(tickIntegrityLabel({ lastStatus: "ok", stale: false }), "OK");
    assert.equal(tickIntegrityLabel({ lastStatus: "ok", stale: true }), "retrasado");
    assert.equal(tickIntegrityLabel({ lastStatus: "lag", stale: false }), "retrasado");
    assert.equal(tickIntegrityLabel({ lastStatus: "failed", stale: false }), "error");
  });

  it("SELECT is read-only and uses existing tables", () => {
    assert.match(LAB_COUNTS_SQL, /select/i);
    assert.doesNotMatch(LAB_COUNTS_SQL, /\b(insert|update|delete|drop|alter|create)\b/i);
    assert.match(LAB_COUNTS_SQL, /to_state = 'entry'/);
    assert.match(LAB_COUNTS_SQL, /entryGates/);
    assert.match(LAB_COUNTS_SQL, /postEntry/);
    assert.doesNotMatch(LAB_COUNTS_SQL, /create table/i);
  });

  it("parseLabCounts keeps nulls instead of coercing to 0", () => {
    const parsed = parseLabCounts({ episodes: 12, v1_entries: null, git_sha: "abc" });
    assert.equal(parsed.episodes, 12);
    assert.equal(parsed.v1Entries, null);
    assert.equal(parsed.gitSha, "abc");
    assert.equal(parsed.tapeGaps, null);
  });

  it("inspectV1Sha reports intacta when the six protected files match", () => {
    assert.equal(inspectV1Sha(), "intacta");
  });
});

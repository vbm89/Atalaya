import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { expected, paperTablesReady, requiredPaperTables } from "./paper-db-policy.mjs";

const ready = [...requiredPaperTables, "_migrations"];

test("paper cycle requires the three ledger tables and the five migrations in order", () => {
  assert.equal(paperTablesReady(ready, expected), true);
});

test("paper cycle refuses a missing ledger table", () => {
  for (const missing of requiredPaperTables) {
    assert.equal(
      paperTablesReady(
        ready.filter((table) => table !== missing),
        expected,
      ),
      false,
    );
  }
});

test("paper cycle refuses a partial, duplicate, or reordered migration record", () => {
  assert.equal(paperTablesReady(ready, expected.slice(0, 4)), false);
  assert.equal(paperTablesReady(ready, [expected[0], expected[0]]), false);
  assert.equal(paperTablesReady(ready, [expected[1], expected[0], expected[2], expected[3], expected[4]]), false);
  assert.equal(paperTablesReady(ready, [...expected, "0006_extra.sql"]), false);
});

test("the CircleCI proof workflow runs only for an api event", () => {
  const yaml = readFileSync(new URL("../.circleci/config.yml", import.meta.url), "utf8");
  const workflows = yaml.slice(yaml.indexOf("\nworkflows:"));
  assert.match(workflows, /when: pipeline\.event\.name == "api"/);
  assert.doesNotMatch(workflows, /trigger_source/);
  assert.doesNotMatch(workflows, /== "push"/);
  assert.doesNotMatch(workflows, /\bor\b/);
});

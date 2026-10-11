import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const yaml = readFileSync(new URL("../.github/workflows/atalaya-paper.yml", import.meta.url), "utf8");

test("the paper workflow is manual or scheduled, never a push or pull request", () => {
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /cron: "7,22,37,52 \* \* \* \*"/);
  assert.doesNotMatch(yaml, /pull_request|push:/);
  assert.match(yaml, /contents: read/);
  assert.doesNotMatch(yaml, /vercel|watch-tick|\/api\/bot|\/api\/watch/);
});

test("a schedule cannot reach the database unless the repository variable is armed", () => {
  assert.match(yaml, /SCHEDULE_ARM" != "armed"/);
  assert.match(yaml, /mode=disarmed/);
  assert.match(yaml, /steps\.gate\.outputs\.mode != 'disarmed'/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const yaml = readFileSync(new URL("../.github/workflows/atalaya-paper.yml", import.meta.url), "utf8");

test("paper runs only by manual dispatch and cannot call Vercel or Watch", () => {
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /default: inspect/);
  assert.match(yaml, /github.event_name == 'workflow_dispatch'/);
  assert.match(yaml, /GITHUB_EVENT_NAME\}" != "workflow_dispatch"/);
  assert.doesNotMatch(yaml, /schedule:|pull_request:|^\s*push:/m);
  assert.match(yaml, /contents: read/);
  assert.doesNotMatch(yaml, /vercel|watch-tick|\/api\/bot|\/api\/watch|PAPER_SCHEDULE/);
});

test("the Vercel cron workflow is not part of this branch", () => {
  assert.equal(existsSync(new URL("../.github/workflows/atalaya-paper-tick.yml", import.meta.url)), false);
});

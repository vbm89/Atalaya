import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { inspectTarget } from "./paper-db-inspect.mjs";

const yaml = readFileSync(new URL("../.github/workflows/atalaya-paper.yml", import.meta.url), "utf8");
const url = "postgres://user:secret@example-project.aivencloud.com:5432/paper_empty";

test("inspect accepts only the named Aiven database and ignores no production URL", () => {
  const ok = inspectTarget({
    PAPER_DATABASE_URL: url,
    PAPER_DB_HOST: "example-project.aivencloud.com",
    PAPER_DB_NAME: "paper_empty",
  });
  assert.equal(ok.ok, true);
  assert.equal(inspectTarget({ DATABASE_URL: url, PAPER_DATABASE_URL: url, PAPER_DB_HOST: "example-project.aivencloud.com", PAPER_DB_NAME: "paper_empty" }).ok, false);
  assert.equal(inspectTarget({ PAPER_DATABASE_URL: "postgres://user:secret@ep-prod.neon.tech/app", PAPER_DB_HOST: "ep-prod.neon.tech", PAPER_DB_NAME: "app" }).ok, false);
  assert.equal(inspectTarget({ PAPER_DATABASE_URL: url, PAPER_DB_HOST: "other.aivencloud.com", PAPER_DB_NAME: "paper_empty" }).ok, false);
});

test("the main workflow cannot schedule, migrate, or read DATABASE_URL", () => {
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /PAPER_DATABASE_URL/);
  assert.doesNotMatch(yaml, /schedule:|secrets\.DATABASE_URL|migrate\.mjs|paper-tick|\/api\/watch/);
  assert.equal(existsSync(new URL("../migrations/0001_paper_bot.sql", import.meta.url)), false);
  assert.equal(existsSync(new URL("../.github/workflows/atalaya-paper-tick.yml", import.meta.url)), false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const yaml = readFileSync(new URL("../../../.github/workflows/atalaya-paper-tick.yml", import.meta.url), "utf8");

function step(name: string): string {
  const start = yaml.indexOf(`- name: ${name}`);
  assert.ok(start >= 0, name);
  const next = yaml.indexOf("- name:", start + 1);
  return yaml.slice(start, next < 0 ? undefined : next);
}

describe("Atalaya Paper Tick workflow", () => {
  it("keeps the schedule", () => {
    assert.match(yaml, /cron: "7,22,37,52 \* \* \* \*"/);
  });

  it("watch step: WATCH_SECRET -> /api/watch/tick, unchanged", () => {
    const s = step("Trigger authenticated watch tick on DEV");
    assert.match(s, /WATCH_SECRET: \$\{\{ secrets\.WATCH_SECRET \}\}/);
    assert.match(s, /if \[ -z "\$\{WATCH_SECRET\}" \]/);
    assert.match(s, /--max-time 90/);
    assert.match(s, /Authorization: Bearer \$\{WATCH_SECRET\}/);
    assert.match(s, /"https:\/\/atalaya-dev\.vercel\.app\/api\/watch\/tick"/);
    assert.doesNotMatch(s, /CRON_SECRET|paper\/cron/);
  });

  it("paper step: POST /api/paper/cron with CRON_SECRET and its own guard", () => {
    const s = step("Trigger authenticated paper tick on DEV");
    assert.match(s, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
    assert.match(s, /if \[ -z "\$\{CRON_SECRET\}" \]/);
    assert.match(s, /exit 1/);
    assert.match(s, /--max-time 90 -X POST/);
    assert.match(s, /Authorization: Bearer \$\{CRON_SECRET\}/);
    assert.match(s, /"https:\/\/atalaya-dev\.vercel\.app\/api\/paper\/cron"/);
    assert.doesNotMatch(s, /WATCH_SECRET|\/api\/bot/);
  });

  it("never contains a literal credential, never echoes a secret, only targets DEV", () => {
    assert.doesNotMatch(yaml, /Bearer [A-Za-z0-9]/);
    assert.doesNotMatch(yaml, /echo[^\n]*\$\{(WATCH|CRON)_SECRET\}/);
    assert.doesNotMatch(yaml, /atalaya-nu/);
    assert.doesNotMatch(yaml, /\/api\/bot/);
  });
});

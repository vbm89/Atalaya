import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { handleBotGet, ledgerBehind } from "./bot.ts";

const SECRET = "paper-bot-test-secret";

function req(authorization?: string): Request {
  const headers = authorization === undefined ? undefined : { authorization };
  return new Request("http://local/api/bot", { headers });
}

function blockedDeps() {
  const fail = () => {
    throw new Error("side effect");
  };
  return {
    usesDurableStore: fail,
    readPaperView: fail,
    loadDurableView: async () => fail(),
  };
}

describe("/api/bot auth", { concurrency: false }, () => {
  it("rejects a missing, empty or wrong credential before any tick", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    try {
      for (const header of [undefined, "", "Bearer ", "Bearer wrong", "bearer " + SECRET]) {
        const res = await handleBotGet(req(header), blockedDeps());
        assert.equal(res.status, 401);
        const body = await res.json() as { ok: boolean; error: string };
        assert.equal(body.ok, false);
        assert.equal(body.error, "unauthorized");
        assert.equal(JSON.stringify(body).includes(SECRET), false);
      }
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("rejects every request when the server has no secret", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await handleBotGet(req("Bearer " + SECRET), blockedDeps());
      assert.equal(res.status, 401);
      const body = await res.json() as { error: string };
      assert.equal(body.error, "unauthorized");
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("reads the durable view once when the bearer matches", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    let ticks = 0;
    try {
      const res = await handleBotGet(req("Bearer " + SECRET), {
        usesDurableStore: () => true,
        readPaperView: () => ({ bot: "DETENIDO" }),
        loadDurableView: async () => {
          ticks += 1;
          return { bot: "ACTIVO", storageStatus: "ok" };
        },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { bot: "ACTIVO", storageStatus: "ok" });
      assert.equal(ticks, 1);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("does not echo the secret when the tick fails", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    try {
      const res = await handleBotGet(req("Bearer " + SECRET), {
        usesDurableStore: () => true,
        readPaperView: () => ({ bot: "DETENIDO" }),
        loadDurableView: async () => {
          throw new Error("db " + SECRET);
        },
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.equal(text.includes(SECRET), false);
      assert.match(text, /DETENIDO/);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("GET never runs the paper tick (read-only source)", () => {
    const src = readFileSync(new URL("./bot.ts", import.meta.url), "utf8");
    assert.equal(src.includes("runDurableTick"), false);
    assert.equal(src.includes("bot-paper/tick"), false);
  });

  it("flags a ledger behind the latest closed 15m bar", () => {
    const now = 1_800_000_000; // multiple of 900
    const latest = now - 900;
    assert.equal(ledgerBehind(null, now), true);
    assert.equal(ledgerBehind(latest - 900, now), true);
    assert.equal(ledgerBehind(latest, now), false);
    assert.equal(ledgerBehind(latest, now + 899), false);
    assert.equal(ledgerBehind(latest, now + 900), true);
  });

  it("the scheduled workflow ticks watch + paper cron and never /api/bot", () => {
    const yaml = readFileSync(new URL("../../../.github/workflows/atalaya-paper-tick.yml", import.meta.url), "utf8");
    assert.doesNotMatch(yaml, /\/api\/bot/);
    assert.match(yaml, /\/api\/watch\/tick/);
    assert.match(yaml, /-X POST[\s\S]*\/api\/paper\/cron/);
    assert.match(yaml, /WATCH_SECRET: \$\{\{ secrets\.WATCH_SECRET \}\}/);
    assert.match(yaml, /cron: "7,22,37,52 \* \* \* \*"/);
    assert.match(yaml, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
    assert.match(yaml, /Authorization: Bearer \$\{CRON_SECRET\}/);
    assert.doesNotMatch(yaml, /Bearer [A-Za-z0-9]/);
  });
});

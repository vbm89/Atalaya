import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { handleBotGet } from "./bot.ts";

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

  it("runs the durable view once when the bearer matches", async () => {
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

  it("keeps the scheduled workflow free of a literal credential", () => {
    const yaml = readFileSync(new URL("../../../.github/workflows/atalaya-paper-tick.yml", import.meta.url), "utf8");
    assert.match(yaml, /https:\/\/atalaya-dev\.vercel\.app\/api\/bot/);
    assert.match(yaml, /cron: "7,22,37,52 \* \* \* \*"/);
    assert.doesNotMatch(yaml, /Bearer [A-Za-z0-9]/);
    assert.doesNotMatch(yaml, /CRON_SECRET\s*:/);
  });
});

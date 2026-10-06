import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { handlePaperViewGet } from "./view.ts";

const SECRET = "paper-view-test-secret";

describe("paper view", { concurrency: false }, () => {
  it("returns the stored view without a browser secret", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await handlePaperViewGet({
        read: async () => ({ bot: "DETENIDO", validatedEdge: false, liveTrading: false, assets: [] }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        bot: "DETENIDO",
        validatedEdge: false,
        liveTrading: false,
        assets: [],
      });
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("does not leak a credential when the read fails", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    try {
      const res = await handlePaperViewGet({
        read: async () => {
          throw new Error("select failed " + SECRET);
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

  it("the reader only selects persisted state", () => {
    const src = readFileSync(new URL("./view.ts", import.meta.url), "utf8");
    assert.match(src, /readPaperView/);
    assert.match(src, /readDurableView/);
    assert.doesNotMatch(src, /runDurableTick|loadTape|writeState|appendSignal|appendDecision|insert |update /);
  });

  it("the three screens read /api/paper/view and do not tick /api/bot", () => {
    const files = [
      new URL("../../../components/dashboard/dashboard.tsx", import.meta.url),
      new URL("../../../components/bot-screen.tsx", import.meta.url),
      new URL("../../../components/dashboard/learning-panel.tsx", import.meta.url),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      assert.match(src, /\/api\/paper\/view/);
      assert.doesNotMatch(src, /\/api\/bot/);
      assert.doesNotMatch(src, /CRON_SECRET/);
    }
  });
});

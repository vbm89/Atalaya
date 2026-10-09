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

  it("does not wire the paper screens in this branch", () => {
    // bot-screen and learning-panel stay out until a separate UI change.
    // The current home must not gain a call to the old bot tick.
    const dash = readFileSync(new URL("../../../components/dashboard/dashboard.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(dash, /\/api\/bot/);
    assert.throws(() =>
      readFileSync(new URL("../../../components/bot-screen.tsx", import.meta.url), "utf8"),
    );
    assert.throws(() =>
      readFileSync(new URL("../../../components/dashboard/learning-panel.tsx", import.meta.url), "utf8"),
    );
  });
});

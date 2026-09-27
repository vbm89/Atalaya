import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { readDurableView, usesDurableStore } from "@/lib/bot-paper/ledger";
import { runDurableTick } from "@/lib/bot-paper/tick";
import { readPaperView } from "@/lib/bot-paper/store";

const BAR_SEC = 15 * 60;
const RETRY_SEC = 15;

function latestClosed(nowSec: number): number {
  return Math.floor(nowSec / BAR_SEC) * BAR_SEC - BAR_SEC;
}

/**
 * Vercel has no resident worker. The durable cron route remains available,
 * but /api/bot also performs a small catch-up tick when the durable ledger is
 * behind the latest closed 15m candle. This makes the PAPER engine self-healing
 * when a cron is delayed/disabled: opening or polling the app cannot leave the
 * dashboard showing yesterday's tape indefinitely.
 */
async function durableView() {
  const sql = await getSql();
  const before = await readDurableView(sql);
  const nowSec = Math.floor(Date.now() / 1000);
  const expected = latestClosed(nowSec);
  const behind = before.lastProcessedBar == null || before.lastProcessedBar < expected;
  const retryDue = before.lastCycleAt == null || nowSec - before.lastCycleAt >= RETRY_SEC;

  if (behind && retryDue) {
    await runDurableTick(nowSec);
  }

  return readDurableView(sql);
}

export const Route = createFileRoute("/api/bot")({
  server: {
    handlers: {
      GET: async () => {
        if (!usesDurableStore()) return Response.json(readPaperView());
        try {
          return Response.json(await durableView());
        } catch (error) {
          const message = error instanceof Error ? error.message : "error";
          return Response.json({ ...readPaperView(), storageStatus: "error", bot: "DETENIDO", error: message }, { status: 200 });
        }
      },
    },
  },
});

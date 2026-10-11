import { createFileRoute } from "@tanstack/react-router";
import { cronAuthorized } from "../../lib/bot-paper/cron-auth.ts";
import { usesDurableStore } from "../../lib/bot-paper/ledger.ts";
import { readPaperView } from "../../lib/bot-paper/store.ts";

const BAR_SEC = 15 * 60;
const RETRY_SEC = 15;

function latestClosed(nowSec: number): number {
  return Math.floor(nowSec / BAR_SEC) * BAR_SEC - BAR_SEC;
}

/**
 * Catch-up of one closed 15m bar. Only the authenticated handler may call this.
 * It reads the ledger and, when that bar is still missing, runs one paper tick.
 */
async function durableView() {
  const { getSql } = await import("../../lib/db.ts");
  const { readDurableView } = await import("../../lib/bot-paper/ledger.ts");
  const { runDurableTick } = await import("../../lib/bot-paper/tick.ts");
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

type BotDeps = {
  usesDurableStore: () => boolean;
  readPaperView: () => object;
  loadDurableView: () => Promise<object>;
};

const defaultDeps: BotDeps = {
  usesDurableStore,
  readPaperView,
  loadDurableView: durableView,
};

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "error";
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && message.includes(secret)) return "error";
  return message;
}

/** Paper catch-up. Rejects before any ledger read, market fetch or tick. */
export async function handleBotGet(request: Request, deps: BotDeps = defaultDeps): Promise<Response> {
  if (!cronAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!deps.usesDurableStore()) return Response.json(deps.readPaperView());
  try {
    return Response.json(await deps.loadDurableView());
  } catch (error) {
    return Response.json(
      { ...deps.readPaperView(), storageStatus: "error", bot: "DETENIDO", error: publicError(error) },
      { status: 200 },
    );
  }
}

export const Route = createFileRoute("/api/bot")({
  server: {
    handlers: {
      GET: ({ request }) => handleBotGet(request),
    },
  },
});

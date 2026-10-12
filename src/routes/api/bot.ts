import { createFileRoute } from "@tanstack/react-router";
import { cronAuthorized } from "../../lib/bot-paper/cron-auth.ts";
import { usesDurableStore } from "../../lib/bot-paper/ledger.ts";
import { readPaperView } from "../../lib/bot-paper/store.ts";

const BAR_SEC = 15 * 60;

function latestClosed(nowSec: number): number {
  return Math.floor(nowSec / BAR_SEC) * BAR_SEC - BAR_SEC;
}

/** True when the ledger has not processed the latest closed 15m bar. */
export function ledgerBehind(lastProcessedBar: number | null | undefined, nowSec: number): boolean {
  return lastProcessedBar == null || lastProcessedBar < latestClosed(nowSec);
}

/**
 * Read-only view of the durable ledger. No market fetch, no tick, no write:
 * a stale ledger is only reported (`ledgerBehind: true`). The paper tick runs
 * from the scheduled POST /api/paper/cron.
 */
async function durableView() {
  const { getSql } = await import("../../lib/db.ts");
  const { readDurableView } = await import("../../lib/bot-paper/ledger.ts");
  const view = await readDurableView(await getSql());
  return { ...view, ledgerBehind: ledgerBehind(view.lastProcessedBar, Math.floor(Date.now() / 1000)) };
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

/** Paper ledger read. Rejects before any ledger read; never runs a tick. */
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

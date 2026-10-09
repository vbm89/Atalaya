import { createFileRoute } from "@tanstack/react-router";
import { usesDurableStore } from "../../../lib/bot-paper/ledger.ts";
import { readPaperView } from "../../../lib/bot-paper/store.ts";

/**
 * Read the paper book already on disk or in Postgres.
 * No market fetch, no tick, no ledger write. The browser calls this without CRON_SECRET.
 */
async function readPersistedPaper(): Promise<object> {
  if (!usesDurableStore()) return readPaperView();
  const { getSql } = await import("../../../lib/db.ts");
  const { readDurableView } = await import("../../../lib/bot-paper/ledger.ts");
  return readDurableView(await getSql());
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "error";
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && message.includes(secret)) return "error";
  return message;
}

export async function handlePaperViewGet(
  deps: { read: () => Promise<object> } = { read: readPersistedPaper },
): Promise<Response> {
  try {
    return Response.json(await deps.read());
  } catch (error) {
    return Response.json({ storageStatus: "error", bot: "DETENIDO", error: publicError(error) }, { status: 200 });
  }
}

export const Route = createFileRoute("/api/paper/view")({
  server: {
    handlers: {
      GET: () => handlePaperViewGet(),
    },
  },
});

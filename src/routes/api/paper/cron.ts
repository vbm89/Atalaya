import { createFileRoute } from "@tanstack/react-router";
import { cronAuthorized } from "@/lib/bot-paper/cron-auth";
import { runDurableTick } from "@/lib/bot-paper/tick";

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const { report, view } = await runDurableTick();
    return Response.json({
      ok: true,
      expected: report.expected,
      decisions: report.decisions,
      signalsNew: report.signalsNew,
      duplicates: report.duplicates,
      waited: report.waited,
      processed: report.processed,
      bot: view.bot,
      storageStatus: view.storageStatus,
      assets: view.assets.map((row) => ({
        asset: row.asset,
        status: row.status,
        action: row.action,
        provider: row.provider,
        price: row.price,
        lastBarT: row.lastBarT,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/paper/cron")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});

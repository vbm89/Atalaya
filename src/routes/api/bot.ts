import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { readDurableView, usesDurableStore } from "@/lib/bot-paper/ledger";
import { readPaperView } from "@/lib/bot-paper/store";

export const Route = createFileRoute("/api/bot")({
  server: {
    handlers: {
      GET: async () => {
        if (!usesDurableStore()) return Response.json(readPaperView());
        try {
          return Response.json(await readDurableView(await getSql()));
        } catch (error) {
          const message = error instanceof Error ? error.message : "error";
          return Response.json({ ...readPaperView(), storageStatus: "error", bot: "DETENIDO", error: message }, { status: 200 });
        }
      },
    },
  },
});

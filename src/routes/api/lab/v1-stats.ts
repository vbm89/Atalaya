import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lab/v1-stats")({
  server: {
    handlers: {
      GET: async () => {
        const { getSql } = await import("@/lib/db");
        const { readV1PeriodStats } = await import("@/lib/watch/v1-period-stats");
        return Response.json(await readV1PeriodStats(await getSql()));
      },
    },
  },
});

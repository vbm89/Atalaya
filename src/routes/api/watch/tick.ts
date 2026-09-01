import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/watch/tick")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleWatchTick } = await import("@/lib/watch/http");
        return handleWatchTick(request);
      },
      POST: async ({ request }) => {
        const { handleWatchTick } = await import("@/lib/watch/http");
        return handleWatchTick(request);
      },
    },
  },
});

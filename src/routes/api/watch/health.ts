import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/watch/health")({
  server: {
    handlers: {
      GET: async () => {
        const { handleWatchHealth } = await import("@/lib/watch/http");
        return handleWatchHealth();
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/learn/shadow-replay")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleShadowReplay } = await import("@/lib/learn/shadow-replay-http");
        return handleShadowReplay(request);
      },
      POST: async ({ request }) => {
        const { handleShadowReplay } = await import("@/lib/learn/shadow-replay-http");
        return handleShadowReplay(request);
      },
    },
  },
});

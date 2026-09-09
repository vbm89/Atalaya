import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/shadow/radar")({
  server: {
    handlers: {
      GET: async () => {
        const { getShadowRadar } = await import("@/lib/learn/shadow-radar.fn");
        const payload = await getShadowRadar();
        return Response.json(payload, {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});

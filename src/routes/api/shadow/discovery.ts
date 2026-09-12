import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/shadow/discovery")({
  server: {
    handlers: {
      GET: async () => {
        const { getShadowDiscovery } = await import("@/lib/learn/shadow-discovery.fn");
        const payload = await getShadowDiscovery();
        return Response.json(payload, { headers: { "cache-control": "no-store" } });
      },
      POST: async ({ request }) => {
        const { handleDiscoveryWrite } = await import("@/lib/learn/shadow-discovery-http");
        return handleDiscoveryWrite(request);
      },
    },
  },
});

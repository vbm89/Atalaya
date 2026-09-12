import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/shadow/discovery-explore")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ error: "Method not allowed." }, { status: 405, headers: { "cache-control": "no-store" } }),
      POST: async ({ request }) => {
        const { handleDiscoveryExplore } = await import("@/lib/learn/shadow-discovery-http");
        return handleDiscoveryExplore(request);
      },
    },
  },
});

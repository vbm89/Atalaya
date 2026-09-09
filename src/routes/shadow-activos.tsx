import { createFileRoute } from "@tanstack/react-router";
import { QueryProvider } from "@/components/query-provider";
import { ShadowAssetRankingPanel } from "@/components/dashboard/shadow-asset-ranking-panel";

export const Route = createFileRoute("/shadow-activos")({ component: ShadowAssetsPage });

function ShadowAssetsPage() {
  return (
    <QueryProvider>
      <main className="mx-auto min-h-screen max-w-2xl px-4 py-6">
        <ShadowAssetRankingPanel />
      </main>
    </QueryProvider>
  );
}

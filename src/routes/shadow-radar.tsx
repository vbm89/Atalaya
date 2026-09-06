import { createFileRoute } from "@tanstack/react-router";
import { QueryProvider } from "@/components/query-provider";
import { ShadowRadarPanel } from "@/components/dashboard/shadow-radar-panel";

export const Route = createFileRoute("/shadow-radar")({ component: ShadowRadarPage });

function ShadowRadarPage() {
  return (
    <QueryProvider>
      <main className="mx-auto min-h-screen max-w-2xl px-4 py-6">
        <div className="mb-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-cyan">ATALAYA · SHADOW V2</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Radar de investigación</h1>
          <p className="mt-1 text-sm text-subtle">Laboratorio descriptivo. No genera señales ni modifica V1.</p>
        </div>
        <ShadowRadarPanel />
      </main>
    </QueryProvider>
  );
}

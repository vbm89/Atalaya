import { useQuery } from "@tanstack/react-query";
import { getShadowDiscovery } from "@/lib/learn/shadow-discovery.fn";
import { LAB_UNAVAILABLE } from "@/lib/watch/lab-integrity";

export function ShadowDiscoveryPanel() {
  const q = useQuery({ queryKey: ["shadow-discovery"], queryFn: () => getShadowDiscovery(), staleTime: 60_000, retry: 0 });
  const payload = q.data;
  const report = payload && "report" in payload ? payload.report : null;
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]" data-shadow-discovery>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Pattern Discovery</h3>
          <span className="text-xs font-mono text-subtle">EXPLORE · no live · k no incrementa</span>
        </div>
        <p className="mt-1 text-xs text-subtle">
          Laboratorio de primitivas causales. K1 es un expediente aparte. No hay patrón ganador. TEST de K1 excluido.
        </p>
      </div>
      {q.isLoading ? <p className="px-4 py-4 text-sm text-subtle">Leyendo cobertura…</p> : null}
      {q.isError || payload?.ok === false ? (
        <p className="px-4 py-4 text-sm text-subtle">Discovery no disponible. No se inventan datos.</p>
      ) : null}
      {report ? (
        <div className="divide-y divide-border">
          <div className="px-4 py-3 text-[11px] text-subtle">
            Ingestado ahora: {"ingested" in payload! ? String(payload.ingested) : LAB_UNAVAILABLE}
            {" · "}archivo {payload && "fromStore" in payload && payload.fromStore ? "persistido" : "feed / vacío"}
          </div>
          <div className="px-4 py-3">
            <h4 className="text-sm font-medium">Cobertura</h4>
            <p className="mt-1 text-[11px] text-subtle">Cada activo se lista por separado. 1M/5M = solo reciente.</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-[11px]">
                <thead className="text-subtle">
                  <tr>
                    <th className="py-1 pr-2">Activo</th>
                    <th className="py-1 pr-2">TF</th>
                    <th className="py-1 pr-2">Velas</th>
                    <th className="py-1 pr-2">Días</th>
                    <th className="py-1 pr-2">Gaps</th>
                    <th className="py-1 pr-2">Uso</th>
                    <th className="py-1">Fuente</th>
                  </tr>
                </thead>
                <tbody>
                  {report.coverage.filter((r) => r.bars > 0 || r.tf === "15m" || r.tf === "1h" || r.tf === "4h" || r.tf === "30m").map((r) => (
                    <tr key={`${r.assetId}-${r.tf}`} className="border-t border-border/60">
                      <td className="py-1 pr-2 font-medium">{r.assetId}</td>
                      <td className="py-1 pr-2 font-mono">{r.tf}</td>
                      <td className="py-1 pr-2 font-mono">{r.bars}</td>
                      <td className="py-1 pr-2 font-mono">{r.days == null ? "—" : r.days.toFixed(1)}</td>
                      <td className="py-1 pr-2 font-mono">{r.gaps}</td>
                      <td className="py-1 pr-2">{r.use}</td>
                      <td className="py-1 truncate max-w-[8rem]">{r.source ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="px-4 py-3">
            <h4 className="text-sm font-medium">Eventos (alfabético, no por R)</h4>
            {report.eventCounts.length === 0 ? (
              <p className="mt-1 text-xs text-subtle">Aún no hay eventos. Hace falta cinta persistida.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[11px]">
                {report.eventCounts.map((e) => (
                  <li key={e.kind} className="flex justify-between gap-3">
                    <span className="font-mono">{e.kind}</span>
                    <span className="font-mono tabular">{e.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-4 py-3">
            <h4 className="text-sm font-medium">Familias (gramática fija)</h4>
            {report.sequenceCounts.length === 0 ? (
              <p className="mt-1 text-xs text-subtle">Sin secuencias todavía.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[11px]">
                {report.sequenceCounts.map((s) => (
                  <li key={s.family} className="flex justify-between gap-3">
                    <span className="font-mono">{s.family}</span>
                    <span className="font-mono tabular">{s.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-4 py-3">
            <h4 className="text-sm font-medium">MTF</h4>
            <ul className="mt-2 space-y-1 text-[11px] text-subtle">
              {report.mtfAvailable.map((m) => (
                <li key={`${m.from}-${m.to}`}>
                  {m.from} → {m.to}: {m.ok ? m.reason : `no disponible · ${m.reason}`}
                </li>
              ))}
            </ul>
          </div>
          <p className="px-4 py-3 text-[11px] leading-relaxed text-subtle">
            Diario: {report.journal.notes} Costes UNKNOWN. No se registra K2. V1 intocable.
          </p>
        </div>
      ) : null}
    </div>
  );
}

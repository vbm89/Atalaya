import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getShadowDiscovery, updateShadowDiscoveryCoverage } from "@/lib/learn/shadow-discovery.fn";
import { LAB_UNAVAILABLE } from "@/lib/watch/lab-integrity";

function stamp(iso: string | null | undefined): string {
  if (!iso) return LAB_UNAVAILABLE;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return LAB_UNAVAILABLE;
  return new Date(t).toLocaleString("es-ES");
}

export function ShadowDiscoveryPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shadow-discovery"], queryFn: () => getShadowDiscovery(), staleTime: 60_000, retry: 0 });
  const update = useMutation({
    mutationFn: () => updateShadowDiscoveryCoverage(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shadow-discovery"] });
    },
  });
  const payload = q.data;
  const report = payload && "report" in payload ? payload.report : null;
  const ingest = update.data && "ok" in update.data && update.data.ok === true ? update.data : null;
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]" data-shadow-discovery>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Pattern Discovery</h3>
          <span className="text-xs font-mono text-subtle">UNIVERSO · sin ranking · k no incrementa</span>
        </div>
        <p className="mt-1 text-xs text-subtle">
          EXPLORE / INSUFFICIENT. descriptivo, no validación. K1 y V1 intactos.
        </p>
      </div>
      {q.isLoading ? <p className="px-4 py-4 text-sm text-subtle">Leyendo cobertura…</p> : null}
      {q.isError || payload?.ok === false ? (
        <p className="px-4 py-4 text-sm text-subtle">Discovery no disponible. No se inventan datos.</p>
      ) : null}
      {report ? (
        <div className="divide-y divide-border">
          <div className="px-4 py-3 text-[11px] leading-relaxed text-subtle">
            {(() => {
              const c15 = report.universes?.common4.find((c) => c.tf === "15m");
              const deep = (report.universes?.assetDeep ?? []).filter((d) => d.tf === "15m");
              const days = c15?.days == null ? "—" : `${c15.days.toFixed(1)}d`;
              const n = c15?.n == null ? "—" : String(c15.n);
              const limit = c15?.limitingAssets.length ? c15.limitingAssets.join(", ") : "—";
              const deepTxt = deep.length
                ? deep.map((d) => `${d.assetId} +${d.extraDays == null ? d.extraBars : d.extraDays.toFixed(0)}d`).join(" · ")
                : "ninguno";
              return (
                <>
                  <p>
                    COMMON_4 15m: {c15?.available ? days : "no disponible"} · n={n} · limitan {limit}
                  </p>
                  <p className="mt-1">ASSET_DEEP 15m: {deepTxt}</p>
                  <p className="mt-1 font-medium text-fg">EXPLORE / INSUFFICIENT · descriptivo, no validación</p>
                </>
              );
            })()}
          </div>
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium">Cobertura actual</h4>
                <p className="mt-1 text-[11px] text-subtle">Solo lectura de Neon. Abrir el laboratorio no descarga ni escribe.</p>
              </div>
              <button
                type="button"
                data-discovery-update-coverage
                className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium shadow-[var(--shadow-border)] disabled:opacity-50"
                disabled={update.isPending}
                onClick={() => update.mutate()}
              >
                🔄 Actualizar cobertura
              </button>
            </div>
            <p className="text-[11px] text-subtle">
              Última actualización: {stamp(ingest && "lastUpdatedAt" in ingest ? ingest.lastUpdatedAt : payload && "lastUpdatedAt" in payload ? payload.lastUpdatedAt : null)}
            </p>
            {update.isPending ? <p className="text-[11px] font-medium text-fg">Actualización en curso…</p> : null}
            {update.isError || (update.data && update.data.ok === false) ? (
              <p className="text-[11px] text-subtle">Actualización no disponible. No se inventan datos.</p>
            ) : null}
            {ingest ? (
              <div className="text-[11px] text-subtle">
                <p>TF procesado: {ingest.ingestMode === "tip" ? "cobertura común completa" : ingest.backfillTf ?? LAB_UNAVAILABLE}</p>
                <p className="mt-0.5">
                  activos procesados: {ingest.assetsProcessed == null ? LAB_UNAVAILABLE : String(ingest.assetsProcessed)}
                </p>
                <p className="mt-0.5">
                  {ingest.ingested > 0 ? `nuevas velas añadidas: ${ingest.ingested}` : "Sin datos nuevos"}
                </p>
              </div>
            ) : null}
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
                    <th className="py-1 pr-2">Fuente</th>
                    <th className="py-1 pr-2">Instrumento</th>
                    <th className="py-1 pr-2">First</th>
                    <th className="py-1 pr-2">Last</th>
                    <th className="py-1 pr-2">Velas</th>
                    <th className="py-1 pr-2">Días</th>
                    <th className="py-1 pr-2">Mkt</th>
                    <th className="py-1 pr-2">Gaps</th>
                    <th className="py-1 pr-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.coverage.filter((r) => r.bars > 0 || r.tf === "15m" || r.tf === "1h" || r.tf === "4h" || r.tf === "30m").map((r) => (
                    <tr key={`${r.assetId}-${r.tf}`} className="border-t border-border/60">
                      <td className="py-1 pr-2 font-medium">{r.assetId}</td>
                      <td className="py-1 pr-2 font-mono">{r.tf}</td>
                      <td className="py-1 pr-2 truncate max-w-[7rem]">{r.source ?? "—"}</td>
                      <td className="py-1 pr-2 font-mono">{r.instrument ?? "—"}</td>
                      <td className="py-1 pr-2 font-mono whitespace-nowrap">{r.firstIso ? r.firstIso.slice(0, 16) : "—"}</td>
                      <td className="py-1 pr-2 font-mono whitespace-nowrap">{r.lastIso ? r.lastIso.slice(0, 16) : "—"}</td>
                      <td className="py-1 pr-2 font-mono">{r.bars}</td>
                      <td className="py-1 pr-2 font-mono">{r.days == null ? "—" : r.days.toFixed(1)}</td>
                      <td className="py-1 pr-2 font-mono">{r.marketDays}</td>
                      <td className="py-1 pr-2 font-mono">{r.gaps}</td>
                      <td className="py-1 pr-2 font-mono font-semibold">{r.discoveryStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="px-4 py-3 text-[11px] leading-relaxed text-subtle">
            {report.journal.notes} A=histórico, B=útil limitado, C=reciente, D=insuficiente. Activos no se mezclan.
          </p>
        </div>
      ) : null}
    </div>
  );
}

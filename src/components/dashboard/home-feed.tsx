import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { AnalysisSnapshot, AssetAnalysis, SetupState } from "@/lib/trading/types";
import { cn, formatPrice } from "@/lib/utils";
import { displayEntryPrice } from "@/lib/chart/labels";
import { DataLampChip } from "./data-lamp";
import { formatCountdown, formatMadridClock } from "@/lib/watch/clock";
import { nextWatchEvalMs } from "@/lib/watch/schedule";
import { watchLamp, worstDataLamp, watchGlyph, type WatchLampSnap } from "@/lib/watch/feed-lamp";
import { AssetMark } from "./marks";

export function greetingFor(now: Date | null): string {
  if (!now) return "Hola";
  const h = now.getHours();
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function useLocalNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function BestOpportunityCard({
  snapshot,
  asset,
  onDetail,
}: {
  snapshot: AnalysisSnapshot;
  asset: AssetAnalysis | null;
  onDetail: () => void;
}) {
  const setup = asset?.setup ?? null;
  const state: SetupState = asset?.setupState ?? "wait";
  const isEntry = state === "entry" && setup != null;

  return (
    <section
      className="atalaya-best atalaya-markets-span"
      data-best-opportunity={snapshot.bestOpportunityId ?? "none"}
    >
      <p className="text-base font-semibold tracking-tight">Oportunidades</p>
      {!isEntry || !setup || !asset ? (
        <div className="atalaya-empty mt-3">
          <p className="text-sm font-medium">Sin entradas activas</p>
          <p className="mt-1 text-sm leading-snug text-subtle">
            {snapshot.bestOpportunityNote || "Atalaya está vigilando el mercado."}
          </p>
        </div>
      ) : (
        <button type="button" onClick={onDetail} className="atalaya-opp-row mt-3">
          <AssetMark id={asset.id} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-semibold">{asset.label}</p>
              <span className={setup.direction === "buy" ? "text-xs font-semibold text-buy" : "text-xs font-semibold text-sell"}>
                {setup.direction === "buy" ? "BUY ↗" : "SELL ↘"}
              </span>
              <span className="atalaya-badge atalaya-badge-entry">ENTRY</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-left">
              <div>
                <dt className="text-[10px] tracking-wide text-subtle uppercase">Precio</dt>
                <dd className="font-mono text-sm tabular" data-entry-px>
                  {formatPrice(displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high), asset.digits)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] tracking-wide text-subtle uppercase">SL</dt>
                <dd className="font-mono text-sm tabular text-sell">{formatPrice(setup.stopLoss, asset.digits)}</dd>
              </div>
              <div>
                <dt className="text-[10px] tracking-wide text-subtle uppercase">TP1</dt>
                <dd className="font-mono text-sm tabular text-buy">{formatPrice(setup.takeProfit1, asset.digits)}</dd>
              </div>
            </dl>
          </div>
          <ChevronRight className="size-4 shrink-0 text-subtle" />
        </button>
      )}
      {isEntry ? (
        <p className="mt-2 text-center text-xs text-subtle">Sin más entradas activas</p>
      ) : null}
    </section>
  );
}

export function FeedStatus({
  assets,
  lastEvalMs,
  visible,
  watching,
  server,
}: {
  assets: AssetAnalysis[];
  lastEvalMs: number | null;
  visible: boolean;
  watching: boolean;
  server: (WatchLampSnap & { lastEvalMs?: number | null; nextEvalMs?: number | null }) | null;
}) {
  const now = useLocalNow();
  const nextMs = now
    ? server && !server.stale
      ? server.nextEvalMs ?? nextWatchEvalMs(now.getTime())
      : nextWatchEvalMs(now.getTime())
    : null;
  const remain = now && nextMs ? nextMs - now.getTime() : null;
  const nowMs = now?.getTime() ?? Date.now();
  const data = worstDataLamp(
    assets.map((a) => ({
      dataStatus: a.dataStatus,
      dataStatusLabel: a.dataStatusLabel,
      lastDataAt: a.lastDataAt,
      price: a.id === "XAUUSD" ? a.priceSpot : a.price,
    })),
  );
  const watch = watchLamp(
    {
      lastStatus: server?.lastStatus,
      lastOkMs: server?.lastOkMs,
      stale: server?.stale ?? true,
      watchSecretConfigured: server?.watchSecretConfigured ?? false,
    },
    nowMs,
  );
  const entries = assets.filter((a) => a.setupState === "entry").length;
  const operativo = watch.lamp === "ok" && data.lamp === "ok";

  return (
    <section className="atalaya-markets-span" data-watch-status={watching ? "active" : visible ? "busy" : "background"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-subtle">{greetingFor(now)}</p>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight">Mercado en vigilancia</h2>
          <p className="mt-1 text-sm text-subtle">
            {assets.length} activos · {entries ? "Oportunidad detectada" : "Buscando oportunidades"}
          </p>
        </div>
        <div className="atalaya-count-chip">
          <p className="text-2xl font-semibold tabular leading-none text-buy">{entries}</p>
          <p className="mt-1 max-w-[4.8rem] text-[10px] leading-tight tracking-wide text-buy uppercase">
            {entries === 1 ? "oportunidad activa" : "oportunidades activas"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "atalaya-status-dot",
            !operativo && (watch.lamp === "error" || data.lamp === "unavailable" ? "is-bad" : "is-warn"),
          )}
        />
        <p className="text-[11px] font-medium tracking-wider uppercase">
          {operativo ? "Sistema operativo" : watch.label}
        </p>
        <DataLampChip lamp={data.lamp} label={data.label} note={data.note} />
        <DataLampChip lamp={watch.lamp} label={watch.label} />
      </div>
      <p className="sr-only" data-watch-eval>
        {visible ? (watching ? "Tiempo real · cierre 15M" : "Evaluando…") : "Segundo plano · no vigila"}
        {entries ? ` · ${entries} ENTRADA` : ""}
        {" · "}
        <span data-last-eval>{lastEvalMs ? formatMadridClock(lastEvalMs) : "—"}</span>
        {" · "}
        <span data-countdown>{visible && remain != null ? formatCountdown(remain) : "—"}</span>
      </p>
      <p className="sr-only" data-watch-server>
        Último tick{" "}
        <span data-server-tick>
          {server?.lastEvalMs ? formatMadridClock(server.lastEvalMs) : "sin tick"}
        </span>
        {" · "}
        <span data-server-status>{watchGlyph(watch.lamp)}</span>
      </p>
      {server && !server.watchSecretConfigured ? (
        <p className="mt-1 text-xs text-wait" data-watch-secret-missing>
          Vigilancia 24/7: falta el secreto del servidor.
        </p>
      ) : server?.stale ? (
        <p className="mt-1 text-xs text-wait" data-watch-stale>
          Vigilancia del servidor retrasada (más de 20 min).
        </p>
      ) : null}
    </section>
  );
}

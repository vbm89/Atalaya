import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { AnalysisSnapshot, AssetAnalysis, SetupQuality, SetupState } from "@/lib/trading/types";
import { formatPrice } from "@/lib/utils";
import { displayEntryPrice } from "@/lib/chart/labels";
import { setupStateEs } from "@/lib/watch/memory";
import { DataLampChip } from "./data-lamp";
import { formatCountdown, formatMadridClock } from "@/lib/watch/clock";
import { nextWatchEvalMs } from "@/lib/watch/schedule";
import { watchLamp, worstDataLamp, watchGlyph, type WatchLampSnap } from "@/lib/watch/feed-lamp";

function qualityFill(q: SetupQuality): number {
  if (q === "alta") return 5;
  if (q === "media") return 3;
  return 1;
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
  const has = snapshot.bestOpportunityId != null && setup != null && state !== "wait";

  return (
    <section
      className="atalaya-best rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]"
      data-best-opportunity={snapshot.bestOpportunityId ?? "none"}
    >
      <p className="text-xs font-medium tracking-wider text-muted uppercase">Mejor oportunidad ahora</p>
      {!has || !asset || !setup ? (
        <p className="mt-2 text-sm leading-snug text-wait">{snapshot.bestOpportunityNote}</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="text-xl font-semibold tracking-tight">{asset.label}</p>
            <p
              className={
                state === "entry" ? "text-sm font-medium text-buy" : state === "map" ? "text-sm font-medium text-map" : "text-sm font-medium text-wait"
              }
            >
              {setupStateEs(state)}
            </p>
          </div>
          <p className={setup.direction === "buy" ? "mt-1 text-sm font-medium text-buy" : "mt-1 text-sm font-medium text-sell"}>
            {setup.direction === "buy" ? "COMPRA" : "VENTA"}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
            <div className="col-span-3">
              <dt className="text-xs text-subtle">ENTRADA</dt>
              <dd className="font-mono tabular" data-entry-px>
                {formatPrice(displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high), asset.digits)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">SL</dt>
              <dd className="font-mono tabular">{formatPrice(setup.stopLoss, asset.digits)}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">TP1</dt>
              <dd className="font-mono tabular">{formatPrice(setup.takeProfit1, asset.digits)}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">TP2</dt>
              <dd className="font-mono tabular">
                {setup.takeProfit2 != null ? formatPrice(setup.takeProfit2, asset.digits) : "n/d"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">R:R</dt>
              <dd className="font-mono tabular">1:{setup.riskReward.toFixed(1).replace(".", ",")}</dd>
            </div>
            <div className="col-span-3">
              <dt className="text-xs text-subtle">Calidad {setup.quality}</dt>
              <dd className="mt-1 flex gap-1" aria-label={`calidad ${setup.quality}`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < qualityFill(setup.quality)
                        ? "h-1.5 flex-1 rounded-full bg-buy"
                        : "h-1.5 flex-1 rounded-full bg-border"
                    }
                  />
                ))}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={onDetail}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-[var(--radius-md)] bg-buy px-3 text-sm font-medium text-accent-fg"
          >
            VER DETALLE
            <ChevronRight className="size-4" />
          </button>
        </>
      )}
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

  return (
    <section data-watch-status={watching ? "active" : visible ? "busy" : "background"}>
      <div className="flex flex-wrap items-center gap-2">
        <DataLampChip lamp={data.lamp} label={data.label} note={data.note} />
        <DataLampChip lamp={watch.lamp} label={watch.label} />
      </div>
      <p className="mt-2 font-mono text-xs tabular text-subtle" data-watch-eval>
        {visible ? (watching ? "Tiempo real · cierre 15M" : "Evaluando…") : "Segundo plano · no vigila"}
        {entries ? ` · ${entries} ENTRADA` : ""}
        {" · "}
        <span data-last-eval>{lastEvalMs ? formatMadridClock(lastEvalMs) : "—"}</span>
        {" · "}
        <span data-countdown>{visible && remain != null ? formatCountdown(remain) : "—"}</span>
      </p>
      <p className="mt-0.5 font-mono text-xs tabular text-subtle" data-watch-server>
        Servidor{" "}
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

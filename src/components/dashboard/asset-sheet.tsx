import { useEffect } from "react";
import { X } from "lucide-react";
import { formatDateTime, formatPct, formatPrice, formatTime, decodeEntities } from "@/lib/utils";
import type { AssetAnalysis, Timeframe, TimeframeAnalysis } from "@/lib/trading/types";
import type { AccountSettings } from "@/lib/trading/risk";
import type { AssetCosts } from "@/lib/trading/costs";
import type { AssetWatch } from "@/lib/watch/memory";
import { assetDataLamp } from "@/lib/watch/feed-lamp";
import { WatchPhaseBadge } from "./signal-badge";
import { SetupPanel } from "./setup-panel";
import { DataLampChip } from "./data-lamp";
import { EpisodeMemory } from "./episode-memory";

export function AssetSheet({
  asset,
  watch,
  open,
  onOpenChange,
  account,
  costs,
  onViewChart,
  onWhy,
  episodeId,
}: {
  asset: AssetAnalysis | null;
  watch?: AssetWatch | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  account: AccountSettings;
  costs?: AssetCosts;
  onViewChart?: () => void;
  onWhy?: () => void;
  episodeId?: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open || !asset) return null;

  return (
    <div
      className="atalaya-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="atalaya-sheet-title"
    >
      <SheetBody
        asset={asset}
        watch={watch ?? null}
        account={account}
        costs={costs}
        onClose={() => onOpenChange(false)}
        onViewChart={onViewChart}
        onWhy={onWhy}
        episodeId={episodeId ?? null}
      />
    </div>
  );
}

function SheetBody({
  asset,
  watch,
  account,
  costs,
  onClose,
  onViewChart,
  onWhy,
  episodeId,
}: {
  asset: AssetAnalysis;
  watch: AssetWatch | null;
  account: AccountSettings;
  costs?: AssetCosts;
  onClose: () => void;
  onViewChart?: () => void;
  onWhy?: () => void;
  episodeId: string | null;
}) {
  const lastAt = asset.lastDataAt ?? asset.marketTime;
  const isXau = asset.id === "XAUUSD";
  const displayPrice = isXau ? asset.priceSpot : asset.price;
  const phase = watch?.phase ?? (asset.setupState === "wait" ? "wait" : "live");
  const dataLamp = assetDataLamp({
    dataStatus: asset.dataStatus,
    dataStatusLabel: asset.dataStatusLabel,
    lastDataAt: asset.lastDataAt,
    price: displayPrice,
  });
  return (
    <>
      <div className="atalaya-sheet-chrome flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="atalaya-sheet-title" className="text-lg font-semibold tracking-tight">
            {asset.label}
          </h2>
          <p className="text-sm text-muted">{asset.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <WatchPhaseBadge phase={phase} signal={asset.signal} />
            <DataLampChip lamp={dataLamp.lamp} label={dataLamp.label} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-elevated text-muted"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div data-sheet-scroll className="atalaya-sheet-scroll">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-3xl font-medium tabular">
              {displayPrice == null ? "—" : formatPrice(displayPrice, asset.digits)}
            </p>
            <p className="mt-1 text-xs font-medium tracking-wider text-muted uppercase">
              Precio de análisis
            </p>
            {isXau ? (
              <p className="mt-1 text-xs font-medium tracking-wider text-subtle uppercase">
                SPOT XAUUSD · no es last T4Trade
              </p>
            ) : (
              <p className="mt-1 text-xs font-medium tracking-wide text-subtle">
                {asset.feedSymbol} · {asset.venue} · PROXY
              </p>
            )}
            <p className="mt-1 text-sm text-muted">
              {asset.dayChangePct == null ? "var. n/d" : formatPct(asset.dayChangePct)}
            </p>
          </div>
        </div>

        {isXau ? (
          <div className="mt-2 space-y-0.5 font-mono text-xs tabular text-muted">
            <p>
              PROXY XAUUSDT:{" "}
              {asset.priceProxy == null
                ? "DATOS NO DISPONIBLES"
                : formatPrice(asset.priceProxy, asset.digits)}
            </p>
            <p>BASIS: {fmtBasis(asset.basis, asset.basisPct, asset.digits)}</p>
          </div>
        ) : null}

        <section className="mt-4">
          <h3 className="text-xs font-medium tracking-wider text-muted uppercase">
            Setup
          </h3>
          <SetupPanel
            asset={asset}
            watch={watch}
            account={account}
            costs={costs}
            onViewChart={onViewChart}
            onWhy={onWhy}
          />
          {episodeId ? (
            <div data-live-journal={episodeId}>
              <EpisodeMemory episodeId={episodeId} />
            </div>
          ) : null}
        </section>

        <p className="mt-4 text-sm leading-snug text-muted">{asset.technicalSummary}</p>

        <section className="mt-5 rounded-[var(--radius-lg)] bg-elevated px-3 py-3">
          <h3 className="text-xs font-medium tracking-wider text-muted uppercase">
            Origen de los datos
          </h3>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Meta
              label="Precio de análisis"
              value={
                displayPrice == null
                  ? "DATOS NO DISPONIBLES"
                  : formatPrice(displayPrice, asset.digits)
              }
            />
            {isXau ? (
              <>
                <Meta label="Fuente precio" value="SPOT" />
                <Meta label="Fuente velas" value="PROXY" />
                <Meta
                  label="Símbolo precio"
                  value={asset.spotSource ?? "XAUUSD"}
                />
                <Meta
                  label="Símbolo velas"
                  value={asset.feedSymbol || "XAUUSDT"}
                />
              </>
            ) : (
              <>
                <Meta label="Fuente" value={asset.venue || asset.dataSource} />
                <Meta label="Símbolo exacto" value={asset.feedSymbol || "—"} />
                <Meta
                  label="Tipo"
                  value={asset.instrumentKind === "proxy" ? "PROXY" : "NATIVO"}
                />
              </>
            )}
            <Meta
              label="Última actualización"
              value={lastAt ? formatDateTime(lastAt) : "DATOS NO DISPONIBLES"}
            />
            <Meta label="Estado" value={asset.dataStatusLabel || "n/d"} />
            <Meta
              label="Velas disponibles"
              value={asset.availableTimeframes.join(" · ") || "ninguna"}
            />
          </dl>
        </section>

        <TfBlock rows={asset.timeframes} />

        <section className="mt-5">
          <h3 className="text-xs font-medium tracking-wider text-muted uppercase">
            Noticias
          </h3>
          {asset.news.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Sin titulares recientes verificables.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {asset.news.slice(0, 5).map((n) => (
                <li key={n.id}>
                  <p className="text-sm leading-snug">{decodeEntities(n.title)}</p>
                  <p className="mt-0.5 text-xs text-subtle">
                    {n.source}
                    {n.publishedAt ? ` · ${formatTime(n.publishedAt)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function TfBlock({ rows }: { rows: TimeframeAnalysis[] }) {
  const order: Timeframe[] = ["5m", "15m", "1h", "4h"];
  return (
    <section className="mt-5">
      <h3 className="text-xs font-medium tracking-wider text-muted uppercase">
        Temporalidades
      </h3>
      <ul className="mt-2 space-y-2">
        {order.map((tf) => {
          const row = rows.find((t) => t.timeframe === tf);
          return (
            <li key={tf} className="rounded-[var(--radius-md)] bg-elevated px-3 py-2">
              <p className="text-sm font-medium">{tf}</p>
              <p className="text-xs text-muted">
                {row?.sufficient ? row.structure : "DATOS NO DISPONIBLES"}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function fmtBasis(
  basis: number | null | undefined,
  pct: number | null | undefined,
  digits: number,
): string {
  if (basis == null) return "DATOS NO DISPONIBLES";
  const p = pct == null ? "" : ` (${formatPct(pct)})`;
  return `${formatPrice(basis, digits)}${p}`;
}

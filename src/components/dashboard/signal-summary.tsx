import type { ReactNode } from "react";
import type { AssetAnalysis } from "@/lib/trading/types";
import { cn, formatPrice } from "@/lib/utils";
import { displayEntryPrice } from "@/lib/chart/labels";
import type { FrozenChartLevels } from "@/lib/chart/setup-overlay";
import { episodeMarketView, marketSessionKind, marketSessionLabel, setupBadgeLabel } from "@/lib/watch/market-session";


function volumeLabel(asset: AssetAnalysis): { text: string; ok: boolean | null } {
  const tf15 = asset.timeframes.find((t) => t.timeframe === "15m");
  const ratio = tf15?.indicators.volumeRatio ?? null;
  const available = tf15?.indicators.volumeAvailable ?? false;
  if (!available || ratio == null) return { text: "No disponible", ok: null };
  return { text: ratio.toFixed(2).replace(".", ","), ok: null };
}

function t2Label(asset: AssetAnalysis): { text: string; tone: string } {
  const missing = asset.setup?.missingForEntry ?? "";
  if (asset.setupState === "entry") return { text: "V1 publicó ENTRADA", tone: "text-buy" };
  if (/cierre 15M de fallo de aceptación o rechazo/.test(missing)) {
    return { text: "Falta trigger 15M", tone: "text-wait" };
  }
  if (asset.setupState === "pending" || asset.setupState === "map") {
    return { text: "No evaluado como evento", tone: "text-subtle" };
  }
  return { text: "No disponible", tone: "text-subtle" };
}

export function SignalSummary({
  asset,
  freeze,
}: {
  asset: AssetAnalysis | null;
  freeze?: FrozenChartLevels | null;
}) {
  const setup = asset?.setup ?? null;
  const state = freeze?.state ?? asset?.setupState ?? "wait";
  const direction = freeze?.direction ?? setup?.direction;
  const digits = asset?.digits ?? 2;
  const entry =
    freeze?.entry ??
    (setup ? displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high) : null);
  const sl = freeze?.stopLoss ?? setup?.stopLoss ?? null;
  const tp1 = freeze?.takeProfit1 ?? setup?.takeProfit1 ?? null;
  const tp2 = freeze?.takeProfit2 ?? setup?.takeProfit2 ?? null;
  const rr = setup?.riskReward ?? null;
  const vol = asset ? volumeLabel(asset) : { text: "No disponible", ok: null };
  const t2 = asset ? t2Label(asset) : { text: "No disponible", tone: "text-subtle" };
  const structure = asset?.bias4hLabel?.trim() || "No disponible";
  const quality = setup?.quality ?? null;
  const market = asset
    ? episodeMarketView({
        id: asset.id,
        setupState: freeze?.state ?? asset.setupState,
        dataStatus: asset.dataStatus,
      })
    : null;
  const sessionKind = asset ? marketSessionKind({ id: asset.id, dataStatus: asset.dataStatus }) : null;

  return (
    <div className="space-y-3" data-signal-summary data-operable={market?.operable ? "1" : "0"}>
    <dl className="atalaya-summary-grid">
      <Row
        label="Estado"
        value={
          <span
            className={cn(
              "atalaya-badge",
              state === "entry"
                ? "atalaya-badge-entry"
                : state === "pending" && market?.operable
                  ? "atalaya-badge-wait"
                  : state === "map" && market?.operable
                    ? "atalaya-badge-map"
                    : "atalaya-badge-muted",
            )}
          >
            {state === "entry" ? "ENTRY" : state === "pending" ? "PENDING" : setupBadgeLabel(state)}
          </span>
        }
      />
      <Row
        label="Dirección"
        value={
          direction ? (
            <span className={direction === "buy" ? "text-buy" : "text-sell"}>
              {direction === "buy" ? "BUY ↗" : "SELL ↘"}
            </span>
          ) : (
            "—"
          )
        }
      />
      <Row label="Precio entrada" value={entry != null ? formatPrice(entry, digits) : "—"} mono />
      <Row label="R:R" value={rr != null ? rr.toFixed(2).replace(".", ",") : "—"} mono />
      <Row
        label="SL"
        value={sl != null ? formatPrice(sl, digits) : "—"}
        mono
        className="text-sell"
      />
      <Row
        label="Calidad"
        value={
          quality ? (
            <span className={quality === "alta" ? "text-buy" : "text-muted"}>
              {quality === "alta" ? "Alta" : "Media"}
            </span>
          ) : (
            "—"
          )
        }
      />
      <Row
        label="TP1"
        value={tp1 != null ? formatPrice(tp1, digits) : "—"}
        mono
        className="text-buy"
      />
      <Row label="Sesión" value={sessionKind ? marketSessionLabel(sessionKind, true) : "No disponible"} />
      <Row
        label="TP2"
        value={tp2 != null ? formatPrice(tp2, digits) : "n/d"}
        mono
        className={tp2 != null ? "text-buy" : "text-subtle"}
      />
      <Row
        label="Estructura 4H"
        value={
          <span className={structure === "No disponible" ? "text-subtle" : undefined}>{structure}</span>
        }
      />
      <Row label="T2" value={<span className={t2.tone}>{t2.text}</span>} />
      <Row
        label="Volumen"
        value={
          <span
            className={
              vol.ok === true ? "text-buy" : vol.ok === false ? "text-wait" : "text-subtle"
            }
          >
            {vol.text}
          </span>
        }
      />
    </dl>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="atalaya-summary-cell">
      <dt>{label}</dt>
      <dd className={cn(mono && "font-mono tabular", className)}>{value}</dd>
    </div>
  );
}

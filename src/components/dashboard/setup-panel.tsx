import { useState } from "react";
import { ChevronRight, Share2, HelpCircle } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { AssetAnalysis } from "@/lib/trading/types";
import { calculateRisk, specFromDraft, type AccountSettings } from "@/lib/trading/risk";
import { costEstimateLabel, type AssetCosts } from "@/lib/trading/costs";
import { hasChartableSetup } from "@/lib/chart/setup-overlay";
import { distanceUnavailableLabel, setupDistance } from "@/lib/chart/zone-distance";
import type { AssetWatch } from "@/lib/watch/memory";
import { setupStateEs, watchPhaseCaption } from "@/lib/watch/memory";
import { setupShareText } from "@/lib/watch/share-setup";
import { QualityBadge, RiskBadge, WatchPhaseBadge } from "./signal-badge";

export function SetupPanel({
  asset,
  account,
  costs,
  watch,
  onViewChart,
  onWhy,
}: {
  asset: AssetAnalysis;
  account: AccountSettings;
  costs?: AssetCosts;
  watch?: AssetWatch | null;
  onViewChart?: () => void;
  onWhy?: () => void;
}) {
  const setup = asset.setup;
  const phase = watch?.phase ?? (asset.setupState === "wait" ? "wait" : "live");
  const [shareNote, setShareNote] = useState<string | null>(null);

  async function share() {
    const text = setupShareText(asset);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Atalaya", text });
        setShareNote("Ficha compartida. Análisis, no orden.");
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareNote("Texto copiado. Análisis, no orden.");
    } catch {
      setShareNote("No se pudo compartir.");
    }
  }

  if (phase === "expired" && watch?.expiredSetup) {
    const s = watch.expiredSetup;
    const d = asset.digits;
    const dir = s.direction === "buy" ? "COMPRA" : "VENTA";
    const was = watch.expiredFromState ? setupStateEs(watch.expiredFromState) : "setup";
    return (
      <div className="mt-2 space-y-2 rounded-[var(--radius-lg)] bg-wait-dim px-3 py-3" data-setup-kind="expired">
        <WatchPhaseBadge phase="expired" signal="wait" />
        <p className="text-sm font-medium text-wait">{watchPhaseCaption(watch)}</p>
        <p className="text-sm text-muted">
          {dir} · era {was} · zona {formatPrice(s.zone.low, d)} – {formatPrice(s.zone.high, d)}
        </p>
        <p className="text-xs text-subtle" data-zone-distance="unavailable">
          {distanceUnavailableLabel(true)}
        </p>
        <p className="text-sm text-wait">
          {watch.expiredReason ?? asset.waitReason ?? "ESPERAR"}
        </p>
        <p className="text-xs text-subtle">
          Conservada como contexto. El motor ya no la da por válida. No es una entrada
          nueva.
        </p>
        {onViewChart ? (
          <button
            type="button"
            data-ver-grafico={asset.id}
            onClick={onViewChart}
            className="flex h-11 w-full items-center justify-center gap-1 rounded-[var(--radius-md)] bg-elevated text-sm font-medium shadow-[var(--shadow-border)]"
          >
            VER GRÁFICO
            <ChevronRight className="size-4" />
          </button>
        ) : null}
        {onWhy ? <WhyButton onClick={onWhy} /> : null}
        <button
          type="button"
          data-share-setup={asset.id}
          onClick={() => void share()}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-elevated text-sm font-medium shadow-[var(--shadow-border)]"
        >
          <Share2 className="size-4" />
          Compartir
        </button>
        {shareNote ? <p className="text-xs text-subtle">{shareNote}</p> : null}
      </div>
    );
  }

  if (asset.setupState === "wait" || !setup) {
    return (
      <div className="mt-2 space-y-2" data-setup-kind="wait">
        <p className="rounded-[var(--radius-lg)] bg-wait-dim px-3 py-3 text-sm text-wait">
          {asset.waitReason ?? "ESPERAR — no existe oportunidad definida."}
        </p>
        {onWhy ? <WhyButton onClick={onWhy} /> : null}
      </div>
    );
  }

  const d = asset.digits;
  const dir = setup.direction === "buy" ? "COMPRA" : "VENTA";
  const kind = setup.kind === "continuation" ? "A · continuación / retest" : "B · ruptura + retest";
  const slDist = Math.abs(
    (setup.direction === "sell" ? setup.zone.low : setup.zone.high) - setup.stopLoss,
  );
  const spec = specFromDraft(account.contracts[asset.id]);
  const risk = calculateRisk({ capital: account.capital, spec, slDistance: slDist });
  const isEntry = asset.setupState === "entry";
  const isPending = asset.setupState === "pending";
  const tickSize = account.contracts[asset.id]?.tickSize;
  const slTicks = tickSize && tickSize > 0 ? slDist / tickSize : null;
  const costEst =
    costs != null
      ? costEstimateLabel(costs, account.contracts[asset.id]?.tickValue ?? null, slTicks)
      : { calculable: false, text: "NO CALCULABLE" };
  const dist = setupDistance({
    analysisPrice: asset.price,
    frozen: false,
    zoneLow: setup.zone.low,
    zoneHigh: setup.zone.high,
    entry: setup.direction === "sell" ? setup.zone.low : setup.zone.high,
  });

  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WatchPhaseBadge phase="live" signal={asset.signal} />
        <QualityBadge quality={setup.quality} />
      </div>

      {isPending ? (
        <p className="text-sm font-medium text-wait">TRIGGER PENDIENTE — vigente, no es orden</p>
      ) : isEntry ? (
        <p className="text-sm font-medium">ENTRADA vigente. Análisis, no orden.</p>
      ) : (
        <p className="text-sm font-medium text-map">MAPA — vigente, no es orden</p>
      )}

      {watch?.transition ? (
        <p className="text-xs text-subtle">Cambio: {watch.transition}</p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Item label="Activo" value={asset.label} />
        <Item label="Dirección" value={dir} />
        <Item label="Tipo" value={kind} wide />
        <Item
          label="Calidad del setup"
          value={`${setup.quality.toUpperCase()} · ${setup.qualityPhase}`}
          wide
        />
        <Item
          label="Zona"
          value={`${formatPrice(setup.zone.low, d)} – ${formatPrice(setup.zone.high, d)}`}
          wide
        />
        {isEntry ? <Item label="Entrada" value={setup.entryLabel} wide /> : null}
        <Item label="Invalidación" value={formatPrice(setup.invalidation, d)} />
        <Item
          label={isEntry ? "Stop loss" : "SL teórico"}
          value={formatPrice(setup.stopLoss, d)}
        />
        <Item label="TP1" value={formatPrice(setup.takeProfit1, d)} />
        <Item
          label="TP2"
          value={setup.takeProfit2 != null ? formatPrice(setup.takeProfit2, d) : "n/d"}
        />
        <Item label="R:R teórico V1" value={`1 : ${setup.riskReward.toFixed(1)}`} />
      </dl>

      <p className="text-xs leading-relaxed text-subtle" data-zone-distance data-distance-source={dist?.source ?? "none"}>
        {dist ? dist.label : distanceUnavailableLabel(false)}
      </p>

      <p className="text-xs leading-relaxed text-subtle" data-cost-estimate>
        Coste estimado: {costEst.text}
      </p>

      {setup.missingForEntry ? (
        <p className="text-sm text-muted">{setup.missingForEntry}</p>
      ) : null}

      <section className="space-y-2 rounded-[var(--radius-md)] bg-elevated px-3 py-3">
        <p className="text-xs font-medium tracking-wider text-muted uppercase">¿Qué está viendo Atalaya?</p>
        <p className="text-sm leading-relaxed text-muted">{asset.technicalSummary}</p>
        {isPending ? (
          <>
            <p className="text-xs font-medium tracking-wider text-muted uppercase">¿Qué está esperando?</p>
            <p className="text-sm leading-relaxed text-muted">
              {setup.missingForEntry ?? "Confirmación 15M. No es orden."}
            </p>
          </>
        ) : null}
        <p className="text-xs font-medium tracking-wider text-muted uppercase">¿Qué invalidaría esta idea?</p>
        <p className="text-sm leading-relaxed text-muted">
          Un cierre 15M más allá de {formatPrice(setup.invalidation, d)}. Relación con SL:{" "}
          {formatPrice(setup.stopLoss, d)}.
        </p>
      </section>

      <div>
        <p className="text-xs font-medium tracking-wider text-muted uppercase">
          Decisión
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{asset.wouldTradeReason}</p>
      </div>

      <p className="text-sm text-muted">Análisis, no orden. Tú decides.</p>

      {hasChartableSetup(asset) && onViewChart ? (
        <button
          type="button"
          data-ver-grafico={asset.id}
          onClick={onViewChart}
          className="flex h-11 w-full items-center justify-center gap-1 rounded-[var(--radius-md)] bg-elevated text-sm font-medium shadow-[var(--shadow-border)]"
        >
          VER GRÁFICO
          <ChevronRight className="size-4" />
        </button>
      ) : null}

      {onWhy ? <WhyButton onClick={onWhy} /> : null}

      <button
        type="button"
        data-share-setup={asset.id}
        onClick={() => void share()}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-elevated text-sm font-medium shadow-[var(--shadow-border)]"
      >
        <Share2 className="size-4" />
        Compartir
      </button>
      {shareNote ? <p className="text-xs text-subtle">{shareNote}</p> : null}

      <section className="rounded-[var(--radius-md)] bg-elevated px-3 py-3">
        <h4 className="text-xs font-medium tracking-wider text-muted uppercase">
          Riesgo para esta cuenta
        </h4>
        {risk.calculable ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Item label="Capital" value={`${fmtEur(risk.capital)} €`} />
            <Item
              label="Riesgo recomendado"
              value={`${fmtEur(risk.recommendedEur)} € · ${risk.recommendedPct.toFixed(2)} %`}
            />
            <Item
              label="Lote teórico"
              value={risk.theoreticalLot != null ? fmtLot(risk.theoreticalLot) : "—"}
            />
            <Item
              label="Lote mínimo"
              value={risk.minLot != null ? fmtLot(risk.minLot) : "—"}
            />
            <Item
              label="Lote usado"
              value={risk.usedLot != null ? fmtLot(risk.usedLot) : "—"}
            />
            <Item
              label="Riesgo real"
              value={`${fmtEur(risk.realEur)} € · ${risk.realPct != null ? risk.realPct.toFixed(2) : "—"} %`}
            />
          </dl>
        ) : (
          <p className="mt-2 text-sm text-wait">
            {risk.reason ?? "RIESGO NO CALCULABLE — CONFIGURA EL CONTRATO"}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {risk.band ? <RiskBadge band={risk.band} /> : null}
        </div>
        {risk.minLotExceeds ? (
          <p className="mt-2 text-sm text-sell">{risk.reason}</p>
        ) : null}
        <p className="mt-2 text-xs text-subtle">Calidad alta ≠ más lote. R:R de V1 intacto.</p>
      </section>

      {setup.warnings.length ? (
        <ul className="space-y-1 text-sm text-wait">
          {setup.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {isEntry ? (
        <>
          <p className="text-sm text-muted">Señal técnicamente válida. Tú decides.</p>
          <p className="text-sm text-subtle">{setup.managementNote}</p>
        </>
      ) : null}
    </div>
  );
}

function Item({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="font-mono text-sm tabular">{value}</dd>
    </div>
  );
}

function fmtEur(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtLot(n: number): string {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function WhyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-explain-why
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-elevated text-sm font-medium shadow-[var(--shadow-border)]"
    >
      <HelpCircle className="size-4" />
      ¿Por qué?
    </button>
  );
}

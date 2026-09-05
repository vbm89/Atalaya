import { useState } from "react";
import { ChevronRight, Share2, HelpCircle } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { AssetAnalysis } from "@/lib/trading/types";
import { calculateRisk, specFromDraft, type AccountSettings } from "@/lib/trading/risk";
import { effectiveContractDraft } from "@/lib/trading/contract-seed";
import { costEstimateLabel, type AssetCosts } from "@/lib/trading/costs";
import { hasChartableSetup } from "@/lib/chart/setup-overlay";
import { displayEntryPrice } from "@/lib/chart/labels";
import { distanceUnavailableLabel, setupDistance } from "@/lib/chart/zone-distance";
import type { AssetWatch } from "@/lib/watch/memory";
import { setupStateEs, watchPhaseCaption } from "@/lib/watch/memory";
import { setupShareText } from "@/lib/watch/share-setup";
import {
  analysisDisclaimer,
  analysisPriceCaption,
  executionCostsLabel,
  executionRiskLabel,
  mappingStateLabel,
  theoreticalRiskNote,
  viewsFromAsset,
} from "@/lib/broker/broker-view";
import { QualityBadge, RiskBadge, WatchPhaseBadge } from "./signal-badge";
import { episodeMarketView } from "@/lib/watch/market-session";

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
  const views = viewsFromAsset(asset);
  const broker = views.broker;
  const analysisCap = analysisPriceCaption(asset.id, asset);

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
    const entryPx = displayEntryPrice(s.direction, s.zone.low, s.zone.high);
    return (
      <div className="mt-2 space-y-2 rounded-[var(--radius-lg)] bg-wait-dim px-3 py-3" data-setup-kind="expired">
        <WatchPhaseBadge phase="expired" signal="wait" />
        <p className="text-sm font-medium text-wait">{watchPhaseCaption(watch)}</p>
        <p className="text-sm text-muted">
          {dir} · era {was} · ENTRADA V1 {formatPrice(entryPx, d)}
        </p>
        <p className="text-xs text-muted">{analysisCap}</p>
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
        <p className="text-xs text-muted">{analysisCap}</p>
        {onWhy ? <WhyButton onClick={onWhy} /> : null}
      </div>
    );
  }

  const d = asset.digits;
  const dir = setup.direction === "buy" ? "COMPRA" : "VENTA";
  const kind = setup.kind === "continuation" ? "A · continuación / retest" : "B · ruptura + retest";
  const entryPx = views.analysis.entry ?? displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high);
  const slDist = Math.abs(entryPx - setup.stopLoss);
  const contract = effectiveContractDraft(asset.id, account.contracts[asset.id]);
  const spec = specFromDraft(contract);
  const risk = calculateRisk({ capital: account.capital, spec, slDistance: slDist });
  const isEntry = asset.setupState === "entry";
  const isPending = asset.setupState === "pending";
  const market = episodeMarketView({
    id: asset.id,
    setupState: asset.setupState,
    dataStatus: asset.dataStatus,
  });
  const tickSize = contract.tickSize;
  const slTicks = tickSize && tickSize > 0 ? slDist / tickSize : null;
  const costEst =
    costs != null
      ? costEstimateLabel(costs, contract.tickValue ?? null, slTicks)
      : { calculable: false, text: "NO CALCULABLE" };
  const dist = setupDistance({
    analysisPrice: asset.price,
    frozen: false,
    zoneLow: setup.zone.low,
    zoneHigh: setup.zone.high,
    entry: entryPx,
  });
  const execRisk = executionRiskLabel();
  const execCost = executionCostsLabel();
  const analysisKind = views.analysis.kind === "proxy" ? "PROXY" : "SPOT";

  return (
    <div className="mt-2 space-y-3" data-operable={market.operable ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-2">
        {market.closedPending ? null : <WatchPhaseBadge phase="live" signal={asset.signal} />}
        <QualityBadge quality={setup.quality} />
      </div>

      {market.closedPending ? (
        <p className="text-sm font-medium text-muted">
          {market.episodeLabel} — no operable ahora. El mercado está cerrado.
        </p>
      ) : isPending ? (
        <p className="text-sm font-medium text-wait">TRIGGER PENDIENTE — vigente, no es orden</p>
      ) : isEntry ? (
        <p className="text-sm font-medium">ENTRADA V1 vigente. Análisis, no orden.</p>
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
      </dl>

      <section
        className="space-y-2 rounded-[var(--radius-md)] bg-elevated px-3 py-3"
        data-analysis-block
        data-analysis-instrument={views.analysis.instrument}
      >
        <h4 className="text-xs font-medium tracking-wider text-muted uppercase">Análisis</h4>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Item
            label="Instrumento"
            value={`${views.analysis.instrument} · ${views.analysis.provider} · ${analysisKind}`}
            wide
          />
          <Item
            label="Precio de análisis"
            value={views.analysis.price == null ? "—" : formatPrice(views.analysis.price, d)}
            wide
          />
          <Item label="ENTRADA V1" value={formatPrice(entryPx, d)} wide />
          <Item label="Invalidación" value={formatPrice(setup.invalidation, d)} />
          <Item label="SL de análisis" value={formatPrice(setup.stopLoss, d)} />
          <Item label="TP1" value={formatPrice(setup.takeProfit1, d)} />
          <Item
            label="TP2"
            value={setup.takeProfit2 != null ? formatPrice(setup.takeProfit2, d) : "n/d"}
          />
          <Item label="R:R teórico V1" value={`1 : ${setup.riskReward.toFixed(1)}`} />
        </dl>
      </section>

      <section
        className="space-y-2 rounded-[var(--radius-md)] bg-elevated px-3 py-3"
        data-broker-block
        data-broker-instrument={broker.instrument}
        data-broker-mapping={broker.mappingState}
      >
        <h4 className="text-xs font-medium tracking-wider text-muted uppercase">Broker</h4>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Item label="Instrumento" value={`${broker.instrument} · ${broker.provider}`} wide />
          <Item label="Precio ahora" value="—" />
          <Item label="ENTRADA" value="—" />
          <Item label="SL" value="—" />
          <Item label="TP1" value="—" />
          <Item label="TP2" value="—" />
          <Item label="Estado" value={mappingStateLabel(broker.mappingState)} wide />
          <Item label="Riesgo ejecución" value={execRisk.label} wide />
          <Item label="Spread broker" value={execCost.label} />
          <Item label="Comisión broker" value={execCost.label} />
          <Item label="Coste de ejecución" value={execCost.label} wide />
        </dl>
      </section>

      <p className="text-sm leading-relaxed text-wait whitespace-pre-line" data-instrument-disclaimer>
        {analysisDisclaimer(asset.id)}
      </p>

      <p className="text-xs leading-relaxed text-subtle" data-zone-distance data-distance-source={dist?.source ?? "none"}>
        {dist ? dist.label : distanceUnavailableLabel(false)}
      </p>

      <p className="text-xs leading-relaxed text-subtle" data-cost-estimate>
        Coste estimado (manual T4Trade): {costEst.text}. No es spread del PROXY.
      </p>
      <p className="text-xs leading-relaxed text-subtle">
        Coste de ejecución: {execCost.label}
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
          Riesgo teórico V1
        </h4>
        {risk.calculable ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Item label="Capital" value={`${fmtEur(risk.capital)} €`} />
            <Item
              label="Riesgo recomendado"
              value={`${fmtEur(risk.recommendedEur)} € · ${risk.recommendedPct.toFixed(2)} %`}
            />
            <Item label="Distancia analizada" value={formatPrice(slDist, d)} />
            <Item
              label="Contrato de referencia"
              value={`T4Trade ${broker.instrument}`}
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
              label="Riesgo teórico"
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
        <p className="mt-2 text-xs text-subtle">{theoreticalRiskNote()}</p>
        <p className="mt-2 text-xs text-subtle">Calidad alta ≠ más lote. R:R de V1 intacto.</p>
      </section>

      <section className="rounded-[var(--radius-md)] bg-elevated px-3 py-3">
        <h4 className="text-xs font-medium tracking-wider text-muted uppercase">
          Riesgo de ejecución
        </h4>
        <p className="mt-2 text-sm text-wait">{execRisk.label}</p>
        <p className="mt-1 text-xs text-subtle">
          Sin niveles {broker.instrument} no hay sizing operativo. No se usa el SL del PROXY como SL del broker.
        </p>
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

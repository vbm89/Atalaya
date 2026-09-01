import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AssetId } from "@/lib/trading/types";
import {
  EMPTY_ACCOUNT,
  RISK_RECOMMENDED_PCT,
  calculateRisk,
  isDraftComplete,
  quoteTickSize,
  readAccount,
  specFromDraft,
  writeAccount,
  type AccountSettings,
  type ContractDraft,
} from "@/lib/trading/risk";
import {
  CAPTURED,
  formatCaptureNumber,
  isDecimalTyping,
  missingContractLabel,
  parseDecimalPositive,
  seedContracts,
  seedCosts,
} from "@/lib/trading/contract-seed";
import { ASSETS } from "@/lib/trading/assets";
import { CHART_ASSET_BLURB } from "@/lib/chart/labels";
import {
  costEstimateLabel,
  emptyCosts,
  readCosts,
  writeCosts,
  type AssetCosts,
  type CostsBook,
} from "@/lib/trading/costs";

export function AccountPanel({
  value,
  onChange,
  costs,
  onCostsChange,
}: {
  value: AccountSettings;
  onChange: (next: AccountSettings) => void;
  costs: CostsBook;
  onCostsChange: (next: CostsBook) => void;
}) {
  const [open, setOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState<AssetId | null>(null);
  const incomplete = ASSETS.filter((a) => !isDraftComplete(value.contracts[a.id])).length;
  const rec =
    value.capital != null && value.capital > 0
      ? calculateRisk({ capital: value.capital, spec: null, slDistance: 0 })
      : null;

  return (
    <section className="rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]" data-account-panel>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-xs font-medium tracking-wider text-muted uppercase">Cuenta y contrato</p>
          <p className="mt-0.5 text-sm">
            Capital {value.capital != null ? `${value.capital.toLocaleString("es-ES")} €` : "sin configurar"}
            {" · "}
            Riesgo {RISK_RECOMMENDED_PCT.toFixed(2).replace(".", ",")} %
            {rec?.recommendedEur != null
              ? ` · ${rec.recommendedEur.toLocaleString("es-ES", { maximumFractionDigits: 2 })} €`
              : ""}
          </p>
          <p className={`mt-0.5 text-xs ${incomplete ? "text-wait" : "text-buy"}`} data-contract-summary>
            {incomplete
              ? `${incomplete} contrato${incomplete === 1 ? "" : "s"} incompleto${incomplete === 1 ? "" : "s"} · RIESGO NO CALCULABLE`
              : "Contratos completos. Lote NO CALCULABLE hasta un SL de V1."}
          </p>
        </div>
        <ChevronDown className={open ? "size-4 rotate-180 text-muted" : "size-4 text-muted"} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border/80 px-4 py-3">
          <label className="block">
            <span className="text-xs text-subtle">Capital (€)</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              min={0}
              step={1}
              value={value.capital ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim().replace(",", ".");
                if (raw === "") {
                  onChange({ ...value, capital: null });
                  return;
                }
                const n = Number(raw);
                onChange({ ...value, capital: Number.isFinite(n) && n >= 0 ? n : value.capital });
              }}
              className="mt-1 h-11 w-full rounded-[var(--radius-md)] bg-surface px-3 font-mono text-sm tabular shadow-[var(--shadow-border)] outline-none"
            />
          </label>
          <p className="text-xs text-subtle">
            Tres capas, separadas: contrato (captura del bróker) → costes (manual) → riesgo (API de risk.ts).
            Nada de esto cambia V1. Lote mínimo y paso de lote no aparecen en las capturas: PENDIENTE.
            No se deducen del tamaño del contrato. Spread flotante no se inventa.
          </p>
          {ASSETS.map((a) => (
            <ContractRow
              key={a.id}
              id={a.id}
              label={a.label}
              blurb={CHART_ASSET_BLURB[a.id]}
              digits={a.digits}
              spec={value.contracts[a.id]}
              costs={costs[a.id]}
              expanded={assetOpen === a.id}
              onToggle={() => setAssetOpen((cur) => (cur === a.id ? null : a.id))}
              onChange={(spec) =>
                onChange({
                  ...value,
                  contracts: { ...value.contracts, [a.id]: spec },
                })
              }
              onCostsChange={(row) => onCostsChange({ ...costs, [a.id]: row })}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function fieldValue(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) && n > 0 ? String(n) : "";
}

function ContractRow({
  id,
  label,
  blurb,
  digits,
  spec,
  costs,
  expanded,
  onToggle,
  onChange,
  onCostsChange,
}: {
  id: AssetId;
  label: string;
  blurb: string;
  digits: number;
  spec: ContractDraft;
  costs: AssetCosts;
  expanded: boolean;
  onToggle: () => void;
  onChange: (spec: ContractDraft) => void;
  onCostsChange: (row: AssetCosts) => void;
}) {
  const knownTick = quoteTickSize(digits);
  const capture = CAPTURED[id];
  const [tickSize, setTickSize] = useState(
    fieldValue(capture.tickSize ?? (id === "BTCUSD" ? null : spec.tickSize ?? knownTick)),
  );
  const [tickValue, setTickValue] = useState(fieldValue(spec.tickValue));
  const [minLot, setMinLot] = useState(fieldValue(spec.minLot));
  const [lotStep, setLotStep] = useState(fieldValue(spec.lotStep));
  const [spreadTicks, setSpreadTicks] = useState(fieldValue(costs.spreadTicks));
  const [commissionEur, setCommissionEur] = useState(fieldValue(costs.commissionEur));

  useEffect(() => {
    if (capture.tickSize != null) {
      setTickSize(fieldValue(spec.tickSize ?? capture.tickSize));
    } else if (id === "BTCUSD") {
      setTickSize(spec.tickSize != null && spec.tickSize !== knownTick ? fieldValue(spec.tickSize) : "");
    } else {
      setTickSize(fieldValue(spec.tickSize ?? knownTick));
    }
    setTickValue(fieldValue(spec.tickValue));
    setMinLot(fieldValue(spec.minLot));
    setLotStep(fieldValue(spec.lotStep));
  }, [spec, knownTick, capture.tickSize, id]);

  useEffect(() => {
    setSpreadTicks(fieldValue(costs.spreadTicks));
    setCommissionEur(fieldValue(costs.commissionEur));
  }, [costs]);

  function commit(next: {
    tickSize: string;
    tickValue: string;
    minLot: string;
    lotStep: string;
  }) {
    const parsedTick = parseDecimalPositive(next.tickSize);
    onChange({
      tickSize:
        capture.tickSize != null
          ? parsedTick ?? capture.tickSize
          : id === "BTCUSD"
            ? parsedTick
            : parsedTick ?? knownTick,
      tickValue: parseDecimalPositive(next.tickValue),
      minLot: parseDecimalPositive(next.minLot),
      lotStep: parseDecimalPositive(next.lotStep),
    });
  }

  function onLotField(
    field: "tickSize" | "tickValue" | "minLot" | "lotStep",
    raw: string,
    setter: (v: string) => void,
  ) {
    setter(raw);
    if (raw.trim() === "") {
      commit({ tickSize, tickValue, minLot, lotStep, [field]: raw });
      return;
    }
    if (isDecimalTyping(raw)) return;
    if (parseDecimalPositive(raw) != null) {
      commit({ tickSize, tickValue, minLot, lotStep, [field]: raw });
    }
  }

  const draft = {
    tickSize:
      parseDecimalPositive(tickSize) ??
      (capture.tickSize != null ? capture.tickSize : id === "BTCUSD" ? null : knownTick),
    tickValue: parseDecimalPositive(tickValue),
    minLot: parseDecimalPositive(minLot),
    lotStep: parseDecimalPositive(lotStep),
  };
  const complete = isDraftComplete(draft);
  const riskSpec = specFromDraft(draft);
  const missing = missingContractLabel(draft);
  const riskPreview = calculateRisk({
    capital: null,
    spec: riskSpec,
    slDistance: 0,
  });

  return (
    <fieldset className="rounded-[var(--radius-md)] bg-surface px-3 py-2" data-contract-row={id}>
      <button type="button" onClick={onToggle} className="flex min-h-11 w-full items-center justify-between gap-2 text-left">
        <span>
          <span className="text-sm font-medium">{label}</span>
          <span className="ml-2 text-xs text-muted">{blurb}</span>
        </span>
        <span className="flex items-center gap-2">
          <span
            data-contract-status={complete ? "ok" : "pending"}
            data-contract-asset={id}
            className={complete ? "text-xs text-buy" : "text-xs text-wait"}
          >
            {complete ? "Completo" : "⚠ CONTRATO INCOMPLETO"}
          </span>
          <ChevronDown className={expanded ? "size-4 rotate-180 text-muted" : "size-4 text-muted"} />
        </span>
      </button>
      {expanded ? (
        <div className="space-y-3 pb-2">
          <p className="text-[11px] font-medium tracking-wider text-muted uppercase">1. Datos del contrato</p>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Tick size"
              value={tickSize}
              known={capture.tickSize != null}
              asset={id}
              field="tickSize"
              onChange={(v) => onLotField("tickSize", v, setTickSize)}
              onBlur={() => {
                if (capture.tickSize != null && !parseDecimalPositive(tickSize)) {
                  setTickSize(String(capture.tickSize));
                  commit({ tickSize: String(capture.tickSize), tickValue, minLot, lotStep });
                }
              }}
            />
            <NumField
              label="Tick value USD"
              value={tickValue}
              asset={id}
              field="tickValue"
              onChange={(v) => onLotField("tickValue", v, setTickValue)}
            />
            <NumField
              label="Lote mínimo"
              value={minLot}
              asset={id}
              field="minLot"
              decimal
              onChange={(v) => onLotField("minLot", v, setMinLot)}
            />
            <NumField
              label="Paso de lote"
              value={lotStep}
              asset={id}
              field="lotStep"
              decimal
              onChange={(v) => onLotField("lotStep", v, setLotStep)}
            />
          </div>
          <CaptureFacts id={id} />
          {id === "BTCUSD" ? (
            <p className="text-xs text-wait">
              Tick size y tick value no aparecen en la captura. PENDIENTE. No se deducen.
            </p>
          ) : null}

          <p className="text-[11px] font-medium tracking-wider text-muted uppercase">2. Costes (opcional, no V1)</p>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Spread (ticks)"
              value={spreadTicks}
              asset={id}
              field="spreadTicks"
              optional
              onChange={(v) => {
                setSpreadTicks(v);
                if (isDecimalTyping(v) && v.trim() !== "") return;
                onCostsChange({
                  spreadTicks: parseDecimalPositive(v),
                  commissionEur: parseDecimalPositive(commissionEur),
                });
              }}
            />
            <NumField
              label="Comisión €"
              value={commissionEur}
              asset={id}
              field="commissionEur"
              optional
              onChange={(v) => {
                setCommissionEur(v);
                if (isDecimalTyping(v) && v.trim() !== "") return;
                onCostsChange({
                  spreadTicks: parseDecimalPositive(spreadTicks),
                  commissionEur: parseDecimalPositive(v),
                });
              }}
            />
          </div>
          <p className="text-xs text-subtle" data-cost-status={id}>
            {capture.spreadFloating
              ? "Spread flotante en la captura · no se inventa un número de ticks. "
              : ""}
            {costEstimateLabel(
              { spreadTicks: parseDecimalPositive(spreadTicks), commissionEur: parseDecimalPositive(commissionEur) },
              parseDecimalPositive(tickValue),
              null,
            ).text}
            {" · no modifican el R:R de V1"}
          </p>

          <p className="text-[11px] font-medium tracking-wider text-muted uppercase">3. Cálculo de riesgo</p>
          <p
            className={complete ? "text-xs text-buy" : "text-xs text-wait"}
            data-risk-status={id}
          >
            {complete
              ? "Contrato completo. Lote y riesgo real NO CALCULABLE hasta que V1 publique un SL."
              : `⚠ CONTRATO INCOMPLETO · ${riskPreview.reason ?? "RIESGO NO CALCULABLE — CONFIGURA EL CONTRATO"}`}
            {missing ? ` · ${missing}` : ""}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

function CaptureFacts({ id }: { id: AssetId }) {
  const c = CAPTURED[id];
  const usd = (n: number) => `${formatCaptureNumber(n)} USD`;
  return (
    <dl className="space-y-0.5 text-xs text-muted" data-capture-facts={id}>
      <div className="flex justify-between gap-3">
        <dt>Instrumento</dt>
        <dd className="font-mono tabular">{c.instrument}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Tamaño del contrato</dt>
        <dd className="font-mono tabular">
          {c.contractSize != null ? formatCaptureNumber(c.contractSize, 0) : "PENDIENTE"}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Margen de cobertura</dt>
        <dd className="font-mono tabular">{c.marginCoverage != null ? usd(c.marginCoverage) : "PENDIENTE"}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>% margen</dt>
        <dd className="font-mono tabular">
          {c.marginPercent != null ? `${formatCaptureNumber(c.marginPercent)} %` : "PENDIENTE"}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Precisión</dt>
        <dd className="font-mono tabular">{c.precision != null ? String(c.precision) : "PENDIENTE"}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Niveles de stop</dt>
        <dd className="font-mono tabular">{c.stopLevels != null ? String(c.stopLevels) : "PENDIENTE"}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Swap largo</dt>
        <dd className="font-mono tabular">
          {c.swapLong == null
            ? "PENDIENTE"
            : c.swapType === "percent"
              ? `${formatCaptureNumber(c.swapLong)} %`
              : usd(c.swapLong)}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Swap corto</dt>
        <dd className="font-mono tabular">
          {c.swapShort == null
            ? "PENDIENTE"
            : c.swapType === "percent"
              ? `${formatCaptureNumber(c.swapShort)} %`
              : usd(c.swapShort)}
        </dd>
      </div>
      <p className="pt-1 text-subtle">
        Tamaño de contrato ≠ lote mínimo ≠ paso de lote. Los dos últimos no están en la captura:
        PENDIENTE.
      </p>
    </dl>
  );
}

function NumField({
  label,
  value,
  onChange,
  onBlur,
  known,
  optional,
  decimal,
  asset,
  field,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  known?: boolean;
  optional?: boolean;
  decimal?: boolean;
  asset: AssetId;
  field: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-subtle">
        {label}
        {known ? " · captura" : optional ? " · opcional" : " · pendiente"}
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={optional ? "Opcional" : "Pendiente"}
        data-contract-field={`${asset}:${field}`}
        data-decimal={decimal ? "1" : undefined}
        aria-label={known ? `${label} (captura)` : optional ? `${label} opcional` : `${label} pendiente de configurar`}
        className="mt-1 h-11 w-full rounded-[var(--radius-md)] bg-elevated px-3 font-mono text-sm tabular shadow-[var(--shadow-border)] outline-none placeholder:text-wait"
      />
    </label>
  );
}

export function useAccountSettings(): [AccountSettings, (next: AccountSettings) => void] {
  const [settings, setSettings] = useState<AccountSettings>(EMPTY_ACCOUNT);
  useEffect(() => {
    const seeded = seedContracts(readAccount());
    setSettings(seeded);
    writeAccount(seeded);
  }, []);
  function update(next: AccountSettings) {
    setSettings(next);
    writeAccount(next);
  }
  return [settings, update];
}

export function useCosts(): [CostsBook, (next: CostsBook) => void] {
  const [book, setBook] = useState<CostsBook>(emptyCosts);
  useEffect(() => {
    const seeded = seedCosts(readCosts());
    setBook(seeded);
    writeCosts(seeded);
  }, []);
  function update(next: CostsBook) {
    setBook(next);
    writeCosts(next);
  }
  return [book, update];
}

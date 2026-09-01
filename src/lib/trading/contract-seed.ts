import type { AssetId } from "./types";
import type { AccountSettings, ContractDraft } from "./risk";
import type { CostsBook } from "./costs";

/** Proven broker-card fields only. Null = not visible in the captures. Never deduced. */
export interface CaptureSpec {
  instrument: string;
  contractSize: number | null;
  tickSize: number | null;
  tickValue: number | null;
  tickValueCurrency: "USD" | null;
  marginCoverage: number | null;
  marginPercent: number | null;
  precision: number | null;
  stopLevels: number | null;
  spreadTicks: number | null;
  spreadFloating: boolean;
  swapLong: number | null;
  swapShort: number | null;
  swapType: "usd" | "percent" | null;
  minLot: null;
  lotStep: null;
}

export const CAPTURED: Record<AssetId, CaptureSpec> = {
  XAUUSD: {
    instrument: "XAUUSD",
    contractSize: 100,
    tickSize: 0.01,
    tickValue: 1,
    tickValueCurrency: "USD",
    marginCoverage: 50,
    marginPercent: 0.1,
    precision: 2,
    stopLevels: 0,
    spreadTicks: 48,
    spreadFloating: false,
    swapLong: -50.8,
    swapShort: 18.2,
    swapType: "usd",
    minLot: null,
    lotStep: null,
  },
  US100: {
    instrument: "US100Cash",
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    tickValueCurrency: "USD",
    marginCoverage: 0.5,
    marginPercent: 1,
    precision: 2,
    stopLevels: 0,
    spreadTicks: null,
    spreadFloating: true,
    swapLong: -5.74,
    swapShort: -1.04,
    swapType: "usd",
    minLot: null,
    lotStep: null,
  },
  WTI: {
    instrument: "WTICash",
    contractSize: 1000,
    tickSize: 0.01,
    tickValue: 10,
    tickValueCurrency: "USD",
    marginCoverage: 500,
    marginPercent: 0.5,
    precision: 2,
    stopLevels: 0,
    spreadTicks: null,
    spreadFloating: true,
    swapLong: 5.18,
    swapShort: -29,
    swapType: "usd",
    minLot: null,
    lotStep: null,
  },
  BTCUSD: {
    instrument: "BTCUSD",
    contractSize: 1,
    tickSize: null,
    tickValue: null,
    tickValueCurrency: null,
    marginCoverage: 0.5,
    marginPercent: 0.2,
    precision: 2,
    stopLevels: 0,
    spreadTicks: null,
    spreadFloating: false,
    swapLong: -10,
    swapShort: -10,
    swapType: "percent",
    minLot: null,
    lotStep: null,
  },
};

const FIELD_ES: Record<"tickSize" | "tickValue" | "minLot" | "lotStep", string> = {
  tickSize: "tick size",
  tickValue: "tick value",
  minLot: "lote mínimo",
  lotStep: "paso de lote",
};

/** Intermediate strings while typing 0.01 — do not commit as null. */
export function isDecimalTyping(raw: string): boolean {
  const t = raw.trim().replace(",", ".");
  if (t === "" || t === "." || t === "0" || t === "0.") return true;
  return /^(0|[1-9]\d*)\.$/.test(t) || /^0\.0+$/.test(t);
}

/** Positive decimal. Never parseInt, never Math.round, never min=1. */
export function parseDecimalPositive(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "" || isDecimalTyping(raw)) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(t) && !/^\.\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function formatCaptureNumber(n: number, digits = 2): string {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function missingContractFields(
  d: ContractDraft,
  id?: AssetId,
): Array<"tickSize" | "tickValue" | "minLot" | "lotStep"> {
  const miss: Array<"tickSize" | "tickValue" | "minLot" | "lotStep"> = [];
  const cap = id ? CAPTURED[id] : null;
  if (cap ? cap.tickSize == null && d.tickSize == null : d.tickSize == null) miss.push("tickSize");
  if (d.tickValue == null) miss.push("tickValue");
  if (d.minLot == null) miss.push("minLot");
  if (d.lotStep == null) miss.push("lotStep");
  return miss;
}

export function missingContractLabel(d: ContractDraft, id?: AssetId): string | null {
  const miss = missingContractFields(d, id);
  if (!miss.length) return null;
  return `Falta: ${miss.map((f) => FIELD_ES[f]).join(", ")}`;
}

export function captureTickValue(id: AssetId): number | null {
  return CAPTURED[id].tickValue;
}

export function captureTickSize(id: AssetId): number | null {
  return CAPTURED[id].tickSize;
}

/** Fill only empty fields that the captures actually show. Never invents minLot/lotStep. */
export function seedContracts(account: AccountSettings): AccountSettings {
  const contracts = { ...account.contracts };
  (Object.keys(CAPTURED) as AssetId[]).forEach((id) => {
    const cap = CAPTURED[id];
    const row = { ...contracts[id] };
    if (row.tickValue == null && cap.tickValue != null) row.tickValue = cap.tickValue;
    if (cap.tickSize != null && (row.tickSize == null || row.tickSize === 0)) row.tickSize = cap.tickSize;
    if (
      id === "BTCUSD" &&
      row.tickValue === 0.01 &&
      row.minLot === 0.01 &&
      row.lotStep === 0.01
    ) {
      row.tickValue = null;
      row.minLot = null;
      row.lotStep = null;
    }
    contracts[id] = row;
  });
  return { ...account, contracts };
}

/** XAU spread 48 ticks from the card. Floating spreads stay empty. */
export function seedCosts(book: CostsBook): CostsBook {
  const next = { ...book };
  const xau = { ...next.XAUUSD };
  if (xau.spreadTicks == null && CAPTURED.XAUUSD.spreadTicks != null) {
    xau.spreadTicks = CAPTURED.XAUUSD.spreadTicks;
  }
  next.XAUUSD = xau;
  return next;
}

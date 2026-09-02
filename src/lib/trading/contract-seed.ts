import type { AssetId } from "./types";
import type { AccountSettings, ContractDraft } from "./risk";
import type { CostsBook } from "./costs";
import { BROKER_CONTRACTS, type BrokerContract } from "./broker-contract";

/** Proven broker-card fields. Null = not visible / not confirmed. Never deduced. */
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
  swapType: "points" | "usd" | "percent" | null;
  minLot: number | null;
  lotStep: number | null;
}

function fromBroker(c: BrokerContract): CaptureSpec {
  return {
    instrument: c.brokerSymbol,
    contractSize: c.contractSize,
    tickSize: c.tickSize,
    tickValue: c.tickValueUsd,
    tickValueCurrency: c.currency,
    marginCoverage: c.marginCoverage,
    marginPercent: c.marginPercent,
    precision: c.digits,
    stopLevels: c.stopsLevel,
    spreadTicks: null,
    spreadFloating: c.spreadType === "floating",
    swapLong: c.swapLong,
    swapShort: c.swapShort,
    swapType: c.swapType,
    minLot: c.minLot,
    lotStep: c.lotStep,
  };
}

export const CAPTURED: Record<AssetId, CaptureSpec> = {
  XAUUSD: fromBroker(BROKER_CONTRACTS.XAUUSD),
  BTCUSD: fromBroker(BROKER_CONTRACTS.BTCUSD),
  US100: fromBroker(BROKER_CONTRACTS.US100),
  WTI: fromBroker(BROKER_CONTRACTS.WTI),
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
  const eff = id ? effectiveContractDraft(id, d) : d;
  if (eff.tickSize == null) miss.push("tickSize");
  if (eff.tickValue == null) miss.push("tickValue");
  if (eff.minLot == null) miss.push("minLot");
  if (eff.lotStep == null) miss.push("lotStep");
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

/**
 * Effective contract for sizing/UI: BROKER_CONTRACTS filled onto the persisted draft.
 * Null/empty persisted fields take the confirmed T4Trade value.
 * Does not overwrite a user-typed positive value, except the known-wrong BTC tickValue 0.01.
 */
export function effectiveContractDraft(id: AssetId, row?: ContractDraft | null): ContractDraft {
  const cap = CAPTURED[id];
  const next: ContractDraft = {
    tickSize: row?.tickSize ?? null,
    tickValue: row?.tickValue ?? null,
    minLot: row?.minLot ?? null,
    lotStep: row?.lotStep ?? null,
  };
  if (cap.tickSize != null && (next.tickSize == null || next.tickSize === 0)) next.tickSize = cap.tickSize;
  if (cap.tickValue != null && next.tickValue == null) next.tickValue = cap.tickValue;
  if (cap.minLot != null && next.minLot == null) next.minLot = cap.minLot;
  if (cap.lotStep != null && next.lotStep == null) next.lotStep = cap.lotStep;
  if (
    id === "BTCUSD" &&
    next.tickValue === 0.01 &&
    cap.tickValue != null &&
    cap.tickValue !== 0.01
  ) {
    next.tickValue = cap.tickValue;
  }
  return next;
}

/** Fill empty fields from the T4Trade card. Never invent. Fixes the old BTC tickValue 0.01. */
export function seedContracts(account: AccountSettings): AccountSettings {
  const contracts = { ...account.contracts };
  (Object.keys(CAPTURED) as AssetId[]).forEach((id) => {
    contracts[id] = effectiveContractDraft(id, contracts[id]);
  });
  return { ...account, contracts };
}

/** Floating spreads stay empty. Do not seed a snapshot of ticks as if it were the contract. */
export function seedCosts(book: CostsBook): CostsBook {
  return { ...book };
}

import type { AssetId, ContractSpec, RiskBand } from "./types";
import { ASSETS } from "./assets";

export const RISK_RECOMMENDED_PCT = 0.5;

export const ACCOUNT_STORAGE_KEY = "atalaya:account:v1";

/** Draft stored in the account panel. Incomplete drafts are NOT a ContractSpec. */
export interface ContractDraft {
  tickSize: number | null;
  tickValue: number | null;
  minLot: number | null;
  lotStep: number | null;
}

export interface AccountSettings {
  capital: number | null;
  contracts: Record<AssetId, ContractDraft>;
}

function emptyDraft(digits: number): ContractDraft {
  return {
    tickSize: quoteTickSize(digits),
    tickValue: null,
    minLot: null,
    lotStep: null,
  };
}

function draftsForAssets(): Record<AssetId, ContractDraft> {
  const out = {} as Record<AssetId, ContractDraft>;
  for (const a of ASSETS) out[a.id] = emptyDraft(a.digits);
  return out;
}

export const EMPTY_ACCOUNT: AccountSettings = {
  capital: 200,
  contracts: draftsForAssets(),
};

/** Quote increment of the feed (10^-digits). Not the broker contract tick. */
export function quoteTickSize(digits: number): number {
  if (!Number.isFinite(digits) || digits < 0) return 0.01;
  return Number((10 ** -digits).toFixed(digits));
}

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function draftFromUnknown(raw: unknown, digits: number): ContractDraft {
  if (!raw || typeof raw !== "object") return emptyDraft(digits);
  const o = raw as Record<string, unknown>;
  return {
    tickSize: positive(o.tickSize) ?? quoteTickSize(digits),
    tickValue: positive(o.tickValue),
    minLot: positive(o.minLot),
    lotStep: positive(o.lotStep),
  };
}

export function isDraftComplete(d: ContractDraft | null | undefined): boolean {
  return specFromDraft(d) != null;
}

export function specFromDraft(d: ContractDraft | null | undefined): ContractSpec | null {
  if (!d) return null;
  const tickSize = d.tickSize;
  const tickValue = d.tickValue;
  const minLot = d.minLot;
  const lotStep = d.lotStep;
  if (
    tickSize != null &&
    tickSize > 0 &&
    tickValue != null &&
    tickValue > 0 &&
    minLot != null &&
    minLot > 0 &&
    lotStep != null &&
    lotStep > 0
  ) {
    return { tickSize, tickValue, minLot, lotStep };
  }
  return null;
}

export function riskBand(pct: number): RiskBand {
  if (pct <= 0.5) return "bajo";
  if (pct <= 1) return "medio";
  if (pct <= 2) return "alto";
  if (pct <= 5) return "muy_alto";
  return "extremo";
}

export function riskBandLabel(band: RiskBand): string {
  switch (band) {
    case "bajo":
      return "BAJO";
    case "medio":
      return "MEDIO";
    case "alto":
      return "ALTO";
    case "muy_alto":
      return "MUY ALTO";
    case "extremo":
      return "EXTREMO";
  }
}

export interface RiskCalc {
  calculable: boolean;
  reason: string | null;
  capital: number | null;
  recommendedEur: number | null;
  recommendedPct: number;
  theoreticalLot: number | null;
  minLot: number | null;
  usedLot: number | null;
  realEur: number | null;
  realPct: number | null;
  band: RiskBand | null;
  minLotExceeds: boolean;
}

export function valuePerPricePerLot(spec: ContractSpec): number {
  if (spec.tickSize <= 0) return 0;
  return spec.tickValue / spec.tickSize;
}

export function floorLot(lot: number, step: number, min: number): number {
  if (step <= 0) return lot;
  const n = Math.floor(lot / step + 1e-12) * step;
  const rounded = Math.round(n / step) * step;
  return rounded + 1e-12 < min ? 0 : rounded;
}

export function calculateRisk(args: {
  capital: number | null;
  spec: ContractSpec | null | undefined;
  slDistance: number;
}): RiskCalc {
  const recommendedPct = RISK_RECOMMENDED_PCT;
  if (args.capital == null || !(args.capital > 0)) {
    return {
      calculable: false,
      reason: "RIESGO NO CALCULABLE — CONFIGURA EL CONTRATO",
      capital: args.capital,
      recommendedEur: null,
      recommendedPct,
      theoreticalLot: null,
      minLot: args.spec?.minLot ?? null,
      usedLot: null,
      realEur: null,
      realPct: null,
      band: null,
      minLotExceeds: false,
    };
  }
  if (
    !args.spec ||
    !(args.spec.tickSize > 0) ||
    !(args.spec.tickValue > 0) ||
    !(args.spec.minLot > 0) ||
    !(args.spec.lotStep > 0)
  ) {
    return {
      calculable: false,
      reason: "RIESGO NO CALCULABLE — CONFIGURA EL CONTRATO",
      capital: args.capital,
      recommendedEur: args.capital * (recommendedPct / 100),
      recommendedPct,
      theoreticalLot: null,
      minLot: args.spec?.minLot ?? null,
      usedLot: null,
      realEur: null,
      realPct: null,
      band: null,
      minLotExceeds: false,
    };
  }
  const sl = args.slDistance;
  if (!(sl > 0)) {
    return {
      calculable: false,
      reason: "RIESGO NO CALCULABLE — CONFIGURA EL CONTRATO",
      capital: args.capital,
      recommendedEur: args.capital * (recommendedPct / 100),
      recommendedPct,
      theoreticalLot: null,
      minLot: args.spec.minLot,
      usedLot: null,
      realEur: null,
      realPct: null,
      band: null,
      minLotExceeds: false,
    };
  }
  const recEur = args.capital * (recommendedPct / 100);
  const v = valuePerPricePerLot(args.spec);
  const theoretical = recEur / (sl * v);
  const floored = floorLot(theoretical, args.spec.lotStep, args.spec.minLot);
  const minExceeds = theoretical + 1e-12 < args.spec.minLot;
  const used = minExceeds ? args.spec.minLot : floored;
  const realEur = sl * v * used;
  const realPct = (realEur / args.capital) * 100;
  return {
    calculable: true,
    reason: minExceeds
      ? "El lote mínimo supera el riesgo recomendado. Calidad alta ≠ más lote."
      : null,
    capital: args.capital,
    recommendedEur: recEur,
    recommendedPct,
    theoreticalLot: theoretical,
    minLot: args.spec.minLot,
    usedLot: used,
    realEur,
    realPct,
    band: riskBand(realPct),
    minLotExceeds: minExceeds,
  };
}

export function readAccount(): AccountSettings {
  if (typeof window === "undefined") return EMPTY_ACCOUNT;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return EMPTY_ACCOUNT;
    const parsed = JSON.parse(raw) as { capital?: unknown; contracts?: unknown };
    const contracts = draftsForAssets();
    const saved =
      parsed.contracts && typeof parsed.contracts === "object"
        ? (parsed.contracts as Record<string, unknown>)
        : {};
    for (const a of ASSETS) {
      contracts[a.id] = draftFromUnknown(saved[a.id], a.digits);
    }
    return {
      capital: typeof parsed.capital === "number" ? parsed.capital : 200,
      contracts,
    };
  } catch {
    return EMPTY_ACCOUNT;
  }
}

export function writeAccount(settings: AccountSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

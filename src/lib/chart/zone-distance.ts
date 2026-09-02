export type ZoneRelation = "inside" | "above" | "below";
export type DistanceSource = "analysis" | "frozen";

export interface ZoneDistance {
  relation: ZoneRelation;
  pct: number;
  label: string;
}

export interface SetupDistance extends ZoneDistance {
  source: DistanceSource;
  proximal: boolean;
  entryPct: number | null;
}

/** Informational only. Does not change the setup or V1. */
export function zoneDistance(
  price: number | null,
  zoneLow: number,
  zoneHigh: number,
): ZoneDistance | null {
  if (price == null || !Number.isFinite(price) || zoneHigh <= zoneLow) return null;
  if (price >= zoneLow && price <= zoneHigh) {
    return { relation: "inside", pct: 0, label: "DENTRO DE LA ZONA DE ORIGEN" };
  }
  const mid = (zoneLow + zoneHigh) / 2;
  if (price > zoneHigh) {
    const pct = ((price - zoneHigh) / mid) * 100;
    return { relation: "above", pct, label: `A ${pct.toFixed(2).replace(".", ",")} % DE LA ZONA DE ORIGEN` };
  }
  const pct = ((zoneLow - price) / mid) * 100;
  return { relation: "below", pct, label: `A ${pct.toFixed(2).replace(".", ",")} % DE LA ZONA DE ORIGEN` };
}

/**
 * Distancia de un setup.
 * - vigente: precio del análisis V1 (no un tick posterior ni el spot XAU).
 * - congelado: solo freeze.slotClosePrice. Si falta, null — nunca el precio actual.
 */
export function setupDistance(args: {
  analysisPrice: number | null;
  freezePrice?: number | null;
  frozen?: boolean;
  zoneLow: number;
  zoneHigh: number;
  entry?: number | null;
}): SetupDistance | null {
  const frozen = args.frozen === true;
  const price = frozen ? (args.freezePrice ?? null) : args.analysisPrice;
  const source: DistanceSource = frozen ? "frozen" : "analysis";
  const base = zoneDistance(price, args.zoneLow, args.zoneHigh);
  if (!base || price == null) return null;
  let entryPct: number | null = null;
  if (args.entry != null && Number.isFinite(args.entry) && Math.abs(args.entry) > 0) {
    entryPct = (Math.abs(price - args.entry) / Math.abs(args.entry)) * 100;
  }
  const prefix = frozen ? "Al cierre del análisis · " : "Precio del análisis · ";
  const proximal = base.relation === "inside";
  const prox = proximal ? " · PROXIMIDAD" : "";
  return {
    ...base,
    source,
    proximal,
    entryPct,
    label: `${prefix}${base.label}${prox}`,
  };
}

export function distanceUnavailableLabel(frozen: boolean): string {
  return frozen
    ? "Distancia NO CALCULABLE. No se usa un precio posterior a la caducidad."
    : "Distancia NO CALCULABLE. Falta el precio del análisis.";
}

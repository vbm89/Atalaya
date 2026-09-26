/**
 * Definiciones del motor, fijadas antes de cualquier replay.
 * No son una rejilla. No se reescriben después de ver resultados.
 * El buffer y el R:R mínimo no se mueven para embellecer el resultado.
 */
export const PARAMS = {
  barSec: 900,
  atrPeriod: 14,
  emaPeriod: 20,
  swingRadius: 2,
  structureLookback: 48,
  rangeLookback: 20,
  slopeBars: 8,
  compressionBars: 6,
  compressionAtrFrac: 0.65,
  expansionRangeAtr: 1.3,
  displacementRangeAtr: 1.2,
  displacementBodyFrac: 0.55,
  displacementCloseLoc: 0.65,
  rejectionWickFrac: 0.4,
  rejectionMaxOppositeWick: 0.35,
  closeExtreme: 0.75,
  pullbackMinAtr: 0.4,
  locationAtr: 1.5,
  slopeMin: 0.15,
  atrBufferFrac: 0.15,
  minRiskAtr: 0.2,
  maxRiskAtr: 3.5,
  minRr: 1.5,
  targetAtrFallback: 2,
  eventLookback: 6,
  warmup: 48,
  splitTrain: 0.7,
  horizons: [1, 4, 8, 32],
} as const;

export function rulesFingerprint(): string {
  return JSON.stringify(PARAMS);
}

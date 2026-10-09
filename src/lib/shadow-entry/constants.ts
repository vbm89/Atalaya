/** Constantes congeladas a priori. No se ajustan a resultados. */

export const STEP_SEC = {
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
} as const;

export const ATR_PERIOD = 14;
export const SWING_RADIUS = 2;
export const RANGE_LOOKBACK = 16;
export const SMA_PERIOD = 20;
export const ATR_PERCENTILE_LOOKBACK = 50;
export const SEQUENCE_MAX_GAP = 8;
export const FAIL_EXTEND_BARS = 2;
export const ACCEPT_CLOSES = 2;
export const COMPRESSION_MIN_RUN = 3;
export const COMPRESSION_ATR_FRAC = 0.5;
export const MIN_RR = 1.5;
export const MIN_RISK_ATR = 0.15;
export const MAX_RISK_ATR = 3.5;
export const ATR_BUFFER_FRAC = 0.1;
export const WARMUP_BARS = 40;
export const DEFAULT_TARGET_ATR = 1.5;
export const EXTREME_LOOKBACK = 16;

export const ASSETS = ["XAUUSD", "BTCUSD", "US100", "WTI"] as const;
export const TIMEFRAMES = ["15m", "30m", "1h", "4h"] as const;

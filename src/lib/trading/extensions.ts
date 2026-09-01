/**
 * V2+ extension surface. V1 is analysis-only: no orders, no broker socket,
 * no alerts dispatcher. Later modules should plug in here without rewriting
 * the signal engine.
 */

import type { AssetId, EntryProposal, FutureCapability, Signal } from "./types";

export interface AlertRule {
  id: string;
  assetId: AssetId;
  kind: "signal_change" | "price_level" | "high_impact_news";
  enabled: boolean;
}

export interface TrackedTrade {
  id: string;
  assetId: AssetId;
  proposal: EntryProposal;
  openedAt: string;
  status: "planned" | "open" | "closed";
}

export interface JournalNote {
  id: string;
  assetId: AssetId;
  at: string;
  text: string;
  signal: Signal;
}

export interface BacktestRequest {
  assetId: AssetId;
  from: string;
  to: string;
  timeframe: "15m" | "1h" | "4h";
}

export interface MoneyPlan {
  equity: number;
  riskPct: number;
}

export interface BrokerBridge {
  /** Must remain a no-op until exhaustive paper tests exist. */
  sendSignal(proposal: EntryProposal): Promise<never>;
}

export const V1_DISABLED: Record<FutureCapability, false> = {
  alerts: false,
  tradeTracking: false,
  journal: false,
  backtesting: false,
  interactiveCharts: false,
  moneyManagement: false,
  metaTraderBridge: false,
  autoExecution: false,
};

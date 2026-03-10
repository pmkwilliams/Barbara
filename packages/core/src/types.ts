export const Platform = {
  KALSHI: "kalshi",
  POLYMARKET: "polymarket"
} as const;

export type Platform = (typeof Platform)[keyof typeof Platform];

export const MarketStatus = {
  ACTIVE: "active",
  CLOSED: "closed",
  RESOLVED: "resolved",
  SUSPENDED: "suspended"
} as const;

export type MarketStatus = (typeof MarketStatus)[keyof typeof MarketStatus];

export interface NormalizedMarket {
  id: string;
  platform: Platform;
  platform_id: string;
  title: string;
  description: string | null;
  event_ticker: string | null;
  series_ticker: string | null;
  outcome_labels: string[];
  resolution_source: string | null;
  resolution_rules: string | null;
  open_time: string | null;
  start_time: string | null;
  close_time: string | null;
  end_time: string | null;
  group_title: string | null;
  category: string | null;
  market_shape: "binary" | "scalar" | "categorical" | "unknown";
  is_binary_eligible: boolean;
  status: MarketStatus;
  volume: number | null;
  resolution_hash: string | null;
  raw_data: unknown | null;
  created_at: string;
  updated_at: string;
}

export type NormalizedMarketInput = Omit<NormalizedMarket, "id" | "created_at" | "updated_at">;

export interface IngestionRun {
  id: number;
  platform: Platform;
  started_at: string;
  completed_at: string | null;
  markets_found: number | null;
  markets_created: number | null;
  markets_updated: number | null;
  status: string;
  error: string | null;
}

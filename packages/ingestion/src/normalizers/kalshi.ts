import { createLogger, MarketStatus, Platform, type NormalizedMarketInput } from "@barbara/core";
import type { KalshiRawMarket } from "@barbara/shared-platform";

const logger = createLogger("ingestion:kalshi-normalizer");

const normalizeRules = (primary: string, secondary: string): string | null => {
  const parts = [primary, secondary].map((value) => value.trim()).filter((value) => value.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : null;
};

const normalizeStatus = (status: string): MarketStatus => {
  switch (status) {
    case "open":
    case "active":
      return MarketStatus.ACTIVE;
    case "closed":
      return MarketStatus.CLOSED;
    case "settled":
      return MarketStatus.RESOLVED;
    default:
      logger.warn("Unmapped Kalshi market status, defaulting to active", { status });
      return MarketStatus.ACTIVE;
  }
};

export const normalizeKalshiMarket = (raw: KalshiRawMarket): NormalizedMarketInput => ({
  platform: Platform.KALSHI,
  platform_id: raw.ticker,
  title: raw.title,
  description: null,
  event_ticker: raw.event_ticker ?? null,
  series_ticker: raw.series_ticker ?? null,
  outcome_labels: [raw.yes_sub_title, raw.no_sub_title],
  resolution_source: null,
  resolution_rules: normalizeRules(raw.rules_primary, raw.rules_secondary),
  open_time: raw.open_time ?? null,
  start_time: null,
  close_time: raw.close_time,
  end_time: raw.close_time,
  group_title: null,
  category: null,
  market_shape: raw.market_type,
  is_binary_eligible: raw.market_type === "binary",
  status: normalizeStatus(raw.status),
  volume: raw.volume,
  resolution_hash: null,
  raw_data: raw
});

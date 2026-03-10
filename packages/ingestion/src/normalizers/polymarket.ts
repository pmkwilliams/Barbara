import { MarketStatus, Platform, type NormalizedMarketInput } from "@barbara/core";
import type { GammaMarket } from "@barbara/shared-platform";

const normalizeGroupTitle = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeStatus = (raw: GammaMarket): MarketStatus => {
  if (raw.closed) {
    return MarketStatus.CLOSED;
  }

  if (raw.active) {
    return MarketStatus.ACTIVE;
  }

  return MarketStatus.SUSPENDED;
};

export const normalizePolymarketMarket = (raw: GammaMarket): NormalizedMarketInput => ({
  platform: Platform.POLYMARKET,
  platform_id: raw.conditionId,
  title: raw.question,
  description: raw.description,
  event_ticker: null,
  series_ticker: null,
  outcome_labels: raw.outcomes,
  resolution_source: raw.resolutionSource,
  resolution_rules: raw.description,
  open_time: null,
  start_time: raw.startDate,
  close_time: raw.endDate,
  end_time: raw.endDate,
  group_title: normalizeGroupTitle(raw.groupItemTitle),
  category: null,
  market_shape: raw.outcomes.length === 2 ? "binary" : "unknown",
  is_binary_eligible: raw.outcomes.length === 2,
  status: normalizeStatus(raw),
  volume: Number.isNaN(Number.parseFloat(raw.volume)) ? null : Number.parseFloat(raw.volume),
  resolution_hash: null,
  raw_data: raw
});

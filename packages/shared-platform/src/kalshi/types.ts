import type { KalshiRawMarket } from "../api-types";

export interface GetMarketsResponse {
  markets: KalshiRawMarket[];
  cursor: string;
}

export interface GetMarketResponse {
  market: KalshiRawMarket;
}

export interface GetExchangeStatusResponse {
  exchange_active: boolean;
  trading_active: boolean;
}

export interface KalshiAccountLimits {
  usage_tier: string;
  read_limit: number;
  write_limit: number;
}

export interface GetMarketsParams {
  limit?: number;
  cursor?: string;
  status?: string;
  event_ticker?: string;
  series_ticker?: string;
}

export interface GammaEventRaw {
  id: string;
  slug: string;
  title: string;
  description: string;
  markets: GammaMarketRaw[];
  [key: string]: unknown;
}

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  markets: GammaMarket[];
  [key: string]: unknown;
}

export interface GammaMarketRaw {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  clobTokenIds: string;
  active: boolean;
  closed: boolean;
  volume: string;
  description: string;
  startDate: string;
  endDate: string;
  resolutionSource: string;
  groupItemTitle: string;
  enableOrderBook: boolean;
  [key: string]: unknown;
}

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds: string[];
  active: boolean;
  closed: boolean;
  volume: string;
  description: string;
  startDate: string;
  endDate: string;
  resolutionSource: string;
  groupItemTitle: string;
  enableOrderBook: boolean;
  [key: string]: unknown;
}

export interface GammaTag {
  id: string;
  label: string | null;
  slug: string | null;
  [key: string]: unknown;
}

export interface GammaSearchResponse {
  events?: GammaEventRaw[] | null;
  markets?: GammaMarketRaw[] | null;
  tags?: GammaTag[] | null;
  profiles?: unknown[] | null;
  pagination?: {
    hasMore: boolean;
    totalResults: number;
  };
  [key: string]: unknown;
}

export interface GetEventsParams {
  limit?: number;
  offset?: number;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  tag_id?: string | number;
  related_tags?: boolean;
  exclude_tag_id?: number | number[];
  [key: string]: string | number | boolean | number[] | undefined;
}

export interface GetMarketsParams {
  limit?: number;
  offset?: number;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  tag_id?: string | number;
  related_tags?: boolean;
  event_id?: string | number;
  [key: string]: string | number | boolean | undefined;
}

export interface SearchParams {
  cache?: boolean;
  events_status?: string;
  limit_per_type?: number;
  page?: number;
  events_tag?: string[];
  keep_closed_markets?: number;
  sort?: string;
  ascending?: boolean;
  search_tags?: boolean;
  search_profiles?: boolean;
  recurrence?: string;
  exclude_tag_id?: number[];
  optimized?: boolean;
}

export interface ClobBookEntry {
  price: string;
  size: string;
}

export interface ClobBook {
  market: string;
  asset_id: string;
  bids: ClobBookEntry[];
  asks: ClobBookEntry[];
  hash: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface ClobPrice {
  price: string;
  [key: string]: unknown;
}

export interface ClobMidpoint {
  mid: string;
  [key: string]: unknown;
}

export interface ClobSpread {
  spread: string;
  [key: string]: unknown;
}

export interface ClobTickSize {
  minimum_tick_size: string;
  [key: string]: unknown;
}

export interface ClobLastTradePrice {
  price: string;
  side: string;
  [key: string]: unknown;
}

export interface ClobPriceHistory {
  t: number;
  p: string;
  [key: string]: unknown;
}

export interface PricesHistoryParams {
  market: string;
  interval?: string;
  fidelity?: number;
  startTs?: number;
  endTs?: number;
  [key: string]: string | number | undefined;
}

export interface ClobSimplifiedMarket {
  condition_id?: string;
  question?: string;
  outcomes?: string[];
  tokens?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

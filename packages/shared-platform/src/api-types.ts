/* eslint-disable @typescript-eslint/no-empty-object-type */

export interface KalshiRawMarket {
  ticker: string;
  event_ticker: string;
  market_type: "binary" | "scalar";
  title: string;
  yes_sub_title: string;
  no_sub_title: string;
  status: string;
  open_time: string;
  close_time: string;
  latest_expiration_time: string;
  result: string;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  no_bid_dollars: string;
  no_ask_dollars: string;
  last_price_dollars: string;
  volume: number;
  volume_24h: number;
  open_interest: number;
  rules_primary: string;
  rules_secondary: string;
  can_close_early: boolean;
  [key: string]: unknown;
}

export interface PolymarketRawMarket {
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
  category: string;
  resolutionSource: string;
  groupItemTitle: string;
  enableOrderBook: boolean;
  [key: string]: unknown;
}

import { describe, expect, test } from "bun:test";

import type { KalshiClient, KalshiRawMarket } from "@barbara/shared-platform";

import { fetchAllKalshiMarkets } from "../../src/fetchers/kalshi";

const makeKalshiMarket = (overrides: Partial<KalshiRawMarket> = {}): KalshiRawMarket => ({
  ticker: "KX-001",
  event_ticker: "EVENT-1",
  market_type: "binary",
  title: "Will CPI exceed 3%?",
  yes_sub_title: "Yes",
  no_sub_title: "No",
  status: "active",
  open_time: "2026-01-01T00:00:00.000Z",
  close_time: "2026-02-01T00:00:00.000Z",
  latest_expiration_time: "2026-02-01T00:00:00.000Z",
  result: "",
  yes_bid_dollars: "0.45",
  yes_ask_dollars: "0.47",
  no_bid_dollars: "0.53",
  no_ask_dollars: "0.55",
  last_price_dollars: "0.46",
  volume: 1234,
  volume_24h: 200,
  open_interest: 50,
  rules_primary: "Primary rules",
  rules_secondary: "Secondary rules",
  can_close_early: false,
  ...overrides
});

const asKalshiClient = (
  implementation: (params?: unknown) => AsyncGenerator<KalshiRawMarket[]>
): KalshiClient => ({
  paginateMarkets: implementation
} as unknown as KalshiClient);

describe("fetchAllKalshiMarkets", () => {
  test("collects markets from a single page", async () => {
    const markets = await fetchAllKalshiMarkets(asKalshiClient(async function* () {
      yield [
        makeKalshiMarket({ ticker: "KX-1" }),
        makeKalshiMarket({ ticker: "KX-KEEP" })
      ];
    }));

    expect(markets.map((market) => market.ticker)).toEqual(["KX-1", "KX-KEEP"]);
  });

  test("continues paging until it collects enough markets", async () => {
    const calls: unknown[] = [];

    const markets = await fetchAllKalshiMarkets(
      asKalshiClient(async function* (params?: unknown) {
        calls.push(params);
        yield [
          makeKalshiMarket({ ticker: "KX-KEEP-1" })
        ];
        yield [
          makeKalshiMarket({ ticker: "KX-KEEP-2" }),
          makeKalshiMarket({ ticker: "KX-KEEP-3" })
        ];
      }),
      { status: "open", limit: 3 },
      { maxMarkets: 2 }
    );

    expect(markets.map((market) => market.ticker)).toEqual(["KX-KEEP-1", "KX-KEEP-2"]);
    expect(calls).toEqual([{ status: "open", limit: 3 }]);
  });
});

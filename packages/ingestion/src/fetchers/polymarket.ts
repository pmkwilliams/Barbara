import type { GammaClient, GammaMarket, PolymarketGetMarketsParams } from "@barbara/shared-platform";

export interface FetchPolymarketMarketsOptions {
  maxMarkets?: number;
  signal?: AbortSignal;
}

export const fetchAllPolymarketMarkets = async (
  client: GammaClient,
  params?: PolymarketGetMarketsParams,
  options?: FetchPolymarketMarketsOptions
): Promise<GammaMarket[]> => {
  const markets: GammaMarket[] = [];

  for await (const page of client.paginateMarkets(params, options?.signal ? { signal: options.signal } : undefined)) {
    if (options?.maxMarkets !== undefined) {
      markets.push(...page.slice(0, Math.max(options.maxMarkets - markets.length, 0)));

      if (markets.length >= options.maxMarkets) {
        break;
      }

      continue;
    }

    markets.push(...page);
  }

  return markets;
};

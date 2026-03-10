import type { GetMarketsParams, KalshiClient, KalshiRawMarket } from "@barbara/shared-platform";

export interface FetchKalshiMarketsOptions {
  maxMarkets?: number;
  signal?: AbortSignal;
}

export const fetchAllKalshiMarkets = async (
  client: KalshiClient,
  params?: GetMarketsParams,
  options?: FetchKalshiMarketsOptions
): Promise<KalshiRawMarket[]> => {
  const markets: KalshiRawMarket[] = [];

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

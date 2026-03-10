import {
  computeResolutionHash,
  completeIngestionRun,
  createIngestionRun,
  createLogger,
  failIngestionRun,
  Platform,
  upsertMarket,
  type BarbaraDb,
  type NormalizedMarketInput
} from "@barbara/core";
import type {
  GammaClient,
  GammaMarket,
  KalshiClient,
  KalshiRawMarket,
  GetMarketsParams,
  PolymarketGetMarketsParams
} from "@barbara/shared-platform";

import { fetchAllKalshiMarkets } from "./fetchers/kalshi";
import { fetchAllPolymarketMarkets } from "./fetchers/polymarket";
import { normalizeKalshiMarket } from "./normalizers/kalshi";
import { normalizePolymarketMarket } from "./normalizers/polymarket";

const logger = createLogger("ingestion:orchestrator");

export interface IngestionRunResult {
  platform: Platform;
  status: "completed" | "failed";
  markets_found: number;
  markets_created: number;
  markets_updated: number;
  markets_errored: number;
  duration_ms: number;
  error?: string;
}

export interface IngestionClients {
  kalshi: KalshiClient;
  gamma: GammaClient;
}

export interface IngestionRunOptions {
  marketLimit?: number;
  signal?: AbortSignal;
}

const KALSHI_MAX_PAGE_SIZE = 1000;
const POLYMARKET_MAX_PAGE_SIZE = 500;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const getMarketIdentifier = (
  platform: Platform,
  rawMarket: KalshiRawMarket | GammaMarket
): string => {
  if (platform === Platform.KALSHI) {
    return (rawMarket as KalshiRawMarket).ticker;
  }

  return (rawMarket as GammaMarket).conditionId;
};

const normalizeMarket = (
  platform: Platform,
  rawMarket: KalshiRawMarket | GammaMarket
): NormalizedMarketInput => {
  if (platform === Platform.KALSHI) {
    return normalizeKalshiMarket(rawMarket as KalshiRawMarket);
  }

  return normalizePolymarketMarket(rawMarket as GammaMarket);
};

const fetchMarkets = async (
  platform: Platform,
  clients: IngestionClients,
  options?: IngestionRunOptions
): Promise<Array<KalshiRawMarket | GammaMarket>> => {
  const marketLimit = options?.marketLimit;
  const signal = options?.signal;

  if (platform === Platform.KALSHI) {
    const requestLimit = marketLimit === undefined ? undefined : Math.min(marketLimit, KALSHI_MAX_PAGE_SIZE);
    const params: GetMarketsParams = {
      status: "open",
      mve_filter: "exclude",
      ...(requestLimit === undefined ? {} : { limit: requestLimit })
    };
    const fetchOptions = marketLimit === undefined ? undefined : { maxMarkets: marketLimit };
    return fetchAllKalshiMarkets(clients.kalshi, params, {
      ...fetchOptions,
      ...(signal ? { signal } : {})
    });
  }

  const requestLimit = marketLimit === undefined ? undefined : Math.min(marketLimit, POLYMARKET_MAX_PAGE_SIZE);
  const params: PolymarketGetMarketsParams = {
    active: true,
    closed: false,
    ...(requestLimit === undefined ? {} : { limit: requestLimit })
  };
  const fetchOptions = marketLimit === undefined ? undefined : { maxMarkets: marketLimit };
  return fetchAllPolymarketMarkets(clients.gamma, params, {
    ...fetchOptions,
    ...(signal ? { signal } : {})
  });
};

export const runIngestion = async (
  platform: Platform,
  db: BarbaraDb,
  clients: IngestionClients,
  options?: IngestionRunOptions
): Promise<IngestionRunResult> => {
  const startedAt = Date.now();
  let runId: number | undefined;

  try {
    const run = createIngestionRun(db, platform);
    runId = run.id;

    const rawMarkets = await fetchMarkets(platform, clients, options);
    let markets_created = 0;
    let markets_updated = 0;
    let markets_errored = 0;

    for (const rawMarket of rawMarkets) {
      try {
        const normalized = normalizeMarket(platform, rawMarket);
        const stored = upsertMarket(db, {
          ...normalized,
          resolution_hash: computeResolutionHash({
            resolution_rules: normalized.resolution_rules,
            resolution_source: normalized.resolution_source,
            close_time: normalized.close_time,
            outcome_labels: normalized.outcome_labels
          })
        });

        if (stored.created_at === stored.updated_at) {
          markets_created += 1;
        } else {
          markets_updated += 1;
        }
      } catch (error) {
        markets_errored += 1;
        logger.warn("Skipping market after per-market ingestion failure", {
          platform,
          market: getMarketIdentifier(platform, rawMarket),
          error: getErrorMessage(error)
        });
      }
    }

    completeIngestionRun(db, run.id, {
      markets_found: rawMarkets.length,
      markets_created,
      markets_updated
    });

    return {
      platform,
      status: "completed",
      markets_found: rawMarkets.length,
      markets_created,
      markets_updated,
      markets_errored,
      duration_ms: Date.now() - startedAt
    };
  } catch (error) {
    const message = getErrorMessage(error);

    if (runId !== undefined) {
      failIngestionRun(db, runId, message);
    }

    logger.error("Ingestion run failed", { platform, error: message });

    return {
      platform,
      status: "failed",
      markets_found: 0,
      markets_created: 0,
      markets_updated: 0,
      markets_errored: 0,
      duration_ms: Date.now() - startedAt,
      error: message
    };
  }
};

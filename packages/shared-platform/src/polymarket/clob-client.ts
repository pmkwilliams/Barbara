import { TokenBucket } from "../rate-limiter";
import { executeWithRetry } from "../retry";

import type {
  ClobBook,
  ClobLastTradePrice,
  ClobMidpoint,
  ClobPrice,
  ClobPriceHistory,
  ClobSimplifiedMarket,
  ClobSpread,
  ClobTickSize,
  PricesHistoryParams,
} from "./types";

const DEFAULT_BASE_URL = "https://clob.polymarket.com";
const MAX_BATCH_SIZE = 500;

type QueryPrimitive = string | number | boolean;
type QueryValue = QueryPrimitive | QueryPrimitive[] | undefined;

interface ClobPricesHistoryResponse {
  history?: ClobPriceHistory[];
  [key: string]: unknown;
}

function matchesEndpoint(path: string, endpoint: string): boolean {
  return path === endpoint || path.startsWith(`${endpoint}/`);
}

export class ClobClient {
  private readonly baseUrl: string;
  private readonly generalBucket: TokenBucket;
  private readonly endpointBuckets: Map<string, TokenBucket>;

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
    this.generalBucket = new TokenBucket(9000, 900);
    this.endpointBuckets = new Map<string, TokenBucket>([
      ["/book", new TokenBucket(1500, 150)],
      ["/books", new TokenBucket(500, 50)],
      ["/price", new TokenBucket(1500, 150)],
      ["/prices", new TokenBucket(500, 50)],
      ["/prices-history", new TokenBucket(500, 50)],
      ["/midpoint", new TokenBucket(1500, 150)],
      ["/midpoints", new TokenBucket(500, 50)],
      ["/tick-size", new TokenBucket(1500, 150)],
    ]);
  }

  private async acquireForEndpoint(path: string): Promise<void> {
    const endpointBucket = Array.from(this.endpointBuckets.entries()).find(
      ([endpoint]) => matchesEndpoint(path, endpoint)
    )?.[1];

    if (endpointBucket) {
      await endpointBucket.acquire();
    }

    await this.generalBucket.acquire();
  }

  private buildUrl(path: string, params?: Record<string, QueryValue>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (!params) {
      return url.toString();
    }

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: {
      params?: Record<string, QueryValue>;
      body?: unknown;
    }
  ): Promise<T> {
    await this.acquireForEndpoint(path);

    return executeWithRetry<T>(
      method,
      this.buildUrl(path, opts?.params),
      () => ({ "Content-Type": "application/json" }),
      opts?.body
    );
  }

  async getBook(tokenId: string): Promise<ClobBook> {
    return this.request<ClobBook>("GET", "/book", {
      params: { token_id: tokenId },
    });
  }

  async getBooks(tokenIds: string[]): Promise<ClobBook[]> {
    if (tokenIds.length > MAX_BATCH_SIZE) {
      throw new Error(`Maximum of ${MAX_BATCH_SIZE} token IDs allowed per request`);
    }

    return this.request<ClobBook[]>("POST", "/books", {
      body: tokenIds.map((tokenId) => ({ token_id: tokenId })),
    });
  }

  async getPrice(tokenId: string): Promise<ClobPrice> {
    return this.request<ClobPrice>("GET", "/price", {
      params: { token_id: tokenId },
    });
  }

  async getMidpoint(tokenId: string): Promise<ClobMidpoint> {
    return this.request<ClobMidpoint>("GET", "/midpoint", {
      params: { token_id: tokenId },
    });
  }

  async getSpread(tokenId: string): Promise<ClobSpread> {
    return this.request<ClobSpread>("GET", "/spread", {
      params: { token_id: tokenId },
    });
  }

  async getLastTradePrice(tokenId: string): Promise<ClobLastTradePrice> {
    return this.request<ClobLastTradePrice>("GET", "/last-trade-price", {
      params: { token_id: tokenId },
    });
  }

  async getPricesHistory(
    params: PricesHistoryParams
  ): Promise<ClobPriceHistory[]> {
    const response = await this.request<
      ClobPriceHistory[] | ClobPricesHistoryResponse
    >("GET", "/prices-history", { params });

    return Array.isArray(response) ? response : (response.history ?? []);
  }

  async getTickSize(tokenId: string): Promise<ClobTickSize> {
    return this.request<ClobTickSize>("GET", "/tick-size", {
      params: { token_id: tokenId },
    });
  }

  async getSimplifiedMarkets(): Promise<ClobSimplifiedMarket[]> {
    return this.request<ClobSimplifiedMarket[]>("GET", "/simplified-markets");
  }

  async getTime(): Promise<number> {
    const response = await this.request<number | { epoch: number } | { timestamp: number }>(
      "GET",
      "/time"
    );

    if (typeof response === "number") {
      return response;
    }

    if ("epoch" in response) {
      return response.epoch;
    }

    return response.timestamp;
  }
}

import { TokenBucket } from "../rate-limiter";
import { executeWithRetry } from "../retry";

import type {
  GammaEvent,
  GammaEventRaw,
  GammaMarket,
  GammaMarketRaw,
  GammaSearchResponse,
  GammaTag,
  GetEventsParams,
  GetMarketsParams,
  SearchParams,
} from "./types";

const DEFAULT_BASE_URL = "https://gamma-api.polymarket.com";
const DEFAULT_PAGE_LIMIT = 100;

type QueryPrimitive = string | number | boolean;
type QueryValue = QueryPrimitive | QueryPrimitive[] | undefined;

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseMarket(raw: GammaMarketRaw): GammaMarket {
  return {
    ...raw,
    outcomes: parseJsonArray(raw.outcomes),
    outcomePrices: parseJsonArray(raw.outcomePrices),
    clobTokenIds: parseJsonArray(raw.clobTokenIds),
  };
}

function parseEvent(raw: GammaEventRaw): GammaEvent {
  return {
    ...raw,
    markets: raw.markets.map(parseMarket),
  };
}

function matchesEndpoint(path: string, endpoint: string): boolean {
  return path === endpoint || path.startsWith(`${endpoint}/`);
}

export class GammaClient {
  private readonly baseUrl: string;
  private readonly generalBucket: TokenBucket;
  private readonly endpointBuckets: Map<string, TokenBucket>;

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
    this.generalBucket = new TokenBucket(4000, 400);
    this.endpointBuckets = new Map<string, TokenBucket>([
      ["/events", new TokenBucket(500, 50)],
      ["/markets", new TokenBucket(300, 30)],
      ["/public-search", new TokenBucket(350, 35)],
      ["/tags", new TokenBucket(200, 20)],
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
      signal?: AbortSignal;
    }
  ): Promise<T> {
    await this.acquireForEndpoint(path);

    return executeWithRetry<T>(
      method,
      this.buildUrl(path, opts?.params),
      () => ({ "Content-Type": "application/json" }),
      undefined,
      opts?.signal ? { signal: opts.signal } : undefined
    );
  }

  async getEvent(id: string): Promise<GammaEvent> {
    const rawEvent = await this.request<GammaEventRaw>("GET", `/events/${id}`);
    return parseEvent(rawEvent);
  }

  async getEvents(params?: GetEventsParams): Promise<GammaEvent[]> {
    const rawEvents = await this.request<GammaEventRaw[]>(
      "GET",
      "/events",
      params ? { params } : undefined
    );
    return rawEvents.map(parseEvent);
  }

  async getMarket(id: string): Promise<GammaMarket> {
    const rawMarket = await this.request<GammaMarketRaw>("GET", `/markets/${id}`);
    return parseMarket(rawMarket);
  }

  async getMarkets(
    params?: GetMarketsParams,
    options?: { signal?: AbortSignal }
  ): Promise<GammaMarket[]> {
    const rawMarkets = await this.request<GammaMarketRaw[]>(
      "GET",
      "/markets",
      {
        ...(params ? { params } : {}),
        ...(options?.signal ? { signal: options.signal } : {})
      }
    );
    return rawMarkets.map(parseMarket);
  }

  async getTags(): Promise<string[]> {
    const tags = await this.request<Array<string | GammaTag>>("GET", "/tags");
    return tags.map((tag) => {
      if (typeof tag === "string") {
        return tag;
      }

      return tag.label ?? tag.slug ?? tag.id;
    });
  }

  async search(query: string, params?: SearchParams): Promise<GammaMarket[]> {
    const response = await this.request<GammaSearchResponse>(
      "GET",
      "/public-search",
      {
        params: {
          q: query,
          ...params,
        },
      }
    );

    return (response.markets ?? []).map(parseMarket);
  }

  private async *paginate<TRaw, T>(
    path: string,
    params: Record<string, QueryValue> | undefined,
    parse: (raw: TRaw) => T,
    limit = DEFAULT_PAGE_LIMIT,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<T[]> {
    const pageSize = Number(params?.limit ?? limit);
    let offset = Number(params?.offset ?? 0);

    while (true) {
      const response = await this.request<TRaw[]>("GET", path, {
        params: {
          ...params,
          limit: pageSize,
          offset,
        },
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      const page = response.map(parse);

      if (page.length === 0) {
        return;
      }

      yield page;

      if (response.length < pageSize) {
        return;
      }

      offset += pageSize;
    }
  }

  async *paginateMarkets(
    params?: GetMarketsParams,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<GammaMarket[]> {
    yield* this.paginate<GammaMarketRaw, GammaMarket>(
      "/markets",
      params,
      parseMarket,
      params?.limit,
      options
    );
  }

  async *paginateEvents(
    params?: GetEventsParams
  ): AsyncGenerator<GammaEvent[]> {
    yield* this.paginate<GammaEventRaw, GammaEvent>(
      "/events",
      params,
      parseEvent,
      params?.limit
    );
  }
}

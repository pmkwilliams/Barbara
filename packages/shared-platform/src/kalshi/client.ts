import { KalshiAuth } from "./auth";
import { TokenBucket } from "./rate-limiter";
import type {
  GetExchangeStatusResponse,
  GetMarketResponse,
  GetMarketsParams,
  GetMarketsResponse,
  KalshiAccountLimits,
} from "./types";

const DEFAULT_BASE_URL =
  "https://api.elections.kalshi.com/trade-api/v2";
const DEFAULT_READ_LIMIT = 10;
const DEFAULT_WRITE_LIMIT = 5;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_JITTER_MS = 250;

export interface KalshiClientConfig {
  apiKeyId?: string;
  privateKeyPath?: string;
  baseUrl?: string;
}

export class KalshiClient {
  private readonly auth: KalshiAuth | null;
  private readonly readBucket: TokenBucket;
  private readonly writeBucket: TokenBucket;
  private readonly baseUrl: string;

  private constructor(
    auth: KalshiAuth | null,
    readBucket: TokenBucket,
    writeBucket: TokenBucket,
    baseUrl: string
  ) {
    this.auth = auth;
    this.readBucket = readBucket;
    this.writeBucket = writeBucket;
    this.baseUrl = baseUrl;
  }

  static async create(config: KalshiClientConfig = {}): Promise<KalshiClient> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    let auth: KalshiAuth | null = null;
    let readLimit = DEFAULT_READ_LIMIT;
    let writeLimit = DEFAULT_WRITE_LIMIT;

    if (config.apiKeyId && config.privateKeyPath) {
      const pem = await Bun.file(config.privateKeyPath).text();
      auth = new KalshiAuth(config.apiKeyId, pem);

      // Fetch account limits to learn rate tier
      try {
        const limitsUrl = `${baseUrl}/account/limits`;
        const signed = auth.signRequest({
          method: "GET",
          url: limitsUrl,
          headers: { "Content-Type": "application/json" },
        });

        const response = await fetch(signed.url, {
          method: "GET",
          headers: signed.headers ?? { "Content-Type": "application/json" },
        });

        if (response.ok) {
          const data = (await response.json()) as KalshiAccountLimits;
          readLimit = data.read_limit;
          writeLimit = data.write_limit;
        }
      } catch {
        // Fall back to defaults
      }
    }

    const readBucket = new TokenBucket(readLimit, readLimit);
    const writeBucket = new TokenBucket(writeLimit, writeLimit);

    return new KalshiClient(auth, readBucket, writeBucket, baseUrl);
  }

  private isWriteRequest(method: string, path: string): boolean {
    const isWriteMethod = ["POST", "PUT", "DELETE"].includes(
      method.toUpperCase()
    );
    return isWriteMethod && path.startsWith("/portfolio/orders");
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: {
      params?: Record<string, string | number | undefined>;
      body?: unknown;
      requireAuth?: boolean;
    }
  ): Promise<T> {
    // Build URL with query params
    let url = `${this.baseUrl}${path}`;

    if (opts?.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url = `${url}?${qs}`;
      }
    }

    // Classify and acquire rate limit token
    const isWrite = this.isWriteRequest(method, path);
    const bucket = isWrite ? this.writeBucket : this.readBucket;
    await bucket.acquire();

    // Build a function that produces fresh signed headers on each call,
    // so retries get a fresh timestamp instead of reusing a stale signature.
    const requireAuth = opts?.requireAuth ?? true;
    const buildHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.auth && requireAuth) {
        const bodyStr =
          opts?.body !== undefined ? JSON.stringify(opts.body) : undefined;

        const signInput: {
          method: string;
          url: string;
          headers: Record<string, string>;
          body?: string;
        } = { method, url, headers };

        if (bodyStr !== undefined) {
          signInput.body = bodyStr;
        }

        const signed = this.auth.signRequest(signInput);
        if (signed.headers) {
          return signed.headers;
        }
      }

      return headers;
    };

    return this.executeWithRetry<T>(method, url, buildHeaders, opts?.body);
  }

  private async executeWithRetry<T>(
    method: string,
    url: string,
    buildHeaders: () => Record<string, string>,
    body?: unknown
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const headers = buildHeaders();
        const fetchOpts: RequestInit = { method, headers };
        if (body !== undefined) {
          fetchOpts.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOpts);

        if (response.ok) {
          return (await response.json()) as T;
        }

        const responseText = await response.text();
        const error = new Error(`HTTP ${response.status}: ${responseText}`);

        if (!this.isRetryableStatus(response.status)) {
          throw error;
        }

        lastError = error;

        if (attempt < MAX_RETRIES) {
          const delay = this.calculateDelay(
            attempt,
            response.status === 429
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        if (error instanceof TypeError) {
          // Network error — retryable
          lastError = error;

          if (attempt < MAX_RETRIES) {
            const delay = this.calculateDelay(attempt, false);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } else {
          throw error;
        }
      }
    }

    throw lastError ?? new Error("Request failed after max retries");
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 504);
  }

  private calculateDelay(attempt: number, is429: boolean): number {
    const baseDelay = BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * MAX_JITTER_MS;
    const multiplier = is429 ? 2 : 1;
    return baseDelay * multiplier + jitter;
  }

  async getExchangeStatus(): Promise<GetExchangeStatusResponse> {
    return this.request<GetExchangeStatusResponse>(
      "GET",
      "/exchange/status",
      { requireAuth: false }
    );
  }

  async getMarkets(params?: GetMarketsParams): Promise<GetMarketsResponse> {
    return this.request<GetMarketsResponse>("GET", "/markets", {
      ...(params
        ? { params: params as Record<string, string | number | undefined> }
        : {}),
      requireAuth: false,
    });
  }

  async getMarket(ticker: string): Promise<GetMarketResponse> {
    return this.request<GetMarketResponse>(
      "GET",
      `/markets/${ticker}`,
      { requireAuth: false }
    );
  }
}

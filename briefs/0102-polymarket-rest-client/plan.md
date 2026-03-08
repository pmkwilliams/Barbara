# Plan: Polymarket REST Client

## Approach

Extract shared infra (TokenBucket, retry) from Kalshi, then build GammaClient and ClobClient on top. No auth needed — simpler than Kalshi. Primary complexity is per-endpoint rate limiting and offset pagination.

## Shared Infrastructure Refactoring

### `shared-platform/src/rate-limiter.ts` (move)

Move `TokenBucket` class verbatim from `kalshi/rate-limiter.ts` → `src/rate-limiter.ts`. Delete `kalshi/rate-limiter.ts`. Update `kalshi/index.ts`: remove `export * from "./rate-limiter"` line. Update `kalshi/client.ts` import to `from "../rate-limiter"`. Update `test/kalshi/rate-limiter.test.ts` import to `../../src/rate-limiter`. TokenBucket now exported from `src/index.ts` at the shared level.

### `shared-platform/src/retry.ts` (extract)

Extract from `KalshiClient` into standalone function:

```ts
export interface RetryOptions {
  maxRetries?: number;     // default 3
  baseDelayMs?: number;    // default 500
  maxJitterMs?: number;    // default 250
}

export async function executeWithRetry<T>(
  method: string,
  url: string,
  buildHeaders: () => Record<string, string>,
  body?: unknown,
  options?: RetryOptions
): Promise<T>
```

Also export: `isRetryableStatus(status: number): boolean`, `calculateBackoff(attempt: number, is429: boolean, baseDelayMs: number, maxJitterMs: number): number`.

Preserve exact error message format from Kalshi implementation (`HTTP ${status}: ${responseText}`) so existing Kalshi tests pass without assertion changes.

Update `KalshiClient`: remove private `executeWithRetry`, `isRetryableStatus`, `calculateDelay` methods and constants (`MAX_RETRIES`, `BASE_DELAY_MS`, `MAX_JITTER_MS`). Import and call `executeWithRetry` from `../retry` in `request()`.

### `shared-platform/src/index.ts`

Add exports: `export * from "./rate-limiter"`, `export * from "./retry"`, `export * from "./polymarket"`.

## Polymarket Types

### `shared-platform/src/polymarket/types.ts`

**Gamma event (raw from API):**
```ts
export interface GammaEventRaw {
  id: string;
  slug: string;
  title: string;
  description: string;
  markets: GammaMarketRaw[];
  [key: string]: unknown;
}
```

**Gamma event (parsed — what client returns):**
```ts
export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  markets: GammaMarket[];
  [key: string]: unknown;
}
```

**Gamma market (raw from API):**
```ts
export interface GammaMarketRaw {
  id: string;                 // numeric string
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string;           // JSON-encoded: '["Yes","No"]'
  outcomePrices: string;      // JSON-encoded: '["0.65","0.35"]'
  clobTokenIds: string;       // JSON-encoded: '["123","456"]'
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
```

**Gamma market (parsed — what client returns):**
```ts
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
  category: string;
  resolutionSource: string;
  groupItemTitle: string;
  enableOrderBook: boolean;
  [key: string]: unknown;
}
```

Private `parseMarket(raw: GammaMarketRaw): GammaMarket` — `JSON.parse()` on `outcomes`, `outcomePrices`, `clobTokenIds`. Applied to all market data including markets embedded inside event responses.

Private `parseEvent(raw: GammaEventRaw): GammaEvent` — runs `parseMarket` on each embedded market.

**CLOB types:**
```ts
export interface ClobBook {
  market: string;
  asset_id: string;
  bids: ClobBookEntry[];
  asks: ClobBookEntry[];
  hash: string;
  timestamp: string;
}
export interface ClobBookEntry { price: string; size: string; }
export interface ClobPrice { price: string; }
export interface ClobMidpoint { mid: string; }
export interface ClobSpread { spread: string; }
export interface ClobTickSize { minimum_tick_size: string; }
```

### `shared-platform/src/api-types.ts`

Populate `PolymarketRawMarket` with key fields from `GammaMarket` (the parsed version). Replace the empty stub. Include `[key: string]: unknown` catch-all like `KalshiRawMarket`.

## GammaClient

### `shared-platform/src/polymarket/gamma-client.ts`

**Rate limiting — two-tier bucket system:**
Each request acquires from BOTH an endpoint-specific bucket AND the general bucket. Endpoints without a specific bucket (e.g., a single event by ID) hit only the general bucket.

| Bucket | Capacity | Refill/s |
|--------|----------|----------|
| general | 4000 | 400 |
| /events | 500 | 50 |
| /markets | 300 | 30 |
| /public-search | 350 | 35 |
| /tags | 200 | 20 |

Store as `Map<string, TokenBucket>` keyed by path prefix. `acquireForEndpoint(path)` resolves the matching endpoint bucket (if any), acquires from it + general.

**Client shape:**
```ts
export class GammaClient {
  private readonly baseUrl: string;  // https://gamma-api.polymarket.com
  private readonly generalBucket: TokenBucket;
  private readonly endpointBuckets: Map<string, TokenBucket>;

  constructor(baseUrl?: string)  // public, no async init needed (no auth)

  private async request<T>(method: string, path: string, opts?: {
    params?: Record<string, string | number | undefined>;
  }): Promise<T>

  // Endpoint methods
  async getEvent(id: string): Promise<GammaEvent>
  async getEvents(params?: GetEventsParams): Promise<GammaEvent[]>
  async getMarket(id: string): Promise<GammaMarket>
  async getMarkets(params?: GetMarketsParams): Promise<GammaMarket[]>
  async getTags(): Promise<string[]>
  async search(query: string, params?: SearchParams): Promise<GammaMarket[]>

  // Pagination — generic internal helper, two public methods
  private async *paginate<TRaw, T>(
    path: string,
    params: Record<string, string | number | undefined> | undefined,
    parse: (raw: TRaw) => T,
    limit?: number
  ): AsyncGenerator<T[]>

  async *paginateMarkets(params?: GetMarketsParams): AsyncGenerator<GammaMarket[]>
  async *paginateEvents(params?: GetEventsParams): AsyncGenerator<GammaEvent[]>
```

Public constructor — no `static create()` factory needed (no async initialization, no auth).

`paginate` — private generic async generator. Takes path, params, a parse function, and optional limit (default 100). Handles offset increment and end-of-results detection (`response.length < limit`). `paginateMarkets` passes `parseMarket`, `paginateEvents` passes `parseEvent`.

`getMarkets` / `getEvents` return a single page. `paginateMarkets` / `paginateEvents` handle full iteration.

`request<T>` acquires rate limit tokens then calls shared `executeWithRetry<T>()`. `buildHeaders` returns `{ "Content-Type": "application/json" }` (no auth).

Market/event-returning methods apply `parseMarket`/`parseEvent` to raw API responses.

## ClobClient

### `shared-platform/src/polymarket/clob-client.ts`

**Rate limiting:**

| Bucket | Capacity | Refill/s |
|--------|----------|----------|
| general | 9000 | 900 |
| /book | 1500 | 150 |
| /books | 500 | 50 |
| /price | 1500 | 150 |
| /prices | 500 | 50 |
| /midpoint | 1500 | 150 |
| /midpoints | 500 | 50 |

Same two-tier approach. Endpoints not listed above (`/spread`, `/last-trade-price`, `/prices-history`, `/tick-size`, `/simplified-markets`, `/time`) use only the general bucket.

**Client shape:**
```ts
export class ClobClient {
  constructor(baseUrl?: string)  // public, no auth

  async getBook(tokenId: string): Promise<ClobBook>
  async getBooks(tokenIds: string[]): Promise<ClobBook[]>  // POST /books, ≤500
  async getPrice(tokenId: string): Promise<ClobPrice>
  async getMidpoint(tokenId: string): Promise<ClobMidpoint>
  async getSpread(tokenId: string): Promise<ClobSpread>
  async getLastTradePrice(tokenId: string): Promise<ClobLastTradePrice>
  async getPricesHistory(params: PricesHistoryParams): Promise<ClobPriceHistory[]>
  async getTickSize(tokenId: string): Promise<ClobTickSize>
  async getSimplifiedMarkets(): Promise<ClobSimplifiedMarket[]>
  async getTime(): Promise<number>
```

`getBooks` is `POST /books` but a read operation — rate limited under `/books` bucket + general.

## File Changes Summary

| File | Action |
|------|--------|
| `src/rate-limiter.ts` | **Create** — TokenBucket moved here |
| `src/retry.ts` | **Create** — executeWithRetry + helpers extracted here |
| `src/kalshi/rate-limiter.ts` | **Delete** — moved to `src/rate-limiter.ts` |
| `src/kalshi/index.ts` | **Edit** — remove `export * from "./rate-limiter"` |
| `src/kalshi/client.ts` | **Edit** — import TokenBucket from `../rate-limiter`, import executeWithRetry from `../retry`, remove private retry methods/constants |
| `src/api-types.ts` | **Edit** — populate PolymarketRawMarket |
| `src/polymarket/types.ts` | **Create** — Gamma + CLOB response types (raw and parsed) |
| `src/polymarket/gamma-client.ts` | **Create** |
| `src/polymarket/clob-client.ts` | **Create** |
| `src/polymarket/index.ts` | **Create** — re-export all |
| `src/index.ts` | **Edit** — add `./rate-limiter`, `./retry`, `./polymarket` exports |
| `test/polymarket/gamma-client.test.ts` | **Create** |
| `test/polymarket/clob-client.test.ts` | **Create** |
| `test/kalshi/rate-limiter.test.ts` | **Edit** — update import path to `../../src/rate-limiter` |
| `test/kalshi/client.test.ts` | **Verify** — should pass unchanged since shared retry preserves error message format; run to confirm |
| `tsconfig.json` (shared-platform) | **Edit** — add `"test"` to include array |

## Tests

### `test/polymarket/gamma-client.test.ts`
- `getEvent(id)` — mock fetch returns single event JSON with embedded raw markets, verify typed response with parsed market arrays
- `paginateMarkets` — mock fetch returns 2 pages (first page full, second page partial → stops), verify all markets collected and JSON-encoded fields parsed
- `getMarkets` — verify query params serialized correctly

### `test/polymarket/clob-client.test.ts`
- `getBook(tokenId)` — mock fetch returns orderbook JSON, verify typed response with bids/asks
- `getBooks(tokenIds)` — verify POST method used, body contains token IDs

### Retry (tested through Polymarket clients)
- Mock fetch to return 500 twice then 200 — verify 3 calls total and success
- Mock fetch to return 500 always — verify max retries exhausted, throws

### Existing Kalshi tests
- `test/kalshi/rate-limiter.test.ts` — import path updated, same assertions
- `test/kalshi/client.test.ts` — unchanged, verify passes after retry extraction

## Verification
```
bun test
```
All existing Kalshi tests must continue passing. New Polymarket tests must pass. No type errors.

## Critical Files to Read Before Implementation
- `src/kalshi/client.ts` — exact retry logic to extract (lines 156–221: executeWithRetry, isRetryableStatus, calculateDelay)
- `src/kalshi/rate-limiter.ts` — TokenBucket to move (60 lines, verbatim)
- `src/kalshi/index.ts` — needs rate-limiter re-export removed
- `src/api-types.ts` — PolymarketRawMarket stub to populate
- `test/kalshi/client.test.ts` — verify error message assertions match shared retry output
- `test/kalshi/rate-limiter.test.ts` — import path to update

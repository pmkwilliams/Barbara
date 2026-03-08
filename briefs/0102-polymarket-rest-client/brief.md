# Polymarket REST Client

HTTP clients for Gamma API (market/event metadata) and CLOB API (orderbook/pricing). No auth needed for read endpoints. Self-enforced rate limiting. Retry with exponential backoff.

## Context

Polymarket has 3 REST APIs. This brief covers the two needed for ingestion and price monitoring:

- **Gamma API** (`https://gamma-api.polymarket.com`) — public, no auth. Market metadata: titles, descriptions, outcomes, resolution sources, categories, condition IDs, CLOB token IDs. Primary source for matching (Phase 2) and ingestion (brief 0105).
- **CLOB API** (`https://clob.polymarket.com`) — public read endpoints, no auth. Orderbook, pricing, midpoints, spreads, tick sizes. Needed for Phase 3 (price monitoring) and Phase 4 (detection).

Not in scope: Data API, CLOB authenticated endpoints (orders), EIP-712 signing, WebSocket feeds.

## Key API Details

### Gamma API

Endpoints: `GET /events`, `GET /events/{id}`, `GET /markets`, `GET /markets/{id}`, `GET /tags`, `GET /public-search`.

Pagination: offset-based (`limit` + `offset`). Last page detected when `response.length < limit`.

Response quirks: `outcomes`, `outcomePrices`, `clobTokenIds` are **JSON-encoded strings** not arrays — must `JSON.parse()`. Market `id` is numeric but returned as string.

Rate limits (Cloudflare, sliding 10s windows):
- General: 4,000/10s
- `/events`: 500/10s
- `/markets`: 300/10s
- `/public-search`: 350/10s
- `/tags`: 200/10s

### CLOB API (public read only)

Endpoints: `GET /book`, `POST /books` (batch ≤500), `GET /price`, `GET /midpoint`, `GET /spread`, `GET /last-trade-price`, `GET /prices-history`, `GET /tick-size`, `GET /simplified-markets`, `GET /time`.

All prices/sizes are strings. `token_id` param maps to Gamma's `clobTokenIds`.

Rate limits (Cloudflare, sliding 10s windows):
- General: 9,000/10s
- `/book`: 1,500/10s, `/books`: 500/10s
- `/price`: 1,500/10s, `/prices`: 500/10s
- `/midpoint`: 1,500/10s, `/midpoints`: 500/10s

### Rate Limiting

Cloudflare throttles (delays requests) rather than returning 429s. No `X-RateLimit-*` headers. Client must self-enforce via request counting. Per-endpoint budgets tracked independently.

## Existing Code & Patterns

Kalshi client (branch `0101-kalshi-rest-client`) establishes the patterns to follow:

- **Location**: platform clients live in `shared-platform/src/<platform>/` (e.g., `kalshi/client.ts`, `kalshi/auth.ts`, `kalshi/types.ts`)
- **TokenBucket** (`shared-platform/src/kalshi/rate-limiter.ts`): generic token-bucket rate limiter with `acquire()` (waits) and `tryAcquire()` (non-blocking). Serializes concurrent callers via promise chain. Not Kalshi-specific at all.
- **Retry**: inline `executeWithRetry()` in client — exponential backoff (`500ms * 2^attempt`), jitter (0–250ms), retries on 429 + 5xx + network errors, max 3 retries. Re-signs auth headers on each attempt via callback.
- **Client shape**: private `request<T>(method, path, opts)` → public endpoint methods. Static `create()` factory.
- **Types**: raw API response types in `shared-platform/src/api-types.ts` (e.g., `KalshiRawMarket`), client-specific types in `kalshi/types.ts`.
- **Exports**: re-exported via `shared-platform/src/kalshi/index.ts` → `shared-platform/src/index.ts`.

Other existing code:
- `packages/polymarket/` exists but empty (no `package.json`, empty `src/`) — unused, client goes in `shared-platform` per Kalshi pattern
- `@barbara/core` config loads `POLYMARKET_API_KEY` and `POLYMARKET_PRIVATE_KEY` from env (unused by this brief, available for future auth brief)
- Empty `PolymarketRawMarket` stub in `shared-platform/src/api-types.ts`
- Bun runtime — use native `fetch`, no HTTP library needed

## Scope

### Build

**In `shared-platform/src/polymarket/`** (following Kalshi pattern):
- `gamma-client.ts` — typed methods for events, markets, tags, search; offset pagination helper
- `clob-client.ts` — typed methods for public read endpoints (book, price, midpoint, spread, tick-size, simplified-markets)
- `types.ts` — Gamma and CLOB response types
- `index.ts` — re-export

**Shared infra** (refactor from Kalshi):
- Move `TokenBucket` from `kalshi/rate-limiter.ts` to `shared-platform/src/rate-limiter.ts` — both clients use it. Polymarket uses one bucket per endpoint with capacity = documented limit per 10s window, refill = capacity/10 per second.
- Extract retry utility (`executeWithRetry`, backoff calculation, retryable status check) to `shared-platform/src/retry.ts` — both clients use it. Accepts a `buildHeaders` callback so each platform can re-sign on retry.

**Types**: populate `PolymarketRawMarket` in `api-types.ts` with key Gamma market fields. Detailed Gamma/CLOB response types in `polymarket/types.ts`.

**Tests** in `shared-platform/test/polymarket/`:
- Gamma client: fetch event by ID, paginate markets (mock fetch responses)
- CLOB client: fetch orderbook by token ID
- Rate limiter: verify delays when budget exhausted
- Retry: verify backoff on simulated 5xx

### Defer
- CLOB authenticated endpoints (L2 HMAC, orders) → Phase 5
- EIP-712 order signing → Phase 5
- Data API → not needed for matching
- WebSocket feeds → Phase 3
- CLOB cursor-based pagination (authenticated trade/order queries)

## Done When

- `GammaClient` fetches a single event by ID with typed response
- `GammaClient` paginates through active markets
- `ClobClient` fetches orderbook for a token ID
- Rate limiter delays requests approaching per-endpoint budget
- Retry handles simulated 5xx with backoff
- `TokenBucket` and retry utility are shared, Kalshi client updated to import from new locations
- All tests pass with `bun test`

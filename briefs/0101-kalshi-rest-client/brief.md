# Kalshi REST Client

## Problem

No HTTP client exists for the Kalshi API. Downstream work (market fetcher 0104, execution engine) needs authenticated requests with rate limiting and retry. Kalshi uses stateless RSA-PSS per-request signing — no sessions, no tokens.

## Scope

Lives in `packages/shared-platform` — shared code imported by both `ingestion` and `runtime`.

### Auth: `KalshiAuth`

Implements `PlatformAuthProvider` from `shared-platform/auth.ts`. RSA-PSS with SHA-256 per-request signing.

**Signing algorithm:**
- Message: `{timestamp_ms}{HTTP_METHOD}{path_without_query_params}` (strip query string before signing)
- Sign with RSA-PSS, SHA-256 hash, MGF1-SHA-256, salt length = digest length (32 bytes)
- Base64-encode the signature

**Three headers on every authenticated request:**

| Header | Value |
|--------|-------|
| `KALSHI-ACCESS-KEY` | API Key ID (UUID from env) |
| `KALSHI-ACCESS-TIMESTAMP` | Current time in ms since epoch |
| `KALSHI-ACCESS-SIGNATURE` | Base64-encoded RSA-PSS signature |

Constructor takes API key ID + PEM private key content (read from file by the client, not the auth provider). Use Node `crypto.createSign('RSA-SHA256')` with PSS padding — available in Bun's Node compat layer.

### HTTP Client: `KalshiClient`

Wraps `fetch` with auth, rate limiting, retry. Constructor takes config (key ID, private key path, base URL).

**Init sequence:**
1. Read PEM file from `KALSHI_PRIVATE_KEY_PATH`
2. Instantiate `KalshiAuth` with key ID + PEM content
3. Query `GET /account/limits` to learn rate tier (read/write limits per second)
4. Initialize token buckets

**Request flow:**
1. Classify request as read or write (write = POST/PUT/DELETE to `/portfolio/orders*` endpoints only; all else is read)
2. Acquire token from appropriate bucket (block until available)
3. Sign request via `KalshiAuth`
4. Execute fetch
5. On transient failure → retry with backoff
6. Return typed response or throw

**Rate limiting — client-side token buckets:**
- Separate read and write buckets
- Bucket capacity + refill rate set from `GET /account/limits` response (e.g. Basic: 20 reads/s, 10 writes/s)
- Refill 1 token per `1000/limit` ms
- If bucket empty, delay request until next token available
- Fallback defaults if limits endpoint fails: 10 reads/s, 5 writes/s (conservative)

**Retry with exponential backoff:**
- Retry on: HTTP 429, 500, 502, 503, 504, network errors (`TypeError` from fetch)
- Max 3 retries
- Backoff: 500ms → 1s → 2s (with jitter)
- On 429: double the backoff
- No retry on 4xx (except 429) — these are caller errors

**Base URLs:**

| Env | URL |
|-----|-----|
| Production (default) | `https://api.elections.kalshi.com/trade-api/v2` |
| Demo | `https://demo-api.kalshi.co/trade-api/v2` |

Configurable via `KALSHI_BASE_URL` env var. Defaults to production.

### Endpoint methods (minimal set)

Only what's needed to validate the client works + unblock 0104:

- `getMarkets(params?)` — `GET /markets`. Params: `limit`, `cursor`, `status`, `event_ticker`, `series_ticker`. Returns `{ markets: KalshiRawMarket[], cursor: string }`.
- `getMarket(ticker)` — `GET /markets/{ticker}`. Returns `{ market: KalshiRawMarket }`.
- `getExchangeStatus()` — `GET /exchange/status`. No auth required. Good smoke test.

Future endpoint methods (orders, balance, positions) added in execution briefs.

### `KalshiRawMarket` type

Populate the empty stub in `shared-platform/api-types.ts`. Key fields:

```typescript
interface KalshiRawMarket {
  ticker: string;
  event_ticker: string;
  market_type: "binary" | "scalar";
  title: string;
  yes_sub_title: string;
  no_sub_title: string;
  status: string; // "active" | "closed" | "determined" | "finalized" | etc.
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
  // Remaining fields typed loosely — tightened as needed by consumers
  [key: string]: unknown;
}
```

### Config changes

Add to `Config` interface and `loadConfig()` in `core/config.ts`:

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `KALSHI_PRIVATE_KEY_PATH` | No | undefined | Path to `.key` PEM file |
| `KALSHI_BASE_URL` | No | `https://api.elections.kalshi.com/trade-api/v2` | Override for demo env |

Keep `KALSHI_API_KEY` as-is (it's the Key ID UUID). Remove `KALSHI_API_SECRET` (not used — auth uses PEM file). Update `.env.example`.

### File structure

```
packages/shared-platform/src/
  kalshi/
    auth.ts          KalshiAuth (implements PlatformAuthProvider)
    client.ts        KalshiClient (HTTP wrapper + rate limiting + retry)
    rate-limiter.ts  TokenBucket (generic, reusable for Polymarket later)
    types.ts         KalshiRawMarket + API response shapes
    index.ts         barrel export
  index.ts           updated to re-export kalshi/
```

### Tests

- **Unit: signing** — Sign a known message with a test RSA key, verify signature matches expected output. Test that query params are stripped before signing.
- **Unit: token bucket** — Verify tokens deplete and refill at correct rate. Verify blocking behavior when empty.
- **Unit: retry** — Mock fetch to return 500 then 200, verify retry count and backoff timing.
- **Integration: demo API** — Call `getExchangeStatus()` (no auth). Call `getMarkets({ limit: 1 })` (no auth needed for this endpoint either). If demo credentials available, call an authenticated endpoint.

## Non-goals

- Order placement / execution endpoints (Phase 5)
- WebSocket client (brief 03xx)
- Polymarket client (0102)
- Market normalization logic (0104)
- Persistent rate limit state across restarts

## Done when

- `KalshiAuth.signRequest()` produces valid signatures (unit test with known key/message pair)
- `KalshiClient.getMarkets()` returns typed market data from demo or production API
- Token bucket correctly throttles requests to configured limit
- Retry logic handles 500/429 with exponential backoff (unit test with mocked fetch)
- `KalshiRawMarket` type populated with key fields from API spec

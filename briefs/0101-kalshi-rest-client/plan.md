# Plan: Kalshi REST Client

## File tree

**New files:**
```
packages/shared-platform/src/
  kalshi/
    auth.ts              KalshiAuth implements PlatformAuthProvider
    client.ts            KalshiClient — fetch wrapper with rate limiting + retry
    rate-limiter.ts      TokenBucket — generic, reusable for Polymarket later
    types.ts             API response wrappers (GetMarketsResponse, etc.)
    index.ts             barrel export
  
packages/shared-platform/test/
  kalshi/
    auth.test.ts         signing correctness, query param stripping
    rate-limiter.test.ts token depletion, refill, blocking
    client.test.ts       retry behavior with mocked fetch
```

**Modified files:**
```
packages/shared-platform/src/api-types.ts    populate KalshiRawMarket
packages/shared-platform/src/index.ts        add re-export of ./kalshi
packages/core/src/config.ts                  add 2 env vars, remove KALSHI_API_SECRET
.env.example                                 update Kalshi section
```

## Key implementation details

### `KalshiRawMarket` (`shared-platform/src/api-types.ts`)

Populate the empty stub in place. Keep `PolymarketRawMarket` unchanged. Key typed fields: `ticker`, `event_ticker`, `market_type`, `title`, `yes_sub_title`, `no_sub_title`, `status`, `open_time`, `close_time`, `latest_expiration_time`, `result`, pricing `_dollars` fields (all strings), `volume`/`volume_24h`/`open_interest` (numbers), `rules_primary`, `rules_secondary`, `can_close_early`. Index signature `[key: string]: unknown` for forward compat with untyped fields.

### `kalshi/types.ts` — response wrappers

Imports `KalshiRawMarket` from `../api-types`. Defines:

```ts
type GetMarketsResponse = { markets: KalshiRawMarket[]; cursor: string }
type GetMarketResponse = { market: KalshiRawMarket }
type GetExchangeStatusResponse = { exchange_active: boolean; trading_active: boolean }
type KalshiAccountLimits = { usage_tier: string; read_limit: number; write_limit: number }
type GetMarketsParams = { limit?: number; cursor?: string; status?: string; event_ticker?: string; series_ticker?: string }
```

### `kalshi/rate-limiter.ts` — `TokenBucket`

Generic rate limiter, not Kalshi-specific. Timestamp-based token calculation (no `setInterval`).

```ts
class TokenBucket {
  constructor(capacity: number, refillRatePerSecond: number)
  async acquire(): Promise<void>    // waits if empty
  tryAcquire(): boolean             // non-blocking
}
```

Internal state: `tokens` (float), `lastRefillTime` (ms timestamp). On each access, compute elapsed time since last refill, add `elapsed * refillRate / 1000` tokens (capped at capacity), update timestamp. If `tokens < 1` in `acquire()`, compute wait time = `(1 - tokens) / refillRate * 1000` ms, `await` a setTimeout promise, then deduct. No timers running when idle.

### `kalshi/auth.ts` — `KalshiAuth`

Implements `PlatformAuthProvider`. Constructor: `(apiKeyId: string, privateKeyPem: string)`.

**`getHeaders()`** — returns static header `{ "KALSHI-ACCESS-KEY": this.apiKeyId }`. Timestamp/signature are per-request so they go in `signRequest`.

**`signRequest(request: SignRequestInput)`:**
1. `timestamp = Date.now().toString()`
2. Extract path from `request.url` via `new URL(request.url).pathname` — strips query params and host
3. Message string: `${timestamp}${request.method.toUpperCase()}${path}`
4. Sign with `crypto.createSign('RSA-SHA256')` using PSS padding:
   ```ts
   import crypto from "node:crypto";
   sign.update(message);
   sign.end();
   const signature = sign.sign({
     key: this.privateKeyPem,
     padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
     saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
   });
   ```
5. Return new `SignRequestInput` with merged headers: original + `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE` (base64).

### `kalshi/client.ts` — `KalshiClient`

**Static factory** because init is async (file read + HTTP call):

```ts
static async create(config: KalshiClientConfig): Promise<KalshiClient>
```

`KalshiClientConfig`:
```ts
{
  apiKeyId?: string;           // KALSHI_API_KEY
  privateKeyPath?: string;     // KALSHI_PRIVATE_KEY_PATH
  baseUrl?: string;            // defaults to production
}
```

Private constructor. Auth is optional — if `apiKeyId` and `privateKeyPath` both provided, create `KalshiAuth` instance. Otherwise public-only mode.

**Init sequence in `create()`:**
1. If `privateKeyPath` provided: read PEM via `Bun.file(path).text()`
2. If both auth fields present: instantiate `KalshiAuth`
3. If authenticated: call `GET /account/limits` to get tier limits, catch errors and fall back to defaults (10 reads/s, 5 writes/s)
4. Create read + write `TokenBucket` instances
5. Return new `KalshiClient(auth, readBucket, writeBucket, baseUrl)`

**Core `request<T>()` method:**

```ts
private async request<T>(method: string, path: string, opts?: {
  params?: Record<string, string | number | undefined>;
  body?: unknown;
  requireAuth?: boolean;
}): Promise<T>
```

Flow:
1. Build full URL: `${this.baseUrl}${path}` + query params (filter out undefined values)
2. Classify read vs write: write if method is POST/PUT/DELETE AND path starts with `/portfolio/orders`; else read
3. `await` appropriate token bucket `acquire()`
4. If auth available and not explicitly skipped: `await this.auth.signRequest({ method, url, headers, body })`
5. Call `fetch(url, { method, headers, body })` via `executeWithRetry()`
6. Parse JSON, return typed

**Retry logic** (private method or inline):
- Retryable conditions: status 429, 500, 502, 503, 504, or `TypeError` (network failure)
- Max 3 retries
- Base delay 500ms, doubles each retry (500 → 1000 → 2000), plus random jitter (0–250ms)
- On 429: additional 2x multiplier on delay
- Non-retryable 4xx: throw immediately with status + body
- After exhausting retries: throw last error

**Public endpoint methods:**

```ts
async getExchangeStatus(): Promise<GetExchangeStatusResponse>
  // GET /exchange/status, requireAuth: false

async getMarkets(params?: GetMarketsParams): Promise<GetMarketsResponse>
  // GET /markets, requireAuth: false (public endpoint)

async getMarket(ticker: string): Promise<GetMarketResponse>
  // GET /markets/${ticker}, requireAuth: false
```

All three are public endpoints per Kalshi docs — no auth required. The `requireAuth` flag defaults to `true` for future authenticated endpoints; these three override to `false`.

### Config changes (`core/src/config.ts`)

Remove `KALSHI_API_SECRET` from `Config` interface and `loadConfig()`. Add:

```ts
KALSHI_PRIVATE_KEY_PATH: string | undefined;   // readOptionalEnv
KALSHI_BASE_URL: string;                       // default "https://api.elections.kalshi.com/trade-api/v2"
```

### `.env.example`

```
# Kalshi API credentials
KALSHI_API_KEY=
KALSHI_PRIVATE_KEY_PATH=
KALSHI_BASE_URL=https://api.elections.kalshi.com/trade-api/v2
```

Remove `KALSHI_API_SECRET` line.

### Barrel exports

`kalshi/index.ts`: re-export everything from `./auth`, `./client`, `./rate-limiter`, `./types`.

`shared-platform/src/index.ts`: add `export * from "./kalshi"`.

### Tests

**`test/kalshi/auth.test.ts`:**
- Generate a test RSA key pair at test setup via `crypto.generateKeyPairSync('rsa', { modulusLength: 2048, ... })`
- Test: sign a fixed message, verify signature with corresponding public key using `crypto.createVerify` with PSS params — confirms the signing code produces valid RSA-PSS signatures
- Test: two calls with same timestamp/method/path produce different signatures (PSS is probabilistic due to random salt)
- Test: `signRequest` strips query params — sign `/markets?limit=10`, extract the signed message, confirm it used `/markets` not `/markets?limit=10`
- Test: all three `KALSHI-ACCESS-*` headers present in signed output
- Test: `getHeaders()` returns only `KALSHI-ACCESS-KEY`

**`test/kalshi/rate-limiter.test.ts`:**
- Test: acquire N tokens from bucket of capacity N succeeds without delay
- Test: acquire from empty bucket delays approximately `1/refillRate` seconds (use `performance.now()` delta)
- Test: `tryAcquire` returns false on empty bucket, true when tokens available
- Test: tokens refill over time — deplete bucket, wait, confirm partial refill

**`test/kalshi/client.test.ts`:**
- Mock `globalThis.fetch` for all tests, restore in afterEach
- Test: retry on 500 — mock returns 500 twice then 200, verify 3 total fetch calls, correct response returned
- Test: no retry on 400 — mock returns 400, verify single fetch call, error thrown
- Test: retry on 429 — mock returns 429 then 200, verify fetch called twice
- Test: network error retry — mock throws `TypeError`, then returns 200
- Test: max retries exhausted — mock returns 500 four times, verify error thrown after 4 calls (1 + 3 retries)
- Test: query params serialized correctly — call `getMarkets({ limit: 5, status: "open" })`, verify fetch URL includes `?limit=5&status=open`

## Critical files to read before implementing

- `packages/shared-platform/src/auth.ts` — `PlatformAuthProvider` interface contract
- `packages/shared-platform/src/api-types.ts` — existing stubs
- `packages/core/src/config.ts` — current config shape
- `packages/core/test/db.test.ts` — test conventions (bun:test, describe/test/expect, try/finally cleanup)

## Verification

```bash
bunx tsc --noEmit                    # zero TS errors
bunx eslint .                        # zero lint errors
bun test                             # all tests pass (auth, rate-limiter, client)
```

Manual smoke test (if demo credentials available):
```ts
const client = await KalshiClient.create({});  // no auth, public only
const status = await client.getExchangeStatus();
const markets = await client.getMarkets({ limit: 1 });
console.log(status, markets.markets[0]?.ticker);
```

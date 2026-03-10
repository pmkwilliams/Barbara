# Market Ingestion Pipeline — Plan

## Approach

Build bottom-up: hash utility → paginator → normalizers → ingestion-run repo → orchestrator → scheduler/backfill. Each layer is independently testable before the next depends on it.

## Prerequisites

**Add `@barbara/shared-platform` dependency** to `packages/ingestion/package.json` — fetchers import platform clients.

**Add `"test"` to `packages/ingestion/tsconfig.json` include array** — currently only has `"src"`.

## 1. Resolution Hash (`packages/core/src/resolution-hash.ts`)

```ts
export function computeResolutionHash(fields: {
  resolution_rules: string | null;
  resolution_source: string | null;
  close_time: string | null;
  outcome_labels: string[];
}): string
```

Canonicalization: null → `""`, sort `outcome_labels` alphabetically, join all with `\0` separator (`rules\0source\0close_time\0label1\0label2...`), SHA-256 hex via `Bun.CryptoHasher("sha256")`.

Export from `packages/core/src/index.ts`.

## 2. Kalshi Cursor Paginator (`packages/shared-platform/src/kalshi/client.ts`)

Add `paginateMarkets()` async generator to `KalshiClient`:

```ts
async *paginateMarkets(params?: GetMarketsParams): AsyncGenerator<KalshiRawMarket[]> {
  let cursor: string | undefined = params?.cursor;
  while (true) {
    const response = await this.getMarkets({ ...params, cursor });
    if (response.markets.length === 0) return;
    yield response.markets;
    if (!response.cursor) return;
    cursor = response.cursor;
  }
}
```

Key difference from Gamma's offset-based `paginate()`: uses cursor string from response, not offset arithmetic. Terminates on empty `markets` array or empty/falsy `cursor`.

## 3. Normalizers (`packages/ingestion/src/normalizers/`)

### `kalshi.ts` — `normalizeKalshiMarket(raw: KalshiRawMarket): NormalizedMarketInput`

Field mappings per brief. Status map: `open→active`, `closed→closed`, `settled→resolved`. Unmapped values → `console.warn` + default `active`. `resolution_rules` concatenates `rules_primary` + `rules_secondary` with `"\n\n"` separator if both present. Promote `event_ticker`, `series_ticker`, `open_time`, `market_shape`, and `is_binary_eligible`; keep `start_time` null; set `end_time = close_time` so matching can reason over a common end-of-market field without branching by platform. `resolution_hash` set to `null` here (computed later by orchestrator).

**Confirmed via live API**: `category`, `description`, `resolution_source` do NOT exist in Kalshi responses → hardcode `null`. All untyped fields (e.g. `created_time`, `expected_expiration_time`, `liquidity`, `early_close_condition`, `strike_type`, `price_ranges`, etc.) are preserved in `raw_data`. Also confirmed: `status` returns `"active"` as expected. The brief's status mapping (`open→active`) may be wrong — live API already uses `"active"` not `"open"`. Map both `open` and `active` → `MarketStatus.ACTIVE` defensively.

### `polymarket.ts` — `normalizePolymarketMarket(raw: GammaMarket): NormalizedMarketInput`

Field mappings per brief. Use `GammaMarket` type (from `polymarket/types.ts`), NOT `PolymarketRawMarket` (from `api-types.ts` — appears unused). `platform_id` = `conditionId`. Status: `!closed` → `active`, `closed` → `closed`. No reliable resolved indicator in typed fields — map to `closed` for now (downstream lifecycle detection in 0108 can refine). Promote `start_time`, `end_time`, `group_title`, `market_shape`, and `is_binary_eligible`; set `close_time = endDate`; do not trust or depend on platform category from Gamma payloads. `volume` = `parseFloat(raw.volume)` (NaN → `null`). `resolution_hash` set to `null` (computed later).

Both normalizers are pure functions — no side effects, no DB, no network. Return `NormalizedMarketInput` with `resolution_hash: null`.

## 4. Fetchers (`packages/ingestion/src/fetchers/`)

Thin wrappers that consume paginator generators and collect all markets into a flat array.

### `kalshi.ts` — `fetchAllKalshiMarkets(client: KalshiClient): Promise<KalshiRawMarket[]>`

Iterate `client.paginateMarkets()`, concat all pages into single array. Accept optional `GetMarketsParams` for filtering (e.g. `status: "open"`).

### `polymarket.ts` — `fetchAllPolymarketMarkets(client: GammaClient): Promise<GammaMarket[]>`

Same pattern with `client.paginateMarkets()`.

## 5. Ingestion Run Repository (`packages/core/src/ingestion-run-repository.ts`)

Follows `market-repository.ts` pattern — thin Drizzle wrappers around `ingestion_runs` table.

```ts
export function createIngestionRun(db: BarbaraDb, platform: Platform): IngestionRun
  // INSERT with status="running", started_at=now, returns the created row

export function completeIngestionRun(db: BarbaraDb, id: number, counts: {
  markets_found: number; markets_created: number; markets_updated: number;
}): void
  // UPDATE status="completed", completed_at=now, set counts

export function failIngestionRun(db: BarbaraDb, id: number, error: string): void
  // UPDATE status="failed", completed_at=now, error=message
```

Export from `packages/core/src/index.ts`.

## 6. Orchestrator (`packages/ingestion/src/orchestrator.ts`)

```ts
export async function runIngestion(
  platform: Platform,
  db: BarbaraDb,
  clients: { kalshi: KalshiClient; gamma: GammaClient }
): Promise<IngestionRunResult>
```

Per-platform flow:
1. `createIngestionRun(db, platform)` → get run ID
2. Fetch all raw markets via platform fetcher
3. For each raw market: try/catch individually — normalize → `computeResolutionHash()` on resolution-critical fields → set `resolution_hash` on normalized input → `upsertMarket(db, input)`. On per-market error: log warning with market identifier, increment `errors` count, continue to next market.
4. Track counts: compare `created_at === updated_at` on returned `NormalizedMarket` to classify insert vs update. Note: relies on `upsertMarket` setting both timestamps to same value on insert and only `updated_at` on conflict update.
5. `completeIngestionRun(db, runId, counts)` — even if some individual markets errored, the run completes (errors tracked in count). Only mark run `failed` for run-level errors (fetch failure, DB connection loss).
6. On run-level error: `failIngestionRun(db, runId, error.message)`, return error result.

Return type includes `markets_found`, `markets_created`, `markets_updated`, `markets_errored`, `duration_ms`.

## 7. Logger (`packages/core/src/logger.ts`)

Minimal structured console logger respecting `LOG_LEVEL` from config. No external dependencies.

```ts
export function createLogger(context: string): Logger
  // Returns { debug, info, warn, error } methods
  // Each logs: `[LEVEL] [context] message` + optional data
  // Respects LOG_LEVEL threshold (debug < info < warn < error)
```

Export from core index. Used by orchestrator, scheduler, normalizers (for warning on unmapped status).

## 8. Scheduler (`packages/ingestion/src/scheduler.ts`)

Long-running Bun process:
- Read `INGESTION_INTERVAL_MS` from env (default `900000` = 15 min). Add to `Config` interface + `loadConfig()`.
- Run immediately on startup, then `setInterval`.
- `isRunning` boolean guard — skip cycle if previous still running. Log warning when skipping. Add `MAX_CYCLE_DURATION_MS` env (default 10 min) — if a cycle exceeds this, log error and reset the guard so the scheduler doesn't permanently stall.
- Sequential: Kalshi first, then Polymarket.
- Graceful shutdown: `process.on("SIGINT" | "SIGTERM")` → clear interval, wait for current cycle, close DB, exit.
- Log cycle start/end, per-platform counts, errors.

## 9. Backfill CLI (`packages/ingestion/src/backfill.ts`)

One-shot entry point:
- Create DB connection + run migrations.
- Create platform clients.
- `runIngestion("kalshi", ...)` then `runIngestion("polymarket", ...)`.
- Print summary table: platform, fetched, inserted, updated, duration.
- Exit with code 0 on success, 1 on any failure.

## 10. Entry Point (`packages/ingestion/src/index.ts`)

Replace empty `export {}` with scheduler startup:
- Parse command (if needed, detect `--backfill` flag or keep as separate file).
- Otherwise, bootstrap DB, clients, start scheduler.

## File Changes Summary

| File | Action |
|---|---|
| `packages/core/src/resolution-hash.ts` | NEW |
| `packages/core/src/ingestion-run-repository.ts` | NEW |
| `packages/core/src/logger.ts` | NEW |
| `packages/core/src/config.ts` | MODIFY — add `INGESTION_INTERVAL_MS` |
| `packages/core/src/index.ts` | MODIFY — add exports |
| `packages/shared-platform/src/kalshi/client.ts` | MODIFY — add `paginateMarkets()` |
| `packages/ingestion/package.json` | MODIFY — add `@barbara/shared-platform` dep |
| `packages/ingestion/tsconfig.json` | MODIFY — add `"test"` to include |
| `packages/ingestion/src/normalizers/kalshi.ts` | NEW |
| `packages/ingestion/src/normalizers/polymarket.ts` | NEW |
| `packages/ingestion/src/fetchers/kalshi.ts` | NEW |
| `packages/ingestion/src/fetchers/polymarket.ts` | NEW |
| `packages/ingestion/src/orchestrator.ts` | NEW |
| `packages/ingestion/src/scheduler.ts` | NEW |
| `packages/ingestion/src/backfill.ts` | NEW |
| `packages/ingestion/src/index.ts` | MODIFY — scheduler entry point |

## Test Files

| File | Covers |
|---|---|
| `packages/core/test/resolution-hash.test.ts` | Determinism, sensitivity, null handling, label order independence |
| `packages/core/test/ingestion-run-repository.test.ts` | Create/complete/fail lifecycle, count accuracy |
| `packages/shared-platform/test/kalshi/client.test.ts` | MODIFY — add paginator tests: cursor advancement, empty page stop, single page |
| `packages/ingestion/test/normalizers/kalshi.test.ts` | Known raw → expected normalized, null fields, unmapped status |
| `packages/ingestion/test/normalizers/polymarket.test.ts` | Known raw → expected normalized, volume parsing, status mapping |
| `packages/ingestion/test/orchestrator.test.ts` | Mocked clients + in-memory DB: run tracking, counts, error handling |

## Verification

```bash
# Unit tests
bun test packages/core/test/resolution-hash.test.ts
bun test packages/core/test/ingestion-run-repository.test.ts
bun test packages/shared-platform/test/kalshi/client.test.ts
bun test packages/ingestion/test/

# All tests
bun test

# Manual backfill (requires .env with API keys)
bun run packages/ingestion/src/backfill.ts

# Manual scheduler (requires .env with API keys)
bun run packages/ingestion/src/index.ts
```

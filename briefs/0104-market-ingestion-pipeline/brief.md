# Market Ingestion Pipeline

Fetch, normalize, hash, and ingest market data from Kalshi and Polymarket on a configurable schedule.

## Existing Infrastructure

Already built (use directly, don't rebuild):
- `KalshiClient` — REST client with auth, rate limiting, retry. Has `getMarkets(params)` but **no pagination helper**.
- `GammaClient` — REST client with rate limiting, retry. Has `paginateMarkets()` async generator.
- `NormalizedMarketInput` type — 14-field common market representation (in `@barbara/core`)
- `upsertMarket(db, input)` — INSERT ON CONFLICT DO UPDATE in `market-repository.ts`
- `markets` table — includes `resolution_hash` column. Unique on `(platform, platform_id)`.
- `ingestion_runs` table — tracks run metadata per platform.
- Raw API types: `KalshiRawMarket`, `GammaMarket` with typed fields + `[key: string]: unknown` catch-all.

## Scope

### In Scope

1. **Kalshi cursor paginator** — Add `paginateMarkets()` async generator to `KalshiClient` (in `packages/shared-platform`). Match `GammaClient` pattern. Cursor-based: advance via `cursor` field in response, stop when cursor is empty or page is empty.

2. **Normalizers** — In `packages/ingestion`. Transform raw platform types to `NormalizedMarketInput`.

3. **Resolution hash function** — In `packages/core`. `computeResolutionHash()` takes resolution-critical fields, returns SHA-256 hex digest.

4. **Ingestion orchestrator** — Per-platform fetch-all → normalize → hash → upsert → track run.

5. **Long-running scheduler** — Bun process with `setInterval`, configurable interval (default 15 min). Platforms run sequentially per cycle.

6. **Backfill CLI command** (absorbed from 0109) — One-shot entry point that runs the orchestrator once for both platforms and exits. `bun run backfill`. Same fetcher/normalizer/orchestrator code, different entry point. Idempotent. Reports summary: total fetched, inserted, updated, errors.

### Out of Scope (separate briefs)

- Lifecycle change detection / matched group pausing (0108)
- Validation gate / integration tests (0110)

## File Layout

```
packages/core/src/
  resolution-hash.ts         ← NEW: computeResolutionHash()

packages/shared-platform/src/kalshi/
  client.ts                  ← MODIFY: add paginateMarkets() async generator

packages/ingestion/src/
  normalizers/
    kalshi.ts                ← KalshiRawMarket -> NormalizedMarketInput
    polymarket.ts            ← GammaMarket -> NormalizedMarketInput
  fetchers/
    kalshi.ts                ← fetchAllKalshiMarkets() using paginateMarkets()
    polymarket.ts            ← fetchAllPolymarketMarkets() using paginateMarkets()
  orchestrator.ts            ← runIngestion(platform) — one full cycle
  scheduler.ts               ← long-running process, setInterval loop
  backfill.ts                ← one-shot: run both platforms once, print summary, exit
  index.ts                   ← entry point: bun run packages/ingestion/src/index.ts
```

## Normalizer Field Mappings

### Kalshi (`KalshiRawMarket` → `NormalizedMarketInput`)

| Field | Source | Notes |
|---|---|---|
| platform | `"kalshi"` | |
| platform_id | `ticker` | Unique market identifier |
| title | `title` | |
| description | `null` | Not in typed interface; check raw data |
| outcome_labels | `[yes_sub_title, no_sub_title]` | Descriptive labels per side |
| resolution_source | `null` | Not in typed interface; check raw data |
| resolution_rules | `rules_primary` + `rules_secondary` | Concatenate with separator if both present |
| close_time | `close_time` | ISO string |
| category | `null` | Not in typed interface; check raw data |
| status | Map: see below | |
| volume | `volume` | number |
| raw_data | full `KalshiRawMarket` object | Preserve everything for later use |

**Kalshi status mapping:** `open` → `active`, `closed` → `closed`, `settled` → `resolved`. Unmapped values → log warning, default `active`. Verify actual values against live API during implementation.

### Polymarket (`GammaMarket` → `NormalizedMarketInput`)

| Field | Source | Notes |
|---|---|---|
| platform | `"polymarket"` | |
| platform_id | `conditionId` | Canonical CTF condition ID, used by CLOB for trading |
| title | `question` | |
| description | `description` | |
| outcome_labels | `outcomes` | Already parsed `string[]` |
| resolution_source | `resolutionSource` | |
| resolution_rules | `description` | Polymarket embeds resolution info in description |
| close_time | `endDate` | |
| category | `category` | |
| status | Map: see below | |
| volume | `parseFloat(volume)` | API returns string |
| raw_data | full `GammaMarket` object | |

**Polymarket status mapping:** `active && !closed` → `active`, `closed` → `closed`. Check raw data for resolved/suspended indicators.

## Resolution Hash

```typescript
// packages/core/src/resolution-hash.ts
export function computeResolutionHash(fields: {
  resolution_rules: string | null;
  resolution_source: string | null;
  close_time: string | null;
  outcome_labels: string[];
}): string
```

**Canonicalization:**
1. Sort `outcome_labels` alphabetically
2. Null fields → empty string
3. Join all fields with `\0` separator: `rules\0source\0close_time\0label1\0label2...`
4. SHA-256 hex digest

**Purpose:** Change detection. If any resolution-critical field changes between ingestion runs, the hash changes. Used by lifecycle detection (0108) to pause affected matched groups.

## Orchestrator Flow

Per platform, per cycle:

1. Insert `ingestion_runs` row: `status=running`, `started_at=now`
2. Paginate through all active markets via platform fetcher
3. For each market: normalize → compute resolution hash → set on `NormalizedMarketInput`
4. Upsert to DB via `upsertMarket()`
5. Track counts: `markets_found` (total fetched), `markets_created` (new inserts), `markets_updated` (existing overwrites)
6. Update run row: `status=completed`, counts, `completed_at=now`
7. On error: update run `status=failed`, store error message, continue to next platform

**Created vs updated detection:** After upsert, `created_at === updated_at` → new insert. Otherwise → update (overwrite).

## Scheduler

- Long-running Bun process. `setInterval` with configurable `INGESTION_INTERVAL_MS` (default 15 min).
- Run immediately on startup, then on interval.
- Guard flag to skip cycle if previous still running.
- Platforms run sequentially: Kalshi first, then Polymarket.
- Graceful shutdown on `SIGINT`/`SIGTERM`.
- Log cycle start/end, per-platform counts, errors.

## Testing

- **Normalizer unit tests:** Known raw input → expected `NormalizedMarketInput` for each platform. Cover edge cases: null fields, unusual status values, empty outcome labels.
- **Resolution hash tests:** Determinism (same input → same hash), sensitivity (single field change → different hash), null handling, outcome label ordering independence.
- **Kalshi paginator tests:** Cursor advancement, empty page termination, single page (no cursor).
- **Orchestrator test with mocked clients:** Run tracking accuracy, count correctness, error handling.

## Done When

- Full paginated fetch from both platforms produces correctly typed normalized markets
- Resolution hashes are deterministic: identical markets → same hash, any resolution-critical field change → different hash
- Scheduler runs continuously; `markets` table stays current across multiple cycles
- `ingestion_runs` table has accurate per-platform metadata per cycle

## Unresolved Questions

1. **Kalshi status values** — Typed interface says `status: string`. Need to verify actual values from live API (`open`, `closed`, `settled`?). Normalizer should log warnings on unmapped values.
2. **Kalshi hidden fields** — `KalshiRawMarket` has `[key: string]: unknown`. Check live responses for `category`, `description`, `resolution_source` fields that may exist but aren't typed. Update normalizer if found.
3. **Polymarket `resolution_rules`** — Using `description` for both `description` and `resolution_rules` since Polymarket has no separate rules field. Verify this is adequate for resolution hash change detection.
4. **Polymarket `conditionId` uniqueness** — Confirm no two Gamma market records share the same `conditionId`. If they do, `platform_id` composite key would collide.

# 0103 — Normalized Market Schema

## Problem

No application-level market type or data access layer exists. Downstream briefs (0104–0110) all depend on a `NormalizedMarket` type to normalize into and repository functions to persist with. The current `Market` interface in `types.ts` mirrors DB columns 1:1 (outcome_labels as JSON string, no resolution_rules field). Need a clean app-level type, a schema fix, and a repository layer.

## Scope

Three deliverables in `packages/core/`:

### 1. Schema change — add `resolution_rules` column

Add `resolution_rules: text("resolution_rules")` to the `markets` table in `schema.ts`. This is the full resolution criteria text — the most critical field for matching safety.

- Kalshi: concatenate `rules_primary + "\n\n" + rules_secondary`
- Polymarket: map from description/resolution fields

**Migration strategy:** Reset migration 0000. Modify schema.ts, delete `packages/core/drizzle/`, run `bunx drizzle-kit generate` to regenerate. No production data exists.

### 2. `NormalizedMarket` type

Add to `types.ts`. Replace existing `Market` interface (nothing uses it yet).

```typescript
/** What normalizers (0104/0105) produce. Input to upsertMarket. */
export type NormalizedMarketInput = Omit<NormalizedMarket, 'id' | 'created_at' | 'updated_at'>;

/** Canonical market type with parsed fields. Returned by all repo reads. */
export interface NormalizedMarket {
  id: string;                        // deterministic: `${platform}:${platform_id}`
  platform: Platform;
  platform_id: string;
  title: string;
  description: string | null;
  outcome_labels: string[];          // parsed array, NOT JSON string
  resolution_source: string | null;
  resolution_rules: string | null;   // NEW — full resolution criteria text
  close_time: string | null;         // ISO 8601
  category: string | null;
  status: MarketStatus;
  volume: number | null;
  resolution_hash: string | null;    // computed by 0106, nullable until then
  raw_data: unknown | null;          // full platform response, serialized by repo
  created_at: string;
  updated_at: string;
}
```

Key differences from DB row type (`MarketRow`):
- `outcome_labels`: `string[]` not `string` — repo handles JSON serialization
- `raw_data`: `unknown` not `string` — repo handles JSON serialization
- `resolution_rules`: new field

No pricing columns — pricing is ephemeral, tracked in-memory by runtime only.

### 3. Repository layer — `market-repository.ts`

New file: `packages/core/src/market-repository.ts`. All functions take `BarbaraDb` as first arg. Use Drizzle ORM query builders (match existing patterns in db.test.ts).

**Functions:**

- `upsertMarket(db, input: NormalizedMarketInput): NormalizedMarket`
  - Generate `id` as `${platform}:${platform_id}`
  - Serialize `outcome_labels` → JSON string, `raw_data` → JSON string
  - `INSERT ... ON CONFLICT (platform, platform_id) DO UPDATE` — update all fields except id, platform, platform_id, created_at
  - Set `updated_at` to current ISO timestamp on update
  - Return the stored row parsed back to `NormalizedMarket`

- `getMarketById(db, id: string): NormalizedMarket | undefined`

- `getMarketsByPlatform(db, platform: Platform): NormalizedMarket[]`

- `getActiveMarkets(db): NormalizedMarket[]` — where status = 'active'

Internal helpers:
- `toRow(input: NormalizedMarketInput): NewMarketRow` — serializes parsed fields to DB format
- `fromRow(row: MarketRow): NormalizedMarket` — parses JSON fields back

Export repo functions + types from `index.ts`.

### 4. Tests — `market-repository.test.ts`

New file: `packages/core/test/market-repository.test.ts`. Pattern: `createDb(":memory:")` + `runMigrations(db)` in each test, `sqlite.close()` in finally.

Tests:
- **upsert insert**: insert new market, verify all fields round-trip with parsed types
- **upsert update**: insert then upsert same (platform, platform_id) with changed fields, verify updated fields + unchanged created_at + new updated_at
- **getMarketById**: insert, retrieve by id, verify; also test missing id returns undefined
- **getMarketsByPlatform**: insert markets for both platforms, query one platform, verify only matching returned
- **getActiveMarkets**: insert mix of active/closed/resolved, verify only active returned
- **outcome_labels round-trip**: insert with `["Yes", "No"]`, read back as string[], not JSON string
- **raw_data round-trip**: insert with object, read back as object

### Existing test update

`db.test.ts` — update the market insert test to include `resolution_rules` field. Adjust the inserted market object shape.

## Non-goals

- Pricing columns (handled by runtime in-memory)
- Resolution hash computation (brief 0106)
- Normalizer functions for Kalshi/Polymarket (briefs 0104/0105)
- Ingestion run repository (ingestion_runs table already works via direct Drizzle)

## Done when

- Schema has `resolution_rules` column, migration regenerated cleanly
- `NormalizedMarket` + `NormalizedMarketInput` types exported from `@barbara/core`
- All 4 repository functions exported and pass round-trip tests
- `bun test` passes in `packages/core/`

## Unresolved questions

None — all decisions resolved.

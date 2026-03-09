# Plan: Normalized Market Schema

## Approach

Schema fix (add `resolution_rules`), reset migration, replace `Market` interface with `NormalizedMarket` + `NormalizedMarketInput`, build repository layer with serialization boundary, test round-trips. All changes in `packages/core/`.

## File Changes Summary

| File | Action |
|------|--------|
| `src/schema.ts` | **Edit** — add `resolution_rules` column |
| `src/types.ts` | **Edit** — replace `Market` with `NormalizedMarket` + `NormalizedMarketInput` |
| `src/market-repository.ts` | **Create** — repo functions + toRow/fromRow helpers |
| `src/index.ts` | **Edit** — add `./market-repository` export |
| `drizzle/` | **Delete & regenerate** — rm entire directory, `bunx drizzle-kit generate` |
| `test/db.test.ts` | **Edit** — add `resolution_rules` to test market object |
| `test/market-repository.test.ts` | **Create** — round-trip tests for all 4 repo functions |

## Key Implementation Details

### `schema.ts` — add column

Insert after `resolution_source` line:

```ts
resolution_rules: text("resolution_rules"),
```

Nullable TEXT, same pattern as `resolution_source` and `description`. No other schema changes.

### Migration reset

Delete `packages/core/drizzle/` entirely (contains `0000_early_celestials.sql`, `meta/_journal.json`, `meta/0000_snapshot.json`). Run `bunx drizzle-kit generate` from project root. This regenerates a fresh 0000 migration from current schema.ts. Verify output SQL includes `resolution_rules text` in the `markets` CREATE TABLE.

### `types.ts` — type replacement

Remove the `Market` interface (lines 17–33). Replace with:

```ts
/** Canonical market type with parsed fields. Returned by all repo reads. */
export interface NormalizedMarket {
  id: string;
  platform: Platform;
  platform_id: string;
  title: string;
  description: string | null;
  outcome_labels: string[];
  resolution_source: string | null;
  resolution_rules: string | null;
  close_time: string | null;
  category: string | null;
  status: MarketStatus;
  volume: number | null;
  resolution_hash: string | null;
  raw_data: unknown | null;
  created_at: string;
  updated_at: string;
}

/** What normalizers (0104/0105) produce. Input to upsertMarket. */
export type NormalizedMarketInput = Omit<NormalizedMarket, 'id' | 'created_at' | 'updated_at'>;
```

Key diffs from old `Market`:
- `outcome_labels`: `string` → `string[]`
- `raw_data`: `string | null` → `unknown | null`
- `resolution_rules`: new field
- Name change: `Market` → `NormalizedMarket`

Keep `IngestionRun` interface, `Platform`, `MarketStatus` unchanged.

### `market-repository.ts` — new file

```ts
import { eq } from "drizzle-orm";
import type { BarbaraDb } from "./db";
import { markets, type MarketRow, type NewMarketRow } from "./schema";
import type { NormalizedMarket, NormalizedMarketInput, Platform } from "./types";
```

#### `toRow(input: NormalizedMarketInput): NewMarketRow`

Private helper. Converts app types to DB row format:
- `id`: `${input.platform}:${input.platform_id}`
- `outcome_labels`: `JSON.stringify(input.outcome_labels)`
- `raw_data`: `input.raw_data != null ? JSON.stringify(input.raw_data) : null`
- `status`: pass through (string literal compatible with TEXT column)
- All other fields: pass through as-is

#### `fromRow(row: MarketRow): NormalizedMarket`

Private helper. Parses DB row back to app types:
- `outcome_labels`: `JSON.parse(row.outcome_labels) as string[]`
- `raw_data`: `row.raw_data != null ? JSON.parse(row.raw_data) as unknown : null`
- `platform`: cast to `Platform` (value is already validated by insertion)
- All other fields: pass through

#### `upsertMarket(db: BarbaraDb, input: NormalizedMarketInput): NormalizedMarket`

```ts
const row = toRow(input);
const now = new Date().toISOString();

db.insert(markets)
  .values({ ...row, created_at: now, updated_at: now })
  .onConflictDoUpdate({
    target: [markets.platform, markets.platform_id],
    set: {
      title: input.title,
      description: input.description,
      outcome_labels: row.outcome_labels,
      resolution_source: input.resolution_source,
      resolution_rules: input.resolution_rules,
      close_time: input.close_time,
      category: input.category,
      status: input.status,
      volume: input.volume,
      resolution_hash: input.resolution_hash,
      raw_data: row.raw_data,
      updated_at: now,
    },
  })
  .run();

const stored = db.select().from(markets).where(eq(markets.id, row.id)).get();
return fromRow(stored!);
```

The `set` clause explicitly lists every updatable field. `id`, `platform`, `platform_id`, `created_at` are excluded — they don't change on conflict. `updated_at` gets current timestamp.

Uses `.run()` + separate `.get()` rather than `.returning()` because Drizzle + bun:sqlite `.returning()` support can be inconsistent. The select is guaranteed to find the row since the insert just succeeded.

#### `getMarketById(db: BarbaraDb, id: string): NormalizedMarket | undefined`

```ts
const row = db.select().from(markets).where(eq(markets.id, id)).get();
return row ? fromRow(row) : undefined;
```

#### `getMarketsByPlatform(db: BarbaraDb, platform: Platform): NormalizedMarket[]`

```ts
const rows = db.select().from(markets).where(eq(markets.platform, platform)).all();
return rows.map(fromRow);
```

#### `getActiveMarkets(db: BarbaraDb): NormalizedMarket[]`

```ts
const rows = db.select().from(markets).where(eq(markets.status, "active")).all();
return rows.map(fromRow);
```

Export all four public functions.

### `index.ts` — add export

Append: `export * from "./market-repository";`

This exports `upsertMarket`, `getMarketById`, `getMarketsByPlatform`, `getActiveMarkets`, plus the types are already exported from `./types`.

### `test/db.test.ts` — update

Add `resolution_rules: "Resolves based on BLS CPI release."` to `insertedMarket` object in the first test. No other changes needed — the test uses `toEqual` which will fail if the DB row doesn't include the new field.

### `test/market-repository.test.ts` — new file

Follows existing test patterns: `import { describe, expect, test } from "bun:test"`, `createDb(":memory:")`, `runMigrations(db)`, `try/finally` with `sqlite.close()`.

Shared test fixture factory:

```ts
const makeInput = (overrides?: Partial<NormalizedMarketInput>): NormalizedMarketInput => ({
  platform: Platform.KALSHI,
  platform_id: "TEST-001",
  title: "Will CPI exceed 3%?",
  description: "Year-over-year CPI outcome.",
  outcome_labels: ["Yes", "No"],
  resolution_source: "BLS CPI Release",
  resolution_rules: "Resolves Yes if YoY CPI > 3% per BLS.",
  close_time: "2026-04-01T12:30:00.000Z",
  category: "macro",
  status: MarketStatus.ACTIVE,
  volume: 12345.67,
  resolution_hash: null,
  raw_data: { source: "kalshi", ticker: "TEST-001" },
  ...overrides,
});
```

**Tests:**

- **upsert inserts new market** — call `upsertMarket(db, makeInput())`, verify returned `NormalizedMarket` has all fields matching input, `id` is `"kalshi:TEST-001"`, `created_at` and `updated_at` are ISO strings

- **upsert updates existing market** — insert, then upsert same `(platform, platform_id)` with changed `title` and `volume`. Verify returned market has new title/volume, same `created_at`, different `updated_at`

- **getMarketById returns market** — upsert, then `getMarketById(db, "kalshi:TEST-001")`, verify match

- **getMarketById returns undefined for missing id** — `getMarketById(db, "nonexistent")` returns `undefined`

- **getMarketsByPlatform filters correctly** — upsert one Kalshi market and one Polymarket market. `getMarketsByPlatform(db, Platform.KALSHI)` returns array of length 1 with correct market

- **getActiveMarkets filters by status** — upsert 3 markets: active, closed, resolved. `getActiveMarkets(db)` returns array of length 1

- **outcome_labels round-trips as string[]** — upsert with `outcome_labels: ["Yes", "No", "Maybe"]`, read back, verify `typeof result.outcome_labels` is not string, `Array.isArray()` is true, deep equals input array

- **raw_data round-trips as object** — upsert with `raw_data: { nested: { key: "value" }, arr: [1, 2] }`, read back, verify deep equals input object

- **raw_data null round-trips** — upsert with `raw_data: null`, read back, verify `null`

## Critical Files to Read Before Implementation

- `packages/core/src/schema.ts` — current table definition to modify
- `packages/core/src/types.ts` — `Market` interface to replace
- `packages/core/src/db.ts` — `BarbaraDb` type + `createDb`/`runMigrations` signatures
- `packages/core/src/index.ts` — barrel exports to extend
- `packages/core/test/db.test.ts` — test patterns + market fixture to update

## Verification

```bash
rm -rf packages/core/drizzle && bunx drizzle-kit generate   # migration regenerates cleanly
bun test                                                      # all tests pass
bunx tsc --noEmit                                             # zero type errors
```

Verify the generated migration SQL includes `resolution_rules text` in the CREATE TABLE statement. Verify `bun test` passes in both `packages/core/test/db.test.ts` (updated) and `packages/core/test/market-repository.test.ts` (new).

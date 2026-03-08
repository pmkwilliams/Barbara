# Plan: Project Foundation

## File tree (all new)

```
package.json                          root workspace config
tsconfig.json                         base TS config (all packages extend)
eslint.config.mjs                     flat ESLint config
drizzle.config.ts                     Drizzle Kit config (points into core)
.env.example                          documented env keys
.gitignore                            add data/, drizzle meta, bun.lock entries
packages/
  core/
    package.json                      @barbara/core, drizzle-orm dep
    tsconfig.json                     extends root
    src/
      index.ts                        barrel re-export
      types.ts                        Platform, MarketStatus enums + base interfaces
      config.ts                       env loading + required-field validation
      db.ts                           bun:sqlite factory + drizzle instance + runtime migrator
      schema.ts                       markets + ingestion_runs drizzle tables
    test/
      db.test.ts                      round-trip insert/query
  shared-platform/
    package.json                      @barbara/shared-platform, depends on @barbara/core
    tsconfig.json
    src/
      index.ts                        barrel re-export
      auth.ts                         auth/signing helper interfaces
      api-types.ts                    raw API response type stubs (empty, filled later)
  runtime/
    package.json                      @barbara/runtime stub
    tsconfig.json
    src/index.ts                      empty export
  matching/
    package.json                      @barbara/matching stub
    tsconfig.json
    src/index.ts                      empty export
  ingestion/
    package.json                      @barbara/ingestion stub
    tsconfig.json
    src/index.ts                      empty export
  dashboard/
    package.json                      @barbara/dashboard stub
    tsconfig.json
    src/index.ts                      empty export
```

## Dependencies

Root devDeps: `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`, `drizzle-kit`

`@barbara/core` deps: `drizzle-orm`  
`@barbara/core` devDeps: none (bun:sqlite is built-in, drizzle-kit at root)

`@barbara/shared-platform` deps: `@barbara/core` via `workspace:*`

Stub packages: dep on `@barbara/core` via `workspace:*`

## Key implementation details

### Bun workspaces

Root `package.json`: `"workspaces": ["packages/*"]`. Each package points `main` and `types` to `./src/index.ts` directly — Bun runs TS natively, no build step for internal consumption.

### TypeScript

Root `tsconfig.json` sets `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `moduleResolution: "bundler"`, `target: "esnext"`, `module: "esnext"`. Per-package configs extend root via `"extends": "../../tsconfig.json"` and set `"include": ["src"]`.

### ESLint flat config

`eslint.config.mjs` uses `@eslint/js` recommended + `typescript-eslint` recommended. Ignores `node_modules/`, `dist/`, `drizzle/`. Scoped to `**/*.ts` files.

### Config loader (`core/src/config.ts`)

- Reads `process.env`
- `DATABASE_PATH` defaults `./data/barbara.db`
- `LOG_LEVEL` defaults `info`
- Platform keys (`KALSHI_API_KEY`, `KALSHI_API_SECRET`, `POLYMARKET_API_KEY`, `POLYMARKET_PRIVATE_KEY`) optional — returns `undefined` when absent
- Export `loadConfig()` returning typed `Config` object
- Export `requireEnv(key)` helper that throws descriptive error on missing required var

### DB connection factory (`core/src/db.ts`)

```ts
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
```

- `createDb(path?)`: creates `bun:sqlite` Database instance, enables WAL mode + foreign keys, wraps with Drizzle passing `* as schema` for relational queries
- `runMigrations(db)`: applies migrations from `packages/core/drizzle/` folder using Drizzle's runtime migrator
- Accepts optional path override (for tests using `:memory:`)

### Drizzle schema (`core/src/schema.ts`)

Uses `drizzle-orm/sqlite-core` imports. Two tables per brief spec:

**markets**: `id` text PK, `platform` text not null, `platform_id` text not null, `title` text not null, `description` text, `outcome_labels` text not null (JSON), `resolution_source` text, `close_time` text, `category` text, `status` text not null default `'active'`, `volume` real, `resolution_hash` text, `raw_data` text, `created_at` text default `CURRENT_TIMESTAMP`, `updated_at` text default `CURRENT_TIMESTAMP`. Unique index on `(platform, platform_id)`.

**ingestion_runs**: `id` integer PK autoincrement, `platform` text not null, `started_at` text default `CURRENT_TIMESTAMP`, `completed_at` text, `markets_found` integer, `markets_created` integer, `markets_updated` integer, `status` text not null default `'running'`, `error` text.

### Drizzle Kit config (`drizzle.config.ts` at root)

```ts
dialect: 'sqlite'
schema: './packages/core/src/schema.ts'
out: './packages/core/drizzle'
dbCredentials: { url: process.env.DATABASE_PATH ?? './data/barbara.db' }
```

Migration workflow: `bunx drizzle-kit generate` → `bunx drizzle-kit migrate`. Generated SQL files committed to repo under `packages/core/drizzle/`.

### Types (`core/src/types.ts`)

- `Platform` enum: `kalshi`, `polymarket` (use `as const` object + type union pattern, not TS enum)
- `MarketStatus` enum: `active`, `closed`, `resolved`, `suspended` (same pattern)
- `Market` interface matching the schema shape
- `IngestionRun` interface matching the schema shape

### shared-platform interfaces

`auth.ts`: `PlatformAuthProvider` interface with methods like `getHeaders()`, `signRequest()` — signatures only, no implementation. Generic enough for both REST and WebSocket auth patterns.

`api-types.ts`: `KalshiRawMarket`, `PolymarketRawMarket` as empty interfaces with TODO comments.

### .gitignore additions

Add `data/`, `*.db`, `*.db-wal`, `*.db-shm` (SQLite files). Add `bun.lock` if not already tracked (actually, lock files should be committed — leave `bun.lock` tracked).

### Test (`core/test/db.test.ts`)

Uses `bun:test`. Creates `:memory:` DB via `createDb(':memory:')`, runs migrations, inserts a market row, queries it back, asserts all fields. Also tests `ingestion_runs` insert/query. Validates unique constraint on `(platform, platform_id)` by asserting duplicate insert throws.

## Verification

```bash
bun install                          # workspace resolution
bunx tsc --noEmit                    # zero TS errors
bunx eslint .                        # zero lint errors
bunx drizzle-kit generate            # produces migration SQL
bun test                             # round-trip test passes
```

Also verify cross-package import works:
```ts
// from any package:
import { Platform, MarketStatus } from '@barbara/core';
```

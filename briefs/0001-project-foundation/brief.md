---
title: Project Foundation
branch: 0001-project-foundation
---

# Project Foundation

## Problem

Greenfield prediction market arbitrage system needs monorepo scaffolding, shared types, database setup, and env config before any feature work can begin.

## Scope

### Monorepo structure

Bun workspaces. 6 package stubs under `packages/`:

```
packages/
  core/               shared types, config, DB connection, constants
  shared-platform/    platform-specific types, auth/signing interfaces
  runtime/            trading process (stub only)
  matching/           semantic pipeline (stub only)
  ingestion/          market ingestion (stub only)
  dashboard/          monitoring UI (stub only)
```

Root `package.json` with `workspaces` config. Each package gets its own `package.json` with `@barbara/<name>` naming. Stub packages (`runtime`, `matching`, `ingestion`, `dashboard`) get a minimal `index.ts` exporting nothing — just enough for workspace resolution.

### TypeScript & linting

- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Root `tsconfig.json` with base config; per-package `tsconfig.json` extending it
- ESLint flat config with `@typescript-eslint`
- Package cross-references via `workspace:*` dependencies + TypeScript project references

### `core` package contents

- **Config loader**: env var loading with required-field validation. Type-safe config object. Throws on missing required vars at startup.
- **DB connection factory**: `bun:sqlite` wrapper. Returns configured `Database` instance. Drizzle ORM setup on top.
- **Drizzle schema**: `markets` and `ingestion_runs` tables only (minimal set for round-trip test). Other tables (`matched_groups`, `group_members`, `trade_log`) added in later briefs.
- **Migration runner**: Drizzle Kit migrations. Script to run `drizzle-kit generate` and apply via `drizzle-kit migrate`.
- **Shared types**: `Platform` enum (`kalshi`, `polymarket`), `MarketStatus` enum (`active`, `closed`, `resolved`, `suspended`), base type interfaces.

### `shared-platform` package contents

- Auth/signing helper interfaces (not implementations — those come in platform-specific briefs)
- Platform-specific raw API response type stubs (empty interfaces, filled in later)

### Schema: `markets` table

```
id              TEXT PRIMARY KEY
platform        TEXT NOT NULL (kalshi | polymarket)
platform_id     TEXT NOT NULL
title           TEXT NOT NULL
description     TEXT
outcome_labels  TEXT NOT NULL (JSON array)
resolution_source TEXT
close_time      TEXT (ISO 8601)
category        TEXT
status          TEXT NOT NULL DEFAULT 'active'
volume          REAL
resolution_hash TEXT
raw_data        TEXT (full JSON from platform)
created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Unique constraint on `(platform, platform_id)`.

### Schema: `ingestion_runs` table

```
id              INTEGER PRIMARY KEY AUTOINCREMENT
platform        TEXT NOT NULL
started_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
completed_at    TEXT
markets_found   INTEGER
markets_created INTEGER
markets_updated INTEGER
status          TEXT NOT NULL DEFAULT 'running'
error           TEXT
```

### Env config

- `.env.example` with documented keys: `DATABASE_PATH`, `KALSHI_API_KEY`, `KALSHI_API_SECRET`, `POLYMARKET_API_KEY`, `POLYMARKET_PRIVATE_KEY`, `LOG_LEVEL`
- All platform keys optional for now (not needed until ingestion briefs)
- `DATABASE_PATH` defaults to `./data/barbara.db`

### Non-goals

- No git hooks
- No `postmortem/` package (added later)
- No implementation of auth/signing helpers (interfaces only)
- No platform API clients
- No dashboard UI code

## Done when

- `bun install` resolves; any package can `import { Platform } from '@barbara/core'`
- `drizzle-kit generate` and migrate run cleanly on fresh DB
- Test: round-trip insert into `markets` → query back → assert fields match
- ESLint passes across all packages
- TypeScript compiles with zero errors

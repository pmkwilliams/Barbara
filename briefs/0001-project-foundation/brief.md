# Project Foundation

Bun workspaces monorepo with package stubs: `core`, `shared-platform`, `runtime`, `matching`, `ingestion`, `dashboard`. Strict TypeScript, eslint, `.gitignore`.

Core shared types and config in `core`. Platform-specific raw API response types and auth/signing helper interfaces in `shared-platform`.

SQLite connection factory, migration runner, and initial schema (`markets`, `matched_groups`, `group_members`, `trade_log`, `ingestion_runs`) with basic repository functions.

Env var loading with required-field validation. `.env.example` with documented keys. Git hooks to reject `.env` commits.

## Done when

- `bun install` resolves and any package can import from `core`
- Migrations run cleanly
- Round-trip insert/query works in a test

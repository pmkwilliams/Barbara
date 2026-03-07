# Backfill Script

CLI command (`bun run backfill`) that runs a one-time full ingestion of all currently active markets on both platforms. Uses the same fetcher/normalizer code. Reports summary: total fetched, inserted, skipped, errors. Idempotent.

## Done when

- Running twice produces the same DB state

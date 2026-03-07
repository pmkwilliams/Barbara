# Ingestion Scheduler

Long-running process that polls both platforms on a configurable interval (default 15 min). Fetches all active markets, normalizes, upserts to DB. Logs run metadata (timestamp, counts, errors) to `ingestion_runs`. Re-ingestion of unchanged markets is a no-op.

## Done when

- Runs continuously and the `markets` table stays current across multiple cycles

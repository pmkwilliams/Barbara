# Market Ingestion Pipeline

Fetch, normalize, hash, and ingest market data from Kalshi and Polymarket on a configurable schedule.

## Scope

### Data Fetching
- **Kalshi**: Fetch all active market listings from REST API. Handle pagination.
- **Polymarket**: Fetch market listings from CLOB API + condition metadata from Gamma. Handle pagination.

### Normalization
Transform each platform response into a `NormalizedMarket`:
- Resolution rules
- Outcome labels
- Close time
- Resolution source
- Status mapping

### Resolution Field Hashing
Compute deterministic hash over resolution-critical fields:
- Resolution rules text
- Resolution source
- Close time
- Outcome labels

Hash is computed on every normalized market and stored in the `markets` table.

### Ingestion Scheduler
- Long-running process that polls both platforms on a configurable interval (default 15 min)
- Fetches all active markets, normalizes, computes hashes, upserts to DB
- Logs run metadata (timestamp, counts, errors) to `ingestion_runs`
- Re-ingestion of unchanged markets is a no-op (hash comparison)

## Done when

- Full fetch from both platforms produces correctly typed normalized markets
- Identical markets produce same hash; any single resolution-critical field change produces a different hash
- Scheduler runs continuously and the `markets` table stays current across multiple cycles

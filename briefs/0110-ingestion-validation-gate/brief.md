# Ingestion Validation Gate

Integration test suite verifying end-to-end ingestion correctness: no markets with missing required fields, correct metadata parsing on known markets, stable dedup across consecutive runs, resolution hashes populated on all rows.

This is the Phase 1 exit criteria.

## Done when

- All validation checks pass against live or recorded API fixtures

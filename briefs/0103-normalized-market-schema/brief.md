# Normalized Market Schema

Canonical `NormalizedMarket` type covering all fields from the overview: platform, title, description, outcome labels, resolution source, resolution rules, close time, category, status, pricing, volume. Includes resolution-critical field hash column.

DB table DDL + migration. Repository layer: `upsertMarket`, `getMarketsByPlatform`, `getMarketById`, `getActiveMarkets`.

## Done when

- Migration creates the table
- Repository functions pass round-trip tests

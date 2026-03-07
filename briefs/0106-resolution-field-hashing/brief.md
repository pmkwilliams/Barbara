# Resolution Field Hashing

Deterministic hash function over resolution-critical fields: resolution rules text, resolution source, close time, outcome labels. Computed on every normalized market and stored in the `markets` table.

## Done when

- Identical markets produce same hash
- Any single resolution-critical field change produces a different hash

# Market Lifecycle Change Detection

On every upsert, compare incoming resolution hash against stored hash. On mismatch: log before/after values, flag the market. Detect status transitions (active -> suspended/closed) and close time extensions. If a changed market belongs to an active matched group, pause the group. Emit structured alert events.

## Done when

- Hash changes, status transitions, and close time extensions are detected and logged
- Affected matched groups are paused

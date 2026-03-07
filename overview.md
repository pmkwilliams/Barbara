# Prediction Market Arbitrage System

This project is inspired by the work in Semantic Non-Fungibility and Violations of the Law of One Price in Prediction Markets. (gebele_matthes_v1.pdf)

**Solo build · TypeScript-first · Rust if needed later**

---

## System Overview

The system is split into two process boundaries based on latency sensitivity. Everything on the execution hot path runs in a **single Bun process** sharing memory — no IPC, no serialization, no RPC between price tick and order submission. Cold-path work (matching, ingestion, UI) runs in separate processes and communicates exclusively through the database.

```
═══════════════════════════════════════════════════════════════════════
  TRADING RUNTIME — single Bun process, shared memory
═══════════════════════════════════════════════════════════════════════

  ┌───────────────────────────────────────────────────────────┐
  │  PLATFORM WEBSOCKET CLIENTS                               │
  │  Kalshi WS · Polymarket WS · (future platform feeds)      │
  │  Reconnect w/ backoff · staleness detection               │
  └──────────────────────────┬────────────────────────────────┘
          in-memory write    │
                             ▼
  ┌───────────────────────────────────────────────────────────┐
  │  ORDER BOOK MIRRORS (in-memory, zero-copy read)           │
  │  Sorted bid/ask arrays per market · fill simulation       │
  └──────────────────────────┬────────────────────────────────┘
          direct read        │
                             ▼
  ┌───────────────────────────────────────────────────────────┐
  │  SPREAD SCANNER + DEPTH VALIDATION                        │
  │  On every tick: check matched groups → compute net spread │
  │  → walk book for slippage → dynamic position sizing       │
  └──────────────────────────┬────────────────────────────────┘
          sync check         │
                             ▼
  ┌───────────────────────────────────────────────────────────┐
  │  POSITION STATE + CAPITAL SCORING (in-memory)             │
  │  Capital utilization · per-platform balances · category   │
  │  exposure · dynamic hurdle · opportunity scoring          │
  │  Risk limits + sizing checked synchronously before exec   │
  └──────────────────────────┬────────────────────────────────┘
          fire trade         │
                             ▼
  ┌───────────────────────────────────────────────────────────┐
  │  EXECUTION ENGINE                                         │
  │  Parallel N-leg order submission                          │
  │  Partial fill handling · circuit breaker · kill switch    │
  └──────────────────────────┬────────────────────────────────┘
          async flush        │
                             ▼
                         [SQLite]  ←── position snapshots, trade log,
                             │         P&L for dashboard reads
                             │
═══════════════════════════════════════════════════════════════════════
  COLD PATH — separate processes, no latency sensitivity
═══════════════════════════════════════════════════════════════════════
                             │
            reads/writes     │
          matched_groups,    │
          markets tables     │
                             │
  ┌──────────────────────────┴────────────────────────────────┐
  │  SEMANTIC MATCHING PIPELINE                               │
  │  Embedding retrieval → LLM verification → human review    │
  │  Writes matched_groups; runtime polls for changes         │
  ├───────────────────────────────────────────────────────────┤
  │  MARKET INGESTION (cron, 15–30 min)                       │
  │  REST polling for new listings → normalize → upsert       │
  ├───────────────────────────────────────────────────────────┤
  │  DASHBOARD / MONITORING UI                                │
  │  Svelte app, reads DB for positions, P&L, system health   │
  ├───────────────────────────────────────────────────────────┤
  │  ALERTING SERVICE                                         │
  │  Slack/Telegram push on signals, errors, circuit breaks   │
  ├───────────────────────────────────────────────────────────┤
  │  BACKTESTING / REPLAY ENGINE                              │
  │  Historical price data replay through detection logic     │
  ├───────────────────────────────────────────────────────────┤
  │  AUTOMATED POST-MORTEM                                    │
  │  LLM-generated incident reports from failure evidence     │
  └───────────────────────────────────────────────────────────┘
```

### Process Boundary Rules

1. **The trading runtime never makes an RPC or IPC call on the hot path.** WebSocket tick → spread check → risk check → order submission is one synchronous/async chain within a single process. No network calls to internal services.

2. **Position and capital state is authoritative in-memory.** The runtime holds the canonical capital utilization, per-platform balances, category exposure, and risk state. It flushes snapshots to the database asynchronously for the dashboard to read. Two signals arriving in the same tick share the same in-memory state — no stale-read race conditions.

3. **The database is the only coordination point between hot and cold paths.** The matching pipeline writes matched groups. The runtime polls for changes on a ~30-second interval. A new group appearing 30 seconds late is fine. A stale order book or stale risk state is not.

4. **Platform API auth helpers are shared code, not shared processes.** Both the runtime (for WebSocket + execution) and ingestion (for REST listing fetches) import the same auth/signing utilities. They run independently.

---

## Phase 0 — Project Scaffolding

**Goal:** Monorepo structure, tooling, and platform accounts ready.

### Milestones

- **Monorepo setup.** Bun workspaces with packages split by process boundary:

```
packages/
  core/               shared types, config, constants (imported everywhere)
  shared-platform/    platform-specific types, fee models, API auth/signing
                      helpers (imported by both runtime and ingestion — code
                      only, not a running process)
  runtime/            THE single trading process: WS feeds, order book
                      mirrors, spread scanner, depth validation, position
                      state, execution engine, risk controls, kill switch
  matching/           semantic pipeline: embeddings, LLM verification,
                      human review queue (separate process)
  ingestion/          market listing REST fetchers, normalization, DB
                      writes (separate process, cron-scheduled)
  dashboard/          Svelte monitoring UI (separate process)
  postmortem/         LLM-powered incident report generator (separate
                      process, triggered by runtime incident flags)
```

  TypeScript strict mode, ESLint, `bun test`. The critical design rule: `runtime/` is a single long-running Bun process. Everything it needs on the hot path lives inside it with shared in-memory access. No cross-package RPC.

- **Platform accounts.** Kalshi (KYC, fund account, request API access), Polymarket (wallet setup, USDC funding, CLOB API key). These have multi-day approval timelines — start immediately. The Polymarket wallet in particular requires planning — see Phase 5 for on-chain complexity.

- **Database.** SQLite for initial development (zero ops burden solo). Order book state and live position/risk state are **in-memory only** inside the runtime process — not in the DB. The DB stores snapshots and historical records for the dashboard and audit trail. Migrate to Postgres later if needed.

- **Credential security.** The Polymarket wallet private key is a bearer token to your funds — anyone with it can drain your account. Kalshi API credentials are similarly sensitive. Secrets must be encrypted at rest (never plaintext on disk), never committed to git, and the Polymarket wallet should be dedicated to this system only. Set up platform-level withdrawal allowlists where available.

### Key Decision

Start with Kalshi + Polymarket only. Two platforms is sufficient to validate the full pipeline. Adding platforms later is an additive effort, not an architectural change.

---

## Phase 1 — Market Ingestion & API Clients

**Goal:** Continuously ingest and store all active market listings from both platforms.

### Milestones

- **Kalshi client.** REST client for market listings. Store full market metadata: title, description, outcome labels, resolution source, close time, settlement rules.

- **Polymarket client.** CLOB API client for market listing data. Gamma Markets API for condition metadata. Map Polymarket's condition/token structure to a normalized internal representation.

- **Normalized market schema.** Common internal type across platforms capturing: platform identity, title, description, outcome labels, resolution source, resolution rules (full text), close time, category, status (active/closed/resolved/suspended), pricing, volume, and a hash of resolution-critical fields for change detection.

- **Ingestion scheduler.** Polls both platforms every 15–30 minutes for new/updated markets.

- **Market lifecycle monitoring.** Markets are not static — they get suspended, relisted with changed terms, have close dates extended, or get delisted entirely. A matched group can become invalid mid-hold if one platform amends its resolution rules. The ingestion pipeline must detect changes on already-matched markets:
  - **Hash resolution-critical fields** on every ingestion. When the hash changes on a market that's part of an active matched group, immediately pause the group and alert.
  - **Status changes.** If a market transitions to `suspended` or `closed` unexpectedly, pause all matched groups involving it and alert. For partition groups, a single suspended member invalidates the entire group.
  - **Close time extensions.** Re-evaluate the group's daily yield (hold time just increased) and check whether it still clears the capital management hurdle.
  - The runtime picks up paused groups on its next poll and stops scanning them. No manual intervention needed to stop trading — only to resume after re-verification.

- **Backfill script.** One-time script to ingest all currently active markets on both platforms.

### Validation Gate

Run the ingestion continuously and verify: no missed markets, correct metadata parsing, stable deduplication across re-ingestions.

---

## Phase 2 — Semantic Matching Pipeline

**Goal:** Automatically identify cross-platform groups of markets that refer to the same underlying event. Groups can be 2-market (equivalence, subset) or N-market (negative-risk partitions). This is the core moat — take the time to get it right.

### Milestones

- **Structural pre-filter.** Cheaply eliminate impossible candidates before any expensive embedding or LLM calls. Rules: temporal overlap required, same broad category, both markets still active.

- **Embedding retrieval.** Encode each market's title, description, and outcome labels into a vector. For each new market, retrieve top-k nearest neighbors across all other platforms. At <50K active markets, an in-memory index is fine.

- **Two-pass classification.** The matching pipeline runs in two passes:

  **Pass 1 — Pairwise classification.** For each candidate pair from retrieval, use the LLM to classify the relationship as: equivalent, subset, superset, overlapping, partition_member, or independent. The model also outputs a confidence score, resolution risk notes, subset direction (if applicable), and a shared parent event identifier (for partition members).

  Use whichever frontier model is SOTA at the time — this is the highest-stakes LLM call in the system. Current candidates to benchmark: **Claude Opus 4.6** and **GPT-5.3**. Design for model swap from day one: provider-agnostic interface, config-driven model selection, shared prompt templates across providers. Run both models in parallel during initial testing — classification divergence is itself a signal that a pair needs manual review.

  **Partition candidate clustering.** Collect all markets classified as `partition_member` in pairwise comparisons and cluster them by their shared parent event. Fuzzy-match on event strings (the LLM may phrase the same event differently across calls) using embedding similarity to merge clusters.

  **Pass 2 — Partition group verification.** For each candidate partition cluster, present all member markets together to the LLM and verify completeness. The model must answer: do these markets collectively exhaust all possible outcomes? Are there gaps? Are there overlaps (two markets that could both resolve YES)? Incomplete partitions are not tradeable. Overlapping partitions are dangerous. Only complete, non-overlapping, verified partitions become tradeable groups.

- **Approval gate.** Matched groups have three statuses: `pending`, `approved`, `rejected`. Only `approved` groups are visible to the runtime for trading. A configurable auto-approve threshold controls how much human involvement is required.

  **V1 default: everything requires human approval.** No group enters the trading universe without you reviewing it. As you build trust in the pipeline, lower the threshold to auto-approve high-confidence equivalence matches. Partition groups always require human approval — the completeness verification is too critical to automate early.

- **Review UI.** Simple CLI or lightweight page in the dashboard that presents pending groups with all member markets side-by-side. For partition groups, also show the completeness analysis and any flagged gaps or overlaps.

- **Matched groups schema.** Two tables: groups (type, confidence, risk notes, approval status, category) and group members (market ID, platform, role within the group, outcome label for partitions). Equivalence groups have 2 members. Subset groups have 2 members. Partition groups have N members. The runtime reads only approved and active groups.

### Milestone: The Matching Backlog

Run the full pipeline on all ingested markets. Manually review and approve every match. Target: 20–50 approved equivalence groups and any subset/partition groups the pipeline identifies. Pay special attention to partition groups: verify completeness by manually listing all possible outcomes and confirming every one is covered by exactly one member market.

### Key Risks

- **False equivalents.** The biggest risk in the entire system. Two markets that look identical but resolve differently due to different cutoff dates, resolution sources, or exception clauses.
- **Subset misclassification.** Classifying a pair as equivalent when one is actually a strict subset changes the trade structure entirely — the payout table is different.
- **Incomplete partitions.** A negative-risk group missing one outcome is not risk-free — it's a bet that the missing outcome doesn't happen. When in doubt, reject the partition.
- **Overlapping partition members.** If two members can both resolve YES simultaneously, a "guaranteed" payout becomes directional risk disguised as arbitrage.

---

## Phase 3 — Real-Time Price Monitoring

**Goal:** Maintain live order book mirrors for all markets in the active matched set.

*Note: Overlaps with Phase 2. Start WebSocket work while the matching pipeline is being reviewed.*

**Process boundary: Everything in this phase lives inside the runtime process.** WebSocket clients, order book mirrors, and the spread scanner share the same Bun process and memory space. The scanner reads order book objects directly — no serialization, no message passing, no database reads on the hot path.

### Milestones

- **Platform WebSocket clients.** Connect to Polymarket's CLOB WebSocket feed and Kalshi's WebSocket feed inside the runtime process. Subscribe to order book channels for all matched markets. Maintain local order book representations with incremental updates.

- **Matched groups loader.** On startup, the runtime reads approved and active groups from the database and builds an in-memory lookup table (market ID → list of groups it belongs to). A background poll (~30s) picks up newly approved groups. For partition groups, validate that all member markets have active order book subscriptions — a partition with a missing member is not tradeable.

- **Order book data structure.** Sorted bid/ask arrays per market supporting fast lookups: best bid/ask, walk N levels deep, fill simulation at a given size.

- **Connection resilience.** Automatic reconnect with exponential backoff. On reconnect, re-snapshot the full order book from scratch. Never trade on stale data — flag markets as stale if no update for >5 seconds, fall back to REST polling if staleness persists.

- **Platform API rate limits.** Build rate-awareness into the platform clients from day one. Track remaining quota from response headers. Separate rate limit budgets for reads vs. writes — reserve REST budget headroom for order submission. Queue and prioritize REST requests so execution always gets priority over monitoring. Document actual limits per platform in config.

### Validation Gate

Run price monitoring alongside manual spot-checks on platform UIs. Verify: bid/ask matches platform display within 1 cent, no stale data leaks, reconnections handled cleanly.

---

## Phase 4 — Opportunity Detection & Paper Trading

**Goal:** Detect arbitrage opportunities in real time. Paper trade to validate before risking capital.

### Milestones

- **Spread scanner.** On every price update event, check the updated market against all groups it belongs to. The spread calculation depends on group type:

  **Equivalence spread:** `1.00 - ask(platformA, YES) - ask(platformB, NO) - fees`. Check both directions, take the better one.

  **Subset spread:** Buy YES on the superset market, buy NO on the subset market. The guaranteed minimum payout is $1.00 in every possible state (if the superset is false, the subset NO wins; if both are true, the superset YES wins; if only the superset is true, both legs win for a $2.00 payout). So `1.00 - ask(superset, YES) - ask(subset, NO) - fees` is the risk-free component, with additional expected value from the superset-only zone.

  **Partition spread:** Buy YES on every member market. Exactly one resolves YES and pays $1.00. Net spread: `1.00 - sum(all YES asks) - sum(fees)`. All members must have available depth — the thinnest book sets the position size for the entire group.

- **Fee model.** Encode each platform's fee structure. Net spread must be calculated after all fees.

- **Depth validation.** Walk the order book on all legs to estimate fill price at target position size. For partition groups, the position size is constrained by the thinnest book across all N members. Dynamically size: if 4 of 5 legs can absorb $2,000 but the 5th can only handle $800, the whole group trades at $800.

- **Paper trading mode.** Log every detected opportunity as if executed, with simulated fills at available order book prices. Track all legs' prices, group type, simulated P&L. For partition groups, verify that exactly one resolves YES in historical data.

- **Alerting.** Push notifications for every opportunity above threshold. In paper trading phase, you want to see every signal and validate it manually.

### Milestone: Paper Trading Results

Run paper trading and analyze: signals per day, average net spread, any false positives from matching errors, typical hold times. This validates the entire upstream pipeline.

### Threshold Tuning

Start conservative: minimum 2.5% net spread after fees. Tighten later once you trust the system. The cost of a missed 2% opportunity is low. The cost of a false positive from a matching error is high.

---

## Phase 5 — Execution Engine

**Goal:** Submit real orders across platforms, handle partial fills, confirm execution.

### Milestones

- **Kalshi order client.** Authenticated REST API for order placement. Limit orders with aggressive pricing. Handle filled, partially filled, and rejected responses.

- **Polymarket order client.** The Polymarket CLOB is an off-chain order book backed by on-chain settlement via the Conditional Token Framework (CTF) on Polygon. This is significantly more complex than a standard REST API. Key concerns: USDC approval to the CLOB exchange proxy, EIP-712 typed data signing for off-chain orders, monitoring for on-chain settlement confirmation (don't assume a CLOB match means tokens are in your wallet), gas/MATIC management for edge cases (cancellations, direct CTF interactions), ERC-1155 conditional token balance tracking, and nonce management for rapid order submission.

- **Parallel execution.** Fire all legs simultaneously. For 2-leg groups, both orders go out within the same event loop tick. For N-leg partition groups, all N orders fire in parallel.

- **Partial fill handling.** The complexity scales with group size. For 2-leg groups: both fill (clean), one fills (retry-then-unwind via Failed Leg Handler), or both partially fill (record matched portion, handle residuals). For N-leg partition groups: all N fill (clean), N-1 fill (retry the failed leg aggressively — if it can't be filled, decide between unwinding all N-1 legs or holding as a near-complete partition), fewer than N-1 fill (too fragmented, unwind all filled legs immediately). Log every partial fill scenario — the frequency determines whether partition execution is viable at your latency.

- **Execution logging.** Every order attempt, response, fill, and cancellation logged with millisecond timestamps. Audit trail for debugging, tax reporting, and automated post-mortem evidence collection.

### Risk Controls

- **Daily loss limit.** If cumulative P&L for the day drops below a configured threshold, pause all new trades.
- **Position limit.** Maximum total capital deployed at any time — 70% of bankroll (30% reserve). See Capital Management for how the reserve interacts with the dynamic hurdle.
- **Circuit breaker.** If 3 consecutive executions result in one-sided fills, pause and alert. Something is wrong with a platform connection or the market has moved.
- **Kill switch.** A single command that cancels all resting orders and pauses all trading.

### Capital Management

All capital management state lives in-memory inside the runtime process. The scoring function runs on every signal before execution and adds effectively zero latency to the hot path.

#### Dynamic Hurdle Rate

Idle capital isn't earning zero — it earns the expected value of future opportunities you'd miss by being fully deployed. A trade is only worth taking if its return beats that option value. The hurdle adjusts based on current capital utilization:

```
utilization:   0%    25%    50%    75%    90%    95%
min yield/day: 0.05% 0.10%  0.20%  0.40%  0.80%  1.20%
```

When capital is mostly free, take anything profitable. As utilization climbs, get progressively pickier. The curve is hand-tuned for V1 and refined later using actual opportunity distribution data.

#### Daily Yield as Ranking Metric

All opportunities are ranked by return per dollar per day, not return per trade: `daily_yield = net_spread / expected_hold_days`. A 2% spread resolving in 2 days (1%/day) is 10x more capital-efficient than a 3% spread resolving in 30 days (0.1%/day). For V1, estimate expected hold days as time to resolution discounted by 0.5x for early exit via convergence.

#### Hold Time Penalty

Two trades with the same daily yield aren't equally attractive when capital is scarce. A 2-day hold frees capital for 5 more deployments in the same window a 14-day hold locks it up. Apply a penalty that scales with both hold duration and utilization: `adjusted_yield = daily_yield - (hold_penalty × days_to_resolution × utilization²)`. The squared utilization term makes the penalty negligible when capital is abundant but steep near capacity.

#### Category Concentration

Cap deployed capital per event category at 30%. If multiple open positions cluster on the same event type, a single resolution divergence or platform outage hits them all simultaneously.

#### Per-Platform Balance Tracking

Capital is physically split across platforms and not fungible in real time. The runtime tracks per-platform available balance as a hard constraint. When any platform drops below 20% of its starting allocation, fire an alert. Rebalancing requires manual withdrawal and deposit. The sizing logic refuses to take trades it can't fund on all legs.

Longer term, when both directions of an arb are profitable, the system can prefer the direction that rebalances the depleted platform. This is a Phase 7 optimization.

#### Sizing Formula

Every trade's allocation is the minimum of: depth (thinnest book across all legs), per-platform balance (most constrained platform), per-trade cap, available capital (total minus deployed minus reserve), and category room. The binding constraint shifts depending on conditions. For partition groups, depth and platform balance are typically more binding because you're constrained by the weakest leg across N markets.

#### Opportunity Scoring

When multiple signals compete for limited capital, score each by adjusted yield and fund from the top until capital is exhausted.

#### Calibration

Log every decision — taken and rejected — with the full scoring context. Track missed opportunity cost: every signal rejected because capital was fully deployed. This data calibrates the hurdle curve over time.

**Future optimization (not V1):** Proactively exit low-yield positions to free capital for better incoming signals.

### Failed Leg Handler

When some legs fill and others fail, the runtime enters a retry-then-unwind loop. The core principle: completing the group at a worse price is often cheaper than unwinding, because unwinding has its own cost (bid-ask spread + fees on each round trip). This gives meaningful price room to retry.

For 2-leg groups, the breakeven: `P_max = (1.00 - P_filled) - fee_on_second_leg + estimated_unwind_cost`. For N-leg groups, compute total remaining budget and distribute across unfilled legs. If total remaining budget is negative, unwind immediately.

V1 logic: retry at original price, then walk up in increments, recalculating budgets using current unwind costs at each step. Timeout after 10 minutes and unwind. N-leg exception: if N-1 of N partition legs are filled and the missing outcome has very low probability, consider holding rather than unwinding N-1 legs — flag for manual review.

### Runtime Startup & Recovery

Because position state is in-memory, the runtime needs a clean recovery path on restart: load matched groups, rehydrate position state from the last DB snapshot, reconcile against platform APIs (query open orders and balances to confirm DB matches reality), build fresh order book mirrors from scratch, and pause execution for 30 seconds after startup to let books stabilize. The reconciliation step is critical — if the runtime crashed mid-execution, you might have a one-sided fill the DB doesn't know about.

### Milestone: First Live Trade

Execute your first real arbitrage trade. Start small ($100–$200) on a high-confidence equivalence group. Verify the full loop: detection → execution → position tracking → resolution → settlement verification → P&L. Only after multiple successful equivalence trades should you attempt a subset or partition trade live.

---

## Phase 6 — Position Management & Early Exit

**Goal:** Actively manage open positions for capital efficiency.

### Milestones

- **Position tracker.** In-memory authoritative state for all open positions. Flushes snapshots to the database asynchronously for the dashboard. For partition groups, track resolution status of each member independently.

- **Convergence monitor.** On every price tick affecting an open position, check if the spread has converged to near-zero. For equivalence/subset groups, the combined cost of both legs rising to near $1.00. For partition groups, the sum of all YES prices rising to near $1.00. Sell all legs and free up capital.

- **News shock detection.** If one leg moves dramatically, the in-the-money leg has captured most of its value. For 2-leg groups: sell the winner and hold the loser as cheap optionality, or sell both. For partition groups: if one outcome spikes, sell all other legs and either sell the winner immediately or hold for resolution.

- **Resolution countdown.** Track resolution dates and alert when positions are within 24 hours of resolution.

### Resolution Tracking & Settlement

This is the final step in the trade lifecycle and a critical safety check. The runtime needs to detect when events resolve, confirm settlement on each platform, and catch the nightmare scenario where a group resolves inconsistently.

**Detection.** Poll resolved/settled status for all markets with open positions on a 1-minute interval (off the hot path). Kalshi marks markets as `settled` with a result. Polymarket resolves through its oracle and the CTF contract reflects the outcome on-chain.

**Cross-platform resolution verification.** As each leg resolves, record the result and check consistency against the group type. Only declare the group fully resolved when all legs have reported. The rules: equivalence groups should have exactly one YES across the two legs. Subset groups require that if the subset is YES, the superset must also be YES. Partition groups should have exactly one YES across all N members. Any other pattern is a divergence.

**Divergence alert.** If verification detects divergence, this is the worst-case scenario. Immediately: fire a critical alert, pause the matched group permanently, log full details for investigation, and flag the classification as a failure case to improve future matching.

**Settlement reconciliation.** Confirm actual funds received on each platform match expectations. If there's a discrepancy, alert.

**Capital release.** Once all legs are confirmed settled and reconciled, release capital back to available balance and per-platform balances, record realized P&L.

**Partial resolution timing.** Platforms don't always resolve simultaneously. For N-leg partition groups, resolution can stagger across hours or days. Track resolution status per-leg. Don't release capital until all legs are confirmed.

- **P&L dashboard.** Runs as a **separate process**. SvelteKit app that reads position snapshots and trade history from the database. Shows: open positions, realized P&L, unrealized P&L, capital utilization, trade history.

### Capital Recycling

The core insight from early exit: faster capital turnover feeds directly into the Capital Management framework. Faster exits lower utilization, which lowers the hurdle rate, which means more opportunities get taken.

---

## Phase 7 — Hardening & Platform Expansion

**Goal:** Make the system robust for sustained operation and expand the opportunity set.

### Milestones

- **Add platforms.** Robinhood prediction markets, DraftKings, others as APIs become available. Each new platform is: API client, normalized market ingestion, order book monitoring, execution client. The semantic matching layer and opportunity detection are platform-agnostic by design.

- **Monitoring and alerting.** System health: WebSocket connection status, ingestion pipeline freshness, matching pipeline errors, execution latency percentiles.

- **Backtesting framework.** Store all historical price data. Build a replay engine that runs detection and paper execution against historical data. Use to tune thresholds, test new matching rules, and estimate capacity.

- **Tax tracking.** Every trade recorded with: entry date, exit date, cost basis, proceeds, platform, fees. Consult a tax advisor — the IRS hasn't clarified prediction market treatment.

- **Rust migration candidates.** If profiling shows bottlenecks inside the runtime: the order book data structure and spread scanner loop are the most likely candidates for a Rust rewrite via NAPI-RS bindings. Only do this if you're actually hitting latency constraints, not preemptively.

---

## Testing Strategy

Testing is a cross-cutting concern, not a single phase. The cost of a bug varies enormously — a spread scanner off by a penny is an annoyance, a false match classification is a catastrophe.

### Unit Tests (Every Phase)

Pure functions tested with `bun test`, run on every commit. Key areas: spread scanner, capital scoring, failed leg handler, resolution verification (all group types), fee models, and market lifecycle (change detection, group pausing).

### Integration Tests (Phases 1, 3, 5)

Test platform API clients against sandbox environments. Kalshi provides a demo environment — run the full pipeline against it before touching real money. For Polymarket, use a testnet if available or build a local mock server replaying recorded API responses. Also validate rate limit handling under simulated pressure.

### Simulation Mode (Phase 4)

Record all WebSocket messages and REST responses during live monitoring, then replay through the full runtime for regression testing, threshold tuning, and new platform onboarding. Keep a meaningful window of production data as a standing regression suite.

### What Not to Test

Don't unit test LLM matching classification — it's non-deterministic. Instead, maintain a curated set of known-tricky market pairs and re-run them whenever you swap models or update prompts. This is an eval, not a unit test.

---

## Automated Post-Mortem

When something goes wrong — a failed execution, a negative-ROI trade, a resolution divergence, a circuit breaker trip — the system should automatically produce a structured incident report. You won't always be watching when failures happen, and by the time you look at the dashboard, the context that explains *why* something failed is scattered across logs, order book snapshots, and platform API responses. An LLM reading the raw evidence while it's fresh produces a far better report than you reconstructing it hours later.

### Trigger Events

The runtime flags an incident automatically on any of these:

- **Execution failure.** One or more legs failed to fill after exhausting the retry loop, resulting in an unwind.
- **Negative-ROI close.** A position closed (via early exit, unwind, or resolution) with a realized loss.
- **Resolution divergence.** Cross-platform verification returned divergent.
- **Circuit breaker trip.** 3+ consecutive one-sided fills triggered a trading pause.
- **Failed unwind.** The failed leg handler couldn't unwind a filled leg (no depth), requiring manual intervention.
- **Unexpected market state.** Lifecycle monitoring detected a metadata change or suspension on a market with an open position.
- **Settlement discrepancy.** Actual funds received after resolution didn't match expected settlement.

### Evidence Collection

On trigger, the runtime immediately snapshots everything relevant: execution trace (timestamped log from signal detection through final outcome), order book state at detection and at each execution attempt, portfolio state at decision time (utilization, hurdle, sizing), raw platform API responses, matched group metadata and approval history, and a price history window covering entry to incident. Store as structured JSON — machine-readable for the LLM.

### Report Generation

A background process (cold path) picks up new incidents and generates a structured report. The LLM receives the full evidence package and produces: a plain-English summary, a chronological timeline, a root cause assessment (data issue, execution issue, matching issue, or market issue), financial impact, and suggested action items. Use the same provider-agnostic LLM pattern as the matching verifier — config-driven provider and model selection, swappable without code changes.

### Report Delivery

Write structured reports to the database for the dashboard. Push summaries to the alerting channel with links to full reports. For critical severity incidents (resolution divergence, settlement discrepancy), push the full report.

### Feedback Loop

The incident library feeds back into the system over time: failure cases improve the matching eval set, patterns in negative-ROI trades inform capital management thresholds, per-platform incident frequency drives platform reliability scoring, and monthly batch reviews surface aggregate patterns invisible in individual reports.

---

## Milestone Summary

| Phase | Key Deliverable |
|-------|----------------|
| 0 — Scaffolding | Monorepo, platform accounts submitted, credential security |
| 1 — Ingestion | All active markets ingested and normalized, lifecycle monitoring live |
| 2 — Matching | Semantic pipeline producing verified matched groups (equivalence, subset, partition) |
| 3 — Price Monitoring | Live order book mirrors, rate limit handling, staleness detection |
| 4 — Detection | Paper trading + simulation recording for regression tests |
| 5 — Execution | Kalshi + Polymarket on-chain execution, capital management, first live trades |
| 6 — Position Mgmt | Early exit, convergence monitoring, resolution settlement, P&L dashboard |
| 7 — Hardening | Platform expansion, backtesting, monitoring |

---

## Stack Summary

| Layer | Technology | Process | Rationale |
|-------|-----------|---------|-----------|
| Language | TypeScript (strict) | All | Core stack, fast iteration, solo-friendly |
| Runtime | Bun | `runtime` | Native WebSocket, fast startup, built-in test runner, single event loop |
| Database | SQLite | Shared via file | Zero ops, coordination point between processes |
| LLM (matching) | Provider-agnostic (currently testing Opus 4.6 + GPT-5.3) | `matching` | SOTA frontier model, swappable via config |
| Dashboard | SvelteKit | `dashboard` | Separate process, reads DB snapshots |
| Alerting | Slack webhook or Telegram bot | `runtime` + `matching` | Real-time signals to your phone |

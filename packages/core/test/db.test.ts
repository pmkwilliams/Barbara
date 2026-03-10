import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDb, runMigrations } from "../src/db";
import { ingestion_runs, markets } from "../src/schema";

describe("core database", () => {
  test("inserts and queries a market row", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const insertedMarket = {
        id: "mkt_kalshi_001",
        platform: "kalshi",
        platform_id: "KXEVENT-001",
        title: "Will CPI print above 3%?",
        description: "Consumer Price Index year-over-year outcome market.",
        event_ticker: "CPI-2026",
        series_ticker: "ECON",
        outcome_labels: JSON.stringify(["yes", "no"]),
        resolution_source: "BLS CPI Release",
        resolution_rules: "Resolves based on BLS CPI release.",
        open_time: "2026-03-01T12:30:00.000Z",
        start_time: null,
        close_time: "2026-04-01T12:30:00.000Z",
        end_time: "2026-04-01T12:30:00.000Z",
        group_title: null,
        category: null,
        market_shape: "binary",
        is_binary_eligible: true,
        status: "active",
        volume: 12345.67,
        resolution_hash: "abc123",
        raw_data: JSON.stringify({ source: "kalshi" }),
        created_at: "2026-03-06T20:00:00.000Z",
        updated_at: "2026-03-06T20:00:00.000Z"
      };

      db.insert(markets).values(insertedMarket).run();

      const result = db.select().from(markets).where(eq(markets.id, insertedMarket.id)).get();

      expect(result).toEqual(insertedMarket);
    } finally {
      sqlite.close();
    }
  });

  test("inserts and queries an ingestion run", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const insertedRun = {
        platform: "polymarket",
        started_at: "2026-03-06T21:00:00.000Z",
        completed_at: "2026-03-06T21:01:00.000Z",
        markets_found: 12,
        markets_created: 4,
        markets_updated: 8,
        status: "completed",
        error: null
      };

      db.insert(ingestion_runs).values(insertedRun).run();

      const result = db
        .select()
        .from(ingestion_runs)
        .where(eq(ingestion_runs.platform, insertedRun.platform))
        .get();

      expect(result?.platform).toBe(insertedRun.platform);
      expect(result?.started_at).toBe(insertedRun.started_at);
      expect(result?.completed_at).toBe(insertedRun.completed_at);
      expect(result?.markets_found).toBe(insertedRun.markets_found);
      expect(result?.markets_created).toBe(insertedRun.markets_created);
      expect(result?.markets_updated).toBe(insertedRun.markets_updated);
      expect(result?.status).toBe(insertedRun.status);
      expect(result?.error).toBe(insertedRun.error);
      expect(result?.id).toBeTypeOf("number");
    } finally {
      sqlite.close();
    }
  });

  test("enforces unique platform and platform_id", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      db.insert(markets)
        .values({
          id: "mkt_unique_001",
          platform: "kalshi",
            platform_id: "DUP-001",
            title: "First row",
            outcome_labels: JSON.stringify(["yes", "no"]),
            market_shape: "binary",
            is_binary_eligible: true,
            status: "active"
          })
        .run();

      expect(() => {
        db.insert(markets)
          .values({
            id: "mkt_unique_002",
            platform: "kalshi",
            platform_id: "DUP-001",
            title: "Duplicate row",
            outcome_labels: JSON.stringify(["yes", "no"]),
            market_shape: "binary",
            is_binary_eligible: true,
            status: "active"
          })
          .run();
      }).toThrow();
    } finally {
      sqlite.close();
    }
  });
});

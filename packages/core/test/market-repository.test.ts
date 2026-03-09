import { describe, expect, test } from "bun:test";

import { createDb, runMigrations } from "../src/db";
import {
  getActiveMarkets,
  getMarketById,
  getMarketsByPlatform,
  MarketStatus,
  Platform,
  upsertMarket,
  type NormalizedMarketInput
} from "../src";

const makeInput = (overrides: Partial<NormalizedMarketInput> = {}): NormalizedMarketInput => ({
  platform: Platform.KALSHI,
  platform_id: "TEST-001",
  title: "Will CPI exceed 3%?",
  description: "Year-over-year CPI outcome.",
  outcome_labels: ["Yes", "No"],
  resolution_source: "BLS CPI Release",
  resolution_rules: "Resolves Yes if YoY CPI > 3% per BLS.",
  close_time: "2026-04-01T12:30:00.000Z",
  category: "macro",
  status: MarketStatus.ACTIVE,
  volume: 12345.67,
  resolution_hash: null,
  raw_data: { source: "kalshi", ticker: "TEST-001" },
  ...overrides
});

describe("market repository", () => {
  test("upsert inserts new market", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const input = makeInput();
      const market = upsertMarket(db, input);

      expect(market).toMatchObject({
        ...input,
        id: "kalshi:TEST-001"
      });
      expect(new Date(market.created_at).toISOString()).toBe(market.created_at);
      expect(new Date(market.updated_at).toISOString()).toBe(market.updated_at);
    } finally {
      sqlite.close();
    }
  });

  test("upsert updates existing market", async () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const inserted = upsertMarket(db, makeInput());
      await Bun.sleep(5);

      const updated = upsertMarket(
        db,
        makeInput({ title: "Will CPI stay above 3%?", volume: 99999.99 })
      );

      expect(updated.title).toBe("Will CPI stay above 3%?");
      expect(updated.volume).toBe(99999.99);
      expect(updated.created_at).toBe(inserted.created_at);
      expect(updated.updated_at).not.toBe(inserted.updated_at);
    } finally {
      sqlite.close();
    }
  });

  test("getMarketById returns market", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const inserted = upsertMarket(db, makeInput());
      const market = getMarketById(db, inserted.id);

      expect(market).toEqual(inserted);
    } finally {
      sqlite.close();
    }
  });

  test("getMarketById returns undefined for missing id", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      expect(getMarketById(db, "nonexistent")).toBeUndefined();
    } finally {
      sqlite.close();
    }
  });

  test("getMarketsByPlatform filters correctly", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      upsertMarket(db, makeInput());
      upsertMarket(
        db,
        makeInput({
          platform: Platform.POLYMARKET,
          platform_id: "TEST-002",
          raw_data: { source: "polymarket", slug: "test-002" }
        })
      );

      const markets = getMarketsByPlatform(db, Platform.KALSHI);

      expect(markets).toHaveLength(1);
      expect(markets[0]?.platform).toBe(Platform.KALSHI);
      expect(markets[0]?.id).toBe("kalshi:TEST-001");
    } finally {
      sqlite.close();
    }
  });

  test("getActiveMarkets filters by status", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      upsertMarket(db, makeInput({ platform_id: "ACTIVE-001", status: MarketStatus.ACTIVE }));
      upsertMarket(db, makeInput({ platform_id: "CLOSED-001", status: MarketStatus.CLOSED }));
      upsertMarket(db, makeInput({ platform_id: "RESOLVED-001", status: MarketStatus.RESOLVED }));

      const markets = getActiveMarkets(db);

      expect(markets).toHaveLength(1);
      expect(markets[0]?.platform_id).toBe("ACTIVE-001");
      expect(markets[0]?.status).toBe(MarketStatus.ACTIVE);
    } finally {
      sqlite.close();
    }
  });

  test("outcome_labels round-trips as string array", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const input = makeInput({ outcome_labels: ["Yes", "No", "Maybe"] });
      upsertMarket(db, input);

      const market = getMarketById(db, "kalshi:TEST-001");

      expect(market).toBeDefined();
      expect(typeof market?.outcome_labels).not.toBe("string");
      expect(Array.isArray(market?.outcome_labels)).toBe(true);
      expect(market?.outcome_labels).toEqual(input.outcome_labels);
    } finally {
      sqlite.close();
    }
  });

  test("raw_data round-trips as object", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const raw_data = { nested: { key: "value" }, arr: [1, 2] };
      upsertMarket(db, makeInput({ raw_data }));

      const market = getMarketById(db, "kalshi:TEST-001");

      expect(market?.raw_data).toEqual(raw_data);
    } finally {
      sqlite.close();
    }
  });

  test("raw_data null round-trips", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      upsertMarket(db, makeInput({ raw_data: null }));

      const market = getMarketById(db, "kalshi:TEST-001");

      expect(market?.raw_data).toBeNull();
    } finally {
      sqlite.close();
    }
  });
});

import { describe, expect, test } from "bun:test";

import {
  createDb,
  getMarketById,
  ingestion_runs,
  Platform,
  runMigrations,
  type BarbaraDb
} from "@barbara/core";
import type { GammaClient, GammaMarket, KalshiClient, KalshiRawMarket } from "@barbara/shared-platform";

import { runIngestion } from "../src/orchestrator";

const makeKalshiMarket = (overrides: Partial<KalshiRawMarket> = {}): KalshiRawMarket => ({
  ticker: "KX-001",
  event_ticker: "EVENT-1",
  market_type: "binary",
  title: "Will CPI exceed 3%?",
  yes_sub_title: "Yes",
  no_sub_title: "No",
  status: "active",
  open_time: "2026-01-01T00:00:00.000Z",
  close_time: "2026-02-01T00:00:00.000Z",
  latest_expiration_time: "2026-02-01T00:00:00.000Z",
  result: "",
  yes_bid_dollars: "0.45",
  yes_ask_dollars: "0.47",
  no_bid_dollars: "0.53",
  no_ask_dollars: "0.55",
  last_price_dollars: "0.46",
  volume: 1234,
  volume_24h: 200,
  open_interest: 50,
  rules_primary: "Primary rules",
  rules_secondary: "Secondary rules",
  can_close_early: false,
  ...overrides
});

const makeGammaMarket = (overrides: Partial<GammaMarket> = {}): GammaMarket => ({
  id: "123",
  question: "Will BTC end above $100k?",
  conditionId: "condition-1",
  slug: "btc-100k",
  outcomes: ["Yes", "No"],
  outcomePrices: ["0.4", "0.6"],
  clobTokenIds: ["1", "2"],
  active: true,
  closed: false,
  volume: "12345.67",
  description: "Market resolves based on daily close.",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-12-31T00:00:00.000Z",
  resolutionSource: "Exchange close",
  groupItemTitle: "BTC",
  enableOrderBook: true,
  ...overrides
});

const asKalshiClient = (
  implementation: (params?: unknown) => AsyncGenerator<KalshiRawMarket[]>
): KalshiClient => ({
  paginateMarkets: implementation
} as unknown as KalshiClient);

const asGammaClient = (
  implementation: (params?: unknown) => AsyncGenerator<GammaMarket[]>
): GammaClient => ({
  paginateMarkets: implementation
} as unknown as GammaClient);

const readLatestRun = (db: BarbaraDb) => db.select().from(ingestion_runs).orderBy(ingestion_runs.id).all().at(-1);

describe("runIngestion", () => {
  test("completes a successful Kalshi run with insert and update counts", async () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const existing = makeKalshiMarket({ ticker: "KX-001" });
      await runIngestion(Platform.KALSHI, db, {
        kalshi: asKalshiClient(async function* () {
          yield [existing];
        }),
        gamma: asGammaClient(async function* () {
          yield [];
        })
      });

      await Bun.sleep(5);

      const result = await runIngestion(Platform.KALSHI, db, {
        kalshi: asKalshiClient(async function* () {
          yield [
            makeKalshiMarket({ ticker: "KX-001", title: "Updated title" }),
            makeKalshiMarket({ ticker: "KX-002", title: "New market" })
          ];
        }),
        gamma: asGammaClient(async function* () {
          yield [];
        })
      });

      const latestRun = readLatestRun(db);

      expect(result).toMatchObject({
        platform: Platform.KALSHI,
        status: "completed",
        markets_found: 2,
        markets_created: 1,
        markets_updated: 1,
        markets_errored: 0
      });
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(latestRun).toMatchObject({
        platform: Platform.KALSHI,
        status: "completed",
        markets_found: 2,
        markets_created: 1,
        markets_updated: 1,
        error: null
      });
      expect(getMarketById(db, "kalshi:KX-001")?.title).toBe("Updated title");
      expect(getMarketById(db, "kalshi:KX-002")?.title).toBe("New market");
    } finally {
      sqlite.close();
    }
  });

  test("continues processing after per-market errors", async () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const result = await runIngestion(Platform.KALSHI, db, {
        kalshi: asKalshiClient(async function* () {
          yield [
            makeKalshiMarket({ ticker: "KX-OK-1" }),
            { ...makeKalshiMarket({ ticker: "KX-BAD" }), rules_primary: undefined } as unknown as KalshiRawMarket,
            makeKalshiMarket({ ticker: "KX-OK-2" })
          ];
        }),
        gamma: asGammaClient(async function* () {
          yield [];
        })
      });

      const latestRun = readLatestRun(db);

      expect(result).toMatchObject({
        status: "completed",
        markets_found: 3,
        markets_created: 2,
        markets_updated: 0,
        markets_errored: 1
      });
      expect(getMarketById(db, "kalshi:KX-OK-1")).toBeDefined();
      expect(getMarketById(db, "kalshi:KX-OK-2")).toBeDefined();
      expect(getMarketById(db, "kalshi:KX-BAD")).toBeUndefined();
      expect(latestRun?.status).toBe("completed");
      expect(latestRun?.markets_created).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  test("marks run failed on run-level fetch errors and supports Polymarket", async () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const success = await runIngestion(Platform.POLYMARKET, db, {
        kalshi: asKalshiClient(async function* () {
          yield [];
        }),
        gamma: asGammaClient(async function* () {
          yield [makeGammaMarket({ conditionId: "condition-1" })];
        })
      });

      expect(success).toMatchObject({
        platform: Platform.POLYMARKET,
        status: "completed",
        markets_found: 1,
        markets_created: 1,
        markets_updated: 0,
        markets_errored: 0
      });
      expect(getMarketById(db, "polymarket:condition-1")?.platform).toBe(Platform.POLYMARKET);

      const failed = await runIngestion(Platform.POLYMARKET, db, {
        kalshi: asKalshiClient(async function* () {
          yield [];
        }),
        gamma: asGammaClient(async function* () {
          yield* [];
          throw new Error("gamma unavailable");
        })
      });

      const failedRun = readLatestRun(db);

      expect(failed).toMatchObject({
        platform: Platform.POLYMARKET,
        status: "failed",
        error: "gamma unavailable"
      });
      expect(failedRun).toMatchObject({
        status: "failed",
        error: "gamma unavailable"
      });
    } finally {
      sqlite.close();
    }
  });

  test("forwards market limits to platform clients", async () => {
    const { db, sqlite } = createDb(":memory:");
    const calls: unknown[] = [];

    try {
      runMigrations(db);

      await runIngestion(Platform.KALSHI, db, {
        kalshi: asKalshiClient(async function* (params?: unknown) {
          calls.push(params);
          yield [makeKalshiMarket({ ticker: "KX-LIMIT" })];
        }),
        gamma: asGammaClient(async function* () {
          yield [];
        })
      }, { marketLimit: 3 });

      await runIngestion(Platform.POLYMARKET, db, {
        kalshi: asKalshiClient(async function* () {
          yield [];
        }),
        gamma: asGammaClient(async function* (params?: unknown) {
          calls.push(params);
          yield [makeGammaMarket({ conditionId: "condition-limit" })];
        })
      }, { marketLimit: 5 });

      expect(calls).toEqual([
        { limit: 3, status: "open", mve_filter: "exclude" },
        { active: true, closed: false, limit: 5 }
      ]);
    } finally {
      sqlite.close();
    }
  });

  test("caps request page size while preserving large total market limits", async () => {
    const { db, sqlite } = createDb(":memory:");
    const calls: unknown[] = [];

    try {
      runMigrations(db);

      await runIngestion(Platform.KALSHI, db, {
        kalshi: asKalshiClient(async function* (params?: unknown) {
          calls.push(params);
          yield [makeKalshiMarket({ ticker: "KX-BIG" })];
        }),
        gamma: asGammaClient(async function* () {
          yield [];
        })
      }, { marketLimit: 10_000 });

      await runIngestion(Platform.POLYMARKET, db, {
        kalshi: asKalshiClient(async function* () {
          yield [];
        }),
        gamma: asGammaClient(async function* (params?: unknown) {
          calls.push(params);
          yield [makeGammaMarket({ conditionId: "condition-big" })];
        })
      }, { marketLimit: 10_000 });

      expect(calls).toEqual([
        { limit: 1000, status: "open", mve_filter: "exclude" },
        { active: true, closed: false, limit: 500 }
      ]);
    } finally {
      sqlite.close();
    }
  });

  test("uses active-market defaults without a limit", async () => {
    const { db, sqlite } = createDb(":memory:");
    const calls: unknown[] = [];

    try {
      runMigrations(db);

      await runIngestion(Platform.KALSHI, db, {
        kalshi: asKalshiClient(async function* (params?: unknown) {
          calls.push(params);
          yield [];
        }),
        gamma: asGammaClient(async function* () {
          yield [];
        })
      });

      await runIngestion(Platform.POLYMARKET, db, {
        kalshi: asKalshiClient(async function* () {
          yield [];
        }),
        gamma: asGammaClient(async function* (params?: unknown) {
          calls.push(params);
          yield [];
        })
      });

      expect(calls).toEqual([
        { status: "open", mve_filter: "exclude" },
        { active: true, closed: false }
      ]);
    } finally {
      sqlite.close();
    }
  });

  test("caps fetched markets when marketLimit is set", async () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const result = await runIngestion(Platform.KALSHI, db, {
        kalshi: asKalshiClient(async function* () {
          yield [
            makeKalshiMarket({ ticker: "KX-1" }),
            makeKalshiMarket({ ticker: "KX-2" }),
            makeKalshiMarket({ ticker: "KX-3" })
          ];
          yield [makeKalshiMarket({ ticker: "KX-4" })];
        }),
        gamma: asGammaClient(async function* () {
          yield [];
        })
      }, { marketLimit: 2 });

      expect(result.markets_found).toBe(2);
      expect(getMarketById(db, "kalshi:KX-1")).toBeDefined();
      expect(getMarketById(db, "kalshi:KX-2")).toBeDefined();
      expect(getMarketById(db, "kalshi:KX-3")).toBeUndefined();
      expect(getMarketById(db, "kalshi:KX-4")).toBeUndefined();
    } finally {
      sqlite.close();
    }
  });
});

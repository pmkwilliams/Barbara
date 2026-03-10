import { describe, expect, test } from "bun:test";

import type { Config, DbConnection, Platform } from "@barbara/core";

import type { IngestionClients, IngestionRunResult } from "../src/orchestrator";
import { startScheduler } from "../src/scheduler";

const TEST_CONFIG: Config = {
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "error",
  INGESTION_INTERVAL_MS: 100,
  MAX_CYCLE_DURATION_MS: 1_000,
  KALSHI_API_KEY: undefined,
  KALSHI_PRIVATE_KEY_PATH: undefined,
  KALSHI_BASE_URL: "https://example.com",
  POLYMARKET_API_KEY: undefined,
  POLYMARKET_PRIVATE_KEY: undefined
};

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const createResult = (platform: Platform): IngestionRunResult => ({
  platform,
  status: "completed",
  markets_found: 0,
  markets_created: 0,
  markets_updated: 0,
  markets_errored: 0,
  duration_ms: 1
});

const createConnection = (events: string[]): DbConnection => ({
  db: {} as DbConnection["db"],
  sqlite: {
    close: () => {
      events.push("close");
    }
  } as DbConnection["sqlite"]
});

describe("startScheduler", () => {
  test("queues follow-up cycles without overlapping platform runs", async () => {
    const events: string[] = [];
    let activeRuns = 0;
    let maxActiveRuns = 0;
    let callCount = 0;

    const handle = startScheduler(
      createConnection(events),
      {} as IngestionClients,
      {
        ...TEST_CONFIG,
        INGESTION_INTERVAL_MS: 10,
        MAX_CYCLE_DURATION_MS: 5
      },
      {
        runPlatformIngestion: async (platform) => {
          callCount += 1;
          activeRuns += 1;
          maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
          events.push(`start:${platform}:${callCount}`);

          await wait(20);

          activeRuns -= 1;
          events.push(`end:${platform}:${callCount}`);
          return createResult(platform);
        }
      }
    );

    await wait(90);
    await handle.stop();

    expect(maxActiveRuns).toBe(1);
    expect(callCount).toBeGreaterThanOrEqual(4);
    expect(events.at(-1)).toBe("close");
  });

  test("waits for the active cycle before closing sqlite", async () => {
    const events: string[] = [];

    const handle = startScheduler(
      createConnection(events),
      {} as IngestionClients,
      {
        ...TEST_CONFIG,
        INGESTION_INTERVAL_MS: 50,
        MAX_CYCLE_DURATION_MS: 500
      },
      {
        runPlatformIngestion: async (platform) => {
          events.push(`start:${platform}`);
          await wait(15);
          events.push(`end:${platform}`);
          return createResult(platform);
        }
      }
    );

    await wait(1);
    const stopPromise = handle.stop();

    expect(events).toContain("start:kalshi");
    expect(events).not.toContain("close");

    await stopPromise;

    expect(events).toEqual([
      "start:kalshi",
      "end:kalshi",
      "start:polymarket",
      "end:polymarket",
      "close"
    ]);
  });

  test("keeps the stall timeout active during stop so hung cycles can abort", async () => {
    const events: string[] = [];

    const handle = startScheduler(
      createConnection(events),
      {} as IngestionClients,
      {
        ...TEST_CONFIG,
        INGESTION_INTERVAL_MS: 50,
        MAX_CYCLE_DURATION_MS: 20
      },
      {
        runPlatformIngestion: async (platform, _db, _clients, options) => {
          events.push(`start:${platform}`);

          if (platform === "kalshi") {
            await new Promise<void>((resolve) => {
              options?.signal?.addEventListener(
                "abort",
                () => {
                  events.push("abort:kalshi");
                  resolve();
                },
                { once: true }
              );
            });

            return {
              ...createResult(platform),
              status: "failed",
              error: "The operation was aborted."
            };
          }

          events.push(`end:${platform}`);
          return createResult(platform);
        }
      }
    );

    await wait(1);
    await handle.stop();

    expect(events).toEqual(["start:kalshi", "abort:kalshi", "close"]);
  });

  test("aborts timed-out cycles so queued work can continue and stop can finish", async () => {
    const events: string[] = [];
    let kalshiCalls = 0;

    const handle = startScheduler(
      createConnection(events),
      {} as IngestionClients,
      {
        ...TEST_CONFIG,
        INGESTION_INTERVAL_MS: 10,
        MAX_CYCLE_DURATION_MS: 20
      },
      {
        runPlatformIngestion: async (platform, _db, _clients, options) => {
          events.push(`start:${platform}`);

          if (platform === "kalshi" && kalshiCalls === 0) {
            kalshiCalls += 1;

            await new Promise<void>((resolve) => {
              options?.signal?.addEventListener(
                "abort",
                () => resolve(),
                { once: true }
              );
            });

            return {
              ...createResult(platform),
              status: "failed",
              error: "The operation was aborted."
            };
          }

          await wait(5);
          events.push(`end:${platform}`);
          return createResult(platform);
        }
      }
    );

    await wait(80);
    await handle.stop();

    expect(events).toContain("start:kalshi");
    expect(events.filter((event) => event === "start:kalshi").length).toBeGreaterThanOrEqual(2);
    expect(events).toContain("start:polymarket");
    expect(events.at(-1)).toBe("close");
  });
});

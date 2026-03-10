import { describe, expect, test } from "bun:test";

import { createDb, runMigrations } from "../src/db";
import {
  completeIngestionRun,
  createIngestionRun,
  failIngestionRun,
  Platform
} from "../src";

describe("ingestion run repository", () => {
  test("creates and completes an ingestion run", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const created = createIngestionRun(db, Platform.KALSHI);
      const completed = completeIngestionRun(db, created.id, {
        markets_found: 10,
        markets_created: 4,
        markets_updated: 6
      });

      expect(created.platform).toBe(Platform.KALSHI);
      expect(created.status).toBe("running");
      expect(created.completed_at).toBeNull();
      expect(completed.status).toBe("completed");
      expect(completed.markets_found).toBe(10);
      expect(completed.markets_created).toBe(4);
      expect(completed.markets_updated).toBe(6);
      expect(completed.error).toBeNull();
      expect(completed.completed_at).not.toBeNull();
    } finally {
      sqlite.close();
    }
  });

  test("stores failure errors on an ingestion run", () => {
    const { db, sqlite } = createDb(":memory:");

    try {
      runMigrations(db);

      const created = createIngestionRun(db, Platform.POLYMARKET);
      const failed = failIngestionRun(db, created.id, "upstream unavailable");

      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("upstream unavailable");
      expect(failed.completed_at).not.toBeNull();
      expect(failed.markets_found).toBeNull();
      expect(failed.markets_created).toBeNull();
      expect(failed.markets_updated).toBeNull();
    } finally {
      sqlite.close();
    }
  });
});

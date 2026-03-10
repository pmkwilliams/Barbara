import { eq } from "drizzle-orm";

import type { BarbaraDb } from "./db";
import { ingestion_runs, type IngestionRunRow } from "./schema";
import type { IngestionRun, Platform } from "./types";

interface IngestionRunCounts {
  markets_found: number;
  markets_created: number;
  markets_updated: number;
}

const fromRow = (row: IngestionRunRow): IngestionRun => ({
  id: row.id,
  platform: row.platform as Platform,
  started_at: row.started_at,
  completed_at: row.completed_at,
  markets_found: row.markets_found,
  markets_created: row.markets_created,
  markets_updated: row.markets_updated,
  status: row.status,
  error: row.error
});

const getIngestionRun = (db: BarbaraDb, id: number): IngestionRun => {
  const row = db.select().from(ingestion_runs).where(eq(ingestion_runs.id, id)).get();

  if (!row) {
    throw new Error(`Failed to load ingestion run: ${id}`);
  }

  return fromRow(row);
};

export const createIngestionRun = (db: BarbaraDb, platform: Platform): IngestionRun => {
  const started_at = new Date().toISOString();
  const inserted = db.insert(ingestion_runs).values({
    platform,
    started_at,
    status: "running"
  }).returning({ id: ingestion_runs.id }).get();

  if (!inserted) {
    throw new Error("Failed to create ingestion run");
  }

  return getIngestionRun(db, inserted.id);
};

export const completeIngestionRun = (
  db: BarbaraDb,
  id: number,
  counts: IngestionRunCounts
): IngestionRun => {
  db.update(ingestion_runs)
    .set({
      ...counts,
      status: "completed",
      error: null,
      completed_at: new Date().toISOString()
    })
    .where(eq(ingestion_runs.id, id))
    .run();

  return getIngestionRun(db, id);
};

export const failIngestionRun = (db: BarbaraDb, id: number, error: string): IngestionRun => {
  db.update(ingestion_runs)
    .set({
      status: "failed",
      error,
      completed_at: new Date().toISOString()
    })
    .where(eq(ingestion_runs.id, id))
    .run();

  return getIngestionRun(db, id);
};

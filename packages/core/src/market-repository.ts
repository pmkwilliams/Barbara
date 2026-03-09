import { eq } from "drizzle-orm";

import type { BarbaraDb } from "./db";
import { markets, type MarketRow, type NewMarketRow } from "./schema";
import type { MarketStatus, NormalizedMarket, NormalizedMarketInput, Platform } from "./types";

const toRow = (input: NormalizedMarketInput): NewMarketRow => ({
  id: `${input.platform}:${input.platform_id}`,
  platform: input.platform,
  platform_id: input.platform_id,
  title: input.title,
  description: input.description,
  outcome_labels: JSON.stringify(input.outcome_labels),
  resolution_source: input.resolution_source,
  resolution_rules: input.resolution_rules,
  close_time: input.close_time,
  category: input.category,
  status: input.status,
  volume: input.volume,
  resolution_hash: input.resolution_hash,
  raw_data: input.raw_data != null ? JSON.stringify(input.raw_data) : null
});

const fromRow = (row: MarketRow): NormalizedMarket => ({
  id: row.id,
  platform: row.platform as Platform,
  platform_id: row.platform_id,
  title: row.title,
  description: row.description,
  outcome_labels: JSON.parse(row.outcome_labels) as string[],
  resolution_source: row.resolution_source,
  resolution_rules: row.resolution_rules,
  close_time: row.close_time,
  category: row.category,
  status: row.status as MarketStatus,
  volume: row.volume,
  resolution_hash: row.resolution_hash,
  raw_data: row.raw_data != null ? (JSON.parse(row.raw_data) as unknown) : null,
  created_at: row.created_at,
  updated_at: row.updated_at
});

export const upsertMarket = (db: BarbaraDb, input: NormalizedMarketInput): NormalizedMarket => {
  const row = toRow(input);
  const now = new Date().toISOString();

  db.insert(markets)
    .values({ ...row, created_at: now, updated_at: now })
    .onConflictDoUpdate({
      target: [markets.platform, markets.platform_id],
      set: {
        title: input.title,
        description: input.description,
        outcome_labels: row.outcome_labels,
        resolution_source: input.resolution_source,
        resolution_rules: input.resolution_rules,
        close_time: input.close_time,
        category: input.category,
        status: input.status,
        volume: input.volume,
        resolution_hash: input.resolution_hash,
        raw_data: row.raw_data,
        updated_at: now
      }
    })
    .run();

  const stored = db.select().from(markets).where(eq(markets.id, row.id)).get();

  if (!stored) {
    throw new Error(`Failed to load upserted market: ${row.id}`);
  }

  return fromRow(stored);
};

export const getMarketById = (db: BarbaraDb, id: string): NormalizedMarket | undefined => {
  const row = db.select().from(markets).where(eq(markets.id, id)).get();
  return row ? fromRow(row) : undefined;
};

export const getMarketsByPlatform = (db: BarbaraDb, platform: Platform): NormalizedMarket[] => {
  const rows = db.select().from(markets).where(eq(markets.platform, platform)).all();
  return rows.map(fromRow);
};

export const getActiveMarkets = (db: BarbaraDb): NormalizedMarket[] => {
  const rows = db.select().from(markets).where(eq(markets.status, "active")).all();
  return rows.map(fromRow);
};

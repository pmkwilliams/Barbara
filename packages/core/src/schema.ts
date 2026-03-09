import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const markets = sqliteTable(
  "markets",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    platform_id: text("platform_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    outcome_labels: text("outcome_labels").notNull(),
    resolution_source: text("resolution_source"),
    resolution_rules: text("resolution_rules"),
    close_time: text("close_time"),
    category: text("category"),
    status: text("status").notNull().default("active"),
    volume: real("volume"),
    resolution_hash: text("resolution_hash"),
    raw_data: text("raw_data"),
    created_at: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("markets_platform_platform_id_unique").on(table.platform, table.platform_id)
  ]
);

export const ingestion_runs = sqliteTable("ingestion_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platform: text("platform").notNull(),
  started_at: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completed_at: text("completed_at"),
  markets_found: integer("markets_found"),
  markets_created: integer("markets_created"),
  markets_updated: integer("markets_updated"),
  status: text("status").notNull().default("running"),
  error: text("error")
});

export type MarketRow = typeof markets.$inferSelect;
export type NewMarketRow = typeof markets.$inferInsert;
export type IngestionRunRow = typeof ingestion_runs.$inferSelect;
export type NewIngestionRunRow = typeof ingestion_runs.$inferInsert;

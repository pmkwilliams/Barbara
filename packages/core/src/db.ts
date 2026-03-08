import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { loadConfig } from "./config";
import * as schema from "./schema";

export type BarbaraDb = BunSQLiteDatabase<typeof schema>;

export interface DbConnection {
  sqlite: Database;
  db: BarbaraDb;
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export const createDb = (path?: string): DbConnection => {
  const sqlite = new Database(path ?? loadConfig().DATABASE_PATH, { create: true });

  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(sqlite, { schema });

  return { sqlite, db };
};

export const runMigrations = (db: BarbaraDb): void => {
  migrate(db, { migrationsFolder });
};

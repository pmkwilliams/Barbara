import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
  const databasePath = path ?? loadConfig().DATABASE_PATH;

  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath, { create: true });

  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(sqlite, { schema });

  return { sqlite, db };
};

export const runMigrations = (db: BarbaraDb): void => {
  migrate(db, { migrationsFolder });
};

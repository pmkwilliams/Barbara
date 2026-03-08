import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/core/src/schema.ts",
  out: "./packages/core/drizzle",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./data/barbara.db"
  }
});

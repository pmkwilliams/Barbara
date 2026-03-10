import { createDb, createLogger, loadConfig, runMigrations } from "@barbara/core";
import { GammaClient, KalshiClient } from "@barbara/shared-platform";

import { runIngestion } from "./orchestrator";

const logger = createLogger("ingestion:backfill");
const DEFAULT_SAMPLE_LIMIT = 25;

const HELP_TEXT = `Usage: bun run packages/ingestion/src/backfill.ts

Options:
  --sample        Run a smaller backfill using a limited page size per platform
  --limit <n>     Override the market limit used for sample backfills

Runs one ingestion pass for Kalshi and Polymarket, then exits.`;

const getKalshiClientConfig = (config: ReturnType<typeof loadConfig>) => ({
  ...(config.KALSHI_API_KEY ? { apiKeyId: config.KALSHI_API_KEY } : {}),
  ...(config.KALSHI_PRIVATE_KEY_PATH ? { privateKeyPath: config.KALSHI_PRIVATE_KEY_PATH } : {}),
  baseUrl: config.KALSHI_BASE_URL
});

const formatSummaryTable = (
  rows: Array<{
    platform: string;
    fetched: number;
    inserted: number;
    updated: number;
    errored: number;
    duration_ms: number;
  }>
): string => {
  const headers = ["platform", "fetched", "inserted", "updated", "errored", "duration_ms"];
  const widths = headers.map((header) => Math.max(header.length, ...rows.map((row) => String(row[header as keyof (typeof rows)[number]]).length)));

  const formatLine = (values: string[]): string => values.map((value, index) => value.padEnd(widths[index] ?? value.length)).join("  ");

  return [
    formatLine(headers),
    formatLine(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => formatLine([
      row.platform,
      String(row.fetched),
      String(row.inserted),
      String(row.updated),
      String(row.errored),
      String(row.duration_ms)
    ]))
  ].join("\n");
};

export interface BackfillCliOptions {
  marketLimit?: number;
}

export const parseBackfillArgs = (args: string[]): BackfillCliOptions => {
  const sampleMode = args.includes("--sample");
  const limitIndex = args.indexOf("--limit");

  if (limitIndex === -1) {
    return sampleMode ? { marketLimit: DEFAULT_SAMPLE_LIMIT } : {};
  }

  const rawLimit = args[limitIndex + 1];

  if (!rawLimit) {
    throw new Error("Missing value for --limit");
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);

  if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
    throw new Error("--limit must be a positive integer");
  }

  return { marketLimit: parsedLimit };
};

export const runBackfill = async (args: string[] = process.argv.slice(2)): Promise<number> => {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return 0;
  }

  let cliOptions: BackfillCliOptions;

  try {
    cliOptions = parseBackfillArgs(args);
  } catch (error) {
    logger.error("Invalid backfill arguments", error);
    console.log(HELP_TEXT);
    return 1;
  }

  const config = loadConfig();
  const connection = createDb(config.DATABASE_PATH);

  logger.info("Starting backfill", {
    database_path: config.DATABASE_PATH,
    market_limit: cliOptions.marketLimit ?? null
  });

  try {
    runMigrations(connection.db);
    logger.info("Applied database migrations for backfill");

    const clients = {
      kalshi: await KalshiClient.create(getKalshiClientConfig(config)),
      gamma: new GammaClient()
    };

    logger.info("Initialized backfill clients", {
      kalshi_base_url: config.KALSHI_BASE_URL
    });

    const results = [
      await runIngestion("kalshi", connection.db, clients, cliOptions),
      await runIngestion("polymarket", connection.db, clients, cliOptions)
    ];

    console.log(formatSummaryTable(results.map((result) => ({
      platform: result.platform,
      fetched: result.markets_found,
      inserted: result.markets_created,
      updated: result.markets_updated,
      errored: result.markets_errored,
      duration_ms: result.duration_ms
    }))));

    if (results.some((result) => result.status === "failed")) {
      logger.error("Backfill completed with failures", results.filter((result) => result.status === "failed"));
      return 1;
    }

    logger.info("Backfill completed successfully");
    return 0;
  } catch (error) {
    logger.error("Backfill failed unexpectedly", error);
    return 1;
  } finally {
    connection.sqlite.close();
  }
};

if (import.meta.main) {
  const exitCode = await runBackfill();
  process.exit(exitCode);
}

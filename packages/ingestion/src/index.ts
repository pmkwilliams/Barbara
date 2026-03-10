import { createDb, createLogger, loadConfig, runMigrations } from "@barbara/core";
import { GammaClient, KalshiClient } from "@barbara/shared-platform";

import { runBackfill } from "./backfill";
import { startScheduler } from "./scheduler";

const logger = createLogger("ingestion:index");

const getKalshiClientConfig = (config: ReturnType<typeof loadConfig>) => ({
  ...(config.KALSHI_API_KEY ? { apiKeyId: config.KALSHI_API_KEY } : {}),
  ...(config.KALSHI_PRIVATE_KEY_PATH ? { privateKeyPath: config.KALSHI_PRIVATE_KEY_PATH } : {}),
  baseUrl: config.KALSHI_BASE_URL
});

export const main = async (args: string[] = process.argv.slice(2)): Promise<void> => {
  if (args.includes("--backfill")) {
    const exitCode = await runBackfill(args.filter((arg) => arg !== "--backfill"));
    process.exit(exitCode);
  }

  const config = loadConfig();
  logger.info("Starting ingestion entrypoint", {
    database_path: config.DATABASE_PATH,
    ingestion_interval_ms: config.INGESTION_INTERVAL_MS,
    max_cycle_duration_ms: config.MAX_CYCLE_DURATION_MS,
    kalshi_base_url: config.KALSHI_BASE_URL
  });

  const connection = createDb(config.DATABASE_PATH);

  try {
    runMigrations(connection.db);
    logger.info("Applied database migrations for scheduler startup");

    const clients = {
      kalshi: await KalshiClient.create(getKalshiClientConfig(config)),
      gamma: new GammaClient()
    };

    logger.info("Initialized ingestion clients");

    startScheduler(connection, clients, config);
    logger.info("Started ingestion scheduler", {
      ingestion_interval_ms: config.INGESTION_INTERVAL_MS,
      max_cycle_duration_ms: config.MAX_CYCLE_DURATION_MS
    });
  } catch (error) {
    connection.sqlite.close();
    throw error;
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    logger.error("Failed to start ingestion entrypoint", error);
    process.exit(1);
  }
}

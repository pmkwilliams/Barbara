import { createLogger, loadConfig, type Config, type DbConnection } from "@barbara/core";

import { runIngestion, type IngestionClients } from "./orchestrator";

const logger = createLogger("ingestion:scheduler");

export interface SchedulerHandle {
  stop: () => Promise<void>;
}

interface SchedulerDeps {
  runPlatformIngestion?: typeof runIngestion;
}

export const startScheduler = (
  connection: DbConnection,
  clients: IngestionClients,
  config: Config = loadConfig(),
  deps: SchedulerDeps = {}
): SchedulerHandle => {
  const runPlatformIngestion = deps.runPlatformIngestion ?? runIngestion;
  let interval: ReturnType<typeof setInterval> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let isStopping = false;
  let pendingCycle = false;
  let currentCycle: Promise<void> | null = null;

  const clearIntervalTimer = (): void => {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const clearStallTimer = (): void => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = undefined;
    }
  };

  const runCycle = async (): Promise<void> => {
    if (isStopping) {
      return;
    }

    const abortController = new AbortController();
    let cycleTimedOut = false;

    stallTimer = setTimeout(() => {
      cycleTimedOut = true;
      pendingCycle = true;
      abortController.abort();
      logger.error("Ingestion cycle exceeded maximum duration; aborting and queueing a follow-up cycle", {
        max_cycle_duration_ms: config.MAX_CYCLE_DURATION_MS
      });
    }, config.MAX_CYCLE_DURATION_MS);

    logger.info("Starting ingestion cycle");

    try {
      const kalshiResult = await runPlatformIngestion("kalshi", connection.db, clients, {
        signal: abortController.signal
      });
      logger.info("Finished Kalshi ingestion", kalshiResult);

      if (cycleTimedOut) {
        return;
      }

      const polymarketResult = await runPlatformIngestion("polymarket", connection.db, clients, {
        signal: abortController.signal
      });
      logger.info("Finished Polymarket ingestion", polymarketResult);

      if (cycleTimedOut) {
        return;
      }

      logger.info("Completed ingestion cycle");
    } finally {
      clearStallTimer();
    }
  };

  const runQueuedCycles = async (): Promise<void> => {
    do {
      pendingCycle = false;
      await runCycle();
    } while (pendingCycle && !isStopping);
  };

  const tick = (): void => {
    if (isStopping) {
      return;
    }

    if (currentCycle) {
      pendingCycle = true;
      logger.warn("Skipping ingestion cycle because the previous cycle is still running");
      return;
    }

    currentCycle = runQueuedCycles().finally(() => {
      currentCycle = null;
    });
  };

  const stop = async (): Promise<void> => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    clearIntervalTimer();

    if (currentCycle) {
      await currentCycle;
    }

    connection.sqlite.close();
  };

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Received shutdown signal", { signal });

    try {
      await stop();
      process.exit(0);
    } catch (error) {
      logger.error("Failed to shut down ingestion scheduler cleanly", { signal, error });
      process.exit(1);
    }
  };

  const handleSigint = (): void => {
    void shutdown("SIGINT");
  };

  const handleSigterm = (): void => {
    void shutdown("SIGTERM");
  };

  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  tick();
  interval = setInterval(tick, config.INGESTION_INTERVAL_MS);

  return {
    stop: async () => {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
      await stop();
    }
  };
};

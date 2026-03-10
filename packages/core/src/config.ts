export interface Config {
  DATABASE_PATH: string;
  LOG_LEVEL: string;
  INGESTION_INTERVAL_MS: number;
  MAX_CYCLE_DURATION_MS: number;
  KALSHI_API_KEY: string | undefined;
  KALSHI_PRIVATE_KEY_PATH: string | undefined;
  KALSHI_BASE_URL: string;
  POLYMARKET_API_KEY: string | undefined;
  POLYMARKET_PRIVATE_KEY: string | undefined;
}

const readNumberEnv = (key: string, fallback: number): number => {
  const value = readOptionalEnv(key);

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readOptionalEnv = (key: string): string | undefined => {
  const value = process.env[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const requireEnv = (key: string): string => {
  const value = readOptionalEnv(key);

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const loadConfig = (): Config => {
  return {
    DATABASE_PATH: readOptionalEnv("DATABASE_PATH") ?? "./data/barbara.db",
    LOG_LEVEL: readOptionalEnv("LOG_LEVEL") ?? "info",
    INGESTION_INTERVAL_MS: readNumberEnv("INGESTION_INTERVAL_MS", 900_000),
    MAX_CYCLE_DURATION_MS: readNumberEnv("MAX_CYCLE_DURATION_MS", 600_000),
    KALSHI_API_KEY: readOptionalEnv("KALSHI_API_KEY"),
    KALSHI_PRIVATE_KEY_PATH: readOptionalEnv("KALSHI_PRIVATE_KEY_PATH"),
    KALSHI_BASE_URL: readOptionalEnv("KALSHI_BASE_URL") ?? "https://api.elections.kalshi.com/trade-api/v2",
    POLYMARKET_API_KEY: readOptionalEnv("POLYMARKET_API_KEY"),
    POLYMARKET_PRIVATE_KEY: readOptionalEnv("POLYMARKET_PRIVATE_KEY")
  };
};

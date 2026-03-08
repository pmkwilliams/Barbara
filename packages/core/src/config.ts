export interface Config {
  DATABASE_PATH: string;
  LOG_LEVEL: string;
  KALSHI_API_KEY: string | undefined;
  KALSHI_API_SECRET: string | undefined;
  POLYMARKET_API_KEY: string | undefined;
  POLYMARKET_PRIVATE_KEY: string | undefined;
}

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
    KALSHI_API_KEY: readOptionalEnv("KALSHI_API_KEY"),
    KALSHI_API_SECRET: readOptionalEnv("KALSHI_API_SECRET"),
    POLYMARKET_API_KEY: readOptionalEnv("POLYMARKET_API_KEY"),
    POLYMARKET_PRIVATE_KEY: readOptionalEnv("POLYMARKET_PRIVATE_KEY")
  };
};

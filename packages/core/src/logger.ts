import { loadConfig } from "./config";

const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
} as const;

type LogLevel = keyof typeof LOG_LEVEL_ORDER;

export interface Logger {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}

const getThreshold = (): number => {
  const configuredLevel = loadConfig().LOG_LEVEL.toLowerCase() as LogLevel;
  return LOG_LEVEL_ORDER[configuredLevel] ?? LOG_LEVEL_ORDER.info;
};

const log = (level: LogLevel, context: string, message: string, data?: unknown): void => {
  if (LOG_LEVEL_ORDER[level] < getThreshold()) {
    return;
  }

  const prefix = `[${level.toUpperCase()}] [${context}] ${message}`;

  if (data === undefined) {
    console[level](prefix);
    return;
  }

  console[level](prefix, data);
};

export const createLogger = (context: string): Logger => ({
  debug: (message, data) => log("debug", context, message, data),
  info: (message, data) => log("info", context, message, data),
  warn: (message, data) => log("warn", context, message, data),
  error: (message, data) => log("error", context, message, data)
});

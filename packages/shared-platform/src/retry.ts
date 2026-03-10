export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxJitterMs?: number;
  signal?: AbortSignal | undefined;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_JITTER_MS = 250;

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504);
}

export function calculateBackoff(
  attempt: number,
  is429: boolean,
  baseDelayMs: number,
  maxJitterMs: number
): number {
  const baseDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * maxJitterMs;
  const multiplier = is429 ? 2 : 1;
  return baseDelay * multiplier + jitter;
}

export async function executeWithRetry<T>(
  method: string,
  url: string,
  buildHeaders: () => Record<string, string>,
  body?: unknown,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxJitterMs = options.maxJitterMs ?? DEFAULT_MAX_JITTER_MS;
  const signal = options.signal;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = buildHeaders();
      const fetchOpts: RequestInit = {
        method,
        headers,
        ...(signal ? { signal } : {})
      };

      if (body !== undefined) {
        fetchOpts.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOpts);

      if (response.ok) {
        return (await response.json()) as T;
      }

      const responseText = await response.text();
      const error = new Error(`HTTP ${response.status}: ${responseText}`);

      if (!isRetryableStatus(response.status)) {
        throw error;
      }

      lastError = error;

      if (attempt < maxRetries) {
        const delay = calculateBackoff(
          attempt,
          response.status === 429,
          baseDelayMs,
          maxJitterMs
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      if (error instanceof TypeError) {
        lastError = error;

        if (attempt < maxRetries) {
          const delay = calculateBackoff(
            attempt,
            false,
            baseDelayMs,
            maxJitterMs
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } else {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Request failed after max retries");
}

import { describe, expect, test } from "bun:test";

import { TokenBucket } from "../../src/kalshi/rate-limiter";

describe("TokenBucket", () => {
  test("acquire N tokens from bucket of capacity N succeeds without delay", async () => {
    const bucket = new TokenBucket(5, 5);
    const start = performance.now();

    for (let i = 0; i < 5; i++) {
      await bucket.acquire();
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  test("acquire from empty bucket delays approximately 1/refillRate seconds", async () => {
    const bucket = new TokenBucket(1, 10); // 1 token capacity, refills at 10/s = 100ms per token
    await bucket.acquire(); // Deplete the single token

    const start = performance.now();
    await bucket.acquire(); // Should wait ~100ms for refill
    const elapsed = performance.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(250);
  });

  test("tryAcquire returns false on empty bucket, true when tokens available", () => {
    const bucket = new TokenBucket(1, 1);

    expect(bucket.tryAcquire()).toBe(true);  // First token available
    expect(bucket.tryAcquire()).toBe(false); // Bucket empty
  });

  test("tokens refill over time", async () => {
    const bucket = new TokenBucket(5, 10); // 5 capacity, refills at 10/s

    // Deplete the bucket
    for (let i = 0; i < 5; i++) {
      bucket.tryAcquire();
    }

    expect(bucket.tryAcquire()).toBe(false); // Bucket empty

    // Wait for partial refill (~200ms at 10/s = ~2 tokens)
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(bucket.tryAcquire()).toBe(true); // At least 1 token refilled
  });
});

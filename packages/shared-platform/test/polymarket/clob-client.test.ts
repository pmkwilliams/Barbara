import { afterEach, describe, expect, test } from "bun:test";

import { ClobClient } from "../../src/polymarket/clob-client";

const originalFetch = globalThis.fetch;

describe("ClobClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("getBook fetches an order book by token id", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          market: "condition-1",
          asset_id: "token-1",
          bids: [{ price: "0.45", size: "100" }],
          asks: [{ price: "0.55", size: "80" }],
          hash: "book-hash",
          timestamp: "1700000000",
        })
      );
    }) as unknown as typeof fetch;

    const client = new ClobClient("https://clob.test");
    const book = await client.getBook("token-1");

    expect(new URL(capturedUrl).searchParams.get("token_id")).toBe("token-1");
    expect(book.bids[0]?.price).toBe("0.45");
    expect(book.asks[0]?.size).toBe("80");
  });

  test("getBooks uses POST and sends token ids in request body", async () => {
    let requestMethod = "";
    let requestBody = "";
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requestMethod = init?.method ?? "GET";
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify([]));
    }) as unknown as typeof fetch;

    const client = new ClobClient("https://clob.test");
    await client.getBooks(["token-1", "token-2"]);

    expect(requestMethod).toBe("POST");
    expect(JSON.parse(requestBody)).toEqual([
      { token_id: "token-1" },
      { token_id: "token-2" },
    ]);
  });

  test("prices history and tick size use their endpoint buckets", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;

      if (path === "/prices-history") {
        return new Response(JSON.stringify([]));
      }

      return new Response(JSON.stringify({ minimum_tick_size: "0.01" }));
    }) as unknown as typeof fetch;

    const client = new ClobClient("https://clob.test");
    const generalBucket = (client as any).generalBucket as { acquire: () => Promise<void> };
    const pricesHistoryBucket = (client as any).endpointBuckets.get("/prices-history") as {
      acquire: () => Promise<void>;
    };
    const tickSizeBucket = (client as any).endpointBuckets.get("/tick-size") as {
      acquire: () => Promise<void>;
    };

    let generalCalls = 0;
    let pricesHistoryCalls = 0;
    let tickSizeCalls = 0;

    generalBucket.acquire = async () => {
      generalCalls += 1;
    };
    pricesHistoryBucket.acquire = async () => {
      pricesHistoryCalls += 1;
    };
    tickSizeBucket.acquire = async () => {
      tickSizeCalls += 1;
    };

    await client.getPricesHistory({ market: "market-1", interval: "1d", fidelity: 60 });
    await client.getTickSize("token-1");

    expect(pricesHistoryCalls).toBe(1);
    expect(tickSizeCalls).toBe(1);
    expect(generalCalls).toBe(2);
  });
});

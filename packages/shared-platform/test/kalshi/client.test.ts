import { afterEach, describe, expect, test } from "bun:test";

import { KalshiClient } from "../../src/kalshi/client";

const originalFetch = globalThis.fetch;

describe("KalshiClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("retries on 500, succeeds on third attempt", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount <= 2) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(
        JSON.stringify({ exchange_active: true, trading_active: true })
      );
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({
      baseUrl: "https://test.api.com",
    });
    const result = await client.getExchangeStatus();

    expect(callCount).toBe(3);
    expect(result.exchange_active).toBe(true);
  });

  test("no retry on 400", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response("Bad Request", { status: 400 });
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({
      baseUrl: "https://test.api.com",
    });

    try {
      await client.getExchangeStatus();
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("400");
    }

    expect(callCount).toBe(1);
  });

  test("retries on 429", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Rate Limited", { status: 429 });
      }
      return new Response(
        JSON.stringify({ exchange_active: true, trading_active: true })
      );
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({
      baseUrl: "https://test.api.com",
    });
    const result = await client.getExchangeStatus();

    expect(callCount).toBe(2);
    expect(result.exchange_active).toBe(true);
  });

  test("retries on network error (TypeError)", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response(
        JSON.stringify({ exchange_active: true, trading_active: true })
      );
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({
      baseUrl: "https://test.api.com",
    });
    const result = await client.getExchangeStatus();

    expect(callCount).toBe(2);
    expect(result.exchange_active).toBe(true);
  });

  test("max retries exhausted throws error", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({
      baseUrl: "https://test.api.com",
    });

    try {
      await client.getExchangeStatus();
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("500");
    }

    // 1 initial + 3 retries = 4 total
    expect(callCount).toBe(4);
  });

  test("query params serialized correctly", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ markets: [], cursor: "" }));
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({
      baseUrl: "https://test.api.com",
    });
    await client.getMarkets({ limit: 5, status: "open" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("status")).toBe("open");
  });

  test("paginateMarkets advances cursors across pages", async () => {
    const cursors: Array<string | null> = [];
    const pages = [
      { markets: [{ ticker: "K1" }], cursor: "cursor-2" },
      { markets: [{ ticker: "K2" }], cursor: "cursor-3" },
      { markets: [{ ticker: "K3" }], cursor: "" }
    ];

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      cursors.push(url.searchParams.get("cursor"));
      const page = pages.shift();

      if (!page) {
        throw new Error("unexpected extra request");
      }

      return new Response(JSON.stringify(page));
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({ baseUrl: "https://test.api.com" });
    const results: string[][] = [];

    for await (const page of client.paginateMarkets({ limit: 1, status: "active" })) {
      results.push(page.map((market) => market.ticker));
    }

    expect(results).toEqual([["K1"], ["K2"], ["K3"]]);
    expect(cursors).toEqual([null, "cursor-2", "cursor-3"]);
  });

  test("paginateMarkets stops on empty page", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ markets: [], cursor: "ignored" }));
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({ baseUrl: "https://test.api.com" });
    const pages: unknown[] = [];

    for await (const page of client.paginateMarkets()) {
      pages.push(page);
    }

    expect(pages).toEqual([]);
    expect(callCount).toBe(1);
  });

  test("paginateMarkets returns a single page when cursor is missing", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ markets: [{ ticker: "K1" }], cursor: "" }));
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({ baseUrl: "https://test.api.com" });
    const pages: string[][] = [];

    for await (const page of client.paginateMarkets()) {
      pages.push(page.map((market) => market.ticker));
    }

    expect(pages).toEqual([["K1"]]);
    expect(callCount).toBe(1);
  });

  test("paginateMarkets forwards optional params", async () => {
    const captured: URL[] = [];

    globalThis.fetch = (async (input: string | URL | Request) => {
      captured.push(new URL(String(input)));
      return new Response(JSON.stringify({ markets: [{ ticker: "K1" }], cursor: "" }));
    }) as unknown as typeof fetch;

    const client = await KalshiClient.create({ baseUrl: "https://test.api.com" });

    for await (const page of client.paginateMarkets({ limit: 25, status: "closed", event_ticker: "EVT" })) {
      expect(page).toHaveLength(1);
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]?.searchParams.get("limit")).toBe("25");
    expect(captured[0]?.searchParams.get("status")).toBe("closed");
    expect(captured[0]?.searchParams.get("event_ticker")).toBe("EVT");
  });
});

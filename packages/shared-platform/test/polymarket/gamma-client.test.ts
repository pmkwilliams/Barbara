import { afterEach, describe, expect, test } from "bun:test";

import { GammaClient } from "../../src/polymarket/gamma-client";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

type TestBucket = { acquire: () => Promise<void> };
type GammaClientBuckets = {
  generalBucket: TestBucket;
  endpointBuckets: Map<string, TestBucket>;
};

const rawMarket = {
  id: "1",
  question: "Will it rain tomorrow?",
  conditionId: "condition-1",
  slug: "will-it-rain-tomorrow",
  outcomes: '["Yes","No"]',
  outcomePrices: '["0.65","0.35"]',
  clobTokenIds: '["123","456"]',
  active: true,
  closed: false,
  volume: "12345.67",
  description: "Rain market",
  startDate: "2026-03-01T00:00:00Z",
  endDate: "2026-03-02T00:00:00Z",
  resolutionSource: "National Weather Service",
  groupItemTitle: "Tomorrow",
  enableOrderBook: true,
};

describe("GammaClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  test("getEvent parses embedded raw market arrays", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          id: "event-1",
          slug: "rain-event",
          title: "Rain Event",
          description: "Whether it rains",
          markets: [rawMarket],
        })
      );
    }) as unknown as typeof fetch;

    const client = new GammaClient("https://gamma.test");
    const event = await client.getEvent("event-1");

    expect(event.markets).toHaveLength(1);
    expect(event.markets[0]?.outcomes).toEqual(["Yes", "No"]);
    expect(event.markets[0]?.outcomePrices).toEqual(["0.65", "0.35"]);
    expect(event.markets[0]?.clobTokenIds).toEqual(["123", "456"]);
  });

  test("paginateMarkets iterates until final partial page", async () => {
    const capturedUrls: string[] = [];
    let callCount = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      callCount++;
      const url = String(input);
      capturedUrls.push(url);

      const page =
        callCount === 1
          ? [
              rawMarket,
              { ...rawMarket, id: "2", slug: "market-2", conditionId: "condition-2" },
            ]
          : [
              { ...rawMarket, id: "3", slug: "market-3", conditionId: "condition-3" },
            ];

      return new Response(JSON.stringify(page));
    }) as unknown as typeof fetch;

    const client = new GammaClient("https://gamma.test");
    const pages: string[] = [];

    for await (const page of client.paginateMarkets({ limit: 2, active: true })) {
      pages.push(...page.map((market) => market.id));
    }

    expect(pages).toEqual(["1", "2", "3"]);
    expect(capturedUrls).toHaveLength(2);
    expect(new URL(capturedUrls[0] ?? "").searchParams.get("offset")).toBe("0");
    expect(new URL(capturedUrls[1] ?? "").searchParams.get("offset")).toBe("2");
  });

  test("getMarkets tolerates malformed array fields in raw payloads", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify([
        {
          ...rawMarket,
          id: "bad-market",
          outcomePrices: undefined,
          clobTokenIds: "not-json"
        }
      ]));
    }) as unknown as typeof fetch;

    const client = new GammaClient("https://gamma.test");
    const markets = await client.getMarkets({ limit: 1 });

    expect(markets).toHaveLength(1);
    expect(markets[0]?.outcomes).toEqual(["Yes", "No"]);
    expect(markets[0]?.outcomePrices).toEqual([]);
    expect(markets[0]?.clobTokenIds).toEqual([]);
  });

  test("getMarkets serializes query params correctly", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify([]));
    }) as unknown as typeof fetch;

    const client = new GammaClient("https://gamma.test");
    await client.getMarkets({ limit: 5, active: true, closed: false });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("active")).toBe("true");
    expect(url.searchParams.get("closed")).toBe("false");
  });

  test("detail endpoints use the matching endpoint buckets", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;

      if (path === "/events/event-1") {
        return new Response(
          JSON.stringify({
            id: "event-1",
            slug: "rain-event",
            title: "Rain Event",
            description: "Whether it rains",
            markets: [rawMarket],
          })
        );
      }

      return new Response(JSON.stringify(rawMarket));
    }) as unknown as typeof fetch;

    const client = new GammaClient("https://gamma.test");
    const { generalBucket, endpointBuckets } = client as unknown as GammaClientBuckets;
    const eventBucket = endpointBuckets.get("/events") as TestBucket;
    const marketBucket = endpointBuckets.get("/markets") as TestBucket;

    let generalCalls = 0;
    let eventCalls = 0;
    let marketCalls = 0;

    generalBucket.acquire = async () => {
      generalCalls += 1;
    };
    eventBucket.acquire = async () => {
      eventCalls += 1;
    };
    marketBucket.acquire = async () => {
      marketCalls += 1;
    };

    await client.getEvent("event-1");
    await client.getMarket("1");

    expect(eventCalls).toBe(1);
    expect(marketCalls).toBe(1);
    expect(generalCalls).toBe(2);
  });

  test("retries on 500 and succeeds on third attempt", async () => {
    let callCount = 0;
    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 0 as unknown as Timer;
    }) as unknown as typeof setTimeout;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount <= 2) {
        return new Response("Internal Server Error", { status: 500 });
      }

      return new Response(JSON.stringify([]));
    }) as unknown as typeof fetch;

    const client = new GammaClient("https://gamma.test");
    const markets = await client.getMarkets();

    expect(callCount).toBe(3);
    expect(markets).toEqual([]);
  });

  test("throws after max retries are exhausted", async () => {
    let callCount = 0;
    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 0 as unknown as Timer;
    }) as unknown as typeof setTimeout;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    const client = new GammaClient("https://gamma.test");

    await expect(client.getMarkets()).rejects.toThrow("HTTP 500: Internal Server Error");
    expect(callCount).toBe(4);
  });
});

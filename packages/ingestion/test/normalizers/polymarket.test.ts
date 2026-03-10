import { describe, expect, test } from "bun:test";

import { MarketStatus, Platform } from "@barbara/core";
import type { GammaMarket } from "@barbara/shared-platform";

import { normalizePolymarketMarket } from "../../src/normalizers/polymarket";

const makeRawMarket = (overrides: Partial<GammaMarket> = {}): GammaMarket => ({
  id: "123",
  question: "Will BTC end above $100k?",
  conditionId: "condition-1",
  slug: "btc-100k",
  outcomes: ["Yes", "No"],
  outcomePrices: ["0.4", "0.6"],
  clobTokenIds: ["1", "2"],
  active: true,
  closed: false,
  volume: "12345.67",
  description: "Market resolves based on daily close.",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-12-31T00:00:00.000Z",
  resolutionSource: "Exchange close",
  groupItemTitle: "BTC",
  enableOrderBook: true,
  extra_field: "preserved",
  ...overrides
});

describe("normalizePolymarketMarket", () => {
  test("maps a known Polymarket market into normalized shape", () => {
    const raw = makeRawMarket();

    expect(normalizePolymarketMarket(raw)).toEqual({
      platform: Platform.POLYMARKET,
      platform_id: "condition-1",
      title: "Will BTC end above $100k?",
      description: "Market resolves based on daily close.",
      event_ticker: null,
      series_ticker: null,
      outcome_labels: ["Yes", "No"],
      resolution_source: "Exchange close",
      resolution_rules: "Market resolves based on daily close.",
      open_time: null,
      start_time: "2026-01-01T00:00:00.000Z",
      close_time: "2026-12-31T00:00:00.000Z",
      end_time: "2026-12-31T00:00:00.000Z",
      group_title: "BTC",
      category: null,
      market_shape: "binary",
      is_binary_eligible: true,
      status: MarketStatus.ACTIVE,
      volume: 12345.67,
      resolution_hash: null,
      raw_data: raw
    });
  });

  test("maps closed markets to closed status", () => {
    expect(normalizePolymarketMarket(makeRawMarket({ closed: true })).status).toBe(MarketStatus.CLOSED);
  });

  test("maps inactive but open markets to suspended status", () => {
    expect(normalizePolymarketMarket(makeRawMarket({ active: false, closed: false })).status).toBe(
      MarketStatus.SUSPENDED
    );
  });

  test("returns null volume for unparsable values", () => {
    expect(normalizePolymarketMarket(makeRawMarket({ volume: "not-a-number" })).volume).toBeNull();
  });

  test("treats non-binary outcome sets as unknown and ineligible", () => {
    const normalized = normalizePolymarketMarket(
      makeRawMarket({ outcomes: ["A", "B", "C"], groupItemTitle: "   " })
    );

    expect(normalized.market_shape).toBe("unknown");
    expect(normalized.is_binary_eligible).toBe(false);
    expect(normalized.group_title).toBeNull();
  });
});

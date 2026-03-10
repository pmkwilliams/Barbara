import { afterEach, describe, expect, test } from "bun:test";

import { MarketStatus, Platform } from "@barbara/core";
import type { KalshiRawMarket } from "@barbara/shared-platform";

import { normalizeKalshiMarket } from "../../src/normalizers/kalshi";

const originalWarn = console.warn;

const makeRawMarket = (overrides: Partial<KalshiRawMarket> = {}): KalshiRawMarket => ({
  ticker: "KXTEST-001",
  event_ticker: "EVENT-1",
  market_type: "binary",
  title: "Will CPI exceed 3%?",
  yes_sub_title: "Yes",
  no_sub_title: "No",
  status: "active",
  open_time: "2026-01-01T00:00:00.000Z",
  close_time: "2026-02-01T00:00:00.000Z",
  latest_expiration_time: "2026-02-01T00:00:00.000Z",
  result: "",
  yes_bid_dollars: "0.45",
  yes_ask_dollars: "0.47",
  no_bid_dollars: "0.53",
  no_ask_dollars: "0.55",
  last_price_dollars: "0.46",
  volume: 1234,
  volume_24h: 200,
  open_interest: 50,
  rules_primary: "Primary rules",
  rules_secondary: "Secondary rules",
  can_close_early: false,
  hidden_field: "preserved",
  ...overrides
});

describe("normalizeKalshiMarket", () => {
  afterEach(() => {
    console.warn = originalWarn;
  });

  test("maps a known Kalshi market into normalized shape", () => {
    const raw = makeRawMarket();

    expect(normalizeKalshiMarket(raw)).toEqual({
      platform: Platform.KALSHI,
      platform_id: "KXTEST-001",
      title: "Will CPI exceed 3%?",
      description: null,
      event_ticker: "EVENT-1",
      series_ticker: null,
      outcome_labels: ["Yes", "No"],
      resolution_source: null,
      resolution_rules: "Primary rules\n\nSecondary rules",
      open_time: "2026-01-01T00:00:00.000Z",
      start_time: null,
      close_time: "2026-02-01T00:00:00.000Z",
      end_time: "2026-02-01T00:00:00.000Z",
      group_title: null,
      category: null,
      market_shape: "binary",
      is_binary_eligible: true,
      status: MarketStatus.ACTIVE,
      volume: 1234,
      resolution_hash: null,
      raw_data: raw
    });
  });

  test("handles empty optional rule fields", () => {
    const raw = makeRawMarket({ rules_primary: "", rules_secondary: "   " });

    expect(normalizeKalshiMarket(raw).resolution_rules).toBeNull();
  });

  test("marks scalar markets as ineligible for binary matching", () => {
    const normalized = normalizeKalshiMarket(makeRawMarket({ market_type: "scalar" }));

    expect(normalized.market_shape).toBe("scalar");
    expect(normalized.is_binary_eligible).toBe(false);
  });

  test("warns and defaults to active for unmapped status", () => {
    const warnings: unknown[][] = [];
    console.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof console.warn;

    const normalized = normalizeKalshiMarket(makeRawMarket({ status: "paused" }));

    expect(normalized.status).toBe(MarketStatus.ACTIVE);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("Unmapped Kalshi market status");
  });
});

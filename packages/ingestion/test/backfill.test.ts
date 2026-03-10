import { describe, expect, test } from "bun:test";

import { parseBackfillArgs } from "../src/backfill";

describe("parseBackfillArgs", () => {
  test("returns default sample limit in sample mode", () => {
    expect(parseBackfillArgs(["--sample"])).toEqual({ marketLimit: 25 });
  });

  test("prefers explicit limit over default sample size", () => {
    expect(parseBackfillArgs(["--sample", "--limit", "7"])).toEqual({ marketLimit: 7 });
  });

  test("returns empty options when no sampling flags are set", () => {
    expect(parseBackfillArgs([])).toEqual({});
  });

  test("throws for missing or invalid limit values", () => {
    expect(() => parseBackfillArgs(["--limit"])).toThrow("Missing value for --limit");
    expect(() => parseBackfillArgs(["--limit", "0"])).toThrow("--limit must be a positive integer");
  });
});

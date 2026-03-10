import { describe, expect, test } from "bun:test";

import { computeResolutionHash } from "../src/resolution-hash";

const baseFields = {
  resolution_rules: "Resolves by official release",
  resolution_source: "Official source",
  close_time: "2026-05-01T00:00:00.000Z",
  outcome_labels: ["Yes", "No"]
};

describe("computeResolutionHash", () => {
  test("is deterministic for identical inputs", () => {
    expect(computeResolutionHash(baseFields)).toBe(computeResolutionHash(baseFields));
  });

  test("changes when any resolution-critical field changes", () => {
    const baseline = computeResolutionHash(baseFields);

    expect(computeResolutionHash({ ...baseFields, resolution_rules: "Different rules" })).not.toBe(baseline);
    expect(computeResolutionHash({ ...baseFields, resolution_source: "Different source" })).not.toBe(baseline);
    expect(computeResolutionHash({ ...baseFields, close_time: "2026-06-01T00:00:00.000Z" })).not.toBe(baseline);
    expect(computeResolutionHash({ ...baseFields, outcome_labels: ["Yes", "Maybe"] })).not.toBe(baseline);
  });

  test("treats null fields as empty strings", () => {
    expect(
      computeResolutionHash({
        ...baseFields,
        resolution_rules: null,
        resolution_source: null,
        close_time: null
      })
    ).toBe(
      computeResolutionHash({
        ...baseFields,
        resolution_rules: "",
        resolution_source: "",
        close_time: ""
      })
    );
  });

  test("is independent of outcome label order", () => {
    expect(
      computeResolutionHash({
        ...baseFields,
        outcome_labels: ["No", "Yes", "Abstain"]
      })
    ).toBe(
      computeResolutionHash({
        ...baseFields,
        outcome_labels: ["Yes", "Abstain", "No"]
      })
    );
  });
});

import { describe, expect, test, vi, beforeEach } from "vitest";

let rows: Array<{ key: string; enabled: boolean }>;
let fromCallCount: number;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: async () => {
        fromCallCount++;
        return rows;
      },
    }),
  },
  featureFlagsTable: { key: "key", enabled: "enabled" },
}));

describe("isFeatureEnabledServer", () => {
  beforeEach(async () => {
    rows = [
      { key: "ff_radiology_structured_core", enabled: true },
      { key: "ff_radiology_render_v2", enabled: false },
    ];
    fromCallCount = 0;
    const { invalidateFeatureFlagCache } = await import("./featureFlags");
    invalidateFeatureFlagCache(); // reset the module-level cache before each test
  });

  test("returns true for an enabled flag, false for a disabled one", async () => {
    const { isFeatureEnabledServer } = await import("./featureFlags");
    await expect(isFeatureEnabledServer("ff_radiology_structured_core")).resolves.toBe(true);
    await expect(isFeatureEnabledServer("ff_radiology_render_v2")).resolves.toBe(false);
  });

  test("defaults to false for an unknown key — never throws", async () => {
    const { isFeatureEnabledServer } = await import("./featureFlags");
    await expect(isFeatureEnabledServer("ff_does_not_exist")).resolves.toBe(false);
  });

  test("caches across calls — a second lookup does not re-query the DB", async () => {
    const { isFeatureEnabledServer } = await import("./featureFlags");
    await isFeatureEnabledServer("ff_radiology_structured_core");
    await isFeatureEnabledServer("ff_radiology_render_v2");
    expect(fromCallCount).toBe(1);
  });

  test("invalidateFeatureFlagCache forces the next lookup to re-query the DB", async () => {
    const { isFeatureEnabledServer, invalidateFeatureFlagCache } = await import("./featureFlags");
    await isFeatureEnabledServer("ff_radiology_structured_core");
    expect(fromCallCount).toBe(1);

    // Simulate an admin flipping the flag between the two reads.
    rows = [{ key: "ff_radiology_structured_core", enabled: false }];
    invalidateFeatureFlagCache();

    await expect(isFeatureEnabledServer("ff_radiology_structured_core")).resolves.toBe(false);
    expect(fromCallCount).toBe(2);
  });
});

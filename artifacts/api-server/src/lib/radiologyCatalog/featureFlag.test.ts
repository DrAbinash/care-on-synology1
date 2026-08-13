import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRadiologyCatalogEnabled, requireRadiologyCatalogFlag } from "./featureFlag";

vi.mock("../featureFlags", () => ({
  isFeatureEnabledServer: vi.fn(async () => false),
}));

import { isFeatureEnabledServer } from "../featureFlags";

const ORIG = process.env.FF_RADIOLOGY_CATALOG;
afterEach(() => {
  process.env.FF_RADIOLOGY_CATALOG = ORIG;
  vi.mocked(isFeatureEnabledServer).mockReset();
  vi.mocked(isFeatureEnabledServer).mockResolvedValue(false);
});

describe("ff_radiology_catalog gate", () => {
  it("defaults OFF and only turns on for explicit truthy env values", () => {
    delete process.env.FF_RADIOLOGY_CATALOG;
    expect(isRadiologyCatalogEnabled()).toBe(false);
    for (const v of ["false", "0", "off", "", "nope"]) {
      process.env.FF_RADIOLOGY_CATALOG = v;
      expect(isRadiologyCatalogEnabled(), v).toBe(false);
    }
    for (const v of ["true", "1", "on", "TRUE", "On"]) {
      process.env.FF_RADIOLOGY_CATALOG = v;
      expect(isRadiologyCatalogEnabled(), v).toBe(true);
    }
  });

  it("middleware 404s when disabled and calls next() when env enabled", async () => {
    const makeRes = () => {
      const res: {
        statusCode?: number;
        body?: unknown;
        status: (c: number) => typeof res;
        json: (b: unknown) => typeof res;
      } = {
        status(c: number) {
          res.statusCode = c;
          return res;
        },
        json(b: unknown) {
          res.body = b;
          return res;
        },
      };
      return res;
    };

    delete process.env.FF_RADIOLOGY_CATALOG;
    vi.mocked(isFeatureEnabledServer).mockResolvedValue(false);
    const res1 = makeRes();
    const next1 = vi.fn();
    await requireRadiologyCatalogFlag({} as never, res1 as never, next1);
    expect(res1.statusCode).toBe(404);
    expect(next1).not.toHaveBeenCalled();

    process.env.FF_RADIOLOGY_CATALOG = "true";
    const res2 = makeRes();
    const next2 = vi.fn();
    await requireRadiologyCatalogFlag({} as never, res2 as never, next2);
    expect(next2).toHaveBeenCalledOnce();
    expect(res2.statusCode).toBeUndefined();
  });

  it("middleware allows DB feature flag when env is off", async () => {
    delete process.env.FF_RADIOLOGY_CATALOG;
    vi.mocked(isFeatureEnabledServer).mockResolvedValue(true);
    const res = {
      statusCode: undefined as number | undefined,
      status(c: number) {
        res.statusCode = c;
        return res;
      },
      json() {
        return res;
      },
    };
    const next = vi.fn();
    await requireRadiologyCatalogFlag({} as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });
});

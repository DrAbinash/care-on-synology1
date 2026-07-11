import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isRadiologyCatalogEnabled, requireRadiologyCatalogFlag } from "./featureFlag";

const ORIG = process.env.FF_RADIOLOGY_CATALOG;
afterEach(() => { process.env.FF_RADIOLOGY_CATALOG = ORIG; });

describe("ff_radiology_catalog gate", () => {
  it("defaults OFF and only turns on for explicit truthy values", () => {
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

  it("middleware 404s when disabled and calls next() when enabled", () => {
    const makeRes = () => {
      const res: { statusCode?: number; body?: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
        status(c: number) { res.statusCode = c; return res; },
        json(b: unknown) { res.body = b; return res; },
      };
      return res;
    };

    delete process.env.FF_RADIOLOGY_CATALOG;
    const res1 = makeRes();
    const next1 = vi.fn();
    requireRadiologyCatalogFlag({} as never, res1 as never, next1);
    expect(res1.statusCode).toBe(404);
    expect(next1).not.toHaveBeenCalled();

    process.env.FF_RADIOLOGY_CATALOG = "true";
    const res2 = makeRes();
    const next2 = vi.fn();
    requireRadiologyCatalogFlag({} as never, res2 as never, next2);
    expect(next2).toHaveBeenCalledOnce();
    expect(res2.statusCode).toBeUndefined();
  });
});

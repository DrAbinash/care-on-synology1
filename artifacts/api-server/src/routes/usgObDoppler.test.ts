import { describe, expect, test, vi, beforeEach } from "vitest";

// P5 OB/Doppler router flag-gate coverage: each endpoint 404s when its flag is
// OFF (direct API gated, not just the UI). Service is mocked; DB behavior is
// proven in usgObDopplerService.integration.test.ts.

let flagOn: Record<string, boolean>;
vi.mock("../lib/featureFlags", () => ({ isFeatureEnabledServer: async (k: string) => flagOn[k] ?? false }));
const buildObSectionForStudy = vi.fn();
const buildDopplerSectionForStudy = vi.fn();
const formFStatusForStudy = vi.fn();
vi.mock("../lib/usgObDopplerService", () => ({
  buildObSectionForStudy: (...a: unknown[]) => buildObSectionForStudy(...a),
  buildDopplerSectionForStudy: (...a: unknown[]) => buildDopplerSectionForStudy(...a),
  formFStatusForStudy: (...a: unknown[]) => formFStatusForStudy(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runChain(router: any, method: string, path: string, req: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method} ${path} not found`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = layer.route.stack.map((s: any) => s.handle);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  let idx = 0;
  const next = async () => { if (idx < handlers.length) await handlers[idx++](req, res, next); };
  await next();
  return res;
}

beforeEach(() => {
  flagOn = {};
  buildObSectionForStudy.mockReset();
  buildDopplerSectionForStudy.mockReset();
  formFStatusForStudy.mockReset();
});

describe("P5 OB/Doppler flag gates", () => {
  test("ob-section 404s when ff_radiology_usg_ob_canonical is OFF", async () => {
    const { default: router } = await import("./usgObDoppler");
    const res = await runChain(router, "get", "/studies/:studyId/ob-section", { params: { studyId: "1" } });
    expect(res.statusCode).toBe(404);
    expect(buildObSectionForStudy).not.toHaveBeenCalled();
  });

  test("ob-section serves when the flag is ON", async () => {
    flagOn = { ff_radiology_usg_ob_canonical: true };
    buildObSectionForStudy.mockResolvedValue({ section: { label: "Obstetric", text: "x" }, impression: [] });
    const { default: router } = await import("./usgObDoppler");
    const res = await runChain(router, "get", "/studies/:studyId/ob-section", { params: { studyId: "1" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.section.label).toBe("Obstetric");
  });

  test("doppler-section 404s when ff_radiology_usg_doppler_canonical is OFF (even if ob is on)", async () => {
    flagOn = { ff_radiology_usg_ob_canonical: true };
    const { default: router } = await import("./usgObDoppler");
    const res = await runChain(router, "get", "/studies/:studyId/doppler-section", { params: { studyId: "1" } });
    expect(res.statusCode).toBe(404);
    expect(buildDopplerSectionForStudy).not.toHaveBeenCalled();
  });

  test("form-f-status is served under the ob flag", async () => {
    flagOn = { ff_radiology_usg_ob_canonical: true };
    formFStatusForStudy.mockResolvedValue({ applicable: true, compliant: false, errors: ["x"], reason: "no_form_f", formFId: null });
    const { default: router } = await import("./usgObDoppler");
    const res = await runChain(router, "get", "/studies/:studyId/form-f-status", { params: { studyId: "1" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.compliant).toBe(false);
  });
});

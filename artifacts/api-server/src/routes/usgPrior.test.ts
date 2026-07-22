import { describe, expect, test, vi, beforeEach } from "vitest";

// Verifies the P4 prior router's flag gate (404 when OFF so direct API calls
// are gated, not just the UI) and the cross-patient → 403 mapping. Service
// functions are mocked; the DB-backed behavior is proven in
// usgPriorDataService.integration.test.ts.

let flagOn: Record<string, boolean>;
vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async (k: string) => flagOn[k] ?? false,
}));
const findPriorStudies = vi.fn();
const compareStudies = vi.fn();
const pregnancyTimelineForPatient = vi.fn();
vi.mock("../lib/usgPriorDataService", () => ({
  findPriorStudies: (...a: unknown[]) => findPriorStudies(...a),
  compareStudies: (...a: unknown[]) => compareStudies(...a),
  pregnancyTimelineForPatient: (...a: unknown[]) => pregnancyTimelineForPatient(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function layerFor(router: any, method: string, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runChain(router: any, method: string, path: string, req: any) {
  const layer = layerFor(router, method, path);
  if (!layer) throw new Error(`${method} ${path} not found`);
  // Run the router-level middleware (flag gate) then the route handlers in order.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mws = router.stack.filter((l: any) => !l.route && typeof l.handle === "function").map((l: any) => l.handle);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = [...mws, ...layer.route.stack.map((s: any) => s.handle)];
  const res = makeRes();
  let idx = 0;
  const next = async () => { if (idx < handlers.length) { const h = handlers[idx++]; await h(req, res, next); } };
  await next();
  return res;
}
function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  return res;
}

beforeEach(() => {
  flagOn = {};
  findPriorStudies.mockReset();
  compareStudies.mockReset();
  pregnancyTimelineForPatient.mockReset();
});

describe("GET /api/usg-prior/* — flag gate", () => {
  test("404s when ff_radiology_usg_prior_intelligence is OFF (direct API is gated)", async () => {
    const { default: router } = await import("./usgPrior");
    const res = await runChain(router, "get", "/studies/:studyId/priors", { params: { studyId: "1" } });
    expect(res.statusCode).toBe(404);
    expect(findPriorStudies).not.toHaveBeenCalled();
  });

  test("serves priors when the flag is ON", async () => {
    flagOn = { ff_radiology_usg_prior_intelligence: true };
    findPriorStudies.mockResolvedValue([{ studyId: 9 }]);
    const { default: router } = await import("./usgPrior");
    const res = await runChain(router, "get", "/studies/:studyId/priors", { params: { studyId: "1" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.priors).toEqual([{ studyId: 9 }]);
  });

  test("timeline needs the SECOND flag too", async () => {
    flagOn = { ff_radiology_usg_prior_intelligence: true }; // pregnancy_timeline OFF
    const { default: router } = await import("./usgPrior");
    const res = await runChain(router, "get", "/patients/:patientId/timeline", { params: { patientId: "5" } });
    expect(res.statusCode).toBe(404);
    expect(pregnancyTimelineForPatient).not.toHaveBeenCalled();
  });
});

describe("GET /api/usg-prior/studies/:studyId/compare/:priorId", () => {
  test("maps a cross-patient block to 403", async () => {
    flagOn = { ff_radiology_usg_prior_intelligence: true };
    compareStudies.mockResolvedValue({ error: "cross_patient_comparison_blocked" });
    const { default: router } = await import("./usgPrior");
    const res = await runChain(router, "get", "/studies/:studyId/compare/:priorId", { params: { studyId: "1", priorId: "2" } });
    expect(res.statusCode).toBe(403);
  });
});

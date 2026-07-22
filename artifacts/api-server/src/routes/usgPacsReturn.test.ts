import { describe, expect, test, vi, beforeEach } from "vitest";

// P6 report→PACS return router: flag gate (404 OFF), ineligible → 409 (no
// enqueue), eligible → enqueue. Service + enqueue mocked; the fail-closed
// eligibility logic is proven in usgPacsReturnService / usgPacsReturnPolicy tests.

let flagOn: boolean;
vi.mock("../lib/featureFlags", () => ({ isFeatureEnabledServer: async () => flagOn }));
const evaluateUsgPacsReturn = vi.fn();
vi.mock("../lib/usgPacsReturnService", () => ({ evaluateUsgPacsReturn: (...a: unknown[]) => evaluateUsgPacsReturn(...a) }));
const enqueueRadiologyJob = vi.fn();
vi.mock("../lib/radiologyJobs", () => ({ enqueueRadiologyJob: (...a: unknown[]) => enqueueRadiologyJob(...a) }));
vi.mock("../lib/radiologyJobHandlers", () => ({ USG_PACS_RETURN_JOB: "usg_pacs_return" }));
vi.mock("@workspace/db", () => ({ db: { insert: () => ({ values: () => ({ catch: () => Promise.resolve() }) }) } }));
vi.mock("@workspace/db/schema", () => ({ radiologyStudiesTable: {}, radiologyPacsArchiveRevisionsTable: {}, usgAuditLogTable: {} }));
vi.mock("../lib/logger", () => ({ logger: { warn: () => {} } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runChain(router: any, method: string, path: string, req: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method} ${path} not found`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mws = router.stack.filter((l: any) => !l.route && typeof l.handle === "function").map((l: any) => l.handle);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = [...mws, ...layer.route.stack.map((s: any) => s.handle)];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  let idx = 0;
  const next = async () => { if (idx < handlers.length) await handlers[idx++](req, res, next); };
  await next();
  return res;
}

beforeEach(() => { flagOn = true; evaluateUsgPacsReturn.mockReset(); enqueueRadiologyJob.mockReset(); });

describe("P6 usg-pacs-return router", () => {
  test("404s when the flag is OFF", async () => {
    flagOn = false;
    const { default: router } = await import("./usgPacsReturn");
    const res = await runChain(router, "get", "/studies/:studyId/eligibility", { params: { studyId: "1" } });
    expect(res.statusCode).toBe(404);
    expect(evaluateUsgPacsReturn).not.toHaveBeenCalled();
  });

  test("return refuses an ineligible study with 409 and never enqueues", async () => {
    evaluateUsgPacsReturn.mockResolvedValue({ eligible: false, blockReasons: ["not_finalized"], errors: ["draft"], reportId: null });
    const { default: router } = await import("./usgPacsReturn");
    const res = await runChain(router, "post", "/studies/:studyId/return", { params: { studyId: "1" }, staffSession: { subjectName: "Dr A" } });
    expect(res.statusCode).toBe(409);
    expect(res.body.blockReasons).toContain("not_finalized");
    expect(enqueueRadiologyJob).not.toHaveBeenCalled();
  });

  test("return enqueues the durable job for an eligible study", async () => {
    evaluateUsgPacsReturn.mockResolvedValue({ eligible: true, blockReasons: [], errors: [], reportId: 100, idempotencyKey: "usg-pacs:1.2.3:100:1" });
    enqueueRadiologyJob.mockResolvedValue({ id: 7, created: true });
    const { default: router } = await import("./usgPacsReturn");
    const res = await runChain(router, "post", "/studies/:studyId/return", { params: { studyId: "1" }, staffSession: { subjectName: "Dr A" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.enqueued).toBe(true);
    expect(enqueueRadiologyJob).toHaveBeenCalledWith(expect.objectContaining({
      operationType: "usg_pacs_return", idempotencyKey: "usg-pacs:1.2.3:100:1", entityId: 1,
    }));
  });
});

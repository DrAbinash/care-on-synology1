import { describe, expect, test, vi, beforeEach } from "vitest";

// Route-level coverage for the P9 USG admin/rollout control plane. Follows the
// no-HTTP-server technique used by featureFlags.test.ts / clinicSettings.test.ts:
// mock @workspace/db, reach into the Express Router stack, invoke the real
// handler. Verifies server-enforced enable gates, rollback, kill-switch, audit,
// and the admin-role guard — not just the pure decision logic.

let liveRows: Array<{ key: string; enabled: boolean }>;
let flagWrites: Array<Record<string, unknown>>;
let auditInserts: Array<Record<string, unknown>>;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: async () => liveRows }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => { flagWrites.push(vals); },
        catch: () => { auditInserts.push(vals); return Promise.resolve(); },
      }),
    }),
  },
}));
vi.mock("@workspace/db/schema", () => ({ featureFlagsTable: { key: "key" }, usgAuditLogTable: {} }));

const invalidateFeatureFlagCache = vi.fn();
vi.mock("../lib/featureFlags", () => ({ invalidateFeatureFlagCache: () => invalidateFeatureFlagCache() }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: string, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200, body: undefined,
    status(c: number) { this.statusCode = c; return this; },
    json(p: unknown) { this.body = p; return this; },
  };
  return res;
}
const admin = { subjectId: 1, subjectName: "Dr. Admin", role: "admin" };

beforeEach(() => {
  liveRows = [];
  flagWrites = [];
  auditInserts = [];
  invalidateFeatureFlagCache.mockClear();
});

describe("GET /api/usg-admin/readiness", () => {
  test("returns the full USG readiness matrix, not production-ready by default", async () => {
    const { default: router } = await import("./usgAdmin");
    const handler = getRouteHandler(router, "get", "/readiness");
    const res = makeRes();
    await handler({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.productionReady).toBe(false);
    expect(res.body.flags.length).toBeGreaterThan(0);
    expect(res.body.enabledFlags).toEqual([]);
  });
});

describe("POST /api/usg-admin/flags/:key/enable — server-enforced gates", () => {
  test("refuses an unmet dependency with 409 and writes NO flag", async () => {
    const { default: router } = await import("./usgAdmin");
    const handler = getRouteHandler(router, "post", "/flags/:key/enable");
    const req = { params: { key: "ff_radiology_usg_pregnancy_timeline" }, body: { force: true, reason: "test" }, staffSession: admin };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("unmet_dependencies");
    expect(flagWrites).toHaveLength(0);
    expect(auditInserts.some((a) => a.action === "usg_flag_enable_denied")).toBe(true);
  });

  test("refuses a not-clinic-validated flag without force (409)", async () => {
    const { default: router } = await import("./usgAdmin");
    const handler = getRouteHandler(router, "post", "/flags/:key/enable");
    const req = { params: { key: "ff_radiology_usg_prior_intelligence" }, body: {}, staffSession: admin };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("validation_pending");
    expect(flagWrites).toHaveLength(0);
  });

  test("enables with force+reason, writes the flag, invalidates cache, audits the acknowledgement", async () => {
    const { default: router } = await import("./usgAdmin");
    const handler = getRouteHandler(router, "post", "/flags/:key/enable");
    const req = { params: { key: "ff_radiology_usg_prior_intelligence" }, body: { force: true, reason: "pilot staging test" }, staffSession: admin };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.forced).toBe(true);
    expect(flagWrites[0]).toMatchObject({ key: "ff_radiology_usg_prior_intelligence", enabled: true, updatedBy: "Dr. Admin" });
    expect(invalidateFeatureFlagCache).toHaveBeenCalled();
    expect(auditInserts.some((a) => a.action === "usg_flag_enable_forced")).toBe(true);
  });

  test("404s an unknown flag", async () => {
    const { default: router } = await import("./usgAdmin");
    const handler = getRouteHandler(router, "post", "/flags/:key/enable");
    const req = { params: { key: "ff_radiology_not_usg" }, body: {}, staffSession: admin };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/usg-admin/flags/:key/disable — rollback always allowed", () => {
  test("disables and warns about dependents left ON", async () => {
    liveRows = [
      { key: "ff_radiology_usg_prior_intelligence", enabled: true },
      { key: "ff_radiology_usg_pregnancy_timeline", enabled: true },
    ];
    const { default: router } = await import("./usgAdmin");
    const handler = getRouteHandler(router, "post", "/flags/:key/disable");
    const req = { params: { key: "ff_radiology_usg_prior_intelligence" }, body: {}, staffSession: admin };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.dependentsStillOn).toContain("ff_radiology_usg_pregnancy_timeline");
    expect(flagWrites[0]).toMatchObject({ key: "ff_radiology_usg_prior_intelligence", enabled: false });
  });
});

describe("POST /api/usg-admin/kill-switch", () => {
  test("disables every enabled USG flag and audits", async () => {
    liveRows = [
      { key: "ff_radiology_usg_prior_intelligence", enabled: true },
      { key: "ff_radiology_usg_ob_canonical", enabled: true },
      { key: "ff_radiology_ai", enabled: true }, // non-USG, must be untouched
    ];
    const { default: router } = await import("./usgAdmin");
    const handler = getRouteHandler(router, "post", "/kill-switch");
    const res = makeRes();
    await handler({ staffSession: admin }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.disabled.sort()).toEqual(["ff_radiology_usg_ob_canonical", "ff_radiology_usg_prior_intelligence"]);
    expect(flagWrites.every((w) => w.enabled === false)).toBe(true);
    expect(flagWrites.map((w) => w.key)).not.toContain("ff_radiology_ai");
  });
});

describe("admin-role guard", () => {
  test("every mutation route is wired [requireAdminRole, handler]", async () => {
    const { default: router } = await import("./usgAdmin");
    for (const path of ["/flags/:key/enable", "/flags/:key/disable", "/kill-switch"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods.post);
      if (!layer || !layer.route) throw new Error(`${path} missing`);
      expect(layer.route.stack).toHaveLength(2); // [requireAdminRole, handler]
    }
  });
});

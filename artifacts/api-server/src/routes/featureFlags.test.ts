import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket T0.1 coverage: GET is unauthenticated-agnostic (auth is enforced by
// the requireStaffAuth mount in routes/index.ts, not re-tested here), PATCH
// validates its body, 404s on an unknown key, and — critically — is gated by
// requireAdminRole regardless of the caller's per-user permissions array.
//
// Follows the same no-HTTP-server technique already used in
// clinicSettings.test.ts: reach into the Express Router's internal stack to
// invoke the real handler function directly (no supertest dependency in
// this repo).

let allRows: Array<{ key: string; enabled: boolean; description: string; updatedBy: string | null; updatedAt: string }>;
let selectOneResult: typeof allRows;
let updateSetCalls: Record<string, unknown>[];
let updatedRow: (typeof allRows)[number] | null;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        orderBy: async () => allRows,
        where: () => ({
          limit: async () => selectOneResult,
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        updateSetCalls.push(vals);
        return {
          where: () => ({
            returning: async () => (updatedRow ? [{ ...updatedRow, ...vals }] : []),
          }),
        };
      },
    }),
  },
  featureFlagsTable: {
    key: "key", enabled: "enabled", description: "description",
    updatedBy: "updated_by", updatedAt: "updated_at",
  },
}));

const invalidateFeatureFlagCache = vi.fn();
vi.mock("../lib/featureFlags", () => ({
  invalidateFeatureFlagCache: () => invalidateFeatureFlagCache(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: "get" | "patch", path: string) {
  const layer = router.stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

describe("GET /api/feature-flags", () => {
  beforeEach(() => {
    allRows = [
      { key: "ff_radiology_structured_core", enabled: false, description: "x", updatedBy: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      { key: "ff_radiology_render_v2", enabled: false, description: "y", updatedBy: null, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    invalidateFeatureFlagCache.mockClear();
  });

  test("returns every seeded flag, all defaulting to disabled", async () => {
    const { default: featureFlagsRouter } = await import("./featureFlags");
    const handler = getRouteHandler(featureFlagsRouter, "get", "/");
    const res = makeRes();
    await handler({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((f: { enabled: boolean }) => f.enabled === false)).toBe(true);
  });
});

describe("PATCH /api/feature-flags/:key", () => {
  beforeEach(() => {
    selectOneResult = [{ key: "ff_radiology_structured_core", enabled: false, description: "x", updatedBy: null, updatedAt: "2026-01-01T00:00:00.000Z" }];
    updatedRow = selectOneResult[0];
    updateSetCalls = [];
    invalidateFeatureFlagCache.mockClear();
  });

  test("flips a known flag on and stamps updatedBy from the session", async () => {
    const { default: featureFlagsRouter } = await import("./featureFlags");
    const handler = getRouteHandler(featureFlagsRouter, "patch", "/:key");
    const req = { params: { key: "ff_radiology_structured_core" }, body: { enabled: true }, staffSession: { subjectName: "Dr. Admin" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(updateSetCalls[0]).toMatchObject({ enabled: true, updatedBy: "Dr. Admin" });
    expect(updateSetCalls[0].updatedAt).toBeInstanceOf(Date);
    // The cache must be invalidated so the very next isFeatureEnabledServer()
    // call in this same process reads the fresh value.
    expect(invalidateFeatureFlagCache).toHaveBeenCalledTimes(1);
  });

  test("rejects a non-boolean enabled value with 400, never touches the DB", async () => {
    const { default: featureFlagsRouter } = await import("./featureFlags");
    const handler = getRouteHandler(featureFlagsRouter, "patch", "/:key");
    const req = { params: { key: "ff_radiology_structured_core" }, body: { enabled: "yes" }, staffSession: { subjectName: "Dr. Admin" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(updateSetCalls).toHaveLength(0);
    expect(invalidateFeatureFlagCache).not.toHaveBeenCalled();
  });

  test("404s on an unknown key, never touches the DB update path", async () => {
    selectOneResult = []; // no row found for this key
    const { default: featureFlagsRouter } = await import("./featureFlags");
    const handler = getRouteHandler(featureFlagsRouter, "patch", "/:key");
    const req = { params: { key: "ff_does_not_exist" }, body: { enabled: true }, staffSession: { subjectName: "Dr. Admin" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(updateSetCalls).toHaveLength(0);
  });

  test("falls back to 'system' as updatedBy if the session name is missing", async () => {
    const { default: featureFlagsRouter } = await import("./featureFlags");
    const handler = getRouteHandler(featureFlagsRouter, "patch", "/:key");
    const req = { params: { key: "ff_radiology_structured_core" }, body: { enabled: true }, staffSession: {} };
    const res = makeRes();
    await handler(req, res);

    expect(updateSetCalls[0]).toMatchObject({ updatedBy: "system" });
  });

  test("the route is wired with requireAdminRole ahead of the handler", async () => {
    const { default: featureFlagsRouter } = await import("./featureFlags");
    const layer = featureFlagsRouter.stack.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (l: any) => l.route && l.route.path === "/:key" && l.route.methods.patch,
    );
    if (!layer || !layer.route) throw new Error("PATCH /:key route not found on featureFlagsRouter");
    expect(layer.route.stack).toHaveLength(2); // [requireAdminRole, handler]
  });
});

describe("requireAdminRole gate (the actual middleware, invoked directly)", () => {
  test("blocks a non-admin staff session with 403 and never calls next()", async () => {
    const { requireAdminRole } = await import("../middleware/requireStaffAuth");
    const req = { staffSession: { role: "receptionist" } };
    const res = makeRes();
    const next = vi.fn();
    requireAdminRole(req as never, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("allows an admin session through to next()", async () => {
    const { requireAdminRole } = await import("../middleware/requireStaffAuth");
    const req = { staffSession: { role: "admin" } };
    const res = makeRes();
    const next = vi.fn();
    requireAdminRole(req as never, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBeUndefined();
  });
});

import { describe, expect, test, vi, beforeEach } from "vitest";

// Activation endpoints on the usgAdmin router: GET /activation (health + view),
// POST /activate-safe (Group A one-click), POST /activate-infra (Group B
// health-gated). DB + activation service mocked; the grouping/health logic is
// proven in usgActivationService.test.ts.

let flagWrites: Array<Record<string, unknown>>;
let auditInserts: Array<Record<string, unknown>>;
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: async () => [] }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => { flagWrites.push(vals); },
        catch: () => { auditInserts.push(vals); return Promise.resolve(); },
      }),
    }),
  },
}));
vi.mock("@workspace/db/schema", () => ({ featureFlagsTable: { key: "key" }, usgAuditLogTable: {} }));
vi.mock("../lib/featureFlags", () => ({ invalidateFeatureFlagCache: () => {} }));

const HEALTHY = { orthanc: { ok: true, message: "ok", checkedServerSide: true }, viewer: { ok: false, message: "browser", checkedServerSide: false }, ai_gateway: { ok: false, message: "no url", checkedServerSide: true } };
vi.mock("../lib/usgActivationService", () => ({
  checkInfraHealth: async () => HEALTHY,
  buildActivationView: () => [{ flag: "ff_radiology_usg_workspace", group: "A", label: "WS", status: "Available", enabled: false, activatable: true, remediation: null }],
  groupAActivationOrder: () => ["ff_radiology_usg_workspace", "ff_radiology_usg_ob_canonical"],
  groupBActivatable: () => ["ff_radiology_usg_report_to_pacs"], // only Orthanc-backed passes
  GROUP_C_SAFETY_CONTROLS: ["PCPNDT fail-closed"],
  INFRA_SETUP: [{ kind: "orthanc", title: "Orthanc (PACS)", unlocks: "extraction + PACS", envVars: ["ORTHANC_URL=..."], steps: ["run it"] }],
}));
vi.mock("../lib/usgReadinessService", () => ({
  loadLiveFlags: async () => ({}),
  buildReadinessMatrix: () => ({ productionReady: false, summary: "", flags: [], enabledFlags: [] }),
  decideEnable: () => ({ ok: true }),
  killSwitchTargets: () => ({ disabled: [] }),
  usgPhaseFlags: () => [],
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handler(router: any, method: string, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method} ${path} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  return res;
}
const admin = { subjectName: "Dr. Admin", role: "admin" };

beforeEach(() => { flagWrites = []; auditInserts = []; });

describe("GET /api/usg-admin/activation", () => {
  test("returns health + activation view + safety controls", async () => {
    const { default: router } = await import("./usgAdmin");
    const res = makeRes();
    await handler(router, "get", "/activation")({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.health.orthanc.ok).toBe(true);
    expect(res.body.safetyControls).toContain("PCPNDT fail-closed");
    expect(res.body.groupBActivatable).toContain("ff_radiology_usg_report_to_pacs");
    // In-app setup guide is annotated with each infra's live health.
    expect(res.body.infraSetup[0].kind).toBe("orthanc");
    expect(res.body.infraSetup[0].health.ok).toBe(true);
  });
});

describe("POST /api/usg-admin/activate-safe", () => {
  test("enables every Group A flag in order and audits it", async () => {
    const { default: router } = await import("./usgAdmin");
    const res = makeRes();
    await handler(router, "post", "/activate-safe")({ staffSession: admin }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.enabled).toEqual(["ff_radiology_usg_workspace", "ff_radiology_usg_ob_canonical"]);
    expect(flagWrites.every((w) => w.enabled === true)).toBe(true);
    expect(auditInserts.some((a) => a.action === "usg_activate_group_a")).toBe(true);
  });
});

describe("POST /api/usg-admin/activate-infra", () => {
  test("enables only Group B flags whose infra health passes", async () => {
    const { default: router } = await import("./usgAdmin");
    const res = makeRes();
    await handler(router, "post", "/activate-infra")({ staffSession: admin }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.enabled).toEqual(["ff_radiology_usg_report_to_pacs"]);
    // AI / viewer flags (unhealthy) are NOT written.
    expect(flagWrites.map((w) => w.key)).toEqual(["ff_radiology_usg_report_to_pacs"]);
    expect(auditInserts.some((a) => a.action === "usg_activate_group_b")).toBe(true);
  });
});

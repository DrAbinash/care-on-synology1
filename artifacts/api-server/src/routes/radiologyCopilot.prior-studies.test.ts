import { describe, expect, test, vi, beforeEach } from "vitest";

// PR1-B coverage: GET /api/radiology-copilot/prior-studies.
//
// Root cause under test: both prior-report panels called this endpoint but it
// did not exist (the router had only /log and /profile), so the comparison
// panel silently showed "no prior studies" forever. These tests prove the
// route exists, is permission-gated, validates its query, scopes strictly by
// patientId, excludes the current study, and returns the panel shape.
//
// Same no-HTTP-server technique as featureFlags.test.ts.

let studiesRows: Array<Record<string, unknown>>;
let reportsRows: Array<Record<string, unknown>>;
let reportsQueryCount: number;
let capturedWhereArgs: unknown[];

vi.mock("@workspace/db", () => {
  const db = {
    select: () => ({
      from: (table: { __name?: string }) => {
        if (table.__name === "radiology_studies") {
          return {
            leftJoin: () => ({
              where: (arg: unknown) => {
                capturedWhereArgs.push(arg);
                return { orderBy: () => ({ limit: async () => studiesRows }) };
              },
            }),
          };
        }
        if (table.__name === "patient_reports") {
          return {
            where: (arg: unknown) => {
              capturedWhereArgs.push(arg);
              reportsQueryCount += 1;
              return Promise.resolve(reportsRows);
            },
          };
        }
        return {
          where: () => ({ limit: async () => [] }),
        };
      },
    }),
    insert: () => ({ values: () => Promise.resolve([]) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  };
  return { db };
});

vi.mock("@workspace/db/schema", () => ({
  radiologyCopilotLogsTable: { __name: "radiology_copilot_logs" },
  radiologyUserCopilotProfilesTable: { __name: "radiology_user_copilot_profiles" },
  radiologyStudiesTable: {
    __name: "radiology_studies",
    id: "id", accessionNumber: "accession_number", modality: "modality", bodyPart: "body_part",
    studyDate: "study_date", status: "status", patientId: "patient_id", testId: "test_id",
    finalReport: "final_report", finalReportedBy: "final_reported_by", finalReportedAt: "final_reported_at",
    prelimReport: "prelim_report", prelimReportedBy: "prelim_reported_by", prelimReportedAt: "prelim_reported_at",
    studyDescription: "study_description",
  },
  patientReportsTable: {
    __name: "patient_reports",
    id: "id", studyId: "study_id", status: "status", impression: "impression",
    body: "body", createdAt: "created_at", patientId: "patient_id", type: "type",
  },
  testsTable: { __name: "diagnostic_tests", id: "id", name: "name", code: "code" },
}));

// Tag the permission middleware so the test can prove the route is gated with
// the radiology permission (mount-level requireStaffAuth is covered by
// routes/index.ts and not re-tested here, same as the other route tests).
vi.mock("../middleware/requireStaffAuth", () => ({
  requireStaffPermission: (permission: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mw: any = (_req: unknown, _res: unknown, next: () => void) => next();
    mw.__permissionTag = permission;
    return mw;
  },
}));

import { radiologyCoPilotRouter } from "./radiologyCopilot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteLayer(method: "get" | "post", path: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (radiologyCoPilotRouter as any).stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  return layer;
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

function makeReq(query: Record<string, string>) {
  return { query, staffSession: { role: "radiologist", permissions: ["/radiology"] }, log: { error: vi.fn() } };
}

/** Collect every bound parameter value out of a drizzle SQL tree. With the
 *  string-mocked columns used here, drizzle embeds column names and bound
 *  values as raw primitives inside queryChunks. */
function collectParams(node: unknown, out: unknown[] = []): unknown[] {
  if (node == null) return out;
  if (typeof node === "number" || typeof node === "string") { out.push(node); return out; }
  if (typeof node !== "object") return out;
  const anyNode = node as { value?: unknown; queryChunks?: unknown[] };
  if ("value" in anyNode && anyNode.queryChunks === undefined) out.push(anyNode.value);
  if (Array.isArray(anyNode.queryChunks)) for (const c of anyNode.queryChunks) collectParams(c, out);
  return out;
}

const layer = getRouteLayer("get", "/prior-studies");
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

beforeEach(() => {
  studiesRows = [];
  reportsRows = [];
  reportsQueryCount = 0;
  capturedWhereArgs = [];
});

describe("GET /api/radiology-copilot/prior-studies", () => {
  test("is gated by the /radiology staff permission", () => {
    const first = layer.route.stack[0].handle;
    expect(first.__permissionTag).toBe("/radiology");
    expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
  });

  test("400 with a clear error when patientId is missing or invalid", async () => {
    for (const query of [{}, { patientId: "abc" }, { patientId: "-4" }, { patientId: "0" }]) {
      const res = makeRes();
      await handler(makeReq(query as Record<string, string>), res);
      expect(res.statusCode).toBe(400);
      expect(String(res.body.error)).toContain("Invalid prior-studies query");
    }
    expect(capturedWhereArgs).toHaveLength(0); // no query ever reached the db
  });

  test("scopes by patientId, excludes the current study and cancelled studies (bound SQL params)", async () => {
    studiesRows = [];
    const res = makeRes();
    await handler(makeReq({ patientId: "42", excludeStudyId: "7" }), res);
    expect(res.statusCode).toBe(200);
    const params = collectParams(capturedWhereArgs[0]);
    expect(params).toContain(42);        // eq(patientId)
    expect(params).toContain("cancelled"); // ne(status, 'cancelled')
    expect(params).toContain(7);         // ne(id, excludeStudyId)
  });

  test("returns the merged panel shape; report impression comes from the signed linked report", async () => {
    studiesRows = [{
      id: 5, accessionNumber: "ACC-20260601-MR-001", modality: "MR", bodyPart: "SPINE",
      studyDate: "2026-06-01", status: "reported_final", testName: "MRI Lumbar Spine", testCode: "MRI-LS",
      finalReport: "Final text", finalReportedBy: "Dr. Sugandha", finalReportedAt: new Date("2026-06-01T10:00:00Z"),
      prelimReport: null, prelimReportedBy: null, prelimReportedAt: null, studyDescription: "MRI LS",
    }];
    reportsRows = [
      { id: 30, studyId: 5, status: "draft", impression: "DRAFT IMP", body: "d", createdAt: new Date("2026-06-02") },
      { id: 31, studyId: 5, status: "verified", impression: "SIGNED IMP", body: "v", createdAt: new Date("2026-06-01") },
    ];
    const res = makeRes();
    await handler(makeReq({ patientId: "42" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.studies).toHaveLength(1);
    expect(res.body.studies[0]).toMatchObject({
      id: 5,
      accessionNumber: "ACC-20260601-MR-001",
      modality: "MR",
      testName: "MRI Lumbar Spine",
      impression: "SIGNED IMP",
      finalReport: "Final text",
      reportedBy: "Dr. Sugandha",
      status: "reported_final",
      reportId: 31,
      reportStatus: "verified",
    });
  });

  test("no prior studies → { studies: [] } and the reports query is skipped (no N+1, clean empty state)", async () => {
    studiesRows = [];
    const res = makeRes();
    await handler(makeReq({ patientId: "42" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ studies: [] });
    expect(reportsQueryCount).toBe(0);
  });

  test("limit is clamped by validation (over-limit rejected)", async () => {
    const res = makeRes();
    await handler(makeReq({ patientId: "42", limit: "500" }), res);
    expect(res.statusCode).toBe(400);
  });
});

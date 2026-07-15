import { describe, expect, test, vi, beforeEach } from "vitest";

// PR A — USG Safety, Calculation Correctness & Fetal-USG Foundation Repair.
//
// Covers the two confirmed defects this PR fixes at the route level:
//  1. POST /api/fetal-usg/study used to hardcode { patientId: 1, studyId: 1 }
//     regardless of what was selected — every study got silently attached to
//     patient/study #1. This suite proves the real, selected patientId and
//     radiologyStudyId are the ones used, and that creation is blocked (not
//     defaulted) whenever the selected context is missing or invalid.
//  2. POST /:studyId/extract-measurements was registered twice — the first
//     (never-fully-implemented) handler shadowed the second, more-developed
//     one, so the second was dead code. This suite proves only one handler
//     is registered now, and that it returns an honest not_implemented
//     capability status rather than pretending extraction works.
//
// Follows this codebase's established no-HTTP-server route-testing pattern
// (see clinicSettings.test.ts, patient-reports.d8.test.ts): @workspace/db
// and @workspace/db/schema are mocked (the real db import throws at module
// load without DATABASE_URL), and the real Express handler is pulled off
// the Router's internal stack and invoked directly with a fake req/res.

let patientRow: Record<string, unknown> | undefined;
let radiologyStudyRow: Record<string, unknown> | undefined;
let fetalUsgStudyRow: Record<string, unknown> | undefined;
let allFetalUsgStudyRows: Record<string, unknown>[];
let allRadiologyStudyRows: Record<string, unknown>[];
let insertedFetalUsgStudyValues: Record<string, unknown> | undefined;
let insertedAuditLogValues: Record<string, unknown>[];

const TBL = {
  patients: { __name: "patients", id: "id" },
  radiologyStudies: { __name: "radiology_studies", id: "id", patientId: "patient_id", scheduledAt: "scheduled_at" },
  fetalUsgStudies: { __name: "fetal_usg_studies", id: "id", studyId: "study_id" },
  fetalUsgAuditLogs: { __name: "fetal_usg_audit_logs" },
  fetalUsgMeasurements: { __name: "fetal_usg_measurements" },
  fetalUsgChecklists: { __name: "fetal_usg_checklists" },
  fetalUsgReports: { __name: "fetal_usg_reports" },
  fetalUsgCriticalAlerts: { __name: "fetal_usg_critical_alerts" },
  fetalUsgTemplatePreferences: { __name: "fetal_usg_template_preferences" },
  clinicSettings: { __name: "clinic_settings" },
} as const;

vi.mock("@workspace/db/schema", () => ({
  fetalUsgStudiesTable: TBL.fetalUsgStudies,
  fetalUsgMeasurementsTable: TBL.fetalUsgMeasurements,
  fetalUsgChecklistsTable: TBL.fetalUsgChecklists,
  fetalUsgReportsTable: TBL.fetalUsgReports,
  fetalUsgAuditLogsTable: TBL.fetalUsgAuditLogs,
  fetalUsgCriticalAlertsTable: TBL.fetalUsgCriticalAlerts,
  fetalUsgTemplatePreferencesTable: TBL.fetalUsgTemplatePreferences,
  patientsTable: TBL.patients,
  clinicSettingsTable: TBL.clinicSettings,
  radiologyStudiesTable: TBL.radiologyStudies,
}));

vi.mock("@workspace/db", () => {
  const rowsFor = (tbl: { __name?: string }): Record<string, unknown>[] => {
    switch (tbl?.__name) {
      case "patients":
        return patientRow ? [patientRow] : [];
      case "radiology_studies":
        return allRadiologyStudyRows.length > 0 ? allRadiologyStudyRows : (radiologyStudyRow ? [radiologyStudyRow] : []);
      case "fetal_usg_studies":
        return fetalUsgStudyRow ? [fetalUsgStudyRow] : [];
      default:
        return [];
    }
  };
  return {
    db: {
      select: () => ({
        from: (tbl: { __name?: string }) => ({
          where: () => ({
            limit: async () => rowsFor(tbl),
            orderBy: () => rowsFor(tbl),
          }),
          // GET /available-studies/:patientId's "already linked" lookup has
          // no .where() before it — select({studyId}).from(fetalUsgStudiesTable)
          then: (resolve: (v: unknown) => void) => resolve(rowsFor(tbl)),
        }),
      }),
      insert: (tbl: { __name?: string }) => ({
        values: (v: Record<string, unknown>) => {
          if (tbl?.__name === "fetal_usg_studies") {
            insertedFetalUsgStudyValues = v;
            return {
              returning: async () => [{ id: 501, ...v }],
              catch: () => undefined,
            };
          }
          if (tbl?.__name === "fetal_usg_audit_logs") {
            insertedAuditLogValues.push(v);
          }
          return {
            returning: async () => [{ id: 1, ...v }],
            catch: () => undefined,
          };
        },
      }),
    },
  };
});

function getHandler(router: any, method: "get" | "post", path: string) {
  const matches = router.stack.filter(
    (l: any) => l.route && l.route.path === path && l.route.methods[method]
  );
  return matches;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  patientRow = undefined;
  radiologyStudyRow = undefined;
  fetalUsgStudyRow = undefined;
  allFetalUsgStudyRows = [];
  allRadiologyStudyRows = [];
  insertedFetalUsgStudyValues = undefined;
  insertedAuditLogValues = [];
});

describe("POST /api/fetal-usg/study — real patient/study context, never hardcoded", () => {
  test("rejects when patientId is missing", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/study");
    expect(matches.length).toBe(1);
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    const req = { body: { studyId: 7 } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/valid patientId is required/i);
    expect(insertedFetalUsgStudyValues).toBeUndefined();
  });

  test("rejects when studyId is missing", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/study");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    const req = { body: { patientId: 12 } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/valid studyId.*is required/i);
    expect(insertedFetalUsgStudyValues).toBeUndefined();
  });

  test("rejects when patientId does not resolve to a real patient", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/study");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    patientRow = undefined;
    const req = { body: { patientId: 999, studyId: 7 } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/No patient found with id 999/);
    expect(insertedFetalUsgStudyValues).toBeUndefined();
  });

  test("rejects when studyId does not resolve to a real radiology study", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/study");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    patientRow = { id: 12, firstName: "Jane", lastName: "Doe" };
    radiologyStudyRow = undefined;
    const req = { body: { patientId: 12, studyId: 999 } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/No radiology study found with id 999/);
    expect(insertedFetalUsgStudyValues).toBeUndefined();
  });

  test("rejects when the radiology study belongs to a different patient", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/study");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    patientRow = { id: 12, firstName: "Jane", lastName: "Doe" };
    radiologyStudyRow = { id: 7, patientId: 999, modality: "US" };
    const req = { body: { patientId: 12, studyId: 7 } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/belongs to a different patient/);
    expect(insertedFetalUsgStudyValues).toBeUndefined();
  });

  test("rejects when the selected study is not an ultrasound modality", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/study");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    patientRow = { id: 12, firstName: "Jane", lastName: "Doe" };
    radiologyStudyRow = { id: 7, patientId: 12, modality: "CT" };
    const req = { body: { patientId: 12, studyId: 7 } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not an ultrasound study/);
    expect(insertedFetalUsgStudyValues).toBeUndefined();
  });

  test("rejects when the selected study is already linked to a Fetal USG record", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/study");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    patientRow = { id: 12, firstName: "Jane", lastName: "Doe" };
    radiologyStudyRow = { id: 7, patientId: 12, modality: "US" };
    fetalUsgStudyRow = { id: 321, studyId: 7 };
    const req = { body: { patientId: 12, studyId: 7 } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/already has a Fetal USG record/);
    expect(res.body.existingFetalUsgStudyId).toBe(321);
    expect(insertedFetalUsgStudyValues).toBeUndefined();
  });

  test("REGRESSION: creates the study using the real selected patientId/studyId — never defaults to 1/1", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/study");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    patientRow = { id: 47, firstName: "Priya", lastName: "Sharma" };
    radiologyStudyRow = { id: 88, patientId: 47, modality: "USG" };
    fetalUsgStudyRow = undefined; // not already linked
    const req = { body: { patientId: 47, studyId: 88, studyType: "anomaly", trimester: "second" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(insertedFetalUsgStudyValues).toBeDefined();
    expect(insertedFetalUsgStudyValues!.patientId).toBe(47);
    expect(insertedFetalUsgStudyValues!.studyId).toBe(88);
    // The specific historical bug: these must never be hardcoded to 1.
    expect(insertedFetalUsgStudyValues!.patientId).not.toBe(1);
    expect(insertedFetalUsgStudyValues!.studyId).not.toBe(1);
    expect(insertedFetalUsgStudyValues!.calcVersion).toBe("v2");
    expect(res.body.study.patientId).toBe(47);
    expect(res.body.study.studyId).toBe(88);
  });
});

describe("GET /api/fetal-usg/available-studies/:patientId — real linkable studies, not a guess", () => {
  test("rejects an invalid patientId", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "get", "/available-studies/:patientId");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    const req = { params: { patientId: "not-a-number" } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test("404s when the patient does not exist", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "get", "/available-studies/:patientId");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    patientRow = undefined;
    const req = { params: { patientId: "47" } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  test("filters out non-ultrasound studies", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "get", "/available-studies/:patientId");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    patientRow = { id: 47, firstName: "Priya", lastName: "Sharma", patientId: "P-047" };
    allRadiologyStudyRows = [
      { id: 88, accessionNumber: "A1", studyDescription: "OB US", bodyPart: "Abdomen", status: "completed", scheduledAt: null, modality: "USG" },
      { id: 89, accessionNumber: "A2", studyDescription: "Chest CT", bodyPart: "Chest", status: "completed", scheduledAt: null, modality: "CT" },
    ];
    const req = { params: { patientId: "47" } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.studies.map((s: any) => s.id)).toEqual([88]);
  });
});

describe("POST /:studyId/extract-measurements — route duplication fixed", () => {
  test("only one handler is registered for this route (no dead duplicate)", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/:studyId/extract-measurements");
    expect(matches.length).toBe(1);
  });

  test("returns an honest not_implemented capability status, never implying extraction works", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/:studyId/extract-measurements");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    fetalUsgStudyRow = { id: 501, studyId: 88 };
    const req = { params: { studyId: "501" }, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      available: false,
      status: "not_implemented",
      message: "DICOM-SR extraction is not currently available for the Fetal USG module.",
      srInstanceUid: null,
    });
  });

  test("404s when the study does not exist", async () => {
    const { default: router } = await import("./fetalUsgLevel4");
    const matches = getHandler(router, "post", "/:studyId/extract-measurements");
    const handler = matches[0].route.stack[matches[0].route.stack.length - 1].handle;
    fetalUsgStudyRow = undefined;
    const req = { params: { studyId: "9999" }, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });
});

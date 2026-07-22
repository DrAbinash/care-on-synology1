/**
 * usgPacsReturnService.integration.test.ts — real-DB evidence for P6 fail-closed
 * report→PACS eligibility. Proves against actual Postgres:
 *   - a study with no signed report is ineligible (no_report);
 *   - a finalized non-obstetric report is eligible and gets encapsulated-PDF tags;
 *   - an obstetric study without Form F is blocked (pcpndt_not_compliant).
 *
 * DB-gated (dynamic imports); run with:
 *   DATABASE_URL=postgres://…/care_test pnpm exec vitest run <thisfile>
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("P6 PACS-return eligibility (real DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any, schema: any, eq: any, svc: any;
  let patientId: number, noReportStudy: number, finalStudy: number, obStudy: number;
  let finalReportId: number, obReportId: number;
  const stamp = Date.now();

  beforeAll(async () => {
    ({ db } = await import("@workspace/db"));
    schema = await import("@workspace/db/schema");
    ({ eq } = await import("drizzle-orm"));
    svc = await import("./usgPacsReturnService");

    const [p] = await db.insert(schema.patientsTable).values({
      patientId: `P6-${stamp}`, firstName: "Pacs", lastName: "Test",
      dateOfBirth: "1990-01-01", gender: "female", phone: "0000000000",
    }).returning();
    patientId = p.id;

    const mkStudy = async (uid: string, desc: string, acc: string) => {
      const [s] = await db.insert(schema.radiologyStudiesTable).values({
        accessionNumber: acc, patientId, testId: 1, modality: "US",
        studyInstanceUid: uid, studyDate: "2024-05-01", studyDescription: desc,
      }).returning();
      return s.id;
    };
    noReportStudy = await mkStudy(`1.2.p6.norep.${stamp}`, "USG Abdomen", `ACC-P6-NR-${stamp}`);
    finalStudy = await mkStudy(`1.2.p6.final.${stamp}`, "USG Abdomen", `ACC-P6-FN-${stamp}`);
    obStudy = await mkStudy(`1.2.p6.ob.${stamp}`, "OB Growth Scan", `ACC-P6-OB-${stamp}`);

    const mkReport = async (studyId: number, status: string, num: string) => {
      const [r] = await db.insert(schema.patientReportsTable).values({
        reportNumber: num, patientId, testId: 1, studyId, title: "USG", body: "report", status,
      }).returning();
      return r.id;
    };
    finalReportId = await mkReport(finalStudy, "verified", `RPT-P6-FN-${stamp}`);
    obReportId = await mkReport(obStudy, "verified", `RPT-P6-OB-${stamp}`);
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of [finalReportId, obReportId]) if (id) await db.delete(schema.patientReportsTable).where(eq(schema.patientReportsTable.id, id));
    for (const id of [noReportStudy, finalStudy, obStudy]) if (id) await db.delete(schema.radiologyStudiesTable).where(eq(schema.radiologyStudiesTable.id, id));
    if (patientId) {
      await db.delete(schema.formFRecordsTable).where(eq(schema.formFRecordsTable.patientId, patientId));
      await db.delete(schema.patientsTable).where(eq(schema.patientsTable.id, patientId));
    }
  });

  it("blocks a study with no signed report", async () => {
    const r = await svc.evaluateUsgPacsReturn(noReportStudy);
    expect(r.eligible).toBe(false);
    expect(r.blockReasons).toContain("no_report");
  });

  it("allows a finalized non-obstetric report and builds encapsulated-PDF tags", async () => {
    const r = await svc.evaluateUsgPacsReturn(finalStudy);
    expect(r.eligible).toBe(true);
    expect(r.tags.SOPClassUID).toBe("1.2.840.10008.5.1.4.1.1.104.1");
    expect(r.idempotencyKey).toContain(`:${finalReportId}:`);
  });

  it("blocks an obstetric study with no Form F (fail-closed)", async () => {
    const r = await svc.evaluateUsgPacsReturn(obStudy);
    expect(r.eligible).toBe(false);
    expect(r.blockReasons).toContain("pcpndt_not_compliant");
  });
});

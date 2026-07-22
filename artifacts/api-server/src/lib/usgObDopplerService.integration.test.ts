/**
 * usgObDopplerService.integration.test.ts — real-DB evidence for P5 OB/Doppler
 * wiring. Proves against actual Postgres + canonical tables:
 *   - buildObSectionForStudy builds a canonical OB section from measurements
 *     and NEVER emits fetal sex;
 *   - buildDopplerSectionForStudy computes RI/S-D from source velocities;
 *   - formFStatusForStudy is fail-closed for an obstetric study with no Form F.
 *
 * DB-gated (dynamic imports); run with:
 *   DATABASE_URL=postgres://…/care_test pnpm exec vitest run <thisfile>
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("P5 OB/Doppler service (real DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any, schema: any, eq: any, svc: any;
  let patientId: number, obStudyId: number, dopplerStudyId: number;
  const stamp = Date.now();
  const obUid = `1.2.p5.ob.${stamp}`;
  const dopUid = `1.2.p5.dop.${stamp}`;

  beforeAll(async () => {
    ({ db } = await import("@workspace/db"));
    schema = await import("@workspace/db/schema");
    ({ eq } = await import("drizzle-orm"));
    svc = await import("./usgObDopplerService");

    const [p] = await db.insert(schema.patientsTable).values({
      patientId: `P5-${stamp}`, firstName: "Ob", lastName: "Test",
      dateOfBirth: "1992-01-01", gender: "female", phone: "0000000000",
    }).returning();
    patientId = p.id;

    const mkStudy = async (uid: string, desc: string, acc: string) => {
      const [s] = await db.insert(schema.radiologyStudiesTable).values({
        accessionNumber: acc, patientId, testId: 1, modality: "US",
        studyInstanceUid: uid, studyDate: "2024-05-01", studyDescription: desc,
      }).returning();
      return s.id;
    };
    obStudyId = await mkStudy(obUid, "OB Growth Scan", `ACC-P5-OB-${stamp}`);
    dopplerStudyId = await mkStudy(dopUid, "Obstetric Doppler", `ACC-P5-DOP-${stamp}`);

    await db.insert(schema.usgMeasurementsTable).values({
      studyInstanceUID: obUid, patientId, studyDate: "2024-05-01", status: "approved",
      bpd: "70", hc: "250", ac: "230", fl: "50", efw: "1400", liquorAfi: "14", fhr: "148",
      placentaPosition: "Anterior", fetalPresentation: "Cephalic",
    });
    await db.insert(schema.usgDopplerMeasurementsTable).values([
      { studyInstanceUID: dopUid, patientId, vesselName: "Umbilical artery", side: "midline", psv: "40 cm/s", edv: "10 cm/s", status: "approved" },
      { studyInstanceUID: dopUid, patientId, vesselName: "Umbilical artery", side: "midline", psv: "35 cm/s", edv: "0 cm/s", status: "approved" },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.usgMeasurementsTable).where(eq(schema.usgMeasurementsTable.studyInstanceUID, obUid));
    await db.delete(schema.usgDopplerMeasurementsTable).where(eq(schema.usgDopplerMeasurementsTable.studyInstanceUID, dopUid));
    for (const id of [obStudyId, dopplerStudyId]) if (id) await db.delete(schema.radiologyStudiesTable).where(eq(schema.radiologyStudiesTable.id, id));
    if (patientId) await db.delete(schema.patientsTable).where(eq(schema.patientsTable.id, patientId));
  });

  it("builds a canonical OB section with EFW/AFI and never emits fetal sex", async () => {
    const r = await svc.buildObSectionForStudy(obStudyId);
    expect("section" in r).toBe(true);
    expect(r.computed.efwGrams).not.toBeNull();
    expect(r.computed.afiCm).toBe(14);
    expect(r.impression.join(" ")).toMatch(/single live intrauterine gestation/i);
    const blob = `${r.section.text} ${r.impression.join(" ")}`.toLowerCase();
    expect(blob).not.toMatch(/\b(male|female|boy|girl|sex|gender)\b/);
    expect(r.measurementSource).toBe("approved");
  });

  it("builds a Doppler section computing RI/S-D from source velocities and flagging absent EDF", async () => {
    const r = await svc.buildDopplerSectionForStudy(dopplerStudyId);
    expect(r.vesselCount).toBe(2);
    const withFlow = r.vessels[0];
    expect(withFlow.ri).toBeCloseTo(0.75, 2);   // (40-10)/40
    expect(withFlow.sdRatio).toBeCloseTo(4, 2);
    const absent = r.vessels[1];
    expect(absent.flags.join(" ")).toMatch(/absent end-diastolic flow/i);
    // Descriptive only — no autonomous diagnosis.
    expect(`${r.section.text} ${r.impression.join(" ")}`.toLowerCase()).not.toMatch(/\biugr\b|distress/);
  });

  it("reports Form-F NOT compliant (fail-closed) for an obstetric study with no Form F", async () => {
    const s = await svc.formFStatusForStudy(obStudyId);
    expect(s.applicable).toBe(true);
    expect(s.compliant).toBe(false);
    expect(s.errors.length).toBeGreaterThan(0);
  });
});

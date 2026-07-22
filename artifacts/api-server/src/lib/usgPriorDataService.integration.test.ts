/**
 * usgPriorDataService.integration.test.ts — real-DB evidence for P4 prior
 * intelligence wiring. Proves against actual Postgres + canonical tables:
 *   - findPriorStudies returns same-patient priors and NEVER another patient's;
 *   - compareStudies produces structured current-vs-prior deltas;
 *   - compareStudies hard-blocks a cross-patient pair;
 *   - pregnancyTimelineForPatient builds a timeline from OB measurement rows.
 *
 * DB-gated (dynamic imports); run with:
 *   DATABASE_URL=postgres://…/care_test pnpm exec vitest run <thisfile>
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("P4 prior-data service (real DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any, schema: any, eq: any, svc: any;
  let patientA: number, patientB: number;
  let priorStudyId: number, currentStudyId: number, otherPatientStudyId: number;
  const stamp = Date.now();
  const uidPrior = `1.2.p4.prior.${stamp}`;
  const uidCurrent = `1.2.p4.current.${stamp}`;
  const uidOther = `1.2.p4.other.${stamp}`;

  beforeAll(async () => {
    ({ db } = await import("@workspace/db"));
    schema = await import("@workspace/db/schema");
    ({ eq } = await import("drizzle-orm"));
    svc = await import("./usgPriorDataService");

    const mkPatient = async (tag: string) => {
      const [p] = await db.insert(schema.patientsTable).values({
        patientId: `P4-${tag}-${stamp}`, firstName: tag, lastName: "Test",
        dateOfBirth: "1990-01-01", gender: "female", phone: "0000000000",
      }).returning();
      return p.id;
    };
    patientA = await mkPatient("A");
    patientB = await mkPatient("B");

    const mkStudy = async (patientId: number, uid: string, date: string, acc: string) => {
      const [s] = await db.insert(schema.radiologyStudiesTable).values({
        accessionNumber: acc, patientId, testId: 1, modality: "US",
        studyInstanceUid: uid, studyDate: date, studyDescription: "OB Growth Scan",
      }).returning();
      return s.id;
    };
    priorStudyId = await mkStudy(patientA, uidPrior, "2024-03-01", `ACC-P4-PRIOR-${stamp}`);
    currentStudyId = await mkStudy(patientA, uidCurrent, "2024-05-01", `ACC-P4-CUR-${stamp}`);
    otherPatientStudyId = await mkStudy(patientB, uidOther, "2024-04-01", `ACC-P4-OTH-${stamp}`);

    const mkMeas = async (patientId: number, uid: string, date: string, m: Record<string, string>) => {
      await db.insert(schema.usgMeasurementsTable).values({
        studyInstanceUID: uid, patientId, studyDate: date, status: "approved", ...m,
      });
    };
    // Prior smaller than current → growth.
    await mkMeas(patientA, uidPrior, "2024-03-01", { bpd: "45", hc: "170", ac: "150", fl: "30", efw: "600", liquorAfi: "12" });
    await mkMeas(patientA, uidCurrent, "2024-05-01", { bpd: "70", hc: "250", ac: "230", fl: "50", efw: "1400", liquorAfi: "14" });
    await mkMeas(patientB, uidOther, "2024-04-01", { bpd: "55", hc: "200", ac: "180", fl: "38", efw: "900", liquorAfi: "10" });
  });

  afterAll(async () => {
    if (!db) return;
    for (const uid of [uidPrior, uidCurrent, uidOther]) {
      await db.delete(schema.usgMeasurementsTable).where(eq(schema.usgMeasurementsTable.studyInstanceUID, uid));
    }
    for (const id of [priorStudyId, currentStudyId, otherPatientStudyId]) {
      if (id) await db.delete(schema.radiologyStudiesTable).where(eq(schema.radiologyStudiesTable.id, id));
    }
    for (const id of [patientA, patientB]) {
      if (id) await db.delete(schema.patientsTable).where(eq(schema.patientsTable.id, id));
    }
  });

  it("finds same-patient priors and excludes other patients", async () => {
    const priors = await svc.findPriorStudies(currentStudyId);
    const ids = priors.map((p: { studyId: number | null }) => p.studyId);
    expect(ids).toContain(priorStudyId);
    expect(ids).not.toContain(otherPatientStudyId);
  });

  it("produces structured current-vs-prior deltas (growth → increased)", async () => {
    const result = await svc.compareStudies(currentStudyId, priorStudyId);
    expect("rows" in result).toBe(true);
    const bpd = result.rows.find((r: { key: string }) => r.key === "bpd");
    expect(bpd.direction).toBe("increased");
    expect(result.intervalDays).toBe(61);
    // Editable suggestions cite the values and never assert clinical progression.
    const text = result.suggestions.map((s: { text: string }) => s.text).join(" ");
    expect(text).toMatch(/BPD/);
    expect(text).not.toMatch(/worsen|IUGR|distress/i);
  });

  it("hard-blocks a cross-patient comparison", async () => {
    const result = await svc.compareStudies(currentStudyId, otherPatientStudyId);
    expect(result.error).toBe("cross_patient_comparison_blocked");
  });

  it("builds a pregnancy timeline from the patient's OB measurement rows", async () => {
    const { timeline, episodes } = await svc.pregnancyTimelineForPatient(patientA);
    expect(timeline.points.length).toBe(2);
    const efw = timeline.trends.find((t: { key: string }) => t.key === "efwGrams");
    expect(efw.points.length).toBe(2);
    expect(efw.points[1].value).toBeGreaterThan(efw.points[0].value);
    expect(episodes.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Request-level: POST /api/report-quality/evaluate must feed the wrong-patient
 * rules (Q109 sex-vs-anatomy, Q110 age-vs-wording) from the CANONICAL patient
 * record, never from whatever the caller put in `text`.
 *
 * WHY THIS IS A REQUEST TEST AND NOT A SOURCE GREP
 * ------------------------------------------------
 * The precedence only exists at runtime. A caller-supplied `sex: "M"` on a
 * female patient's report is precisely the value that silences Q109 — so the
 * detector for a wrong-patient report can be switched off by the very mistake
 * it exists to catch. Asserting that the string "resolveDraftDemography"
 * appears in the route cannot prove the override happens; only executing it can.
 *
 * Q109/Q110 are also the engine's only two rules that need patient demography,
 * so this file is the whole proof that demography reaches safety logic.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  patientsTable,
  radiologyWorklistTable,
  radiologyReportDraftsTable,
  reportQualityEvaluationsTable,
  reportQualityFindingsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("report-quality /evaluate — canonical demography beats caller text", () => {
  let app: Express;
  const marker = `rqdemo-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;

  let userId = 0;
  let patientMaleId = 0;
  let patientFemaleId = 0;
  let patientFreeTextId = 0;
  const worklistIds: number[] = [];
  const draftIds: number[] = [];

  /** Draft whose worklist says FEMALE while its patient master says MALE. */
  let draftConflictId = 0;
  /** Draft whose worklist carries no sex, so the patient master (female) is the only source. */
  let draftMasterOnlyId = 0;
  /** Draft whose patient master stores free text ("Mrs"), which is not a DICOM sex code. */
  let draftFreeTextId = 0;
  /** Draft whose worklist carries a pediatric DICOM age. */
  let draftChildId = 0;

  async function insertWorklist(sex: string | null, age: string | null, patientId: number | null) {
    const [w] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Demography Probe ${marker}`,
        modality: "MR",
        status: "STUDY_RECEIVED",
        studyDescription: `MRI PELVIS ${marker}`,
        studyDate: "20261003",
        accessionNumber: `ACC-RQD-${marker}-${worklistIds.length}`,
        studyInstanceUID: `1.2.840.rqd.${marker}.${worklistIds.length}`,
        sex,
        age,
        patientId,
        patientMatchStatus: patientId != null ? "MATCHED" : "UNMATCHED",
      })
      .returning();
    worklistIds.push(w.id);
    return w.id;
  }

  async function insertDraft(worklistId: number, patientId: number | null) {
    const [d] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        worklistId,
        patientId,
        modality: "MRI",
        studyName: `MRI PELVIS ${marker}`,
        status: "DRAFT",
        createdBy: marker,
      })
      .returning();
    draftIds.push(d.id);
    return d.id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Quality Demography ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    const [male] = await db
      .insert(patientsTable)
      .values({
        patientId: `${marker}-m`,
        firstName: "Probe",
        lastName: `Male ${marker}`,
        dateOfBirth: "1981-01-01",
        gender: "male",
        phone: "0000000000",
        ageValue: 45,
        ageUnit: "Yrs",
      })
      .returning();
    patientMaleId = male.id;

    const [female] = await db
      .insert(patientsTable)
      .values({
        patientId: `${marker}-f`,
        firstName: "Probe",
        lastName: `Female ${marker}`,
        dateOfBirth: "1956-01-01",
        gender: "female",
        phone: "0000000000",
        ageValue: 70,
        ageUnit: "Yrs",
      })
      .returning();
    patientFemaleId = female.id;

    // A real ERP free-text gender that starts with "M" but is not a sex code.
    const [freeText] = await db
      .insert(patientsTable)
      .values({
        patientId: `${marker}-t`,
        firstName: "Probe",
        lastName: `FreeText ${marker}`,
        dateOfBirth: "1996-01-01",
        gender: "Mrs",
        phone: "0000000000",
        ageValue: 30,
        ageUnit: "Yrs",
      })
      .returning();
    patientFreeTextId = freeText.id;

    draftConflictId = await insertDraft(await insertWorklist("F", "045Y", patientMaleId), patientMaleId);
    draftMasterOnlyId = await insertDraft(await insertWorklist(null, null, patientFemaleId), patientFemaleId);
    draftFreeTextId = await insertDraft(await insertWorklist(null, null, patientFreeTextId), patientFreeTextId);
    draftChildId = await insertDraft(await insertWorklist("M", "007Y", null), null);
  });

  afterAll(async () => {
    // Every evaluation this file caused carries `source: marker`, including the
    // ones posted with no draft, so the marker — not the draft id — is the scope.
    const evals = await db
      .select({ id: reportQualityEvaluationsTable.id })
      .from(reportQualityEvaluationsTable)
      .where(eq(reportQualityEvaluationsTable.source, marker));
    const evalIds = evals.map((e) => e.id);
    if (evalIds.length) {
      await db.delete(reportQualityFindingsTable).where(inArray(reportQualityFindingsTable.evaluationId, evalIds));
    }
    await db.delete(reportQualityEvaluationsTable).where(eq(reportQualityEvaluationsTable.source, marker));
    for (const id of draftIds) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id));
    }
    for (const id of worklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    }
    for (const id of [patientMaleId, patientFemaleId, patientFreeTextId]) {
      if (id) await db.delete(patientsTable).where(eq(patientsTable.id, id));
    }
    if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  async function evaluate(text: Record<string, unknown>, reportDraftId?: number) {
    const res = await request(app)
      .post("/api/report-quality/evaluate")
      .set("Authorization", `Bearer ${token}`)
      .send({ source: marker, modality: "MRI", studyType: "MRI PELVIS", reportDraftId, text })
      .expect(201);
    const findings = (res.body.findings ?? []) as Array<{ ruleId: string }>;
    return findings.map((f) => f.ruleId);
  }

  it("a caller-supplied sex that would silence Q109 loses to the DICOM record", async () => {
    // The caller asserts MALE for a patient the worklist records as FEMALE, and
    // the prose describes male anatomy. Trusting the caller would make this
    // report look internally consistent and the contradiction would vanish.
    const ids = await evaluate(
      {
        findings: "The prostate gland is normal in size. No focal lesion.",
        impression: ["Normal study."],
        technique: "T2 weighted sequences.",
        clinicalHistory: "Pelvic pain.",
        sex: "M",
      },
      draftConflictId,
    );
    expect(ids).toContain("Q109");
  });

  it("the same text with no draft keeps the caller's sex — control for the test above", async () => {
    // Proves the previous test passes because of the canonical override and not
    // because Q109 fires unconditionally on the word "prostate".
    const ids = await evaluate({
      findings: "The prostate gland is normal in size. No focal lesion.",
      impression: ["Normal study."],
      technique: "T2 weighted sequences.",
      clinicalHistory: "Pelvic pain.",
      sex: "M",
    });
    expect(ids).not.toContain("Q109");
  });

  it("DICOM worklist sex wins over a contradicting patient-master gender", async () => {
    // Worklist says F, the linked patient master says "male". Female anatomy in
    // the prose contradicts only the worklist value, so Q109 firing proves the
    // DICOM record took precedence over the ERP master.
    const ids = await evaluate(
      {
        findings: "The uterus is normal in size and signal.",
        impression: ["Normal study."],
        technique: "T2 weighted sequences.",
        clinicalHistory: "Pelvic pain.",
      },
      draftConflictId,
    );
    expect(ids).toContain("Q109");
  });

  it("falls back to the patient master when the worklist row carries no DICOM sex", async () => {
    const ids = await evaluate(
      {
        findings: "The prostate gland is normal in size. No focal lesion.",
        impression: ["Normal study."],
        technique: "T2 weighted sequences.",
        clinicalHistory: "Pelvic pain.",
      },
      draftMasterOnlyId,
    );
    expect(ids).toContain("Q109");
  });

  it("never reads a free-text gender as a sex code", async () => {
    // The patient master stores "Mrs" — a woman. Passed through raw, "MRS"
    // starts with "M" and Q109 would raise a gender contradiction against
    // female anatomy that is in fact entirely correct for this patient.
    const ids = await evaluate(
      {
        findings: "The uterus and both ovaries are unremarkable.",
        impression: ["Normal study."],
        technique: "T2 weighted sequences.",
        clinicalHistory: "Pelvic pain.",
      },
      draftFreeTextId,
    );
    expect(ids).not.toContain("Q109");
  });

  it("the record's pediatric age beats a caller-supplied adult age for Q110", async () => {
    const ids = await evaluate(
      {
        findings: "Degenerative changes are noted at the visualized levels.",
        impression: ["Spondylosis."],
        technique: "T2 weighted sequences.",
        clinicalHistory: "Back pain.",
        age: "045Y",
      },
      draftChildId,
    );
    expect(ids).toContain("Q110");
  });

  it("the same adult age with no draft leaves Q110 silent — control for the test above", async () => {
    const ids = await evaluate({
      findings: "Degenerative changes are noted at the visualized levels.",
      impression: ["Spondylosis."],
      technique: "T2 weighted sequences.",
      clinicalHistory: "Back pain.",
      age: "045Y",
    });
    expect(ids).not.toContain("Q110");
  });

  it("Q102 needs the impression as separate points, not one joined string", async () => {
    const asPoints = await evaluate({
      findings: "Moderate canal stenosis at L4-L5.",
      impression: ["Moderate canal stenosis.", "Moderate canal stenosis."],
      technique: "T2 weighted sequences.",
      clinicalHistory: "Back pain.",
    });
    expect(asPoints).toContain("Q102");

    const asOneString = await evaluate({
      findings: "Moderate canal stenosis at L4-L5.",
      impression: ["Moderate canal stenosis.\nModerate canal stenosis."],
      technique: "T2 weighted sequences.",
      clinicalHistory: "Back pain.",
    });
    expect(asOneString).not.toContain("Q102");
  });
});

/**
 * Per-source patient identity for `COMBINE` — request-level tests.
 *
 * The defect this closes: a combination merges a SECOND report's findings into
 * the study being reported, and until now the only thing saying that report
 * belonged to this patient was the browser's own account. `additionalReports`
 * carried free text plus a label, and CARE checked neither. A stale tab, a wrong
 * row in a prior-study list, or a mislabelled paste therefore put another
 * patient's findings into this patient's report — invisible to the clinical
 * validators, which check that every fact survived, not whose fact it was.
 *
 * Like `composeIdentity.request.test.ts`, nothing here mocks an id and asks
 * whether the same id came back. Every case forges a reference and asserts what
 * the server resolved, against REAL rows: two patients, three billed studies,
 * four worklist rows, two signed reports.
 *
 * Two enforcement points are tested separately, because they fail differently:
 * `POST /jobs` refuses before a job exists, and `processComposeJob` re-checks
 * before a prompt is built — which is what makes an identity refusal something
 * the model cannot argue past, and the only thing standing between an
 * already-queued combination and a Match Center re-link that happened while it
 * waited.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  patientReportsTable,
  patientsTable,
  portalSessionsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import {
  verifyComposeSourceIdentities,
  type ComposeSourceIdentityCode,
} from "./composeIdentity";
import type { ComposerInputSnapshot, ComposerReportSource } from "./types";

const marker = `vitest-src-${randomUUID().slice(0, 8)}`;
const uid = (tag: string) => `1.2.826.vitest.source.${marker}.${tag}`;

function combineSnapshot(
  worklistId: number | null,
  findings: string,
  additionalReports: ComposerReportSource[],
  jobKind = "COMBINE",
): ComposerInputSnapshot {
  return {
    worklistId,
    studyId: null,
    reportId: null,
    modality: "MR",
    region: "LS_SPINE",
    studyType: "MRI LS Spine",
    clinicalHistory: "Low back pain",
    technique: "Multiplanar MRI lumbar spine",
    findings,
    impression: "",
    recommendation: "",
    observations: [],
    templateSections: [],
    jobKindHint: jobKind,
    aiMode: "TEXT_ONLY",
    additionalReports,
  } as ComposerInputSnapshot;
}

async function makeStaff(label: string, role: string, permissions: string[]) {
  const token = `vitest-token-${randomUUID()}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      name: `Vitest ${label} ${marker}`,
      email: `${marker}.${label}@vitest.invalid`,
      username: `${marker}.${label}`,
      role,
      permissions: JSON.stringify(permissions),
      pin: "0000",
      isActive: true,
    })
    .returning();
  await db
    .insert(portalSessionsTable)
    .values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });
  return { token, userId: user.id as number };
}

describe.skipIf(!hasDatabaseUrl())("Composer COMBINE source patient identity", () => {
  let app: Express;
  let radiologist: { token: string; userId: number };
  let admin: { token: string; userId: number };

  const jobIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const reportIds: number[] = [];
  const patientIds: number[] = [];
  const draftIds: number[] = [];
  const userIds: number[] = [];

  let pA = 0;
  let pB = 0;
  let stA = 0;
  let stA2 = 0;
  let stB = 0;
  /** The study being reported on — the anchor. */
  let wlA = 0;
  /** Patient A's OTHER study: the legitimate thing to combine in. */
  let wlA2 = 0;
  /** Patient B's study — the mismatch. */
  let wlB = 0;
  /** A DICOM study nobody has linked to a patient yet. */
  let wlNoPatient = 0;
  /** A study that claims a report of record which does not exist. */
  let wlDangling = 0;
  /** A worklist row for Patient A whose billed study belongs to Patient B. */
  let wlSplit = 0;
  let rptA2 = 0; // signed report of record for wlA2
  let rptB = 0; // signed report of record for wlB
  let rptNoStudy = 0; // Patient A's report with no study link at all

  beforeAll(async () => {
    app = await createTestApp();
    // Every /api/radiology/* request passes requireStaffPermission("/radiology")
    // before the composer's own canUse(), so a clinician needs both.
    radiologist = await makeStaff("Radiologist", "radiologist", ["/radiology", "ai_reporting.use"]);
    admin = await makeStaff("Admin", "admin", ["/radiology", "ai_reporting.use", "ai_reporting.configure"]);
    userIds.push(radiologist.userId, admin.userId);

    const patient = async (n: string) => {
      const [row] = await db
        .insert(patientsTable)
        .values({
          patientId: `MRN-${marker}-${n}`,
          firstName: "Synthetic",
          lastName: n,
          dateOfBirth: "1970-01-01",
          gender: "F",
          phone: "0000000000",
        })
        .returning();
      patientIds.push(row.id);
      return row.id as number;
    };
    pA = await patient("A");
    pB = await patient("B");

    const billedStudy = async (patientId: number, n: string) => {
      const [row] = await db
        .insert(radiologyStudiesTable)
        .values({
          accessionNumber: `ACC-${marker}-${n}`,
          patientId,
          testId: 1,
          modality: "MR",
          department: "MRI",
          status: "acquired",
          studyInstanceUid: uid(n),
        })
        .returning();
      studyIds.push(row.id);
      return row.id as number;
    };
    stA = await billedStudy(pA, "a");
    stA2 = await billedStudy(pA, "a2");
    stB = await billedStudy(pB, "b");

    const worklist = async (opts: {
      tag: string;
      patientId: number | null;
      studyId: number | null;
      status?: string;
      reportId?: number | null;
    }) => {
      const [row] = await db
        .insert(radiologyWorklistTable)
        .values({
          patientName: `Synthetic ${opts.tag}`,
          modality: "MR",
          studyDescription: "MRI Cervical Spine",
          studyInstanceUID: uid(opts.tag),
          accessionNumber: `ACC-${marker}-${opts.tag}`,
          patientId: opts.patientId,
          studyId: opts.studyId,
          patientMatchStatus: opts.patientId ? "MATCHED" : "UNMATCHED",
          status: opts.status ?? "STUDY_RECEIVED",
          reportId: opts.reportId ?? null,
        })
        .returning();
      worklistIds.push(row.id);
      return row.id as number;
    };
    wlA = await worklist({ tag: "anchor", patientId: pA, studyId: stA });
    wlB = await worklist({ tag: "other", patientId: pB, studyId: stB });
    wlNoPatient = await worklist({ tag: "unmatched", patientId: null, studyId: null });
    wlDangling = await worklist({
      tag: "dangling",
      patientId: pA,
      studyId: null,
      reportId: 9_500_000 + (parseInt(randomUUID().replace(/[^0-9]/g, "").slice(0, 5), 10) % 1_000_000),
    });
    wlSplit = await worklist({ tag: "split", patientId: pA, studyId: stB });

    const report = async (opts: {
      tag: string;
      patientId: number;
      studyId: number | null;
      status: string;
    }) => {
      const [row] = await db
        .insert(patientReportsTable)
        .values({
          reportNumber: `RPT-${marker}-${opts.tag}`,
          type: "radiology",
          patientId: opts.patientId,
          testId: 1,
          // Canonical radiology finalize stores the WORKLIST row id here.
          studyId: opts.studyId,
          title: "MRI Cervical Spine",
          body: `Synthetic cervical findings ${opts.tag}`,
          impression: `Synthetic cervical impression ${opts.tag}`,
          status: opts.status,
        })
        .returning();
      reportIds.push(row.id);
      return row.id as number;
    };
    rptA2 = await report({ tag: "a2", patientId: pA, studyId: null, status: "signed" });
    rptB = await report({ tag: "b", patientId: pB, studyId: wlB, status: "signed" });
    rptNoStudy = await report({ tag: "nostudy", patientId: pA, studyId: null, status: "signed" });
    // Patient A's second study, signed, with the report of record linked back —
    // the ordinary clinical shape of "add my earlier cervical report".
    wlA2 = await worklist({ tag: "a2", patientId: pA, studyId: stA2, status: "REPORT_FINAL", reportId: rptA2 });
    await db
      .update(patientReportsTable)
      .set({ studyId: wlA2 })
      .where(eq(patientReportsTable.id, rptA2));

    // A workspace draft behind the anchor, so enqueue's persistence baseline
    // resolves the way it does in the product.
    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({ studyId: wlA, worklistId: wlA, patientId: pA, modality: "MR", status: "DRAFT" })
      .returning();
    draftIds.push(draft.id);
  });

  afterAll(async () => {
    if (jobIds.length) await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, jobIds));
    if (draftIds.length) await db.delete(radiologyReportDraftsTable).where(inArray(radiologyReportDraftsTable.id, draftIds));
    if (worklistIds.length) await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, worklistIds));
    if (reportIds.length) await db.delete(patientReportsTable).where(inArray(patientReportsTable.id, reportIds));
    if (studyIds.length) await db.delete(radiologyStudiesTable).where(inArray(radiologyStudiesTable.id, studyIds));
    if (patientIds.length) await db.delete(patientsTable).where(inArray(patientsTable.id, patientIds));
    if (userIds.length) {
      await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.subjectId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  const enqueue = (snapshot: ComposerInputSnapshot, jobKind = "COMBINE") =>
    request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${radiologist.token}`)
      .send({ snapshot, jobKind });

  async function jobCountFor(worklistId: number): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.worklistId, worklistId));
    return Number(row?.n ?? 0);
  }

  async function trackJob(id: number) {
    jobIds.push(id);
    const [row] = await db
      .select()
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.id, id))
      .limit(1);
    return row;
  }

  /** A refusal that works must leave nothing behind, or "nothing was sent to the
   * AI" is a sentence the message tells rather than the code proves. */
  async function expectRefused(worklistId: number, snapshot: ComposerInputSnapshot, code: string) {
    const before = await jobCountFor(worklistId);
    const res = await enqueue(snapshot);
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.error).toBe("string");
    expect(await jobCountFor(worklistId)).toBe(before);
    return res;
  }

  const source = (over: Partial<ComposerReportSource> = {}): ComposerReportSource => ({
    label: "MRI Cervical Spine, same patient",
    modality: "MR",
    region: "Cervical Spine",
    findings: "Loss of cervical lordosis. Left C5-C6 foraminal protrusion.",
    impression: "Left C6 root contact.",
    worklistId: wlA2,
    ...over,
  });

  // ── positive: a merge CARE can prove ─────────────────────────────────────
  it("1. combines a study that resolves to the anchor's patient", async () => {
    const res = await enqueue(
      combineSnapshot(wlA, `Source 1: L4-5 diffuse disc bulge, AP canal 8.2 mm. ${marker}`, [source()]),
    );
    expect(res.status).toBe(202);
    const row = await trackJob(res.body.jobId as number);
    expect(row.status).toBe("QUEUED");
    expect(row.jobKind).toBe("COMBINE");
  });

  it("2. resolves the source from its report of record alone", async () => {
    const res = await enqueue(
      combineSnapshot(wlA, `Source 2: facet hypertrophy L5-S1. ${marker}`, [
        source({ worklistId: undefined, reportId: rptA2 }),
      ]),
    );
    expect(res.status).toBe(202);
    await trackJob(res.body.jobId as number);
  });

  it("3. accepts two references that describe one study, and refuses two that do not", async () => {
    const agreed = await enqueue(
      combineSnapshot(wlA, `Source 3a: both references agree. ${marker}`, [
        source({ worklistId: wlA2, reportId: rptA2 }),
      ]),
    );
    expect(agreed.status).toBe(202);
    await trackJob(agreed.body.jobId as number);

    // Patient B's signed report presented as the study CARE should read, beside
    // Patient A's cervical worklist row: the rows themselves contradict.
    await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 3b: references contradict. ${marker}`, [
        source({ worklistId: wlA2, reportId: rptB }),
      ]),
      "compose_source_conflict",
    );
  });

  it("4. keeps every source study identifier CARE resolved", async () => {
    const verified = await verifyComposeSourceIdentities({
      anchor: { worklistId: wlA, patientId: pA },
      sources: [source({ studyInstanceUid: uid("a2") })],
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.sources).toHaveLength(1);
    const s = verified.sources[0]!;
    expect(s.worklistId).toBe(wlA2);
    expect(s.studyId).toBe(stA2);
    expect(s.reportId).toBe(rptA2);
    expect(s.reportNumber).toBe(`RPT-${marker}-a2`);
    expect(s.patientId).toBe(pA);
    expect(s.studyInstanceUID).toBe(uid("a2"));
    expect(s.modality).toBe("MR");
    expect(s.worklistStatus).toBe("REPORT_FINAL");
    expect(s.signed).toBe(true);
    expect(s.position).toBe(0);
    // The typed caption is carried for display and is not what any check read.
    expect(s.label).toBe("MRI Cervical Spine, same patient");
  });

  it("4b. a signed report with no study row still verifies on its own patient", async () => {
    const verified = await verifyComposeSourceIdentities({
      anchor: { worklistId: wlA, patientId: pA },
      sources: [source({ worklistId: undefined, reportId: rptNoStudy })],
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.sources[0]!.worklistId).toBeNull();
    expect(verified.sources[0]!.patientId).toBe(pA);
    expect(verified.sources[0]!.signed).toBe(true);
  });

  it("4c. an empty source list is not an identity question", async () => {
    const verified = await verifyComposeSourceIdentities({
      anchor: { worklistId: wlA, patientId: null },
      sources: [],
    });
    expect(verified).toEqual({ ok: true, sources: [] });
  });

  it("4d. refuses a study whose own report of record is missing", async () => {
    // The row says "this study is reported" and there is no report behind it, so
    // CARE cannot say what it is combining — that is a contradiction between the
    // source's own rows, not a source that happens to have no report.
    const verified = await verifyComposeSourceIdentities({
      anchor: { worklistId: wlA, patientId: pA },
      sources: [source({ worklistId: wlDangling })],
    });
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.code).toBe("compose_source_conflict");
  });

  it("4e. refuses a source whose worklist row and billed study name different patients", async () => {
    // Neither reference is wrong, and neither is the anchor's patient — the two
    // rows CARE has for THIS one source disagree with each other. Checking only
    // "does the reference match the anchor" would wave a study through whose own
    // records cannot say whose it is. This is the same rule
    // `bindRadiologyReportIdentity` enforces as STUDY_PATIENT_MISMATCH.
    const verified = await verifyComposeSourceIdentities({
      anchor: { worklistId: wlA, patientId: pA },
      sources: [source({ worklistId: wlSplit })],
    });
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.code).toBe("compose_source_conflict");

    await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 4e: the source's own rows disagree. ${marker}`, [
        source({ worklistId: wlSplit }),
      ]),
      "compose_source_conflict",
    );
  });

  // ── negative: every way the identity can fail ────────────────────────────
  it("5. refuses a source that names no CARE study, however well it is labelled", async () => {
    // The label is the thing a name-only check would have accepted: it says
    // "same patient", it is free text, and it proves nothing.
    await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 5: pasted outside report. ${marker}`, [
        source({ worklistId: undefined, label: "MRI Cervical Spine — same patient, outside clinic" }),
      ]),
      "compose_source_unidentified",
    );
  });

  it("6. refuses a source that belongs to another patient", async () => {
    const res = await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 6: another patient's study. ${marker}`, [source({ worklistId: wlB })]),
      "compose_source_patient_mismatch",
    );
    // The sentence is safe to read on a shared screen: no name, no MRN, no UID.
    expect(res.body.error).not.toContain(marker);
    expect(res.body.error).not.toContain(uid("other"));
  });

  it("7. refuses a source whose study is not linked to a patient", async () => {
    await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 7: unmatched DICOM study. ${marker}`, [
        source({ worklistId: wlNoPatient }),
      ]),
      "compose_source_unmatched",
    );
  });

  it("8. refuses when the study being reported has no patient to compare against", async () => {
    await expectRefused(
      wlNoPatient,
      combineSnapshot(wlNoPatient, `Source 8: unmatched anchor. ${marker}`, [source()]),
      "compose_source_anchor_unverified",
    );
  });

  it("9. refuses a reference that names a row which is gone", async () => {
    const missing = 9_000_000 + (parseInt(randomUUID().replace(/[^0-9]/g, "").slice(0, 5), 10) % 1_000_000);
    await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 9: missing worklist row. ${marker}`, [source({ worklistId: missing })]),
      "compose_source_not_found",
    );
    await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 9b: missing report row. ${marker}`, [
        source({ worklistId: undefined, reportId: missing }),
      ]),
      "compose_source_not_found",
    );
  });

  it("10. refuses a declared StudyInstanceUID that the row does not carry", async () => {
    await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 10: wrong DICOM UID declared. ${marker}`, [
        source({ studyInstanceUid: uid("other") }),
      ]),
      "compose_source_uid_conflict",
    );
  });

  it("11. refuses the whole request on the first bad source and says which one", async () => {
    const res = await expectRefused(
      wlA,
      combineSnapshot(wlA, `Source 11: one good, one bad. ${marker}`, [
        source({ worklistId: wlA2, reportId: rptA2 }),
        source({ worklistId: wlB }),
      ]),
      "compose_source_patient_mismatch",
    );
    expect(res.body.error).toContain("(report 2 of 2)");
  });

  it("12. gates every kind that carries sources, not only COMBINE", async () => {
    // A professionalise request with a second report attached is the same
    // unverified text in front of the same model; the gate is on the payload.
    const before = await jobCountFor(wlA);
    const res = await enqueue(
      combineSnapshot(
        wlA,
        `Source 12: professionalize carrying a source. ${marker}`,
        [source({ worklistId: undefined })],
        "PROFESSIONALIZE",
      ),
      "PROFESSIONALIZE",
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_source_unidentified");
    expect(await jobCountFor(wlA)).toBe(before);
  });

  it("13. leaves a sourceless job of every kind exactly as it was", async () => {
    for (const kind of ["COMBINE", "PROFESSIONALIZE", "FULL_REPORT"] as const) {
      const res = await enqueue(combineSnapshot(wlA, `Source 13: no sources, ${kind}. ${marker}`, [], kind), kind);
      expect(res.status).toBe(202);
      await trackJob(res.body.jobId as number);
    }
  });

  // ── the worker's re-check, which is what the AI cannot get past ──────────
  it("14. a source re-linked to another patient while the job queued is refused before any prompt is built", async () => {
    const enq = await enqueue(
      combineSnapshot(wlA, `Source 14: re-linked while queued. ${marker}`, [source()]),
    );
    expect(enq.status).toBe(202);
    const jobId = enq.body.jobId as number;
    const row = await trackJob(jobId);
    expect(row.status).toBe("QUEUED");

    // Match Center moves the study — the clinical event the frozen snapshot was
    // never able to see, because the snapshot froze the TEXT, not whose it was.
    await db
      .update(radiologyWorklistTable)
      .set({ patientId: pB })
      .where(eq(radiologyWorklistTable.id, wlA2));
    await db
      .update(patientReportsTable)
      .set({ patientId: pB })
      .where(eq(patientReportsTable.id, rptA2));

    const proc = await request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/process-now`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});
    expect(proc.status).toBe(200);
    const after = await trackJob(jobId);
    expect(after.status).toBe("FAILED");
    expect(after.safeError).toBe("compose_source_patient_mismatch");
    expect(proc.body.detail).toBe("compose_source_patient_mismatch");
    // The refusal is the last thing the job recorded: a provider/model error here
    // would mean a prompt had already been built from the now-mismatched report.
    expect(after.model).toBeNull();
    expect(after.latencyMs).toBeNull();
    expect(JSON.parse(String(after.validationJson)).sourceIdentity.refused).toBe(
      "compose_source_patient_mismatch",
    );

    // Put the link back for the suites that share this database.
    await db
      .update(radiologyWorklistTable)
      .set({ patientId: pA })
      .where(eq(radiologyWorklistTable.id, wlA2));
    await db
      .update(patientReportsTable)
      .set({ patientId: pA })
      .where(eq(patientReportsTable.id, rptA2));
  });

  it("15. a job queued by a build that pre-dates the gate is refused at composition", async () => {
    // The upgrade path: rows already in `ai_report_compose_jobs` carry sources
    // with no identity on them. Nothing can honour them, and nothing should.
    const [inserted] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        studyId: stA,
        worklistId: wlA,
        reportId: null,
        jobKind: "COMBINE",
        status: "QUEUED",
        sourceReportRevision: "legacy",
        sourceFindingsHash: "legacy",
        sourceImpressionHash: "legacy",
        sourceRecommendationHash: "legacy",
        inputHash: "legacy",
        inputSnapshotJson: JSON.stringify(
          combineSnapshot(wlA, `Source 15: legacy row, no identity. ${marker}`, [
            { label: "outside cervical report", findings: "C5-C6 disc bulge.", impression: "" },
          ]),
        ),
      })
      .returning();
    const row = await trackJob(inserted.id);
    expect(row.status).toBe("QUEUED");

    const proc = await request(app)
      .post(`/api/radiology/report-composer/jobs/${inserted.id}/process-now`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});
    expect(proc.status).toBe(200);
    const after = await trackJob(inserted.id);
    expect(after.status).toBe("FAILED");
    expect(after.safeError).toBe("compose_source_unidentified");
    expect(after.model).toBeNull();
  });

  it("16. an anchor signed while its combination queued is refused, not composed into", async () => {
    const enq = await enqueue(
      combineSnapshot(wlA, `Source 16: anchor signed while queued. ${marker}`, [source()]),
    );
    expect(enq.status).toBe(202);
    const jobId = enq.body.jobId as number;
    await trackJob(jobId);

    const [signed] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-late`,
        type: "radiology",
        patientId: pA,
        testId: 1,
        studyId: wlA,
        title: "MRI LS Spine",
        body: "Signed elsewhere while this draft waited.",
        impression: "",
        status: "signed",
      })
      .returning();
    reportIds.push(signed.id);
    await db
      .update(radiologyWorklistTable)
      .set({ status: "REPORT_FINAL", reportId: signed.id })
      .where(eq(radiologyWorklistTable.id, wlA));

    const proc = await request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/process-now`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});
    expect(proc.status).toBe(200);
    expect(proc.body.detail).toBe("compose_locked");

    // Restore the anchor so the cases after this one still have a study to report.
    await db
      .update(radiologyWorklistTable)
      .set({ status: "STUDY_RECEIVED", reportId: null })
      .where(eq(radiologyWorklistTable.id, wlA));
    await db.delete(patientReportsTable).where(eq(patientReportsTable.id, signed.id));
    reportIds.splice(reportIds.indexOf(signed.id), 1);
  });

  // ── the signed source is read, never written ─────────────────────────────
  it("17. combining a signed report leaves that report and its study untouched", async () => {
    const before = await db
      .select()
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, rptA2))
      .limit(1);
    const wlBefore = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, wlA2))
      .limit(1);

    const enq = await enqueue(
      combineSnapshot(wlA, `Source 17: merge a signed report. ${marker}`, [
        source({ worklistId: wlA2, reportId: rptA2 }),
      ]),
    );
    expect(enq.status).toBe(202);
    const jobId = enq.body.jobId as number;
    await trackJob(jobId);
    await request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/process-now`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});

    const after = await db
      .select()
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, rptA2))
      .limit(1);
    expect(after[0]).toEqual(before[0]);
    const wlAfter = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, wlA2))
      .limit(1);
    // `aiComposeStatus` / `aiComposeJobId` are the composer's own write onto a
    // study. They must stay untouched on a source: the job belongs to the anchor.
    expect(wlAfter[0]).toEqual(wlBefore[0]);
  });

  it("17b. the draft that comes back carries the source identities CARE resolved", async () => {
    // A merged report that cannot say which study each half came from is not
    // reviewable, so the resolved identifiers travel with the draft. They live in
    // `validation_json` — the JSON this service already writes and `publicJobView`
    // already returns — because `ai_report_compose_jobs` gains no column here.
    //
    // This case runs on the deterministic fallback (no model is configured in a
    // test environment), so the merge has to be one the clinical-conservation
    // guard accepts: the source report's facts all appear in the draft, which for
    // a no-model answer means the study being reported already restates them.
    // With a real model the same write happens with a merged narrative — the
    // harness in `mriRealModel.live.test.ts` is where that variant is measured.
    const cervical = "Loss of cervical lordosis. Left C5-C6 foraminal disc protrusion.";
    const snapshot = {
      ...combineSnapshot(wlA, `Source 17b: ${cervical} L4-L5 diffuse disc bulge. ${marker}`, [
        source({
          worklistId: wlA2,
          reportId: rptA2,
          studyInstanceUid: uid("a2"),
          findings: cervical,
          impression: "Left C6 root contact.",
        }),
      ]),
      impression: "Left C6 root contact.",
    } as ComposerInputSnapshot;

    const enq = await enqueue(snapshot);
    expect(enq.status).toBe(202);
    const jobId = enq.body.jobId as number;
    const proc = await request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/process-now`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});
    expect(proc.status).toBe(200);
    const row = await trackJob(jobId);
    expect({ status: row.status, safeError: row.safeError }).toEqual({ status: "READY", safeError: null });
    const identities = (proc.body.job?.validation as { sourceIdentities?: unknown[] })?.sourceIdentities;
    expect(identities).toHaveLength(1);
    expect(identities?.[0]).toMatchObject({
      position: 0,
      worklistId: wlA2,
      studyId: stA2,
      reportId: rptA2,
      patientId: pA,
      studyInstanceUID: uid("a2"),
      signed: true,
    });
  });

  it("18. every refusal is a refusal, not a warning beside a draft", async () => {
    // A guard that only warns is the defect this line of work exists to remove.
    // Each code must be the whole of the response, with no job and no draft
    // attached — otherwise the workspace has a READY proposal anyway and the
    // clinician decides the identity question by hand.
    const cases: Array<{
      code: ComposeSourceIdentityCode;
      anchor: number;
      over: Partial<ComposerReportSource>;
    }> = [
      { code: "compose_source_unidentified", anchor: wlA, over: { worklistId: undefined } },
      { code: "compose_source_unmatched", anchor: wlA, over: { worklistId: wlNoPatient } },
      { code: "compose_source_not_found", anchor: wlA, over: { worklistId: 9_999_999 } },
      { code: "compose_source_conflict", anchor: wlA, over: { worklistId: wlA2, reportId: rptB } },
      { code: "compose_source_patient_mismatch", anchor: wlA, over: { worklistId: wlB } },
      { code: "compose_source_uid_conflict", anchor: wlA, over: { studyInstanceUid: uid("other") } },
      // The one refusal about the study being reported rather than the one being
      // added, so it needs an anchor with no patient linked.
      { code: "compose_source_anchor_unverified", anchor: wlNoPatient, over: {} },
    ];
    for (const c of cases) {
      const res = await expectRefused(
        c.anchor,
        combineSnapshot(c.anchor, `Source 18: ${c.code}. ${marker}`, [source(c.over)]),
        c.code,
      );
      expect(res.body.draft).toBeUndefined();
      expect(res.body.jobId).toBeUndefined();
      // One sentence per code, owned by composeIdentity.ts, so the route and the
      // workspace cannot drift into three descriptions of the same rejection.
      expect(res.body.error.length).toBeGreaterThan(40);
    }
  });
});

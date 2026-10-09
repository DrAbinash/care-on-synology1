/**
 * Server-verified study identity for Composer jobs — request-level tests.
 *
 * These run the REAL route (`createTestApp` mounts routes/index, so
 * requireStaffAuth → the composer's own gate executes) against REAL Postgres
 * rows: two patients, two billed studies, three worklist rows, two reports.
 * Nothing here mocks an id and asks whether the same id came back — the whole
 * point of the change is that a browser-declared id is a reference to look up,
 * so every case forges a reference and asserts what the server resolved.
 *
 * The failure this suite exists to prevent, in one sentence: a radiologist
 * opens Patient A, generates an AI draft, switches to Patient B, and the draft
 * is applied to Patient B's report.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { computeSnapshotHashes } from "./snapshot";
import type { ComposerInputSnapshot } from "./types";

const marker = `vitest-id-${randomUUID().slice(0, 8)}`;
const uid = (tag: string) => `1.2.826.vitest.identity.${marker}.${tag}`;

/** Snapshot builder. `findings` is unique per case so the partial-unique
 * idempotency index never silently dedupes two different cases into one job. */
function snapshotOf(opts: {
  worklistId: number | null;
  studyId: number | null;
  reportId?: number | null;
  findings: string;
  observations?: ComposerInputSnapshot["observations"];
  instruction?: string;
  selectionText?: string;
}): ComposerInputSnapshot {
  return {
    worklistId: opts.worklistId,
    studyId: opts.studyId,
    reportId: opts.reportId ?? null,
    modality: "MR",
    region: "LS_SPINE",
    studyType: "MRI LS Spine",
    clinicalHistory: "Low back pain",
    technique: "Multiplanar MRI lumbar spine",
    findings: opts.findings,
    impression: "",
    recommendation: "",
    observations: opts.observations ?? [],
    jobKindHint: "FULL_REPORT",
    aiMode: "TEXT_ONLY",
    ...(opts.instruction ? { instruction: opts.instruction } : {}),
    ...(opts.selectionText ? { selectionText: opts.selectionText } : {}),
  } as ComposerInputSnapshot;
}

async function makeStaff(label: string, role: string, permissions: string[]) {  const token = `vitest-token-${randomUUID()}`;
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
  return { token, userId: user.id as number, name: user.name as string };
}

describe.skipIf(!hasDatabaseUrl())("Composer server-verified study identity", () => {
  let app: Express;
  let radiologist: { token: string; userId: number; name: string };
  let secondReader: { token: string; userId: number; name: string };
  let unauthorized: { token: string; userId: number; name: string };

  const jobIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const reportIds: number[] = [];
  const patientIds: number[] = [];
  const draftIds: number[] = [];
  const userIds: number[] = [];

  // Two patients, each with a billed study and a worklist row. A THIRD worklist
  // row belongs to patient 1 as well — it is what proves "same patient,
  // different study" is refused, not just "different patient".
  let p1 = 0;
  let p2 = 0;
  let st1 = 0;
  let st2 = 0;
  let st3 = 0;
  let wl1 = 0; // Patient A's study (the draft's origin)
  let wl2 = 0; // Patient B's study (the attack target)
  let wl3 = 0; // Patient A's OTHER study
  let wl4 = 0; // a finalized study (signed report, REPORT_FINAL)
  let rpt1 = 0; // report of record for wl1
  let rpt2 = 0; // report of record for wl2 — another patient's report
  let rpt4 = 0; // signed report for wl4
  // Engineered id collision: stCollideA is a real billed study whose number is
  // also the primary key of wlCollide (Patient A's worklist row, whose real
  // billed study is stCollideB).
  let stCollideA = 0;
  let stCollideB = 0;
  let wlCollide = 0;
  let admin: { token: string; userId: number; name: string };

  beforeAll(async () => {
    app = await createTestApp();
    // A clinician who can reach the composer at all needs BOTH gates:
    // requireStaffPermission("/radiology") — every /api/radiology/* request runs
    // it, because pacsEnterpriseRouter is mounted at "/radiology" (index.ts:761)
    // long before the composer's own mount (index.ts:1064) — and the composer's
    // internal canUse(), which accepts a full-access role or "ai_reporting.use".
    radiologist = await makeStaff("Radiologist", "radiologist", ["/radiology", "ai_reporting.use"]);
    secondReader = await makeStaff("SecondReader", "radiologist", ["/radiology", "ai_reporting.use"]);
    unauthorized = await makeStaff("Cashier", "reception", []);
    // process-now is admin-only by design, so the generation case needs one.
    admin = await makeStaff("Admin", "admin", ["/radiology", "ai_reporting.use", "ai_reporting.configure"]);
    userIds.push(radiologist.userId, secondReader.userId, unauthorized.userId, admin.userId);

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
    p1 = await patient("A");
    p2 = await patient("B");

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
    st1 = await billedStudy(p1, "1");
    st2 = await billedStudy(p2, "2");
    st3 = await billedStudy(p1, "3");

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
          studyDescription: "MRI LS Spine",
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
    wl1 = await worklist({ tag: "1", patientId: p1, studyId: st1 });
    wl2 = await worklist({ tag: "2", patientId: p2, studyId: st2 });
    wl3 = await worklist({ tag: "3", patientId: p1, studyId: st3 });

    const report = async (opts: { tag: string; patientId: number; studyId: number; status: string }) => {
      const [row] = await db
        .insert(patientReportsTable)
        .values({
          reportNumber: `RPT-${marker}-${opts.tag}`,
          type: "radiology",
          patientId: opts.patientId,
          testId: 1,
          // Canonical finalize stores the WORKLIST row id here.
          studyId: opts.studyId,
          title: "MRI LS Spine",
          body: `Synthetic findings ${opts.tag}`,
          impression: `Synthetic impression ${opts.tag}`,
          status: opts.status,
        })
        .returning();
      reportIds.push(row.id);
      return row.id as number;
    };
    rpt1 = await report({ tag: "1", patientId: p1, studyId: wl1, status: "draft" });
    rpt2 = await report({ tag: "2", patientId: p2, studyId: wl2, status: "draft" });

    // A study whose report has already been signed and linked back.
    rpt4 = await report({ tag: "4", patientId: p1, studyId: 0, status: "signed" });
    wl4 = await worklist({ tag: "4", patientId: p1, studyId: st1, status: "REPORT_FINAL", reportId: rpt4 });
    await db
      .update(patientReportsTable)
      .set({ studyId: wl4 })
      .where(eq(patientReportsTable.id, rpt4));

    // A workspace draft behind Patient A's study, consistent with the row.
    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({ studyId: wl1, worklistId: wl1, patientId: p1, modality: "MR", status: "DRAFT" })
      .returning();
    draftIds.push(draft.id);

    // Engineered id collision, built from explicit high ids so it holds on any
    // database: one number is simultaneously Patient B's billed study and
    // Patient A's worklist row, and that worklist's real billed study is a
    // different row.
    const collideId = 900_000 + (parseInt(randomUUID().replace(/[^0-9]/g, "").slice(0, 5), 10) % 100_000);
    const [ca] = await db
      .insert(radiologyStudiesTable)
      .values({
        id: collideId,
        accessionNumber: `ACC-${marker}-collide-a`,
        patientId: p2,
        testId: 1,
        modality: "MR",
        department: "MRI",
        status: "acquired",
      })
      .returning();
    stCollideA = ca.id;
    studyIds.push(stCollideA);
    const [cb] = await db
      .insert(radiologyStudiesTable)
      .values({
        id: collideId + 1,
        accessionNumber: `ACC-${marker}-collide-b`,
        patientId: p1,
        testId: 1,
        modality: "MR",
        department: "MRI",
        status: "acquired",
      })
      .returning();
    stCollideB = cb.id;
    studyIds.push(stCollideB);
    const [wc] = await db
      .insert(radiologyWorklistTable)
      .values({
        id: collideId,
        patientName: "Synthetic Collide",
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: uid("collide"),
        accessionNumber: `ACC-${marker}-collide-wl`,
        patientId: p1,
        studyId: stCollideB,
        patientMatchStatus: "MATCHED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    wlCollide = wc.id;
    worklistIds.push(wlCollide);
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

  /** Seed a READY job the way enqueueComposeJob would, with a reviewable change. */
  async function seedReadyJob(opts: {
    worklistId: number | null;
    studyId: number | null;
    reportId?: number | null;
    findings: string;
    status?: string;
  }) {
    const snapshot = snapshotOf({
      worklistId: opts.worklistId,
      studyId: opts.studyId,
      reportId: opts.reportId ?? null,
      findings: opts.findings,
    });
    const hashes = computeSnapshotHashes(snapshot);
    const [row] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        studyId: opts.studyId,
        worklistId: opts.worklistId,
        reportId: opts.reportId ?? null,
        jobKind: "FULL_REPORT",
        status: (opts.status ?? "READY") as "READY",
        sourceReportRevision: hashes.reportRevision,
        sourceFindingsHash: hashes.findingsHash,
        sourceImpressionHash: hashes.impressionHash,
        sourceRecommendationHash: hashes.recommendationHash,
        inputHash: hashes.inputHash,
        inputSnapshotJson: JSON.stringify(snapshot),
        trackedChangesJson: JSON.stringify([
          {
            id: "c1",
            source: "AI_COMPOSER",
            changeType: "REPLACE",
            field: "FINDINGS",
            originalText: opts.findings,
            proposedText: `${opts.findings} (AI)`,
            reviewState: "ACCEPTED",
            clinicalSignificance: false,
            clinicalSignificanceReasons: [],
            createdAt: new Date().toISOString(),
          },
        ]),
        proposedFindings: `${opts.findings} (AI)`,
        priority: 40,
      })
      .returning();
    jobIds.push(row.id);
    return { id: row.id as number, hashes };
  }

  const postApply = (jobId: number, token: string, body: Record<string, unknown>) =>
    request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/applied`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  const enqueue = (token: string, snapshot: ComposerInputSnapshot, jobKind = "FULL_REPORT") =>
    request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ snapshot, jobKind });

  async function jobRow(id: number) {
    const [row] = await db
      .select()
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.id, id))
      .limit(1);
    return row;
  }

  // ── 1 ────────────────────────────────────────────────────────────────────
  it("1. a job bound to a study applies into that same study", async () => {
    const { id, hashes } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      reportId: rpt1,
      findings: "Identity 1: L4-5 diffuse disc bulge.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      reportRevision: hashes.reportRevision,
      inputHash: hashes.inputHash,
      findingsHash: hashes.findingsHash,
      impressionHash: hashes.impressionHash,
      recommendationHash: hashes.recommendationHash,
      target: { worklistId: wl1, studyId: st1, reportId: rpt1 },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("APPLIED");
    expect(row.appliedByStaffId).not.toBeNull();
  });

  it("1b. a studyId whose number is BOTH this worklist's primary key and another patient's billed study is refused", async () => {
    // Engineered, not stumbled into: `radiology_studies.id` and
    // `radiology_worklist.id` are independent sequences, so one number can name
    // both, and agreement must be settled by looking the number up rather than
    // by trusting which field it arrived in. Here study #COLLIDE_A belongs to
    // Patient B and is also the primary key of Patient A's worklist row, whose
    // real billed study is #COLLIDE_B.
    const { id } = await seedReadyJob({
      worklistId: wlCollide,
      studyId: stCollideB,
      findings: "Identity 1b: engineered numeric collision.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wlCollide, studyId: stCollideA },
    });
    expect(stCollideA).toBe(wlCollide);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_study_conflict");

    // The correct reference — and omitting the optional one entirely — both pass.
    const correct = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wlCollide, studyId: stCollideB },
    });
    expect(correct.status).toBe(200);
    const omitted = await seedReadyJob({
      worklistId: wlCollide,
      studyId: stCollideB,
      findings: "Identity 1c: no optional study reference.",
    });
    const noStudy = await postApply(omitted.id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wlCollide },
    });
    expect(noStudy.status).toBe(200);
  });

  // ── 2, 3 ─────────────────────────────────────────────────────────────────
  it("2. a Patient A draft applied to Patient B is refused and changes nothing", async () => {
    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 2: disc desiccation L3-4.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wl2, studyId: st2 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_job_cross_study");
    expect(res.body.message).toBe(
      "This AI draft belongs to another study. It cannot be applied to the current report.",
    );
    const row = await jobRow(id);
    expect(row.status).toBe("READY");
    expect(row.appliedAt).toBeNull();
    // Patient B's study is untouched — no AI status was written onto it.
    const [w2] = await db
      .select({ aiComposeStatus: radiologyWorklistTable.aiComposeStatus })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, wl2))
      .limit(1);
    expect(w2.aiComposeStatus).toBe("NONE");
  });

  it("3. same patient, different study is refused (patient equality alone is not the gate)", async () => {
    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 3: facet hypertrophy L4-5.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      // wl3 is Patient A's OTHER study — same patient, different examination.
      target: { worklistId: wl3, studyId: st3 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_job_cross_study");
  });

  // ── 4, 8 ─────────────────────────────────────────────────────────────────
  it("4. same study, wrong report is refused", async () => {
    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      reportId: rpt1,
      findings: "Identity 4: canal stenosis at L4-5.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      // Names Patient A's worklist but Patient B's report row.
      target: { worklistId: wl1, studyId: st1, reportId: rpt2 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_report_conflict");
    expect((await jobRow(id)).status).toBe("READY");
  });

  it("8. a forged reportId is refused at enqueue, and a legacy job naming a foreign report is refused at apply", async () => {
    const enq = await enqueue(
      radiologist.token,
      snapshotOf({
        worklistId: wl1,
        studyId: st1,
        reportId: 99_999_999,
        findings: "Identity 8: forged report reference.",
      }),
    );
    expect(enq.status).toBe(400);
    expect(enq.body.code).toBe("compose_report_conflict");

    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      reportId: rpt2, // another patient's report, written by an older build
      findings: "Identity 8b: job whose report belongs elsewhere.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wl1, studyId: st1 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_job_report_conflict");
  });

  // ── 5, 6, 7 ──────────────────────────────────────────────────────────────
  it("5. an invalid worklistId is refused on both sides", async () => {
    const enq = await enqueue(
      radiologist.token,
      snapshotOf({
        worklistId: 99_999_999,
        studyId: null,
        findings: "Identity 5: nonexistent worklist row.",
      }),
    );
    expect(enq.status).toBe(400);
    expect(enq.body.code).toBe("compose_worklist_not_found");

    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 5b: apply into a study that is not in the worklist.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: 99_999_999 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_worklist_not_found");
  });

  it("6. a mismatched studyId/worklistId pair is refused at enqueue", async () => {
    // Patient A's worklist row, Patient B's billed study — the two references
    // name different studies, so nothing can be composed "for this study".
    const enq = await enqueue(
      radiologist.token,
      snapshotOf({
        worklistId: wl1,
        studyId: st2,
        findings: "Identity 6: study/worklist contradiction.",
      }),
    );
    expect(enq.status).toBe(400);
    expect(enq.body.code).toBe("compose_study_conflict");
  });

  it("7. a forged studyId at Apply is refused", async () => {
    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 7: forged study reference at apply.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wl1, studyId: st2 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_study_conflict");
  });

  // ── 9 ────────────────────────────────────────────────────────────────────
  it("9. a clinician without AI reporting permission is refused on both endpoints", async () => {
    const enq = await enqueue(
      unauthorized.token,
      snapshotOf({ worklistId: wl1, studyId: st1, findings: "Identity 9: unauthorized enqueue." }),
    );
    expect(enq.status).toBe(403);

    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 9b: unauthorized apply.",
    });
    const res = await postApply(id, unauthorized.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wl1, studyId: st1 },
    });
    expect(res.status).toBe(403);
    expect((await jobRow(id)).status).toBe("READY");
  });

  it("9c. another permitted reader may apply the same-study draft, but not while the study is locked to someone else", async () => {
    // There is no per-study radiology ACL in this system — POST /save-draft does
    // not have one either — so the identity gate is study + patient + report, and
    // the row-level control available is the existing active write lock. This
    // test pins exactly that boundary rather than pretending to a stronger one.
    const open = await seedReadyJob({
      worklistId: wl3,
      studyId: st3,
      findings: "Identity 9c: second reader, unlocked study.",
    });
    const allowed = await postApply(open.id, secondReader.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wl3, studyId: st3 },
    });
    expect(allowed.status).toBe(200);

    await db
      .update(radiologyWorklistTable)
      .set({
        lockUserId: unauthorized.userId,
        lockUserName: unauthorized.name,
        lockTime: new Date(),
        lockLastActivityAt: new Date(),
      })
      .where(eq(radiologyWorklistTable.id, wl1));
    try {
      const locked = await seedReadyJob({
        worklistId: wl1,
        studyId: st1,
        findings: "Identity 9d: study locked by another user.",
      });
      const res = await postApply(locked.id, radiologist.token, {
        acceptedChangeIds: ["c1"],
        target: { worklistId: wl1, studyId: st1 },
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("compose_locked_by_other");
      expect((await jobRow(locked.id)).status).toBe("READY");
    } finally {
      await db
        .update(radiologyWorklistTable)
        .set({ lockUserId: null, lockUserName: null, lockTime: null, lockLastActivityAt: null })
        .where(eq(radiologyWorklistTable.id, wl1));
    }
  });

  // ── 10 ───────────────────────────────────────────────────────────────────
  it("10. missing study identity fails closed instead of defaulting to something", async () => {
    const enq = await enqueue(
      radiologist.token,
      snapshotOf({ worklistId: null, studyId: null, findings: "Identity 10: no study named." }),
    );
    expect(enq.status).toBe(400);
    expect(enq.body.code).toBe("compose_worklist_required");

    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 10b: apply with no target.",
    });
    const noTarget = await postApply(id, radiologist.token, { acceptedChangeIds: ["c1"] });
    expect(noTarget.status).toBe(409);
    expect(noTarget.body.code).toBe("compose_target_required");
    const emptyTarget = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: {},
    });
    expect(emptyTarget.status).toBe(409);
    expect(emptyTarget.body.code).toBe("compose_target_required");

    // A job row that never carried a worklist (pre-change data) cannot be applied
    // either — "unbound" is refused, not honoured.
    const unbound = await seedReadyJob({
      worklistId: null,
      studyId: null,
      findings: "Identity 10c: legacy job with no binding.",
    });
    const res = await postApply(unbound.id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wl1, studyId: st1 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_job_unbound");
  });

  // ── 11 ───────────────────────────────────────────────────────────────────
  it("11. a finalized target report refuses both composing and applying", async () => {
    const enq = await enqueue(
      radiologist.token,
      snapshotOf({ worklistId: wl4, studyId: st1, reportId: rpt4, findings: "Identity 11: compose a signed study." }),
    );
    expect(enq.status).toBe(409);
    expect(enq.body.code).toBe("compose_locked");

    // The bypass this closes: the browser simply omits reportId, so the old
    // persisted check had nothing to look up and reported "not finalized".
    const omitted = await enqueue(
      radiologist.token,
      snapshotOf({ worklistId: wl4, studyId: st1, findings: "Identity 11b: signed study, reportId omitted." }),
    );
    expect(omitted.status).toBe(409);
    expect(omitted.body.code).toBe("compose_locked");

    const { id } = await seedReadyJob({
      worklistId: wl4,
      studyId: st1,
      reportId: rpt4,
      findings: "Identity 11c: apply into a study signed after the draft.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wl4, studyId: st1 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("compose_locked");
    expect((await jobRow(id)).status).toBe("READY");
  });

  // ── 12, 13, 16 ───────────────────────────────────────────────────────────
  it("12. a cancelled job cannot be applied", async () => {
    const { id } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 12: cancelled job.",
      status: "CANCELLED",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wl1, studyId: st1 },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_ready");
  });

  it("13. a stale report revision is still refused for a correctly bound study", async () => {
    const { id, hashes } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 13: stale revision on the right study.",
    });
    const res = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      reportRevision: "0".repeat(32),
      findingsHash: hashes.findingsHash,
      impressionHash: hashes.impressionHash,
      recommendationHash: hashes.recommendationHash,
      inputHash: hashes.inputHash,
      target: { worklistId: wl1, studyId: st1 },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("stale_ready");
    expect((await jobRow(id)).status).toBe("STALE_READY");
  });

  it("16. replaying an already-applied job is refused", async () => {
    const { id, hashes } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 16: replay after apply.",
    });
    const body = {
      acceptedChangeIds: ["c1"],
      reportRevision: hashes.reportRevision,
      inputHash: hashes.inputHash,
      findingsHash: hashes.findingsHash,
      impressionHash: hashes.impressionHash,
      recommendationHash: hashes.recommendationHash,
      target: { worklistId: wl1, studyId: st1 },
    };
    expect((await postApply(id, radiologist.token, body)).status).toBe(200);
    const again = await postApply(id, radiologist.token, body);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("not_ready");
  });

  // ── 14 ───────────────────────────────────────────────────────────────────
  it("14. concurrent Apply requests leave exactly one applied", async () => {
    const { id, hashes } = await seedReadyJob({
      worklistId: wl3,
      studyId: st3,
      findings: "Identity 14: concurrent double apply.",
    });
    const body = {
      acceptedChangeIds: ["c1"],
      reportRevision: hashes.reportRevision,
      inputHash: hashes.inputHash,
      findingsHash: hashes.findingsHash,
      impressionHash: hashes.impressionHash,
      recommendationHash: hashes.recommendationHash,
      target: { worklistId: wl3, studyId: st3 },
    };
    const tokens = [radiologist.token, secondReader.token, radiologist.token, secondReader.token];
    const results = await Promise.all(tokens.map((t) => postApply(id, t, body)));
    const ok = results.filter((r) => r.status === 200);
    const refused = results.filter((r) => r.status === 409);
    // One apply, ever.
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(3);
    for (const r of refused) {
      expect(["already_applied", "not_ready"]).toContain(String(r.body.code ?? r.body.error));
    }
    // The status column is the durable record of the transition, so the loser
    // that read READY before the winner wrote it must have been refused by the
    // conditional update rather than by its own earlier read.
    expect(refused.some((r) => r.body.code === "already_applied")).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("APPLIED");
  });

  // ── 15 ───────────────────────────────────────────────────────────────────
  it("15. a stale tab cannot discover another study's draft through /latest", async () => {
    await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 15: draft that belongs to Patient A only.",
    });
    const asB = await request(app)
      .get(`/api/radiology/report-composer/latest?worklistId=${wl2}`)
      .set("Authorization", `Bearer ${radiologist.token}`);
    expect(asB.status).toBe(200);
    expect(asB.body.job).toBeNull();

    const asA = await request(app)
      .get(`/api/radiology/report-composer/latest?worklistId=${wl1}`)
      .set("Authorization", `Bearer ${radiologist.token}`);
    expect(asA.body.job?.worklistId ?? null).not.toBe(wl2);
  });

  // ── 17, 19 ───────────────────────────────────────────────────────────────
  it("17. the existing tracked review is preserved and its accepted change lands", async () => {
    const { id, hashes } = await seedReadyJob({
      worklistId: wl1,
      studyId: st1,
      findings: "Identity 17: review then apply.",
    });
    const accept = await request(app)
      .post(`/api/radiology/report-composer/jobs/${id}/changes/c1/accept`)
      .set("Authorization", `Bearer ${radiologist.token}`)
      .send({});
    expect(accept.status).toBe(200);
    expect(accept.body.ok).toBe(true);
    expect(accept.body.changes?.[0]?.reviewState).toBe("ACCEPTED");

    const fresh = await request(app)
      .post(`/api/radiology/report-composer/jobs/${id}/freshness`)
      .set("Authorization", `Bearer ${radiologist.token}`)
      .send({
        findings: "Identity 17: review then apply.",
        impression: "",
        recommendation: "",
        reportRevision: hashes.reportRevision,
        inputHash: hashes.inputHash,
      });
    expect(fresh.status).toBe(200);
    expect(fresh.body.stale).toBe(false);

    const applied = await postApply(id, radiologist.token, {
      acceptedChangeIds: ["c1"],
      reportRevision: hashes.reportRevision,
      inputHash: hashes.inputHash,
      findingsHash: hashes.findingsHash,
      impressionHash: hashes.impressionHash,
      recommendationHash: hashes.recommendationHash,
      target: { worklistId: wl1, studyId: st1 },
    });
    expect(applied.status).toBe(200);
  });

  // ── 18, 21 ───────────────────────────────────────────────────────────────
  it("18. composition for a verified study is unaffected, and the job carries the RESOLVED ids", async () => {
    const enq = await enqueue(
      radiologist.token,
      snapshotOf({
        // The workspace sends the route param as worklistId and the billed id
        // as studyId; worklistId also happens to be a valid billed-study id for
        // another study, which is exactly the overload this resolves against.
        worklistId: wl1,
        studyId: st1,
        reportId: rpt1,
        findings: "Identity 18: ordinary compose path.",
      }),
    );
    expect(enq.status).toBe(202);
    const jobId = enq.body.jobId as number;
    jobIds.push(jobId);
    const row = await jobRow(jobId);
    expect(row.status).toBe("QUEUED");
    expect(row.worklistId).toBe(wl1);
    expect(row.studyId).toBe(st1);
    expect(row.reportId).toBe(rpt1);

    // The frozen clinical snapshot is untouched by identity verification:
    // re-hashing what was stored reproduces the stored inputHash exactly.
    const stored = JSON.parse(row.inputSnapshotJson) as ComposerInputSnapshot;
    expect(computeSnapshotHashes(stored).inputHash).toBe(row.inputHash);
    expect(stored.findings).toBe("Identity 18: ordinary compose path.");

    // And the worker does not fail on identity grounds.
    const proc = await request(app)
      .post(`/api/radiology/report-composer/jobs/${jobId}/process-now`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});
    expect(proc.status).toBe(200);
    const after = await jobRow(jobId);
    const identityCodes = [
      "compose_target_required",
      "compose_worklist_required",
      "compose_worklist_not_found",
      "compose_study_conflict",
      "compose_report_conflict",
      "compose_draft_conflict",
      "compose_locked",
      "compose_job_unbound",
      "compose_job_cross_study",
    ];
    expect(identityCodes).not.toContain(String(after.safeError));
    expect(["READY", "FAILED", "COMPOSING", "QUEUED"]).toContain(after.status);
  });

  it("21. Quick Select observations reach the job unchanged", async () => {
    const observations = [
      {
        concept: "bulge",
        source: "quick-select" as const,
        region: "LS Spine",
        level: "L4-L5",
        laterality: null,
        severity: "mild",
        measurement: "9.4 mm",
        findingsText: "L4-5 diffuse disc bulge with lateral recess narrowing",
      },
      {
        concept: "facet",
        source: "quick-select" as const,
        region: "LS Spine",
        level: "L5-S1",
        findingsText: "facet joint hypertrophy at L5-S1",
      },
    ];
    const enq = await enqueue(
      radiologist.token,
      snapshotOf({
        worklistId: wl1,
        studyId: st1,
        findings: "Identity 21: ledger-derived draft.",
        observations,
      }),
    );
    expect(enq.status).toBe(202);
    const row = await jobRow(enq.body.jobId as number);
    jobIds.push(row.id);
    const stored = JSON.parse(row.inputSnapshotJson) as ComposerInputSnapshot;
    expect(stored.observations).toHaveLength(2);
    expect(stored.observations?.[0]?.measurement).toBe("9.4 mm");
    expect(stored.observations?.[0]?.level).toBe("L4-L5");
    expect(enq.body.sources?.["quick-select"]).toBe(2);
  });

  // ── 20 ───────────────────────────────────────────────────────────────────
  it("20. the identity layer adds no network egress and no provider routing", async () => {
    const src = readFileSync(join(__dirname, "composeIdentity.ts"), "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(|axios|http\.request|https\.request|XMLHttpRequest|WebSocket|node-fetch|undici/);
    expect(src).not.toMatch(/resolveComposerProvider|cloudComposerConfig|assertGatewayPrivacy|ollama|deepseek|qwen|openai/i);
    // It also must not turn into a second clinical store: no writes at all.
    expect(src).not.toMatch(/\.(insert|update|delete)\(/);
    // The compose engine still owns provider selection and the PHI gate.
    const engine = readFileSync(join(__dirname, "composeEngine.ts"), "utf8");
    expect(engine).toMatch(/assertGatewayPrivacy|resolveComposerProvider/);
  });
});

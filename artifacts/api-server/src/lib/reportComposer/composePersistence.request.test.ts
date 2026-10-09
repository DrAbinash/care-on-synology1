/**
 * Durable Composer Apply — server-derived freshness, request-level tests.
 *
 * Every case here drives the real routes (`POST /jobs`,
 * `POST /report-generator/save-draft`, `POST /jobs/:id/applied`) against real
 * Postgres rows, and then reads the database back to decide whether the claim
 * "the accepted AI text is applied" is true. Nothing is mocked except where a
 * case is specifically about a read failing, which cannot be produced by
 * asking a healthy database politely.
 *
 * The defect this suite exists to prevent, in one sentence: a radiologist
 * accepts an AI draft, the tab says "AI Applied", and the accepted sentences
 * are in no report — because the save that would have persisted them had not
 * happened yet, or happened on top of somebody else's newer text.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  patientReportsTable,
  patientsTable,
  portalSessionsTable,
  radiologyReportDraftsTable,
  radiologyWorklistTable,
  reportFindingInstancesTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { computeSnapshotHashes } from "./snapshot";
import {
  authoriseComposeSaveTx,
  composeNarrativeToken,
  EMPTY_REPORT_TOKEN,
  loadAuthoritativeDraft,
  projectComposeNarrative,
  verifyComposeDurabilityTx,
  type ComposeDraftRow,
  type ComposePersistenceTx,
} from "./composePersistence";
import type { ComposerInputSnapshot } from "./types";

const marker = `vitest-persist-${randomUUID().slice(0, 8)}`;
const uid = (tag: string) => `1.2.826.vitest.persistence.${marker}.${tag}`;

function snapshotOf(opts: {
  worklistId: number | null;
  studyId?: number | null;
  reportId?: number | null;
  findings: string;
  impression?: string;
  recommendation?: string;
}): ComposerInputSnapshot {
  return {
    worklistId: opts.worklistId,
    studyId: opts.studyId ?? null,
    reportId: opts.reportId ?? null,
    modality: "MR",
    region: "LS_SPINE",
    studyType: "MRI LS Spine",
    clinicalHistory: "Low back pain",
    technique: "Multiplanar MRI lumbar spine",
    findings: opts.findings,
    impression: opts.impression ?? "",
    recommendation: opts.recommendation ?? "",
    observations: [],
    templateSections: [],
    jobKindHint: "FULL_REPORT",
    aiMode: "TEXT_ONLY",
  } as ComposerInputSnapshot;
}

async function makeStaff(label: string, role = "radiologist", permissions = ["/radiology", "ai_reporting.use"]) {
  const token = `vitest-p-token-${randomUUID()}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      name: `Vitest ${label} ${marker}`,
      email: `${marker}.${label.toLowerCase()}@vitest.invalid`,
      username: `${marker}.${label.toLowerCase()}`,
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

describe.skipIf(!hasDatabaseUrl())("Composer durable Apply and server-derived freshness", () => {
  let app: Express;
  let reader: { token: string; userId: number; name: string };
  let other: { token: string; userId: number; name: string };
  let admin: { token: string; userId: number; name: string };

  const cleanup = { jobIds: [] as number[], draftIds: [] as number[], worklistIds: [] as number[], reportIds: [] as number[], patientIds: [] as number[], userIds: [] as number[] };

  let p1 = 0;
  let wlOpen = 0; // the workspace study: no report of record, savable
  let stOpen = 0;
  let wlSecond = 0; // another study, same patient
  let wlSigned = 0; // a study whose report is already signed
  let rptSigned = 0;
  let wlOtherPatient = 0;
  let p2 = 0;

  const makeWorklist = async (tag: string, patientId: number, extra: Record<string, unknown> = {}) => {
    const suffix = randomUUID().slice(0, 8);
    const [row] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Synthetic ${tag}`,
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: uid(`${tag}-${suffix}`),
        accessionNumber: `ACC-${marker}-${tag}-${suffix}`,
        patientId,
        studyId: null,
        patientMatchStatus: "MATCHED",
        status: "STUDY_RECEIVED",
        ...extra,
      })
      .returning();
    cleanup.worklistIds.push(row.id);
    return row.id as number;
  };

  beforeAll(async () => {
    app = await createTestApp();
    reader = await makeStaff("Reader");
    other = await makeStaff("OtherReader");
    admin = await makeStaff("Admin", "admin", ["/radiology", "ai_reporting.use", "ai_reporting.configure"]);
    cleanup.userIds.push(reader.userId, other.userId, admin.userId);

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `MRN-${marker}`,
        firstName: "Synthetic",
        lastName: "Persistence",
        dateOfBirth: "1970-01-01",
        gender: "F",
        phone: "0000000000",
      })
      .returning();
    p1 = patient.id;
    cleanup.patientIds.push(p1);

    const [billed] = await db
      .insert(patientsTable)
      .values({
        patientId: `MRN2-${marker}`,
        firstName: "Synthetic",
        lastName: "Persistence Two",
        dateOfBirth: "1971-02-02",
        gender: "M",
        phone: "0000000000",
      })
      .returning();
    cleanup.patientIds.push(billed.id);

    p2 = billed.id;
    wlOtherPatient = await makeWorklist("OTHERPATIENT", p2);
    stOpen = wlOpen;
    rptSigned = 0;
    wlSigned = 0;
  });

  // The two studies every case drafts against are created fresh for every test.
  // `radiology_report_drafts` has no uniqueness on a study at all (a study can
  // hold any number of rows, and the editor picks the newest), so a row left
  // behind by an earlier case would silently become "the current report" for the
  // next one — which is exactly the interference that makes a suite pass alone
  // and fail in a run.
  beforeEach(async () => {
    wlOpen = await makeWorklist("OPEN", p1);
    wlSecond = await makeWorklist("SECOND", p1);
  });

  // ── 1 / 2 / 2b — the baseline and the compare-and-set ─────────────────────

  it("1. a fresh report applies: the accepted text is in the row before the job says APPLIED", async () => {
    const findings = "Persistence 1: L4-5 diffuse disc bulge.";
    const accepted = "Persistence 1: L4-5 diffuse disc bulge with facet arthropathy.";
    const { jobId, draftId, hashes } = await readyJob({
      worklistId: wlOpen,
      findings,
      acceptedFindings: accepted,
    });

    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    const evAfterSave = await evidence(jobId);
    expect(evAfterSave.receiptToken).toBe(await tokenOfDraft(draftId));

    const res = await applied(reader.token, jobId, applyBody(hashes, wlOpen));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = await draftById(draftId);
    expect(row.rawFindings).toBe(accepted);
    expect((await evidence(jobId)).status).toBe("APPLIED");
  });

  it("2. a report edited in another session is refused, and the other session's text survives", async () => {
    const findings = "Persistence 2: Modic endplate changes L3-4.";
    const accepted = "Persistence 2: Modic endplate changes L3-4 with canal stenosis.";
    const theirEdit = "Persistence 2: read on the other workstation as normal marrow signal.";
    const { jobId, draftId } = await readyJob({ worklistId: wlSecond, findings, acceptedFindings: accepted });

    // A second radiologist saves first. Untagged, so nothing about the AI job
    // stops their work — this is an ordinary edit of an ordinary report.
    const otherSave = await saveDraft(other.token, {
      id: draftId,
      studyId: wlSecond,
      worklistId: wlSecond,
      patientId: p1,
      rawFindings: theirEdit,
      impression: [""],
      recommendation: "",
    });
    expect(otherSave.status).toBe(200);

    const stale = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlSecond,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(stale.status).toBe(409);
    expect((stale.body as { code?: string }).code).toBe("compose_report_moved");
    // The refusal wrote nothing: the newer report is still the newer report.
    expect((await draftById(draftId)).rawFindings).toBe(theirEdit);
    expect((await evidence(jobId)).status).toBe("READY");
  });

  it("2b. the same session's own autosave does not count as a concurrent edit", async () => {
    const findings = "Persistence 2b: before the draft was generated.";
    const typed = "Persistence 2b: finding typed while the AI was composing.";
    const accepted = `${typed} Accepted AI sentence.`;
    const { jobId, draftId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });

    // The 30-second autosave fires with the radiologist's own new text.
    const autosave = await saveDraft(reader.token, {
      id: draftId,
      studyId: wlOpen,
      worklistId: wlOpen,
      patientId: p1,
      rawFindings: typed,
      impression: [""],
      recommendation: "",
    });
    expect(autosave.status).toBe(200);

    // The editor now holds `typed`, so that is what it is replacing — and the row
    // agrees, so the apply is authorised. A rule that refused this would refuse
    // the normal way anyone actually uses the composer.
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings: typed, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    expect((await evidence(jobId)).receiptToken).toBe(await tokenOfDraft(draftId));
  });

  it("3. a job with no stored baseline cannot be applied, and its save still saves the text", async () => {
    const findings = "Persistence 3: unbound legacy draft.";
    const accepted = "Persistence 3: unbound legacy draft plus AI sentence.";
    const { jobId, draftId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    // Simulate a job enqueued before this change existed: the evidence columns go
    // back to NULL, which is the state a row from the clinic's database is in.
    await db.execute(sql`
      UPDATE ai_report_compose_jobs
         SET source_persisted_token = NULL, source_draft_id = NULL, applied_persisted_token = NULL
       WHERE id = ${jobId}`);

    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    expect((await draftById(draftId)).rawFindings).toBe(accepted);

    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_baseline_missing");
    // A message that names the action to take, not just the fact that it failed.
    expect(String((res.body as { message?: string }).message)).toMatch(/generate/i);
    expect((await evidence(jobId)).status).toBe("READY");
  });

  it("4. a `previous` the row does not hold is refused once the report has moved", async () => {
    const findings = "Persistence 4: the report as saved.";
    const accepted = "Persistence 4: the report as saved with AI.";
    const theirs = "Persistence 4: rewritten on the other workstation.";
    const { jobId, draftId } = await readyJob({ worklistId: wlSecond, findings, acceptedFindings: accepted });

    // The row has to have moved first. While it still matches the baseline the
    // apply is authorised on the baseline arm and `previous` is never consulted,
    // which is the intended behaviour — so this case is about the second arm.
    const theirSave = await saveDraft(other.token, {
      id: draftId,
      studyId: wlSecond,
      worklistId: wlSecond,
      patientId: p1,
      rawFindings: theirs,
      impression: [""],
      recommendation: "",
    });
    expect(theirSave.status).toBe(200);

    const res = await persistAccepted(reader.token, {
      jobId,
      draftId,
      worklistId: wlSecond,
      // Claims to be replacing text that was never in the row.
      previous: { findings: "Persistence 4: text invented by the browser.", impression: "", recommendation: "" },
      next: accepted,
    });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_report_moved");
    expect((await draftById(draftId)).rawFindings).toBe(theirs);
  });

  it("5. a tag naming another of the same patient's studies buys the apply nothing", async () => {
    const findings = "Persistence 5: study A report.";
    const accepted = "Persistence 5: study A report with AI.";
    const { jobId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });

    // Study B has a report of its own, saved the ordinary way.
    const bSave = await saveDraft(reader.token, {
      studyId: wlSecond,
      worklistId: wlSecond,
      patientId: p1,
      rawFindings: "Persistence 5: study B report.",
      impression: [""],
      recommendation: "",
    });
    expect(bSave.status).toBe(200);
    const bDraftId = (bSave.body as { draft: { id: number } }).draft.id;
    cleanup.draftIds.push(bDraftId);

    // The tag says study B while the job is bound to study A. B's own save is
    // allowed — it is B's report and B's clinician — but the tag is discarded, so
    // no receipt exists, and the apply is refused on identity rather than on
    // freshness.
    const saved = await persistAccepted(reader.token, {
      jobId,
      draftId: bDraftId,
      worklistId: wlSecond,
      previous: { findings: "Persistence 5: study B report.", impression: "", recommendation: "" },
      next: "Persistence 5: study B report with A's AI text.",
    });
    expect(saved.status).toBe(200);
    const ev = await evidence(jobId);
    expect(ev.receiptToken).toBeNull();

    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlSecond } });
    expect(res.status).toBe(409);
    expect(String(res.body.code ?? res.body.error)).toMatch(/compose_job_cross_study|compose_study_conflict/);
  });

  it("6. a draft applied into another patient's study is refused before anything is marked", async () => {
    const findings = "Persistence 6: Patient A report.";
    const accepted = "Persistence 6: Patient A report with AI.";
    const { jobId, draftId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);

    const res = await applied(reader.token, jobId, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: wlOtherPatient },
    });
    expect(res.status).toBe(409);
    expect((await draftById(draftId)).rawFindings).toBe(accepted);
    expect((await evidence(jobId)).status).toBe("READY");
  });

  it("7. a study whose report is signed refuses both the tagged save and the apply", async () => {
    const findings = "Persistence 7: signed study draft text.";
    const accepted = "Persistence 7: signed study with AI.";
    const [report] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-SIGNED`,
        type: "radiology",
        patientId: p1,
        testId: 1,
        studyId: null,
        title: "MRI LS Spine",
        body: findings,
        impression: findings,
        status: "final",
      })
      .returning();
    cleanup.reportIds.push(report.id);
    const signedWl = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Synthetic SIGNED",
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: uid("SIGNED"),
        accessionNumber: `ACC-${marker}-WL-SIGNED`,
        patientId: p1,
        studyId: null,
        patientMatchStatus: "MATCHED",
        status: "REPORT_FINAL",
        reportId: report.id,
      })
      .returning();
    cleanup.worklistIds.push(signedWl[0].id);

    const snapshot = snapshotOf({ worklistId: signedWl[0].id, findings });
    const enq = await enqueue(reader.token, snapshot);
    // Enqueue itself refuses: the study's report is locked, so there is no
    // editable baseline to draft against.
    expect([409, 403, 400]).toContain(enq.status);

    // Even a job that got as far as READY cannot be persisted into a signed study.
    const { jobId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    const res = await applied(reader.token, jobId, {
      acceptedChangeIds: ["c1"],
      target: { worklistId: signedWl[0].id },
    });
    expect(res.status).toBe(409);
    expect(String(res.body.code ?? res.body.error)).toMatch(/compose_locked|REPORT_LOCKED|finalized/);
  });

  it("8. replaying an applied job is refused", async () => {
    const findings = "Persistence 8: apply once.";
    const accepted = "Persistence 8: apply once with AI.";
    const { jobId, hashes } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    const first = await applied(reader.token, jobId, applyBody(hashes, wlOpen));
    expect(first.status).toBe(200);
    const second = await applied(reader.token, jobId, applyBody(hashes, wlOpen));
    expect(second.status).toBe(409);
    // An already-applied job is refused by the status guard ahead of the
    // compare-and-set, so the machine token is `not_ready`; `already_applied` is
    // the racing twin of the same refusal. Both must never re-record anything.
    expect(["not_ready", "already_applied"]).toContain(String((second.body as { error?: string }).error));
    expect((await evidence(jobId)).status).toBe("APPLIED");
  });

  it("9. two simultaneous Apply requests leave exactly one APPLIED", async () => {
    const findings = "Persistence 9: two clicks.";
    const accepted = "Persistence 9: two clicks with AI.";
    const { jobId, hashes } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    const body = applyBody(hashes, wlOpen);
    const [a, b] = await Promise.all([applied(reader.token, jobId, body), applied(reader.token, jobId, body)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const rows = await db.execute(sql`SELECT status FROM ai_report_compose_jobs WHERE id = ${jobId}`);
    expect(JSON.stringify(rows)).toContain("APPLIED");
  });

  afterAll(async () => {
    if (cleanup.jobIds.length) await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, cleanup.jobIds));
    if (cleanup.draftIds.length) await db.delete(radiologyReportDraftsTable).where(inArray(radiologyReportDraftsTable.id, cleanup.draftIds));
    if (cleanup.reportIds.length) await db.delete(patientReportsTable).where(inArray(patientReportsTable.id, cleanup.reportIds));
    if (cleanup.worklistIds.length) await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, cleanup.worklistIds));
    if (cleanup.patientIds.length) await db.delete(patientsTable).where(inArray(patientsTable.id, cleanup.patientIds));
    if (cleanup.userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, cleanup.userIds));
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  const saveDraft = (token: string, body: Record<string, unknown>) =>
    request(app).post("/api/radiology/report-generator/save-draft").set("Authorization", `Bearer ${token}`).send(body);

  const enqueue = (token: string, snapshot: ComposerInputSnapshot) =>
    request(app).post("/api/radiology/report-composer/jobs").set("Authorization", `Bearer ${token}`).send({ snapshot, jobKind: "FULL_REPORT" });

  const applied = (token: string, jobId: number, body: Record<string, unknown>) =>
    request(app).post(`/api/radiology/report-composer/jobs/${jobId}/applied`).set("Authorization", `Bearer ${token}`).send(body);

  async function draftById(id: number) {
    const [row] = await db.select().from(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id)).limit(1);
    return row;
  }

  /** The stored row, in the shape the server's own projector reads. */
  function asDraftRow(row: Awaited<ReturnType<typeof draftById>>): ComposeDraftRow | null {
    if (!row) return null;
    return {
      id: row.id,
      studyId: row.studyId,
      worklistId: row.worklistId,
      patientId: row.patientId,
      rawFindings: row.rawFindings,
      impression: row.impression,
      recommendation: row.recommendation,
      status: row.status,
      finalReportId: row.finalReportId,
      updatedAt: String(row.updatedAt),
    };
  }

  async function tokenOfDraft(id: number) {
    return composeNarrativeToken(projectComposeNarrative(asDraftRow(await draftById(id))));
  }

  async function evidence(jobId: number) {
    // Drizzle's node-postgres `execute` resolves to the pg QueryResult object,
    // not an array — the same shape `jobService.executeComposeRows` tolerates.
    const result = (await db.execute(sql`
      SELECT source_persisted_token, source_draft_id, applied_persisted_token, status
        FROM ai_report_compose_jobs WHERE id = ${jobId} LIMIT 1`)) as unknown as
      { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
    const rows = Array.isArray(result) ? result : result.rows ?? [];
    const r = rows[0] ?? {};
    return {
      sourceToken: r.source_persisted_token == null ? null : String(r.source_persisted_token),
      sourceDraftId: r.source_draft_id == null ? null : Number(r.source_draft_id),
      receiptToken: r.applied_persisted_token == null ? null : String(r.applied_persisted_token),
      status: String(r.status ?? ""),
    };
  }

  /**
   * The whole honest sequence, one call: save the report the radiologist is
   * looking at, ask the server to queue a draft against it (the enqueue is what
   * captures the baseline — no test writes that column by hand), then put the
   * job into READY with one accepted change.
   *
   * Only the generation step is fabricated. `processComposeJob` needs a model,
   * and which sentences the model produced is not what this suite is about;
   * #905's suite and `reportComposer.request.test.ts` cover the worker.
   */
  async function readyJob(opts: {
    worklistId: number;
    findings: string;
    acceptedFindings: string;
    field?: "FINDINGS" | "IMPRESSION" | "RECOMMENDATION";
    changeType?: "REPLACE" | "DELETE";
    token?: string;
    draftExtra?: Record<string, unknown>;
  }) {
    const token = opts.token ?? reader.token;
    const field = opts.field ?? "FINDINGS";
    const changeType = opts.changeType ?? "REPLACE";
    const saved = await saveDraft(token, {
      studyId: opts.worklistId,
      worklistId: opts.worklistId,
      patientId: p1,
      rawFindings: opts.findings,
      impression: [""],
      recommendation: "",
      ...opts.draftExtra,
    });
    expect(saved.status).toBe(200);
    const draftId = (saved.body as { draft: { id: number } }).draft.id;
    cleanup.draftIds.push(draftId);

    const snapshot = snapshotOf({ worklistId: opts.worklistId, findings: opts.findings });
    const enq = await enqueue(token, snapshot);
    expect(enq.status).toBe(202);
    const jobId = (enq.body as { jobId: number }).jobId;
    cleanup.jobIds.push(jobId);

    const baseline = await evidence(jobId);
    expect(baseline.sourceToken).not.toBeNull();
    expect(baseline.sourceToken).toBe(await tokenOfDraft(draftId));

    const hashes = computeSnapshotHashes(snapshot);
    await db
      .update(aiReportComposeJobsTable)
      .set({
        status: "READY",
        trackedChangesJson: JSON.stringify([
          {
            id: "c1",
            source: "AI_COMPOSER",
            changeType,
            field,
            originalText: opts.findings,
            proposedText: changeType === "DELETE" ? "" : opts.acceptedFindings,
            reviewState: "ACCEPTED",
            clinicalSignificance: false,
            clinicalSignificanceReasons: [],
            createdAt: new Date().toISOString(),
          },
        ]),
      })
      .where(eq(aiReportComposeJobsTable.id, jobId));

    return { jobId, draftId, hashes, baseline: baseline.sourceToken as string };
  }

  /** The composer's own persistence step: the tagged save, into the draft row the
   *  editor actually holds — the real client sends the adopted `id`, and a test
   *  that omitted it would insert a second row and prove nothing. */
  const persistAccepted = async (
    token: string,
    opts: {
      jobId: number;
      draftId?: number;
      worklistId: number;
      previous: { findings: string; impression: string; recommendation: string };
      next: string;
      field?: "FINDINGS" | "IMPRESSION" | "RECOMMENDATION";
      extra?: Record<string, unknown>;
    },
  ) => {
    // Which row the editor holds. The server told every job which row its
    // baseline came from; a job from before that keeps the same rule the browser
    // uses — the newest draft for the study.
    const ev = await evidence(opts.jobId);
    let id = opts.draftId ?? ev.sourceDraftId;
    if (id == null) {
      const rows = await db
        .select({ id: radiologyReportDraftsTable.id })
        .from(radiologyReportDraftsTable)
        .where(eq(radiologyReportDraftsTable.studyId, opts.worklistId))
        .orderBy(desc(radiologyReportDraftsTable.updatedAt))
        .limit(1);
      id = rows[0]?.id;
    }
    return saveDraft(token, {
      id,
      studyId: opts.worklistId,
      worklistId: opts.worklistId,
      patientId: p1,
      rawFindings: opts.field && opts.field !== "FINDINGS" ? opts.previous.findings : opts.next,
      impression: [opts.field === "IMPRESSION" ? opts.next : opts.previous.impression],
      recommendation: opts.field === "RECOMMENDATION" ? opts.next : opts.previous.recommendation,
      ...opts.extra,
      composer: { jobId: opts.jobId, previous: opts.previous },
    });
  };

  /** The confirm body. All five hashes go together: `markComposeApplied` fills an
   *  omitted one with "", so a partial set is a mismatch and every case would
   *  refuse as `stale_ready` for the wrong reason. */
  const applyBody = (hashes: {
    reportRevision: string;
    findingsHash: string;
    impressionHash: string;
    recommendationHash: string;
    inputHash: string;
  }, worklistId: number) => ({
    acceptedChangeIds: ["c1"],
    reportRevision: hashes.reportRevision,
    findingsHash: hashes.findingsHash,
    impressionHash: hashes.impressionHash,
    recommendationHash: hashes.recommendationHash,
    inputHash: hashes.inputHash,
    target: { worklistId },
  });

  it("10. a failed read of the saved report fails closed rather than reading as unchanged", async () => {
    // The one case that cannot be produced by data: a read that throws. A healthy
    // Postgres will not do it on command, so the boundary is exercised directly —
    // and 10b below reproduces the same fail-closed verdict through the real
    // route, with no mock anywhere in it.
    const broken = {
      execute: async () => {
        throw new Error("simulated read failure");
      },
    } as unknown as ComposePersistenceTx;

    const found = await loadAuthoritativeDraft(broken, wlOpen, { patientId: p1 });
    expect(found.kind).toBe("error");

    const durability = await verifyComposeDurabilityTx(broken, {
      jobId: 1,
      worklistId: wlOpen,
      patientId: p1,
      accepted: [{ field: "findings", text: "anything", originalText: "" }],
    });
    expect(durability.ok).toBe(false);
    expect((durability as { code?: string }).code).toBe("compose_persistence_unavailable");

    const gate = await authoriseComposeSaveTx(broken, {
      jobId: 1,
      worklistId: wlOpen,
      patientId: p1,
      previous: { findings: "anything", impression: "", recommendation: "" },
    });
    expect("refuse" in gate).toBe(true);
  });

  it("10b. an unreadable draft row refuses through the real route", async () => {
    const findings = "Persistence 10b: two rows at one instant.";
    const accepted = "Persistence 10b: two rows at one instant with AI.";
    const { jobId, draftId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    const [twin] = await db
      .insert(radiologyReportDraftsTable)
      .values({ studyId: wlOpen, worklistId: wlOpen, patientId: p1, rawFindings: findings, status: "DRAFT" })
      .returning();
    cleanup.draftIds.push(twin.id);
    // Force the tie GET /drafts cannot resolve: `ORDER BY updated_at DESC` with no
    // tiebreaker leaves the browser's `drafts[0]` up to Postgres.
    const sameInstant = (await draftById(draftId))!.updatedAt;
    await db.execute(sql`
      UPDATE radiology_report_drafts SET updated_at = ${sameInstant}
       WHERE id IN (${draftId}, ${twin.id})`);

    const res = await persistAccepted(reader.token, {
      jobId,
      draftId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_baseline_ambiguous");
    expect((await draftById(draftId)).rawFindings).toBe(findings);
  });

  it("11. a crash between acceptance and persistence leaves no APPLIED state", async () => {
    const findings = "Persistence 11: accepted but never saved.";
    const accepted = "Persistence 11: accepted but never saved with AI.";
    const { jobId, draftId, hashes } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });

    // The radiologist accepts, the tab calls /applied — and then the tab dies
    // before its save reaches the server. Nothing was persisted.
    const res = await applied(reader.token, jobId, applyBody(hashes, wlOpen));
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_not_persisted");
    expect((await evidence(jobId)).status).toBe("READY");
    expect((await draftById(draftId)).rawFindings).toBe(findings);
    expect(String((res.body as { message?: string }).message)).toMatch(/not|Nothing/i);

    // And the state is recoverable: the same job applies once the save lands.
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    const retry = await applied(reader.token, jobId, applyBody(hashes, wlOpen));
    expect(retry.status).toBe(200);
    expect((await draftById(draftId)).rawFindings).toBe(accepted);
  });

  it("12. a refused confirm costs nothing and the next one succeeds", async () => {
    const findings = "Persistence 12: disconnected mid-apply.";
    const accepted = "Persistence 12: disconnected mid-apply with AI.";
    const { jobId, draftId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);

    const wrongStudy = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlSecond } });
    expect(wrongStudy.status).toBe(409);
    expect((await evidence(jobId)).status).toBe("READY");

    const ok = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(ok.status).toBe(200);
    expect((await draftById(draftId)).rawFindings).toBe(accepted);
  });

  it("13. text the AI did not touch survives the composer's save untouched", async () => {
    const findings = "Persistence 13: shared sentence.";
    const accepted = "Persistence 13: shared sentence rewritten by AI.";
    const impression = "Persistence 13: the radiologist's own impression.";
    const recommendation = "Persistence 13: their own follow-up advice.";
    const { jobId, draftId } = await readyJob({
      worklistId: wlOpen,
      findings,
      acceptedFindings: accepted,
      draftExtra: { impression: [impression], recommendation, clinicalHistory: "Known L4-5 disc disease" },
    });
    // `previous.impression` carries what the editor is showing, so the tag must
    // authorise the write without disturbing the other two fields. The body is
    // the whole narrative, exactly as the workspace sends it: POST /save-draft is
    // a full-row writer, and a save that omitted a field would clear it.
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression, recommendation },
      next: accepted,
      extra: { clinicalHistory: "Known L4-5 disc disease" },
    });
    expect(saved.status).toBe(200);
    const row = await draftById(draftId);
    expect(row.rawFindings).toBe(accepted);
    expect(JSON.parse(String(row.impression))).toEqual([impression]);
    expect(row.recommendation).toBe(recommendation);
    expect(row.clinicalHistory).toBe("Known L4-5 disc disease");

    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(200);
  });

  it("14. the composer's save leaves the study's Quick Select rows in place", async () => {
    const findings = "Persistence 14: with selections.";
    const accepted = "Persistence 14: with selections rewritten by AI.";
    const { jobId, draftId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    await db
      .insert(reportFindingInstancesTable)
      .values([{ draftId, findingId: 4242, structuredJson: { marker }, source: "quickselect" }])
      .onConflictDoNothing();

    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    const kept = await db
      .select({ id: reportFindingInstancesTable.id })
      .from(reportFindingInstancesTable)
      .where(eq(reportFindingInstancesTable.draftId, draftId));
    expect(kept.length).toBeGreaterThan(0);
    await db.delete(reportFindingInstancesTable).where(eq(reportFindingInstancesTable.draftId, draftId));
  });

  it("15. the tracked review survives the apply, accepted and rejected both recorded", async () => {
    const findings = "Persistence 15: review state.";
    const accepted = "Persistence 15: review state with AI.";
    const { jobId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    await db
      .update(aiReportComposeJobsTable)
      .set({
        trackedChangesJson: JSON.stringify([
          {
            id: "c1", source: "AI_COMPOSER", changeType: "REPLACE", field: "FINDINGS",
            originalText: findings, proposedText: accepted, reviewState: "PENDING",
            clinicalSignificance: false, clinicalSignificanceReasons: [], createdAt: new Date().toISOString(),
          },
          {
            id: "c2", source: "AI_COMPOSER", changeType: "ADD", field: "RECOMMENDATION",
            originalText: "", proposedText: "Persistence 15: refused sentence.", reviewState: "PENDING",
            clinicalSignificance: false, clinicalSignificanceReasons: [], createdAt: new Date().toISOString(),
          },
        ]),
      })
      .where(eq(aiReportComposeJobsTable.id, jobId));
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(200);
    const [job] = await db.select().from(aiReportComposeJobsTable).where(eq(aiReportComposeJobsTable.id, jobId)).limit(1);
    const changes = JSON.parse(String(job.trackedChangesJson)) as Array<{ id: string; reviewState: string }>;
    expect(changes.find((c) => c.id === "c1")?.reviewState).toBe("ACCEPTED");
    expect(changes.find((c) => c.id === "c2")?.reviewState).toBe("REJECTED");
    expect(changes).toHaveLength(2);
  });

  it("16. an accepted impression is proved through the same projection the editor displays", async () => {
    const findings = "Persistence 16: findings unchanged.";
    const acceptedImpression = "Persistence 16: accepted AI impression.";
    const { jobId, draftId } = await readyJob({
      worklistId: wlOpen,
      findings,
      acceptedFindings: acceptedImpression,
      field: "IMPRESSION",
    });
    // The editor's text arrives padded; the stored column keeps the padding and
    // the display projects it away. The proof has to follow the display.
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      field: "IMPRESSION",
      previous: { findings, impression: "", recommendation: "" },
      next: `   ${acceptedImpression}\n`,
    });
    expect(saved.status).toBe(200);
    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(200);
    expect(JSON.parse(String((await draftById(draftId)).impression))).toEqual([`   ${acceptedImpression}\n`]);
  });

  it("17. a report that only exists in patient_reports has no editable baseline to apply into", async () => {
    // Legacy surface: a worklist row whose report of record exists and no draft.
    const [report] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-LEGACY`,
        type: "radiology",
        patientId: p1,
        testId: 1,
        studyId: null,
        title: "MRI LS Spine",
        body: "Persistence 17: legacy report body.",
        impression: "Persistence 17: legacy impression.",
        status: "draft",
      })
      .returning();
    cleanup.reportIds.push(report.id);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Synthetic LEGACY",
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: uid("LEGACY"),
        accessionNumber: `ACC-${marker}-WL-LEGACY`,
        patientId: p1,
        studyId: null,
        patientMatchStatus: "MATCHED",
        status: "REPORT_FINAL",
        reportId: report.id,
      })
      .returning();
    cleanup.worklistIds.push(wl.id);

    const enq = await enqueue(reader.token, snapshotOf({ worklistId: wl.id, findings: "Persistence 17: legacy." }));
    expect(enq.status).toBe(409);
    expect(String((enq.body as { code?: string }).code ?? enq.body.error)).toMatch(/compose_locked|finalized/);
  });

  it("18. a job that never named a worklist is refused, not defaulted", async () => {
    const snapshot = snapshotOf({ worklistId: null, findings: "Persistence 18: unbound." });
    const enq = await enqueue(reader.token, snapshot);
    expect(enq.status).toBe(400);
    expect(String((enq.body as { code?: string }).code)).toBe("compose_worklist_required");

    // A row already in the database with no binding cannot be applied either.
    const hashes = computeSnapshotHashes(snapshot);
    const [orphan] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        studyId: null,
        worklistId: null,
        jobKind: "FULL_REPORT",
        status: "READY",
        sourceReportRevision: hashes.reportRevision,
        sourceFindingsHash: hashes.findingsHash,
        sourceImpressionHash: hashes.impressionHash,
        sourceRecommendationHash: hashes.recommendationHash,
        inputHash: hashes.inputHash,
        inputSnapshotJson: JSON.stringify(snapshot),
        trackedChangesJson: "[]",
      })
      .returning();
    cleanup.jobIds.push(orphan.id);
    const res = await applied(reader.token, orphan.id, { acceptedChangeIds: [], target: { worklistId: wlOpen } });
    expect(res.status).toBe(409);
  });

  it("19. a deletion the radiologist accepted is proved by the text being gone", async () => {
    const findings = "Persistence 19: sentence kept. Sentence the AI removed.";
    const kept = "Persistence 19: sentence kept.";
    const { jobId, draftId } = await readyJob({
      worklistId: wlOpen,
      findings,
      acceptedFindings: "",
      changeType: "DELETE",
    });
    // Containment cannot prove a deletion — an empty string is in everything — so
    // the accepted removal must show up as the removed text being absent.
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: kept,
    });
    expect(saved.status).toBe(200);
    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(200);
    expect((await draftById(draftId)).rawFindings).toBe(kept);
  });

  it("20. a deletion that was never persisted is refused", async () => {
    const findings = "Persistence 20: sentence kept. Sentence the AI removed.";
    const { jobId } = await readyJob({
      worklistId: wlOpen,
      findings,
      acceptedFindings: "",
      changeType: "DELETE",
    });
    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_not_persisted");
  });

  it("21. a report overwritten after the accepted text was saved voids the apply", async () => {
    const findings = "Persistence 21: saved before the confirm.";
    const accepted = "Persistence 21: saved before the confirm with AI.";
    const later = "Persistence 21: replaced by another workstation.";
    const { jobId, draftId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: accepted,
    });
    expect(saved.status).toBe(200);
    expect((await evidence(jobId)).receiptToken).toBe(await tokenOfDraft(draftId));

    // Somebody else writes between the accepted save and the confirm. The receipt
    // is the only thing that can tell "this is still what we authorised" from
    // "something replaced it a second later".
    const clobber = await saveDraft(other.token, {
      id: draftId,
      studyId: wlOpen,
      worklistId: wlOpen,
      patientId: p1,
      rawFindings: later,
      impression: [""],
      recommendation: "",
    });
    expect(clobber.status).toBe(200);

    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_report_moved");
    expect((await evidence(jobId)).status).toBe("READY");
    expect((await draftById(draftId)).rawFindings).toBe(later);
  });

  it("22. the baseline is the server's own read, and a browser hint cannot replace it", async () => {
    const findings = "Persistence 22: what the row actually holds.";
    const saved = await saveDraft(reader.token, {
      studyId: wlOpen,
      worklistId: wlOpen,
      patientId: p1,
      rawFindings: findings,
      impression: [""],
      recommendation: "",
    });
    const draftId = (saved.body as { draft: { id: number } }).draft.id;
    cleanup.draftIds.push(draftId);

    // The browser claims a completely different report and offers its own token.
    // Neither is stored: `source_persisted_token` is what the row said when the
    // server read it, which is the whole distinction this change exists for.
    const snapshot = snapshotOf({ worklistId: wlOpen, findings: "Persistence 22: invented by the browser." });
    const enq = await request(app)
      .post("/api/radiology/report-composer/jobs")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({
        snapshot,
        jobKind: "IMPRESSION",
        persistedContentToken: "0".repeat(32),
      });
    expect([202, 409]).toContain(enq.status);
    if (enq.status !== 202) return;
    const jobId = (enq.body as { jobId: number }).jobId;
    cleanup.jobIds.push(jobId);

    const ev = await evidence(jobId);
    expect(ev.sourceToken).toBe(await tokenOfDraft(draftId));
    expect(ev.sourceDraftId).toBe(draftId);
    expect(ev.sourceToken).not.toBe("0".repeat(32));
  });

  it("23. a study with no saved draft yet baselines on emptiness and applies once its first save lands", async () => {
    const accepted = "Persistence 23: the first sentence of a brand-new report.";
    // Nothing has ever been saved for this study: no draft row at all.
    const none = await db
      .select({ id: radiologyReportDraftsTable.id })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.studyId, wlOpen));
    expect(none).toHaveLength(0);

    const snapshot = snapshotOf({ worklistId: wlOpen, findings: "" });
    const hashes = computeSnapshotHashes(snapshot);
    const enq = await enqueue(reader.token, snapshot);
    expect(enq.status).toBe(202);
    const jobId = (enq.body as { jobId: number }).jobId;
    cleanup.jobIds.push(jobId);

    const ev = await evidence(jobId);
    // The empty report is a defined baseline, and it is not the same thing as a
    // missing one — that pair of facts is what lets the code refuse legacy jobs
    // while still allowing a first draft.
    expect(ev.sourceToken).toBe(EMPTY_REPORT_TOKEN);
    expect(ev.sourceDraftId).toBeNull();

    await db
      .update(aiReportComposeJobsTable)
      .set({
        status: "READY",
        trackedChangesJson: JSON.stringify([
          {
            id: "c1", source: "AI_COMPOSER", changeType: "ADD", field: "FINDINGS",
            originalText: "", proposedText: accepted, reviewState: "ACCEPTED",
            clinicalSignificance: false, clinicalSignificanceReasons: [],
            createdAt: new Date().toISOString(),
          },
        ]),
      })
      .where(eq(aiReportComposeJobsTable.id, jobId));

    const before = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(before.status).toBe(409);
    expect((before.body as { code?: string }).code).toBe("compose_not_persisted");

    // The composer's save is the study's first draft row. There is no row to lock,
    // so the gate authorises on the baseline arm (still empty) and the receipt is
    // taken from what the INSERT produced.
    const saved = await saveDraft(reader.token, {
      studyId: wlOpen,
      worklistId: wlOpen,
      patientId: p1,
      rawFindings: accepted,
      impression: [""],
      recommendation: "",
      composer: { jobId, previous: { findings: "", impression: "", recommendation: "" } },
    });
    expect(saved.status).toBe(200);
    const draftId = (saved.body as { draft: { id: number } }).draft.id;
    cleanup.draftIds.push(draftId);
    expect((await evidence(jobId)).receiptToken).toBe(await tokenOfDraft(draftId));

    const res = await applied(reader.token, jobId, applyBody(hashes, wlOpen));
    expect(res.status).toBe(200);
    expect((await draftById(draftId)).rawFindings).toBe(accepted);
  });

  it("24. a save the server authorised that does not contain the accepted text is not an apply", async () => {
    const findings = "Persistence 24: the report before.";
    const accepted = "Persistence 24: the AI sentence the radiologist accepted.";
    const { jobId, draftId } = await readyJob({ worklistId: wlOpen, findings, acceptedFindings: accepted });

    // The tab persists something else entirely — an editor that overwrote the
    // field between accept and save. The compare-and-set passes (the row was
    // untouched) and the receipt is real, so this is the only case that isolates
    // the containment proof: without it the job would be marked applied while the
    // accepted sentence is in no report.
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: "Persistence 24: unrelated text typed over the accepted one.",
    });
    expect(saved.status).toBe(200);
    expect((await evidence(jobId)).receiptToken).toBe(await tokenOfDraft(draftId));

    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_not_persisted");
    expect((await evidence(jobId)).status).toBe("READY");
  });

  it("25. a draft row that disagrees about which worklist it belongs to has no baseline", async () => {
    // The two id sequences are independent, and a draft row's `study_id` is
    // normally the worklist id because POST /save-draft overwrites it that way. A
    // row written before that rule — or one whose numbers collide across the
    // sequences — can name a different worklist. Neither side is then trusted: the
    // server refuses to call any report "the current one" rather than picking.
    const [conflicting] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        studyId: wlOpen,
        worklistId: wlSecond,
        patientId: p1,
        rawFindings: "Persistence 25: a row whose two study columns disagree.",
        impression: JSON.stringify([]),
        status: "DRAFT",
      })
      .returning();
    cleanup.draftIds.push(conflicting.id);

    const res = await enqueue(reader.token, snapshotOf({ worklistId: wlOpen, findings: "" }));
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_persistence_unavailable");
    expect(String((res.body as { error?: string }).error)).toMatch(/could not read/i);
  });

  it("26. an accepted deletion is refused when the removed sentence is still in the report", async () => {
    const findings = "Persistence 26: kept. Persistence 26: the sentence the AI removed.";
    const { jobId, draftId } = await readyJob({
      worklistId: wlOpen,
      findings,
      acceptedFindings: "",
      changeType: "DELETE",
    });

    // The save happens and is authorised — the editor really was replacing the
    // text the row holds — but it writes the narrative back unchanged, so the
    // deletion the radiologist accepted never took place. Containment cannot see
    // this (an empty proposal is "in" every report), which is exactly why a
    // deletion is proved by absence.
    const saved = await persistAccepted(reader.token, {
      jobId,
      worklistId: wlOpen,
      previous: { findings, impression: "", recommendation: "" },
      next: findings,
    });
    expect(saved.status).toBe(200);
    expect((await evidence(jobId)).receiptToken).toBe(await tokenOfDraft(draftId));

    const res = await applied(reader.token, jobId, { acceptedChangeIds: ["c1"], target: { worklistId: wlOpen } });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("compose_not_persisted");
    expect((await evidence(jobId)).status).toBe("READY");
  });
});

/**
 * Draft write integrity — two suspected lost-update defects in
 * POST /api/radiology/report-generator/save-draft, executed over real HTTP
 * against real Postgres.
 *
 * DEFECT 1 (the unguarded writer wipes Findings)
 *   `save-draft` compares-and-sets only when the client NAMES a revision. A
 *   save that names none takes `draft = await writeDraftRow(db)` with no lock
 *   and no revision check, and `writeDraftRow` writes the FULL column set —
 *   `rawFindings: rest.rawFindings ?? null` among them. The legacy page
 *   `artifacts/diagnostic-erp/src/pages/RadiologyReportGenerator.tsx` posts
 *   `findingsSections` and no `rawFindings`, no `expectedRevision` (its
 *   `saveDraft()` payload), while adopting the same draft row for the study.
 *   So the Findings the Composer wrote can be nulled by a save that never
 *   touched them.
 *   ASSERTION DIRECTION: the test below asserts the SAFE outcome — Findings
 *   survive a save that did not carry them. Against the current code that
 *   assertion FAILS (`raw_findings` comes back NULL), which is what makes it a
 *   regression test for the defect rather than a snapshot of it. The companion
 *   control asserts the same legacy payload WITH `rawFindings` present keeps
 *   the text, so a failure above is attributable to the omitted field and not
 *   to the row being unwritable, the auth being wrong, or the section columns
 *   behaving differently.
 *
 * DEFECT 2 (a refused AI-composer save already committed)
 *   Inside `db.transaction`, `const row = await writeDraftRow(tx)` runs BEFORE
 *   the compose receipt is recorded, and a failing receipt
 *   `return { kind: "refused", ... }`. Drizzle COMMITS a returned value from a
 *   transaction callback — only a `throw` rolls it back. The refusal the
 *   radiologist gets says "Nothing was changed."
 *   `recordComposeReceiptTx` fails only when its own `loadAuthoritativeDraft`
 *   read lands on `ambiguous` / `conflict` / `error`, and both gate and receipt
 *   read the same partition, so the failure needs the write itself to change
 *   that partition. It can: `values.studyId` and `values.worklistId` are only
 *   forced equal when the named worklist row EXISTS
 *   (`radiology-report-generator.ts` resolves `rest.worklistId` against
 *   `radiology_worklist`, and leaves both ids as sent when it finds nothing).
 *   A save naming a study id in the `worklistId` slot — the two independent id
 *   sequences this repo already documents colliding, and exactly the confusion
 *   the finalize audit measured — therefore moves the written row OUT of the
 *   partition the receipt re-reads, uncovering a duplicate pair of draft rows
 *   that share one `updated_at` (the `compose_baseline_ambiguous` state
 *   `loadAuthoritativeDraft` refuses to guess its way out of).
 *   ASSERTION DIRECTION: after the 409 the stored draft row must be byte-for-byte
 *   what it was before the call. Against the current code the write is
 *   committed and the assertion FAILS.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts). Every fixture
 * row carries this file's own marker and is deleted by id in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  patientsTable,
  portalSessionsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import {
  composeNarrativeToken,
  projectComposeNarrative,
  type ComposeDraftRow,
} from "../lib/reportComposer/composePersistence";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const marker = `draftint-${randomUUID().slice(0, 8)}`;

/** What the Composer / workspace saved as Findings. */
const COMPOSER_FINDINGS =
  "The brain parenchyma shows no acute infarct. ${M}. Ventricles and sulci are normal for age.";
/** The AI text of the refused composer Apply. */
const AI_FINDINGS = "AI ACCEPTED FINDINGS — small left MCA territory perfusion defect.";

describe.skipIf(!dbReady)("radiology draft write integrity — request level", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  let patientId = 0;
  let testId = 0;

  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const draftIds: number[] = [];
  const composeJobIds: number[] = [];

  const saveDraft = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/radiology/report-generator/save-draft")
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  async function draftsRow(id: number) {
    const [row] = await db
      .select()
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.id, id))
      .limit(1);
    return row;
  }

  async function newWorklist(label: string): Promise<number> {
    const suffix = randomUUID().slice(0, 8);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Probe Integrity ${marker}`,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyInstanceUID: `1.2.840.draftint.${marker}.${label}.${suffix}`,
        accessionNumber: `ACC-${marker}-${label}-${suffix}`,
        patientId,
        studyId: null,
        patientMatchStatus: "MATCHED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);
    return wl.id;
  }

  /** A billed study row; returns its id. `radiology_studies` needs patient_id
   *  and test_id, and the two id sequences are independent of `radiology_worklist`. */
  async function newBilledStudy(label: string): Promise<number> {
    const suffix = randomUUID().slice(0, 8);
    const [s] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACCB-${marker}-${label}-${suffix}`,
        patientId,
        testId,
        modality: "MR",
        department: "MRI",
        studyDescription: `MRI Brain ${label}`,
        status: "acquired",
      })
      .returning();
    studyIds.push(s.id);
    return s.id;
  }

  /** A billed study id that is NOT a `radiology_worklist` row id — the shape a
   *  client that confuses the two id spaces sends. */
  async function newStudyIdAbsentFromWorklistSpace(label: string): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = await newBilledStudy(`${label}${attempt}`);
      const clash = await db
        .select({ id: radiologyWorklistTable.id })
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.id, id))
        .limit(1);
      if (clash.length === 0) return id;
    }
    throw new Error(`no billed study id free of the worklist id space for ${marker}`);
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Dr. DraftIntegrity ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology", "/report-generator", "/reports"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    token = `vitest-${marker}`;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `INT-${marker}`,
        firstName: "Synthetic",
        lastName: `Integrity ${marker}`,
        dateOfBirth: "1972-03-04",
        gender: "M",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;

    const [test] = await db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${marker}`,
        code: `MRI${marker.slice(-5).toUpperCase()}`,
        price: "6000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = test.id;
  }, 90_000);

  afterAll(async () => {
    if (draftIds.length) {
      await db
        .delete(radiologyReportDraftsTable)
        .where(inArray(radiologyReportDraftsTable.id, draftIds))
        .catch(() => {});
    }
    if (composeJobIds.length) {
      await db
        .delete(aiReportComposeJobsTable)
        .where(inArray(aiReportComposeJobsTable.id, composeJobIds))
        .catch(() => {});
    }
    if (worklistIds.length) {
      // Any draft this file's saves left keyed on one of these rows (including
      // rows this file did not name up front) goes by the same marker-scoped key.
      const leftovers = await db
        .select({ id: radiologyReportDraftsTable.id })
        .from(radiologyReportDraftsTable)
        .where(inArray(radiologyReportDraftsTable.studyId, worklistIds));
      if (leftovers.length) {
        await db
          .delete(radiologyReportDraftsTable)
          .where(inArray(radiologyReportDraftsTable.id, leftovers.map((r) => r.id)))
          .catch(() => {});
      }
      await db
        .delete(radiologyWorklistTable)
        .where(inArray(radiologyWorklistTable.id, worklistIds))
        .catch(() => {});
    }
    if (studyIds.length) {
      const byStudy = await db
        .select({ id: radiologyReportDraftsTable.id })
        .from(radiologyReportDraftsTable)
        .where(inArray(radiologyReportDraftsTable.studyId, studyIds));
      if (byStudy.length) {
        await db
          .delete(radiologyReportDraftsTable)
          .where(inArray(radiologyReportDraftsTable.id, byStudy.map((r) => r.id)))
          .catch(() => {});
      }
      await db
        .delete(radiologyStudiesTable)
        .where(inArray(radiologyStudiesTable.id, studyIds))
        .catch(() => {});
    }
    if (patientId) {
      await db
        .delete(radiologyReportDraftsTable)
        .where(eq(radiologyReportDraftsTable.patientId, patientId))
        .catch(() => {});
      await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    }
    if (testId) await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, userId)).catch(() => {});
      await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    }
  }, 90_000);

  // ─────────────────────────────────────────────────────────────────────────
  // DEFECT 1 — an unguarded writer wipes the workspace's Findings
  // ─────────────────────────────────────────────────────────────────────────

  it("D1: a save that names no revision and sends no rawFindings must not erase the Findings already in the row", async () => {
    const wl = await newWorklist("d1");

    // (1) The Composer / workspace save: Findings present, revision returned.
    const composer = await saveDraft({
      studyId: wl,
      worklistId: wl,
      patientId,
      modality: "MRI",
      studyName: "MRI Brain",
      clinicalHistory: "Headache for three weeks.",
      technique: "MRI of the brain performed on a 1.5T scanner without contrast.",
      rawFindings: COMPOSER_FINDINGS.replace("${M}", marker),
      impression: ["No acute intracranial abnormality."],
      recommendation: "Please correlate with clinical findings.",
    });
    expect(composer.status, composer.text).toBe(200);
    const draftId = (composer.body as { draft: { id: number } }).draft.id;
    draftIds.push(draftId);
    const revision = (composer.body as { revision?: string }).revision;
    expect(typeof revision, "the server issued a revision for this row").toBe("string");

    const before = await draftsRow(draftId);
    expect(before, "the composer save wrote no row").toBeDefined();
    expect(String(before!.rawFindings)).toBe(COMPOSER_FINDINGS.replace("${M}", marker));

    // (2) The legacy Report Generator page's payload, copied field for field from
    // `RadiologyReportGenerator.tsx` `saveDraft()`: it adopts the SAME row (`id`),
    // carries Findings in `findingsSections` only, sends no `rawFindings` and no
    // `expectedRevision`.
    const legacy = await saveDraft({
      id: draftId,
      studyId: wl,
      patientId,
      templateId: "MRI_BRAIN_PLAIN",
      modality: "MRI",
      studyName: "MRI Brain",
      clinicalHistory: "Headache for three weeks.",
      findingsSections: {
        "Brain parenchyma": `GREY MATTER DIFFERENTIATION IS NORMAL. ${marker}`,
        "Ventricles and sulci": "NORMAL IN CALIBRE AND DISTRIBUTION.",
      },
      impression: ["No acute intracranial abnormality."],
      recommendation: "Please correlate with clinical findings.",
      formattedReportHtml: `<div>${marker}</div>`,
      formattedReportText: `MRI BRAIN ${marker}`,
    });
    expect(legacy.status, legacy.text).toBe(200);
    expect((legacy.body as { success?: boolean }).success).toBe(true);

    // (3) THE LOAD-BEARING ASSERTION — written for the SAFE behaviour, so it
    // fails while the defect stands: Findings the second save never carried must
    // still be in the row.
    const after = await draftsRow(draftId);
    expect(
      after!.rawFindings,
      `raw_findings before=${JSON.stringify(before!.rawFindings)} after=${JSON.stringify(after!.rawFindings)} ` +
        `(legacy save HTTP ${legacy.status}; findings_sections after=${JSON.stringify(after!.findingsSections)})`,
    ).toBe(COMPOSER_FINDINGS.replace("${M}", marker));

    // Everything else the legacy page did send is still saved (this part passes
    // either way; it shows the save ran and wrote the row, rather than failing).
    expect(String(after!.findingsSections)).toContain(marker);
  });

  it("D1 control: the same legacy payload WITH rawFindings keeps the Findings — so the loss above is the omitted field, not the row or the surface", async () => {
    const wl = await newWorklist("d1c");

    const composer = await saveDraft({
      studyId: wl,
      worklistId: wl,
      patientId,
      clinicalHistory: "Headache for three weeks.",
      rawFindings: COMPOSER_FINDINGS.replace("${M}", marker),
      impression: ["No acute intracranial abnormality."],
      recommendation: "Please correlate with clinical findings.",
    });
    expect(composer.status, composer.text).toBe(200);
    const draftId = (composer.body as { draft: { id: number } }).draft.id;
    draftIds.push(draftId);

    const before = await draftsRow(draftId);
    const withFindings = await saveDraft({
      id: draftId,
      studyId: wl,
      patientId,
      templateId: "MRI_BRAIN_PLAIN",
      modality: "MRI",
      studyName: "MRI Brain",
      clinicalHistory: "Headache for three weeks.",
      rawFindings: String(before!.rawFindings),
      findingsSections: {
        "Brain parenchyma": `GREY MATTER DIFFERENTIATION IS NORMAL. ${marker}`,
      },
      impression: ["No acute intracranial abnormality."],
      recommendation: "Please correlate with clinical findings.",
    });
    expect(withFindings.status, withFindings.text).toBe(200);

    const after = await draftsRow(draftId);
    expect(
      after!.rawFindings,
      `raw_findings before=${JSON.stringify(before!.rawFindings)} after=${JSON.stringify(after!.rawFindings)}`,
    ).toBe(COMPOSER_FINDINGS.replace("${M}", marker));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DEFECT 2 — a refused AI-composer save already committed
  // ─────────────────────────────────────────────────────────────────────────

  it("D2: a composer save refused after the receipt fails must leave the stored draft row exactly as it was", async () => {
    // The study key this report lives under: a billed-study id that no
    // `radiology_worklist` row owns, so a save naming it in the `worklistId`
    // slot does NOT resolve and `values.study_id` is written from `studyId`
    // instead of being forced equal to `worklist_id`.
    const studyKey = await newStudyIdAbsentFromWorklistSpace("key");
    const otherStudy = await newBilledStudy("moved");

    // (1) The report as the workspace last saved it — one clean draft row for
    // the study key, which is also the compose job's server-captured baseline.
    const opened = await saveDraft({
      studyId: studyKey,
      worklistId: studyKey,
      patientId,
      modality: "MRI",
      studyName: "MRI Brain",
      clinicalHistory: "Headache for three weeks.",
      rawFindings: COMPOSER_FINDINGS.replace("${M}", marker),
      impression: ["No acute intracranial abnormality."],
      recommendation: "Please correlate with clinical findings.",
    });
    expect(opened.status, opened.text).toBe(200);
    const draftId = (opened.body as { draft: { id: number } }).draft.id;
    draftIds.push(draftId);
    const revision = (opened.body as { revision?: string }).revision;

    // (2) Duplicate draft rows for the same study key sharing one `updated_at`:
    // the state `loadAuthoritativeDraft` names `ambiguous` and refuses to guess.
    // Hidden behind the clean row at the gate read (which sees only LIMIT 2),
    // they are what the receipt read sees once the write has moved that row.
    const tieStamp = new Date(Date.now() - 120_000);
    for (const tag of ["dupC", "dupD"]) {
      const [dup] = await db
        .insert(radiologyReportDraftsTable)
        .values({
          studyId: studyKey,
          worklistId: null,
          patientId,
          modality: "MRI",
          studyName: "MRI Brain",
          rawFindings: `Duplicate row ${tag} ${marker}`,
          impression: JSON.stringify([`Duplicate impression ${tag}.`]),
          recommendation: `Duplicate recommendation ${tag}.`,
          status: "DRAFT",
          createdBy: marker,
          createdAt: tieStamp,
          updatedAt: tieStamp,
        })
        .returning();
      draftIds.push(dup.id);
    }

    const baselineRow = await draftsRow(draftId);
    expect(baselineRow, "the workspace save wrote no row").toBeDefined();
    expect(String(baselineRow!.worklistId)).toBe(String(studyKey));
    expect(Number(baselineRow!.studyId)).toBe(studyKey);

    // (3) A compose job whose server-derived baseline is exactly that row.
    const sourceToken = composeNarrativeToken(
      projectComposeNarrative(baselineRow as unknown as ComposeDraftRow),
    );
    const [job] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        studyId: studyKey,
        worklistId: studyKey,
        jobKind: "FULL_REPORT",
        status: "COMPLETED",
        sourceReportRevision: String(revision ?? marker),
        sourceFindingsHash: marker,
        sourceImpressionHash: marker,
        inputHash: marker,
        inputSnapshotJson: "{}",
        sourcePersistedToken: sourceToken,
        appliedPersistedToken: null,
      })
      .returning();
    composeJobIds.push(job.id);

    // The stored state this call must not disturb, as one projection so a
    // failure prints every column the refused save moved, not only the first.
    const storedProjection = (r: NonNullable<Awaited<ReturnType<typeof draftsRow>>>) => ({
      raw_findings: r.rawFindings,
      impression: r.impression,
      recommendation: r.recommendation,
      study_id: r.studyId,
      worklist_id: r.worklistId,
      updated_at: r.updatedAt.toISOString(),
    });
    const snapshot = storedProjection(baselineRow!);

    // (4) The accepted AI draft, persisted the way the workspace persists it:
    // composer tag, the revision it read, and the study the row is linked to.
    const applied = await saveDraft({
      id: draftId,
      studyId: otherStudy,
      worklistId: studyKey,
      patientId,
      modality: "MRI",
      studyName: "MRI Brain",
      clinicalHistory: "Headache for three weeks.",
      rawFindings: AI_FINDINGS,
      impression: ["AI ACCEPTED IMPRESSION — probable left MCA infarct."],
      recommendation: "Urgent clinical correlation.",
      composer: {
        jobId: job.id,
        previous: { findings: "", impression: "", recommendation: "" },
      },
      expectedRevision: revision,
    });

    // The refusal did happen — that part of the claim is measured, not assumed.
    expect(applied.status, applied.text).toBe(409);
    expect((applied.body as { code?: string }).code, applied.text).toBe("compose_persistence_unavailable");
    expect(String((applied.body as { message?: string }).message ?? applied.text)).toContain("Nothing was changed");

    // THE LOAD-BEARING ASSERTION — written for the SAFE behaviour ("Nothing was
    // changed" must be true), so it fails while a `return` commits the write.
    const after = await draftsRow(draftId);
    expect(
      storedProjection(after!),
      `the refused composer save had already committed (HTTP ${applied.status} ${JSON.stringify(
        applied.body,
      )}); this study key = ${studyKey}, the save named study_id ${otherStudy}`,
    ).toEqual(snapshot);

    // The job's receipt column is untouched (this part passes — the refusal ran
    // before any receipt write, which is exactly why the message claims nothing
    // happened).
    const [jobAfter] = await db
      .select()
      .from(aiReportComposeJobsTable)
      .where(eq(aiReportComposeJobsTable.id, job.id))
      .limit(1);
    expect(jobAfter.appliedPersistedToken).toBeNull();
  });
});

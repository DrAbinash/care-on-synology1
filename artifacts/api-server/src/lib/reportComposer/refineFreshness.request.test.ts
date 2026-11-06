/**
 * Refine freshness at the wire — real routes, real Postgres.
 *
 * THE FAULT, AS MEASURED IN A BROWSER (synthetic CT Brain study 5 of the Word
 * replacement rig, `qwen3:14b`, job 181, `job_kind = SECTION_EDIT`): the draft
 * arrived, the badge said AI STALE, and Apply stayed disabled although
 * `reportRevision` matched on both sides. The tab's freshness recomputation is a
 * second snapshot builder, and it dropped the fields that describe the REQUEST —
 * the instruction typed into the Refine box (105 chars) and the text that was
 * selected (518 chars) — while `input_hash` still covers them. So the tab hashed
 * a snapshot that was never the one the model was shown, permanently.
 *
 * THE FIX THIS FILE CHECKS: the job view hands those fields back
 * (`requestScopeOf` → `publicJobView.requestScope`) and the tab folds them in
 * before hashing (`liveComposeSnapshot`). Unit-level equivalence of the two hash
 * implementations lives in `diagnostic-erp/src/lib/reportComposer/refineFreshness.test.ts`;
 * this file proves the parts only a live server can prove — that the view really
 * carries the scope, that the route really accepts the corrected recomputation,
 * and that READY does not flip to STALE_READY for a report nobody touched.
 *
 * THE OTHER HALF, NON-NEGOTIABLE: a draft that IS outdated must still be
 * refused. Cases 4-7 change the protocol, the narrative, the observation
 * ledger and the key-image selection under a live Refine draft and assert the
 * route still flips it to STALE_READY, so this fix cannot quietly become the
 * removal of the check.
 *
 * Skips without a database, like every other `*.request.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  patientsTable,
  portalSessionsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { computeSnapshotHashes, requestScopeOf } from "./snapshot";
import type { ComposerInputSnapshot } from "./types";

const marker = `vitest-refine-${randomUUID().slice(0, 8)}`;
const uid = (tag: string) => `1.2.826.refine.${marker}.${tag}`;

const FINDINGS = [
  "Grey-White Differentiation:",
  "Maintained.",
  "",
  "Parenchyma:",
  "No focal hypo- or hyperdensity. No haemorrhage or infarct.",
].join("\n");
const INSTRUCTION = "Make this sentence shorter and plainer, keep every clinical fact.";
const SELECTION = "FINDINGS:\nGrey-White Differentiation:\nMaintained.";

/** A Refine request as the workspace freezes it. `findings` is unique per case
 *  so no two cases collapse onto one job. */
function refineSnapshot(overrides: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return {
    studyId: null,
    worklistId: null,
    reportId: null,
    modality: "CT",
    region: "CT Brain Plain",
    regions: ["CT Brain Plain"],
    bodyPart: "BRAIN",
    family: "brain",
    protocol: "CT Brain Plain",
    reportTitle: "CT Brain",
    studyType: "CT Brain Plain",
    clinicalHistory: "",
    technique: "Axial non-contrast CT of the brain, skull base to vertex.",
    findings: FINDINGS,
    impression: "Normal CT Brain. No acute intracranial pathology.",
    recommendation: "Clinical correlation is advised.",
    observations: [],
    jobKindHint: "SECTION_EDIT",
    aiMode: "TEXT_ONLY",
    selectedKeyImages: [],
    instruction: INSTRUCTION,
    selectionText: SELECTION,
    selectionField: "FINDINGS",
    ...overrides,
  } as ComposerInputSnapshot;
}

/** The fields the tab can still see after the draft lands — what
 *  `useReportComposer` rebuilds. selectionText / instruction / templateSections /
 *  additionalReports are NOT here, because the tab no longer holds them. */
function liveTabState(snap: ComposerInputSnapshot): ComposerInputSnapshot {
  return {
    modality: snap.modality,
    region: snap.region,
    regions: snap.regions,
    bodyPart: snap.bodyPart,
    family: snap.family,
    spineSegment: snap.spineSegment,
    studyType: snap.studyType,
    protocol: snap.protocol,
    reportTitle: snap.reportTitle,
    clinicalHistory: snap.clinicalHistory,
    technique: snap.technique,
    findings: snap.findings,
    impression: snap.impression,
    recommendation: snap.recommendation,
    observations: snap.observations,
    jobKindHint: snap.jobKindHint,
    aiMode: snap.aiMode,
    selectedKeyImages: snap.selectedKeyImages,
  } as ComposerInputSnapshot;
}

describe.skipIf(!hasDatabaseUrl())("Composer Refine freshness (request level)", () => {
  let app: Express;
  let token = "";
  const jobIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  const patientIds: number[] = [];
  const userIds: number[] = [];

  /** Seed a READY Refine job exactly the way `enqueueComposeJob` writes one:
   * frozen snapshot, the hashes of that snapshot, and one reviewable change. */
  async function seedReadyRefineJob(
    snapshot: ComposerInputSnapshot,
    worklistId: number,
  ) {
    const hashes = computeSnapshotHashes(snapshot);
    const [row] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        studyId: snapshot.studyId ?? null,
        worklistId,
        reportId: null,
        jobKind: "SECTION_EDIT",
        status: "READY",
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
            changeType: "REPHRASE",
            field: "FINDINGS",
            originalText: "Grey-White Differentiation:\nMaintained.",
            proposedText: "Grey-white matter differentiation is preserved.",
            reviewState: "PENDING",
            clinicalSignificance: false,
            clinicalSignificanceReasons: [],
            createdAt: new Date().toISOString(),
          },
        ]),
        proposedFindings: snapshot.findings ?? "",
        model: "qwen3:14b",
        completedAt: new Date(),
        priority: 40,
      })
      .returning();
    jobIds.push(row.id as number);
    return { id: row.id as number, hashes };
  }

  async function freshnessBody(
    live: ComposerInputSnapshot,
    scope: ReturnType<typeof requestScopeOf> | null | undefined,
  ) {
    const hashes = computeSnapshotHashes({ ...live, ...(scope ?? {}) });
    return {
      findings: live.findings ?? "",
      impression: live.impression ?? "",
      recommendation: live.recommendation ?? "",
      reportRevision: hashes.reportRevision,
      inputHash: hashes.inputHash,
    };
  }

  async function jobRow(id: number) {
    const [row] = await db
      .select()
      .from(aiReportComposeJobsTable)
      .where(inArray(aiReportComposeJobsTable.id, [id]));
    return row;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Vitest Refine Radiologist ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology", "ai_reporting.use"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userIds.push(user.id as number);
    token = `vitest-token-${randomUUID()}`;
    await db
      .insert(portalSessionsTable)
      .values({
        token,
        scope: "staff",
        subjectId: user.id,
        subjectName: user.name,
        expiresAt: new Date(Date.now() + 3600_000),
      });

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `MRN-${marker}`,
        firstName: "Synthetic",
        lastName: "Refine",
        dateOfBirth: "1970-01-01",
        gender: "F",
        phone: "0000000000",
      })
      .returning();
    patientIds.push(patient.id as number);
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${marker}`,
        patientId: patient.id,
        testId: 1,
        modality: "CT",
        department: "CT",
        status: "acquired",
        studyInstanceUid: uid("study"),
      })
      .returning();
    studyIds.push(study.id as number);
    const [worklist] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Synthetic^${marker}`,
        modality: "CT",
        studyDescription: "CT Brain Plain",
        studyInstanceUID: uid("wl"),
        accessionNumber: `SYNACC-${marker}`,
        patientId: patient.id,
        studyId: study.id,
        patientMatchStatus: "MATCHED",
        status: "REPORT_DRAFTED",
      })
      .returning();
    worklistIds.push(worklist.id as number);
  });

  afterAll(async () => {
    if (jobIds.length) await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, jobIds));
    if (worklistIds.length) await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, worklistIds));
    if (studyIds.length) await db.delete(radiologyStudiesTable).where(inArray(radiologyStudiesTable.id, studyIds));
    if (patientIds.length) await db.delete(patientsTable).where(inArray(patientsTable.id, patientIds));
    if (userIds.length) {
      await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.subjectId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  it("1. the job view hands back the request scope the tab cannot rebuild", async () => {
    const frozen = refineSnapshot({ findings: `Refine 1\n${FINDINGS}` });
    const { id } = await seedReadyRefineJob(frozen, worklistIds[0]);
    const res = await request(app)
      .get(`/api/radiology/report-composer/jobs/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("READY");
    expect(res.body.job.requestScope).toMatchObject({
      instruction: INSTRUCTION,
      selectionText: SELECTION,
    });
    // The full clinical snapshot is still not returned — only the four request
    // fields. Clinical history, technique and the observation ledger stay server-side.
    expect(res.body.job.findings).toBeUndefined();
    expect(res.body.job.technique).toBeUndefined();
    expect(res.body.job.inputSnapshotJson).toBeUndefined();
  });

  it("2. an unchanged report no longer invalidates its own Refine draft", async () => {
    const frozen = refineSnapshot({ findings: `Refine 2\n${FINDINGS}` });
    const { id } = await seedReadyRefineJob(frozen, worklistIds[0]);
    const view = await request(app)
      .get(`/api/radiology/report-composer/jobs/${id}`)
      .set("Authorization", `Bearer ${token}`);
    const body = await freshnessBody(liveTabState(frozen), view.body.job.requestScope);

    const res = await request(app)
      .post(`/api/radiology/report-composer/jobs/${id}/freshness`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(false);
    expect(res.body.status).toBe("READY");
    expect((await jobRow(id)).status).toBe("READY");
  });

  it("3. the pre-fix recomputation is what flagged it — same job, live fields only", async () => {
    const frozen = refineSnapshot({ findings: `Refine 3\n${FINDINGS}` });
    const { id } = await seedReadyRefineJob(frozen, worklistIds[0]);
    const body = await freshnessBody(liveTabState(frozen), null);

    const res = await request(app)
      .post(`/api/radiology/report-composer/jobs/${id}/freshness`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(res.body.stale).toBe(true);
    expect(res.body.status).toBe("STALE_READY");
    expect((await jobRow(id)).status).toBe("STALE_READY");
  });

  it("4. a draft is still stale when the study identity changes under it", async () => {
    const frozen = refineSnapshot({ findings: `Refine 4\n${FINDINGS}` });
    const { id } = await seedReadyRefineJob(frozen, worklistIds[0]);
    const view = await request(app)
      .get(`/api/radiology/report-composer/jobs/${id}`)
      .set("Authorization", `Bearer ${token}`);
    // Plain → Contrast with the narrative and the observations untouched: only
    // the study-context axis can see this.
    const body = await freshnessBody(
      liveTabState(refineSnapshot({ findings: `Refine 4\n${FINDINGS}`, protocol: "CT Brain Contrast" })),
      view.body.job.requestScope,
    );
    expect(body.reportRevision).toBe(
      computeSnapshotHashes(refineSnapshot({ findings: `Refine 4\n${FINDINGS}` })).reportRevision,
    );

    const res = await request(app)
      .post(`/api/radiology/report-composer/jobs/${id}/freshness`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(res.body.stale).toBe(true);
    expect(res.body.status).toBe("STALE_READY");
  });

  it("5. a draft is still stale when the radiologist edits the report while the model thinks", async () => {
    const frozen = refineSnapshot({ findings: `Refine 5\n${FINDINGS}` });
    const { id } = await seedReadyRefineJob(frozen, worklistIds[0]);
    const view = await request(app)
      .get(`/api/radiology/report-composer/jobs/${id}`)
      .set("Authorization", `Bearer ${token}`);
    const edited = refineSnapshot({
      findings: `Refine 5\n${FINDINGS}\n\nAdditional: A 6 mm right frontal hyperdensity, likely calcified.`,
      impression: "Normal CT Brain plus an incidental right frontal calcification.",
    });
    const res = await request(app)
      .post(`/api/radiology/report-composer/jobs/${id}/freshness`)
      .set("Authorization", `Bearer ${token}`)
      .send(await freshnessBody(liveTabState(edited), view.body.job.requestScope));
    expect(res.body.stale).toBe(true);
  });

  it("6. a laterality flip inside one observation still blocks, with the prose unchanged", async () => {
    const withObservation = refineSnapshot({
      findings: `Refine 6\n${FINDINGS}`,
      observations: [
        {
          concept: "renal_calcus",
          region: "kidney",
          laterality: "left",
          source: "quick-select",
          findingsText: "A calculus is present in the kidney.",
        },
      ],
    });
    const { id } = await seedReadyRefineJob(withObservation, worklistIds[0]);
    const view = await request(app)
      .get(`/api/radiology/report-composer/jobs/${id}`)
      .set("Authorization", `Bearer ${token}`);
    const flipped = refineSnapshot({
      findings: `Refine 6\n${FINDINGS}`,
      observations: [
        {
          concept: "renal_calcus",
          region: "kidney",
          laterality: "right",
          source: "quick-select",
          findingsText: "A calculus is present in the kidney.",
        },
      ],
    });
    const res = await request(app)
      .post(`/api/radiology/report-composer/jobs/${id}/freshness`)
      .set("Authorization", `Bearer ${token}`)
      .send(await freshnessBody(liveTabState(flipped), view.body.job.requestScope));
    expect(res.body.stale).toBe(true);
  });

  it("7. attaching a key image to the request after the draft blocks it", async () => {
    const frozen = refineSnapshot({ findings: `Refine 7\n${FINDINGS}` });
    const { id } = await seedReadyRefineJob(frozen, worklistIds[0]);
    const view = await request(app)
      .get(`/api/radiology/report-composer/jobs/${id}`)
      .set("Authorization", `Bearer ${token}`);
    const imaged = refineSnapshot({
      findings: `Refine 7\n${FINDINGS}`,
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [{ keyImageId: 41, caption: "Axial FLAIR" }],
    });
    const res = await request(app)
      .post(`/api/radiology/report-composer/jobs/${id}/freshness`)
      .set("Authorization", `Bearer ${token}`)
      .send(await freshnessBody(liveTabState(imaged), view.body.job.requestScope));
    expect(res.body.stale).toBe(true);
  });
});

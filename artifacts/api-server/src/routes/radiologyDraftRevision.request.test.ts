/**
 * P0-2 — a draft save must not overwrite a report that moved underneath it.
 *
 * Reproduced in the browser audit on build 7c9424b7: two consoles on one study
 * (worklist 622, draft 344, opened through a URL so the filtered reading queue
 * held no row for it) both received HTTP 200 from POST /save-draft ~200 ms
 * apart. Console A's sentence was committed; console B's save replaced it; A's
 * text was gone from the row and nothing on either screen said so. The study was
 * off the queue filter, so it never claimed a write lock and the lock guard at
 * `save-draft` had nothing to refuse.
 *
 * What these tests pin is the server's own answer, not the browser's opinion:
 *
 *   * every save and every read carries a `revision` the SERVER derived from the
 *     row — a content fingerprint, not a clock, because `updated_at` is rewritten
 *     by the route's own structured_json patch after `.returning()` and so cannot
 *     identify the row a client last saw;
 *   * a save that names the revision it was working from writes, and answers with
 *     the next one;
 *   * a save that names a revision the row no longer holds is refused with
 *     DRAFT_REVISION_CONFLICT and writes nothing — the winner's text stays;
 *   * the fingerprint covers the structured envelope too, so a console that only
 *     changed measurements still moves the revision, and a stale narrative save
 *     cannot roll that measurement back;
 *   * a save that names NO revision is an old surface (or a surface that never
 *     read) and behaves exactly as it does today — this ticket adds a guard, it
 *     does not hold any existing writer hostage to it.
 *
 * Skip automatically when DATABASE_URL is not exported.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  portalSessionsTable,
  patientsTable,
  radiologyReportDraftsTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { DRAFT_REVISION_CONFLICT } from "../lib/radiologyDraftRevision";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const marker = `draftrev-${randomUUID().slice(0, 8)}`;

/** The revision a client sends when it read the study and there was no draft row. */
const ABSENT = "absent";

describe.skipIf(!dbReady)("radiology draft revision — request level", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  let patientId = 0;
  const worklistIds: number[] = [];
  const composeJobIds: number[] = [];

  const saveDraft = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/radiology/report-generator/save-draft")
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  const reload = (worklistId: number) =>
    request(app)
      .get("/api/radiology/report-generator/drafts")
      .query({ studyId: worklistId })
      .set("Authorization", `Bearer ${token}`);

  async function storedRow(worklistId: number): Promise<Record<string, unknown>> {
    const rows = await db
      .select()
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.studyId, worklistId))
      .orderBy(desc(radiologyReportDraftsTable.updatedAt))
      .limit(1);
    return (rows[0] ?? {}) as unknown as Record<string, unknown>;
  }

  const draftRowCount = async (worklistId: number) =>
    (await db
      .select({ id: radiologyReportDraftsTable.id })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.studyId, worklistId))).length;

  function body(worklistId: number, findings: string, extra: Record<string, unknown> = {}) {
    return {
      studyId: worklistId,
      worklistId,
      patientId,
      clinicalHistory: "Headache for three weeks.",
      technique: "MRI of the brain performed on a 1.5T scanner without contrast.",
      rawFindings: findings,
      impression: ["No acute intracranial abnormality."],
      recommendation: "Please correlate with clinical findings.",
      ...extra,
    };
  }

  /** One ledger patch — the structured envelope a measurements-only save changes. */
  function ledgerWith(value: number) {
    return {
      kind: "care.observation_ledger.v1",
      version: 1,
      patches: [{
        id: "qs-tile-measured",
        observation: { concept: "canal_stenosis", level: "L4-L5", role: "finding" },
        templates: { findings: "Canal AP diameter measured.", impression: "" },
        lastRendered: { findings: "Canal AP diameter measured.", impression: "" },
        replacedBaseline: { findings: [], impression: [] },
        source: "quick-select",
        protected: false,
      }],
      viewerValue: value,
    };
  }

  async function newWorklist(label: string): Promise<number> {
    const suffix = randomUUID().slice(0, 8);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Synthetic Concurrent",
        modality: "MR",
        studyDescription: "MRI Brain",
        studyInstanceUID: `1.2.840.${label}.${suffix}`,
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

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Draft Revision ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology", "/report-generator"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    token = `vitest-rev-${marker}`;
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
        patientId: `REV-${marker}`,
        firstName: "Synthetic",
        lastName: "Concurrent",
        dateOfBirth: "1970-01-01",
        gender: "M",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;
  }, 60_000);

  afterAll(async () => {
    if (composeJobIds.length) {
      await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, composeJobIds));
    }
    if (worklistIds.length) {
      const drafts = await db
        .select({ id: radiologyReportDraftsTable.id })
        .from(radiologyReportDraftsTable)
        .where(inArray(radiologyReportDraftsTable.studyId, worklistIds));
      if (drafts.length) {
        await db.delete(radiologyReportDraftsTable).where(inArray(radiologyReportDraftsTable.id, drafts.map((d) => d.id)));
      }
      await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, worklistIds));
    }
    if (patientId) await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, userId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("1. a save answers with the revision of the row it wrote, and GET /drafts agrees with it", async () => {
    const wl = await newWorklist("r1");
    const saved = await saveDraft(body(wl, "No acute intracranial abnormality is seen."));
    expect(saved.status, JSON.stringify(saved.body ?? {})).toBe(200);
    const revision = (saved.body as { revision?: string }).revision;
    expect(typeof revision, "the save must hand the client a revision to save against").toBe("string");
    expect(revision).not.toBe(ABSENT);

    const read = await reload(wl);
    expect(read.status).toBe(200);
    const row = (read.body as { drafts: Record<string, unknown>[] }).drafts[0];
    // One derivation, two surfaces: a client that hydrated from the read must be
    // able to save with the token it got, so the read's token cannot be a
    // different function of the same row than the save's.
    expect(String(row.revision)).toBe(String(revision));
  });

  it("2. a save naming the current revision writes and advances it", async () => {
    const wl = await newWorklist("r2");
    const first = await saveDraft(body(wl, "First sentence."));
    const revision = (first.body as { revision: string }).revision;

    const second = await saveDraft({
      ...body(wl, "First sentence. Repeat visit, symptoms worse."),
      id: (first.body as { draft: { id: number } }).draft.id,
      expectedRevision: revision,
    });
    expect(second.status, JSON.stringify(second.body ?? {})).toBe(200);
    const next = (second.body as { revision: string }).revision;
    expect(next).not.toBe(revision);

    const row = await storedRow(wl);
    expect(String(row.rawFindings)).toBe("First sentence. Repeat visit, symptoms worse.");
  });

  it("3. a stale save is refused and the winner's text stays in the row", async () => {
    const wl = await newWorklist("r3");
    const opened = await saveDraft(body(wl, "Shared starting text."));
    const baseline = (opened.body as { revision: string }).revision;
    const draftId = (opened.body as { draft: { id: number } }).draft.id;

    // Console A saves first.
    const a = await saveDraft({ ...body(wl, "ALPHA — console A's sentence."), id: draftId, expectedRevision: baseline });
    expect(a.status, JSON.stringify(a.body ?? {})).toBe(200);

    // Console B, still holding the baseline, saves second. This is the exact
    // request the audit measured answering 200 while erasing A's sentence.
    const b = await saveDraft({ ...body(wl, "BETA — console B's sentence."), id: draftId, expectedRevision: baseline });
    expect(b.status, "a save that would silently overwrite newer text must be refused").toBe(409);
    expect((b.body as { code?: string }).code).toBe("DRAFT_REVISION_CONFLICT");

    const row = await storedRow(wl);
    expect(String(row.rawFindings)).toBe("ALPHA — console A's sentence.");
    expect(String(row.rawFindings)).not.toContain("BETA");
    expect(await draftRowCount(wl)).toBe(1);
  });

  it("4. a measurement-only save moves the revision, so a stale narrative save cannot roll it back", async () => {
    const wl = await newWorklist("r4");
    const opened = await saveDraft({
      ...body(wl, "Same narrative in both consoles."),
      observationLedger: ledgerWith(8.2),
    });
    const baseline = (opened.body as { revision: string }).revision;
    const draftId = (opened.body as { draft: { id: number } }).draft.id;

    // Console A changes only the structured envelope — the narrative is identical.
    const a = await saveDraft({
      ...body(wl, "Same narrative in both consoles."),
      id: draftId,
      observationLedger: ledgerWith(6.1),
      expectedRevision: baseline,
    });
    expect(a.status, JSON.stringify(a.body ?? {})).toBe(200);
    expect(((await storedRow(wl)).structuredJson as { careObservationLedger?: { viewerValue?: number } })
      ?.careObservationLedger?.viewerValue).toBe(6.1);

    // Console B, holding the pre-measurement revision and the same narrative,
    // must not be allowed to write: identical prose is not an unchanged report.
    const b = await saveDraft({
      ...body(wl, "Same narrative in both consoles."),
      id: draftId,
      observationLedger: ledgerWith(8.2),
      expectedRevision: baseline,
    });
    expect(b.status, "an unchanged narrative is not proof the report did not move").toBe(409);
    expect(((await storedRow(wl)).structuredJson as { careObservationLedger?: { viewerValue?: number } })
      ?.careObservationLedger?.viewerValue).toBe(6.1);
  });

  it("5. a first save that said “no draft yet” is refused when a row appeared in between", async () => {
    const wl = await newWorklist("r5");
    const read = await reload(wl);
    expect(((read.body as { drafts: unknown[] }).drafts) ?? []).toHaveLength(0);

    // Two consoles open an unbilled study at once and both autosave.
    const first = await saveDraft({ ...body(wl, "Console A created the row."), expectedRevision: ABSENT });
    expect(first.status, JSON.stringify(first.body ?? {})).toBe(200);

    const second = await saveDraft({ ...body(wl, "Console B created the row."), expectedRevision: ABSENT });
    expect(second.status, "a second INSERT for one study would fork the report").toBe(409);
    expect((second.body as { code?: string }).code).toBe("DRAFT_REVISION_CONFLICT");
    expect(await draftRowCount(wl)).toBe(1);
    expect(String((await storedRow(wl)).rawFindings)).toBe("Console A created the row.");
  });

  it("6. negative control — a save naming no revision is untouched by this guard", async () => {
    const wl = await newWorklist("r6");
    const opened = await saveDraft(body(wl, "Written by an older surface."));
    expect(opened.status, JSON.stringify(opened.body ?? {})).toBe(200);
    const draftId = (opened.body as { draft: { id: number } }).draft.id;

    // RadiologyReportGenerator and every other existing writer keep sending no
    // expectedRevision; their last write still wins, exactly as before.
    const legacy = await saveDraft({ ...body(wl, "Legacy surface overwrote it."), id: draftId });
    expect(legacy.status, JSON.stringify(legacy.body ?? {})).toBe(200);
    expect(String((await storedRow(wl)).rawFindings)).toBe("Legacy surface overwrote it.");
  });

  it("7. refusal survives the signed-report guard in the right order", async () => {
    // A stale revision on a study whose draft is finalized must stay refused for
    // the reason the radiologist can act on: the report is signed, not conflicted.
    const wl = await newWorklist("r7");
    const opened = await saveDraft(body(wl, "Signed study text."));
    const revision = (opened.body as { revision?: string }).revision ?? "unknown";
    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "FINAL" })
      .where(eq(radiologyReportDraftsTable.id, (opened.body as { draft: { id: number } }).draft.id));

    const res = await saveDraft({
      ...body(wl, "Attempt to edit a signed report."),
      id: (opened.body as { draft: { id: number } }).draft.id,
      expectedRevision: revision,
    });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe("REPORT_LOCKED");
  });

  /**
   * A compose job for this study with NO server-captured baseline. That is the
   * shape `authoriseComposeSaveTx` answers `{ proceed: "ordinary" }` to — the
   * save is allowed to write, and it is the shape every AI Apply takes when the
   * job row exists but its baseline was never persisted. The revision guard must
   * still apply, because the guard is about the ROW, not about the job.
   */
  async function newComposeJob(worklistId: number): Promise<number> {
    const [job] = await db
      .insert(aiReportComposeJobsTable)
      .values({
        worklistId,
        jobKind: "FULL_REPORT",
        status: "COMPLETED",
        sourceReportRevision: "vitest",
        sourceFindingsHash: "vitest",
        sourceImpressionHash: "vitest",
        inputHash: "vitest",
        inputSnapshotJson: "{}",
        sourcePersistedToken: null,
      })
      .returning();
    composeJobIds.push(job.id);
    return job.id;
  }

  const composerTag = (jobId: number) => ({
    jobId,
    previous: { findings: "", impression: "", recommendation: "" },
  });

  it("8. an AI Apply must not overwrite a report that moved underneath it", async () => {
    // The audit's finding: `save-draft` puts the compare-and-set in the `else`
    // of the composer branch, so a save carrying `composer` — which is exactly
    // what `useWorkspaceClinicalUi.persistAccepted` sends — writes unconditionally
    // whatever revision the client named. The client does name one
    // (`useDraftPersistence` always includes `expectedRevision`), and the server
    // throws it away. Measured here as a 200 plus the other console's sentence
    // gone from the row.
    const wl = await newWorklist("r8");
    const jobId = await newComposeJob(wl);

    const first = await saveDraft(body(wl, "A sentence from console A."));
    const draftId = (first.body as { draft: { id: number } }).draft.id;
    const staleRevision = (first.body as { revision: string }).revision;
    const second = await saveDraft({ ...body(wl, "Console B saved after A."), id: draftId });
    expect(second.status).toBe(200);

    const apply = await saveDraft({
      ...body(wl, "AI accepted text overwrites B."),
      id: draftId,
      composer: composerTag(jobId),
      expectedRevision: staleRevision,
    });

    expect(apply.status, "a stale AI Apply must be refused, not absorbed").toBe(409);
    expect((apply.body as { code?: string }).code).toBe(DRAFT_REVISION_CONFLICT);
    expect(String((await storedRow(wl)).rawFindings), "the winner's text must stay in the row")
      .toBe("Console B saved after A.");
    expect(await draftRowCount(wl)).toBe(1);
  });

  it("9. an AI Apply naming the current revision still writes — the fix must not cost the workflow", async () => {
    const wl = await newWorklist("r9");
    const jobId = await newComposeJob(wl);
    const opened = await saveDraft(body(wl, "The normal report the radiologist reviewed."));
    const draftId = (opened.body as { draft: { id: number } }).draft.id;
    const revision = (opened.body as { revision: string }).revision;

    const apply = await saveDraft({
      ...body(wl, "AI accepted text, current revision."),
      id: draftId,
      composer: composerTag(jobId),
      expectedRevision: revision,
    });

    expect(apply.status, JSON.stringify(apply.body ?? {})).toBe(200);
    expect(String((await storedRow(wl)).rawFindings)).toBe("AI accepted text, current revision.");
    // And the apply hands back a revision the editor can save against next, so
    // the very next autosave is not refused for its own write.
    const after = (apply.body as { revision?: string }).revision;
    expect(typeof after).toBe("string");
    expect(after).not.toBe(revision);
    const follow = await saveDraft({
      ...body(wl, "Manual edit after the apply."),
      id: draftId,
      composer: composerTag(jobId),
      expectedRevision: after,
    });
    expect(follow.status, JSON.stringify(follow.body ?? {})).toBe(200);
    expect(await draftRowCount(wl)).toBe(1);
  });
});

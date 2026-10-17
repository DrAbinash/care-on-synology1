/**
 * RIS-010 — the PACS archive's transaction and retry rules, enforced against real PostgreSQL.
 *
 * One successful archive run writes FOUR records that have to agree about the same object:
 *   1. `radiology_studies.pacs_archive_status` / `pacs_archive_response` / `pacs_instance_id`
 *   2. `radiology_pacs_archive_revisions` (one row per archived REVISION, UNIQUE(report_id))
 *   3. `radiology_audit_log` (PACS_ARCHIVE_PENDING → ORTHANC_UPLOAD_SUCCESS | _FAILURE, plus the
 *      REFUSED / IDEMPOTENT_NOOP / RESTORE_FORCED entries this file adds)
 *   4. the DICOM object itself (the `/tools/create-dicom` POST and its tags)
 * `pacsArchive.d8.test.ts` cannot read them together — its `db` mock discards the `where` argument it
 * is given (its own comment says so), which is why the RIS-005 association defect survived it.
 * `pacsArchive.reportScope.request.test.ts` proves the SQL pick but stops before the upload.
 *
 * EDGES THAT ARE STUBBED, AND WHY: the Chromium PDF rasteriser and the Orthanc HTTP endpoint. Both are
 * external to the transaction under test — one turns HTML into bytes, the other accepts a DICOM object.
 * Everything that decides *what the clinic's PACS ends up holding and what the ERP believes about it*
 * runs for real against PostgreSQL: the SQL pick, the eligibility policy, `buildReportArtifact` and the
 * amendment-chain version resolution, the status writes, the revision upsert and supersede sweep, the
 * audit rows, the study advisory lock, and the durable job queue's claim/execute cycle. The stubbed
 * rasteriser records the HTML it was handed, so what went into the object is asserted instead of
 * inferred — including the negative: that a placeholder never reaches it.
 *
 * THE CASES ARE THE OWNER'S APPROVED POLICIES (2026-10-17), numbered as he numbered them:
 *   1  a signed report archives successfully;
 *   2  an unsigned draft is refused                   (DECISION 1 — reuse usgPacsReturnPolicy)
 *   3  an examination with no report is refused       (DECISION 2 — never a placeholder)
 *   4  ordinary Retry after success uploads nothing   (DECISION 3 — return the existing result)
 *   5  Retry after a failed upload does a real upload (DECISION 3)
 *   6  two concurrent runs cannot both upload         (DECISION 5 — PostgreSQL advisory lock)
 *   7  an amended signed report archives as a new revision, and 8 the previous version stays traceable
 *      (DECISION 1 — preserve amendment/versioning behaviour)
 *   8b a retired revision cannot become this study's archived report (DECISION 1, in the one shape the
 *      archive can actually reach: the bound row was superseded by an amendment it cannot see)
 *   9  another patient's or another examination's report is refused (standing invariant, in its
 *      end-to-end form at this entrypoint)
 *  10  a missing Orthanc endpoint cannot report success (a DICOM transfer is not successful merely
 *      because a request completed — and an attempted one is not successful at all)
 *  11  a revision recorded as archived is never re-uploaded, even when the study summary was lost
 *      (DECISION 6)
 *  12  existing authorized legacy reports stay eligible, in both storage shapes (DECISION 1's caveat)
 * plus DECISION 4's admin-authorized restore, and the durable job's agreement with every outcome.
 *
 * WHAT CHANGED SINCE THE MEASUREMENT PASS, STATED PLAINLY: the previous version of this file recorded
 * cases 2, 3, 4 and 6 as measured *gaps* — a draft archived with only a `DRAFT (not signed)` label, a
 * placeholder filed as a success with no revision row, a second copy of an unchanged revision, two runs
 * overlapping. Those assertions were true at `877701f9`. The owner has since ruled that each is wrong,
 * so this file asserts the rule instead of the defect. Nothing was weakened to make it pass: every
 * refusal writes a status, an audit entry and a job result, and the positive controls (1, 5, 7, 12)
 * still archive for real.
 *
 * STILL NOT MEASURED, and deliberately not faked: making the ERP write itself throw after Orthanc
 * accepted the object. Case 11 asserts the STATE such a failure leaves — revision recorded (it is now
 * written first), study summary lost — and that the archive then refuses to duplicate it. Producing the
 * fault itself needs a temporary trigger on `radiology_studies`, a table every other suite in this repo
 * shares, so it is not attempted here. Mutant N10 of the RIS-010 battery proves the consequence: the
 * accepted-then-unrecorded branch can be replaced by a plain failure and this suite stays green, so the
 * ORDER of those two writes is currently defended by code reading only, not by a run.
 *
 * THREE CONSEQUENCES OF THE REUSED POLICY THAT A REVIEWER SHOULD NOT MISS:
 *   · a legacy free-text final (`radiology_studies.final_report`, no `patient_reports` row) has no
 *     revision identity, so it cannot be idempotency-keyed — re-archiving one uploads again. Case 12
 *     asserts the archive still produces it and asserts the missing row, rather than hiding it.
 *   · `planUsgPacsReturn` also blocks a study with no StudyInstanceUID and a non-compliant obstetric
 *     Form-F. Those studies now refuse where they previously archived; fail-closed, but a behaviour
 *     change the owner must see.
 *   · the `DRAFT (not signed)` label at patient-reports.ts:3288-3290 is asserted by nothing anywhere in
 *     the repo (both reportPresentation tests use their own stamp fixture), and DECISION 1 makes it
 *     unreachable from the archive. Renaming it is mutant M5, which survives by design and is recorded
 *     as a presentation-layer gap rather than fixed inside RIS-010.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { asc, eq, inArray, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable,
  dicomRetryQueueTable,
  formFRecordsTable,
  orderTestsTable,
  ordersTable,
  patientReportAmendmentsTable,
  patientReportsTable,
  patientsTable,
  portalSessionsTable,
  radiologyAuditLogTable,
  radiologyPacsArchiveRevisionsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

const edge = vi.hoisted(() => ({
  /** HTML the archive handed to the PDF rasteriser, in call order. */
  rendered: [] as string[],
  /** Every `/tools/create-dicom` POST, with the DICOM tags it carried. */
  posts: [] as { tags: Record<string, string>; contentLength: number }[],
  orthancUrl: "http://orthanc-stub:8042/dicom-web",
  rejectNextUpload: false,
  /** Makes the rasteriser take real time, so case 6's two runs overlap for a reason. */
  renderDelayMs: 0,
  seq: 0,
}));

// V6 drives the federated bridge's REAL route. `boundary.ts:47` captures the key at module load, so the
// environment has to carry it before this file's import graph runs — a hoisted block is the only place
// that is guaranteed to happen first.
vi.hoisted(() => {
  process.env.BOUNDARY_API_KEY = "ris10-boundary-key-for-tests";
});
const BOUNDARY_KEY = String(process.env.BOUNDARY_API_KEY);

vi.mock("playwright", () => ({
  chromium: {
    launch: async () => ({
      newPage: async () => ({
        setContent: async (html: string) => {
          if (edge.renderDelayMs > 0) {
            await new Promise((r) => setTimeout(r, edge.renderDelayMs));
          }
          edge.rendered.push(html);
        },
        pdf: async () => Buffer.from("STUB-PDF-BYTES"),
      }),
      close: async () => undefined,
    }),
  },
}));

vi.mock("./pacs/pacsConfig", () => ({
  getRadiologyConfig: async () => ({ orthanc: { dicomWebUrl: edge.orthancUrl } }),
}));

import { archiveReportToPacs, resolveArchiveReportRow } from "./pacsArchive";
import { enqueueRadiologyJob, getRadiologyJobById, runRadiologyJobTick } from "./radiologyJobs";
import { PACS_REARCHIVE_JOB, RADIOLOGY_JOB_HANDLERS } from "./radiologyJobHandlers";
import { decideFailure } from "./radiologyJobRules";

const NO_REPORT = "No finalized signed report available for this examination.";
const RESTORE_TOKEN = "REPAIR-restore_archived_report";
const RESTORE_REASON = "Orthanc volume was rebuilt from backup; the archived instance is gone";

type Fixture = {
  patientId: number;
  patientDisplayId: string;
  testId: number;
  orderId: number;
  billId: number;
  orderTestId: number;
  studyId: number;
  worklistId: number;
  accession: string;
  studyUid: string;
  reportIds: number[];
  jobKeys: string[];
};

const made: Fixture[] = [];

async function person(tag: string): Promise<{ id: number; displayId: string }> {
  const displayId = `RIS10-${RUN}-${tag}`;
  const [p] = await db
    .insert(patientsTable)
    .values({
      patientId: displayId,
      firstName: `Archive ${tag}`,
      lastName: RUN,
      dateOfBirth: "1980-01-01",
      gender: "female",
      phone: "9000000000",
    })
    .returning();
  return { id: p.id, displayId };
}

/** A billed radiology study with a matched worklist row — the archive entrypoint's argument. */
async function fixture(
  tag: string,
  opts: { modality?: string; description?: string; status?: string } = {},
): Promise<Fixture> {
  const suffix = `${RUN}-${tag}`;
  const [test] = await db
    .insert(testsTable)
    .values({
      code: `R10-${suffix}`.slice(0, 40),
      name: `MRI Brain ${suffix}`,
      category: "Radiology",
      price: "1200",
      duration: "30",
      department: "MRI",
    })
    .returning();
  const { id: patientId, displayId } = await person(tag);
  const [order] = await db
    .insert(ordersTable)
    .values({ patientId, orderNumber: `ORD-${suffix}`, status: "completed", totalAmount: "1200" })
    .returning();
  const [orderTest] = await db
    .insert(orderTestsTable)
    .values({ orderId: order.id, testId: test.id, price: "1200" })
    .returning();
  const [bill] = await db
    .insert(billsTable)
    .values({
      billNumber: `BIL-${suffix}`,
      orderId: order.id,
      patientId,
      subtotal: "1200",
      totalAmount: "1200",
      paidAmount: "1200",
      balanceAmount: "0",
      status: "paid",
    })
    .returning();
  const studyUid = `1.2.840.ris10.${suffix}`;
  const [study] = await db
    .insert(radiologyStudiesTable)
    .values({
      accessionNumber: `ACC-${suffix}`,
      billId: bill.id,
      orderId: order.id,
      orderTestId: orderTest.id,
      patientId,
      testId: test.id,
      modality: opts.modality ?? "MR",
      department: "MRI",
      studyDate: "2026-09-15",
      studyDescription: opts.description ?? "MRI Brain",
      studyInstanceUid: studyUid,
      referringDoctor: "Dr. Refer",
      status: opts.status ?? "acquired",
    })
    .returning();
  const [worklist] = await db
    .insert(radiologyWorklistTable)
    .values({
      patientName: `Archive ${tag} ${RUN}`,
      patientId,
      studyId: study.id,
      modality: opts.modality ?? "MR",
      studyDescription: opts.description ?? "MRI Brain",
      studyDate: "20260915",
      accessionNumber: `ACC-${suffix}`,
      studyInstanceUID: studyUid,
      patientMatchStatus: "MATCHED",
      matchScore: "GREEN",
      matchDecision: "APPROVED",
      status: "REPORT_FINAL",
    })
    .returning();
  const f: Fixture = {
    patientId,
    patientDisplayId: displayId,
    testId: test.id,
    orderId: order.id,
    billId: bill.id,
    orderTestId: orderTest.id,
    studyId: study.id,
    worklistId: worklist.id,
    accession: `ACC-${suffix}`,
    studyUid,
    reportIds: [],
    jobKeys: [],
  };
  made.push(f);
  return f;
}

/**
 * A report row written the way the finalize path writes it — bound to the WORKLIST ROW id, with the
 * billing identity copied onto it. `signed` is now the whole question (DECISION 1), so it drives both
 * `status` and `signedAt`: the sign route records the signature and sets `pending_verification` in the
 * same statement (patient-reports.ts:2569-2574), and a draft carries neither.
 */
async function reportRow(
  f: Fixture,
  opts: { signed: boolean; body: string; studyId?: number },
): Promise<number> {
  const [report] = await db
    .insert(patientReportsTable)
    .values({
      reportNumber: `RPT-${RUN}-${f.patientId}-${f.reportIds.length + 1}`,
      type: "radiology",
      patientId: f.patientId,
      testId: f.testId,
      orderId: f.orderId,
      billId: f.billId,
      orderTestId: f.orderTestId,
      studyId: opts.studyId ?? f.worklistId,
      title: "MRI Brain",
      body: `<p>${opts.body}</p>`,
      impression: opts.body,
      status: opts.signed ? "final" : "draft",
      signedByName: opts.signed ? "Dr Archive" : null,
      signedAt: opts.signed ? new Date() : null,
    })
    .returning();
  f.reportIds.push(report.id);
  return report.id;
}

/**
 * The D7 linkage row. Production writes each row's own `structured_json.document_id` into
 * `original_document_id` / `amended_document_id` (patient-reports.ts:1865-1866); these fixtures have no
 * structured envelope, so the ids are the fixture's own. The version resolver walks the chain by REPORT
 * id (radiologyReportVersion.ts:214-256) and never reads the document columns.
 */
async function linkAmendment(originalId: number, amendedId: number): Promise<void> {
  await db.insert(patientReportAmendmentsTable).values({
    originalReportId: originalId,
    amendedReportId: amendedId,
    rootReportId: originalId,
    originalDocumentId: `DOC-${RUN}-root-${originalId}`,
    amendedDocumentId: `DOC-${RUN}-amd-${amendedId}`,
    sequenceNumber: 1,
    reason: "laterality corrected",
    amendedByName: "Dr Archive",
  });
}

async function readStudy(id: number) {
  const [row] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id));
  return row;
}

async function readRevisions(studyId: number) {
  return db
    .select()
    .from(radiologyPacsArchiveRevisionsTable)
    .where(eq(radiologyPacsArchiveRevisionsTable.studyId, studyId))
    .orderBy(asc(radiologyPacsArchiveRevisionsTable.id));
}

async function auditDetails(accession: string, action: string) {
  const rows = await db
    .select()
    .from(radiologyAuditLogTable)
    .where(eq(radiologyAuditLogTable.accessionNumber, accession))
    .orderBy(asc(radiologyAuditLogTable.id));
  return rows
    .filter((r) => r.action === action)
    .map((r) => JSON.parse(String(r.details)) as Record<string, unknown>);
}

/** The resolver's argument, read back out of `radiology_studies` the way the archive reads it. */
async function studyRefFor(f: Fixture) {
  const [row] = await db
    .select({
      id: radiologyStudiesTable.id,
      patientId: radiologyStudiesTable.patientId,
      testId: radiologyStudiesTable.testId,
      billId: radiologyStudiesTable.billId,
      orderId: radiologyStudiesTable.orderId,
      orderTestId: radiologyStudiesTable.orderTestId,
    })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, f.studyId))
    .limit(1);
  return row;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!dbReady)("RIS-010 — the archive's approved transaction rules", () => {
  let app: Express;
  const staffToken = `ris10-staff-${RUN}`;
  const adminToken = `ris10-admin-${RUN}`;
  let staffId = 0;
  let adminId = 0;

  /** Run the canonical re-archive job through the real durable queue. */
  async function runRearchiveJob(
    f: Fixture,
    reportId: number,
  ): Promise<{ ok: boolean; status: string | null; failureReason: string | null }> {
    const key = `ris10-${RUN}-rearchive-${f.studyId}-${f.jobKeys.length}`;
    f.jobKeys.push(key);
    const enqueued = await enqueueRadiologyJob({
      operationType: PACS_REARCHIVE_JOB,
      entityType: "radiology_study",
      entityId: f.studyId,
      payload: { studyId: f.studyId, reportId },
      idempotencyKey: key,
    });
    expect(enqueued.created).toBe(true);
    const tick = await runRadiologyJobTick(
      { [PACS_REARCHIVE_JOB]: RADIOLOGY_JOB_HANDLERS[PACS_REARCHIVE_JOB] },
      { maxJobs: 1, jobId: enqueued.id },
    );
    expect(tick.ran).toHaveLength(1);
    const job = await getRadiologyJobById(enqueued.id);
    return {
      ok: tick.ran[0].outcome === "success",
      status: job?.status ?? null,
      failureReason: job?.failureReason ?? null,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const [staff] = await db
      .insert(usersTable)
      .values({
        name: `Dr Archivist ${RUN}`,
        email: `ris10-${RUN}@vitest.invalid`,
        username: `ris10-${RUN}`,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    staffId = staff.id;
    const [admin] = await db
      .insert(usersTable)
      .values({
        name: `Ops Admin ${RUN}`,
        email: `ris10-admin-${RUN}@vitest.invalid`,
        username: `ris10-admin-${RUN}`,
        role: "admin",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    adminId = admin.id;
    for (const [token, user] of [[staffToken, staff], [adminToken, admin]] as const) {
      await db.insert(portalSessionsTable).values({
        token,
        scope: "staff",
        subjectId: user.id,
        subjectName: user.name,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
    }
  }, 60_000);

  beforeEach(() => {
    edge.rendered = [];
    edge.posts = [];
    edge.orthancUrl = "http://orthanc-stub:8042/dicom-web";
    edge.rejectNextUpload = false;
    edge.renderDelayMs = 0;
    global.fetch = (async (url: unknown, init?: { body?: string }) => {
      const u = String(url);
      if (u.endsWith("/tools/create-dicom")) {
        // Recorded before the outcome is decided, so "Orthanc rejected it" stays a measurable POST
        // rather than an inference from an error string.
        const body = JSON.parse(String(init?.body)) as { Tags: Record<string, string>; Content: string };
        edge.posts.push({ tags: body.Tags, contentLength: body.Content.length });
        if (edge.rejectNextUpload) {
          edge.rejectNextUpload = false;
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "Orthanc stub rejection" }),
            text: async () => '{"error":"Orthanc stub rejection"}',
          };
        }
        edge.seq += 1;
        const id = `stub-instance-${edge.seq}`;
        return {
          ok: true,
          status: 200,
          json: async () => ({ ID: id, Path: `/instances/${id}` }),
          text: async () => id,
        };
      }
      // Anything else (e.g. a key-image lookup) is deliberately absent, which is how the renderer
      // sees it in a clinic whose Orthanc holds no such series.
      return { ok: false, status: 404, json: async () => ({}), text: async () => "stub: not found" };
    }) as unknown as typeof fetch;
  });

  afterAll(async () => {
    for (const f of made) {
      for (const key of f.jobKeys) {
        await db.delete(dicomRetryQueueTable).where(eq(dicomRetryQueueTable.idempotencyKey, key)).catch(() => {});
      }
      await db
        .delete(radiologyPacsArchiveRevisionsTable)
        .where(eq(radiologyPacsArchiveRevisionsTable.studyId, f.studyId))
        .catch(() => {});
      await db
        .delete(radiologyAuditLogTable)
        .where(eq(radiologyAuditLogTable.accessionNumber, f.accession))
        .catch(() => {});
      if (f.reportIds.length > 0) {
        await db
          .delete(patientReportAmendmentsTable)
          .where(inArray(patientReportAmendmentsTable.originalReportId, f.reportIds))
          .catch(() => {});
        await db
          .delete(patientReportAmendmentsTable)
          .where(inArray(patientReportAmendmentsTable.amendedReportId, f.reportIds))
          .catch(() => {});
      }
      for (const id of f.reportIds) {
        await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
      }
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, f.worklistId)).catch(() => {});
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, f.studyId)).catch(() => {});
      await db.delete(billsTable).where(eq(billsTable.id, f.billId)).catch(() => {});
      await db.delete(orderTestsTable).where(eq(orderTestsTable.id, f.orderTestId)).catch(() => {});
      await db.delete(ordersTable).where(eq(ordersTable.id, f.orderId)).catch(() => {});
      await db.delete(testsTable).where(eq(testsTable.id, f.testId)).catch(() => {});
      await db.delete(patientsTable).where(eq(patientsTable.id, f.patientId)).catch(() => {});
    }
    for (const token of [staffToken, adminToken]) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    }
    for (const id of [staffId, adminId]) {
      await db.delete(usersTable).where(eq(usersTable.id, id)).catch(() => {});
    }
  });

  it("1 — a signed report archives, and all four records describe the same object", async () => {
    const f = await fixture("signed");
    const reportId = await reportRow(f, { signed: true, body: "NO ACUTE INTRACRANIAL ABNORMALITY" });

    const result = await archiveReportToPacs(f.studyId);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.refused).toBeFalsy();
    expect(result.idempotent).toBeFalsy();

    expect(edge.posts).toHaveLength(1);
    expect(edge.posts[0].tags).toMatchObject({
      StudyInstanceUID: f.studyUid,
      AccessionNumber: f.accession,
      PatientID: f.patientDisplayId,
      SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.1",
      Modality: "OT",
      SeriesDescription: "Radiology Report PDF",
    });
    expect(edge.rendered[0]).toContain("NO ACUTE INTRACRANIAL ABNORMALITY");
    expect(edge.rendered[0]).not.toContain("DRAFT (not signed)");

    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    expect(study.pacsInstanceId).toBe(result.instanceId);
    expect(JSON.parse(String(study.pacsArchiveResponse)).Path).toBe(`/instances/${result.instanceId}`);

    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      reportId,
      studyId: f.studyId,
      status: "success",
      sequenceNumber: 1,
      orthancInstanceId: result.instanceId,
    });

    const success = await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS");
    expect(success).toHaveLength(1);
    expect(success[0]).toMatchObject({
      requestedReportId: reportId,
      deliveredReportId: reportId,
      reportVersion: "1/1",
      superseded: false,
      instanceId: result.instanceId,
    });
  }, 60_000);

  it("2 — an unsigned draft is refused: nothing is rendered, posted or recorded as archived", async () => {
    const f = await fixture("draft");
    const draftId = await reportRow(f, { signed: false, body: "HALF-WRITTEN WORKING TEXT" });

    // The pick still lands on the draft (newest row of the right examination) — refusing it is the
    // eligibility policy's job, and it happens before anything is rendered or posted.
    const picked = await resolveArchiveReportRow(await studyRefFor(f));
    expect(picked?.id).toBe(draftId);

    const result = await archiveReportToPacs(f.studyId);
    expect(result.success).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("NO_ELIGIBLE_REPORT");
    expect(result.blockReasons).toContain("not_finalized");
    expect(result.message).toBe(NO_REPORT);
    expect(result.error).toContain("PACS_ARCHIVE_REFUSED");

    // The four records agree that nothing happened.
    expect(edge.posts).toHaveLength(0);
    expect(edge.rendered).toHaveLength(0);
    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("refused");
    expect(study.pacsInstanceId).toBeNull();
    expect(JSON.parse(String(study.pacsArchiveResponse)).blockReasons).toContain("not_finalized");
    expect(await readRevisions(f.studyId)).toHaveLength(0);
    const refusals = await auditDetails(f.accession, "PACS_ARCHIVE_REFUSED");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ reason: "NO_ELIGIBLE_REPORT", message: NO_REPORT });
    expect(await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS")).toHaveLength(0);

    // The durable job says the same thing, and its own failure rule refuses to retry a refusal: an
    // automatic retry cannot produce a signature. (The handler's pre-check cannot short-circuit here —
    // there is no archived revision to check against.)
    const job = await runRearchiveJob(f, draftId);
    expect(job.ok).toBe(false);
    expect(job.failureReason).toContain("PACS_ARCHIVE_REFUSED");
    expect(job.status).toBe("abandoned");
    expect(edge.posts).toHaveLength(0);
    expect(
      decideFailure({ retryCount: 0, maxRetries: 5, now: new Date(), error: job.failureReason }),
    ).toMatchObject({ status: "abandoned", nextRetryAt: null });

    // Signing it afterwards makes the same study eligible — the refusal is a state, not a verdict.
    await db
      .update(patientReportsTable)
      .set({ status: "final", signedByName: "Dr Archive", signedAt: new Date() })
      .where(eq(patientReportsTable.id, draftId));
    const afterSigning = await archiveReportToPacs(f.studyId);
    expect(afterSigning.success).toBe(true);
    expect(edge.posts).toHaveLength(1);
  }, 90_000);

  it("3 — an examination with no report at all is refused; the placeholder sentence is gone", async () => {
    const f = await fixture("no-report");
    expect(await resolveArchiveReportRow(await studyRefFor(f))).toBeNull();

    const result = await archiveReportToPacs(f.studyId);
    expect(result.success).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.message).toBe(NO_REPORT);
    expect(result.blockReasons).toContain("no_report");

    expect(edge.posts).toHaveLength(0);
    expect(edge.rendered).toHaveLength(0);
    expect((await readStudy(f.studyId)).pacsArchiveStatus).toBe("refused");
    expect(await readRevisions(f.studyId)).toHaveLength(0);
    expect((await auditDetails(f.accession, "PACS_ARCHIVE_REFUSED"))[0]).toMatchObject({
      blockReasons: expect.arrayContaining(["no_report"]),
    });

    // The exact words the owner forbade must appear in NO document this study ever rendered.
    for (const html of edge.rendered) expect(html).not.toContain("No report body text entered.");
  }, 60_000);

  it("4 — ordinary Retry after success uploads nothing and returns the existing result", async () => {
    const f = await fixture("retry-success");
    const reportId = await reportRow(f, { signed: true, body: "FINDINGS RETRY CASE" });

    const first = await archiveReportToPacs(f.studyId);
    expect(first.success).toBe(true);
    expect(edge.posts).toHaveLength(1);

    const second = await archiveReportToPacs(f.studyId);
    expect(second.success).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(second.instanceId).toBe(first.instanceId);
    expect(second.message).toContain("already archived");

    expect(edge.posts).toHaveLength(1);
    expect(edge.rendered).toHaveLength(1); // not even a second PDF was built
    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    expect(study.pacsInstanceId).toBe(first.instanceId);

    // History preserved, no misleading new revision: one revision row, still success, still the
    // original instance, and the no-op itself is auditable rather than silent.
    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ status: "success", orthancInstanceId: first.instanceId });
    const noops = await auditDetails(f.accession, "PACS_ARCHIVE_IDEMPOTENT_NOOP");
    expect(noops).toHaveLength(1);
    expect(noops[0]).toMatchObject({ reportId, instanceId: first.instanceId });
    expect(await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS")).toHaveLength(1);

    // Same answer through the ERP's own Retry button…
    const http = await request(app)
      .post(`/api/radiology/studies/${f.studyId}/archive-retry`)
      .set(auth(staffToken));
    expect(http.status).toBe(200);
    expect(http.body).toMatchObject({ success: true, idempotent: true, instanceId: first.instanceId });
    expect(edge.posts).toHaveLength(1);

    // …and through the durable job, which is a no-op rather than a second object.
    const job = await runRearchiveJob(f, reportId);
    expect(job.ok).toBe(true);
    expect(job.status).toBe("success");
    expect(edge.posts).toHaveLength(1);
  }, 90_000);

  it("5 — a Retry after a FAILED upload performs the real upload", async () => {
    const f = await fixture("retry-failed");
    const reportId = await reportRow(f, { signed: true, body: "FINDINGS AFTER FAILURE" });

    edge.rejectNextUpload = true;
    const failed = await archiveReportToPacs(f.studyId);
    expect(failed.success).toBe(false);
    // Rejected BEFORE acceptance, so this is the case where a retry is legitimate.
    expect(failed.accepted).toBeFalsy();
    const afterFailure = await readStudy(f.studyId);
    expect(afterFailure.pacsArchiveStatus).toBe("failed");
    expect(afterFailure.pacsInstanceId).toBeNull();
    const failedRevisions = await readRevisions(f.studyId);
    expect(failedRevisions).toHaveLength(1);
    expect(failedRevisions[0].status).toBe("failed");
    expect(edge.posts).toHaveLength(1);

    const retried = await archiveReportToPacs(f.studyId);
    expect(retried.success, JSON.stringify(retried)).toBe(true);
    expect(retried.idempotent).toBeFalsy();
    expect(edge.posts).toHaveLength(2);

    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    expect(study.pacsInstanceId).toBe(retried.instanceId);
    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ reportId, status: "success", orthancInstanceId: retried.instanceId });
  }, 90_000);

  it("6 — two archives started together cannot both upload (PostgreSQL study lock)", async () => {
    const f = await fixture("concurrent");
    await reportRow(f, { signed: true, body: "FINDINGS CONCURRENT CASE" });
    // Real overlap: the rasteriser waits, so the second run begins while the first is mid-flight.
    edge.renderDelayMs = 150;

    const [a, b] = await Promise.all([archiveReportToPacs(f.studyId), archiveReportToPacs(f.studyId)]);
    const outcomes = [a, b];

    expect(edge.posts).toHaveLength(1);
    expect(outcomes.filter((o) => o.success)).toHaveLength(1);
    const loser = outcomes.find((o) => !o.success)!;
    expect(loser.refused).toBe(true);
    expect(loser.inProgress).toBe(true);
    expect(loser.reason).toBe("ARCHIVE_IN_PROGRESS");
    expect(loser.message).toContain("already running");

    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    expect(await readRevisions(f.studyId)).toHaveLength(1);
    expect(await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS")).toHaveLength(1);
    const refusals = await auditDetails(f.accession, "PACS_ARCHIVE_REFUSED");
    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toBe("ARCHIVE_IN_PROGRESS");

    // An in-progress refusal stays RETRYABLE — unlike a no-report refusal — because the other run may
    // finish. That difference is the reason there are two codes and not one.
    expect(decideFailure({ retryCount: 0, maxRetries: 5, now: new Date(), error: loser.error }))
      .toMatchObject({ status: "retrying" });

    // And the lock is released when the winner finishes: a third run gets the idempotent answer.
    const later = await archiveReportToPacs(f.studyId);
    expect(later).toMatchObject({ success: true, idempotent: true });
    expect(edge.posts).toHaveLength(1);
  }, 90_000);

  it("7 + 8 — an amended signed report archives as a new revision and the previous one stays traceable", async () => {
    const f = await fixture("amendment");
    const rootId = await reportRow(f, { signed: true, body: "VERSION ONE FINDINGS" });
    const first = await archiveReportToPacs(f.studyId);
    expect(first.success).toBe(true);

    const amendedId = await reportRow(f, { signed: true, body: "VERSION TWO FINDINGS — RIGHT, NOT LEFT" });
    await linkAmendment(rootId, amendedId);

    const second = await archiveReportToPacs(f.studyId);
    expect(second.success).toBe(true);
    expect(second.instanceId).not.toBe(first.instanceId);
    expect(edge.posts).toHaveLength(2);
    expect(edge.posts[1].tags.SeriesDescription).toBe("Radiology Report PDF v2/2 (amended)");
    expect(edge.rendered[1]).toContain("RIGHT, NOT LEFT");
    expect(edge.rendered[1]).toContain("AMENDED REPORT");

    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(2);
    const byReport = new Map(revisions.map((r) => [r.reportId, r]));
    // DECISION 3's "preserve archive history": the first revision keeps its OWN Orthanc instance id,
    // marked superseded, so the object filed earlier is still findable after the amendment is filed.
    expect(byReport.get(rootId)).toMatchObject({ status: "superseded", orthancInstanceId: first.instanceId });
    expect(byReport.get(amendedId)).toMatchObject({ status: "success", sequenceNumber: 2 });

    // The guard is per REVISION, not per study: retrying the amendment changes nothing.
    const third = await archiveReportToPacs(f.studyId);
    expect(third).toMatchObject({ success: true, idempotent: true, instanceId: second.instanceId });
    expect(edge.posts).toHaveLength(2);

    // The guard is keyed on the revision being SERVED, not on the request shape. Asking for the chain's
    // current answer explicitly resolves to the same amendment that is already archived, so it uploads
    // nothing — an earlier version of this file expected a refusal here and was wrong: with the pick
    // landing on the newest bound row, `versionMode: "specific"` is not a historical request at all.
    const forward = await archiveReportToPacs(f.studyId, { versionMode: "latest" });
    expect(forward).toMatchObject({ success: true, idempotent: true, instanceId: second.instanceId });
    expect(edge.posts).toHaveLength(2);
    expect(edge.rendered).toHaveLength(2);
  }, 120_000);

  it("8b — a retired revision cannot become this study's archived report", async () => {
    // The shape in which "explicitly historical" is actually reachable: this study's bound row was
    // superseded by an amendment whose own `study_id` lives in the part of the shared id space this
    // study's pick does not search (RIS-004/RIS-005 — drafts hold the worklist ROW id, legacy rows the
    // studies id). So the archive resolves the report on the ROOT. Serving that row exactly would file
    // a retired report under a live accession; the reused policy refuses it and nothing is rendered.
    // Nothing here is contrived except which number the amendment carries — the chain linkage is exactly
    // what production writes (patient_report_amendments).
    const f = await fixture("retired-pick");
    const rootId = await reportRow(f, { signed: true, body: "VERSION ONE, NOW RETIRED" });
    const amendedId = await reportRow(f, {
      signed: true,
      body: "VERSION TWO, CURRENT",
      studyId: f.studyId + 7_000_000,
    });
    await linkAmendment(rootId, amendedId);

    edge.rendered = [];
    // Explicit, not defaulted: the archive's implicit mode is flag-gated (`effectiveResolveMode` —
    // "latest" when ff_radiology_structured_final is on, "specific" when not), and the two answers
    // differ here. Naming the mode makes the claim about the retired row, not about a flag's state.
    const refused = await archiveReportToPacs(f.studyId, { versionMode: "specific" });
    expect(refused.success).toBe(false);
    expect(refused.refused).toBe(true);
    expect(refused.blockReasons).toContain("superseded_report");
    expect(edge.posts).toHaveLength(0);
    expect(edge.rendered).toHaveLength(0);
    expect(await readRevisions(f.studyId)).toHaveLength(0);
    expect((await readStudy(f.studyId)).pacsArchiveStatus).toBe("refused");

    // The retired report is preserved, not deleted or overwritten, and the study still has a way to
    // archive: resolve forward through the chain the way the reporting surface does, and the CURRENT
    // version is filed. Fail-closed, not dead-ended.
    const current = await archiveReportToPacs(f.studyId, { versionMode: "latest" });
    expect(current.success).toBe(true);
    expect(edge.posts).toHaveLength(1);
    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ reportId: amendedId, status: "success" });
    expect((await readStudy(f.studyId)).pacsInstanceId).toBe(current.instanceId);
    expect((await readStudy(f.studyId)).pacsArchiveStatus).toBe("success");

    // Both rows still exist, unmodified — a refusal must never touch report content.
    const rows = await db
      .select({ id: patientReportsTable.id, impression: patientReportsTable.impression })
      .from(patientReportsTable)
      .where(inArray(patientReportsTable.id, [rootId, amendedId]));
    expect(new Map(rows.map((r) => [r.id, r.impression]))).toEqual(
      new Map([
        [rootId, "VERSION ONE, NOW RETIRED"],
        [amendedId, "VERSION TWO, CURRENT"],
      ]),
    );
  }, 90_000);

  it("9 — another examination's or another patient's report is never filed here", async () => {
    // Same patient, two examinations. Only the LS Spine study has a signed report.
    const brain = await fixture("pair-brain", { description: "MRI Brain" });
    const spine = await fixture("pair-spine", { description: "MRI LS Spine" });
    await reportRow(spine, { signed: true, body: "LS SPINE FINDINGS BELONG TO THE SPINE STUDY" });

    const result = await archiveReportToPacs(brain.studyId);
    expect(result.success).toBe(false);
    expect(result.refused).toBe(true);
    expect(edge.posts).toHaveLength(0);
    expect((await readStudy(brain.studyId)).pacsArchiveStatus).toBe("refused");
    expect(await readRevisions(brain.studyId)).toHaveLength(0);

    // The other study's report still archives — for its own study, under its own accession.
    const forSpine = await archiveReportToPacs(spine.studyId);
    expect(forSpine.success).toBe(true);
    expect(edge.posts).toHaveLength(1);
    expect(edge.posts[0].tags.AccessionNumber).toBe(spine.accession);
    expect(edge.posts[0].tags.StudyInstanceUID).toBe(spine.studyUid);

    // A report whose `study_id` merely COINCIDES with this study's id, belonging to a different
    // patient, cannot be adopted either — the shared id space RIS-004/RIS-005 were about.
    const stranger = await fixture("collision-stranger");
    const [foreign] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${RUN}-collision-${stranger.patientId}`,
        type: "radiology",
        patientId: stranger.patientId,
        testId: brain.testId,
        studyId: brain.studyId,
        title: "MRI Brain",
        body: `<p>ANOTHER PATIENT ENTIRELY ${RUN}</p>`,
        impression: "ANOTHER PATIENT ENTIRELY",
        status: "final",
        signedByName: "Dr Other",
        signedAt: new Date(),
      })
      .returning();
    stranger.reportIds.push(foreign.id);

    const crossPatient = await archiveReportToPacs(brain.studyId);
    expect(crossPatient.success).toBe(false);
    expect(edge.posts).toHaveLength(1); // still only the spine study's own object
    for (const post of edge.posts) {
      expect(post.tags.PatientID).not.toBe(stranger.patientDisplayId);
      expect(post.tags.AccessionNumber).not.toBe(brain.accession);
    }
    expect(edge.rendered.join("\n")).not.toContain("ANOTHER PATIENT ENTIRELY");
  }, 120_000);

  it("10 — a missing Orthanc endpoint cannot report success", async () => {
    const f = await fixture("no-orthanc");
    await reportRow(f, { signed: true, body: "FINDINGS UNCONFIGURED CASE" });

    edge.orthancUrl = "";
    const result = await archiveReportToPacs(f.studyId);
    expect(result.success).toBe(false);
    expect(result.accepted).toBeFalsy();
    expect(result.error).toContain("Orthanc PACS URL not configured");
    expect(edge.posts).toHaveLength(0);

    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("failed");
    expect(study.pacsInstanceId).toBeNull();
    expect(await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS")).toHaveLength(0);
    expect(await auditDetails(f.accession, "ORTHANC_UPLOAD_FAILURE")).toHaveLength(1);
  }, 60_000);

  it("11 — a revision recorded as archived is never re-uploaded, even when the study summary was lost", async () => {
    const f = await fixture("accepted-unrecorded");
    await reportRow(f, { signed: true, body: "FINDINGS ACCEPTED STATE" });

    const first = await archiveReportToPacs(f.studyId);
    expect(first.success).toBe(true);
    expect(edge.posts).toHaveLength(1);

    // The state an accepted-but-unrecorded failure leaves behind: the revision row (written FIRST now,
    // by DECISION 6) holds the truth, the study summary does not. This asserts the recovery from that
    // state; the header says why the fault itself is not injected here.
    await db
      .update(radiologyStudiesTable)
      .set({
        pacsArchiveStatus: "failed",
        pacsInstanceId: null,
        pacsArchiveResponse: JSON.stringify({ error: "simulated lost write" }),
      })
      .where(eq(radiologyStudiesTable.id, f.studyId));

    const retried = await archiveReportToPacs(f.studyId);
    expect(retried).toMatchObject({ success: true, idempotent: true, instanceId: first.instanceId });
    expect(edge.posts).toHaveLength(1);
    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    expect(study.pacsInstanceId).toBe(first.instanceId);

    // And when the recording genuinely fails mid-run, the archive returns a code, an honest sentence
    // naming the instance, and no automatic retry — a blind retry is exactly the duplicate the owner
    // forbade. This is the rule half; the injected-fault half stays unmeasured by choice.
    expect(
      decideFailure({
        retryCount: 0,
        maxRetries: 5,
        now: new Date(),
        error: "ARCHIVE_ACCEPTED_BUT_UNRECORDED: Orthanc accepted the report as stub-9.",
      }),
    ).toMatchObject({ status: "abandoned", nextRetryAt: null });
  }, 90_000);

  it("12 — authorized legacy reports stay eligible: the legacy row AND the legacy free text", async () => {
    // Shape A — a `patient_reports` row keyed by the BILLED STUDY id (the pre-workspace spelling),
    // signed. RIS-005 kept it eligible and DECISION 1 must not strand it.
    const legacyRow = await fixture("legacy-row");
    const reportId = await reportRow(legacyRow, { signed: true, body: "LEGACY KEYED REPORT", studyId: legacyRow.studyId });
    const a = await archiveReportToPacs(legacyRow.studyId);
    expect(a.success, JSON.stringify(a)).toBe(true);
    expect(edge.posts).toHaveLength(1);
    expect((await readRevisions(legacyRow.studyId))[0].reportId).toBe(reportId);

    // Shape B — no report row at all: `peerReview.finalizeReport` wrote the text onto the study with a
    // named radiologist and status reported_final. That is an authoritative finalized report.
    const legacyText = await fixture("legacy-text");
    await db
      .update(radiologyStudiesTable)
      .set({
        status: "reported_final",
        finalReport: "LEGACY FREE TEXT FINALIZED BY A RADIOLOGIST",
        finalReportedBy: String(legacyRow.patientId),
        finalReportedAt: new Date(),
      })
      .where(eq(radiologyStudiesTable.id, legacyText.studyId));
    const b = await archiveReportToPacs(legacyText.studyId);
    expect(b.success, JSON.stringify(b)).toBe(true);
    expect(edge.posts).toHaveLength(2);
    expect(edge.rendered[1]).toContain("LEGACY FREE TEXT FINALIZED BY A RADIOLOGIST");
    // The revision table has no row for this shape — it has no patient_reports id to key on. Recorded
    // as the limitation it is, so nobody later mistakes the empty table for "nothing was filed".
    expect(await readRevisions(legacyText.studyId)).toHaveLength(0);

    // A preliminary report is NOT authorized (DECISION 1: never an incomplete or working report), and
    // free text with no radiologist behind it is not either.
    const prelimOnly = await fixture("legacy-prelim");
    await db
      .update(radiologyStudiesTable)
      .set({
        status: "reported_final",
        prelimReport: "PRELIM ONLY",
        finalReport: null,
        finalReportedBy: null,
      })
      .where(eq(radiologyStudiesTable.id, prelimOnly.studyId));
    const c = await archiveReportToPacs(prelimOnly.studyId);
    expect(c.success).toBe(false);
    expect(c.blockReasons).toContain("no_report");
    expect(edge.posts).toHaveLength(2);
    expect(edge.rendered.join("\n")).not.toContain("PRELIM ONLY");
  }, 120_000);

  it("DECISION 4 — only an authorized admin restore may re-upload, and it changes nothing else", async () => {
    const f = await fixture("restore");
    const reportId = await reportRow(f, { signed: true, body: "FINDINGS RESTORE CASE" });

    const first = await archiveReportToPacs(f.studyId);
    expect(first.success).toBe(true);

    const repair = (body: Record<string, unknown>, token = adminToken) =>
      request(app).post("/api/radiology-ops/repair").set(auth(token)).send(body);

    // A reason is mandatory, and dry-run is the default.
    expect((await repair({ action: "restore_archived_report", studyId: f.studyId })).status).toBe(400);
    const preview = await repair({
      action: "restore_archived_report",
      studyId: f.studyId,
      reason: RESTORE_REASON,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.dryRun).toBe(true);
    expect(preview.body.executed).toBe(false);
    expect(preview.body.affected[0]).toMatchObject({
      studyId: f.studyId,
      accessionNumber: f.accession,
      pacsInstanceId: first.instanceId,
      willBypassDuplicateGuard: true,
    });
    expect(edge.posts).toHaveLength(1); // a dry run uploaded nothing

    // Execution demands the token that names the action, and a non-admin is refused outright.
    expect((await repair({
      action: "restore_archived_report", dryRun: false, studyId: f.studyId, reason: RESTORE_REASON,
    })).status).toBe(400);
    expect((await repair({
      action: "restore_archived_report", dryRun: false, confirmToken: RESTORE_TOKEN,
      studyId: f.studyId, reason: RESTORE_REASON,
    }, staffToken)).status).toBe(403);
    expect(edge.posts).toHaveLength(1);

    const executed = await repair({
      action: "restore_archived_report",
      dryRun: false,
      confirmToken: RESTORE_TOKEN,
      studyId: f.studyId,
      reason: RESTORE_REASON,
    });
    expect(executed.status).toBe(200);
    expect(executed.body.executed).toBe(true);
    expect(edge.posts).toHaveLength(2);

    // Audited with the named actor and the reason, so the history says who forced it and why.
    const forced = await auditDetails(f.accession, "PACS_ARCHIVE_RESTORE_FORCED");
    expect(forced).toHaveLength(1);
    expect(forced[0]).toMatchObject({ reportId, reason: RESTORE_REASON });
    const actors = await db
      .select({ actor: radiologyAuditLogTable.actor })
      .from(radiologyAuditLogTable)
      .where(eq(radiologyAuditLogTable.accessionNumber, f.accession));
    expect(actors.some((r) => r.actor && r.actor.startsWith("Ops Admin"))).toBe(true);

    // No silent history deletion and no lost identity: the revision row survives with the new instance,
    // the earlier instance is still in the success audit history, and the ordinary Retry goes back to
    // being a no-op against the restored object.
    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    const restoredId = String(forced[0].instanceId);
    expect(restoredId).not.toBe(first.instanceId);
    expect(await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS")).toHaveLength(2);
    expect(await readStudy(f.studyId)).toMatchObject({ pacsArchiveStatus: "success", pacsInstanceId: restoredId });
    const afterRestore = await archiveReportToPacs(f.studyId);
    expect(afterRestore).toMatchObject({ success: true, idempotent: true, instanceId: restoredId });
    expect(edge.posts).toHaveLength(2);

    // A restore cannot smuggle anything through: with no signed report the same authorized action is
    // still refused, because eligibility is not part of the bypass.
    const empty = await fixture("restore-empty");
    const refusedRestore = await request(app)
      .post("/api/radiology-ops/repair")
      .set(auth(adminToken))
      .send({
        action: "restore_archived_report", dryRun: false, confirmToken: RESTORE_TOKEN,
        studyId: empty.studyId, reason: "Confirmed data loss for a study that has no signed report",
      });
    expect(refusedRestore.status).toBe(200);
    expect(refusedRestore.body.executed).toBe(false);
    expect(refusedRestore.body.affected[0].result).toMatchObject({ refused: true });
    expect(edge.posts).toHaveLength(2);
  }, 150_000);

  // ══════════════════════════════════════════════════════════════════════════
  // POST-MERGE COMPATIBILITY AUDIT — the owner's eight verification points of
  // 2026-10-17, measured against main at `1a93e4e4` (the squash of #1050). These
  // cases do NOT re-assert the six rules; they ask what the newly enforced gate
  // does to work that was already working. V3 and V6 are written to FAIL on that
  // commit: a refusal that names the wrong blocker, and a legacy final delivered
  // by the federated bridge that the new predicate refuses, are both regressions
  // the brief said to demonstrate before changing anything.
  // ══════════════════════════════════════════════════════════════════════════

  /** One staff session that may read and sign reports (the suite's own staff token is /radiology only). */
  let reporterToken = "";
  async function reporter(): Promise<string> {
    if (reporterToken) return reporterToken;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Dr Signatory ${RUN}`,
        email: `ris10-reporter-${RUN}@vitest.invalid`,
        username: `ris10-reporter-${RUN}`,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    reporterToken = `ris10-reporter-sess-${RUN}`;
    await db.insert(portalSessionsTable).values({
      token: reporterToken,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    return reporterToken;
  }

  it("V1 — a missing StudyInstanceUID blocks the PACS association and nothing else: the same report signs, reads and renders", async () => {
    const token = await reporter();
    const f = await fixture("v1-nouid");
    const reportId = await reportRow(f, {
      signed: false,
      body: "No acute intracranial haemorrhage. Ventricles are normal in calibre and configuration.",
    });

    // Signing is untouched by the archive's gate. Driven through the real route, not the column.
    const signed = await request(app)
      .post(`/api/patient-reports/${reportId}/sign`)
      .set(auth(token))
      .send({ signedByName: "Dr Signatory" });
    expect(signed.status, `sign: ${signed.text}`).toBe(200);
    const [row] = await db
      .select({ signedAt: patientReportsTable.signedAt, status: patientReportsTable.status })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, reportId));
    expect(row.signedAt).toBeTruthy();
    expect(row.status).toBe("pending_verification");

    // The read surface the reporting screen and the print path use, for the same report.
    const read = await request(app).get(`/api/patient-reports/${reportId}`).set(auth(token));
    expect(read.status, read.text).toBe(200);

    // Now remove the association key only — the report is signed and unchanged.
    await db
      .update(radiologyStudiesTable)
      .set({ studyInstanceUid: null })
      .where(eq(radiologyStudiesTable.id, f.studyId));

    const result = await archiveReportToPacs(f.studyId);
    expect(result.success).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.blockReasons).toContain("no_study_uid");
    expect(edge.posts).toHaveLength(0);
    expect(await readRevisions(f.studyId)).toHaveLength(0);

    // The signed report itself is untouched by the refusal — same status, same signature instant.
    const signedRow = await db
      .select({ signedAt: patientReportsTable.signedAt, status: patientReportsTable.status })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, reportId));
    expect(signedRow).toEqual([row]);
  }, 90_000);

  it("V2 — the obstetric restriction IS the existing statutory Form-F engine: it never reaches a non-obstetric study, and it lifts when Form-F becomes compliant", async () => {
    // Control: an MRI for a patient with NO Form-F record at all. PCPNDT is obstetric-only, so the
    // archive must proceed — this is the proof the gate did not grow a second, broader compliance rule.
    const mri = await fixture("v2-mri-no-formf");
    await reportRow(mri, { signed: true, body: "MILD GLOBAL ATROPHYPERIOR CORTEX. NO FOCAL LESION." });
    const mriResult = await archiveReportToPacs(mri.studyId);
    expect(mriResult.success, JSON.stringify(mriResult)).toBe(true);
    expect(edge.posts).toHaveLength(1);
    expect(await db.select({ id: formFRecordsTable.id }).from(formFRecordsTable).where(eq(formFRecordsTable.patientId, mri.patientId))).toHaveLength(0);

    // Same patient population, obstetric study: the statutory engine blocks it.
    const usg = await fixture("v2-usg-obstetric", { modality: "US", description: "ULTRASOUND OBSTETRIC ANOMALY SCAN" });
    await reportRow(usg, { signed: true, body: "FETAL ANATOMY AS DESCRIBED. PLACENTA POSTERIOR." });
    const blocked = await archiveReportToPacs(usg.studyId);
    expect(blocked.success).toBe(false);
    expect(blocked.blockReasons?.some((r) => String(r).startsWith("pcpndt"))).toBe(true);
    expect(edge.posts).toHaveLength(1); // only the MRI's object
    expect(await readRevisions(usg.studyId)).toHaveLength(0);

    // The engine's own verdict is what gated: satisfy the four statutory fields and it archives.
    await db.insert(formFRecordsTable).values({
      patientId: usg.patientId,
      patientName: `Archive v2-usg-obstetric ${RUN}`,
      husbandFatherName: "Ramesh K",
      address: "12 MG Road, Pune",
      consentDate: "2026-09-15",
      idCardVerified: true,
    });
    const allowed = await archiveReportToPacs(usg.studyId);
    expect(allowed.success, JSON.stringify(allowed)).toBe(true);
    expect(edge.posts).toHaveLength(2);
    expect((await readStudy(usg.studyId)).pacsArchiveStatus).toBe("success");
  }, 120_000);

  it("V3 — a refusal names the blocker it actually found, not one sentence for every cause", async () => {
    // (a) The owner's sentence is correct where he wrote it: there is no report at all.
    const none = await fixture("v3-no-report");
    const empty = await archiveReportToPacs(none.studyId);
    expect(empty.message).toBe(NO_REPORT);

    // (b) A study whose report is signed and finalized but cannot be ASSOCIATED with a PACS study must
    // not be described as lacking a signed report. Telling staff "no finalized signed report" sends them
    // looking for a signature that is already there, while the missing DICOM UID stays invisible.
    const f = await fixture("v3-signed-nouid");
    await reportRow(f, { signed: true, body: "CAVUM SEPTI INTERVENTIUM INTACT. NO MASS." });
    await db
      .update(radiologyStudiesTable)
      .set({ studyInstanceUid: null })
      .where(eq(radiologyStudiesTable.id, f.studyId));
    const uid = await archiveReportToPacs(f.studyId);
    expect(uid.refused).toBe(true);
    expect(uid.blockReasons).toContain("no_study_uid");
    expect(uid.message, `refusal said: ${uid.message}`).not.toBe(NO_REPORT);
    expect(uid.message).toMatch(/Study Instance UID/i);
    // The blocker must survive into the record and the audit trail, not only into the returned object.
    const study = await readStudy(f.studyId);
    const stored = JSON.parse(String(study.pacsArchiveResponse)) as { message: string; reasons?: string[]; blockReasons?: string[] };
    expect(stored.message).toMatch(/Study Instance UID/i);
    expect(stored.blockReasons).toContain("no_study_uid");
    expect((stored.reasons ?? []).join(" ")).toMatch(/Study Instance UID/i);
    const audit = await auditDetails(f.accession, "PACS_ARCHIVE_REFUSED");
    expect(JSON.stringify(audit[0].reasons)).toMatch(/Study Instance UID/i);
    expect(audit[0].message).toMatch(/Study Instance UID/i);

    // (c) A statutory hold must read as a statutory hold.
    const usg = await fixture("v3-usg-blocked", { modality: "US", description: "OBSTETRIC GROWTH SCAN" });
    await reportRow(usg, { signed: true, body: "FETAL WEIGHT BELOW 5TH CENTILE. AMNIOTIC FLUID REDUCED." });
    const pcp = await archiveReportToPacs(usg.studyId);
    expect(pcp.refused).toBe(true);
    expect(pcp.message).not.toBe(NO_REPORT);
    expect(pcp.message).toMatch(/Form-F|PCPNDT/i);
  }, 120_000);

  it("V4 + V5 — a refusal never damages the object PACS holds, and a signed amendment after it still archives as a new revision", async () => {
    const f = await fixture("v4-v5-preserve");
    const rootId = await reportRow(f, { signed: true, body: "TWO SMALL EXTRA-AXIAL LESIONS, LARGEST 8 MM LEFT FRONTAL." });
    const first = await archiveReportToPacs(f.studyId);
    expect(first.success).toBe(true);
    const heldId = (await readStudy(f.studyId)).pacsInstanceId;
    expect(heldId).toBe(first.instanceId);

    // A refusal caused by a temporary association gap must not lose or repoint the archived object.
    await db
      .update(radiologyStudiesTable)
      .set({ studyInstanceUid: null })
      .where(eq(radiologyStudiesTable.id, f.studyId));
    const refused = await archiveReportToPacs(f.studyId);
    expect(refused.refused).toBe(true);
    const during = await readStudy(f.studyId);
    expect(during.pacsArchiveStatus).toBe("refused");
    expect(during.pacsInstanceId, "a refusal destroyed the pointer to an object that still exists in PACS")
      .toBe(heldId);
    const still = await readRevisions(f.studyId);
    expect(still).toHaveLength(1);
    expect(still[0]).toMatchObject({ status: "success", reportId: rootId, orthancInstanceId: heldId });

    // Re-associated: the unchanged revision is idempotent, so the gap costs nothing but the hold.
    await db
      .update(radiologyStudiesTable)
      .set({ studyInstanceUid: f.studyUid })
      .where(eq(radiologyStudiesTable.id, f.studyId));
    const again = await archiveReportToPacs(f.studyId);
    expect(again).toMatchObject({ success: true, idempotent: true, instanceId: heldId });
    expect(edge.posts).toHaveLength(1);

    // V5 — and a signed amendment is still a legitimate new revision, not a blocked one.
    const amendedId = await reportRow(f, { signed: true, body: "THREE LESIONS NOW; LARGEST 11 MM. LEFT FRONTAL." });
    await linkAmendment(rootId, amendedId);
    const next = await archiveReportToPacs(f.studyId);
    expect(next.success, JSON.stringify(next)).toBe(true);
    expect(next.instanceId).not.toBe(heldId);
    expect(edge.posts).toHaveLength(2);
    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(2);
    const byReport = new Map(revisions.map((r) => [r.reportId, r]));
    expect(byReport.get(rootId)).toMatchObject({ status: "superseded", orthancInstanceId: heldId });
    expect(byReport.get(amendedId)).toMatchObject({ status: "success" });
    expect((await readStudy(f.studyId)).pacsInstanceId).toBe(next.instanceId);
  }, 150_000);

  it("V6 — an attributed legacy final delivered by the federated bridge keeps archiving (the bridge does not flip the study status)", async () => {
    const f = await fixture("v6-bridge", { status: "acquired" });
    const reportedAt = new Date(Date.now() - 60_000).toISOString();

    // The supported workflow, driven for real: POST /api/boundary/studies/:accession/report. The route
    // stores `status: status === "reported_final" ? "reported_final" : study.status` (boundary.ts:372) —
    // `status` is caller-supplied and unvalidated, so a service that omits it leaves the study as
    // `acquired` while storing an attributed, dated final report and auditing REPORT_FINAL.
    const pushed = await request(app)
      .post(`/api/boundary/studies/${f.accession}/report`)
      .set({ "x-boundary-key": BOUNDARY_KEY })
      .send({ finalReportText: "DIFFUSE HEPATIC STEATOSIS. NO FOCAL LESION. GALLBLADDER NORMAL.", reportedBy: "Dr Bridge", reportedAt });
    expect(pushed.status, pushed.text).toBe(200);

    const legacy = await readStudy(f.studyId);
    expect(legacy.finalReport).toContain("DIFFUSE HEPATIC STEATOSIS");
    expect(legacy.finalReportedBy).toBe("Dr Bridge");
    expect(legacy.finalReportedAt).toBeTruthy();
    expect(legacy.status).toBe("acquired"); // the bridge left it alone — that is its documented behaviour
    expect((await auditDetails(f.accession, "REPORT_FINAL"))).toHaveLength(1);
    expect(await db.select({ id: patientReportsTable.id }).from(patientReportsTable).where(eq(patientReportsTable.studyId, f.worklistId))).toHaveLength(0);

    // DECISION 1's own test of this shape is about the TEXT being authored, attributed and final — not
    // about one status spelling that only two of the four finalization writers are guaranteed to set.
    const result = await archiveReportToPacs(f.studyId);
    expect(result.refused, `bridge-delivered legacy final was refused: ${JSON.stringify(result)}`).toBeFalsy();
    expect(result.success).toBe(true);
    expect(edge.posts).toHaveLength(1);
    expect(edge.rendered[0]).toContain("DIFFUSE HEPATIC STEATOSIS");
    expect(edge.posts[0].tags.AccessionNumber).toBe(f.accession);

    // …and the DECISION 1 property still holds where it should: a preliminary-only legacy study has no
    // final text, so nothing is filed. Removing the status equality must not reopen the placeholder.
    const prelim = await fixture("v6-prelim-only", { status: "prelim_ready" });
    await db
      .update(radiologyStudiesTable)
      .set({ prelimReport: "Preliminary read only: correlate clinically.", finalReport: null, finalReportedBy: null, finalReportedAt: null })
      .where(eq(radiologyStudiesTable.id, prelim.studyId));
    const held = await archiveReportToPacs(prelim.studyId);
    expect(held.refused).toBe(true);
    expect(edge.posts).toHaveLength(1);
    for (const html of edge.rendered) expect(html).not.toContain("Preliminary read only");

    // Widening the legacy predicate to the attribution columns makes the examination's own state the one
    // thing that has to stay a bar: a CANCELLED study can carry an attributed final text from before the
    // cancellation, and that text must not reach PACS under a withdrawn examination.
    const cancelled = await fixture("v6-cancelled", { status: "cancelled" });
    await db
      .update(radiologyStudiesTable)
      .set({
        finalReport: "TEXT WRITTEN BEFORE THE EXAMINATION WAS CANCELLED",
        finalReportedBy: "Dr Bridge",
        finalReportedAt: new Date(),
      })
      .where(eq(radiologyStudiesTable.id, cancelled.studyId));
    const voided = await archiveReportToPacs(cancelled.studyId);
    expect(voided.refused, JSON.stringify(voided)).toBe(true);
    expect(voided.blockReasons).toContain("no_report");
    expect(edge.posts).toHaveLength(1);
  }, 120_000);

  it("V7 — only the authorized restore bypasses the duplicate guard, and every object it puts in PACS stays findable", async () => {
    const f = await fixture("v7-restore-visible");
    await reportRow(f, { signed: true, body: "RIGHT MCA TERRITORY INFARCT, SUBACUTE." });
    const first = await archiveReportToPacs(f.studyId);
    expect(first.success).toBe(true);

    // Ordinary Retry cannot produce a second object, from any entrypoint.
    expect((await archiveReportToPacs(f.studyId)).idempotent).toBe(true);
    expect(edge.posts).toHaveLength(1);

    // The authorized restore does — and it is the only thing that can.
    const restore = await request(app)
      .post("/api/radiology-ops/repair")
      .set(auth(adminToken))
      .send({ action: "restore_archived_report", dryRun: false, confirmToken: RESTORE_TOKEN, studyId: f.studyId, reason: RESTORE_REASON });
    expect(restore.status).toBe(200);
    expect(restore.body.executed).toBe(true);
    expect(edge.posts).toHaveLength(2);

    // Nothing is silent: both accepted objects are named in the audit history, and the restore itself
    // is attributed to the admin who asked for it with the reason he gave.
    const successes = await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS");
    const instances = new Set(successes.map((s) => s.instanceId ?? s.InstanceId));
    expect(successes).toHaveLength(2);
    expect(instances.size).toBe(2);
    const forced = await auditDetails(f.accession, "PACS_ARCHIVE_RESTORE_FORCED");
    expect(forced).toHaveLength(1);
    expect(forced[0]).toMatchObject({ reason: RESTORE_REASON });
    const [forcedRow] = await db
      .select({ actor: radiologyAuditLogTable.actor })
      .from(radiologyAuditLogTable)
      .where(and(
        eq(radiologyAuditLogTable.accessionNumber, f.accession),
        eq(radiologyAuditLogTable.action, "PACS_ARCHIVE_RESTORE_FORCED"),
      ));
    expect(String(forcedRow.actor)).toContain("Ops Admin");

    // A second restore is still deliberate, still audited, and the guard is re-armed afterwards.
    const again = await request(app)
      .post("/api/radiology-ops/repair")
      .set(auth(adminToken))
      .send({ action: "restore_archived_report", dryRun: false, confirmToken: RESTORE_TOKEN, studyId: f.studyId, reason: RESTORE_REASON });
    expect(again.body.executed).toBe(true);
    expect(edge.posts).toHaveLength(3);
    expect((await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS"))).toHaveLength(3);
    const settled = await archiveReportToPacs(f.studyId);
    expect(settled).toMatchObject({ success: true, idempotent: true });
    expect(edge.posts).toHaveLength(3);

    // Without the token or the reason it is not available at all, so no caller can duplicate by accident.
    const noToken = await request(app)
      .post("/api/radiology-ops/repair")
      .set(auth(adminToken))
      .send({ action: "restore_archived_report", dryRun: false, studyId: f.studyId, reason: RESTORE_REASON });
    expect(noToken.status).toBe(400);
    expect(edge.posts).toHaveLength(3);
  }, 180_000);

  it("V8 — a terminal archive failure is visible to an administrator without writing SQL", async () => {
    const f = await fixture("v8-dead-letter");
    await reportRow(f, { signed: false, body: "EQUIVOCAL STUDY, NO SIGNATURE YET." });
    const job = await runRearchiveJob(f, f.reportIds[0]);
    expect(job.ok).toBe(false);
    expect(job.status).toBe("abandoned");

    const list = await request(app).get("/api/radiology-ops/jobs/dead-letter").set(auth(adminToken));
    expect(list.status).toBe(200);
    // `listDeadLetterJobs` projects id/operationType/entityType/entityId/retryCount/maxRetries/
    // failureReason/createdAt/lastAttemptedAt — no `status`, because the query is already
    // `WHERE status = 'abandoned'` (radiologyJobs.ts:353-367). The reason text is what an admin reads.
    const forStudy = (list.body.jobs as Array<{ entityId: number; failureReason: string | null }>)
      .filter((r) => r.entityId === f.studyId);
    expect(forStudy.length, "the abandoned archive job is not in the dead-letter view").toBeGreaterThan(0);
    expect(forStudy[0].failureReason).toContain(NO_REPORT);

    // The divergence DECISION 6 can leave is detectable from the records alone: a revision that says the
    // object is in PACS while the study summary says otherwise.
    const reportId = await reportRow(f, { signed: true, body: "SIGNED AFTER THE FIRST REFUSAL." });
    const ok = await archiveReportToPacs(f.studyId);
    expect(ok.success).toBe(true);
    await db
      .update(radiologyStudiesTable)
      .set({ pacsArchiveStatus: "failed", pacsInstanceId: null, pacsArchiveResponse: JSON.stringify({ error: "simulated lost write" }) })
      .where(eq(radiologyStudiesTable.id, f.studyId));
    const divergent = await db
      .select({ reportId: radiologyPacsArchiveRevisionsTable.reportId, instanceId: radiologyPacsArchiveRevisionsTable.orthancInstanceId })
      .from(radiologyPacsArchiveRevisionsTable)
      .where(and(
        eq(radiologyPacsArchiveRevisionsTable.studyId, f.studyId),
        eq(radiologyPacsArchiveRevisionsTable.status, "success"),
      ));
    expect(divergent).toHaveLength(1);
    expect(divergent[0].instanceId).toBe(ok.instanceId);
    const audit = await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS");
    expect(audit.length).toBeGreaterThan(0);

    // Recovery from that state uploads nothing.
    const repaired = await archiveReportToPacs(f.studyId);
    expect(repaired).toMatchObject({ success: true, idempotent: true, instanceId: ok.instanceId });
    expect((await readStudy(f.studyId)).pacsInstanceId).toBe(ok.instanceId);
    expect(reportId).toBeGreaterThan(0);
  }, 120_000);
});


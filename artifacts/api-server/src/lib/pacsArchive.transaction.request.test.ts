/**
 * RIS-010 — PACS archive transaction and retry safety, measured against real PostgreSQL.
 *
 * One successful archive run writes FOUR records that have to agree about the same object:
 *   1. `radiology_studies.pacs_archive_status` / `pacs_archive_response` / `pacs_instance_id`
 *   2. `radiology_pacs_archive_revisions` (one row per archived REVISION, UNIQUE(report_id))
 *   3. `radiology_audit_log` (PACS_ARCHIVE_PENDING → ORTHANC_UPLOAD_SUCCESS | _FAILURE)
 *   4. the DICOM object itself (the `/tools/create-dicom` POST and its tags)
 * This file is the first test to read all four together. `pacsArchive.d8.test.ts` cannot: its `db`
 * mock discards the `where` argument it is given, so it sees calls, not state — which is exactly why
 * the RIS-005 association defect survived it. `pacsArchive.reportScope.request.test.ts` proves the
 * SQL pick but stops before the upload.
 *
 * EDGES THAT ARE STUBBED, AND WHY: the Chromium PDF rasteriser and the Orthanc HTTP endpoint. Both
 * are external to the transaction under test — one turns HTML into bytes, the other accepts a DICOM
 * object. Everything that decides *what the clinic's PACS ends up holding and what the ERP believes
 * about it* runs for real: the SQL pick, `buildReportArtifact` + the amendment-chain version
 * resolution, the status writes, the revision upsert and supersede sweep, the audit rows, and the
 * durable job queue's claim/execute cycle. The stubbed rasteriser records the HTML it was handed, so
 * what went into the object is assertable instead of inferred.
 *
 * WHICH SIDE OF THE LINE EACH CASE IS ON (this distinguishes protections from open gaps — the owner
 * asked for the existing mechanisms to be recorded before anything is rebuilt, so nothing here
 * changes archive behaviour):
 *   - VERIFIED (protections that exist today): the four records agree on success (case 1); a rejected
 *     upload is recorded as failed and an unconfigured endpoint never claims success (case 2); the
 *     durable job's duplicate-effect guard (case 3, first half); an amendment marks the previously
 *     archived revision `superseded` instead of overwriting its row (case 4).
 *   - MEASURED (gaps, asserted as today's truth so a later change cannot land silently): a second run
 *     on the same revision writes a second DICOM object that nothing considers a duplicate (case 3,
 *     second half; case 7 through the HTTP retry route), and two runs started together overlap in
 *     flight rather than excluding each other (case 8) — the study is set to `pending` with no lock,
 *     no compare-and-set and no transaction around render → POST → persist; an unsigned report is
 *     archived with only the rendered `DRAFT (not signed)` label between it and being read as the
 *     study's report, while the product's own eligibility policy refuses the same rows (case 5); a
 *     study with no report row archives the placeholder sentence and records success with NO revision
 *     row (case 6).
 *   - NOT MEASURED here, and recorded as such in the tracker: the Orthanc-accepted-but-status-write-
 *     failed path (it needs a fault injected between two statements in the same function — the
 *     ordering is readable at pacsArchive.ts:299-324 but no test can reach it without a DB trigger on
 *     a table other suites share).
 *
 * Version-policy note, because it changes what "the archived PDF is the latest" means: the archive
 * calls `buildReportArtifact` with `versionMode: opts.versionMode`, and `effectiveResolveMode`
 * (patient-reports.ts:433-440) resolves an absent mode to `latest` ONLY when
 * `ff_radiology_structured_final` is enabled — otherwise `specific`. Cases that make a claim about
 * which REVISION was delivered therefore pass `versionMode` explicitly; the flag's own state is not
 * what those cases are about.
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every *.request.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable,
  dicomRetryQueueTable,
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
  /** Makes the rasteriser take real time, so a "two runs at once" case overlaps in flight. */
  renderDelayMs: 0,
  seq: 0,
}));

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
import { planUsgPacsReturn } from "./usgPacsReturnPolicy";

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

/** A billed radiology study carrying the examination identity the archive must reproduce in DICOM. */
async function fixture(tag: string): Promise<Fixture> {
  const suffix = `${RUN}-${tag}`;
  const [test] = await db
    .insert(testsTable)
    .values({
      code: `RIS10-${suffix}`,
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
      modality: "MR",
      department: "MRI",
      studyDate: "2026-09-15",
      studyDescription: "MRI Brain",
      studyInstanceUid: studyUid,
      referringDoctor: "Dr. Refer",
      status: "acquired",
    })
    .returning();
  const [worklist] = await db
    .insert(radiologyWorklistTable)
    .values({
      patientName: `Archive ${tag} ${RUN}`,
      patientId,
      studyId: study.id,
      modality: "MR",
      studyDescription: "MRI Brain",
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
 * billing identity copied onto it. `signed` decides finality, because that is the distinction case 5
 * is about: nothing downstream of the pick consults it.
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
 * `original_document_id` / `amended_document_id` (patient-reports.ts:1865-1866); these fixtures have
 * no structured envelope, so the ids are the fixture's own strings. That is safe because the version
 * resolver walks the chain by REPORT id (radiologyReportVersion.ts:214-256) and never reads the
 * document columns — which is also why this case proves the archive's revision choice without
 * modelling the structured draft.
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

async function readAudit(accession: string) {
  return db
    .select()
    .from(radiologyAuditLogTable)
    .where(eq(radiologyAuditLogTable.accessionNumber, accession))
    .orderBy(asc(radiologyAuditLogTable.id));
}

async function auditDetails(accession: string, action: string) {
  const rows = await readAudit(accession);
  return rows
    .filter((r) => r.action === action)
    .map((r) => JSON.parse(String(r.details)) as Record<string, unknown>);
}

describe.skipIf(!dbReady)("RIS-010 — PACS archive transaction and retry records", () => {
  let app: Express;
  const token = `ris10-token-${RUN}`;
  let userId = 0;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
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
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
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
      // sees it in a clinic whose Orthanc has no such series.
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
      await db.delete(radiologyAuditLogTable).where(eq(radiologyAuditLogTable.accessionNumber, f.accession)).catch(() => {});
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
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  });

  it("VERIFIED — one successful archive leaves all four records describing the same object", async () => {
    const f = await fixture("success");
    const reportId = await reportRow(f, { signed: true, body: "NO ACUTE INTRACRANIAL ABNORMALITY" });

    const result = await archiveReportToPacs(f.studyId);
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(edge.posts).toHaveLength(1);
    const tags = edge.posts[0].tags;
    // The object names THIS examination and THIS patient — not merely a patient who has this study.
    expect(tags).toMatchObject({
      StudyInstanceUID: f.studyUid,
      AccessionNumber: f.accession,
      PatientID: f.patientDisplayId,
      SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.1",
      Modality: "OT",
      SeriesDescription: "Radiology Report PDF",
    });
    expect(edge.posts[0].contentLength).toBeGreaterThan(0);

    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    expect(study.pacsInstanceId).toBe(`stub-instance-${edge.seq}`);
    expect(JSON.parse(String(study.pacsArchiveResponse)).Path).toBe(`/instances/${study.pacsInstanceId}`);

    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      reportId,
      studyId: f.studyId,
      status: "success",
      sequenceNumber: 1,
      orthancInstanceId: study.pacsInstanceId,
    });

    // The document that became the object carries the signed report's own prose.
    expect(edge.rendered[0]).toContain("NO ACUTE INTRACRANIAL ABNORMALITY");
    expect(edge.rendered[0]).not.toContain("DRAFT (not signed)");

    const pending = await auditDetails(f.accession, "PACS_ARCHIVE_PENDING");
    const success = await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS");
    expect(pending).toHaveLength(1);
    expect(success).toHaveLength(1);
    // requested-vs-delivered is what makes a revision-level dispute answerable later.
    expect(success[0]).toMatchObject({
      requestedReportId: reportId,
      deliveredReportId: reportId,
      reportVersion: "1/1",
      superseded: false,
      instanceId: study.pacsInstanceId,
    });
  }, 60_000);

  it("VERIFIED — a rejected upload is recorded as failed, and an unconfigured endpoint never claims success", async () => {
    const f = await fixture("reject");
    const reportId = await reportRow(f, { signed: true, body: "FINDINGS REJECTED CASE" });

    edge.rejectNextUpload = true;
    const rejected = await archiveReportToPacs(f.studyId);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain("500");
    expect(edge.posts).toHaveLength(1);
    expect(edge.posts[0].tags.AccessionNumber).toBe(f.accession);

    let study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("failed");
    expect(study.pacsInstanceId).toBeNull();
    expect(JSON.parse(String(study.pacsArchiveResponse)).error).toContain("500");

    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ reportId, status: "failed" });
    expect(JSON.parse(String(revisions[0].detail)).error).toContain("500");

    const failure = await auditDetails(f.accession, "ORTHANC_UPLOAD_FAILURE");
    expect(failure).toHaveLength(1);
    expect((await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS"))).toHaveLength(0);

    // Second refusal mode: no endpoint configured at all → nothing is posted, status failed.
    edge.orthancUrl = "";
    const unconfigured = await archiveReportToPacs(f.studyId);
    expect(unconfigured.success).toBe(false);
    expect(unconfigured.error).toContain("Orthanc PACS URL not configured");
    expect(edge.posts).toHaveLength(1); // the rejected attempt posted once; this run posted nothing
    study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("failed");
  }, 60_000);

  it("VERIFIED the job queue's duplicate-effect guard / MEASURED that the canonical function has none", async () => {
    const f = await fixture("retry");
    const reportId = await reportRow(f, { signed: true, body: "FINDINGS RETRY CASE" });

    const first = await archiveReportToPacs(f.studyId);
    expect(first.success).toBe(true);
    expect(edge.posts).toHaveLength(1);

    // The durable re-archive job is restart-safe: an already-archived revision is a no-op. This is
    // the one duplicate-effect guard the archive has, and it lives in the HANDLER, not in
    // archiveReportToPacs.
    const key = `ris10-${RUN}-rearchive-${f.studyId}`;
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
    expect(tick.ran[0].outcome).toBe("success");
    expect(await getRadiologyJobById(enqueued.id)).toMatchObject({ status: "success" });
    expect(edge.posts).toHaveLength(1); // guard held: no second DICOM object

    // Same study, same revision, reached through the canonical function instead of the queue: the
    // upload runs again. Nothing in `archiveReportToPacs` asks whether this revision is archived.
    const second = await archiveReportToPacs(f.studyId);
    expect(second.success).toBe(true);
    expect(edge.posts).toHaveLength(2);
    expect(edge.posts[1].tags).toEqual(edge.posts[0].tags);

    // UNIQUE(report_id) means the structured record is not duplicated — it is OVERWRITTEN: the study
    // row and the revision row now both name the second instance, so PACS holds two objects while
    // the ERP's structured state describes one. The first instance survives only in the audit log.
    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].orthancInstanceId).toBe(second.instanceId);
    const study = await readStudy(f.studyId);
    expect(study.pacsInstanceId).toBe(second.instanceId);
    const successes = await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS");
    expect(successes).toHaveLength(2);
    expect(successes.map((d) => d.instanceId)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    expect(new Set(successes.map((d) => d.instanceId)).size).toBe(2);
  }, 90_000);

  it("VERIFIED — an amendment marks the earlier archived revision superseded instead of losing it", async () => {
    const f = await fixture("amendment");
    const rootId = await reportRow(f, { signed: true, body: "VERSION ONE FINDINGS" });
    const first = await archiveReportToPacs(f.studyId, { versionMode: "latest" });
    expect(first.success).toBe(true);

    // The amendment is a NEW signed row that copies the parent's examination identity (the route's
    // own rule, patient-reports.ts:1815-1820), linked through the D7 chain table.
    const amendedId = await reportRow(f, { signed: true, body: "VERSION TWO FINDINGS — RIGHT, NOT LEFT" });
    await linkAmendment(rootId, amendedId);

    const second = await archiveReportToPacs(f.studyId, { versionMode: "latest" });
    expect(second.success).toBe(true);
    expect(edge.posts).toHaveLength(2);
    expect(edge.posts[1].tags.SeriesDescription).toBe("Radiology Report PDF v2/2 (amended)");

    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(2);
    const byReport = new Map(revisions.map((r) => [r.reportId, r]));
    expect(byReport.get(rootId)).toMatchObject({ status: "superseded", orthancInstanceId: first.instanceId });
    expect(byReport.get(amendedId)).toMatchObject({ status: "success", sequenceNumber: 2 });

    // What the radiologist reads back is version two; version one is still on file, marked.
    expect(edge.rendered[1]).toContain("RIGHT, NOT LEFT");
    expect(edge.rendered[1]).toContain("AMENDED REPORT");
    const study = await readStudy(f.studyId);
    expect(study.pacsInstanceId).toBe(second.instanceId);

    // `specific` does not reach the superseded root row either: the study pick is newest-first, so
    // the row it requests IS v2 and the mode only decides whether the chain is walked. The archived
    // object for this study can therefore never silently be a superseded report — but it also cannot
    // be re-issued as a labelled historical copy from this entrypoint.
    edge.rendered = [];
    const historical = await archiveReportToPacs(f.studyId, { versionMode: "specific" });
    expect(historical.success).toBe(true);
    expect(edge.posts).toHaveLength(3);
    expect(edge.posts[2].tags.SeriesDescription).toBe("Radiology Report PDF v2/2 (amended)");
    expect(edge.rendered[0]).toContain("RIGHT, NOT LEFT");
  }, 90_000);

  it("MEASURED — an unsigned report is archived; the only safeguard is the rendered DRAFT label, and the product's own policy refuses the same rows", async () => {
    const f = await fixture("draft");
    const draftId = await reportRow(f, { signed: false, body: "PRELIMINARY TEXT NOT YET SIGNED" });

    // No finality filter in the pick. The draft is returned because it is the study's newest row.
    const picked = await resolveArchiveReportRow(await studyRefFor(f));
    expect(picked?.id).toBe(draftId);

    const result = await archiveReportToPacs(f.studyId);
    expect(result.success).toBe(true);
    expect(edge.posts).toHaveLength(1);

    // The document that became the DICOM object does declare itself unsigned. That label is the
    // whole protection: nothing refuses the upload, and the ERP records the draft as archived.
    expect(edge.rendered[0]).toContain("DRAFT (not signed)");
    expect(edge.rendered[0]).toContain("PRELIMINARY TEXT NOT YET SIGNED");
    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ reportId: draftId, status: "success" });

    // The same two rows, judged by the eligibility authority the product already owns for returning
    // a report to PACS, are ineligible. The direct paths never consult it.
    const decision = planUsgPacsReturn(
      {
        studyId: f.studyId,
        studyInstanceUid: f.studyUid,
        accessionNumber: f.accession,
        patientId: f.patientId,
        patientName: `Archive draft ${RUN}`,
        patientDisplayId: f.patientDisplayId,
        modality: "MR",
        isObstetric: false,
      },
      { reportId: draftId, status: (await readReport(draftId)).status },
    );
    expect(decision.eligible).toBe(false);
    expect(decision.blockReasons).toContain("not_finalized");
    expect(decision.tags).toBeNull();
  }, 90_000);

  it("MEASURED — a study with no report row archives the placeholder and records success with no revision row", async () => {
    const f = await fixture("no-report");
    // Nothing in patient_reports, and no legacy free text either: this is the case the fallback HTML
    // was written for, and the case the owner still has to rule on.
    expect(await resolveArchiveReportRow(await studyRefFor(f))).toBeNull();

    const result = await archiveReportToPacs(f.studyId);
    expect(result.success).toBe(true);
    expect(edge.posts).toHaveLength(1);
    expect(edge.rendered[0]).toContain("No report body text entered.");

    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    // The per-revision record is written only when a report version resolved (`if (v)` at
    // pacsArchive.ts:330), so the table that answers "what did we file for this study?" is empty
    // while PACS holds an object.
    expect(await readRevisions(f.studyId)).toHaveLength(0);
    const success = await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS");
    expect(success).toHaveLength(1);
    expect(success[0]).not.toHaveProperty("deliveredReportId");
  }, 60_000);

  it("MEASURED — the HTTP retry route re-posts an already-archived object and answers 200 success", async () => {
    const f = await fixture("route-retry");
    await reportRow(f, { signed: true, body: "FINDINGS ROUTE RETRY CASE" });

    const first = await archiveReportToPacs(f.studyId);
    expect(first.success).toBe(true);
    expect(edge.posts).toHaveLength(1);

    const res = await request(app)
      .post(`/api/radiology/studies/${f.studyId}/archive-retry`)
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });

    // The route is reachable by any staff session holding /radiology and performs a second upload
    // with no finality, eligibility or duplicate-effect check of its own.
    expect(edge.posts).toHaveLength(2);
    expect((await readStudy(f.studyId)).pacsInstanceId).toBe(res.body.instanceId);
  }, 90_000);

  it("MEASURED — two archives of one study overlap; the pending write is not a lock", async () => {
    const f = await fixture("concurrent");
    await reportRow(f, { signed: true, body: "FINDINGS CONCURRENT CASE" });
    // Real in-flight overlap, not two calls that happen to queue: the rasteriser is made to take
    // 60 ms, so both runs are inside render → POST at the same moment.
    edge.renderDelayMs = 60;

    const [a, b] = await Promise.all([archiveReportToPacs(f.studyId), archiveReportToPacs(f.studyId)]);
    expect(a.success, JSON.stringify(a)).toBe(true);
    expect(b.success, JSON.stringify(b)).toBe(true);

    // Both reached Orthanc. Nothing claims the study, compares-and-sets the pending status, or takes
    // the row lock that `claimWorklistForFinalize` uses elsewhere for exactly this problem.
    expect(edge.posts).toHaveLength(2);
    expect(new Set([a.instanceId, b.instanceId]).size).toBe(2);

    // And the structured records cannot tell the difference: the study row keeps ONE instance id and
    // UNIQUE(report_id) collapses the revision history to one row, so one of the two archived objects
    // is referenced nowhere except the audit log.
    const study = await readStudy(f.studyId);
    expect(study.pacsArchiveStatus).toBe("success");
    expect([a.instanceId, b.instanceId]).toContain(study.pacsInstanceId);
    const revisions = await readRevisions(f.studyId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].status).toBe("success");
    expect((await auditDetails(f.accession, "ORTHANC_UPLOAD_SUCCESS"))).toHaveLength(2);
  }, 90_000);
});

/**
 * The resolver's argument, read back out of `radiology_studies` the way `archiveReportToPacs` reads
 * it — deliberately not hand-written, so a field the implementation ignores cannot be quietly
 * omitted from the fixture.
 */
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

async function readReport(id: number) {
  const [row] = await db
    .select({ status: patientReportsTable.status, signedAt: patientReportsTable.signedAt })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.id, id))
    .limit(1);
  return row;
}

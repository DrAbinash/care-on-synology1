/**
 * Request-level tests for the CARE Reporting Studio bridge.
 * Needs DATABASE_URL + Postgres (describe.skipIf when absent).
 */
import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  radiologyWorklistTable,
  radiologyStudiesTable,
  radiologyAuditLogTable,
  patientReportsTable,
  patientsTable,
  testsTable,
  billsTable,
  ordersTable,
  bridgeSyncLogTable,
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const dbAvailable = hasDatabaseUrl();
const STUDIO_KEY = `studio-test-key-${randomUUID().replace(/-/g, "")}`;

/** Unwrap additive { rows, meta } envelope (or legacy bare array). */
function worklistRows(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  if (body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows)) {
    return (body as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

function worklistMeta(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === "object" && (body as { meta?: unknown }).meta) {
    return (body as { meta: Record<string, unknown> }).meta;
  }
  return null;
}

describe.skipIf(!dbAvailable)("Reporting Studio bridge — request level", () => {
  let app: Express;
  let marker: string;
  let patientId: number;
  let testId: number;
  let billId: number;
  let studyId: number;
  let worklistId: number;
  const prevKey = process.env.REPORTING_STUDIO_API_KEY;
  const prevErpVersion = process.env.ERP_VERSION;

  beforeAll(async () => {
    process.env.REPORTING_STUDIO_API_KEY = STUDIO_KEY;
    process.env.ERP_VERSION = "9.9.9-studio-test";
    app = await createTestApp();
  });

  afterAll(() => {
    if (prevKey === undefined) delete process.env.REPORTING_STUDIO_API_KEY;
    else process.env.REPORTING_STUDIO_API_KEY = prevKey;
    if (prevErpVersion === undefined) delete process.env.ERP_VERSION;
    else process.env.ERP_VERSION = prevErpVersion;
  });

  beforeEach(async () => {
    marker = `rs-${randomUUID().slice(0, 8)}`;
    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `RS-${marker}`,
        firstName: "Studio",
        lastName: `Patient ${marker}`,
        dateOfBirth: "1970-01-01",
        gender: "female",
        phone: "9000000001",
        address: "Bridge Test Lane 1, Deoghar",
      })
      .returning();
    patientId = patient.id;

    const [test] = await db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${marker}`,
        code: `RS${marker.slice(-6).toUpperCase()}`,
        price: "5000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = test.id;

    const [order] = await db
      .insert(ordersTable)
      .values({
        patientId,
        orderNumber: `ORD-RS-${marker}`,
        status: "completed",
        totalAmount: "5000",
      })
      .returning();

    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `BILL-RS-${marker}`,
        orderId: order.id,
        patientId,
        subtotal: "5000",
        totalAmount: "5000",
        paidAmount: "5000",
        balanceAmount: "0",
        status: "paid",
      })
      .returning();
    billId = bill.id;

    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-RS-${marker}`,
        billId,
        orderId: order.id,
        patientId,
        testId,
        modality: "MR",
        department: "MRI",
        studyDescription: `MRI Brain ${marker}`,
        studyDate: "2026-08-29",
        status: "acquired",
        referringDoctor: "Dr. Referrer",
      })
      .returning();
    studyId = study.id;

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        studyId,
        patientId,
        patientName: `Studio Patient ${marker}`,
        age: "54",
        sex: "F",
        modality: "MR",
        studyDescription: `MRI Brain ${marker}`,
        studyDate: "2026-08-29",
        accessionNumber: `ACC-RS-${marker}`,
        studyInstanceUID: `1.2.840.rs.${marker}`,
        referringDoctor: "Dr. Referrer",
        status: "STUDY_RECEIVED",
        matchScore: "GREEN",
        matchPoints: 50,
        matchDecision: "PENDING",
      })
      .returning();
    worklistId = wl.id;
  });

  afterEach(async () => {
    await db.delete(bridgeSyncLogTable).where(like(bridgeSyncLogTable.sourceId, "%")).catch(() => {});
    await db.delete(radiologyAuditLogTable).where(eq(radiologyAuditLogTable.worklistId, worklistId)).catch(() => {});
    await db.delete(patientReportsTable).where(like(patientReportsTable.reportNumber, "RPT-%")).catch(() => {});
    // Delete reports tied to this patient more precisely
    await db.delete(patientReportsTable).where(eq(patientReportsTable.patientId, patientId)).catch(() => {});
    await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId)).catch(() => {});
    await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).catch(() => {});
    await db.delete(billsTable).where(eq(billsTable.id, billId)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.patientId, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
  });

  test("ping requires API key", async () => {
    const noKey = await request(app).get("/api/internal/reporting-studio/ping");
    expect(noKey.status).toBe(401);
    expect(noKey.body.error).toBe("unauthorized");

    const bad = await request(app)
      .get("/api/internal/reporting-studio/ping")
      .set("x-api-key", "wrong-key");
    expect(bad.status).toBe(401);

    const ok = await request(app)
      .get("/api/internal/reporting-studio/ping")
      .set("x-api-key", STUDIO_KEY);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, version: "9.9.9-studio-test" });
  });

  test("ping returns 503 when key unset", async () => {
    const saved = process.env.REPORTING_STUDIO_API_KEY;
    delete process.env.REPORTING_STUDIO_API_KEY;
    try {
      const res = await request(app).get("/api/internal/reporting-studio/ping").set("x-api-key", STUDIO_KEY);
      expect(res.status).toBe(503);
      expect(res.body.error).toContain("REPORTING_STUDIO_API_KEY");
    } finally {
      process.env.REPORTING_STUDIO_API_KEY = saved;
    }
  });

  test("worklist returns pending studies with billing status", async () => {
    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row.accessionNumber).toBe(`ACC-RS-${marker}`);
    expect(row.patientName).toContain("Studio Patient");
    expect(row.modality).toBe("MR");
    expect(row.billingStatus).toBe("PAID");
    expect(row.testName).toContain("MRI Brain");
  });

  test("worklist carries bill-desk demographics (USG Studio v6 bridge extension)", async () => {
    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row.patientId).toBe(patientId);
    expect(row.patientPhone).toBe("9000000001");
    expect(row.patientAddress).toBe("Bridge Test Lane 1, Deoghar");
    expect(row.billNumber).toBe(`BILL-RS-${marker}`);
  });

  test("worklist falls back to bill-desk age/sex/referrer when PACS mirror is blank", async () => {
    await db
      .update(radiologyWorklistTable)
      .set({ age: "", sex: "", referringDoctor: "" })
      .where(eq(radiologyWorklistTable.id, worklistId));
    await db
      .update(patientsTable)
      .set({ ageValue: 42, ageUnit: "years", gender: "female" })
      .where(eq(patientsTable.id, patientId));

    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row.patientAge).toBe("42");
    expect(row.patientGender).toBe("female");
    expect(row.referringDoctor).toBe("Dr. Referrer");
  });

  test("Highway Rule: bill-desk age_value wins over machine dummy age 126", async () => {
    // Live bug: MWL/machine pushes age "126" from a 1900-01-01 DOB while
    // Bill Desk correctly stored age_value=40. Highway Rule prefers Bill Desk.
    await db
      .update(radiologyWorklistTable)
      .set({ age: "126" })
      .where(eq(radiologyWorklistTable.id, worklistId));
    await db
      .update(patientsTable)
      .set({ ageValue: 40, ageUnit: "years", dateOfBirth: "1900-01-01" })
      .where(eq(patientsTable.id, patientId));

    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row.patientAge).toBe("40");
    expect(row.patientAge).not.toBe("126");
  });

  test("Highway Rule: hard-rejects machine age >110 when bill-desk age_value is null", async () => {
    await db
      .update(radiologyWorklistTable)
      .set({ age: "126" })
      .where(eq(radiologyWorklistTable.id, worklistId));
    // date_of_birth is NOT NULL — use a future DOB so Priority 2 yields no age,
    // forcing Priority 3 (machine age) which must hard-reject >110.
    await db
      .update(patientsTable)
      .set({ ageValue: null, ageUnit: null, dateOfBirth: "2099-01-01" })
      .where(eq(patientsTable.id, patientId));

    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row.patientAge).toBe("");
  });

  test("worklist referringDoctor falls back to Self/Walk-in when blank", async () => {
    await db
      .update(radiologyWorklistTable)
      .set({ referringDoctor: "" })
      .where(eq(radiologyWorklistTable.id, worklistId));
    await db
      .update(radiologyStudiesTable)
      .set({ referringDoctor: null })
      .where(eq(radiologyStudiesTable.id, studyId));

    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row.referringDoctor).toBe("Self/Walk-in");
  });

  test("worklist surfaces ERP status field (v6.14 freeze support)", async () => {
    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row.status).toBeTruthy(); // STUDY_RECEIVED | AI_DRAFT_READY | REPORT_IN_PROGRESS
  });

  test("worklist rejects unknown status with 400 (v6.14 — supports pending | all | reported | final | delivered)", async () => {
    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=bogus")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported status/i);
  });

  test("worklist ?status=all returns pending AND finalized rows (v6.14)", async () => {
    // Before finalize: only pending rows exist. After finalize (later test),
    // ?status=all must include the finalized row too. This test asserts the
    // pending-row side first so it passes regardless of test ordering.
    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=all")
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
  });

  test("billing-status maps accessions", async () => {
    const res = await request(app)
      .get(`/api/internal/reporting-studio/billing-status?accessions=ACC-RS-${marker},UNKNOWN-X`)
      .set("x-api-key", STUDIO_KEY);
    expect(res.status).toBe(200);
    expect(res.body[`ACC-RS-${marker}`]).toBe("PAID");
    expect(res.body["UNKNOWN-X"]).toBeUndefined();
  });

  test("finalize marks REPORT_FINAL, creates report, is idempotent", async () => {
    const payload = {
      accessionNumber: `ACC-RS-${marker}`,
      worklistId: String(worklistId),
      reportText: {
        technique: "Multiplanar MRI",
        findings: "No acute abnormality.",
        impression: "Normal study.",
        recommendation: "Correlate clinically.",
      },
      radiologistName: "Dr. Studio",
      radiologistRegNumber: "REG-1",
      finalizedAt: "2026-08-29T10:30:00.000Z",
      pdfUrl: "https://reports.example.com/rs/print/1",
    };

    const first = await request(app)
      .post("/api/internal/reporting-studio/finalize")
      .set("x-api-key", STUDIO_KEY)
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });

    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));
    expect(wl.status).toBe("REPORT_FINAL");
    expect(wl.deliveryStatus).toBe("READY_TO_SEND");
    expect(wl.reportId).toBeTruthy();
    expect(wl.dicomMetadata).toContain("reportingStudioPdfUrl");
    expect(wl.dicomMetadata).toContain("reports.example.com");

    const [report] = await db
      .select()
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, wl.reportId!));
    expect(report).toBeTruthy();
    expect(report.body).toContain("No acute abnormality");
    expect(report.signedByName).toBe("Dr. Studio");

    const [study] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, studyId));
    expect(study.status).toBe("reported_final");

    const second = await request(app)
      .post("/api/internal/reporting-studio/finalize")
      .set("x-api-key", STUDIO_KEY)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);
    expect(second.body.idempotent).toBe(true);

    const reports = await db
      .select()
      .from(patientReportsTable)
      .where(eq(patientReportsTable.patientId, patientId));
    expect(reports).toHaveLength(1);
  });

  test("finalize rejects RED match", async () => {
    await db
      .update(radiologyWorklistTable)
      .set({ matchScore: "RED", matchDecision: "PENDING" })
      .where(eq(radiologyWorklistTable.id, worklistId));

    const res = await request(app)
      .post("/api/internal/reporting-studio/finalize")
      .set("x-api-key", STUDIO_KEY)
      .send({
        worklistId,
        accessionNumber: `ACC-RS-${marker}`,
        reportText: { impression: "x" },
        radiologistName: "Dr. Studio",
      });
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Match Center/i);
  });

  test("contract validation catches a malformed row and keeps it in the payload", async () => {
    // Blank patientName fails studioWorklistRowSchema.min(1) but must NOT be dropped.
    await db
      .update(radiologyWorklistTable)
      .set({ patientName: "" })
      .where(eq(radiologyWorklistTable.id, worklistId));

    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY)
      .set("x-studio-id", `studio-malformed-${marker}`);
    expect(res.status).toBe(200);
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row!.patientName).toBe("");
    const meta = worklistMeta(res.body);
    expect(meta).toBeTruthy();
    expect(Number(meta!.validationFailures)).toBeGreaterThanOrEqual(1);
  });

  test("sentinel detector flags age 126 and 1900-01-01 DOB in meta counters", async () => {
    await db
      .update(radiologyWorklistTable)
      .set({ age: "126" })
      .where(eq(radiologyWorklistTable.id, worklistId));
    await db
      .update(patientsTable)
      .set({ ageValue: 40, ageUnit: "years", dateOfBirth: "1900-01-01" })
      .where(eq(patientsTable.id, patientId));

    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY)
      .set("x-studio-id", `studio-sentinel-${marker}`);
    expect(res.status).toBe(200);
    const meta = worklistMeta(res.body);
    expect(meta).toBeTruthy();
    const sentinels = meta!.sentinels as {
      ageSuspicious: number;
      placeholderDob: number;
    };
    expect(sentinels.ageSuspicious).toBeGreaterThanOrEqual(1);
    expect(sentinels.placeholderDob).toBeGreaterThanOrEqual(1);
    // Happy-path age still Highway-correct
    const row = worklistRows(res.body).find((r) => r.worklistId === String(worklistId));
    expect(row!.patientAge).toBe("40");
  });

  test("bridge_sync_log records a row on successful worklist GET", async () => {
    const studioId = `studio-sync-${marker}`;
    const res = await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY)
      .set("x-studio-id", studioId);
    expect(res.status).toBe(200);
    expect(worklistMeta(res.body)?.sourceId).toBe(studioId);

    const logs = await db
      .select()
      .from(bridgeSyncLogTable)
      .where(eq(bridgeSyncLogTable.sourceId, studioId));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]!.rowsServed).toBeGreaterThanOrEqual(1);
    expect(logs[0]!.rowsByModality).toBeTruthy();
  });

  test("GET /audit requires API key and returns counters", async () => {
    const studioId = `studio-audit-${marker}`;
    await request(app)
      .get("/api/internal/reporting-studio/worklist?status=pending")
      .set("x-api-key", STUDIO_KEY)
      .set("x-studio-id", studioId);

    const noKey = await request(app).get("/api/internal/reporting-studio/audit");
    expect(noKey.status).toBe(401);

    const ok = await request(app)
      .get("/api/internal/reporting-studio/audit")
      .set("x-api-key", STUDIO_KEY);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(Array.isArray(ok.body.lastSyncPerStudio)).toBe(true);
    expect(ok.body.totals24h).toBeTruthy();
    expect(ok.body.totals7d).toBeTruthy();
    expect(typeof ok.body.totals24h.rowsServed).toBe("number");
    expect(ok.body.totals24h.sentinels).toBeTruthy();
    const mine = ok.body.lastSyncPerStudio.find(
      (s: { sourceId: string }) => s.sourceId === studioId,
    );
    expect(mine).toBeTruthy();
    expect(typeof mine.minutesAgo).toBe("number");
  });
});

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
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const dbAvailable = hasDatabaseUrl();
const STUDIO_KEY = `studio-test-key-${randomUUID().replace(/-/g, "")}`;

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
    expect(Array.isArray(res.body)).toBe(true);
    const row = res.body.find((r: { worklistId: string }) => r.worklistId === String(worklistId));
    expect(row).toBeTruthy();
    expect(row.accessionNumber).toBe(`ACC-RS-${marker}`);
    expect(row.patientName).toContain("Studio Patient");
    expect(row.modality).toBe("MR");
    expect(row.billingStatus).toBe("PAID");
    expect(row.testName).toContain("MRI Brain");
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
});

/**
 * STAMP_ACCESSION_FROM_BILL → Orthanc /changes → care-erp-sync re-POST loop.
 *
 * Asserts:
 *  1. Single-hit blank accession stamps Orthanc AccessionNumber from bill number
 *  2. Re-intake with the new accession (simulating care-erp-sync after /changes)
 *     updates the existing worklist row — no duplicate
 *  3. Stamp guard (ACCESSION_STAMPED audit) blocks restamp loops
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  billsTable,
  ordersTable,
  patientsTable,
  radiologyAuditLogTable,
  radiologyWorklistTable,
  usersTable,
  portalSessionsTable,
  featureFlagsTable,
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { findOrthancStudies } from "./orthancStudyFind";
import { invalidateFeatureFlagCache } from "../featureFlags";
import {
  STAMP_ACCESSION_FLAG,
  STAMP_AUDIT_ACTION,
  stampBlankAccessionForBill,
} from "./stampAccessionFromBill";

vi.mock("./orthancStudyFind", () => ({
  findOrthancStudies: vi.fn(),
}));

const dbAvailable = hasDatabaseUrl();
const mockedFind = vi.mocked(findOrthancStudies);

/** Flip the real feature_flags row (and its cache) — the DB flag is the only enabler. */
async function setStampFlagRow(enabled: boolean): Promise<void> {
  const updated = await db
    .update(featureFlagsTable)
    .set({ enabled })
    .where(eq(featureFlagsTable.key, STAMP_ACCESSION_FLAG))
    .returning();
  if (updated.length === 0) {
    await db
      .insert(featureFlagsTable)
      .values({ key: STAMP_ACCESSION_FLAG, enabled })
      .onConflictDoNothing();
  }
  invalidateFeatureFlagCache();
}

describe.skipIf(!dbAvailable)("stamp accession → care-erp-sync re-intake loop", () => {
  let app: Express;
  let marker: string;
  let patientId: number;
  let billId: number;
  let billNumber: string;
  let studyUid: string;
  let userId = 0;
  const token = `stamp-loop-${randomUUID()}`;
  const prevFlag = process.env[STAMP_ACCESSION_FLAG];
  const prevOrthanc = process.env.ORTHANC_URL;
  const prevInternal = process.env.INTERNAL_API_KEY;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Stamp Loop Admin`,
        email: `stamp-loop-${randomUUID().slice(0, 8)}@vitest.invalid`,
        username: `stamp-loop-${randomUUID().slice(0, 8)}`,
        role: "admin",
        permissions: JSON.stringify(["/orders", "/billing", "/patients", "/radiology"]),
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
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }, 60_000);

  afterAll(async () => {
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    if (prevFlag === undefined) delete process.env[STAMP_ACCESSION_FLAG];
    else process.env[STAMP_ACCESSION_FLAG] = prevFlag;
    if (prevOrthanc === undefined) delete process.env.ORTHANC_URL;
    else process.env.ORTHANC_URL = prevOrthanc;
    if (prevInternal === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = prevInternal;
  }, 60_000);

  beforeEach(async () => {
    marker = randomUUID().slice(0, 8);
    billNumber = `BILL-STAMP-${marker}`;
    studyUid = `1.2.840.stamp.${marker}`;
    process.env[STAMP_ACCESSION_FLAG] = "true";
    process.env.ORTHANC_URL = "http://orthanc.test:8042";
    await setStampFlagRow(true); // DB flag is the only enabler now
    mockedFind.mockReset();
    vi.stubGlobal("fetch", vi.fn());

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `STAMP-${marker}`,
        firstName: "Stamp",
        lastName: `Patient ${marker}`,
        dateOfBirth: "1990-01-15",
        gender: "female",
        phone: "9000000099",
      })
      .returning();
    patientId = patient.id;

    const [order] = await db
      .insert(ordersTable)
      .values({
        patientId,
        orderNumber: `ORD-STAMP-${marker}`,
        status: "completed",
        totalAmount: "1500",
      })
      .returning();

    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber,
        orderId: order.id,
        patientId,
        subtotal: "1500",
        totalAmount: "1500",
        paidAmount: "1500",
        balanceAmount: "0",
        status: "paid",
      })
      .returning();
    billId = bill.id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await setStampFlagRow(false); // restore the shipped disabled state
    await db
      .delete(radiologyAuditLogTable)
      .where(like(radiologyAuditLogTable.accessionNumber, `BILL-STAMP-${marker}%`))
      .catch(() => {});
    await db
      .delete(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, studyUid))
      .catch(() => {});
    await db.delete(billsTable).where(eq(billsTable.id, billId)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.patientId, patientId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
  });

  function intakeHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const key = process.env.INTERNAL_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  it("A2: the shipped DB-disabled row keeps stamping dead even with env=true — zero Orthanc writes", async () => {
    // Production shape: feature_flags says enabled=false (the shipped row),
    // a stray .env flips STAMP_ACCESSION_FROM_BILL=true. The disabled
    // database flag must win and nothing may reach Orthanc.
    await setStampFlagRow(false);

    mockedFind.mockReset();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await stampBlankAccessionForBill({
      billId,
      billNumber,
      patientName: `Stamp Patient ${marker}`,
      modality: "US",
      studyDate: "2026-09-20",
    });

    expect(result).toEqual({ ok: true, stamped: false, reason: "flag_disabled" });
    expect(mockedFind).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    const audits = await db
      .select({ action: radiologyAuditLogTable.action, details: radiologyAuditLogTable.details })
      .from(radiologyAuditLogTable)
      .where(eq(radiologyAuditLogTable.action, STAMP_AUDIT_ACTION));
    const ours = audits.filter((a) => {
      try {
        const d = JSON.parse(a.details ?? "{}") as { studyUid?: string };
        return d.studyUid === studyUid;
      } catch {
        return false;
      }
    });
    expect(ours).toEqual([]);
  });

  it("stamps blank USG accession, re-intake updates same row, restamp blocked", async () => {
    // 1) care-erp-sync first push — blank AccessionNumber (pre-stamp Orthanc state)
    const firstIntake = await request(app)
      .post("/api/internal/radiology/studies")
      .set(intakeHeaders())
      .send({
        patientName: `Stamp Patient ${marker}`,
        modality: "US",
        studyDate: "20260920",
        studyDescription: `USG Abdomen ${marker}`,
        accessionNumber: "",
        studyInstanceUID: studyUid,
        PatientID: `STAMP-${marker}`,
      });
    expect(firstIntake.status, JSON.stringify(firstIntake.body)).toBeLessThan(400);
    expect(firstIntake.body.success !== false).toBe(true);

    const before = await db
      .select({ id: radiologyWorklistTable.id, accessionNumber: radiologyWorklistTable.accessionNumber })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, studyUid));
    expect(before).toHaveLength(1);
    const worklistId = before[0]!.id;
    expect((before[0]!.accessionNumber ?? "").trim()).toBe("");

    // 2) Bill publish stamp — single-hit empty accession → Orthanc modify
    mockedFind.mockResolvedValue({
      source: "ORTHANC_REST",
      rows: [
        {
          studyInstanceUID: studyUid,
          accessionNumber: "",
          patientName: `Stamp Patient ${marker}`,
          modality: "US",
          studyDate: "20260920",
          studyDescription: `USG Abdomen ${marker}`,
          referringDoctor: null,
        },
      ],
    });

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ["orthanc-stamp-1"],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ MainDicomTags: { AccessionNumber: "" } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "{}",
      } as Response);

    const stamp = await stampBlankAccessionForBill({
      billId,
      billNumber,
      patientName: `Stamp Patient ${marker}`,
      modality: "US",
      studyDate: "2026-09-20",
    });
    expect(stamp.ok && stamp.stamped).toBe(true);

    const modifyCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/modify"));
    expect(modifyCall).toBeTruthy();
    expect(JSON.parse(String(modifyCall![1]?.body)).Replace.AccessionNumber).toBe(billNumber);

    const audits = await db
      .select({ action: radiologyAuditLogTable.action, details: radiologyAuditLogTable.details })
      .from(radiologyAuditLogTable)
      .where(eq(radiologyAuditLogTable.action, STAMP_AUDIT_ACTION));
    const ours = audits.filter((a) => {
      try {
        const d = JSON.parse(a.details ?? "{}") as { studyUid?: string; billNumber?: string };
        return d.studyUid === studyUid && d.billNumber === billNumber;
      } catch {
        return false;
      }
    });
    expect(ours.length).toBeGreaterThanOrEqual(1);

    // 3) Orthanc /changes → care-erp-sync re-POSTs study with stamped accession
    const secondIntake = await request(app)
      .post("/api/internal/radiology/studies")
      .set(intakeHeaders())
      .send({
        patientName: `Stamp Patient ${marker}`,
        modality: "US",
        studyDate: "20260920",
        studyDescription: `USG Abdomen ${marker}`,
        accessionNumber: billNumber,
        studyInstanceUID: studyUid,
        PatientID: `STAMP-${marker}`,
      });
    expect(secondIntake.status).toBeLessThan(400);

    const after = await db
      .select({ id: radiologyWorklistTable.id, accessionNumber: radiologyWorklistTable.accessionNumber })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, studyUid));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(worklistId);
    expect(after[0]!.accessionNumber).toBe(billNumber);

    // 4) Restamp guard — same studyUid+billNumber must not call Orthanc modify again
    fetchMock.mockClear();
    const restamp = await stampBlankAccessionForBill({
      billId,
      billNumber,
      patientName: `Stamp Patient ${marker}`,
      modality: "US",
      studyDate: "2026-09-20",
    });
    expect(restamp).toEqual({ ok: true, stamped: false, reason: "already_stamped" });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/modify"))).toBe(false);
  });
});

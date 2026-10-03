/**
 * USG intake → bill-desk link, at request level.
 *
 * The ultrasound unit has no MWL, so intake can never carry CARE's accession:
 * measured 666 of 668 US worklist rows arriving with study_id NULL while every
 * one of the 711 billed US studies had an accession. These tests pin the fix —
 * intake links the study by name/modality/date through the existing
 * auto-link matcher — and the refusal when two people tie.
 *
 * Skips automatically when DATABASE_URL is not exported.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable,
  orderTestsTable,
  ordersTable,
  patientsTable,
  radiologyAuditLogTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  testsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("USG intake bill-desk link — request level", () => {
  let app: Express;
  const marker = `uslink-${randomUUID().slice(0, 8)}`;

  let testUsg = 0;
  let patientSolo = 0;
  let studySolo = 0;
  let patientTwinA = 0;
  let patientTwinB = 0;
  let studyTwinA = 0;
  let studyTwinB = 0;
  const worklistIds: number[] = [];

  const dicomUidSolo = `1.2.840.uslink.solo.${marker}`;
  const dicomUidTwin = `1.2.840.uslink.twin.${marker}`;

  /** YYYYMMDD — exactly what Orthanc hands to care-erp-sync. */
  const dicomToday = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const isoToday = () => new Date().toISOString().slice(0, 10);

  async function seedBilledUsgStudy(opts: {
    firstName: string;
    lastName: string;
    ageValue: number;
    accession: string;
  }) {
    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `UH-${opts.accession}`,
        firstName: opts.firstName,
        lastName: opts.lastName,
        dateOfBirth: `${new Date().getFullYear() - opts.ageValue}-01-01`,
        ageValue: opts.ageValue,
        ageUnit: "years",
        gender: "female",
        phone: "9100000000",
      })
      .returning();

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-${opts.accession}`, patientId: patient.id, status: "pending" })
      .returning();
    const [orderTest] = await db
      .insert(orderTestsTable)
      .values({ orderId: order.id, testId: testUsg, price: "1500" })
      .returning();
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `BL-${opts.accession}`,
        orderId: order.id,
        patientId: patient.id,
        subtotal: "1500",
        totalAmount: "1500",
      })
      .returning();
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: opts.accession,
        billId: bill.id,
        orderId: order.id,
        orderTestId: orderTest.id,
        patientId: patient.id,
        testId: testUsg,
        modality: "US",
        department: "USG",
        studyDescription: "USG Obstetric",
        studyDate: isoToday(),
        status: "scheduled",
      })
      .returning();

    return { patientId: patient.id, studyId: study.id, orderId: order.id };
  }

  async function postScannerStudy(patientName: string, dicomPatientId: string, uid: string) {
    const headers: Record<string, string> = {};
    const internalKey = process.env.INTERNAL_API_KEY;
    if (internalKey) headers.Authorization = `Bearer ${internalKey}`;

    const res = await request(app)
      .post("/api/internal/radiology/studies")
      .set(headers)
      .send({
        // Exactly what care-erp-sync puts on the wire: normalize_person_name
        // turns LAST^FIRST into "LAST FIRST", so the token order here is the
        // reverse of how Bill Desk stores it ("FIRST LAST").
        patientName,
        patientId: dicomPatientId,
        sex: "F",
        modality: "US",
        studyDescription: "USG Obstetric",
        studyDate: dicomToday(),
        accessionNumber: "",
        studyInstanceUID: uid,
      });
    return res;
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [usg] = await db
      .insert(testsTable)
      .values({
        name: `USG Obstetric ${marker}`,
        code: `USG${marker.slice(-4).toUpperCase()}`,
        price: "1500",
        category: "Radiology",
        department: "USG",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testUsg = usg.id;

    const solo = await seedBilledUsgStudy({
      firstName: "Asha",
      lastName: `Solo ${marker}`,
      ageValue: 31,
      accession: `ACC-${marker}-SOLO`,
    });
    patientSolo = solo.patientId;
    studySolo = solo.studyId;

    const twinA = await seedBilledUsgStudy({
      firstName: "Bina",
      lastName: `Twin ${marker}`,
      ageValue: 28,
      accession: `ACC-${marker}-TWINA`,
    });
    const twinB = await seedBilledUsgStudy({
      firstName: "Bina",
      lastName: `Twin ${marker}`,
      ageValue: 44,
      accession: `ACC-${marker}-TWINB`,
    });
    patientTwinA = twinA.patientId;
    studyTwinA = twinA.studyId;
    patientTwinB = twinB.patientId;
    studyTwinB = twinB.studyId;
  }, 120_000);

  afterAll(async () => {
    if (worklistIds.length > 0) {
      await db
        .delete(radiologyAuditLogTable)
        .where(
          or(
            ...worklistIds.map((id) => eq(radiologyAuditLogTable.worklistId, id)),
            sql`${radiologyAuditLogTable.details} like ${`%${marker}%`}`,
          ),
        )
        .catch(() => {});
      await db
        .delete(radiologyWorklistTable)
        .where(or(...worklistIds.map((id) => eq(radiologyWorklistTable.id, id))))
        .catch(() => {});
    }
    for (const pid of [patientSolo, patientTwinA, patientTwinB]) {
      if (!pid) continue;
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.patientId, pid)).catch(() => {});
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.patientId, pid)).catch(() => {});
      await db.delete(billsTable).where(eq(billsTable.patientId, pid)).catch(() => {});
    }
    const orderIds = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(sql`${ordersTable.orderNumber} like ${`ORD-ACC-${marker}%`}`);
    for (const o of orderIds) {
      await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, o.id)).catch(() => {});
      await db.delete(ordersTable).where(eq(ordersTable.id, o.id)).catch(() => {});
    }
    await db.delete(testsTable).where(eq(testsTable.id, testUsg)).catch(() => {});
    for (const pid of [patientSolo, patientTwinA, patientTwinB]) {
      if (pid) await db.delete(patientsTable).where(eq(patientsTable.id, pid)).catch(() => {});
    }
  }, 120_000);

  it("links a blank-accession USG study to the day's only billed US study, name order aside", async () => {
    const res = await postScannerStudy(`Solo ${marker} Asha`, `E42561-${marker}`, dicomUidSolo);
    expect(res.status).toBe(201);
    const worklistId = Number(res.body?.worklistId);
    expect(worklistId).toBeGreaterThan(0);
    worklistIds.push(worklistId);

    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));
    // The whole point: the worklist row now knows its billed study and the
    // bill's patient, so bill number, test name, referrer and demographics all
    // become reachable for the Studio and the ERP worklist.
    expect(wl.studyId).toBe(studySolo);
    expect(wl.patientId).toBe(patientSolo);
    // The scanner's own identifier is still retained, not overwritten.
    expect(wl.dicomPatientId).toBe(`E42561-${marker}`);
    expect(wl.modality).toBe("US");

    // The link must not stop at the worklist row: the UID is bridged onto the
    // billed study so every later pull (and OHIF) resolves the same study.
    const [study] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, studySolo));
    expect(study.studyInstanceUid).toBe(dicomUidSolo);
    expect(study.status).toBe("acquired");

    const [audit] = await db
      .select()
      .from(radiologyAuditLogTable)
      .where(
        and(
          eq(radiologyAuditLogTable.worklistId, worklistId),
          eq(radiologyAuditLogTable.action, "AUTO_LINK_BILLED"),
        ),
      );
    expect(audit?.actor).toBe("pacs-intake");
    expect(String(audit?.details)).toContain("name-referral");
  }, 60_000);

  it("refuses to guess when two same-name billed US studies exist that day", async () => {
    const res = await postScannerStudy(`Twin ${marker} Bina`, `E42562-${marker}`, dicomUidTwin);
    expect(res.status).toBe(201);
    const worklistId = Number(res.body?.worklistId);
    expect(worklistId).toBeGreaterThan(0);
    worklistIds.push(worklistId);

    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));
    // Ambiguous stays ambiguous — Match Center's job, not the sync's. A wrong
    // link here would print one patient's report on another's bill.
    expect(wl.studyId).toBeNull();
    expect(wl.patientId).toBeNull();

    for (const studyId of [studyTwinA, studyTwinB]) {
      const [s] = await db
        .select()
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.id, studyId));
      expect(s.studyInstanceUid).toBeNull();
    }
  }, 60_000);

  it("still answers 201 when nothing billed matches, so the study is never dropped", async () => {
    // care-erp-sync treats any non-2xx as permanent and advances its cursor,
    // so intake must keep accepting studies it cannot link.
    const res = await postScannerStudy(`Nowhere ${marker} Cala`, `E42563-${marker}`, `1.2.840.uslink.none.${marker}`);
    expect(res.status).toBe(201);
    const worklistId = Number(res.body?.worklistId);
    expect(worklistId).toBeGreaterThan(0);
    worklistIds.push(worklistId);

    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId));
    expect(wl.studyId).toBeNull();
    expect(wl.patientId).toBeNull();
    // Filed, not discarded — the row is what Match Center works from later.
    expect(String(wl.patientName)).toContain("Cala");
  }, 60_000);
});

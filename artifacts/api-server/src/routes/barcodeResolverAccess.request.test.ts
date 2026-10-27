/**
 * Who may scan, and what a scan may reveal — request level.
 * ==========================================================================
 * `/api/resolve-barcode` was mounted on bare `requireStaffAuth`, so a signed-in
 * staff account holding no module permission at all could enumerate a code and
 * read back a patient's identity, and `GET /patient/:id/reports` selected the
 * whole `patient_reports` row, so it handed the delivery counter the `body` and
 * `impression` of every report a patient ever had, drafts included.
 *
 * Both are asserted here by issuing real requests through the production router
 * — the same chain the clinic serves — rather than by reading source text. A
 * grep for a removed field stays green when the field comes back under a new
 * name; a `toContain` on the response of a live request cannot.
 *
 * The second half of the contract is that closing this must not cost the clinic
 * anything it has today. Four surfaces call this API (Scan Station, the
 * inventory strip, Report Generator, the report counter) and the repository does
 * not say which of them the counter is staffed by, so the assertions below pin
 * both directions: an ungranted account is refused, and every granted role that
 * scans today keeps scanning.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  patientsTable, testsTable, patientReportsTable, portalSessionsTable, usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const marker = `BARACC${randomUUID().slice(0, 8)}`;

// Sentinels that must never cross the counter. Kept distinct from `marker`,
// which legitimately appears in report numbers, titles and test names.
const BODY_TEXT = `CLINICAL-BODY-${marker}`;
const IMPRESSION_TEXT = `CLINICAL-IMPRESSION-${marker}`;
const PARAMETER_TEXT = `CLINICAL-PARAM-${marker}`;

describe.skipIf(!dbReady)("barcode resolver access control — request level", () => {
  let app: Express;
  let patientId = 0;
  let testId = 0;

  /** A staff account holding exactly the given permission strings, with a live session. */
  async function makeStaff(name: string, permissions: string[], role = "receptionist"): Promise<string> {
    const token = `vitest-bar-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        email: `${name.toLowerCase().replace(/\W+/g, "-")}-${marker}@vitest.invalid`,
        username: `${name.replace(/\W+/g, "")}-${marker}`,
        role,
        permissions: JSON.stringify(permissions),
        pin: "0000",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    return token;
  }

  /**
   * The states the release rule has to tell apart, using only statuses the real
   * routes write: `/sign` stores signatureId + signedAt and moves the row to
   * `pending_verification` (patient-reports.ts:2880-2885); `/verify` is what
   * makes it `verified`, and it refuses signer == verifier.
   */
  const reportIds: Record<string, number> = {};

  async function makeReport(key: string, status: string, signed: boolean) {
    const reportNumber = `RPT-${marker}-${key.toUpperCase()}`;
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber,
        type: "radiology",
        patientId,
        testId,
        title: `Probe ${reportNumber}`,
        status,
        body: BODY_TEXT,
        impression: IMPRESSION_TEXT,
        parameters: JSON.stringify([{ name: PARAMETER_TEXT, value: 1 }]),
        signedAt: signed ? new Date() : null,
        signedByName: signed ? "Dr Sugandha" : null,
        signatureId: signed ? 1 : null,
      })
      .returning({ id: patientReportsTable.id });
    reportIds[key] = row.id;
  }

  let ungrantedToken = "";
  let labToken = "";
  let billingToken = "";
  let deliveryToken = "";
  let adminToken = "";

  beforeAll(async () => {
    app = await createTestApp();

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `VITEST-${marker}`,
        firstName: `Barcode${marker}`,
        lastName: "Probe",
        dateOfBirth: "1980-01-01",
        gender: "M",
        phone: "9000000000",
      })
      .returning({ id: patientsTable.id });
    patientId = patient.id;

    const [test] = await db
      .insert(testsTable)
      .values({
        code: `VITEST-${marker}`,
        name: `MRI Brain ${marker}`,
        category: "MRI",
        duration: "45",
        price: "1000.00",
        department: "MRI",
      })
      .returning({ id: testsTable.id });
    testId = test.id;

    await makeReport("draft", "draft", false);
    await makeReport("unsigned", "pending_verification", false);
    await makeReport("pensigned", "pending_verification", true);
    await makeReport("countersigned", "verified", false);

    [ungrantedToken, labToken, billingToken, deliveryToken, adminToken] = await Promise.all([
      makeStaff(`Ungranted ${marker}`, []),
      makeStaff(`Lab ${marker}`, ["/samples", "/scan-station", "/report-delivery"]),
      makeStaff(`Billing ${marker}`, ["/billing", "/patients"]),
      makeStaff(`Delivery ${marker}`, ["/report-delivery:receive"]),
      makeStaff(`Admin ${marker}`, [], "admin"),
    ]);
  });

  afterAll(async () => {
    // Reports before the patient: nothing here uses patient_reports.bill_id (the
    // table's only FK), but the order keeps the teardown from depending on that.
    await db.delete(patientReportsTable).where(eq(patientReportsTable.patientId, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(portalSessionsTable).where(like(portalSessionsTable.token, "vitest-bar-%")).catch(() => {});
    await db.delete(usersTable).where(like(usersTable.name, `%${marker}%`)).catch(() => {});
  });

  const scan = (token: string) =>
    request(app)
      .get(`/api/resolve-barcode/${encodeURIComponent(`VITEST-${marker}`)}`)
      .set("Authorization", `Bearer ${token}`);

  it("refuses an account that holds no module permission", async () => {
    for (const [label, call] of [
      ["resolve", () => scan(ungrantedToken)],
      ["report list", () => request(app).get(`/api/resolve-barcode/patient/${patientId}/reports`).set("Authorization", `Bearer ${ungrantedToken}`)],
      ["one-click deliver", () => request(app).post(`/api/resolve-barcode/reports/${reportIds.pensigned}/deliver`).set("Authorization", `Bearer ${ungrantedToken}`).send({})],
    ] as const) {
      const res = await call();
      expect(res.status, `${label} must refuse an ungranted account`).toBe(403);
      expect(JSON.stringify(res.body), `${label} must not answer with patient identity`).not.toContain(`Barcode${marker}`);
    }
  });

  it("still serves every surface that scans today", async () => {
    for (const [who, token] of [
      ["laboratory", labToken],
      ["front desk / billing", billingToken],
      ["delivery counter", deliveryToken],
      ["admin", adminToken],
    ] as const) {
      const res = await scan(token);
      expect(res.status, `${who} must keep scanning`).toBe(200);
      expect(res.body.patient?.firstName, `${who} must see the patient it scanned`).toBe(`Barcode${marker}`);
    }
  });

  it("lists only clinically authorised reports", async () => {
    const res = await request(app)
      .get(`/api/resolve-barcode/patient/${patientId}/reports`)
      .set("Authorization", `Bearer ${deliveryToken}`);
    expect(res.status).toBe(200);

    const ids = (res.body.reports as { id: number }[]).map((r) => r.id);
    // The clinic's actual case: signed by hand, awaiting a countersignature that
    // may never arrive, because /verify refuses signer == verifier. Paper still
    // leaves; requiring an electronic countersignature here would make every
    // report in the building undeliverable.
    expect(ids, "a hand-signed report is listable at the counter").toContain(reportIds.pensigned);
    expect(ids, "a countersigned report is listable").toContain(reportIds.countersigned);
    expect(ids, "an unsigned draft is never listable").not.toContain(reportIds.draft);
    expect(ids, "a report with no signature evidence is never listable").not.toContain(reportIds.unsigned);
  });

  it("never lets report content cross the counter", async () => {
    const res = await request(app)
      .get(`/api/resolve-barcode/patient/${patientId}/reports`)
      .set("Authorization", `Bearer ${deliveryToken}`);
    expect(res.status).toBe(200);

    // Structural, not field-by-field: the handler now selects columns explicitly,
    // so a column added to patient_reports tomorrow is not exposed by default. The
    // sentinels are what catch that, without naming every private field.
    const blob = JSON.stringify(res.body);
    expect(blob, "report body text must not cross the counter").not.toContain(BODY_TEXT);
    expect(blob, "impression text must not cross the counter").not.toContain(IMPRESSION_TEXT);
    expect(blob, "parameter values must not cross the counter").not.toContain(PARAMETER_TEXT);
    for (const row of res.body.reports as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty("body");
      expect(row).not.toHaveProperty("impression");
      expect(row).not.toHaveProperty("parameters");
      expect(row).not.toHaveProperty("structuredJson");
    }
  });

  it("refuses the retired one-click handover, and does not move the report's status", async () => {
    const [before] = await db
      .select({ status: patientReportsTable.status, deliveredAt: patientReportsTable.deliveredAt })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, reportIds.pensigned));

    const res = await request(app)
      .post(`/api/resolve-barcode/reports/${reportIds.pensigned}/deliver`)
      .set("Authorization", `Bearer ${deliveryToken}`)
      .send({});
    // Gone, for a granted session too: this used to answer 400 from its own mismatch
    // protection while still being the route that set `status = 'delivered'` — the
    // value the report_delivered commission policy pays on. 410 with a named code and
    // the counter's location is what makes a bookmarked caller say why it failed.
    expect(res.status, res.text).toBe(410);
    expect(res.body.error).toBe("ONE_CLICK_DELIVERY_RETIRED");
    expect(res.body.message, "the refusal must name where the work happens now").toMatch(/Scan Station/);

    const [after] = await db
      .select({ status: patientReportsTable.status, deliveredAt: patientReportsTable.deliveredAt })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, reportIds.pensigned));
    // The point of the retirement is not the status code. A retired route that still
    // wrote `delivered` would be a second, unattributed handover with a nicer name.
    expect(after.status).toBe(before.status);
    expect(after.deliveredAt).toEqual(before.deliveredAt);
  });

  it("requires authentication at all", async () => {
    const res = await request(app).get(`/api/resolve-barcode/${encodeURIComponent(`VITEST-${marker}`)}`);
    expect(res.status).toBe(401);
  });
});

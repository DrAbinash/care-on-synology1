/**
 * Receiving signed paper at the counter — request level.
 *
 * This is the accountability feature, so these tests ask what an audit would ask
 * and a unit test cannot answer: does a scan write to the ledger (it must not),
 * does one confirmation write exactly one event per report, whose name ends up in
 * `actor_name` when the body tried to say somebody else, and does a refused item
 * stop the item beside it.
 *
 * All of it runs the production router over supertest against PostgreSQL, because
 * the guarantee that actually matters — one open counter receipt per report
 * revision — is the partial unique index `rce_open_receipt_uq`, and no mock
 * enforces a database constraint.
 *
 * Every test receipts its OWN report. Sharing one fixture across them would make
 * the assertions order-dependent, and an order-dependent test passes by accident
 * the first time the list is reordered.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { and, eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable, ordersTable, patientReportAmendmentsTable, patientReportsTable,
  patientsTable, portalSessionsTable, reportCustodyEventsTable, scanAuditLogsTable,
  testsTable, usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const uid = randomUUID();
const marker = `RCV${uid.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
// Digits only, so a generated report number still matches the counter's parser.
const numericMarker = uid.replace(/\D/g, "").slice(0, 8);
const BODY_TEXT = `CUSTODY-BODY-${marker}`;

let reportSeq = 0;

describe.skipIf(!dbReady)("report custody receive — request level", () => {
  let app: Express;
  let patientId = 0;
  let testId = 0;
  let billId = 0;
  let clerkToken = "";
  let labToken = "";

  async function makeStaff(name: string, permissions: string[], role = "receptionist"): Promise<string> {
    const token = `vitest-cust-${randomUUID()}`;
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

  /** A report in a chosen state, and the number a clerk would scan for it. */
  async function makeReport(key: string, opts: { status: string; signed: boolean; bill?: boolean }) {
    reportSeq += 1;
    const reportNumber = `RPT-20261025-${numericMarker}${String(reportSeq).padStart(2, "0")}`;
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber,
        type: "radiology",
        patientId,
        testId,
        billId: opts.bill === false ? null : billId,
        title: `Custody probe ${key}`,
        status: opts.status,
        body: BODY_TEXT,
        signedAt: opts.signed ? new Date() : null,
        signatureId: opts.signed ? 1 : null,
        signedByName: opts.signed ? "Dr Sugandha" : null,
      })
      .returning({ id: patientReportsTable.id });
    return { id: row.id, code: reportNumber };
  }

  const scan = (token: string, code: string) =>
    request(app).post("/api/report-custody/scan").set("Authorization", `Bearer ${token}`).send({ code });

  const receive = (token: string, body: Record<string, unknown>) =>
    request(app).post("/api/report-custody/receive").set("Authorization", `Bearer ${token}`).send(body);

  const custodyRows = (reportId: number) =>
    db.select().from(reportCustodyEventsTable).where(eq(reportCustodyEventsTable.reportId, reportId));

  const physicalStateOf = async (reportId: number) => {
    const [r] = await db
      .select({ physicalState: patientReportsTable.physicalState })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, reportId));
    return r?.physicalState ?? null;
  };

  beforeAll(async () => {
    app = await createTestApp();

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `P-${marker}`,
        firstName: `Custody${marker}`,
        lastName: "Probe",
        dateOfBirth: "1975-03-03",
        gender: "F",
        phone: "9111111111",
      })
      .returning({ id: patientsTable.id });
    patientId = patient.id;

    const [test] = await db
      .insert(testsTable)
      .values({
        code: `CT-${marker}`,
        name: `CT Head ${marker}`,
        category: "CT",
        duration: "20",
        price: "2500.00",
        department: "CT",
      })
      .returning({ id: testsTable.id });
    testId = test.id;

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `O-${marker}`, patientId })
      .returning({ id: ordersTable.id });

    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `202610${numericMarker}`,
        orderId: order.id,
        patientId,
        subtotal: "2500.00",
        totalAmount: "2500.00",
        paidAmount: "1500.00",
        balanceAmount: "1000.00",
        status: "partial",
      })
      .returning({ id: billsTable.id });
    billId = bill.id;

    [clerkToken, labToken] = await Promise.all([
      makeStaff(`Counter Clerk ${marker}`, ["/report-delivery:receive"]),
      makeStaff(`Lab ${marker}`, ["/samples"]),
    ]);
  });

  afterAll(async () => {
    // Ledger before report: an event that outlives its report is a row nobody can
    // explain, and the tables hold no FK between them.
    await db
      .delete(reportCustodyEventsTable)
      .where(like(reportCustodyEventsTable.reportNumber, `RPT-20261025-${numericMarker}%`))
      .catch(() => {});
    await db.delete(scanAuditLogsTable).where(like(scanAuditLogsTable.username, `%${marker}%`)).catch(() => {});
    await db
      .delete(patientReportAmendmentsTable)
      .where(like(patientReportAmendmentsTable.originalDocumentId, `DOC-${marker}%`))
      .catch(() => {});
    await db.delete(patientReportsTable).where(eq(patientReportsTable.patientId, patientId)).catch(() => {});
    await db.delete(billsTable).where(eq(billsTable.id, billId)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.patientId, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(portalSessionsTable).where(like(portalSessionsTable.token, "vitest-cust-%")).catch(() => {});
    await db.delete(usersTable).where(like(usersTable.name, `%${marker}%`)).catch(() => {});
  });

  it("refuses a staff account with no delivery permission, on both endpoints", async () => {
    expect((await scan(labToken, "RPT-20261025-000000001")).status).toBe(403);
    expect((await receive(labToken, { items: [{ reportId: 1 }] })).status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/report-custody/scan").send({ code: "RPT-20261025-1" });
    expect(res.status).toBe(401);
  });

  it("scans without recording a custody event — only the confirmation records", async () => {
    const r = await makeReport("scanOnly", { status: "pending_verification", signed: true });
    const res = await scan(clerkToken, r.code);
    expect(res.status, res.text).toBe(200);
    expect(res.body.outcome).toBe("report");
    expect(res.body.candidate.verdict).toBe("RECEIVED");
    expect(res.body.candidate.patientLabel).toContain(`Custody${marker}`);

    expect(await custodyRows(r.id), "a scan must not create an event").toHaveLength(0);
    expect(await physicalStateOf(r.id), "a scan must not move the report").toBeNull();

    // The attempt is still worth keeping — in the attempt table, never the ledger.
    const attempts = await db
      .select({ status: scanAuditLogsTable.status, page: scanAuditLogsTable.page, method: scanAuditLogsTable.method })
      .from(scanAuditLogsTable)
      .where(and(eq(scanAuditLogsTable.linkedReportId, r.id), like(scanAuditLogsTable.page, "report-delivery%")));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.method).toBe("counter_scanner");
  });

  it("refuses an unsigned report, without writing", async () => {
    const r = await makeReport("unsigned", { status: "draft", signed: false });
    const res = await scan(clerkToken, r.code);
    expect(res.body.candidate.verdict).toBe("NOT_SIGNED");
    expect(res.body.candidate.message).toMatch(/no signature recorded/i);
    expect(await custodyRows(r.id)).toHaveLength(0);
  });

  it("refuses a superseded revision and says which version the paper is", async () => {
    const root = await makeReport("supRoot", { status: "pending_verification", signed: true });
    const newer = await makeReport("supNew", { status: "verified", signed: true });
    await db.insert(patientReportAmendmentsTable).values({
      originalReportId: root.id,
      amendedReportId: newer.id,
      rootReportId: root.id,
      originalDocumentId: `DOC-${marker}-A`,
      amendedDocumentId: `DOC-${marker}-B`,
      sequenceNumber: 1,
      reason: "Measurement added",
      amendedByName: "Dr Sugandha",
    });

    const res = await scan(clerkToken, root.code);
    expect(res.body.candidate.verdict).toBe("SUPERSEDED_REVISION");
    expect(res.body.candidate.revision).toBe(1);
    expect(res.body.candidate.totalVersions).toBe(2);
    expect(await custodyRows(root.id)).toHaveLength(0);
  });

  it("rejects a code that names neither a report nor a bill", async () => {
    // A patient code resolves fine on `/api/resolve-barcode`; here it would have
    // pulled up the patient's entire report history to be acknowledged in a batch.
    const res = await scan(clerkToken, `P-${marker}`);
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("NOT_A_REPORT_CODE");
  });

  it("records one event per confirmed report, attributed to the session not the body", async () => {
    const r = await makeReport("confirm", { status: "pending_verification", signed: true });
    const res = await receive(clerkToken, {
      requestId: randomUUID(),
      items: [{ reportId: r.id, scannedCode: r.code }],
      // Attacker-supplied attribution. All three must be ignored.
      actorName: "Somebody Else",
      actorUserId: 999999,
      deliveredBy: "cashier",
    });

    expect(res.status, res.text).toBe(200);
    expect(res.body.received).toBe(1);

    const rows = await custodyRows(r.id);
    expect(rows).toHaveLength(1);
    const event = rows[0]!;
    expect(event.event).toBe("RECEIVED_AT_DELIVERY_COUNTER");
    expect(event.outcome).toBe("completed");
    expect(event.actorName).toBe(`Counter Clerk ${marker}`);
    expect(event.actorRole).toBe("receptionist");
    expect(event.sessionId).toBeGreaterThan(0);
    expect(event.scannedCode).toBe(r.code);
    expect(event.validUntil).toBeNull();
    expect(event.reportRevision).toBe(1);

    // Money measured from the bill, never invented.
    expect(event.paymentSnapshot).toMatchObject({ status: "measured", balance: "1000.00", total: "2500.00" });
    expect(event.verification).toMatchObject({ rule: "signed_or_countersigned", revision: 1, clinicalTextStored: false });
    expect(JSON.stringify(event.verification)).not.toContain(BODY_TEXT);
    expect(JSON.stringify(event.paymentSnapshot)).not.toContain(BODY_TEXT);
    expect(await physicalStateOf(r.id)).toBe("AT_COUNTER");
  });

  it("reports per item, so one refused report does not void the batch", async () => {
    const good = await makeReport("perItemGood", { status: "pending_verification", signed: true });
    const bad = await makeReport("perItemBad", { status: "draft", signed: false });
    const res = await receive(clerkToken, {
      requestId: randomUUID(),
      items: [
        { reportId: bad.id, scannedCode: bad.code },
        { reportId: good.id, scannedCode: good.code },
      ],
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.received).toBe(1);
    expect(res.body.refused).toBe(1);
    expect(res.body.results[0]).toMatchObject({ ok: false, reason: "NOT_SIGNED" });
    expect(res.body.results[1]).toMatchObject({ ok: true });
    expect(await custodyRows(good.id)).toHaveLength(1);
    expect(await custodyRows(bad.id)).toHaveLength(0);
  });

  it("refuses a second receipt of the same report, by the database not the UI", async () => {
    const r = await makeReport("twice", { status: "pending_verification", signed: true });
    const first = await receive(clerkToken, { requestId: randomUUID(), items: [{ reportId: r.id, scannedCode: r.code }] });
    expect(first.body.received).toBe(1);

    const second = await receive(clerkToken, { requestId: randomUUID(), items: [{ reportId: r.id, scannedCode: r.code }] });
    expect(second.body.received).toBe(0);
    expect(second.body.results[0].reason).toBe("ALREADY_AT_COUNTER");
    // Who already did it, from the ledger — the clerk's actual question.
    expect(second.body.results[0].candidate.alreadyReceived).toMatchObject({ actorName: `Counter Clerk ${marker}` });
    expect(await custodyRows(r.id)).toHaveLength(1);
  });

  it("returns the original event when the same confirmation is sent again", async () => {
    const r = await makeReport("retry", { status: "pending_verification", signed: true });
    const requestId = randomUUID();
    const items = [{ reportId: r.id, scannedCode: r.code }];
    const first = await receive(clerkToken, { requestId, items });
    expect(first.body.received).toBe(1);
    const eventId = first.body.results[0].eventId;

    // The report is now AT_COUNTER, so a *new* click would be refused as a
    // duplicate. A REPEAT of the same click is the same act: it must come back as
    // the event it already created — not a second row, and not the wrong story
    // about another clerk.
    const second = await receive(clerkToken, { requestId, items });
    expect(second.status, second.text).toBe(200);
    expect(second.body.received).toBe(1);
    expect(second.body.results[0].eventId).toBe(eventId);
    expect(await custodyRows(r.id), "a retried click must not create a second event").toHaveLength(1);
  });

  it("enforces the 100-report cap server-side and records nothing when it does", async () => {
    const r = await makeReport("cap", { status: "pending_verification", signed: true });
    const items = Array.from({ length: 101 }, () => ({ reportId: r.id, scannedCode: r.code }));
    const res = await receive(clerkToken, { requestId: randomUUID(), items });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100/);
    expect(await custodyRows(r.id), "an oversized batch must be all-or-nothing at the gate").toHaveLength(0);
  });

  it("refuses an empty or malformed batch", async () => {
    const empty = await receive(clerkToken, { requestId: randomUUID(), items: [] });
    expect(empty.status).toBe(400);
    const junk = await receive(clerkToken, { requestId: randomUUID(), items: [{ scannedCode: "no id" }] });
    expect(junk.status).toBe(400);
  });

  it("pulls every report of a scanned bill into the review list, each judged separately", async () => {
    const a = await makeReport("billA", { status: "pending_verification", signed: true });
    const b = await makeReport("billB", { status: "draft", signed: false });
    void b;
    // The QR URL is exactly what the printed slip carries.
    const res = await scan(clerkToken, `http://localhost/api/verify/bill/202610${numericMarker}?hash=deadbeef`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.outcome).toBe("bill");
    // The bill scan answers with EXAMINATIONS, each carrying its report. Listing
    // report rows alone is what made a Word bill look empty, and an empty list at a
    // physical counter reads as "this desk is not for your work".
    expect(res.body.patient.name).toContain(`Custody${marker}`);
    const verdicts = res.body.examinations.map(
      (e: { candidate: { reportId: number; verdict: string } }) => [e.candidate.reportId, e.candidate.verdict],
    );
    expect(verdicts.find((v: [number, string]) => v[0] === a.id)?.[1]).toBe("RECEIVED");
    expect(verdicts.find((v: [number, string]) => v[0] === b.id)?.[1]).toBe("NOT_SIGNED");
    expect(await custodyRows(a.id), "a bill scan alone must not receive anything").toHaveLength(0);
  });

  it("never lets report content into a custody response", async () => {
    const r = await makeReport("phi", { status: "pending_verification", signed: true });
    const s = await scan(clerkToken, r.code);
    expect(JSON.stringify(s.body)).not.toContain(BODY_TEXT);
    const c = await receive(clerkToken, { requestId: randomUUID(), items: [{ reportId: r.id, scannedCode: r.code }] });
    expect(JSON.stringify(c.body)).not.toContain(BODY_TEXT);
    const rows = await custodyRows(r.id);
    expect(JSON.stringify(rows)).not.toContain(BODY_TEXT);
  });
});

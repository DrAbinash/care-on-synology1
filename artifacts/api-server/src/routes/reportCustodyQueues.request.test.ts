/**
 * The delivery dashboard — request level.
 *
 * PR-5 adds one read and one configuration field. A read can still lie, and a
 * default nobody chose can still print a number, so these tests run the owner's
 * own seven checks against the production router over supertest and PostgreSQL
 * rather than reasoning about the SQL:
 *
 *   (a) bill QR → receive two of three reports
 *   (b) bill QR → deliver one of the two received
 *   (c) reload → the custody states are still the same
 *   (d) different authorized staff receive and deliver
 *   (e) unauthorized staff can do neither
 *   (f) historical reports do not appear as overdue
 *   (g) laboratory scanning is untouched
 *
 * plus the two things only a dashboard can get wrong: a queue that reads a
 * number for a fact it cannot see ("not measured" is the required answer), and a
 * queue that shows clinical text it was never entitled to.
 *
 * Every queue read is filtered by this run's own marker. The queues are GLOBAL
 * — that is the point of them — so an absolute count would belong to whichever
 * other fixture happened to run first, and a test that asserts on a shared
 * number passes or fails by scheduling.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable, clinicSettingsTable, orderTestsTable, ordersTable, patientReportAmendmentsTable,
  patientReportsTable, patientsTable, portalSessionsTable, reportCustodyEventsTable,
  samplesTable, scanAuditLogsTable, testsTable, usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { findBillByNumber } from "../lib/billByNumber";

const dbReady = hasDatabaseUrl();
const uid = randomUUID();
const marker = `QUE${uid.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
const digits = uid.replace(/\D/g, "");
const BODY_TEXT = `QUEUE-BODY-${marker}`;
const IMPRESSION_TEXT = `QUEUE-IMPRESSION-${marker}`;

/** The 16 fields a counter entry is allowed to carry, in the order the type
 *  declares them. Sorted, because the assertion is about the SET: a new column
 *  on this response is either a deliberate decision or a leak, and a test that
 *  reads the exact key list is the only way to tell them apart. */
const ENTRY_KEYS = [
  "billNumber", "deliveredAt", "deliveredByName", "examination", "issue", "issueDetail", "key",
  "overrideReason", "patientCode", "patientName", "receivedAt", "receivedByName", "recipientCategory",
  "recipientName", "reportNumber", "state",
].sort();

let seq = 0;

describe.skipIf(!dbReady)("report custody queues — request level", () => {
  let app: Express;
  let testA = 0;
  let testB = 0;
  let testC = 0;
  let patientA = 0;
  let patientB = 0;
  /** Set in beforeAll so Awaiting Receipt is measurable for the whole file; the
   *  one test that reads the unconfigured state restores and re-applies it. */
  const goLive = new Date(Date.now() - 5 * 60_000);

  const createdBillIds: number[] = [];
  const createdOrderIds: number[] = [];
  const createdExamIds: number[] = [];
  const createdPatientIds: number[] = [];
  const createdTestIds: number[] = [];
  const createdReportIds: number[] = [];
  const createdSampleIds: number[] = [];
  const createdUserIds: number[] = [];
  const createdEventIds: number[] = [];

  async function makeStaff(name: string, permissions: string[], role = "receptionist"): Promise<string> {
    const token = `vitest-q-${randomUUID()}`;
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
    createdUserIds.push(user.id);
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    return token;
  }

  /** A printed bill number: 10 digits, because a longer string is not a bill and
   *  the counter would refuse it — measuring the parser is not measuring the desk. */
  async function freeBillNumber(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = `2026${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
      if ((await findBillByNumber(candidate)).status === "not_found") return candidate;
    }
    throw new Error("could not find an unused bill number");
  }

  async function makePatient(first: string) {
    const [p] = await db
      .insert(patientsTable)
      .values({
        patientId: `P-${first}-${marker}`,
        firstName: first,
        lastName: `Probe${marker}`,
        dateOfBirth: "1970-01-01",
        gender: "M",
        phone: `9${(Math.abs(Number(digits.slice(0, 9))) % 1_000_000_000)}`.slice(0, 10),
      })
      .returning({ id: patientsTable.id });
    createdPatientIds.push(p.id);
    return p.id;
  }

  async function makeTest(name: string) {
    const [t] = await db
      .insert(testsTable)
      .values({
        code: `Q-${name}-${marker}`, name: `${name} ${marker}`, category: "MRI",
        duration: "30", price: "4000.00", department: "MRI",
      })
      .returning({ id: testsTable.id });
    createdTestIds.push(t.id);
    return t.id;
  }

  /** A settled bill with one line per test id. Every test makes its own bill: the
   *  queues answer differently once paper has moved, and that is the behaviour
   *  under test, not noise to be shared. */
  async function makeBill(
    patientId: number,
    testIds: number[],
  ): Promise<{ id: number; number: string; orderId: number; examIds: number[] }> {
    seq += 1;
    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `O-${marker}-${seq}`, patientId })
      .returning({ id: ordersTable.id });
    createdOrderIds.push(order.id);
    const billNumber = await freeBillNumber();
    const total = (testIds.length * 4000).toFixed(2);
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber,
        orderId: order.id,
        patientId,
        subtotal: total,
        totalAmount: total,
        paidAmount: total,
        balanceAmount: "0.00",
        status: "paid",
      })
      .returning({ id: billsTable.id });
    createdBillIds.push(bill.id);
    const examIds: number[] = [];
    for (const t of testIds) {
      const [exam] = await db
        .insert(orderTestsTable)
        .values({ orderId: order.id, testId: t, price: "4000.00" })
        .returning({ id: orderTestsTable.id });
      createdExamIds.push(exam.id);
      examIds.push(exam.id);
    }
    return { id: bill.id, number: billNumber, orderId: order.id, examIds };
  }

  /** A signed CARE report for one examination. `signedAt` is the release moment,
   *  which is what the go-live cutoff compares against — NOT `createdAt`, so a
   *  2019 report restored from backup in 2026 keeps its 2019 release date. */
  async function makeReportRow(args: {
    orderTestId: number; testId: number; billId: number; patientId: number;
    signedAt?: Date | null; signatureId?: number | null; status?: string;
  }) {
    seq += 1;
    const reportNumber = `RPT-20261026-${digits.slice(0, 8)}${String(seq).padStart(2, "0")}`;
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber,
        type: "radiology",
        patientId: args.patientId,
        testId: args.testId,
        orderTestId: args.orderTestId,
        billId: args.billId,
        title: `Queue probe row ${seq}`,
        status: args.status ?? "pending_verification",
        body: BODY_TEXT,
        impression: IMPRESSION_TEXT,
        signedAt: args.signedAt === undefined ? new Date() : args.signedAt,
        signatureId: args.signatureId === undefined ? 1 : args.signatureId,
        signedByName: "Dr Sugandha",
      })
      .returning({ id: patientReportsTable.id });
    createdReportIds.push(row.id);
    return { id: row.id, code: reportNumber };
  }

  const queues = (token: string, qs = "") =>
    request(app).get(`/api/report-custody/queues${qs}`).set("Authorization", `Bearer ${token}`);

  const receive = (token: string, body: Record<string, unknown>) =>
    request(app).post("/api/report-custody/receive").set("Authorization", `Bearer ${token}`).send(body);

  const handover = (token: string, body: Record<string, unknown>) =>
    request(app).post("/api/report-custody/handover").set("Authorization", `Bearer ${token}`).send(body);

  type Entry = Record<string, unknown>;

  const allRows = (body: any): Entry[] => {
    const q = body?.queues ?? {};
    return [q.awaitingReceipt, q.atCounter, q.handedOver, q.discrepancies]
      .flatMap((one: any) => (one?.rows ?? []) as Entry[]);
  };
  /** Only this run's rows — the queues are global by design. */
  const mine = (body: any) =>
    allRows(body).filter((e) => String(e.patientName ?? "").includes(`Probe${marker}`));

  const findEntry = (body: any, reportNumber: string) =>
    mine(body).find((e) => e.reportNumber === reportNumber) ?? null;

  async function setGoLive(value: Date | null) {
    const [row] = await db.select({ id: clinicSettingsTable.id }).from(clinicSettingsTable).limit(1);
    if (row) {
      await db
        .update(clinicSettingsTable)
        .set({ reportDeliveryGoLiveAt: value })
        .where(eq(clinicSettingsTable.id, row.id));
      return;
    }
    await db.insert(clinicSettingsTable).values({ reportDeliveryGoLiveAt: value });
  }

  /** A raw ledger row, for the discrepancy rules the API cannot be asked to
   *  create (nothing writes them yet) but must still detect. */
  async function insertEvent(values: Record<string, unknown>) {
    const [row] = await db
      .insert(reportCustodyEventsTable)
      .values({
        event: "PHYSICALLY_HANDED_OVER",
        patientId: patientA,
        actorUserId: 1,
        actorName: `Injected ${marker}`,
        actorRole: "receptionist",
        sessionId: 1,
        verification: { injectedBy: "vitest" },
        paymentSnapshot: { status: "no_bill_linked" },
        idempotencyKey: `vitest-q-${randomUUID()}`,
        ...values,
      })
      .returning({ id: reportCustodyEventsTable.id });
    createdEventIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await setGoLive(goLive);

    testA = await makeTest("MRI Brain");
    testB = await makeTest("CT Chest");
    testC = await makeTest("Xray LS Spine");

    patientA = await makePatient(`Queue${marker}`);
    patientB = await makePatient(`QueueTwo${marker}`);
  });

  afterAll(async () => {
    // The settings row is a singleton shared with every other suite, so leaving
    // our cutoff in place would be a side effect on somebody else's run.
    await setGoLive(null).catch(() => {});
    // Teardown deletes by the ids this run made. A pattern match on a name would
    // also delete a real clinic row that happens to carry the same text.
    const clear = async (table: any, column: any, ids: number[]) => {
      if (ids.length === 0) return;
      await db.delete(table).where(inArray(column, ids)).catch(() => {});
    };
    await clear(reportCustodyEventsTable, reportCustodyEventsTable.id, createdEventIds);
    await clear(samplesTable, samplesTable.id, createdSampleIds);
    await clear(patientReportsTable, patientReportsTable.id, createdReportIds);
    await clear(orderTestsTable, orderTestsTable.id, createdExamIds);
    await clear(billsTable, billsTable.id, createdBillIds);
    await clear(ordersTable, ordersTable.id, createdOrderIds);
    await clear(patientsTable, patientsTable.id, createdPatientIds);
    await clear(testsTable, testsTable.id, createdTestIds);
    await clear(usersTable, usersTable.id, createdUserIds);
    await db
      .delete(reportCustodyEventsTable)
      .where(like(reportCustodyEventsTable.actorName, `%${marker}%`))
      .catch(() => {});
    await db
      .delete(patientReportAmendmentsTable)
      .where(like(patientReportAmendmentsTable.originalDocumentId, `DOC-${marker}%`))
      .catch(() => {});
    await db.delete(scanAuditLogsTable).where(like(scanAuditLogsTable.username, `%${marker}%`)).catch(() => {});
    await db.delete(portalSessionsTable).where(like(portalSessionsTable.token, "vitest-q-%")).catch(() => {});
  });

  it("refuses an account with no Report Delivery tick at all", async () => {
    const labOnly = await makeStaff(`Lab Only ${marker}`, ["/samples"]);
    const res = await queues(labOnly);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/view/i);
  });

  it("refuses a clerk who can receive paper but is not allowed to read the queue", async () => {
    const receiver = await makeStaff(`Receive Only ${marker}`, ["/report-delivery:receive"]);
    const res = await queues(receiver);
    expect(res.status, "the queue is a separate entitlement from the counter action").toBe(403);
  });

  it("answers nothing without authentication", async () => {
    const res = await request(app).get("/api/report-custody/queues");
    expect(res.status).toBe(401);
  });

  it("carries only the fields a counter is entitled to, and no clinical text", async () => {
    const viewer = await makeStaff(`Viewer ${marker}`, ["/report-delivery:view"]);
    const res = await queues(viewer);
    expect(res.status, res.text).toBe(200);

    // Every queue the brief names, and nothing else.
    expect(Object.keys(res.body.queues).sort()).toEqual([
      "atCounter", "awaitingReceipt", "discrepancies", "handedOver",
    ]);

    const bill = await makeBill(patientA, [testA]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientA });
    await receive(viewer, { requestId: randomUUID(), items: [{ reportId: r.id, scannedCode: r.code }] });

    const again = await queues(viewer);
    const entry = findEntry(again.body, r.code);
    expect(entry, "the report just received must be on the queue").not.toBeNull();
    expect(Object.keys(entry as Record<string, unknown>).sort()).toEqual(ENTRY_KEYS);
    expect(JSON.stringify(again.body), "a delivery queue is not a place to read a report")
      .not.toContain(BODY_TEXT);
    expect(JSON.stringify(again.body)).not.toContain(IMPRESSION_TEXT);
  });

  it("receives two of three on one bill QR, delivers one, and still reads the same after a reload", async () => {
    const viewer = await makeStaff(`Seq Viewer ${marker}`, [
      "/report-delivery:view", "/report-delivery:receive", "/report-delivery:handover",
    ]);

    const bill = await makeBill(patientA, [testA, testB, testC]);
    const rows: { id: number; code: string }[] = [];
    for (const [i, examId] of bill.examIds.entries()) {
      rows.push(await makeReportRow({ orderTestId: examId, testId: [testA, testB, testC][i], billId: bill.id, patientId: patientA }));
    }

    // (a) two of the three, in one confirmation, on the bill the receipt printed.
    const rec = await receive(viewer, {
      requestId: randomUUID(),
      items: [rows[0], rows[1]].map((r) => ({ reportId: r.id, scannedCode: bill.number })),
    });
    expect(rec.status, rec.text).toBe(200);
    expect(rec.body.received, rec.text).toBe(2);

    let q = await queues(viewer);
    expect(q.status, q.text).toBe(200);
    const atCounter = q.body.queues.atCounter.rows.filter((e: any) => e.billNumber === bill.number);
    expect(atCounter, "the two received sheets sit at the counter").toHaveLength(2);
    expect(atCounter.every((e: any) => e.state === "AT_COUNTER")).toBe(true);
    expect(atCounter.every((e: any) => e.receivedByName?.includes(`Seq Viewer`))).toBe(true);
    expect(atCounter.every((e: any) => !!e.receivedAt)).toBe(true);
    // (f) in its other half: the third sheet is signed, unreceived, and on this side of the cutoff.
    expect(findEntry(q.body, rows[2].code)?.state).toBe("AWAITING_RECEIPT");
    // And the two that moved are in exactly one queue. A report sitting on the
    // counter must not also be volunteered as paper that has not arrived — the
    // dashboard's whole value is that a sheet has one place in it.
    for (const moved of [rows[0].code, rows[1].code]) {
      const inAwaiting = q.body.queues.awaitingReceipt.rows.filter((e: any) => e.reportNumber === moved);
      expect(inAwaiting, `${moved} was just received; it is not awaiting receipt`).toHaveLength(0);
    }

    // (b) one of the two handed over, with a named recipient.
    const hand = await handover(viewer, {
      requestId: randomUUID(),
      billCode: bill.number,
      recipientCategory: "FAMILY_MEMBER",
      recipientName: "son",
      items: [{ reportId: rows[0].id, scannedCode: bill.number }],
    });
    expect(hand.status, hand.text).toBe(200);
    expect(hand.body.handed, hand.text).toBe(1);

    // (c) "reload" — a second read, nothing cached, nothing client-side to remember.
    q = await queues(viewer);
    const afterAt = q.body.queues.atCounter.rows.filter((e: any) => e.billNumber === bill.number);
    expect(afterAt, "the delivered sheet left the counter queue").toHaveLength(1);
    expect(afterAt[0].reportNumber).not.toBe(rows[0].code);

    const delivered = mine(q.body).find((e: any) => e.reportNumber === rows[0].code);
    expect(delivered, "the delivered sheet is in the handed-over queue").toBeDefined();
    expect(delivered?.state).toBe("HANDED_OVER");
    expect(delivered?.deliveredByName).toContain("Seq Viewer");
    expect(!!delivered?.deliveredAt).toBe(true);
    expect(delivered?.recipientCategory).toBe("FAMILY_MEMBER");
    expect(delivered?.recipientName).toBe("son");
    // Bill number and patient ride on every entry, as the brief requires.
    expect(delivered?.billNumber).toBe(bill.number);
    expect(delivered?.patientName).toContain(`Probe${marker}`);
    expect(String(delivered?.examination)).toContain(marker);

    // The money semantics this stack must never touch.
    const [row] = await db
      .select({ status: patientReportsTable.status, deliveredAt: patientReportsTable.deliveredAt })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, rows[0].id));
    expect(row.status, "a handover must not release a commission").toBe("pending_verification");
    expect(row.deliveredAt, "a handover must not mark the report delivered").toBeNull();
  });

  it("names the clerk who received and the different clerk who handed over", async () => {
    const receiver = await makeStaff(`Receiver Two ${marker}`, ["/report-delivery:receive"]);
    const deliverer = await makeStaff(`Deliverer Two ${marker}`, [
      "/report-delivery:handover", "/report-delivery:view",
    ]);

    const bill = await makeBill(patientB, [testA]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientB });

    expect((await receive(receiver, {
      requestId: randomUUID(),
      items: [{ reportId: r.id, scannedCode: bill.number }],
    })).body.received).toBe(1);

    // (e) the account with neither tick cannot do either operation.
    const nobody = await makeStaff(`No Ticks ${marker}`, ["/patients"]);
    expect((await receive(nobody, { requestId: randomUUID(), items: [{ reportId: r.id }] })).status).toBe(403);
    expect((await handover(nobody, {
      billCode: bill.number, recipientCategory: "PATIENT", items: [{ reportId: r.id }],
    })).status).toBe(403);
    expect((await queues(nobody)).status).toBe(403);

    const hand = await handover(deliverer, {
      requestId: randomUUID(),
      billCode: bill.number,
      recipientCategory: "PATIENT",
      items: [{ reportId: r.id, scannedCode: r.code }],
    });
    expect(hand.status, hand.text).toBe(200);
    expect(hand.body.handed, hand.text).toBe(1);

    const q = await queues(deliverer);
    const entry = mine(q.body).find((e: any) => e.reportNumber === r.code);
    expect(entry, "one entry, because one sheet of paper moved").toBeDefined();
    expect(entry?.receivedByName).toContain("Receiver Two");
    expect(entry?.deliveredByName).toContain("Deliverer Two");
    expect(entry?.recipientCategory).toBe("PATIENT");
  });

  it("lists a Word paper by its examination, with no report number to show", async () => {
    const viewer = await makeStaff(`Word Viewer ${marker}`, [
      "/report-delivery:view", "/report-delivery:receive",
    ]);
    const bill = await makeBill(patientB, [testB]);
    const res = await receive(viewer, {
      requestId: randomUUID(),
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number, paperSignedByName: "Dr Sugandha" }],
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.received, res.text).toBe(1);

    const q = await queues(viewer);
    const entry = q.body.queues.atCounter.rows.find((e: any) => e.billNumber === bill.number);
    expect(entry, "the counter holds the paper even though CARE has no report row").toBeDefined();
    expect(entry.reportNumber, "there is no report number on a Word printout").toBeNull();
    expect(String(entry.examination)).toContain(marker);
    expect(entry.receivedByName).toContain("Word Viewer");
  });

  it("does not list a report signed before the go-live cutoff as awaiting receipt", async () => {
    const viewer = await makeStaff(`Historian ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientA, [testA]);
    const old = await makeReportRow({
      orderTestId: bill.examIds[0],
      testId: testA,
      billId: bill.id,
      patientId: patientA,
      // A pen-signed report from years ago whose ROW was created now (a restored
      // volume, a back-import). Its release moment is still the signature.
      signedAt: new Date("2019-04-11T09:30:00Z"),
    });
    const fresh = await makeReportRow({
      orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientA,
    });

    const q = await queues(viewer);
    expect(q.body.goLive.configured).toBe(true);
    expect(q.body.queues.awaitingReceipt.status).toBe("measured");
    expect(findEntry(q.body, old.code), "historical paper must not open as overdue").toBeNull();
    expect(findEntry(q.body, fresh.code)?.state).toBe("AWAITING_RECEIPT");
  });

  it("reads not measured with no go-live date, rather than zero or the whole archive", async () => {
    const viewer = await makeStaff(`Unset Viewer ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientA, [testA]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientA });
    // On the queue while the cutoff is set.
    expect(findEntry((await queues(viewer)).body, r.code)).not.toBeNull();

    await setGoLive(null);
    try {
      const q = await queues(viewer);
      const awaiting = q.body.queues.awaitingReceipt;
      expect(q.body.goLive.configured).toBe(false);
      expect(awaiting.status, "no date is not the same as an empty queue").toBe("not_measured");
      expect(awaiting.rows).toHaveLength(0);
      expect(awaiting.reason).toMatch(/not measured/i);
      expect(awaiting.reason).toMatch(/Settings/i);
      // The three ledger queues are unaffected: the ledger holds nothing from
      // before go-live because nothing was ever backfilled into it.
      expect(q.body.queues.atCounter.status).toBe("measured");
    } finally {
      await setGoLive(goLive);
    }
    expect((await queues(viewer)).body.queues.awaitingReceipt.status).toBe("measured");
  });

  it("surfaces paper handed over without ever being received", async () => {
    const viewer = await makeStaff(`Auditor One ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientA, [testA]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientA });
    // A handover written straight to the ledger — the ordering break the API
    // refuses, which is exactly why the dashboard has to be able to see it.
    await insertEvent({
      reportId: r.id,
      reportNumber: r.code,
      billId: bill.id,
      orderTestId: bill.examIds[0],
      testName: `MRI Brain ${marker}`,
    });

    const q = await queues(viewer);
    const entry = q.body.queues.discrepancies.rows.find((e: any) => e.key === `discrepancy:unreceived:${createdEventIds[createdEventIds.length - 1]}`);
    expect(entry, "an unreceived handover must reach the discrepancy queue").toBeDefined();
    expect(entry.issue).toBe("HANDED_OVER_WITHOUT_RECEIPT");
    expect(entry.issueDetail).toMatch(/no receipt recorded/i);
  });

  it("surfaces counter paper for a report that has since been amended", async () => {
    const viewer = await makeStaff(`Auditor Two ${marker}`, ["/report-delivery:view", "/report-delivery:receive"]);
    const bill = await makeBill(patientB, [testA]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientB });
    expect((await receive(viewer, {
      requestId: randomUUID(), items: [{ reportId: r.id, scannedCode: bill.number }],
    })).body.received).toBe(1);

    // The amendment chain says this signed paper is no longer the current version.
    const later = await makeReportRow({ orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientB });
    await db.insert(patientReportAmendmentsTable).values({
      originalReportId: r.id,
      amendedReportId: later.id,
      rootReportId: r.id,
      originalDocumentId: `DOC-${marker}-${r.id}`,
      amendedDocumentId: `DOC-${marker}-${later.id}`,
      sequenceNumber: 1,
      reason: "vitest queue probe",
      amendedByName: "Vitest",
    });

    const q = await queues(viewer);
    const entry = q.body.queues.discrepancies.rows.find((e: any) => e.issue === "PAPER_SUPERSEDED_BY_AMENDMENT"
      && e.reportNumber === r.code);
    expect(entry, "the tray must not hold the superseded version silently").toBeDefined();
    expect(entry.issueDetail).toMatch(/amended/i);
    // And it is still where the ledger says it is.
    expect(entry.state).toBe("DISCREPANCY");
  });

  it("surfaces a physical state the ledger cannot back", async () => {
    const viewer = await makeStaff(`Auditor Three ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientA, [testC]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testC, billId: bill.id, patientId: patientA });
    // The projection claims the paper is at the counter, and no event says so.
    await db
      .update(patientReportsTable)
      .set({ physicalState: "AT_COUNTER", physicalStateAt: new Date() })
      .where(eq(patientReportsTable.id, r.id));

    const q = await queues(viewer);
    const entry = q.body.queues.discrepancies.rows.find((e: any) => e.issue === "PROJECTION_AHEAD_OF_LEDGER"
      && e.reportNumber === r.code);
    expect(entry, "a claimed state with no recorded act is a discrepancy").toBeDefined();
    expect(entry.issueDetail).toMatch(/AT_COUNTER/);
    expect(entry.receivedByName, "an act that was never recorded must not be shown as one").toBeNull();
  });

  it("caps what one page fetches and still counts the whole queue", async () => {
    const viewer = await makeStaff(`Paged ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientA, [testA, testB]);
    for (const [i, examId] of bill.examIds.entries()) {
      const r = await makeReportRow({ orderTestId: examId, testId: [testA, testB][i], billId: bill.id, patientId: patientA });
      await receive(viewer, { requestId: randomUUID(), items: [{ reportId: r.id, scannedCode: bill.number }] });
    }

    const q = await queues(viewer, "?limit=2");
    expect(q.status, q.text).toBe(200);
    const at = q.body.queues.atCounter;
    expect(at.rows.length, "the cap is honoured").toBeLessThanOrEqual(2);
    expect(at.truncated, "the flag means what the counts say it means").toBe(at.total > at.rows.length);
    expect(q.body.limit).toBe(2);
  });

  it("does not list a report that was never signed as waiting for paper", async () => {
    const viewer = await makeStaff(`Unsigned Viewer ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientB, [testA]);
    // Signed columns empty, status not countersigned: there is no sheet of paper
    // with a signature on it, so the counter must not be told to expect one.
    const unsigned = await makeReportRow({
      orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientB,
      signedAt: null, signatureId: null, status: "pending_verification",
    });
    const q = await queues(viewer);
    expect(findEntry(q.body, unsigned.code)).toBeNull();
  });

  it("ignores a receipt that a supervisor's correction has closed", async () => {
    const viewer = await makeStaff(`Closed Viewer ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientA, [testB]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testB, billId: bill.id, patientId: patientA });
    // `valid_until` set means this event is no longer the current state — that is
    // what lets a corrected report be received again. Counting a closed receipt
    // would park paper at a counter it is not sitting on.
    await insertEvent({
      event: "RECEIVED_AT_DELIVERY_COUNTER",
      reportId: r.id,
      reportNumber: r.code,
      billId: bill.id,
      orderTestId: bill.examIds[0],
      testName: `CT Chest ${marker}`,
      validUntil: new Date(),
    });

    const q = await queues(viewer);
    const at = q.body.queues.atCounter.rows.find((e: any) => e.reportNumber === r.code);
    expect(at, "a closed receipt is not paper sitting on the counter").toBeUndefined();
    expect(findEntry(q.body, r.code)?.state).toBe("AWAITING_RECEIPT");
    expect(q.body.queues.discrepancies.rows.find((e: any) => e.reportNumber === r.code), "a closed event is not a discrepancy either")
      .toBeUndefined();
  });

  it("keeps a handover older than the window off the handed-over queue, and off the counter", async () => {
    const viewer = await makeStaff(`Window Viewer ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientB, [testC]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testC, billId: bill.id, patientId: patientB });
    const longAgo = new Date(Date.now() - 30 * 86_400_000);
    await insertEvent({
      event: "RECEIVED_AT_DELIVERY_COUNTER", reportId: r.id, reportNumber: r.code,
      billId: bill.id, orderTestId: bill.examIds[0], testName: `Xray LS Spine ${marker}`,
      createdAt: longAgo, actorName: `Old Receiver ${marker}`,
    });
    await insertEvent({
      event: "PHYSICALLY_HANDED_OVER", reportId: r.id, reportNumber: r.code,
      billId: bill.id, orderTestId: bill.examIds[0], testName: `Xray LS Spine ${marker}`,
      createdAt: longAgo, recipientCategory: "PATIENT",
    });

    const q = await queues(viewer);
    const entries = mine(q.body).filter((e: any) => e.reportNumber === r.code);
    expect(entries, "the window is what keeps a terminal queue readable").toHaveLength(0);
    expect(q.body.handedOverDays).toBe(7);
    // Widening the window is an option, not a code change…
    const wide = await queues(viewer, "?handedOverDays=60");
    const found = wide.body.queues.handedOver.rows.find((e: any) => e.reportNumber === r.code);
    expect(found, "the same paper is visible when the operator asks for it").toBeDefined();
    expect(found.receivedByName).toContain("Old Receiver");
    // …and a hand-typed number cannot turn a dashboard poll into a full-ledger scan.
    const greedy = await queues(viewer, "?handedOverDays=5000&limit=5000");
    expect(greedy.body.handedOverDays).toBe(90);
    expect(greedy.body.limit).toBe(200);
  });

  it("surfaces a record whose state the ledger contradicts", async () => {
    const viewer = await makeStaff(`Drift Viewer ${marker}`, ["/report-delivery:view", "/report-delivery:receive"]);
    const bill = await makeBill(patientA, [testA]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testA, billId: bill.id, patientId: patientA });
    expect((await receive(viewer, {
      requestId: randomUUID(), items: [{ reportId: r.id, scannedCode: bill.number }],
    })).body.received).toBe(1);

    // The projection now claims something the open event does not: exactly the
    // drift that a failed projection write or a hand-edited row would leave.
    await db
      .update(patientReportsTable)
      .set({ physicalState: "HANDED_OVER", physicalStateAt: new Date() })
      .where(eq(patientReportsTable.id, r.id));

    const q = await queues(viewer);
    const entry = q.body.queues.discrepancies.rows.find((e: any) => e.issue === "PROJECTION_BEHIND_LEDGER"
      && e.reportNumber === r.code);
    expect(entry, "the dashboard must not accept the projection over the ledger").toBeDefined();
    expect(entry.issueDetail).toMatch(/HANDED_OVER/);
    expect(entry.issueDetail).toMatch(/AT_COUNTER/);
  });

  it("lists a discrepancy a supervisor recorded, when that path starts writing", async () => {
    const viewer = await makeStaff(`Supervisor Viewer ${marker}`, ["/report-delivery:view"]);
    const bill = await makeBill(patientB, [testB]);
    const r = await makeReportRow({ orderTestId: bill.examIds[0], testId: testB, billId: bill.id, patientId: patientB });
    // The vocabulary exists in the ledger's own CHECK and nothing writes it yet,
    // so the queue is tested against a row written the way the correction path
    // will write it.
    await insertEvent({
      event: "CUSTODY_DISCREPANCY_RECORDED",
      outcome: "discrepancy",
      reportId: r.id,
      reportNumber: r.code,
      billId: bill.id,
      orderTestId: bill.examIds[0],
      testName: `CT Chest ${marker}`,
      actorName: `Counter Supervisor ${marker}`,
      verification: { message: `The envelope was empty ${marker}` },
    });

    const q = await queues(viewer);
    const entry = q.body.queues.discrepancies.rows.find((e: any) => e.reportNumber === r.code);
    expect(entry, "a recorded discrepancy must reach the queue").toBeDefined();
    expect(entry.issue).toBe("RECORDED_BY_SUPERVISOR");
    expect(entry.issueDetail).toContain("The envelope was empty");
    expect(entry.state).toBe("DISCREPANCY");
    expect(q.body.queues.discrepancies.rows.filter((e: any) => e.reportNumber === r.code)).toHaveLength(1);
  });

  it("leaves laboratory scanning exactly as it was", async () => {
    const lab = await makeStaff(`Lab Scanner ${marker}`, ["/samples", "/scan-station"]);
    const bill = await makeBill(patientA, [testA]);
    const [sample] = await db
      .insert(samplesTable)
      .values({ barcode: `VITS-${marker}-${seq}`, orderId: bill.orderId, patientId: patientA, sampleType: "Blood" })
      .returning({ id: samplesTable.id });
    createdSampleIds.push(sample.id);

    const res = await request(app)
      .get(`/api/resolve-barcode/${encodeURIComponent(`VITS-${marker}-${seq}`)}`)
      .set("Authorization", `Bearer ${lab}`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.type).toBe("sample");
    expect(res.body.sample.barcode).toBe(`VITS-${marker}-${seq}`);

    // The dashboard read cannot make a scan mean anything: the sample is not
    // paper, and no custody row exists for it.
    const events = await db
      .select({ id: reportCustodyEventsTable.id })
      .from(reportCustodyEventsTable)
      .where(like(reportCustodyEventsTable.scannedCode, `VITS-${marker}%`));
    expect(events, "a laboratory scan writes no custody event").toHaveLength(0);
  });

  // ── The one configuration this dashboard needs ────────────────────────────
  // The cutoff is the only new writable field in PR-5, and it decides whether
  // thousands of historical reports read as a backlog, so its write path is
  // tested as part of the feature: the instant the administrator named must be
  // the instant stored, a clerk must not be able to set it, and a value that is
  // not a date must be refused rather than stored as NULL.

  const putSettings = (token: string, body: Record<string, unknown>) =>
    request(app).put("/api/clinic-settings").set("Authorization", `Bearer ${token}`).send(body);

  const storedGoLive = async () => {
    const [row] = await db
      .select({ at: clinicSettingsTable.reportDeliveryGoLiveAt })
      .from(clinicSettingsTable)
      .limit(1);
    return row?.at ?? null;
  };

  it("stores the go-live instant the administrator named, in their own clock", async () => {
    const admin = await makeStaff(`Settings Admin ${marker}`, [], "admin");
    const res = await putSettings(admin, { reportDeliveryGoLiveAt: "2026-11-01T09:30:00+05:30" });
    expect(res.status, res.text).toBe(200);

    // 09:30 IST is 04:00 UTC. Storing it as 09:30 UTC — which is what happens if
    // the offset is dropped and the API's own zone is assumed — would move the
    // clinic's go-live by five and a half hours, and every report signed in that
    // window would read wrong.
    const stored = await storedGoLive();
    expect(stored).toBeInstanceOf(Date);
    expect((stored as Date).toISOString()).toBe("2026-11-01T04:00:00.000Z");

    const viewer = await makeStaff(`Reflecting Viewer ${marker}`, ["/report-delivery:view"]);
    const q = await queues(viewer);
    expect(q.body.goLive.at).toBe("2026-11-01T04:00:00.000Z");
    expect(q.body.queues.awaitingReceipt.status).toBe("measured");

    await setGoLive(goLive);
  });

  it("clears the cutoff back to not measured", async () => {
    const admin = await makeStaff(`Clearing Admin ${marker}`, [], "admin");
    expect((await putSettings(admin, { reportDeliveryGoLiveAt: null })).status).toBe(200);
    expect(await storedGoLive()).toBeNull();

    const viewer = await makeStaff(`Cleared Viewer ${marker}`, ["/report-delivery:view"]);
    expect((await queues(viewer)).body.queues.awaitingReceipt.status).toBe("not_measured");

    await setGoLive(goLive);
  });

  it("refuses a value that is not a date, and keeps the one already stored", async () => {
    const admin = await makeStaff(`Bad Value Admin ${marker}`, [], "admin");
    const before = await storedGoLive();
    const res = await putSettings(admin, { reportDeliveryGoLiveAt: "the first of next month" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ISO date-time/);
    expect(await storedGoLive(), "a refused write must not clear the clinic's date").toEqual(before);
  });

  it("refuses a counter clerk who has no right to change clinic settings", async () => {
    const clerk = await makeStaff(`Counter Only ${marker}`, [
      "/report-delivery:view", "/report-delivery:receive", "/report-delivery:handover",
    ]);
    const res = await putSettings(clerk, { reportDeliveryGoLiveAt: "2027-01-01T00:00:00+05:30" });
    expect(res.status).toBe(403);
    const still = await storedGoLive();
    expect(still instanceof Date && still.toISOString()).toBe(goLive.toISOString());
  });
});

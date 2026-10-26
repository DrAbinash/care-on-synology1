/**
 * Barcode Resolver
 *
 * GET /api/resolve-barcode/:code
 *   Looks up a scanned barcode across samples, orders, bills, and reports.
 *   Returns the matching entity + patient + order context so the frontend
 *   can route to ReportGenerator, ScanStation, or ReportDelivery.
 *
 * GET /api/resolve-barcode/patient/:patientId/reports
 *   Lists the patient's signed reports for the delivery counter. Clinical text
 *   is deliberately absent (see the note on the handler): the counter needs to
 *   know which report a patient is collecting, never what it says.
 *
 * POST /api/resolve-barcode/reports/:id/deliver
 *   RETIRED (410). The one-click handover is replaced by the two named acts in
 *   Scan Station's Deliver mode — see the note on the route.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  samplesTable, ordersTable, orderTestsTable, testsTable,
  patientsTable, doctorsTable, patientReportsTable,
  radiologyStudiesTable,
  inventoryItemsTable, ledgersTable,
} from "@workspace/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { requireStaffAuth, requireStaffAnyModule } from "../middleware/requireStaffAuth";
import { findBillByNumber } from "../lib/billByNumber";
import { isReportClinicallyAuthorized } from "../lib/reportAuthorization";

const router: IRouter = Router();
router.use(requireStaffAuth);
// This used to be bare `requireStaffAuth`, so an account with an empty permission
// list — one the clinic has given no module at all — could enumerate a code and
// read a patient's identity back. See requireStaffAnyModule for why the gate is
// a floor rather than a named module list.
router.use(requireStaffAnyModule);

// ─── GET /api/resolve-barcode/:code ─────────────────────────────────────────
router.get("/:code", async (req, res) => {
  const code = (req.params.code ?? "").trim();
  if (!code) { res.status(400).json({ error: "Code is required" }); return; }

  // 0. Inventory item (INV-123 or custom barcode)
  const invMatch = /^INV-(\d+)$/i.exec(code);
  if (invMatch) {
    const [item] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, Number(invMatch[1]))).limit(1);
    if (item) {
      return res.json({
        type: "inventory",
        code,
        item: {
          id: item.id,
          name: item.name,
          unit: item.unit,
          category: item.category,
          currentStock: Number(item.currentStock),
          minStock: Number(item.minStock),
          barcode: item.barcode,
        },
      });
    }
  }
  const [invByBarcode] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.barcode, code)).limit(1);
  if (invByBarcode) {
    return res.json({
      type: "inventory",
      code,
      item: {
        id: invByBarcode.id,
        name: invByBarcode.name,
        unit: invByBarcode.unit,
        category: invByBarcode.category,
        currentStock: Number(invByBarcode.currentStock),
        minStock: Number(invByBarcode.minStock),
        barcode: invByBarcode.barcode,
      },
    });
  }

  // 1. Try sample barcode exact match (most common for scan station).
  const [sample] = await db.select().from(samplesTable).where(eq(samplesTable.barcode, code));
  if (sample) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, sample.patientId));
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, sample.orderId));
    let doctor = null;
    if (order?.doctorId) {
      const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId));
      doctor = d ?? null;
    }
    return res.json({
      type: "sample",
      code: sample.barcode,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      order: order ? { id: order.id, orderNumber: order.orderNumber, patientId: order.patientId, doctorId: order.doctorId, doctor: doctor ? { name: doctor.name, specialization: doctor.specialization } : null, createdAt: String(order.createdAt) } : null,
      sample: { id: sample.id, barcode: sample.barcode, status: sample.status, sampleType: sample.sampleType },
    });
  }

  // 2. Try order number.
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.orderNumber, code));
  if (order) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, order.patientId));
    let doctor = null;
    if (order.doctorId) {
      const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId));
      doctor = d ?? null;
    }
    const ots = await db.select({ ot: orderTestsTable, test: testsTable }).from(orderTestsTable).leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id)).where(eq(orderTestsTable.orderId, order.id));
    return res.json({
      type: "order",
      code: order.orderNumber,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      order: { id: order.id, orderNumber: order.orderNumber, patientId: order.patientId, doctorId: order.doctorId, doctor: doctor ? { name: doctor.name, specialization: doctor.specialization } : null, createdAt: String(order.createdAt) },
      tests: ots.map((r) => ({ id: r.test?.id ?? r.ot.id, name: r.test?.name ?? "Unknown", code: r.test?.code ?? "", price: Number(r.test?.price ?? r.ot.price), orderTestId: r.ot.id })),
    });
  }

  // 3. Try bill number (numeric format or legacy BILL- prefix, or exact match).
  //
  // Bill numbers are unique per BOOK, so the same printed number can exist in
  // two registers. Which patient a scan belongs to is not guessable, so a
  // collision is reported with its candidates instead of resolving one.
  const billHit = await findBillByNumber(code);
  if (billHit.status === "ambiguous") {
    const books = await db
      .select({ id: ledgersTable.id, name: ledgersTable.name })
      .from(ledgersTable)
      .where(inArray(ledgersTable.id, billHit.bills.map((b) => b.ledgerId)));
    const bookName = new Map(books.map((l) => [l.id, l.name]));
    res.status(409).json({
      error: `Bill number ${code} was issued by more than one book. Find the patient by name instead.`,
      candidates: billHit.bills.map((b) => ({
        billId: b.id,
        patientId: b.patientId,
        book: bookName.get(b.ledgerId) ?? `Book #${b.ledgerId}`,
      })),
    });
    return;
  }

  const bill = billHit.status === "found" ? billHit.bill : null;
  if (bill) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, bill.patientId));
    let doctor = null;
    const [billOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, bill.orderId));
    if (billOrder?.doctorId) {
      const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, billOrder.doctorId));
      doctor = d ?? null;
    }
    return res.json({
      type: "bill",
      code: bill.billNumber,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      order: billOrder ? { id: billOrder.id, orderNumber: billOrder.orderNumber, patientId: billOrder.patientId, doctorId: billOrder.doctorId, doctor: doctor ? { name: doctor.name, specialization: doctor.specialization } : null, createdAt: String(billOrder.createdAt) } : null,
      tests: [],
    });
  }

  // 4. Try report number.
  const [report] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.reportNumber, code));
  if (report) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, report.patientId));
    const [test] = await db.select().from(testsTable).where(eq(testsTable.id, report.testId));
    return res.json({
      type: "report",
      code: report.reportNumber,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      report: { id: report.id, reportNumber: report.reportNumber, title: report.title, status: report.status, deliveredAt: report.deliveredAt ? String(report.deliveredAt) : null, type: report.type },
    });
  }

  // 4b. Try report by ID if code is numeric.
  if (/^\d+$/.test(code)) {
    const [reportById] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, Number(code)));
    if (reportById) {
      const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, reportById.patientId));
      return res.json({
        type: "report",
        code: reportById.reportNumber,
        patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
        report: { id: reportById.id, reportNumber: reportById.reportNumber, title: reportById.title, status: reportById.status, deliveredAt: reportById.deliveredAt ? String(reportById.deliveredAt) : null, type: reportById.type },
      });
    }
  }

  // 5. Try patient ID (internal patientId string like P-2025-0001).
  const [patientByCode] = await db.select().from(patientsTable).where(eq(patientsTable.patientId, code));
  if (patientByCode) {
    return res.json({
      type: "order",
      code: patientByCode.patientId,
      patient: { id: patientByCode.id, firstName: patientByCode.firstName, lastName: patientByCode.lastName, patientId: patientByCode.patientId, gender: patientByCode.gender, dateOfBirth: String(patientByCode.dateOfBirth), ageValue: patientByCode.ageValue, ageUnit: patientByCode.ageUnit, phone: patientByCode.phone ?? "", bloodGroup: patientByCode.bloodGroup ?? null },
      order: null,
      tests: [],
    });
  }

  // 6. Try patient phone / mobile number.
  const [patientByPhone] = await db.select().from(patientsTable).where(eq(patientsTable.phone, code));
  if (patientByPhone) {
    return res.json({
      type: "patient",
      code: patientByPhone.patientId,
      patient: { id: patientByPhone.id, firstName: patientByPhone.firstName, lastName: patientByPhone.lastName, patientId: patientByPhone.patientId, gender: patientByPhone.gender, dateOfBirth: String(patientByPhone.dateOfBirth), ageValue: patientByPhone.ageValue, ageUnit: patientByPhone.ageUnit, phone: patientByPhone.phone ?? "", bloodGroup: patientByPhone.bloodGroup ?? null },
      order: null,
      tests: [],
    });
  }

  // 7. Try accession number (radiology studies).
  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.accessionNumber, code));
  if (study) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, study.patientId));
    const [order] = study.orderId
      ? await db.select().from(ordersTable).where(eq(ordersTable.id, study.orderId))
      : [null];
    return res.json({
      type: "order",
      code: study.accessionNumber,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: study.patientId ? patient.ageUnit : null, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      order: order ? { id: order.id, orderNumber: order.orderNumber, patientId: order.patientId, doctorId: order.doctorId, doctor: null, createdAt: String(order.createdAt) } : null,
    });
  }

  return res.status(404).json({ error: "No matching sample, order, bill, report, patient, phone, or accession number found" });
});

// ─── GET /api/resolve-barcode/patient/:patientId/reports ────────────────────
router.get("/patient/:patientId/reports", async (req, res) => {
  const patientId = Number(req.params.patientId);
  if (!Number.isFinite(patientId)) { res.status(400).json({ error: "Invalid patientId" }); return; }

  // Selected column by column. This used to be `r: patientReportsTable`, which
  // pulled the whole row — `body` and `impression` included — and then hand-picked
  // fields out of it, so a future column was exposed here by default. The delivery
  // counter is entitled to identity, status and who signed; never the content.
  const rows = await db
    .select({
      id: patientReportsTable.id,
      reportNumber: patientReportsTable.reportNumber,
      type: patientReportsTable.type,
      testId: patientReportsTable.testId,
      orderTestId: patientReportsTable.orderTestId,
      orderId: patientReportsTable.orderId,
      billId: patientReportsTable.billId,
      title: patientReportsTable.title,
      status: patientReportsTable.status,
      signedAt: patientReportsTable.signedAt,
      signedByName: patientReportsTable.signedByName,
      signatureId: patientReportsTable.signatureId,
      verifiedByName: patientReportsTable.verifiedByName,
      deliveredAt: patientReportsTable.deliveredAt,
      deliveredBy: patientReportsTable.deliveredBy,
      physicalState: patientReportsTable.physicalState,
      createdAt: patientReportsTable.createdAt,
      testName: testsTable.name,
      testCode: testsTable.code,
    })
    .from(patientReportsTable)
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(eq(patientReportsTable.patientId, patientId))
    .orderBy(desc(patientReportsTable.createdAt));

  // isReportClinicallyAuthorized is the authority, so it is applied once rather
  // than re-spelled in SQL: an unauthorised draft must not be listable here at
  // all, and the clerk's list must match what the handover endpoint will accept.
  const reports = rows
    .filter((row) => isReportClinicallyAuthorized(row))
    .map((row) => ({
      id: row.id,
      reportNumber: row.reportNumber,
      type: row.type,
      testId: row.testId,
      orderTestId: row.orderTestId,
      orderId: row.orderId,
      billId: row.billId,
      title: row.title,
      status: row.status,
      signedAt: row.signedAt ? String(row.signedAt) : null,
      deliveredAt: row.deliveredAt ? String(row.deliveredAt) : null,
      signedByName: row.signedByName,
      verifiedByName: row.verifiedByName,
      createdAt: String(row.createdAt),
      testName: row.testName,
      testCode: row.testCode,
      // NOT derived from deliveredAt: printing a report also sets that, so
      // reading it as "the patient collected it" is exactly the conflation the
      // custody ledger exists to end. The two-scan handover (PR-4) replaces this.
      isDelivered: !!row.deliveredAt,
      deliveredBy: row.deliveredBy,
      physicalState: row.physicalState,
    }));

  res.json({ patientId, reports });
});

// ─── POST /api/resolve-barcode/reports/:id/deliver ──────────────────────────
// RETIRED. This was the old one-click handover: one button, no record of who the
// paper went to, no record of whether it ever arrived at the counter, and a write
// straight to `status = 'delivered'` — the value the `report_delivered` commission
// policy pays out on. The counter in Scan Station replaces it with two named acts
// (`RECEIVED_AT_DELIVERY_COUNTER`, then `PHYSICALLY_HANDED_OVER`) in
// `report_custody_events`, per report, with a recipient category.
//
// The owner's ruling was "retire the old one-click delivery action at go-live, so
// staff have one clear workflow", and this is that retirement. It removes a live
// capability, so it deploys WITH the counter and with `/report-delivery:handover`
// granted to the people who run it — otherwise the clinic has no way to record a
// handover at all. `status = 'delivered'` keeps its old meaning and its old writers
// (`/print` still sets it); nothing about billing, report status or commission
// semantics changed here.
router.post("/reports/:id/deliver", async (req, res) => {
  res.status(410).json({
    error: "ONE_CLICK_DELIVERY_RETIRED",
    code: "ONE_CLICK_DELIVERY_RETIRED",
    message:
      "Handing a report over now happens at the delivery counter: Scan Station → Deliver reports, "
      + "on the patient's bill. One button recorded nothing about who took the paper, and this "
      + "clinic's audit trail needs more than that.",
    useInstead: { page: "/scan-station", mode: "deliver", endpoints: ["/api/report-custody/bill", "/api/report-custody/handover"] },
    reportId: req.params.id,
  });
});

export default router;

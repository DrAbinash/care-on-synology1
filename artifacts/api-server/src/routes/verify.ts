import { Router } from "express";
import { db, billsTable, patientsTable, clinicSettingsTable, orderTestsTable, testsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildBillAuditHash } from "../lib/billAuditHash";

export const verifyRouter = Router();

// Public bill verification endpoint. The QR code printed on every bill
// (when clinic.qrOnBillEnabled is on) encodes the URL
//   https://<host>/api/verify/bill/<billNumber>?hash=<fnv1a>
// pointing here. Anyone scanning the QR (regulator, patient, auditor) gets
// a self-contained read-only HTML page proving the bill exists in the
// database and showing its key totals + status. The ?hash= query param is
// the FNV-1a of BILL_NO-TIMESTAMP-TOTAL-OPERATOR_ID; mismatch means the
// physical QR / printed layout was altered after generation.
verifyRouter.get("/bill/:billNumber", async (req, res) => {
  const billNumber = String(req.params.billNumber || "").trim();
  if (!billNumber || billNumber.length > 64) {
    res.status(400).type("text/html").send(renderInvalid("Invalid bill number"));
    return;
  }

  const printedHash = String(req.query.hash ?? "").trim().toUpperCase();

  const [billRow] = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      paidAmount: billsTable.paidAmount,
      balanceAmount: billsTable.balanceAmount,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
      createdByName: billsTable.createdByName,
      cancelledAt: billsTable.cancelledAt,
      orderId: billsTable.orderId,
      patientId: billsTable.patientId,
      qrScanCount: billsTable.qrScanCount,
      receiptVerificationCount: billsTable.receiptVerificationCount,
      pdfDownloadCount: billsTable.pdfDownloadCount,
    })
    .from(billsTable)
    .where(eq(billsTable.billNumber, billNumber))
    .limit(1);

  if (!billRow) {
    res.status(404).type("text/html").send(renderNotFound(billNumber));
    return;
  }

  // Recompute FNV-1a from official DB fields and compare to the QR hash.
  const expectedHash = buildBillAuditHash({
    billNumber: billRow.billNumber,
    createdAt: billRow.createdAt,
    totalAmount: billRow.totalAmount,
    operatorId: (billRow.createdByName && String(billRow.createdByName).trim()) || "0",
  });

  const hashMatches = !!printedHash && printedHash === expectedHash;

  // Increment analytics only for genuine (hash-matched) scans — a forged QR
  // that guesses a real bill number should not inflate verification counts.
  if (hashMatches) {
    await db.update(billsTable)
      .set({
        qrScanCount: (billRow.qrScanCount ?? 0) + 1,
        receiptVerificationCount: (billRow.receiptVerificationCount ?? 0) + 1,
      })
      .where(eq(billsTable.id, billRow.id));
  }

  if (!hashMatches) {
    res.status(400).type("text/html").send(renderTampered({
      billNumber: billRow.billNumber,
      expectedHash,
      printedHash: printedHash || "(missing)",
    }));
    return;
  }

  // Get patient details
  const [patient] = await db
    .select({
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      patientId: patientsTable.patientId,
      dateOfBirth: patientsTable.dateOfBirth,
      createdAt: patientsTable.createdAt,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, billRow.patientId))
    .limit(1);

  const [clinic] = await db.select().from(clinicSettingsTable).limit(1);
  const clinicName = clinic?.name ?? "Diagnostic Centre";
  const logoDataUrl = clinic?.logoDataUrl ?? null;

  const patientName = patient
    ? `${patient.firstName ?? ""} ${patient.lastName ?? ""}`.trim()
    : "Unknown";
  const patientSince = patient?.createdAt
    ? new Date(patient.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short" })
    : "";

  const issued = billRow.createdAt
    ? new Date(billRow.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
    : "—";
  const cancelled = !!billRow.cancelledAt;

  // Get tests for this bill
  const tests = await db
    .select({
      name: testsTable.name,
      code: testsTable.code,
      category: testsTable.category,
      price: orderTestsTable.price,
      status: orderTestsTable.status,
    })
    .from(orderTestsTable)
    .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .where(eq(orderTestsTable.orderId, billRow.orderId));

  const activeTests = tests.filter((t) => (t.status ?? "active") !== "cancelled");

  res.type("text/html").send(renderVerified({
    clinicName,
    logoDataUrl,
    billNumber: billRow.billNumber,
    patientName,
    patientCode: patient?.patientId ?? "",
    patientSince,
    issued,
    total: Number(billRow.totalAmount),
    paid: Number(billRow.paidAmount),
    balance: Number(billRow.balanceAmount),
    status: cancelled ? "cancelled" : (billRow.status ?? "pending"),
    tests: activeTests,
    verified: true,
  }));
});

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c),
  );
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SHELL_CSS = `
  body { font-family: -apple-system, system-ui, "Segoe UI", Roboto, Arial, sans-serif;
    margin:0; background:#f6f8fb; color:#0f172a; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 32px 16px; }
  .card { background: white; border-radius: 16px; padding: 28px 24px;
    box-shadow: 0 4px 24px rgba(15,23,42,0.06); border:1px solid #e2e8f0; }
  .badge { display:inline-flex; align-items:center; gap:6px; padding:6px 12px;
    border-radius: 999px; font-size: 13px; font-weight:600; }
  .ok  { background:#dcfce7; color:#166534; }
  .warn{ background:#fef3c7; color:#92400e; }
  .bad { background:#fee2e2; color:#991b1b; }
  h1 { font-size:18px; margin:14px 0 4px; }
  .muted { color:#64748b; font-size: 12px; }
  table { width:100%; border-collapse: collapse; margin-top: 18px; font-size:14px; }
  td { padding: 8px 0; border-top: 1px solid #f1f5f9; }
  td:last-child { text-align:right; font-weight:600; }
  .total td { border-top: 2px solid #0f172a; font-size:15px; padding-top:12px; }
  .footer { margin-top: 18px; font-size: 11px; color:#94a3b8; text-align:center; }
`;

function renderVerified(b: {
  clinicName: string; logoDataUrl?: string | null; billNumber: string; patientName: string;
  patientCode: string; patientSince?: string; issued: string;
  total: number; paid: number; balance: number; status: string;
  tests?: { name: string | null; code: string | null; category: string | null; price: string | number | null; status: string | null }[];
  verified?: boolean;
}) {
  const statusClass =
    b.status === "paid" ? "ok" :
    b.status === "partial" ? "warn" :
    b.status === "cancelled" ? "bad" : "warn";
  const statusLabel = "✅ VERIFIED GENUINE RECEIPT";
  const payLabel =
    b.status === "cancelled" ? "Cancelled" :
    b.status === "paid" ? "Paid" :
    b.status === "partial" ? "Partial" : String(b.status);
  const testRows = b.tests && b.tests.length > 0
    ? b.tests.map((t, i) => `<tr><td style="text-align:left">${i + 1}. ${esc(t.name ?? "Unnamed")}</td><td style="text-align:right">${inr(Number(t.price || 0))}</td></tr>`).join("")
    : "";
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>Bill ${esc(b.billNumber)} — Verification</title>
    <style>${SHELL_CSS}</style>
  </head><body>
    <div class="wrap"><div class="card">
      ${b.logoDataUrl ? `<div style="text-align:center;margin-bottom:12px"><img src="${b.logoDataUrl}" alt="logo" style="max-height:48px;max-width:160px;object-fit:contain"/></div>` : ""}
      <span class="badge ${statusClass}">${statusLabel}</span>
      <h1>${esc(b.clinicName)}</h1>
      <div class="muted">This bill was issued by ${esc(b.clinicName)} and is recorded in their system. Anti-tamper hash matched.</div>
      <table>
        <tr><td>Bill Number</td><td>${esc(b.billNumber)}</td></tr>
        <tr><td>Patient</td><td>${esc(b.patientName)}</td></tr>
        ${b.patientCode ? `<tr><td>Patient ID</td><td>${esc(b.patientCode)}</td></tr>` : ""}
        ${b.patientSince ? `<tr><td>Patient Since</td><td>${esc(b.patientSince)}</td></tr>` : ""}
        <tr><td>Issued</td><td>${esc(b.issued)}</td></tr>
        <tr><td>Status</td><td style="text-transform:capitalize">${esc(payLabel)}</td></tr>
        <tr><td>Paid</td><td>${inr(b.paid)}</td></tr>
        <tr><td>Balance</td><td>${inr(b.balance)}</td></tr>
        <tr class="total"><td>Total Amount</td><td>${inr(b.total)}</td></tr>
      </table>
      ${testRows ? `<div style="margin-top:18px;font-size:13px;font-weight:700;border-bottom:1px solid #f1f5f9;padding-bottom:6px">Test Summary</div>
      <table style="margin-top:6px;font-size:13px">${testRows}</table>` : ""}
      <div class="footer">Verified at ${esc(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST</div>
    </div></div>
  </body></html>`;
}

function renderTampered(opts: { billNumber: string; expectedHash: string; printedHash: string }) {
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>Security Breach — Bill ${esc(opts.billNumber)}</title><style>${SHELL_CSS}</style>
  </head><body><div class="wrap"><div class="card">
    <span class="badge bad">❌ SECURITY BREACH</span>
    <h1>Receipt integrity check failed</h1>
    <div class="muted" style="margin-top:10px;line-height:1.5;font-size:14px;color:#7f1d1d">
      The physical QR code or printed text layout has been altered after system generation.
    </div>
    <div class="muted" style="margin-top:14px">
      Bill <strong>${esc(opts.billNumber)}</strong> exists in our records, but the anti-tamper hash on the scanned QR does not match the database.
    </div>
    <div class="footer">Checked at ${esc(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST</div>
  </div></div></body></html>`;
}

function renderNotFound(billNumber: string) {
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>Bill not found</title><style>${SHELL_CSS}</style>
  </head><body><div class="wrap"><div class="card">
    <span class="badge bad">⚠️ Not Found</span>
    <h1>This bill could not be verified</h1>
    <div class="muted">Bill number <strong>${esc(billNumber)}</strong> does not exist in our records. It may be a forged or invalid receipt.</div>
  </div></div></body></html>`;
}

function renderInvalid(msg: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Invalid request</title><style>${SHELL_CSS}</style></head>
  <body><div class="wrap"><div class="card"><span class="badge bad">⚠️ Invalid</span><h1>${esc(msg)}</h1></div></div></body></html>`;
}

export default verifyRouter;

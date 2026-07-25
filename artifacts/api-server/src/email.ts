import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import { emailSettingsTable } from "@workspace/db/schema";

export async function getEmailSettings() {
  const [settings] = await db.select().from(emailSettingsTable).limit(1);
  return settings ?? null;
}

export async function getTransporter() {
  const s = await getEmailSettings();
  if (!s || !s.smtpHost || !s.smtpUser) return null;
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: Number(s.smtpPort),
    secure: s.smtpSecure,
    auth: { user: s.smtpUser, pass: s.smtpPassword },
  });
}

export function getAllRecipients(settings: { adminEmail: string; extraRecipients: string }) {
  const extra: string[] = JSON.parse(settings.extraRecipients || "[]");
  const all = [settings.adminEmail, ...extra].filter(Boolean);
  return [...new Set(all)];
}

export async function sendBillEditEmail(params: {
  billNumber: string;
  patientName: string;
  editedBy: string;
  reason: string;
  changes: { field: string; from: string | null; to: string | null }[];
}) {
  const s = await getEmailSettings();
  if (!s || !s.billEditEnabled) return;

  const transport = await getTransporter();
  if (!transport) return;

  const recipients = getAllRecipients(s);
  if (recipients.length === 0) return;

  const changeRows = params.changes
    .map(c => `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${c.field}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#dc2626">${c.from ?? "—"}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#16a34a">${c.to ?? "—"}</td>
    </tr>`)
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px">
      <div style="background:#1e40af;color:white;padding:16px 20px;border-radius:8px 8px 0 0;margin-bottom:0">
        <h2 style="margin:0;font-size:18px">Bill Edited — ${params.billNumber}</h2>
      </div>
      <div style="background:white;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <p style="margin:0 0 12px"><strong>Patient:</strong> ${params.patientName}</p>
        <p style="margin:0 0 12px"><strong>Edited by:</strong> ${params.editedBy}</p>
        <p style="margin:0 0 16px"><strong>Reason:</strong> ${params.reason}</p>
        <h3 style="font-size:14px;margin:0 0 8px;color:#374151">Changes Made</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="padding:6px 12px;text-align:left">Field</th>
              <th style="padding:6px 12px;text-align:left">Before</th>
              <th style="padding:6px 12px;text-align:left">After</th>
            </tr>
          </thead>
          <tbody>${changeRows}</tbody>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Sent by Care Diagnostics ERP • ${new Date().toLocaleString("en-IN")}</p>
      </div>
    </div>`;

  await transport.sendMail({
    from: `"${s.fromName}" <${s.fromAddress}>`,
    to: recipients.join(", "),
    subject: `[Bill Edit] ${params.billNumber} — ${params.patientName}`,
    html,
  });
}

export async function sendBillReprintEmail(params: {
  billNumber: string;
  patientName: string;
  reprintedBy: string;
  reason: string;
  reprintCount: number;
  totalAmount: number;
}) {
  const s = await getEmailSettings();
  // Re-use the bill-edit notification toggle so admins control reprint emails too.
  if (!s || !s.billEditEnabled) return;

  const transport = await getTransporter();
  if (!transport) return;

  const recipients = getAllRecipients(s);
  if (recipients.length === 0) return;

  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px">
      <div style="background:#b45309;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">Bill Re-printed — ${params.billNumber}</h2>
      </div>
      <div style="background:white;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <p style="margin:0 0 8px"><strong>Patient:</strong> ${params.patientName}</p>
        <p style="margin:0 0 8px"><strong>Total:</strong> ${inr(params.totalAmount)}</p>
        <p style="margin:0 0 8px"><strong>Re-printed by:</strong> ${params.reprintedBy}</p>
        <p style="margin:0 0 8px"><strong>Reason:</strong> ${params.reason}</p>
        <p style="margin:0 0 8px"><strong>Re-print count:</strong> #${params.reprintCount}</p>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Care Diagnostics ERP • ${new Date().toLocaleString("en-IN")}</p>
      </div>
    </div>`;

  await transport.sendMail({
    from: `"${s.fromName}" <${s.fromAddress}>`,
    to: recipients.join(", "),
    subject: `[Bill Re-print] ${params.billNumber} — ${params.patientName}`,
    html,
  });
}

export async function sendDailySummaryEmail(params: {
  date: string;
  totalRevenue: number;
  totalBills: number;
  paidBills: number;
  pendingBills: number;
  totalPayments: number;
  billsEdited: number;
  cashCollected: number;
  digitalCollected: number;
  unclassifiedCollected: number;
  discountsGiven: number;
  refundsAndCancellations: number;
  averageBillValue: number;
  newPatients: number;
  totalOutstandingDues: number;
  cashExpenses: number;
  digitalExpenses: number;
  staffWise: Array<{ name: string; amount: number }>;
  topTests: Array<{ name: string; count: number }>;
  activityLogs: Array<{ billNumber: string; editor: string; action: string }>;
  outstandingBills: Array<{ status: string; count: string; amount: number }>;
  discountDetails: Array<{ reason: string; amount: number }>;
}, opts?: { force?: boolean }) {
  const s = await getEmailSettings();
  // `force` is used by the manual "Send Summary Now" button so an admin can
  // verify delivery even while the scheduled daily send is turned off.
  if (!s || (!s.dailySummaryEnabled && !opts?.force)) return;

  const transport = await getTransporter();
  if (!transport) return;

  const recipients = getAllRecipients(s);
  if (recipients.length === 0) return;

  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  const cards = [
    ["Total Revenue Collected", inr(params.totalRevenue)],
    ["Total Outstanding Dues", inr(params.totalOutstandingDues)],
    ["Cash Collected", inr(params.cashCollected)],
    ["Digital Collected", inr(params.digitalCollected)],
    ["Average Bill Value", inr(params.averageBillValue)],
    ["New Patients Today", String(params.newPatients)],
  ];
  const cardHtml = cards.map(([label, value]) => `
    <div style="flex:1;min-width:150px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px">
      <div style="font-size:11px;color:#6b7280">${label}</div>
      <div style="font-size:16px;font-weight:700;color:#065f46;margin-top:2px">${value}</div>
    </div>`).join("");

  const rows: Array<[string, string]> = [
    ["Date", params.date],
    ["Bills Paid", String(params.paidBills)],
    ["Bills Pending / Partial", String(params.pendingBills)],
    ["Bills Edited", String(params.billsEdited)],
    ["Discounts Given", inr(params.discountsGiven)],
    ["Refunds & Cancellations", inr(params.refundsAndCancellations)],
    ["Expenses (Cash)", inr(params.cashExpenses)],
    ["Expenses (Digital)", inr(params.digitalExpenses)],
  ];
  if (params.unclassifiedCollected > 0) {
    rows.push(["Unclassified Payments (needs review)", inr(params.unclassifiedCollected)]);
  }
  rows.push(
    ["Bills Created", String(params.totalBills)],
    ["Payments Received", inr(params.totalPayments)]
  );

  const rowHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#6b7280;font-size:13px">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${value}</td>
    </tr>`).join("");

  const staffRowHtml = params.staffWise.map(({ name, amount }) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${inr(amount)}</td>
    </tr>`).join("");

  const testRowHtml = params.topTests.map(({ name, count }) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${count}</td>
    </tr>`).join("");

  const activityRowHtml = params.activityLogs.map(({ billNumber, editor, action }) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${billNumber}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${editor}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#6b7280">${action}</td>
    </tr>`).join("");

  const outstandingRowHtml = params.outstandingBills.map(({ status, count, amount }) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${status}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${count}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${inr(amount)}</td>
    </tr>`).join("");

  const discountRowHtml = params.discountDetails.map(({ reason, amount }) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${reason}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px">${inr(amount)}</td>
    </tr>`).join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px">
      <div style="background:#059669;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">Daily Summary Report</h2>
        <p style="margin:4px 0 0;opacity:0.85;font-size:13px">${params.date}</p>
      </div>
      <div style="background:white;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">${cardHtml}</div>
        <table style="width:100%;border-collapse:collapse">${rowHtml}</table>
        ${staffRowHtml ? `
        <h3 style="font-size:13px;color:#374151;margin:20px 0 8px">Staff-wise Collections</h3>
        <table style="width:100%;border-collapse:collapse">${staffRowHtml}</table>` : ""}
        ${testRowHtml ? `
        <h3 style="font-size:13px;color:#374151;margin:20px 0 8px">Top Tests Ordered</h3>
        <table style="width:100%;border-collapse:collapse">${testRowHtml}</table>` : ""}
        ${activityRowHtml ? `
        <h3 style="font-size:13px;color:#374151;margin:20px 0 8px">My Activity Logs</h3>
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#f9fafb">
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">Bill #</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">Editor</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">Action</td>
          </tr>
          ${activityRowHtml}
        </table>` : ""}
        ${outstandingRowHtml ? `
        <h3 style="font-size:13px;color:#374151;margin:20px 0 8px">Outstanding Bills</h3>
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#f9fafb">
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">Status</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">Count</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">Amount</td>
          </tr>
          ${outstandingRowHtml}
        </table>` : ""}
        ${discountRowHtml ? `
        <h3 style="font-size:13px;color:#374151;margin:20px 0 8px">Discount Given</h3>
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#f9fafb">
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">Reason</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">Amount</td>
          </tr>
          ${discountRowHtml}
        </table>` : ""}
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Care Diagnostics ERP — Automated Daily Report</p>
      </div>
    </div>`;

  await transport.sendMail({
    from: `"${s.fromName}" <${s.fromAddress}>`,
    to: recipients.join(", "),
    subject: `[Daily Report] Care Diagnostics — ${params.date}`,
    html,
  });
}

// Send the monthly money-trail audit summary email. Returns ok/error so the
// caller can stamp emailSentAt on the audit row.
export async function sendMonthlyAuditEmail(params: {
  auditId: number;
  periodFrom: string;
  periodTo: string;
  anomalyCount: number;
  highCount: number;
  totalImpact: number;
  report: { anomalies: Array<{ category: string; severity: string; count: number; totalAmount: number; description: string }>; periodTotals: Record<string, string | number> };
}): Promise<{ ok: boolean; error?: string }> {
  const s = await getEmailSettings();
  if (!s) return { ok: false, error: "Email settings not configured" };
  const to = getAllRecipients({ adminEmail: s.adminEmail, extraRecipients: s.extraRecipients });
  if (to.length === 0) return { ok: false, error: "No recipients configured" };
  const transport = await getTransporter();
  if (!transport) return { ok: false, error: "SMTP transport unavailable" };

  const fmt = (n: number | string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n ?? 0));
  const headlineColor = params.highCount > 0 ? "#b91c1c" : params.anomalyCount > 0 ? "#b45309" : "#047857";
  const t = params.report.periodTotals;

  const anomalyRows = params.report.anomalies.map((a) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${a.category}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-transform:uppercase;font-size:11px;color:${a.severity === "high" ? "#b91c1c" : a.severity === "medium" ? "#b45309" : "#0369a1"}">${a.severity}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${a.count}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${a.totalAmount > 0 ? fmt(a.totalAmount) : "—"}</td>
    </tr>`).join("");

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#1f2937">
      <h2 style="margin:0 0 4px;color:#1f2937">Monthly Money-Trail Audit</h2>
      <p style="margin:0;color:#6b7280">Period: <b>${params.periodFrom}</b> to <b>${params.periodTo}</b></p>
      <div style="background:#f3f4f6;border-left:4px solid ${headlineColor};padding:12px 16px;margin:16px 0;border-radius:4px">
        <div style="font-weight:700;color:${headlineColor};font-size:16px">
          ${params.highCount > 0
            ? `${params.highCount} HIGH-severity issue(s) found · ${params.anomalyCount} total flagged rows`
            : params.anomalyCount > 0
              ? `${params.anomalyCount} item(s) flagged for review (no high-severity)`
              : "No anomalies. Books reconcile cleanly."}
        </div>
        <div style="color:#6b7280;font-size:13px;margin-top:4px">
          Estimated amount impact: <b>${fmt(params.totalImpact)}</b>
        </div>
      </div>
      <h3 style="margin:20px 0 8px">Period Summary</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 8px;color:#6b7280">Bills</td><td style="padding:6px 8px;text-align:right;font-weight:600">${t.bill_count ?? 0}</td>
            <td style="padding:6px 8px;color:#6b7280">Total billed</td><td style="padding:6px 8px;text-align:right;font-weight:600">${fmt(t.total_sum ?? 0)}</td></tr>
        <tr><td style="padding:6px 8px;color:#6b7280">Discount</td><td style="padding:6px 8px;text-align:right;font-weight:600">${fmt(t.discount_sum ?? 0)}</td>
            <td style="padding:6px 8px;color:#6b7280">Paid</td><td style="padding:6px 8px;text-align:right;font-weight:600">${fmt(t.paid_sum ?? 0)}</td></tr>
        <tr><td style="padding:6px 8px;color:#6b7280">Refunded</td><td style="padding:6px 8px;text-align:right;font-weight:600">${fmt(t.refund_sum ?? 0)}</td>
            <td style="padding:6px 8px;color:#6b7280">Outstanding</td><td style="padding:6px 8px;text-align:right;font-weight:600">${fmt(t.balance_sum ?? 0)}</td></tr>
      </table>
      ${anomalyRows ? `
        <h3 style="margin:20px 0 8px">Anomalies</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f9fafb">
            <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb">Category</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb">Severity</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb">Count</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb">Impact</th>
          </tr></thead>
          <tbody>${anomalyRows}</tbody>
        </table>` : ""}
      <p style="margin-top:24px;color:#6b7280;font-size:12px">
        Open the Super Admin Portal → Money Trail Audit → History to view, print or sign off audit #${params.auditId}.
      </p>
    </div>`;

  try {
    await transport.sendMail({
      from: `"${s.fromName}" <${s.fromAddress}>`,
      to: to.join(","),
      subject: `[Money-Trail Audit] ${params.periodFrom} to ${params.periodTo} — ${params.anomalyCount} flagged`,
      html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

// ── Monthly referral-activity summary ────────────────────────────────────────
// Replaces the month-end "Commission Report" email that was removed because it
// mailed every doctor's commission to the clinic's recipients with no pen drive
// involved (and computed it with its own drifted formula).
//
// This one answers "who referred how much work last month" WITHOUT answering
// "what do we owe them". It is given referral counts and billed amounts and has
// no access to a rate, a commission or a payout — the caller does not compute
// one, and nothing here imports the commission engine. That is deliberate: it is
// what keeps commission readable only with the drive plugged in.
export async function sendMonthlyReferralSummaryEmail(params: {
  periodFrom: string;
  periodTo: string;
  doctors: Array<{ name: string; specialization: string | null; visits: number; tests: number; billed: number }>;
  totals: { doctors: number; visits: number; tests: number; billed: number };
  topTests: Array<{ name: string; count: number }>;
}, opts?: { force?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const s = await getEmailSettings();
  if (!s) return { ok: false, error: "Email settings not configured" };
  // `force` is used by the manual trigger so an admin can verify delivery while
  // the scheduled send is still off.
  if (!s.monthlyReferralSummaryEnabled && !opts?.force) return { ok: false, error: "Monthly referral summary is turned off" };
  const to = getAllRecipients({ adminEmail: s.adminEmail, extraRecipients: s.extraRecipients });
  if (to.length === 0) return { ok: false, error: "No recipients configured" };
  const transport = await getTransporter();
  if (!transport) return { ok: false, error: "SMTP transport unavailable" };

  const inr = (n: number) => `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const rows = params.doctors.map((d, i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${d.name}${
        d.specialization ? `<span style="font-weight:400;color:#6b7280"> · ${d.specialization}</span>` : ""
      }</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${d.visits}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${d.tests}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${inr(d.billed)}</td>
    </tr>`).join("");

  const topTestRows = params.topTests.map((t) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${t.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${t.count}</td>
    </tr>`).join("");

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#1f2937">
      <h2 style="margin:0 0 4px">Monthly Referral Summary</h2>
      <p style="margin:0;color:#6b7280">Period: <b>${params.periodFrom}</b> to <b>${params.periodTo}</b></p>

      <div style="display:flex;flex-wrap:wrap;gap:10px;margin:16px 0">
        <div style="flex:1;min-width:130px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#6b7280">Referring Doctors</div>
          <div style="font-size:18px;font-weight:700;color:#075985;margin-top:2px">${params.totals.doctors}</div>
        </div>
        <div style="flex:1;min-width:130px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#6b7280">Patient Visits</div>
          <div style="font-size:18px;font-weight:700;color:#075985;margin-top:2px">${params.totals.visits}</div>
        </div>
        <div style="flex:1;min-width:130px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#6b7280">Tests Performed</div>
          <div style="font-size:18px;font-weight:700;color:#075985;margin-top:2px">${params.totals.tests}</div>
        </div>
        <div style="flex:1;min-width:130px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#6b7280">Total Billed</div>
          <div style="font-size:18px;font-weight:700;color:#075985;margin-top:2px">${inr(params.totals.billed)}</div>
        </div>
      </div>

      <h3 style="margin:20px 0 8px">By Referring Doctor</h3>
      ${rows ? `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f9fafb">
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb;width:28px">#</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb">Doctor</th>
          <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb">Visits</th>
          <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb">Tests</th>
          <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb">Billed</th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr style="background:#fefce8">
            <td style="padding:8px;font-weight:700" colspan="2">TOTAL</td>
            <td style="padding:8px;text-align:right;font-weight:700">${params.totals.visits}</td>
            <td style="padding:8px;text-align:right;font-weight:700">${params.totals.tests}</td>
            <td style="padding:8px;text-align:right;font-weight:700">${inr(params.totals.billed)}</td>
          </tr>
        </tbody>
      </table>` : `<p style="color:#6b7280;font-size:13px">No referrals recorded in this period.</p>`}

      ${topTestRows ? `
        <h3 style="margin:20px 0 8px">Most Referred Tests</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f9fafb">
            <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Test</th>
            <th style="padding:6px 8px;text-align:right;border-bottom:1px solid #e5e7eb">Count</th>
          </tr></thead>
          <tbody>${topTestRows}</tbody>
        </table>` : ""}

      <p style="margin-top:24px;padding:10px 12px;background:#f3f4f6;border-radius:4px;color:#6b7280;font-size:12px">
        This summary shows referral activity only. Commission rates, amounts and payouts are
        deliberately not included — they are visible in the Super Admin portal with the pen
        drive plugged in.
      </p>
    </div>`;

  try {
    await transport.sendMail({
      from: `"${s.fromName}" <${s.fromAddress}>`,
      to: to.join(","),
      subject: `[Referral Summary] ${params.periodFrom} to ${params.periodTo} — ${params.totals.visits} visits from ${params.totals.doctors} doctors`,
      html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

// General-purpose alert email — used by automated watchdogs (e.g. the PACS
// pull-agent stall detector in cron.ts). Accepts an arbitrary subject and
// HTML body so individual watchdogs can compose their own alert content
// without needing a new dedicated email function for each one.
export async function sendAlertEmail(params: {
  subject: string;
  html: string;
}) {
  const s = await getEmailSettings();
  if (!s || !s.adminEmail) return;

  const transport = await getTransporter();
  if (!transport) return;

  try {
    await transport.sendMail({
      from: `"${s.fromName}" <${s.fromAddress}>`,
      to: s.adminEmail,
      subject: params.subject,
      html: params.html,
    });
  } catch (err) {
    console.error("[email] alert email failed:", err instanceof Error ? err.message : err);
  }
}

export async function sendBackupFailureEmail(params: {
  jobName: string;
  errorMessage: string;
  backupType: string;
  completedAt: Date;
}) {
  const s = await getEmailSettings();
  if (!s || !s.adminEmail) return;

  const transport = await getTransporter();
  if (!transport) return;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fef2f2;padding:24px;border-radius:12px">
      <div style="background:#dc2626;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">Backup Failure Alert</h2>
        <p style="margin:4px 0 0;opacity:0.85;font-size:13px">${params.completedAt.toLocaleString("en-IN")}</p>
      </div>
      <div style="background:white;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <p style="margin:0 0 12px"><strong>Job:</strong> ${params.jobName}</p>
        <p style="margin:0 0 12px"><strong>Type:</strong> ${params.backupType}</p>
        <p style="margin:0 0 12px"><strong>Error:</strong> ${params.errorMessage}</p>
        <p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Care Diagnostics ERP — Automated Backup Monitoring</p>
      </div>
    </div>`;

  try {
    await transport.sendMail({
      from: `"${s.fromName}" <${s.fromAddress}>`,
      to: s.adminEmail,
      subject: `[ALERT] Backup Failed — ${params.jobName}`,
      html,
    });
  } catch (err) {
    console.error("[email] backup failure email failed:", err instanceof Error ? err.message : err);
  }
}

export async function sendAccountLockedEmail(params: {
  userName: string;
  userEmail: string;
  attempts: number;
  lockedUntil: Date;
  ipAddress: string;
}) {
  const s = await getEmailSettings();
  if (!s || !s.adminEmail) return;
  const transport = await getTransporter();
  if (!transport) return;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fef2f2;padding:24px;border-radius:12px">
      <div style="background:#b45309;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">Account Locked - ${params.userName}</h2>
      </div>
      <div style="background:white;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <p style="margin:0 0 12px"><strong>User:</strong> ${params.userName} (${params.userEmail})</p>
        <p style="margin:0 0 12px"><strong>Failed attempts:</strong> ${params.attempts}</p>
        <p style="margin:0 0 12px"><strong>IP Address:</strong> ${params.ipAddress}</p>
        <p style="margin:0 0 12px"><strong>Locked until:</strong> ${params.lockedUntil.toLocaleString("en-IN")}</p>
        <p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Care Diagnostics ERP - Security Alert</p>
      </div>
    </div>`;

  try {
    await transport.sendMail({
      from: `"${s.fromName}" <${s.fromAddress}>`,
      to: s.adminEmail,
      subject: `[SECURITY] Account Locked - ${params.userName}`,
      html,
    });
  } catch (err) {
    console.error("[email] account lockout email failed:", err instanceof Error ? err.message : err);
  }
}

// Send a finalized patient report by email. Returns ok/error so the caller
// can persist a report_share row with the right status.
export async function sendReportEmail(params: {
  to: string;
  subject: string;
  html: string;
  patientName: string;
  reportNumber: string;
}): Promise<{ ok: boolean; error?: string }> {
  const s = await getEmailSettings();
  if (!s) return { ok: false, error: "Email settings not configured" };
  const transport = await getTransporter();
  if (!transport) return { ok: false, error: "SMTP transport unavailable" };
  try {
    await transport.sendMail({
      from: `"${s.fromName}" <${s.fromAddress}>`,
      to: params.to,
      subject: params.subject,
      html: params.html || `<p>Hello ${params.patientName}, your report ${params.reportNumber} is ready.</p>`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

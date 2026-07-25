import { Router, type Response } from "express";
import { db, billsTable, paymentsTable, patientsTable } from "@workspace/db";
import { accountsTable, vouchersTable, voucherAuditsTable } from "@workspace/db/schema";
import { eq, desc, and, gte, lte, like, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { apiError, apiErrorFromZod } from "../lib/api-error";
import { geminiParseBankStatement, type BankTransaction } from "@workspace/integrations-gemini-ai";
import { todayIST, dateToISTString } from "../lib/istDate";
import { auditFromRequest } from "../lib/audit";
import { autoVoucherForPayment } from "../lib/auto-voucher";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { buildTrialBalance, buildProfitLoss, buildBalanceSheet, type AmountMap } from "../lib/accounting/reportBuilders";

const router = Router();

// Reject non-positive-integer route IDs *before* drizzle sees them — otherwise
// `Number("abc")` → NaN and PostgreSQL throws an opaque 500.
function parseId(raw: string, res: Response): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    apiError(res, 400, "Invalid id");
    return null;
  }
  return n;
}

const AccountBody = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  code: z.string().trim().optional().nullable(),
  bankName: z.string().trim().optional().nullable(),
  accountNumber: z.string().trim().optional().nullable(),
  ifscCode: z.string().trim().optional().nullable(),
  tallyGroup: z.string().trim().optional().nullable(),
  openingBalance: z.union([z.number(), z.string()]).optional(),
  openingBalanceType: z.enum(["Dr", "Cr"]).optional(),
  gstApplicable: z.boolean().optional(),
  gstNumber: z.string().trim().optional().nullable(),
  pan: z.string().trim().optional().nullable(),
});

const VoucherBody = z.object({
  type: z.enum(["payment", "receipt", "contra", "journal", "bank_transfer", "sales", "purchase"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  creditAccountId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  debitAccountId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  amount: z.union([z.number().positive(), z.string().regex(/^-?\d+(\.\d+)?$/)]),
  particular: z.string().trim().min(1),
  remark: z.string().trim().optional().nullable(),
  performedBy: z.string().trim().optional().nullable(),
  reference: z.string().trim().optional().nullable(),
  narration: z.string().trim().optional().nullable(),
  billId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional().nullable(),
});

// ─── Tally voucher type mapping ──────────────────────────────────────────────
const TALLY_VOUCHER_TYPE: Record<string, string> = {
  payment:       "Payment",
  receipt:       "Receipt",
  contra:        "Contra",
  journal:       "Journal",
  bank_transfer: "Contra",
  sales:         "Sales",
  purchase:      "Purchase",
};

// ─── Tally group → parent group mapping ──────────────────────────────────────
const TALLY_PARENT: Record<string, string> = {
  "Current Assets":           "Assets",
  "Fixed Assets":             "Assets",
  "Investments":              "Assets",
  "Loans & Advances (Asset)": "Assets",
  "Misc. Expenses (Asset)":   "Assets",
  "Current Liabilities":      "Liabilities",
  "Loans (Liability)":        "Liabilities",
  "Unsecured Loans":          "Liabilities",
  "Capital Account":          "Capital Account",
  "Reserves & Surplus":       "Capital Account",
  "Direct Income":            "Income",
  "Indirect Income":          "Income",
  "Direct Expenses":          "Expenses",
  "Indirect Expenses":        "Expenses",
  "Cash-in-Hand":             "Current Assets",
  "Bank Accounts":            "Current Assets",
  "Bank OD Accounts":         "Bank OD Accounts",
  "Duties & Taxes":           "Current Liabilities",
  "Sundry Creditors":         "Current Liabilities",
  "Sundry Debtors":           "Current Assets",
};

// ─── Accounts ────────────────────────────────────────────────────────────────

router.get("/accounts", async (_req, res) => {
  const rows = await db.select().from(accountsTable).orderBy(accountsTable.name);
  res.json(rows.map(r => ({ ...r, openingBalance: Number(r.openingBalance || 0) })));
  return;
});

router.post("/accounts", async (req, res) => {
  const parsed = AccountBody.safeParse(req.body);
  if (!parsed.success) { apiErrorFromZod(res, 400, "Invalid body", parsed.error); return; }
  const { name, type, code, bankName, accountNumber, ifscCode, tallyGroup, openingBalance, openingBalanceType, gstApplicable, gstNumber, pan } = parsed.data;
  const [account] = await db
    .insert(accountsTable)
    .values({
      name, type, code, bankName, accountNumber, ifscCode,
      tallyGroup: tallyGroup || null,
      openingBalance: openingBalance != null ? String(openingBalance) : "0",
      openingBalanceType: openingBalanceType || "Dr",
      gstApplicable: !!gstApplicable,
      gstNumber: gstNumber || null,
      pan: pan || null,
    })
    .returning();
  res.status(201).json({ ...account, openingBalance: Number(account.openingBalance || 0) });
  return;
});

router.patch("/accounts/:id", async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const updates: Record<string, unknown> = {};
  const allowed = ["name", "type", "code", "bankName", "accountNumber", "ifscCode", "isActive",
    "tallyGroup", "openingBalance", "openingBalanceType", "gstApplicable", "gstNumber", "pan"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      updates[k] = k === "openingBalance" ? String(req.body[k]) : req.body[k];
    }
  }
  const [row] = await db.update(accountsTable).set(updates).where(eq(accountsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json({ ...row, openingBalance: Number(row.openingBalance || 0) });
  return;
});

// ─── Vouchers ────────────────────────────────────────────────────────────────

function voucherBucket(type: string): string {
  const prefix = type === "payment" ? "PV"
    : type === "receipt" ? "RV"
    : type === "contra" || type === "bank_transfer" ? "BT"
    : type === "sales" ? "SV"
    : type === "purchase" ? "PUR"
    : "JV";
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  return `${prefix}-${year}${month}-`;
}

// Highest numeric suffix already ISSUED in a voucher-number bucket.
//
// Deliberately MAX and not count(*): count(*) counts surviving rows, so once any
// voucher in the bucket is removed the count permanently trails the max by the
// number removed. The retry loops below then generate candidates that all sit
// inside the already-occupied range, and once that drift reaches 3 every attempt
// collides, nothing inserts, the count never moves, and the identical numbers are
// retried forever. That took out receipt-voucher creation in production. See the
// full note on nextVoucherNumber in lib/auto-voucher.ts.
//
// The anchored all-digit regex filters non-numeric suffixes (e.g. the synthetic
// "OB" opening-balance row the ledger view injects) out before the ::int cast,
// so the cast cannot throw.
async function maxVoucherSeq(bucket: string): Promise<number> {
  const r = await db
    .select({
      m: sql<number>`coalesce(max(substring(${vouchersTable.voucherNumber} from ${bucket.length + 1})::int), 0)`,
    })
    .from(vouchersTable)
    .where(
      and(
        like(vouchersTable.voucherNumber, `${bucket}%`),
        sql`${vouchersTable.voucherNumber} ~ ${`^${bucket}[0-9]+$`}`,
      ),
    );
  return Number(r[0]?.m ?? 0);
}

// Compute the next sequence in a per-month bucket. Race-prone by itself —
// always pair with the unique-constraint retry loop in POST /vouchers below.
// (With MAX every candidate is strictly above all existing numbers, so the retry
// budget is now spent only on genuine races instead of on a deterministic offset.)
async function nextVoucherNumber(type: string, attemptOffset = 0): Promise<string> {
  const bucket = voucherBucket(type);
  const next = (await maxVoucherSeq(bucket)) + 1 + attemptOffset;
  return `${bucket}${String(next).padStart(4, "0")}`;
}

// Postgres unique-violation SQLSTATE
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "23505";
}

router.get("/vouchers", async (req, res) => {
  const { type, from, to, q, billId } = req.query as Record<string, string>;

  const conditions = [];
  if (type && type !== "all") conditions.push(eq(vouchersTable.type, type));
  if (from) conditions.push(gte(vouchersTable.date, from));
  if (to) conditions.push(lte(vouchersTable.date, to));
  if (q) conditions.push(like(vouchersTable.particular, `%${q}%`));
  if (billId) conditions.push(eq(vouchersTable.billId, Number(billId)));

  // JOIN bills → patients so each voucher row carries patient identity.
  // Both joins are LEFT so vouchers without a linked bill still appear.
  const rows = await db
    .select({
      id: vouchersTable.id,
      voucherNumber: vouchersTable.voucherNumber,
      type: vouchersTable.type,
      date: vouchersTable.date,
      creditAccountId: vouchersTable.creditAccountId,
      debitAccountId: vouchersTable.debitAccountId,
      amount: vouchersTable.amount,
      particular: vouchersTable.particular,
      remark: vouchersTable.remark,
      performedBy: vouchersTable.performedBy,
      reference: vouchersTable.reference,
      narration: vouchersTable.narration,
      billId: vouchersTable.billId,
      createdAt: vouchersTable.createdAt,
      billNumber: billsTable.billNumber,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      patientUhid: patientsTable.patientId,
      patientPhone: patientsTable.phone,
    })
    .from(vouchersTable)
    .leftJoin(billsTable, eq(vouchersTable.billId, billsTable.id))
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(vouchersTable.createdAt));

  res.json(rows.map((v) => ({
    ...v,
    amount: Number(v.amount),
    patientName: v.patientFirstName && v.patientLastName
      ? `${v.patientFirstName} ${v.patientLastName}`.trim()
      : null,
  })));
  return;
});

router.post("/vouchers", async (req, res) => {
  const parsed = VoucherBody.safeParse(req.body);
  if (!parsed.success) { apiErrorFromZod(res, 400, "Invalid body", parsed.error); return; }
  const { type, date, creditAccountId, debitAccountId, amount, particular, remark, performedBy, reference, narration, billId } = parsed.data;

  // Race-safe insert: count-based numbering can collide under concurrency, but
  // the DB has a unique index on voucher_number. On unique-violation we bump
  // the sequence by the attempt count and retry. 3 attempts ≈ tolerates a
  // 3-way concurrent insert into the same bucket; surfaces 409 beyond that.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const voucherNumber = await nextVoucherNumber(type, attempt);
    try {
      const [voucher] = await db
        .insert(vouchersTable)
        .values({
          voucherNumber,
          type,
          date,
          creditAccountId: creditAccountId.toString(),
          debitAccountId: debitAccountId.toString(),
          amount: amount.toString(),
          particular,
          remark,
          performedBy,
          reference,
          narration,
          billId: billId ? Number(billId) : null,
        })
        .returning();
      res.status(201).json({ ...voucher, amount: Number(voucher.amount) });
      return;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastErr = err;
    }
  }
  apiError(res, 409, "Could not allocate a unique voucher number, please retry");
  void lastErr;
});

// Edit voucher with audit trail
router.patch("/vouchers/:id", async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const { editedBy, reason, date, amount, particular, remark, performedBy, reference, narration, creditAccountId, debitAccountId } = req.body;

  if (!editedBy || !reason) {
    res.status(400).json({ error: "editedBy and reason are required" });
    return;
  }

  const [existing] = await db.select().from(vouchersTable).where(eq(vouchersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Voucher not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  const auditRows: { voucherId: number; voucherNumber: string; editedBy: string; reason: string; changeType: string; oldValue: string | null; newValue: string | null }[] = [];

  if (date !== undefined && date !== existing.date) {
    updates.date = date;
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "date", oldValue: existing.date, newValue: date });
  }
  if (amount !== undefined && String(amount) !== existing.amount) {
    updates.amount = String(amount);
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "amount", oldValue: existing.amount, newValue: String(amount) });
  }
  if (particular !== undefined && particular !== existing.particular) {
    updates.particular = particular;
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "particular", oldValue: existing.particular, newValue: particular });
  }
  if (remark !== undefined && remark !== existing.remark) {
    updates.remark = remark;
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "remark", oldValue: existing.remark, newValue: remark });
  }
  if (performedBy !== undefined && performedBy !== existing.performedBy) {
    updates.performedBy = performedBy;
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "performedBy", oldValue: existing.performedBy, newValue: performedBy });
  }
  if (reference !== undefined && reference !== existing.reference) {
    updates.reference = reference;
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "reference", oldValue: existing.reference, newValue: reference });
  }
  if (narration !== undefined && narration !== existing.narration) {
    updates.narration = narration;
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "narration", oldValue: existing.narration, newValue: narration });
  }
  if (creditAccountId !== undefined && String(creditAccountId) !== existing.creditAccountId) {
    updates.creditAccountId = String(creditAccountId);
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "creditAccount", oldValue: existing.creditAccountId, newValue: String(creditAccountId) });
  }
  if (debitAccountId !== undefined && String(debitAccountId) !== existing.debitAccountId) {
    updates.debitAccountId = String(debitAccountId);
    auditRows.push({ voucherId: id, voucherNumber: existing.voucherNumber, editedBy, reason, changeType: "debitAccount", oldValue: existing.debitAccountId, newValue: String(debitAccountId) });
  }

  if (Object.keys(updates).length === 0) {
    res.json({ ...existing, amount: Number(existing.amount) });
    return;
  }

  const [updated] = await db.update(vouchersTable).set(updates).where(eq(vouchersTable.id, id)).returning();
  if (auditRows.length > 0) {
    await db.insert(voucherAuditsTable).values(auditRows);
  }

  res.json({ ...updated, amount: Number(updated.amount) });
  return;
});

router.delete("/vouchers/:id", async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  // Audit gap fix: a bare hard-delete let any receipt/payment voucher vanish
  // with no trace, while PATCH requires reason + audits every field.
  // Now: reason is mandatory; auto-generated (bill/payment-linked) vouchers
  // are NOT deletable (correct them at source, or void via a reversing entry);
  // and every deletion writes a tamper-evident audit row.
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 5) {
    res.status(400).json({ error: "A reason (min 5 chars) is required to delete a voucher" });
    return;
  }

  const [existing] = await db.select().from(vouchersTable).where(eq(vouchersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Voucher not found" }); return; }

  if (existing.paymentId != null || existing.billId != null) {
    res.status(409).json({
      error: "This voucher is auto-generated from a bill/payment and cannot be deleted. Reverse it via a compensating entry or correct the source payment.",
    });
    return;
  }

  const session = (req as StaffAuthRequest).staffSession;
  await db.insert(voucherAuditsTable).values({
    voucherId: id,
    voucherNumber: existing.voucherNumber,
    editedBy: session?.subjectName ?? "admin",
    reason,
    changeType: "deleted",
    oldValue: JSON.stringify({ type: existing.type, amount: existing.amount, date: existing.date, particular: existing.particular, reference: existing.reference }),
    newValue: null,
  });
  await db.delete(vouchersTable).where(eq(vouchersTable.id, id));

  await auditFromRequest(req, {
    userId: session?.subjectId ?? null,
    userName: session?.subjectName ?? "admin",
    role: session?.role ?? "admin",
    action: "delete",
    module: "accounting",
    entityType: "voucher",
    entityId: String(id),
    oldValue: JSON.stringify({ voucherNumber: existing.voucherNumber, amount: existing.amount }),
    reason,
  });

  res.json({ ok: true });
  return;
});

// Get audit history for a specific voucher
router.get("/vouchers/:id/audits", async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const audits = await db.select().from(voucherAuditsTable).where(eq(voucherAuditsTable.voucherId, id)).orderBy(desc(voucherAuditsTable.createdAt));
  res.json(audits);
  return;
});

// System report: all voucher edits
router.get("/voucher-audits", async (req, res) => {
  const { from, to, editedBy, voucherNumber } = req.query as Record<string, string>;
  let query = db.select().from(voucherAuditsTable).$dynamic();
  const conditions = [];
  if (from) conditions.push(gte(voucherAuditsTable.createdAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(voucherAuditsTable.createdAt, toDate));
  }
  if (editedBy) conditions.push(like(voucherAuditsTable.editedBy, `%${editedBy}%`));
  if (voucherNumber) conditions.push(like(voucherAuditsTable.voucherNumber, `%${voucherNumber}%`));
  if (conditions.length) query = query.where(and(...conditions));
  const rows = await query.orderBy(desc(voucherAuditsTable.createdAt));
  res.json(rows);
  return;
});

// ─── Ledger ──────────────────────────────────────────────────────────────────

router.get("/ledger", async (req, res) => {
  const { accountId, from, to } = req.query as Record<string, string>;

  const allAccounts = await db.select().from(accountsTable);
  const allVouchers = await db.select().from(vouchersTable).orderBy(vouchersTable.date, vouchersTable.createdAt);

  const ledger = allAccounts.map((account) => {
    const accIdStr = account.id.toString();
    const openBal = Number(account.openingBalance || 0);
    const openType = account.openingBalanceType || "Dr";
    let dr = openType === "Dr" ? openBal : 0;
    let cr = openType === "Cr" ? openBal : 0;
    let runningBalance = openType === "Dr" ? openBal : -openBal;

    const entries: {
      date: string; particular: string; dr: number; cr: number; balance: number; voucherNumber: string;
    }[] = [];

    if (openBal > 0) {
      entries.push({
        date: "Opening",
        particular: "Opening Balance",
        voucherNumber: "OB",
        dr: openType === "Dr" ? openBal : 0,
        cr: openType === "Cr" ? openBal : 0,
        balance: runningBalance,
      });
    }

    for (const v of allVouchers) {
      const afterFrom = !from || v.date >= from;
      const beforeTo = !to || v.date <= to;
      if (accountId && accountId !== accIdStr) continue;
      if (!afterFrom || !beforeTo) continue;

      const amt = Number(v.amount);
      const isDebit = v.debitAccountId === accIdStr;
      const isCredit = v.creditAccountId === accIdStr;

      if (!isDebit && !isCredit) continue;

      if (isDebit) { dr += amt; runningBalance += amt; }
      if (isCredit) { cr += amt; runningBalance -= amt; }

      entries.push({
        date: v.date,
        particular: v.particular,
        voucherNumber: v.voucherNumber,
        dr: isDebit ? amt : 0,
        cr: isCredit ? amt : 0,
        balance: runningBalance,
      });
    }

    return { account: { ...account, openingBalance: Number(account.openingBalance || 0) }, dr, cr, balance: dr - cr, entries };
  });

  const filtered = accountId ? ledger.filter(l => l.account.id.toString() === accountId) : ledger;
  res.json(filtered);
  return;
});

// ─── Trial Balance ────────────────────────────────────────────────────────────

router.get("/trial-balance", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  // SQL-level aggregation using numeric type — no JS float accumulation,
  // no full-table load into Node memory. Handles any number of vouchers
  // without precision drift or memory pressure (Fix M4).
  const allAccounts = await db.select().from(accountsTable);

  // Build per-account DR and CR totals directly in Postgres
  const aggRows = await db.execute<{
    debit_account_id:  string;
    credit_account_id: string;
    total_dr:          string;
    total_cr:          string;
  }>(sql`
    SELECT
      debit_account_id,
      credit_account_id,
      COALESCE(SUM(CASE WHEN debit_account_id  IS NOT NULL THEN amount::numeric ELSE 0 END), 0)::text AS total_dr,
      COALESCE(SUM(CASE WHEN credit_account_id IS NOT NULL THEN amount::numeric ELSE 0 END), 0)::text AS total_cr
    FROM vouchers
    WHERE 1=1
      ${from ? sql`AND date >= ${from}` : sql``}
      ${to   ? sql`AND date <= ${to}`   : sql``}
    GROUP BY debit_account_id, credit_account_id
  `);

  // Build a per-account-id map from the SQL result
  const drMap = mapFromAgg(aggRows.rows, "dr");
  const crMap = mapFromAgg(aggRows.rows, "cr");

  // Pure builder (see lib/accounting/reportBuilders.ts) — unit-tested without a DB.
  res.json(buildTrialBalance(allAccounts, drMap, crMap, TALLY_PARENT));
  return;
});

// Fold the grouped debit/credit aggregation rows into a per-account-id map.
// Shared by trial-balance, profit-loss and balance-sheet so all three feed the
// pure report builders from an identical shape.
function mapFromAgg(
  rows: { debit_account_id: string; credit_account_id: string; total_dr: string; total_cr: string }[] | undefined,
  which: "dr" | "cr",
): AmountMap {
  const map: AmountMap = new Map();
  for (const row of rows ?? []) {
    if (which === "dr" && row.debit_account_id) {
      map.set(row.debit_account_id, (map.get(row.debit_account_id) ?? 0) + Number(row.total_dr ?? 0));
    }
    if (which === "cr" && row.credit_account_id) {
      map.set(row.credit_account_id, (map.get(row.credit_account_id) ?? 0) + Number(row.total_cr ?? 0));
    }
  }
  return map;
}

// ─── Profit & Loss ────────────────────────────────────────────────────────────

router.get("/profit-loss", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  // SQL aggregation — same approach as trial-balance (fixed M4).
  // Eliminates the full-table O(N) JS loop and JS float accumulation.
  const allAccounts = await db.select().from(accountsTable);

  const aggRows = await db.execute<{
    debit_account_id:  string;
    credit_account_id: string;
    total_dr:          string;
    total_cr:          string;
  }>(sql`
    SELECT
      debit_account_id,
      credit_account_id,
      COALESCE(SUM(CASE WHEN debit_account_id  IS NOT NULL THEN amount::numeric ELSE 0 END), 0)::text AS total_dr,
      COALESCE(SUM(CASE WHEN credit_account_id IS NOT NULL THEN amount::numeric ELSE 0 END), 0)::text AS total_cr
    FROM vouchers
    WHERE 1=1
      ${from ? sql`AND date >= ${from}` : sql``}
      ${to   ? sql`AND date <= ${to}`   : sql``}
    GROUP BY debit_account_id, credit_account_id
  `);

  const drMap = mapFromAgg(aggRows.rows, "dr");
  const crMap = mapFromAgg(aggRows.rows, "cr");

  res.json(buildProfitLoss(allAccounts, drMap, crMap));
  return;
});

// ─── Balance Sheet ─────────────────────────────────────────────────────────────

router.get("/balance-sheet", async (req, res) => {
  const { asOf } = req.query as Record<string, string>;

  // SQL aggregation — eliminates O(N) JS loop and float drift.
  const allAccounts = await db.select().from(accountsTable);

  const aggRowsBS = await db.execute<{
    debit_account_id:  string;
    credit_account_id: string;
    total_dr:          string;
    total_cr:          string;
  }>(sql`
    SELECT
      debit_account_id,
      credit_account_id,
      COALESCE(SUM(CASE WHEN debit_account_id  IS NOT NULL THEN amount::numeric ELSE 0 END), 0)::text AS total_dr,
      COALESCE(SUM(CASE WHEN credit_account_id IS NOT NULL THEN amount::numeric ELSE 0 END), 0)::text AS total_cr
    FROM vouchers
    WHERE 1=1
      ${asOf ? sql`AND date <= ${asOf}` : sql``}
    GROUP BY debit_account_id, credit_account_id
  `);

  const drMapBS = mapFromAgg(aggRowsBS.rows, "dr");
  const crMapBS = mapFromAgg(aggRowsBS.rows, "cr");

  // Pure builder (see lib/accounting/reportBuilders.ts). Places every non-P&L
  // account by the SIGN of its closing balance, so the sheet balances for any
  // sequence of balanced vouchers — the previous "Difference" bug (silently
  // dropping abnormal-sign / unmapped accounts) can no longer occur.
  res.json(buildBalanceSheet(allAccounts, drMapBS, crMapBS));
  return;
});

// ─── Tally XML Export ─────────────────────────────────────────────────────────

router.get("/export/tally", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  const accounts = await db.select().from(accountsTable);
  let voucherQuery = db.select().from(vouchersTable).$dynamic();
  const conditions = [];
  if (from) conditions.push(gte(vouchersTable.date, from));
  if (to) conditions.push(lte(vouchersTable.date, to));
  if (conditions.length) voucherQuery = voucherQuery.where(and(...conditions));
  const vouchers = await voucherQuery.orderBy(vouchersTable.date);

  const accountMap = new Map(accounts.map(a => [a.id.toString(), a.name]));

  const masterXml = accounts
    .map(a => {
      const parent = a.tallyGroup || (
        a.type === "cash" ? "Cash-in-Hand" :
        a.type === "bank" ? "Bank Accounts" :
        a.type === "income" ? "Direct Income" :
        a.type === "expense" ? "Indirect Expenses" :
        a.type === "liability" ? "Current Liabilities" :
        "Current Assets"
      );
      const openBal = Number(a.openingBalance || 0);
      const openType = a.openingBalanceType || "Dr";
      const openBalXml = openBal > 0
        ? `\n    <OPENINGBALANCE>${openType === "Dr" ? openBal.toFixed(2) : (-openBal).toFixed(2)}</OPENINGBALANCE>`
        : "";
      const gstXml = a.gstNumber
        ? `\n    <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n    <TAXREGISTRATIONNO>${a.gstNumber}</TAXREGISTRATIONNO>`
        : "";
      const panXml = a.pan ? `\n    <INCOMETAXNUMBER>${a.pan}</INCOMETAXNUMBER>` : "";

      return `  <LEDGER NAME="${escapeXml(a.name)}" RESERVEDNAME="">
    <PARENT>${escapeXml(parent)}</PARENT>
    <CATEGORY>Primary</CATEGORY>
    <ISBILLWISEON>No</ISBILLWISEON>
    <ISACTIVE>${a.isActive ? "Yes" : "No"}</ISACTIVE>${openBalXml}${gstXml}${panXml}
    <LEDGERCODE>${a.code || ""}</LEDGERCODE>
    <NAME>${escapeXml(a.name)}</NAME>
  </LEDGER>`;
    })
    .join("\n");

  const voucherXml = vouchers
    .map(v => {
      const drName = accountMap.get(v.debitAccountId) || v.debitAccountId;
      const crName = accountMap.get(v.creditAccountId) || v.creditAccountId;
      const amt = Number(v.amount);
      const dateStr = v.date.replace(/-/g, "");
      const tallyType = TALLY_VOUCHER_TYPE[v.type] || "Journal";
      const narration = v.narration || v.particular + (v.remark ? " - " + v.remark : "");
      const refXml = v.reference ? `\n    <BILLALLOCATIONS.LIST>\n      <NAME>${escapeXml(v.reference)}</NAME>\n      <BILLTYPE>On Account</BILLTYPE>\n      <AMOUNT>-${amt.toFixed(2)}</AMOUNT>\n    </BILLALLOCATIONS.LIST>` : "";

      return `  <VOUCHER VCHTYPE="${tallyType}" ACTION="Create">
    <DATE>${dateStr}</DATE>
    <VOUCHERNUMBER>${escapeXml(v.voucherNumber)}</VOUCHERNUMBER>
    <REFERENCE>${escapeXml(v.reference || "")}</REFERENCE>
    <NARRATION>${escapeXml(narration)}</NARRATION>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(drName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-${amt.toFixed(2)}</AMOUNT>${refXml}
    </ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(crName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt.toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>`;
    })
    .join("\n");

  const dateRange = from && to
    ? `<!-- Date Range: ${from} to ${to} -->`
    : `<!-- All dates -->`;

  const xml = `﻿<?xml version="1.0" encoding="UTF-8"?>
${dateRange}
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>All Masters</ID>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY></SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
${masterXml}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  const filename = `tally-masters${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}.xml`;
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(xml);

  void auditFromRequest(req, {
    userId: null,
    userName: "staff",
    role: "staff",
    action: "export",
    module: "accounting",
    entityType: "tally_masters",
    entityId: filename,
    reason: `Tally XML masters export: ${accounts.length} accounts, ${vouchers.length} vouchers, range=${from ?? "all"} to ${to ?? "all"}`,
  });
  return;
});

// ─── Tally XML Voucher Export ────────────────────────────────────────────────

router.get("/export/tally-vouchers", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  const accounts = await db.select().from(accountsTable);
  let voucherQuery = db.select().from(vouchersTable).$dynamic();
  const conditions = [];
  if (from) conditions.push(gte(vouchersTable.date, from));
  if (to) conditions.push(lte(vouchersTable.date, to));
  if (conditions.length) voucherQuery = voucherQuery.where(and(...conditions));
  const vouchers = await voucherQuery.orderBy(vouchersTable.date);

  const accountMap = new Map(accounts.map(a => [a.id.toString(), a.name]));

  const voucherXml = vouchers
    .map(v => {
      const drName = accountMap.get(v.debitAccountId) || v.debitAccountId;
      const crName = accountMap.get(v.creditAccountId) || v.creditAccountId;
      const amt = Number(v.amount);
      const dateStr = v.date.replace(/-/g, "");
      const tallyType = TALLY_VOUCHER_TYPE[v.type] || "Journal";
      const narration = v.narration || v.particular + (v.remark ? " - " + v.remark : "");
      const refXml = v.reference ? `
    <BILLALLOCATIONS.LIST>
      <NAME>${escapeXml(v.reference)}</NAME>
      <BILLTYPE>On Account</BILLTYPE>
      <AMOUNT>${amt.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>` : "";

      return `  <VOUCHER VCHTYPE="${tallyType}" ACTION="Create">
    <DATE>${dateStr}</DATE>
    <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
    <VOUCHERTYPENAME>${tallyType}</VOUCHERTYPENAME>
    <PARENT>${tallyType}</PARENT>
    <VOUCHERNUMBER>${escapeXml(v.voucherNumber)}</VOUCHERNUMBER>
    <NARRATION>${escapeXml(narration)}</NARRATION>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(drName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-${amt.toFixed(2)}</AMOUNT>${refXml}
    </ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(crName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt.toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>`;
    })
    .join("\n");

  const dateRange = from && to
    ? `<!-- Date Range: ${from} to ${to} -->`
    : `<!-- All dates -->`;

  const xml = `﻿<?xml version="1.0" encoding="UTF-8"?>
${dateRange}
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY></SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
${voucherXml}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  const filename2 = `tally-vouchers${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}.xml`;
  res.setHeader("Content-Disposition", `attachment; filename=${filename2}`);
  res.send(xml);

  void auditFromRequest(req, {
    userId: null,
    userName: "staff",
    role: "staff",
    action: "export",
    module: "accounting",
    entityType: "tally_vouchers",
    entityId: filename2,
    reason: `Tally XML vouchers export: ${vouchers.length} vouchers, range=${from ?? "all"} to ${to ?? "all"}`,
  });
  return;
});

// ─── Tally.ERP 9 XML Export ──────────────────────────────────────────────────

router.get("/export/tally-erp9", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  const accounts = await db.select().from(accountsTable);

  const masterXml = accounts
    .map(a => {
      const parent = a.tallyGroup || (
        a.type === "cash" ? "Cash-in-Hand" :
        a.type === "bank" ? "Bank Accounts" :
        a.type === "income" ? "Direct Income" :
        a.type === "expense" ? "Indirect Expenses" :
        a.type === "liability" ? "Current Liabilities" :
        "Current Assets"
      );
      const openBal = Number(a.openingBalance || 0);
      const openType = a.openingBalanceType || "Dr";
      const openBalXml = openBal > 0
        ? `\n    <OPENINGBALANCE>${openType === "Dr" ? openBal.toFixed(2) : (-openBal).toFixed(2)}</OPENINGBALANCE>`
        : "";
      const gstXml = a.gstNumber
        ? `\n    <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n    <TAXREGISTRATIONNO>${a.gstNumber}</TAXREGISTRATIONNO>`
        : "";
      const panXml = a.pan ? `\n    <INCOMETAXNUMBER>${a.pan}</INCOMETAXNUMBER>` : "";

      return `  <LEDGER NAME="${escapeXml(a.name)}" RESERVEDNAME="">
    <PARENT>${escapeXml(parent)}</PARENT>
    <ISBILLWISEON>No</ISBILLWISEON>
    <ISACTIVE>${a.isActive ? "Yes" : "No"}</ISACTIVE>${openBalXml}${gstXml}${panXml}
    <LEDGERCODE>${a.code || ""}</LEDGERCODE>
  </LEDGER>`;
    })
    .join("\n");

  const dateRange = from && to
    ? `<!-- Date Range: ${from} to ${to} -->`
    : `<!-- All dates -->`;

  const xml = `﻿<?xml version="1.0" encoding="UTF-8"?>
${dateRange}
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY></SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
${masterXml}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  const filename3 = `tally-erp9-masters${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}.xml`;
  res.setHeader("Content-Disposition", `attachment; filename=${filename3}`);
  res.send(xml);

  void auditFromRequest(req, {
    userId: null,
    userName: "staff",
    role: "staff",
    action: "export",
    module: "accounting",
    entityType: "tally_erp9_masters",
    entityId: filename3,
    reason: `Tally.ERP9 masters export: ${accounts.length} accounts, range=${from ?? "all"} to ${to ?? "all"}`,
  });
  return;
});

router.get("/export/tally-erp9-vouchers", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  const accounts = await db.select().from(accountsTable);
  let voucherQuery = db.select().from(vouchersTable).$dynamic();
  const conditions = [];
  if (from) conditions.push(gte(vouchersTable.date, from));
  if (to) conditions.push(lte(vouchersTable.date, to));
  if (conditions.length) voucherQuery = voucherQuery.where(and(...conditions));
  const vouchers = await voucherQuery.orderBy(vouchersTable.date);

  const accountMap = new Map(accounts.map(a => [a.id.toString(), a.name]));

  const voucherXml = vouchers
    .map(v => {
      const drName = accountMap.get(v.debitAccountId) || v.debitAccountId;
      const crName = accountMap.get(v.creditAccountId) || v.creditAccountId;
      const amt = Number(v.amount);
      const dateStr = v.date.replace(/-/g, "");
      const tallyType = TALLY_VOUCHER_TYPE[v.type] || "Journal";
      const narration = v.narration || v.particular + (v.remark ? " - " + v.remark : "");

      return `  <VOUCHER VCHTYPE="${tallyType}" ACTION="Create">
    <DATE>${dateStr}</DATE>
    <VOUCHERNUMBER>${escapeXml(v.voucherNumber)}</VOUCHERNUMBER>
    <NARRATION>${escapeXml(narration)}</NARRATION>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(drName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-${amt.toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(crName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt.toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>`;
    })
    .join("\n");

  const dateRange = from && to
    ? `<!-- Date Range: ${from} to ${to} -->`
    : `<!-- All dates -->`;

  const xml = `﻿<?xml version="1.0" encoding="UTF-8"?>
${dateRange}
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY></SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
${voucherXml}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  const filename4 = `tally-erp9-vouchers${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}.xml`;
  res.setHeader("Content-Disposition", `attachment; filename=${filename4}`);
  res.send(xml);

  void auditFromRequest(req, {
    userId: null,
    userName: "staff",
    role: "staff",
    action: "export",
    module: "accounting",
    entityType: "tally_erp9_vouchers",
    entityId: filename4,
    reason: `Tally.ERP9 vouchers export: ${vouchers.length} vouchers, range=${from ?? "all"} to ${to ?? "all"}`,
  });
  return;
});

// ─── Setup Default Chart of Accounts ─────────────────────────────────────────

router.post("/setup-defaults", async (req, res) => {
  const existing = await db.select().from(accountsTable);
  if (existing.length > 0) {
    return res.json({ message: "Accounts already exist", count: existing.length, accounts: existing });
  }

  const defaults = [
    { name: "Cash in Hand",                 type: "cash",      code: "CASH-001", tallyGroup: "Cash-in-Hand",        isActive: true },
    { name: "Bank Account",                 type: "bank",      code: "BANK-001", tallyGroup: "Bank Accounts",       isActive: true },
    { name: "Lab Revenue",                  type: "income",    code: "INC-001",  tallyGroup: "Direct Income",       isActive: true },
    { name: "Consultation Revenue",         type: "income",    code: "INC-002",  tallyGroup: "Direct Income",       isActive: true },
    { name: "Staff Salaries",               type: "expense",   code: "EXP-001",  tallyGroup: "Indirect Expenses",   isActive: true },
    { name: "Lab Supplies & Reagents",      type: "expense",   code: "EXP-002",  tallyGroup: "Direct Expenses",     isActive: true },
    { name: "Equipment Maintenance",        type: "expense",   code: "EXP-003",  tallyGroup: "Indirect Expenses",   isActive: true },
    { name: "Rent Expenses",                type: "expense",   code: "EXP-004",  tallyGroup: "Indirect Expenses",   isActive: true },
    { name: "Utilities (Electricity/Water)",type: "expense",   code: "EXP-005",  tallyGroup: "Indirect Expenses",   isActive: true },
    { name: "Sundry Debtors",               type: "asset",     code: "ASSET-001",tallyGroup: "Sundry Debtors",      isActive: true },
    { name: "Fixed Assets",                 type: "asset",     code: "ASSET-002",tallyGroup: "Fixed Assets",        isActive: true },
    { name: "Capital Account",              type: "liability", code: "CAP-001",  tallyGroup: "Capital Account",     isActive: true },
    { name: "Sundry Creditors",             type: "liability", code: "LIA-001",  tallyGroup: "Sundry Creditors",    isActive: true },
    { name: "Duties & Taxes",               type: "liability", code: "LIA-002",  tallyGroup: "Duties & Taxes",      isActive: true },
  ];

  const inserted = await db.insert(accountsTable).values(defaults).returning();
  return res.json({ message: "Default accounts created", count: inserted.length, accounts: inserted });
});

// ─── Sync Billing Payments → Receipt Vouchers ─────────────────────────────────

// ─── F1: settlement reconciliation — duplicate suspects + supersession ───────
//
// Historical double-posts (same gateway payment recorded by two settle paths
// under different reference keys) are NEVER deleted. This report surfaces
// suspects; the supersede action voids the duplicate reversibly: marks it
// superseded in favor of the surviving payment, restores the bill's paid/
// balance, and posts a reversal voucher through the existing auto-voucher
// engine (negative-amount path) — books stay consistent and traceable.

router.get("/duplicate-payment-suspects", requireAdminRole, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 90) || 90, 1), 730);
  const suspects = await db.execute<{
    bill_id: number; bill_number: string; patient_name: string;
    payment_a: number; ref_a: string; gateway_txn_a: string | null; created_a: string;
    payment_b: number; ref_b: string; gateway_txn_b: string | null; created_b: string;
    amount: string;
  }>(sql`
    SELECT a.bill_id,
           b2.bill_number,
           COALESCE(pt.first_name || ' ' || pt.last_name, '') AS patient_name,
           a.id AS payment_a, a.reference_number AS ref_a, a.gateway_txn_id AS gateway_txn_a, a.created_at::text AS created_a,
           b.id AS payment_b, b.reference_number AS ref_b, b.gateway_txn_id AS gateway_txn_b, b.created_at::text AS created_b,
           a.amount::text AS amount
    FROM payments a
    JOIN payments b
      ON b.bill_id = a.bill_id
     AND b.id > a.id
     AND b.amount = a.amount
     AND ABS(EXTRACT(EPOCH FROM (b.created_at - a.created_at))) <= 900
     AND COALESCE(b.reference_number, '') <> COALESCE(a.reference_number, '')
    JOIN bills b2 ON b2.id = a.bill_id
    LEFT JOIN patients pt ON pt.id = b2.patient_id
    WHERE a.method ILIKE 'online%'
      AND b.method ILIKE 'online%'
      AND COALESCE(a.settlement_status, '') <> 'superseded'
      AND COALESCE(b.settlement_status, '') <> 'superseded'
      AND a.amount > 0 AND b.amount > 0
      AND a.created_at >= NOW() - make_interval(days => ${days})
    ORDER BY a.created_at DESC
    LIMIT 200
  `);
  res.json({ suspects: suspects.rows ?? [], days });
});

router.post("/payments/:id/supersede", requireAdminRole, async (req, res) => {
  const duplicateId = Number(req.params.id);
  const parsed = z.object({
    duplicateOfPaymentId: z.number().int().positive(),
    reason: z.string().min(5).max(1000),
  }).safeParse(req.body ?? {});
  if (!Number.isInteger(duplicateId) || duplicateId <= 0 || !parsed.success) {
    return apiError(res, 400, "duplicateOfPaymentId and a reason (min 5 chars) are required");
  }
  const { duplicateOfPaymentId: survivorId, reason } = parsed.data;
  if (survivorId === duplicateId) return apiError(res, 400, "A payment cannot supersede itself");

  const session = (req as StaffAuthRequest).staffSession;
  try {
    const outcome = await db.transaction(async (tx) => {
      const [dup] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, duplicateId)).limit(1);
      const [survivor] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, survivorId)).limit(1);
      if (!dup || !survivor) return { error: "Payment not found" };
      if (dup.billId !== survivor.billId) return { error: "Payments belong to different bills" };
      if (Number(dup.amount) !== Number(survivor.amount)) return { error: "Payments differ in amount — not a duplicate pair" };
      if (dup.settlementStatus === "superseded" || dup.supersededBy != null) return { error: "Payment is already superseded" };
      if (survivor.settlementStatus === "superseded") return { error: "The surviving payment is itself superseded" };
      if (!String(dup.method).toLowerCase().startsWith("online")) return { error: "Only online gateway payments can be superseded here" };

      const [bill] = await tx.select().from(billsTable).where(eq(billsTable.id, dup.billId)).for("update").limit(1);
      if (!bill) return { error: "Bill not found" };

      await tx.update(paymentsTable)
        .set({ settlementStatus: "superseded", supersededBy: survivorId })
        .where(eq(paymentsTable.id, duplicateId));

      const amount = Number(dup.amount);
      const newPaid = Math.max(0, Number(bill.paidAmount) - amount);
      const refund = Number(bill.refundAmount ?? 0);
      const newBalance = Math.max(0, Number(bill.totalAmount) - newPaid - refund);
      const newStatus = newBalance <= 0.01 ? "paid" : newPaid > 0 ? "partial" : "pending";
      await tx.update(billsTable)
        .set({ paidAmount: newPaid.toFixed(2), balanceAmount: newBalance.toFixed(2), status: newStatus, updatedAt: new Date() })
        .where(eq(billsTable.id, bill.id));

      return { bill, amount, method: dup.method };
    });

    if ("error" in outcome && outcome.error) return apiError(res, 409, outcome.error);
    const ok = outcome as { bill: typeof billsTable.$inferSelect; amount: number; method: string };

    // Reversal voucher through the existing auto-voucher engine (negative
    // amount = payment-voucher reversal: debit revenue, credit method acct).
    await autoVoucherForPayment({
      billId: ok.bill.id,
      amount: -ok.amount,
      method: ok.method,
      billNumber: ok.bill.billNumber,
      performedBy: session?.subjectName ?? "admin",
    });

    await auditFromRequest(req, {
      userId: session?.subjectId ?? null,
      userName: session?.subjectName ?? "admin",
      role: session?.role ?? "admin",
      action: "void",
      module: "accounting",
      entityType: "payment",
      entityId: String(duplicateId),
      newValue: JSON.stringify({ supersededBy: survivorId, amount: ok.amount }),
      reason,
    });

    return res.json({ ok: true, supersededPaymentId: duplicateId, survivingPaymentId: survivorId });
  } catch (err) {
    console.error("[accounting] supersede failed:", err);
    return apiError(res, 500, "Supersession failed — no changes were committed");
  }
});

// POST /api/accounting/sync-billing  (admin only; F2)
//
// Backfills receipt vouchers for payments that were never vouchered at
// capture time. F2 hardening:
//   - admin-gated and no longer auto-run on the Accounting page; the UI calls
//     it as an explicit action, defaulting to a DRY RUN (body/query dryRun)
//     that reports what WOULD be created without writing;
//   - only POSITIVE, non-superseded payments (refunds/reversals have their own
//     'payment'-type vouchers — this used to post negative "receipt" vouchers
//     for them);
//   - dedup that recognises BOTH capture-time vouchers linked by payment_id
//     AND legacy real-time vouchers (matched per bill by receipt amount), so
//     it never re-vouchers an already-vouchered payment (the desk doubling);
//   - IST payment date and the created voucher is linked via payment_id.
router.post("/sync-billing", requireAdminRole, async (req, res) => {
  const dryRun = req.body?.dryRun === true || req.query?.dryRun === "true";

  const allAccounts = await db.select().from(accountsTable);
  const cashAcc  = allAccounts.find(a => a.tallyGroup === "Cash-in-Hand" || a.type === "cash");
  const bankAcc  = allAccounts.find(a => a.tallyGroup === "Bank Accounts" || a.type === "bank");
  const revAcc   = allAccounts.find(a => a.tallyGroup === "Direct Income"  || a.type === "income");

  if (!cashAcc || !revAcc) {
    return res.status(400).json({ error: "Required accounts (cash, income) not found. Run setup-defaults first." });
  }

  const payments = await db.select({ p: paymentsTable, b: billsTable })
    .from(paymentsTable)
    .leftJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
    .orderBy(paymentsTable.id);

  // Existing vouchers → two dedup indexes: exact by payment_id, and a
  // consumable per-bill receipt multiset keyed by amount (catches legacy
  // real-time vouchers that predate payment_id linkage).
  const vouchers = await db.select({
    paymentId: vouchersTable.paymentId,
    billId: vouchersTable.billId,
    amount: vouchersTable.amount,
    type: vouchersTable.type,
  }).from(vouchersTable);

  const vouchedPaymentIds = new Set<number>();
  const receiptPool = new Map<string, number>(); // key `${billId}|${amount}` → count
  const amt = (v: string | number | null) => Number(v ?? 0).toFixed(2);
  for (const v of vouchers) {
    if (v.paymentId != null) vouchedPaymentIds.add(v.paymentId);
    // paymentId == null here is required, not incidental: a payment_id-linked
    // voucher is already accounted for via vouchedPaymentIds above. Without this
    // filter it was ALSO added to the pool, so it could consume the pool slot
    // meant for a DIFFERENT, genuinely unvouchered payment on the same bill for
    // the same amount — e.g. two ₹500 instalments on one bill, one already
    // vouchered: the linked voucher's own skip plus its pool entry meant the
    // second, real gap was silently swallowed and never backfilled. The pool
    // exists ONLY to catch legacy real-time vouchers that predate payment_id
    // linkage, per the comment above.
    if (v.type === "receipt" && v.billId != null && v.paymentId == null) {
      const key = `${v.billId}|${amt(v.amount)}`;
      receiptPool.set(key, (receiptPool.get(key) ?? 0) + 1);
    }
  }

  const prefix = "RV";
  const monthCounts = new Map<string, number>();
  const toCreate: Array<{ paymentId: number; billId: number | null; amount: string; date: string; method: string; billNumber: string }> = [];

  for (const { p, b } of payments) {
    if (Number(p.amount) <= 0) continue;                    // refunds/reversals not synced here
    if (p.settlementStatus === "superseded") continue;      // F1 voided duplicate
    if (vouchedPaymentIds.has(p.id)) continue;              // capture-time voucher exists

    // Legacy real-time voucher on the same bill for the same amount → consume it.
    const poolKey = `${p.billId}|${amt(p.amount)}`;
    const pooled = receiptPool.get(poolKey) ?? 0;
    if (pooled > 0) { receiptPool.set(poolKey, pooled - 1); continue; }

    const dateStr = dateToISTString(p.createdAt);
    toCreate.push({
      paymentId: p.id,
      billId: p.billId,
      amount: amt(p.amount),
      date: dateStr,
      method: (p.method || "cash").toLowerCase(),
      billNumber: (b as { billNumber?: string } | null)?.billNumber ?? `Bill #${p.billId}`,
    });
  }

  if (dryRun) {
    return res.json({
      dryRun: true,
      wouldCreate: toCreate.length,
      preview: toCreate.slice(0, 100),
      message: `${toCreate.length} payment(s) would be vouchered. Nothing was written.`,
    });
  }

  let created = 0;
  for (const item of toCreate) {
    const isBankMethod = ["upi", "card", "credit_card", "debit_card", "neft", "rtgs", "imps", "bank_transfer", "cheque"].includes(item.method) || item.method.startsWith("online");
    const debitAcc = isBankMethod && bankAcc ? bankAcc : cashAcc;
    const monthKey = item.date.slice(0, 7).replace("-", "");
    if (!monthCounts.has(monthKey)) {
      // Seed from the highest number ISSUED, not a row count — a count seed
      // trails the max wherever vouchers were deleted, so the very first insert
      // of the backfill would collide and (having no try/catch here) fail the
      // whole request with a 500, leaving the sync half-applied.
      monthCounts.set(monthKey, await maxVoucherSeq(`${prefix}-${monthKey}-`));
    }
    const seq = (monthCounts.get(monthKey) ?? 0) + 1;
    monthCounts.set(monthKey, seq);
    const voucherNumber = `${prefix}-${monthKey}-${String(seq).padStart(4, "0")}`;

    await db.insert(vouchersTable).values({
      voucherNumber,
      type:            "receipt",
      date:            item.date,
      debitAccountId:  String(debitAcc.id),
      creditAccountId: String(revAcc.id),
      amount:          item.amount,
      particular:      `Payment received — ${item.billNumber}`,
      reference:       item.billNumber,
      narration:       `${item.method.toUpperCase()} payment (sync)`,
      billId:          item.billId,
      paymentId:       item.paymentId,
      performedBy:     "System (Sync)",
    });
    created++;
  }

  const session = (req as StaffAuthRequest).staffSession;
  await auditFromRequest(req, {
    userId: session?.subjectId ?? null,
    userName: session?.subjectName ?? "admin",
    role: session?.role ?? "admin",
    action: "create",
    module: "accounting",
    entityType: "voucher",
    entityId: "sync-billing",
    newValue: JSON.stringify({ created }),
    reason: "sync-billing backfill",
  });

  return res.json({ message: `Synced ${created} new payments to accounting`, created });
});

// ── Bank Statement Import ─────────────────────────────────────────────────

// POST /api/accounting/bank-statement/parse
// Body: { text?: string } | { imageBase64: string; mimeType: string }
// Returns: { transactions: BankTransaction[] }
router.post("/bank-statement/parse", async (req, res): Promise<void> => {
  const body = req.body as {
    text?: string;
    imageBase64?: string;
    mimeType?: string;
  };

  if (!body.text && !body.imageBase64) {
    apiError(res, 400, "Provide either text (CSV/copied statement) or imageBase64+mimeType.");
    return;
  }

  const input: Parameters<typeof geminiParseBankStatement>[0] =
    body.text
      ? { text: body.text }
      : { imageBase64: body.imageBase64!, mimeType: body.mimeType! };

  try {
    const transactions = await geminiParseBankStatement(input);
    res.json({ transactions });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, "AI parsing failed: " + msg);
  }
});

// POST /api/accounting/bank-statement/import
// Body: { bankAccountId: number; contraAccountId: number; transactions: BankTransaction[] }
// Bulk-inserts vouchers for each transaction row.
const BankImportBody = z.object({
  bankAccountId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(Number),
  contraAccountId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(Number),
  transactions: z.array(z.object({
    date: z.string().min(1),
    description: z.string(),
    debit: z.number().min(0),
    credit: z.number().min(0),
    balance: z.number(),
    reference: z.string(),
    selected: z.boolean().optional(),
  })).min(1),
});

router.post("/bank-statement/import", async (req, res): Promise<void> => {
  const parsed = BankImportBody.safeParse(req.body);
  if (!parsed.success) { apiErrorFromZod(res, 400, "Invalid body", parsed.error); return; }

  const { bankAccountId, contraAccountId, transactions } = parsed.data;

  // Verify both accounts exist
  const [bankAcc, contraAcc] = await Promise.all([
    db.select().from(accountsTable).where(eq(accountsTable.id, bankAccountId)).then(r => r[0]),
    db.select().from(accountsTable).where(eq(accountsTable.id, contraAccountId)).then(r => r[0]),
  ]);
  if (!bankAcc) { apiError(res, 404, "Bank account not found"); return; }
  if (!contraAcc) { apiError(res, 404, "Contra account not found"); return; }

  // Only import selected rows (or all if selected field absent)
  const toImport = transactions.filter(t => t.selected !== false && (t.debit > 0 || t.credit > 0));
  if (toImport.length === 0) { apiError(res, 400, "No transactions selected for import"); return; }

  let created = 0;
  for (const txn of toImport) {
    const isDebit = txn.debit > 0;
    const amount = isDebit ? txn.debit : txn.credit;
    const vType = isDebit ? "payment" : "receipt";
    const prefix = isDebit ? "PV" : "RV";
    const monthKey = (txn.date || new Date().toISOString().slice(0, 7)).slice(0, 7).replace("-", "");

    // MAX of numbers issued, re-read each iteration so it already includes the
    // rows this loop just inserted. The previous form added `created` on top of a
    // freshly-re-queried count, double-advancing: from C existing rows, N imported
    // transactions took C+1, C+3, C+5, … so the count rose by N while the max rose
    // by 2N-1. That manufactured max>count drift with no deletions at all, and the
    // drift silently consumed the retry budget that protects the other generators.
    const monthMax = await maxVoucherSeq(`${prefix}-${monthKey}-`);

    const voucherNumber = `${prefix}-${monthKey}-${String(monthMax + 1).padStart(4, "0")}`;

    await db.insert(vouchersTable).values({
      voucherNumber,
      type: vType,
      date: txn.date || todayIST(),
      debitAccountId: isDebit ? String(contraAccountId) : String(bankAccountId),
      creditAccountId: isDebit ? String(bankAccountId) : String(contraAccountId),
      amount: String(amount),
      particular: txn.description || "Bank statement import",
      reference: txn.reference || null,
      narration: `Bank import — balance ₹${txn.balance.toLocaleString("en-IN")}`,
    });
    created++;
  }

  res.json({ imported: created });
});

function escapeXml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default router;

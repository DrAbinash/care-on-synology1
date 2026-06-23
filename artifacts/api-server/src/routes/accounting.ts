import { Router, type Response } from "express";
import { db, billsTable, paymentsTable, patientsTable } from "@workspace/db";
import { accountsTable, vouchersTable, voucherAuditsTable } from "@workspace/db/schema";
import { eq, desc, and, gte, lte, like, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { apiError, apiErrorFromZod } from "../lib/api-error";
import { geminiParseBankStatement, type BankTransaction } from "@workspace/integrations-gemini-ai";
import { todayIST } from "../lib/istDate";
import { auditFromRequest } from "../lib/audit";

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

// Compute the next sequence in a per-month bucket. Race-prone by itself —
// always pair with the unique-constraint retry loop in POST /vouchers below.
async function nextVoucherNumber(type: string, attemptOffset = 0): Promise<string> {
  const bucket = voucherBucket(type);
  const r = await db
    .select({ c: sql<number>`count(*)` })
    .from(vouchersTable)
    .where(like(vouchersTable.voucherNumber, `${bucket}%`));
  const next = Number(r[0]?.c ?? 0) + 1 + attemptOffset;
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
  await db.delete(vouchersTable).where(eq(vouchersTable.id, id));
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

  const allAccounts = await db.select().from(accountsTable);
  const allVouchers = await db.select().from(vouchersTable).orderBy(vouchersTable.date);

  const rows = allAccounts.map((account) => {
    const accIdStr = account.id.toString();
    const openBal = Number(account.openingBalance || 0);
    const openType = account.openingBalanceType || "Dr";
    let dr = openType === "Dr" ? openBal : 0;
    let cr = openType === "Cr" ? openBal : 0;

    for (const v of allVouchers) {
      if (from && v.date < from) continue;
      if (to && v.date > to) continue;
      const amt = Number(v.amount);
      if (v.debitAccountId === accIdStr) dr += amt;
      if (v.creditAccountId === accIdStr) cr += amt;
    }

    const balance = dr - cr;
    const tallyGroup = account.tallyGroup || account.type;
    const parent = TALLY_PARENT[tallyGroup] || account.type;

    return {
      id: account.id,
      name: account.name,
      type: account.type,
      tallyGroup,
      parent,
      dr,
      cr,
      balance,
      balanceDr: balance > 0 ? balance : 0,
      balanceCr: balance < 0 ? Math.abs(balance) : 0,
    };
  }).filter(r => r.dr > 0 || r.cr > 0);

  const totalDr = rows.reduce((s, r) => s + r.balanceDr, 0);
  const totalCr = rows.reduce((s, r) => s + r.balanceCr, 0);

  res.json({ rows, totalDr, totalCr, balanced: Math.abs(totalDr - totalCr) < 0.01 });
  return;
});

// ─── Profit & Loss ────────────────────────────────────────────────────────────

router.get("/profit-loss", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;

  const allAccounts = await db.select().from(accountsTable);
  const allVouchers = await db.select().from(vouchersTable).orderBy(vouchersTable.date);

  const compute = (account: typeof allAccounts[0]) => {
    const accIdStr = account.id.toString();
    let dr = 0, cr = 0;
    for (const v of allVouchers) {
      if (from && v.date < from) continue;
      if (to && v.date > to) continue;
      const amt = Number(v.amount);
      if (v.debitAccountId === accIdStr) dr += amt;
      if (v.creditAccountId === accIdStr) cr += amt;
    }
    return { dr, cr, balance: dr - cr };
  };

  const income: { name: string; group: string; amount: number }[] = [];
  const expenses: { name: string; group: string; amount: number }[] = [];

  for (const account of allAccounts) {
    const grp = account.tallyGroup || "";
    const isIncome = grp.includes("Income") || account.type === "income";
    const isExpense = grp.includes("Expense") || account.type === "expense";
    if (!isIncome && !isExpense) continue;

    const { dr, cr } = compute(account);
    if (isIncome) {
      const amount = cr - dr;
      if (amount !== 0) income.push({ name: account.name, group: grp || "Income", amount });
    } else {
      const amount = dr - cr;
      if (amount !== 0) expenses.push({ name: account.name, group: grp || "Expenses", amount });
    }
  }

  const totalIncome = income.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
  const netProfit = totalIncome - totalExpenses;

  res.json({ income, expenses, totalIncome, totalExpenses, netProfit });
  return;
});

// ─── Balance Sheet ─────────────────────────────────────────────────────────────

router.get("/balance-sheet", async (req, res) => {
  const { asOf } = req.query as Record<string, string>;

  const allAccounts = await db.select().from(accountsTable);
  const allVouchers = await db.select().from(vouchersTable).orderBy(vouchersTable.date);

  const compute = (account: typeof allAccounts[0]) => {
    const accIdStr = account.id.toString();
    const openBal = Number(account.openingBalance || 0);
    const openType = account.openingBalanceType || "Dr";
    let dr = openType === "Dr" ? openBal : 0;
    let cr = openType === "Cr" ? openBal : 0;

    for (const v of allVouchers) {
      if (asOf && v.date > asOf) continue;
      const amt = Number(v.amount);
      if (v.debitAccountId === accIdStr) dr += amt;
      if (v.creditAccountId === accIdStr) cr += amt;
    }
    return { dr, cr, balance: dr - cr };
  };

  const assets: { name: string; group: string; amount: number }[] = [];
  const liabilities: { name: string; group: string; amount: number }[] = [];

  let netIncomeTotal = 0;
  let netExpenseTotal = 0;

  for (const account of allAccounts) {
    const grp = account.tallyGroup || "";
    const { dr, cr } = compute(account);
    const balance = dr - cr;

    const isIncome = grp.includes("Income") || account.type === "income";
    const isExpense = grp.includes("Expense") || account.type === "expense";
    const isAsset = !isIncome && !isExpense && (grp.includes("Asset") || grp.includes("Debtors") || grp === "Cash-in-Hand" || grp === "Bank Accounts" || account.type === "asset" || account.type === "cash" || account.type === "bank");
    const isLiability = !isIncome && !isExpense && (grp.includes("Liabilities") || grp.includes("Creditors") || grp.includes("Capital") || grp.includes("Reserves") || account.type === "liability");

    if (isIncome) {
      netIncomeTotal += cr - dr;
    } else if (isExpense) {
      netExpenseTotal += dr - cr;
    } else if (balance === 0) {
      continue;
    } else if (isAsset && balance > 0) {
      assets.push({ name: account.name, group: grp || account.type, amount: balance });
    } else if (isLiability && balance < 0) {
      liabilities.push({ name: account.name, group: grp || account.type, amount: Math.abs(balance) });
    }
  }

  const netProfit = netIncomeTotal - netExpenseTotal;
  if (netProfit > 0) {
    liabilities.push({ name: "Net Profit for the Period", group: "Capital Account", amount: netProfit });
  } else if (netProfit < 0) {
    assets.push({ name: "Net Loss for the Period", group: "Capital Account", amount: Math.abs(netProfit) });
  }

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);

  res.json({ assets, liabilities, totalAssets, totalLiabilities, netProfit, balanced: Math.abs(totalAssets - totalLiabilities) < 0.01 });
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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
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

  res.setHeader("Content-Type", "application/xml");
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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
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

  res.setHeader("Content-Type", "application/xml");
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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
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

  res.setHeader("Content-Type", "application/xml");
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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
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

  res.setHeader("Content-Type", "application/xml");
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

router.post("/sync-billing", async (req, res) => {
  const allAccounts = await db.select().from(accountsTable);
  const cashAcc  = allAccounts.find(a => a.tallyGroup === "Cash-in-Hand" || a.type === "cash");
  const bankAcc  = allAccounts.find(a => a.tallyGroup === "Bank Accounts" || a.type === "bank");
  const revAcc   = allAccounts.find(a => a.tallyGroup === "Direct Income"  || a.type === "income");

  if (!cashAcc || !revAcc) {
    return res.status(400).json({ error: "Required accounts (cash, income) not found. Run setup-defaults first." });
  }

  const payments = await db.select({ p: paymentsTable, b: billsTable })
    .from(paymentsTable)
    .leftJoin(billsTable, eq(paymentsTable.billId, billsTable.id));

  const existingRefs = new Set(
    (await db.select({ ref: vouchersTable.reference }).from(vouchersTable))
      .map(v => v.ref).filter(Boolean)
  );

  let created = 0;
  for (const { p, b } of payments) {
    const ref = `PAY-${p.id}`;
    if (existingRefs.has(ref)) continue;

     const method = (p.method || "cash").toLowerCase();
    const isBankMethod = ["upi", "card", "credit_card", "debit_card", "neft", "rtgs", "imps", "bank_transfer", "cheque"].includes(method) || method.startsWith("online");
    const debitAcc = isBankMethod && bankAcc ? bankAcc : cashAcc;

    const dateStr  = p.createdAt.toISOString().split("T")[0];
    const billNum  = (b as { billNumber?: string } | null)?.billNumber ?? `Bill #${p.billId}`;

    const prefix   = "RV";
    const monthKey = dateStr.slice(0, 7).replace("-", "");
    const monthCount = (await db.select().from(vouchersTable).where(like(vouchersTable.voucherNumber, `${prefix}-${monthKey}%`))).length;
    const voucherNumber = `${prefix}-${monthKey}-${String(monthCount + 1 + created).padStart(4, "0")}`;

    await db.insert(vouchersTable).values({
      voucherNumber,
      type:            "receipt",
      date:            dateStr,
      debitAccountId:  String(debitAcc.id),
      creditAccountId: String(revAcc.id),
      amount:          p.amount,
      particular:      `Payment received — ${billNum}`,
      reference:       ref,
      narration:       `${method.toUpperCase()} payment`,
      billId:          p.billId,
      performedBy:     method.startsWith("online") ? "Super Admin" : "System (Sync)",
    });
    created++;
  }

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

    const monthCount = await db
      .select({ c: sql<number>`count(*)` })
      .from(vouchersTable)
      .where(like(vouchersTable.voucherNumber, `${prefix}-${monthKey}%`))
      .then(r => Number(r[0]?.c ?? 0));

    const voucherNumber = `${prefix}-${monthKey}-${String(monthCount + created + 1).padStart(4, "0")}`;

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

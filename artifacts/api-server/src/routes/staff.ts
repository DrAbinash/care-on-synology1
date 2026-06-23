import { Router } from "express";
import crypto from "crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { db } from "@workspace/db";
import { todayIST } from "../lib/istDate";
import {
  staffTable,
  staffCounterTable,
  staffAdvancesTable,
  staffSalaryPaymentsTable,
  staffAttendanceTable,
  staffBiometricCredentialsTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

const router = Router();

// Resolve RP ID + origin per request (works behind Replit proxy)
function rpFromReq(req: { headers: Record<string, unknown> }): { rpID: string; origin: string } {
  const fwdHost = String(req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost");
  const proto = String(req.headers["x-forwarded-proto"] ?? "https");
  const host = fwdHost.split(",")[0].trim();
  const rpID = host.split(":")[0];
  const origin = `${proto}://${host}`;
  return { rpID, origin };
}

// In-memory short-lived challenge store
const challengeStore = new Map<string, { expiresAt: number; staffId?: number }>();
function rememberChallenge(challenge: string, staffId?: number) {
  challengeStore.set(challenge, { expiresAt: Date.now() + 5 * 60_000, staffId });
  for (const [k, v] of challengeStore) if (v.expiresAt < Date.now()) challengeStore.delete(k);
}
function consumeChallenge(challenge: string): { staffId?: number } | null {
  const entry = challengeStore.get(challenge);
  if (!entry || entry.expiresAt < Date.now()) return null;
  challengeStore.delete(challenge);
  return { staffId: entry.staffId };
}

async function generateStaffId(): Promise<string> {
  // Atomic counter increment — works even under concurrency
  const [counter] = await db
    .insert(staffCounterTable)
    .values({ id: 1, counter: 1 })
    .onConflictDoUpdate({ target: staffCounterTable.id, set: { counter: sql`${staffCounterTable.counter} + 1` } })
    .returning();
  return `EMP-${String(counter.counter).padStart(4, "0")}`;
}

function toNum<T extends Record<string, unknown>>(row: T, fields: string[]): T {
  const out = { ...row };
  for (const f of fields) if (f in out) (out as Record<string, unknown>)[f] = Number(out[f] ?? 0);
  return out;
}

// ── Staff CRUD ──────────────────────────────────────
router.get("/", async (req, res) => {
  const { active, search } = req.query as Record<string, string>;
  const conditions = [
    active === "1" ? eq(staffTable.isActive, true) : undefined,
    active === "0" ? eq(staffTable.isActive, false) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select()
    .from(staffTable)
    .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
    .orderBy(desc(staffTable.isActive), staffTable.firstName);
  let filtered = rows;
  if (search) {
    const q = search.toLowerCase();
    filtered = rows.filter((r) =>
      r.firstName.toLowerCase().includes(q) ||
      r.lastName.toLowerCase().includes(q) ||
      (r.staffId ?? "").toLowerCase().includes(q) ||
      (r.phone ?? "").includes(q) ||
      (r.role ?? "").toLowerCase().includes(q)
    );
  }
  return res.json(filtered.map((r) => toNum(r as Record<string, unknown>, ["baseSalary"])));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(staffTable).where(eq(staffTable.id, id));
  if (!row) return res.status(404).json({ error: "Staff not found" });
  return res.json(toNum(row as Record<string, unknown>, ["baseSalary"]));
});

router.post("/", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body.firstName || !body.lastName || !body.role) {
    return res.status(400).json({ error: "firstName, lastName, role required" });
  }
  const staffId = await generateStaffId();
  const [row] = await db
    .insert(staffTable)
    .values({
      staffId,
      firstName: String(body.firstName).trim(),
      lastName: String(body.lastName).trim(),
      phone: (body.phone as string) || null,
      email: (body.email as string) || null,
      role: String(body.role).trim(),
      department: (body.department as string) || null,
      joiningDate: (body.joiningDate as string) || null,
      baseSalary: String(body.baseSalary ?? "0"),
      address: (body.address as string) || null,
      emergencyContact: (body.emergencyContact as string) || null,
      bankAccount: (body.bankAccount as string) || null,
      ifsc: (body.ifsc as string) || null,
      notes: (body.notes as string) || null,
    })
    .returning();
  return res.status(201).json(toNum(row as Record<string, unknown>, ["baseSalary"]));
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const k of [
    "firstName", "lastName", "phone", "email", "role", "department",
    "joiningDate", "address", "emergencyContact", "bankAccount", "ifsc", "notes", "isActive",
  ]) if (k in body) updates[k] = body[k];
  if ("baseSalary" in body) updates.baseSalary = String(body.baseSalary);
  const [row] = await db.update(staffTable).set(updates).where(eq(staffTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Staff not found" });
  return res.json(toNum(row as Record<string, unknown>, ["baseSalary"]));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.update(staffTable).set({ isActive: false }).where(eq(staffTable.id, id));
  return res.json({ ok: true });
});

// ── Advances ────────────────────────────────────────
router.get("/:id/advances", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(staffAdvancesTable).where(eq(staffAdvancesTable.staffId, id)).orderBy(desc(staffAdvancesTable.advanceDate));
  return res.json(rows.map((r) => toNum(r as Record<string, unknown>, ["amount", "recoveredAmount"])));
});

router.post("/:id/advances", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const amount = Number(body.amount ?? 0);
  if (!amount || amount <= 0) return res.status(400).json({ error: "Valid amount required" });
  const [row] = await db
    .insert(staffAdvancesTable)
    .values({
      staffId: id,
      amount: String(amount),
      advanceDate: (body.advanceDate as string) || todayIST(),
      paymentMode: (body.paymentMode as string) || "cash",
      reason: (body.reason as string) || null,
      notes: (body.notes as string) || null,
    })
    .returning();
  return res.status(201).json(toNum(row as Record<string, unknown>, ["amount", "recoveredAmount"]));
});

router.delete("/advances/:advanceId", async (req, res) => {
  await db.delete(staffAdvancesTable).where(eq(staffAdvancesTable.id, Number(req.params.advanceId)));
  return res.json({ ok: true });
});

router.get("/:id/advances/outstanding", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${staffAdvancesTable.amount} - ${staffAdvancesTable.recoveredAmount}), 0)`,
    })
    .from(staffAdvancesTable)
    .where(and(eq(staffAdvancesTable.staffId, id), sql`${staffAdvancesTable.amount} > ${staffAdvancesTable.recoveredAmount}`));
  return res.json({ outstanding: Number(row?.total ?? 0) });
});

// ── Salary payments ─────────────────────────────────
router.get("/:id/salary", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(staffSalaryPaymentsTable).where(eq(staffSalaryPaymentsTable.staffId, id)).orderBy(desc(staffSalaryPaymentsTable.paymentDate));
  return res.json(rows.map((r) => toNum(r as Record<string, unknown>, ["baseAmount", "bonus", "deductions", "advanceDeducted", "netAmount"])));
});

router.post("/:id/salary", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const baseAmount = Number(body.baseAmount ?? 0);
  const bonus = Number(body.bonus ?? 0);
  const deductions = Number(body.deductions ?? 0);
  const requestedAdvance = Number(body.advanceDeducted ?? 0);

  if (baseAmount < 0 || bonus < 0 || deductions < 0 || requestedAdvance < 0) {
    return res.status(400).json({ error: "Amounts cannot be negative" });
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Lock + read outstanding advances FOR UPDATE (FIFO)
      const outstanding = await tx.execute(sql`
        SELECT * FROM ${staffAdvancesTable}
        WHERE ${staffAdvancesTable.staffId} = ${id}
          AND ${staffAdvancesTable.amount} > ${staffAdvancesTable.recoveredAmount}
        ORDER BY ${staffAdvancesTable.advanceDate} ASC, ${staffAdvancesTable.id} ASC
        FOR UPDATE
      `);
      const rows = (outstanding as unknown as { rows: Array<{ id: number; amount: string; recovered_amount: string }> }).rows
        ?? (outstanding as unknown as Array<{ id: number; amount: string; recovered_amount: string }>);

      const totalOutstanding = rows.reduce((s, r) => s + (Number(r.amount) - Number(r.recovered_amount)), 0);
      // Cap requested advance to outstanding to preserve financial integrity
      const advanceDeducted = Math.min(requestedAdvance, totalOutstanding);
      const netAmount = baseAmount + bonus - deductions - advanceDeducted;

      const [paymentRow] = await tx
        .insert(staffSalaryPaymentsTable)
        .values({
          staffId: id,
          monthYear: String(body.monthYear ?? todayIST().slice(0, 7)),
          baseAmount: String(baseAmount),
          bonus: String(bonus),
          deductions: String(deductions),
          advanceDeducted: String(advanceDeducted),
          daysPresent: Number(body.daysPresent ?? 0),
          daysAbsent: Number(body.daysAbsent ?? 0),
          netAmount: String(netAmount),
          paymentDate: (body.paymentDate as string) || todayIST(),
          paymentMode: (body.paymentMode as string) || "cash",
          reference: (body.reference as string) || null,
          notes: (body.notes as string) || null,
        })
        .returning();

      let remaining = advanceDeducted;
      for (const adv of rows) {
        if (remaining <= 0) break;
        const due = Number(adv.amount) - Number(adv.recovered_amount);
        const apply = Math.min(due, remaining);
        const newRecovered = Number(adv.recovered_amount) + apply;
        const isCleared = newRecovered >= Number(adv.amount);
        await tx
          .update(staffAdvancesTable)
          .set({ recoveredAmount: String(newRecovered), status: isCleared ? "cleared" : "outstanding" })
          .where(eq(staffAdvancesTable.id, adv.id));
        remaining -= apply;
      }

      return { paymentRow, capped: advanceDeducted < requestedAdvance, advanceDeducted };
    });

    return res.status(201).json({
      ...toNum(result.paymentRow as Record<string, unknown>, ["baseAmount", "bonus", "deductions", "advanceDeducted", "netAmount"]),
      _capped: result.capped,
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

router.delete("/salary/:paymentId", async (req, res) => {
  await db.delete(staffSalaryPaymentsTable).where(eq(staffSalaryPaymentsTable.id, Number(req.params.paymentId)));
  return res.json({ ok: true });
});

// ── Attendance ──────────────────────────────────────
router.get("/attendance/all", async (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const today = todayIST();
  const fromDate = from || today;
  const toDate = to || today;
  const rows = await db
    .select({
      id: staffAttendanceTable.id,
      staffId: staffAttendanceTable.staffId,
      attendanceDate: staffAttendanceTable.attendanceDate,
      punchIn: staffAttendanceTable.punchIn,
      punchOut: staffAttendanceTable.punchOut,
      source: staffAttendanceTable.source,
      notes: staffAttendanceTable.notes,
      staffName: sql<string>`${staffTable.firstName} || ' ' || ${staffTable.lastName}`,
      staffCode: staffTable.staffId,
      role: staffTable.role,
    })
    .from(staffAttendanceTable)
    .innerJoin(staffTable, eq(staffTable.id, staffAttendanceTable.staffId))
    .where(and(gte(staffAttendanceTable.attendanceDate, fromDate), lte(staffAttendanceTable.attendanceDate, toDate)))
    .orderBy(desc(staffAttendanceTable.attendanceDate), staffTable.firstName);
  return res.json(rows);
});

router.get("/:id/attendance", async (req, res) => {
  const id = Number(req.params.id);
  const { month } = req.query as Record<string, string>;
  const conditions = [eq(staffAttendanceTable.staffId, id)];
  if (month) {
    conditions.push(gte(staffAttendanceTable.attendanceDate, `${month}-01`));
    conditions.push(lte(staffAttendanceTable.attendanceDate, `${month}-31`));
  }
  const rows = await db.select().from(staffAttendanceTable).where(and(...conditions)).orderBy(desc(staffAttendanceTable.attendanceDate));
  return res.json(rows);
});

// Atomic punch — uses unique (staff_id, date) + transaction
async function recordPunch(staffId: number, action: "in" | "out", source: string) {
  const today = todayIST();
  const now = new Date();
  return db.transaction(async (tx) => {
    if (action === "in") {
      // Try insert; if exists, conditionally set punchIn only if null
      const inserted = await tx
        .insert(staffAttendanceTable)
        .values({ staffId, attendanceDate: today, punchIn: now, source })
        .onConflictDoNothing({ target: [staffAttendanceTable.staffId, staffAttendanceTable.attendanceDate] })
        .returning();
      if (inserted.length > 0) return { ok: true, row: inserted[0], action: "in" as const };
      // Row exists — set punchIn only if currently null
      const updated = await tx
        .update(staffAttendanceTable)
        .set({ punchIn: now, source })
        .where(and(
          eq(staffAttendanceTable.staffId, staffId),
          eq(staffAttendanceTable.attendanceDate, today),
          sql`${staffAttendanceTable.punchIn} IS NULL`,
        ))
        .returning();
      if (updated.length > 0) return { ok: true, row: updated[0], action: "in" as const };
      return { ok: false, error: "Already punched in today" };
    } else {
      // out: only if punched in and not yet out
      const updated = await tx
        .update(staffAttendanceTable)
        .set({ punchOut: now })
        .where(and(
          eq(staffAttendanceTable.staffId, staffId),
          eq(staffAttendanceTable.attendanceDate, today),
          sql`${staffAttendanceTable.punchIn} IS NOT NULL`,
          sql`${staffAttendanceTable.punchOut} IS NULL`,
        ))
        .returning();
      if (updated.length > 0) return { ok: true, row: updated[0], action: "out" as const };
      return { ok: false, error: "Must punch in first (or already punched out)" };
    }
  });
}

router.post("/:id/attendance/punch", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const action = body.action === "out" ? "out" : "in";
  const source = String(body.source ?? "manual");
  const result = await recordPunch(id, action, source);
  if (!result.ok) return res.status(409).json({ error: result.error });
  return res.json(result.row);
});

router.delete("/attendance/:attId", async (req, res) => {
  await db.delete(staffAttendanceTable).where(eq(staffAttendanceTable.id, Number(req.params.attId)));
  return res.json({ ok: true });
});

router.get("/:id/attendance/summary", async (req, res) => {
  const id = Number(req.params.id);
  const { month } = req.query as Record<string, string>;
  const m = month || new Date().toISOString().slice(0, 7);
  const rows = await db
    .select()
    .from(staffAttendanceTable)
    .where(and(eq(staffAttendanceTable.staffId, id), gte(staffAttendanceTable.attendanceDate, `${m}-01`), lte(staffAttendanceTable.attendanceDate, `${m}-31`)));
  const present = rows.filter((r) => r.punchIn).length;
  return res.json({ month: m, daysPresent: present, totalRecords: rows.length });
});

// ── Biometric (WebAuthn) — proper server-side verification ─
router.get("/:id/biometric", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select({
    id: staffBiometricCredentialsTable.id,
    credentialId: staffBiometricCredentialsTable.credentialId,
    deviceName: staffBiometricCredentialsTable.deviceName,
    enrolledAt: staffBiometricCredentialsTable.enrolledAt,
    lastUsedAt: staffBiometricCredentialsTable.lastUsedAt,
  }).from(staffBiometricCredentialsTable).where(eq(staffBiometricCredentialsTable.staffId, id));
  return res.json(rows);
});

router.post("/:id/biometric/register/begin", async (req, res) => {
  const id = Number(req.params.id);
  const [staff] = await db.select().from(staffTable).where(eq(staffTable.id, id));
  if (!staff) return res.status(404).json({ error: "Staff not found" });
  const { rpID } = rpFromReq(req);
  const existing = await db.select().from(staffBiometricCredentialsTable).where(eq(staffBiometricCredentialsTable.staffId, id));

  const opts = await generateRegistrationOptions({
    rpName: "Care Diagnostics ERP",
    rpID,
    userName: staff.staffId,
    userDisplayName: `${staff.firstName} ${staff.lastName}`,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "discouraged",
    },
  });
  rememberChallenge(opts.challenge, id);
  return res.json(opts);
});

router.post("/:id/biometric/register/complete", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as { response?: unknown; expectedChallenge?: string; deviceName?: string };
  if (!body.response || !body.expectedChallenge) return res.status(400).json({ error: "Missing response or challenge" });
  const consumed = consumeChallenge(body.expectedChallenge);
  if (!consumed || consumed.staffId !== id) return res.status(400).json({ error: "Invalid or expired challenge" });

  const { rpID, origin } = rpFromReq(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: body.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Verification failed" });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: "Registration not verified" });
  }
  const info = verification.registrationInfo as unknown as {
    credential?: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] };
    credentialID?: Uint8Array | string;
    credentialPublicKey?: Uint8Array;
    counter?: number;
  };
  const credentialId = info.credential?.id
    ?? (typeof info.credentialID === "string" ? info.credentialID : Buffer.from(info.credentialID ?? new Uint8Array()).toString("base64url"));
  const publicKey = info.credential?.publicKey ?? info.credentialPublicKey ?? new Uint8Array();
  const counter = info.credential?.counter ?? info.counter ?? 0;
  const transports = info.credential?.transports;

  const [row] = await db
    .insert(staffBiometricCredentialsTable)
    .values({
      staffId: id,
      credentialId,
      publicKey: Buffer.from(publicKey).toString("base64url"),
      counter,
      transports: transports ? JSON.stringify(transports) : null,
      deviceName: body.deviceName || "Fingerprint Sensor",
    })
    .returning({ id: staffBiometricCredentialsTable.id });
  return res.status(201).json({ ok: true, id: row.id });
});

router.delete("/biometric/:credId", async (req, res) => {
  await db.delete(staffBiometricCredentialsTable).where(eq(staffBiometricCredentialsTable.id, Number(req.params.credId)));
  return res.json({ ok: true });
});

// Punch via fingerprint
router.post("/biometric/punch/begin", async (req, res) => {
  const creds = await db.select().from(staffBiometricCredentialsTable);
  const { rpID } = rpFromReq(req);
  const opts = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? (JSON.parse(c.transports) as Array<"usb" | "nfc" | "ble" | "internal">) : undefined,
    })),
  });
  rememberChallenge(opts.challenge);
  return res.json(opts);
});

router.post("/biometric/punch/complete", async (req, res) => {
  const body = req.body as { response?: unknown; expectedChallenge?: string; action?: string };
  if (!body.response || !body.expectedChallenge) return res.status(400).json({ error: "Missing data" });
  if (!consumeChallenge(body.expectedChallenge)) return res.status(400).json({ error: "Invalid or expired challenge" });

  const credentialId = (body.response as { id?: string }).id;
  if (!credentialId) return res.status(400).json({ error: "Missing credentialId" });
  const [cred] = await db.select().from(staffBiometricCredentialsTable).where(eq(staffBiometricCredentialsTable.credentialId, credentialId));
  if (!cred) return res.status(404).json({ error: "Fingerprint not enrolled" });

  const { rpID, origin } = rpFromReq(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: body.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64url")),
        counter: cred.counter,
      },
    });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Verification failed" });
  }
  if (!verification.verified) return res.status(400).json({ error: "Fingerprint not verified" });

  const newCounter = verification.authenticationInfo?.newCounter ?? cred.counter;
  await db.update(staffBiometricCredentialsTable)
    .set({ lastUsedAt: new Date(), counter: newCounter })
    .where(eq(staffBiometricCredentialsTable.id, cred.id));

  const [staff] = await db.select().from(staffTable).where(eq(staffTable.id, cred.staffId));
  if (!staff) return res.status(404).json({ error: "Staff not found" });

  const action = body.action === "out" ? "out" : "in";
  // Smart toggle: if "in" requested but already punched in, treat as "out"
  const today = todayIST();
  const [existing] = await db
    .select()
    .from(staffAttendanceTable)
    .where(and(eq(staffAttendanceTable.staffId, cred.staffId), eq(staffAttendanceTable.attendanceDate, today)));
  const resolvedAction: "in" | "out" = action === "in" && existing?.punchIn && !existing.punchOut ? "out" : action;
  const result = await recordPunch(cred.staffId, resolvedAction, "fingerprint");
  if (!result.ok) return res.status(409).json({ error: result.error, staff });
  return res.json({ staff, attendance: result.row, action: resolvedAction });
});

// Today's overview
router.get("/dashboard/today", async (_req, res) => {
  const today = todayIST();
  const allStaff = await db.select().from(staffTable).where(eq(staffTable.isActive, true));
  const todayAtt = await db.select().from(staffAttendanceTable).where(eq(staffAttendanceTable.attendanceDate, today));
  const map = new Map(todayAtt.map((a) => [a.staffId, a]));
  const list = allStaff.map((s) => ({
    staff: { id: s.id, staffId: s.staffId, name: `${s.firstName} ${s.lastName}`, role: s.role },
    attendance: map.get(s.id) ?? null,
  }));
  return res.json({ date: today, total: allStaff.length, present: todayAtt.filter((a) => a.punchIn).length, list });
});

export const staffRouter = router;
export default router;

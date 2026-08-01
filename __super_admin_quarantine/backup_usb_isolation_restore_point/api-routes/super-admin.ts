import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  usersTable,
  superAdminSessionsTable,
  doctorsTable,
  testsTable,
  ledgersTable,
  billsTable,
  patientsTable,
  ordersTable,
  orderTestsTable,
  appointmentsTable,
  auditRunsTable,
  clinicSettingsTable,
  billAuditsTable,
  paymentsTable,
  tokensTable,
  testTokensTable,
  samplesTable,
  sampleTestAssignmentsTable,
  radiologyStudiesTable,
  radiologyScheduledProceduresTable,
  radiologyReportKeyImagesTable,
  radiologyVoiceLogsTable,
  patientReportsTable,
  reportSharesTable,
  formFRecordsTable,
  onlineBookingsTable,
  vouchersTable,
  voucherAuditsTable,
  commissionRulesTable,
  doctorPayoutsTable,
  aiReportingDraftsTable,
  aiReportingAuditLogsTable,
  dicomPulledStudiesTable,
  dicomPullAgentLogsTable,
  pacsLogsTable,
  portalSessionsTable,
  auditLogsTable,
  backupJobsTable,
  backupJobLogsTable,
  paymentLogsTable,
} from "@workspace/db/schema";
import { eq, and, asc, desc, isNull, or, sql, inArray, gt, gte, count } from "drizzle-orm";
import { runBooksSanity } from "./books-sanity";
import { verifySuperAdmin } from "./ledgers";
import {
  requireSuperAdminUsb,
  isValidUsbKey,
  isUsbGateEnforced,
  getUsbKeyHeader,
} from "../middleware/requireSuperAdminUsb";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { computeChainHash } from "../lib/audit";
import {
  CreateLedgerBody,
  UpdateLedgerParams,
  UpdateLedgerBody,
  DeleteLedgerParams,
  DeleteLedgerBody,
  AssignDoctorsToLedgerParams,
  AssignDoctorsToLedgerBody,
  ResetLedgerParams,
  ResetLedgerBody,
} from "@workspace/api-zod";

export const superAdminRouter = Router();

// Body schema for the USB pen-drive key verification endpoint. The client reads
// `superadmin.key` off the user's plugged-in pen drive and posts its content.
const UsbVerifyBody = z.object({
  key: z.string().min(1, "key is required").max(4096),
});

// Rate limiter for the USB verify endpoint — slow brute-force attempts.
const usbVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many USB key attempts. Please try again later." },
});

// POST /api/super-admin/usb/verify — checks a presented USB key against the
// SUPER_ADMIN_USB_KEY env secret. Used by both the super-admin-portal unlock
// screen and the billing UI's "Detect USB key" affordance to decide whether
// to reveal the super-admin link.
//
// Public on purpose (no auth) so an unauthenticated client can ask "is this
// pen drive valid?" before bothering the user with a PIN screen — but rate
// limited so it can't be brute-forced from the internet. Returns the same
// shape on success and failure so timing is uniform.
superAdminRouter.post("/usb/verify", usbVerifyLimiter, (req, res): void => {
  const parsed = UsbVerifyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid request" });
    return;
  }
  const ok = isValidUsbKey(parsed.data.key);
  if (!ok) {
    res.status(401).json({ ok: false, error: "Invalid USB key" });
    return;
  }
  res.json({ ok: true, enforced: isUsbGateEnforced() });
});

// GET /api/super-admin/usb/status — tells the client whether the pen-drive
// gate is enforced on this server (i.e. SUPER_ADMIN_USB_KEY is set). Used by
// the billing UI to decide whether to show the "Insert USB key" affordance
// at all. No secrets in the response.
superAdminRouter.get("/usb/status", (_req, res): void => {
  res.json({ enforced: isUsbGateEnforced() });
});

// No generated zod schemas exist for these auth endpoints (they are not in
// the OpenAPI spec), so we declare local schemas and use the same safeParse
// pattern as the validated routes (appointments, expenses, etc.).
const LoginBody = z.object({
  // STRICT: display name always required (even with usbPin).
  name: z.string().trim().min(1, "Name is required"),
  pin: z.string().trim().optional(),
  usbPin: z.string().trim().optional(),
}).refine((data) => {
  // If usbPin is not provided, the database PIN is required.
  if (!data.usbPin) return Boolean(data.pin && data.pin.length > 0);
  return true;
}, { message: "PIN is required when usbPin is not provided", path: ["pin"] });

const LogoutBody = z.object({
  token: z.string().min(1, "token is required"),
});

const VerifyBody = z.object({
  token: z.string().min(1).optional(),
});

// Rate limiter: max 5 attempts per IP per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

function generateToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

function isBcryptHash(value: string): boolean {
  return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}

// Constant-time PIN verification with plaintext legacy fallback
async function verifyPin(plain: string, stored: string): Promise<boolean> {
  if (isBcryptHash(stored)) {
    return bcrypt.compare(plain, stored);
  }
  // Legacy plaintext — constant-time compare
  const a = Buffer.from(plain);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getUsbPinEnv(): string | null {
  const v = process.env["SUPER_ADMIN_USB_PIN"];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function isUsbPinEnforced(): boolean {
  return getUsbPinEnv() !== null;
}

// POST /api/super-admin/login — validates name + PIN, creates session token.
// Gated by the USB pen-drive middleware: without a valid X-SA-USB-Key header
// the request is rejected before the PIN is even checked. This makes the
// super-admin login surface invisible to anyone without the physical key.
//
// Exception: if the authenticated user has remoteLoginEnabled=true, the
// USB gate is bypassed so the owner can log in from outside the hospital.
//
// Auto-login: if the request includes `usbPin` (the contents of `superadmin.pin`
// from the pen drive) and it matches the SUPER_ADMIN_USB_PIN env secret, the
// user is logged in immediately without checking the database PIN.
superAdminRouter.post("/login", loginLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { name, pin, usbPin } = parsed.data;

  // STRICT: exact display-name match only (case-insensitive). No username /
  // email / numeric-id aliases, and no "wrong name + usbPin" fallback.
  if (!name || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const [user] = await db.select().from(usersTable)
    .where(and(sql`lower(${usersTable.name}) = lower(${name})`, eq(usersTable.isActive, true)));

  if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }
  if (user.role !== "super_admin") { res.status(403).json({ error: "Access denied — not a super admin" }); return; }

  // USB pen-drive gate check — enforced before PIN so we know the user
  // and can honour the remoteLoginEnabled bypass.
  if (isUsbGateEnforced()) {
    const usb = getUsbKeyHeader(req);
    const hasUsb = usb && isValidUsbKey(usb);
    if (!hasUsb && !user.remoteLoginEnabled) {
      res.status(401).json({ error: "USB key required" });
      return;
    }
    if (!hasUsb && user.remoteLoginEnabled) {
      logger.warn({ userId: user.id, userName: user.name },
        "USB gate bypassed — remoteLoginEnabled super-admin logged in without pen drive");
    }
  }

  // Auto-login via usbPin from the pen drive
  let autoLogin = false;
  if (isUsbPinEnforced() && usbPin) {
    const expectedPin = getUsbPinEnv()!;
    const pinBuf = Buffer.from(usbPin);
    const expectedBuf = Buffer.from(expectedPin);
    if (pinBuf.length === expectedBuf.length && crypto.timingSafeEqual(pinBuf, expectedBuf)) {
      autoLogin = true;
      logger.info({ userId: user.id }, "Auto-login via usbPin");
    }
  }

  if (!autoLogin) {
    if (!pin || !pin.length) { res.status(401).json({ error: "PIN is required" }); return; }
    if (!user.pin) { res.status(401).json({ error: "No PIN configured for this user" }); return; }
    const pinMatches = await verifyPin(pin, user.pin);
    if (!pinMatches) { res.status(401).json({ error: "Invalid credentials" }); return; }
    // Transparently upgrade plaintext legacy PINs to bcrypt on first successful login
    if (!isBcryptHash(user.pin)) {
      const hashed = await bcrypt.hash(pin, 12);
      await db.update(usersTable).set({ pin: hashed }).where(eq(usersTable.id, user.id));
    }
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8-hour session

  await db.insert(superAdminSessionsTable).values({
    token,
    userId: user.id,
    userName: user.name,
    expiresAt,
    isActive: true,
  });

  res.json({ token, userName: user.name, expiresAt: expiresAt.toISOString() });
});

// POST /api/super-admin/logout — revoke a session token
superAdminRouter.post("/logout", async (req, res): Promise<void> => {
  const parsed = LogoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { token } = parsed.data;

  await db.update(superAdminSessionsTable)
    .set({ isActive: false })
    .where(eq(superAdminSessionsTable.token, token));

  res.json({ ok: true });
});

// POST /api/super-admin/verify — check if token is active.
// Token is accepted in the request body (never in the query string to avoid
// exposure in logs, browser history, and reverse-proxy access logs).
superAdminRouter.post("/verify", async (req, res): Promise<void> => {
  const parsed = VerifyBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const token = parsed.data.token ?? null;
  if (!token) { res.json({ active: false, userName: null }); return; }

  const [session] = await db.select().from(superAdminSessionsTable)
    .where(eq(superAdminSessionsTable.token, token));

  if (!session || !session.isActive || new Date(session.expiresAt) < new Date()) {
    if (session && session.isActive && new Date(session.expiresAt) < new Date()) {
      // Auto-deactivate expired sessions
      await db.update(superAdminSessionsTable)
        .set({ isActive: false })
        .where(eq(superAdminSessionsTable.token, token));
    }
    res.json({ active: false, userName: null });
    return;
  }

  res.json({ active: true, userName: session.userName, expiresAt: session.expiresAt });
});

// ── GET /api/super-admin/doctors-list — thin read for SA portal pages ─────────
// Returns id, name, ledgerId, specialization — all fields the portal dropdowns
// and the AssignDoctors modal need. Protected by requireSuperAdmin (which also
// checks the USB key when the gate is enforced).
superAdminRouter.get("/doctors-list", requireSuperAdmin, async (_req, res): Promise<void> => {
  const doctors = await db
    .select({
      id: doctorsTable.id,
      name: doctorsTable.name,
      specialization: doctorsTable.specialization,
      ledgerId: doctorsTable.ledgerId,
      defaultCommission: doctorsTable.defaultCommission,
      defaultCommissionType: doctorsTable.defaultCommissionType,
    })
    .from(doctorsTable)
    .orderBy(asc(doctorsTable.name));
  res.json({ doctors });
});

// ── GET /api/super-admin/tests-list — thin read for SA portal pages ───────────
superAdminRouter.get("/tests-list", requireSuperAdmin, async (_req, res): Promise<void> => {
  const tests = await db
    .select({
      id: testsTable.id,
      name: testsTable.name,
      category: testsTable.category,
    })
    .from(testsTable)
    .where(eq(testsTable.isActive, true))
    .orderBy(asc(testsTable.name));
  res.json({ tests });
});

// ── GET /api/super-admin/books — ledgers with stats for Books page ────────────
// Mirrors the GET /api/ledgers logic but protected by SA auth instead of staff
// auth, since the Books page lives in the super-admin portal.
superAdminRouter.get("/books", requireSuperAdmin, async (_req, res): Promise<void> => {
  // Ensure default ledger exists
  const [existing] = await db.select({ id: ledgersTable.id }).from(ledgersTable).where(eq(ledgersTable.id, 1));
  if (!existing) {
    await db.execute(sql`
      INSERT INTO ledgers (id, name, is_default, created_at)
      VALUES (1, 'Default / Walk-in', true, NOW())
      ON CONFLICT (id) DO NOTHING
    `);
  }

  const ledgers = await db.select().from(ledgersTable).orderBy(ledgersTable.id);

  // For id=1 (default), also count rows where ledger_id IS NULL (legacy rows).
  // Each table gets its own typed condition to avoid Drizzle's strict column brand checks.
  const result = await Promise.all(
    ledgers.map(async (l) => {
      const isDefault = l.id === 1;
      const [doctorCount, patientCount, billCount, orderCount, appointmentCount] = await Promise.all([
        db.select({ c: sql<number>`count(*)` }).from(doctorsTable)
          .where(isDefault ? or(eq(doctorsTable.ledgerId, 1), isNull(doctorsTable.ledgerId))! : eq(doctorsTable.ledgerId, l.id)),
        db.select({ c: sql<number>`count(*)` }).from(patientsTable)
          .where(isDefault ? or(eq(patientsTable.ledgerId, 1), isNull(patientsTable.ledgerId))! : eq(patientsTable.ledgerId, l.id)),
        db.select({ c: sql<number>`count(*)` }).from(billsTable)
          .where(isDefault ? or(eq(billsTable.ledgerId, 1), isNull(billsTable.ledgerId))! : eq(billsTable.ledgerId, l.id)),
        db.select({ c: sql<number>`count(*)` }).from(ordersTable)
          .where(isDefault ? or(eq(ordersTable.ledgerId, 1), isNull(ordersTable.ledgerId))! : eq(ordersTable.ledgerId, l.id)),
        db.select({ c: sql<number>`count(*)` }).from(appointmentsTable)
          .where(isDefault ? or(eq(appointmentsTable.ledgerId, 1), isNull(appointmentsTable.ledgerId))! : eq(appointmentsTable.ledgerId, l.id)),
      ]);
      return {
        ...l,
        doctorCount: Number(doctorCount[0]?.c ?? 0),
        patientCount: Number(patientCount[0]?.c ?? 0),
        billCount: Number(billCount[0]?.c ?? 0),
        orderCount: Number(orderCount[0]?.c ?? 0),
        appointmentCount: Number(appointmentCount[0]?.c ?? 0),
      };
    }),
  );

  res.json(result);
});

// ── POST /api/super-admin/books — create a new ledger (SA only) ───────────────
superAdminRouter.post("/books", requireSuperAdmin, async (req, res): Promise<void> => {
  const bodyParsed = CreateLedgerBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const { token, name } = bodyParsed.data;
  const { valid } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const [created] = await db.insert(ledgersTable).values({ name: trimmedName, isDefault: false }).returning();
    res.status(201).json(created);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to create ledger";
    if (msg.includes("unique")) {
      res.status(409).json({ error: "A book with that name already exists" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// ── PATCH /api/super-admin/books/:id — rename a ledger (SA only) ──────────────
superAdminRouter.patch("/books/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const paramsParsed = UpdateLedgerParams.safeParse(req.params);
  const bodyParsed = UpdateLedgerBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const { token, name } = bodyParsed.data;
  const { valid } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const [updated] = await db.update(ledgersTable).set({ name: trimmedName }).where(eq(ledgersTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    res.json(updated);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to rename";
    if (msg.includes("unique")) {
      res.status(409).json({ error: "A book with that name already exists" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// ── DELETE /api/super-admin/books/:id — delete ledger (SA only) ───────────────
superAdminRouter.delete("/books/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const paramsParsed = DeleteLedgerParams.safeParse(req.params);
  const bodyParsed = DeleteLedgerBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const { token } = bodyParsed.data;
  const { valid } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }
  const [ledger] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, id));
  if (!ledger) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  if (ledger.isDefault) {
    res.status(400).json({ error: "Cannot delete the default book" });
    return;
  }
  await db.update(doctorsTable).set({ ledgerId: 1 }).where(eq(doctorsTable.ledgerId, id));
  const [bc] = await db.select({ c: sql<number>`count(*)` }).from(billsTable).where(eq(billsTable.ledgerId, id));
  const [pc] = await db.select({ c: sql<number>`count(*)` }).from(patientsTable).where(eq(patientsTable.ledgerId, id));
  if (Number(bc?.c ?? 0) > 0 || Number(pc?.c ?? 0) > 0) {
    res.status(400).json({ error: "Book is not empty — reset it first before deleting" });
    return;
  }
  await db.delete(ledgersTable).where(eq(ledgersTable.id, id));
  res.json({ success: true });
});

// ── POST /api/super-admin/books/:id/assign-doctors ────────────────────────────
superAdminRouter.post("/books/:id/assign-doctors", requireSuperAdmin, async (req, res): Promise<void> => {
  const paramsParsed = AssignDoctorsToLedgerParams.safeParse(req.params);
  const bodyParsed = z.object({ doctorIds: z.array(z.number()) }).safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const { doctorIds } = bodyParsed.data;
  try {
    const [ledger] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, id));
    if (!ledger) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    await db.update(doctorsTable)
      .set({ ledgerId: 1 })
      .where(and(
        eq(doctorsTable.ledgerId, id),
        doctorIds.length > 0
          ? sql`${doctorsTable.id} NOT IN (${sql.join(doctorIds.map((d: number) => sql`${d}`), sql`, `)})`
          : sql`true`,
      ));
    if (doctorIds.length > 0) {
      await db.update(doctorsTable).set({ ledgerId: id }).where(inArray(doctorsTable.id, doctorIds));
      // Retroactively tag existing orders, bills, patients and appointments so
      // the Books/Ledgers page counts match the newly-assigned doctor grouping.
      // NOTE: `orders` has no appointment_id column — appointments are linked by
      // doctor_id (and historically patient_id via orders). Updating by
      // orders.appointment_id caused "Internal server error" on Save.
      const idList = sql.join(doctorIds.map((d: number) => sql`${d}`), sql`, `);
      await db.execute(sql`UPDATE orders SET ledger_id = ${id} WHERE doctor_id IN (${idList})`);
      await db.execute(sql`UPDATE bills SET ledger_id = ${id} WHERE order_id IN (SELECT id FROM orders WHERE doctor_id IN (${idList}))`);
      await db.execute(sql`UPDATE patients SET ledger_id = ${id} WHERE id IN (SELECT patient_id FROM orders WHERE doctor_id IN (${idList}))`);
      await db.execute(sql`UPDATE appointments SET ledger_id = ${id} WHERE doctor_id IN (${idList})`);
    }
    res.json({ assigned: doctorIds.length });
  } catch (err) {
    logger.error({ err, bookId: id, doctorCount: doctorIds.length }, "assign-doctors failed");
    res.status(500).json({
      error: "Failed to assign doctors to book",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── POST /api/super-admin/books/:id/set-walk-in — mark as walk-in destination ─
superAdminRouter.post("/books/:id/set-walk-in", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid book id" });
    return;
  }
  const [ledger] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, id));
  if (!ledger) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  // Clear the flag from all books, then set on this one
  await db.update(ledgersTable).set({ isWalkIn: false });
  await db.update(ledgersTable).set({ isWalkIn: true }).where(eq(ledgersTable.id, id));
  res.json({ ok: true, walkInLedgerId: id, name: ledger.name });
});

// ── POST /api/super-admin/books/:id/reset ────────────────────────────────────
superAdminRouter.post("/books/:id/reset", requireSuperAdminUsb, requireSuperAdmin, async (req, res): Promise<void> => {
  const paramsParsed = ResetLedgerParams.safeParse(req.params);
  const bodyParsed = ResetLedgerBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const { token, reason } = bodyParsed.data;
  if (!reason || reason.trim().length < 3) {
    res.status(400).json({ error: "A reason of at least 3 characters is required" });
    return;
  }
  const { valid, userName } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }
  const [ledger] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, id));
  if (!ledger) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const isDefault = id === 1;
  const billRows = await db.select({ id: billsTable.id }).from(billsTable).where(
    isDefault ? or(eq(billsTable.ledgerId, 1), isNull(billsTable.ledgerId)) : eq(billsTable.ledgerId, id),
  );
  const billIds = billRows.map(r => r.id);
  const orderRows = await db.select({ id: ordersTable.id }).from(ordersTable).where(
    isDefault ? or(eq(ordersTable.ledgerId, 1), isNull(ordersTable.ledgerId)) : eq(ordersTable.ledgerId, id),
  );
  const orderIds = orderRows.map(r => r.id);
  const patientRows = await db.select({ id: patientsTable.id }).from(patientsTable).where(
    isDefault ? or(eq(patientsTable.ledgerId, 1), isNull(patientsTable.ledgerId)) : eq(patientsTable.ledgerId, id),
  );
  const patientIds = patientRows.map(r => r.id);
  if (billIds.length) {
    await db.delete(paymentsTable).where(inArray(paymentsTable.billId, billIds));
    await db.delete(billAuditsTable).where(inArray(billAuditsTable.billId, billIds));
    await db.delete(billsTable).where(inArray(billsTable.id, billIds));
  }
  if (orderIds.length) {
    await db.delete(orderTestsTable).where(inArray(orderTestsTable.orderId, orderIds));
    await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  }
  await db.delete(appointmentsTable).where(
    isDefault ? or(eq(appointmentsTable.ledgerId, 1), isNull(appointmentsTable.ledgerId)) : eq(appointmentsTable.ledgerId, id),
  );
  if (patientIds.length) {
    await db.delete(appointmentsTable).where(inArray(appointmentsTable.patientId, patientIds));
    await db.delete(patientsTable).where(inArray(patientsTable.id, patientIds));
  }
  res.json({
    ok: true,
    book: ledger.name,
    by: userName,
    reason,
    wiped: { bills: billIds.length, orders: orderIds.length, patients: patientIds.length },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MONEY TRAIL AUDIT RUNS
// ─────────────────────────────────────────────────────────────────────────────
// All routes require both the USB pen-drive gate and a valid super-admin
// session token. Snapshots persist a Books-Sanity report to the audit_runs
// table so the audit trail survives later edits to the underlying bills.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SaveAuditBody = z.object({
  from: z.string().regex(ISO_DATE_RE, "from must be YYYY-MM-DD"),
  to: z.string().regex(ISO_DATE_RE, "to must be YYYY-MM-DD"),
  notes: z.string().max(4000).optional(),
});

async function getCurrentSuperAdminName(req: import("express").Request): Promise<string> {
  // requireSuperAdmin already validated the token before this fn is called,
  // so a missing-name fallback here is unexpected and worth logging — it
  // means the audit row will be stamped with a generic actor and the audit
  // trail loses some precision. Log enough to investigate without leaking
  // the token itself.
  try {
    const token = (req.header("x-sa-token") ?? "").trim();
    if (!token) {
      req.log?.warn("getCurrentSuperAdminName: no x-sa-token header on already-authorised request");
      return "super-admin";
    }
    const [row] = await db
      .select({ userName: superAdminSessionsTable.userName })
      .from(superAdminSessionsTable)
      .where(eq(superAdminSessionsTable.token, token))
      .limit(1);
    if (!row?.userName) {
      req.log?.warn({ tokenPrefix: token.slice(0, 8) }, "getCurrentSuperAdminName: session lookup returned no userName");
      return "super-admin";
    }
    return row.userName;
  } catch (err) {
    req.log?.warn({ err }, "getCurrentSuperAdminName: lookup threw");
    return "super-admin";
  }
}

// Live preview: run a Books-Sanity report without persisting. Gated by USB +
// SA so the Money-Trail Audit page in the super-admin-portal can fetch it
// using saAuthHeaders() (the regular /api/books-sanity route is gated by
// requireStaffAuth which doesn't recognise SA tokens).
superAdminRouter.get("/books-sanity-preview", requireSuperAdminUsb, requireSuperAdmin, async (req, res) => {
  const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
  const toRaw = typeof req.query.to === "string" ? req.query.to : null;
  if ((fromRaw && !ISO_DATE_RE.test(fromRaw)) || (toRaw && !ISO_DATE_RE.test(toRaw))) {
    res.status(400).json({ error: "from/to must be YYYY-MM-DD" });
    return;
  }
  if (fromRaw && toRaw && fromRaw > toRaw) {
    res.status(400).json({ error: "'from' must be on or before 'to'" });
    return;
  }
  const report = await runBooksSanity({ from: fromRaw, to: toRaw });
  res.json(report);
});

// List past audit runs (most recent first). No snapshot payload — just a
// summary row per audit. Use GET /:id to fetch the full snapshot.
superAdminRouter.get("/audit-runs", requireSuperAdminUsb, requireSuperAdmin, async (_req, res) => {
  const rows = await db.select({
    id: auditRunsTable.id,
    periodFrom: auditRunsTable.periodFrom,
    periodTo: auditRunsTable.periodTo,
    generatedAt: auditRunsTable.generatedAt,
    completedAt: auditRunsTable.completedAt,
    completedBy: auditRunsTable.completedBy,
    source: auditRunsTable.source,
    notes: auditRunsTable.notes,
    anomalyCount: auditRunsTable.anomalyCount,
    highCount: auditRunsTable.highCount,
    totalImpact: auditRunsTable.totalImpact,
    emailSentAt: auditRunsTable.emailSentAt,
  }).from(auditRunsTable).orderBy(desc(auditRunsTable.generatedAt)).limit(200);
  res.json({ items: rows });
});

// Fetch a single past audit including the full snapshot payload.
superAdminRouter.get("/audit-runs/:id", requireSuperAdminUsb, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(auditRunsTable).where(eq(auditRunsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Audit not found" });
    return;
  }
  res.json(row);
});

// Run a fresh Books-Sanity report and persist it. Marks the audit complete
// in a single step (the operator already reviewed the on-screen report
// before clicking "Mark Audit Complete").
superAdminRouter.post("/audit-runs", requireSuperAdminUsb, requireSuperAdmin, async (req, res) => {
  const parsed = SaveAuditBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { from, to, notes } = parsed.data;
  if (from > to) {
    res.status(400).json({ error: "'from' must be on or before 'to'" });
    return;
  }

  const report = await runBooksSanity({ from, to });
  const anomalyCount = report.anomalies.reduce((s, a) => s + a.count, 0);
  const highCount = report.anomalies.filter((a) => a.severity === "high").reduce((s, a) => s + a.count, 0);
  const totalImpact = report.anomalies.reduce((s, a) => s + (a.totalAmount || 0), 0);
  const completedBy = await getCurrentSuperAdminName(req);

  const [inserted] = await db.insert(auditRunsTable).values({
    periodFrom: from,
    periodTo: to,
    completedAt: new Date(),
    completedBy,
    source: "manual",
    notes: notes ?? null,
    anomalyCount,
    highCount,
    totalImpact: String(totalImpact),
    snapshot: report,
  }).returning();

  res.json(inserted);
});

// Hard-delete an audit run. Super-admin only (already enforced by middleware).
superAdminRouter.delete("/audit-runs/:id", requireSuperAdminUsb, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(auditRunsTable).where(eq(auditRunsTable.id, id));
  res.json({ ok: true });
});

// ─── Commission discount settings (super-admin only) ─────────────────────────
// Returns the current commissionDiscountMode so the super-admin portal can
// display and toggle it without giving full clinic-settings write access.
superAdminRouter.get("/commission-settings", requireSuperAdminUsb, requireSuperAdmin, async (_req, res) => {
  const rows = await db.select({
    commissionDiscountMode: clinicSettingsTable.commissionDiscountMode,
    commissionEligibilityPolicy: clinicSettingsTable.commissionEligibilityPolicy,
    commissionEligibilityMinAmount: clinicSettingsTable.commissionEligibilityMinAmount,
    commissionOutsourcedBasis: clinicSettingsTable.commissionOutsourcedBasis,
    commissionMaxPercent: clinicSettingsTable.commissionMaxPercent,
    commissionDriftAlertPoints: clinicSettingsTable.commissionDriftAlertPoints,
  }).from(clinicSettingsTable).limit(1);
  res.json({
    commissionDiscountMode: rows[0]?.commissionDiscountMode ?? "none",
    commissionEligibilityPolicy: rows[0]?.commissionEligibilityPolicy ?? "full_payment_collected",
    commissionEligibilityMinAmount: Number(rows[0]?.commissionEligibilityMinAmount ?? 0),
    commissionOutsourcedBasis: rows[0]?.commissionOutsourcedBasis ?? "price",
    commissionMaxPercent: Number(rows[0]?.commissionMaxPercent ?? 0),
    commissionDriftAlertPoints: Number(rows[0]?.commissionDriftAlertPoints ?? 0),
  });
});

const CommissionDiscountModes = ["none", "deduct", "deduct_rollover"] as const;
const CommissionEligibilityPolicies = [
  "bill_created", "report_finalized", "report_delivered",
  "min_amount_collected", "full_payment_collected", "collected_ge_commission",
] as const;
// On outsourced work, whether the commission rate applies to the full price or
// only to the margin the clinic keeps after paying the external lab.
const CommissionOutsourcedBases = ["price", "margin"] as const;
// All fields optional: the discount-mode card and the eligibility card each
// PATCH only their own field.
const CommissionSettingsPatch = z.object({
  commissionDiscountMode: z.enum(CommissionDiscountModes).optional(),
  commissionEligibilityPolicy: z.enum(CommissionEligibilityPolicies).optional(),
  commissionEligibilityMinAmount: z.number().nonnegative().optional(),
  commissionOutsourcedBasis: z.enum(CommissionOutsourcedBases).optional(),
  // 0 disables either guard.
  commissionMaxPercent: z.number().min(0).max(100).optional(),
  commissionDriftAlertPoints: z.number().min(0).max(100).optional(),
});

superAdminRouter.patch("/commission-settings", requireSuperAdminUsb, requireSuperAdmin, async (req, res) => {
  const parsed = CommissionSettingsPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid commission settings", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  const updates: Record<string, unknown> = {};
  if (data.commissionDiscountMode !== undefined) updates.commissionDiscountMode = data.commissionDiscountMode;
  if (data.commissionEligibilityPolicy !== undefined) updates.commissionEligibilityPolicy = data.commissionEligibilityPolicy;
  if (data.commissionEligibilityMinAmount !== undefined) updates.commissionEligibilityMinAmount = data.commissionEligibilityMinAmount.toFixed(2);
  if (data.commissionOutsourcedBasis !== undefined) updates.commissionOutsourcedBasis = data.commissionOutsourcedBasis;
  if (data.commissionMaxPercent !== undefined) updates.commissionMaxPercent = data.commissionMaxPercent.toFixed(2);
  if (data.commissionDriftAlertPoints !== undefined) updates.commissionDriftAlertPoints = data.commissionDriftAlertPoints.toFixed(2);
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No settings to update" });
    return;
  }
  const rows = await db.select({ id: clinicSettingsTable.id }).from(clinicSettingsTable).limit(1);
  if (!rows[0]) {
    await db.insert(clinicSettingsTable).values(updates as typeof clinicSettingsTable.$inferInsert);
  } else {
    await db.update(clinicSettingsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clinicSettingsTable.id, rows[0].id));
  }
  res.json({ ok: true, ...updates });
});

// ── POST /api/super-admin/doctors/purge — irreversible delete of all data for doctor(s) ─
// Deletes orders, bills, patients, and all linked child records for the specified doctorIds.
// Requires confirmation phrase to prevent accidental execution.
superAdminRouter.post("/doctors/purge", requireSuperAdminUsb, requireSuperAdmin, async (req, res): Promise<void> => {
  const bodyParsed = z.object({
    doctorIds: z.array(z.number().int().positive()).min(1),
    confirmPhrase: z.string(),
  }).safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const { doctorIds, confirmPhrase } = bodyParsed.data;
  if (confirmPhrase.trim() !== "DELETE MY DATA") {
    res.status(403).json({ error: "Confirm phrase mismatch. Type DELETE MY DATA to proceed." });
    return;
  }

  const idList = sql.join(doctorIds.map((d: number) => sql`${d}`), sql`, `);

  // Build scoped ID lists first so every subsequent delete is exact and idempotent.
  const orderIdsResult = await db.execute(sql`SELECT id FROM orders WHERE doctor_id IN (${idList})`);
  const orderIds = (orderIdsResult.rows as Array<{ id: number }>).map(r => r.id);

  const billIdsResult = orderIds.length > 0
    ? await db.execute(sql`SELECT id FROM bills WHERE order_id IN (${sql.join(orderIds.map((d: number) => sql`${d}`), sql`, `)})`)
    : { rows: [] };
  const billIds = (billIdsResult.rows as Array<{ id: number }>).map(r => r.id);

  const patientIdsResult = orderIds.length > 0
    ? await db.execute(sql`SELECT patient_id as id FROM orders WHERE doctor_id IN (${idList})`)
    : { rows: [] };
  const patientIds = (patientIdsResult.rows as Array<{ id: number }>).map(r => r.id);

  const appointmentIdsResult = orderIds.length > 0
    ? await db.execute(sql`SELECT appointment_id as id FROM orders WHERE doctor_id IN (${idList}) AND appointment_id IS NOT NULL`)
    : { rows: [] };
  const appointmentIds = (appointmentIdsResult.rows as Array<{ id: number }>).map(r => r.id);

  // ── Phase 1: child records with foreign-key dependencies ─
  if (billIds.length > 0) {
    await db.delete(paymentsTable).where(inArray(paymentsTable.billId, billIds));
    await db.delete(billAuditsTable).where(inArray(billAuditsTable.billId, billIds));
    await db.delete(formFRecordsTable).where(inArray(formFRecordsTable.billId, billIds));
    await db.delete(onlineBookingsTable).where(inArray(onlineBookingsTable.billId, billIds));
    await db.delete(tokensTable).where(inArray(tokensTable.billId, billIds));
    await db.delete(testTokensTable).where(inArray(testTokensTable.billId, billIds));
    await db.delete(vouchersTable).where(inArray(vouchersTable.billId, billIds));
    await db.delete(patientReportsTable).where(inArray(patientReportsTable.billId, billIds));
    await db.delete(reportSharesTable).where(inArray(reportSharesTable.reportId,
      (await db.select({ id: patientReportsTable.id }).from(patientReportsTable).where(inArray(patientReportsTable.billId, billIds))).map(r => r.id)));
  }

  if (orderIds.length > 0) {
    await db.delete(orderTestsTable).where(inArray(orderTestsTable.orderId, orderIds));
    await db.delete(samplesTable).where(inArray(samplesTable.orderId, orderIds));
    // sample_test_assignments cascade on sample_id — handled by the above
    await db.delete(radiologyStudiesTable).where(inArray(radiologyStudiesTable.orderId, orderIds));
    await db.execute(sql`DELETE FROM radiology_scheduled_procedures WHERE source_order_id::integer IN (${sql.join(orderIds.map((d: number) => sql`${d}`), sql`, `)})`);
  }

  if (patientIds.length > 0) {
    await db.delete(aiReportingDraftsTable).where(inArray(aiReportingDraftsTable.patientId, patientIds));
    await db.delete(aiReportingAuditLogsTable).where(inArray(aiReportingAuditLogsTable.patientId, patientIds));
    await db.execute(sql`DELETE FROM dicom_pulled_studies WHERE patient_id IN (${sql.join(patientIds.map((d: number) => sql`${String(d)}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM dicom_pull_agent_logs WHERE patient_id IN (${sql.join(patientIds.map((d: number) => sql`${String(d)}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM pacs_logs WHERE patient_id IN (${sql.join(patientIds.map((d: number) => sql`${String(d)}`), sql`, `)})`);
    await db.delete(radiologyVoiceLogsTable).where(inArray(radiologyVoiceLogsTable.patientId, patientIds));
    await db.delete(radiologyReportKeyImagesTable).where(inArray(radiologyReportKeyImagesTable.patientId, patientIds));
  }

  // ── Phase 2: parent records ─
  if (billIds.length > 0) {
    await db.delete(billsTable).where(inArray(billsTable.id, billIds));
  }
  if (appointmentIds.length > 0) {
    await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, appointmentIds));
  }
  if (orderIds.length > 0) {
    await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  }
  if (patientIds.length > 0) {
    await db.delete(patientsTable).where(inArray(patientsTable.id, patientIds));
  }

  // ── Phase 3: doctor metadata ─
  await db.delete(commissionRulesTable).where(inArray(commissionRulesTable.doctorId, doctorIds));
  await db.delete(doctorPayoutsTable).where(inArray(doctorPayoutsTable.doctorId, doctorIds));
  await db.delete(doctorsTable).where(inArray(doctorsTable.id, doctorIds));

  res.json({
    deleted: {
      doctors: doctorIds.length,
      orders: orderIds.length,
      bills: billIds.length,
      patients: patientIds.length,
      appointments: appointmentIds.length,
    },
  });
});

// ── Security Dashboard endpoints (hospital-grade safety) ─────────────────────

// GET /api/super-admin/security/sessions — active staff + patient sessions
superAdminRouter.get("/security/sessions", requireSuperAdminUsb, requireSuperAdmin, async (_req, res): Promise<void> => {
  const now = new Date();
  const rows = await db
    .select()
    .from(portalSessionsTable)
    .where(gt(portalSessionsTable.expiresAt, now))
    .orderBy(desc(portalSessionsTable.createdAt))
    .limit(200);
  res.json({ sessions: rows, total: rows.length });
});

// DELETE /api/super-admin/security/sessions/:id — kill a session
superAdminRouter.delete("/security/sessions/:id", requireSuperAdminUsb, requireSuperAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(portalSessionsTable).where(eq(portalSessionsTable.id, id));
  res.json({ ok: true });
});

// GET /api/super-admin/security/failed-logins — last 24h login failures from audit_logs
superAdminRouter.get("/security/failed-logins", requireSuperAdminUsb, requireSuperAdmin, async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.action, "login"),
        eq(auditLogsTable.module, "portal"),
        gt(auditLogsTable.createdAt, since),
      ),
    )
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(100);
  res.json({ events: rows, total: rows.length });
});

// GET /api/super-admin/security/backup-status — overview of all backup jobs + latest logs
superAdminRouter.get("/security/backup-status", requireSuperAdminUsb, requireSuperAdmin, async (_req, res): Promise<void> => {
  const jobs = await db.select().from(backupJobsTable).orderBy(desc(backupJobsTable.updatedAt));
  const logs = await db.select().from(backupJobLogsTable).orderBy(desc(backupJobLogsTable.createdAt)).limit(20);
  res.json({ jobs, recentLogs: logs });
});

// GET /api/super-admin/security/audit-summary — last 7 days audit counts by action
superAdminRouter.get("/security/audit-summary", requireSuperAdminUsb, requireSuperAdmin, async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ action: auditLogsTable.action, count: count() })
    .from(auditLogsTable)
    .where(gt(auditLogsTable.createdAt, since))
    .groupBy(auditLogsTable.action);
  res.json({ since: since.toISOString(), summary: rows });
});

// GET /api/super-admin/security/locked-accounts — users with active lockout
superAdminRouter.get("/security/locked-accounts", requireSuperAdminUsb, requireSuperAdmin, async (_req, res): Promise<void> => {
  const now = new Date();
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      username: usersTable.username,
      role: usersTable.role,
      failedLoginAttempts: usersTable.failedLoginAttempts,
      lockedUntil: usersTable.lockedUntil,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.isActive, true),
        or(
          gt(usersTable.lockedUntil, now),
          gt(usersTable.failedLoginAttempts, 0),
        ),
      ),
    )
    .orderBy(desc(usersTable.lockedUntil));
  res.json({ accounts: rows });
});

// POST /api/super-admin/security/unlock-account/:id — manually unlock a user
superAdminRouter.post("/security/unlock-account/:id", requireSuperAdminUsb, requireSuperAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.update(usersTable)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(usersTable.id, id));
  res.json({ ok: true });
});

// GET /api/super-admin/security/data-exports — recent data export audit events
superAdminRouter.get("/security/data-exports", requireSuperAdminUsb, requireSuperAdmin, async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(and(eq(auditLogsTable.action, "export"), gte(auditLogsTable.createdAt, since)))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(200);
  res.json({ since: since.toISOString(), exports: rows });
});

// POST /api/super-admin/security/verify-audit-chain — cryptographic chain integrity check
superAdminRouter.post("/security/verify-audit-chain", requireSuperAdminUsb, requireSuperAdmin, async (req, res): Promise<void> => {
  const parsed = z.object({
    fromId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(50000).default(10000),
  }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query" }); return; }

  const { fromId, limit } = parsed.data;
  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(fromId ? gte(auditLogsTable.id, fromId) : undefined)
    .orderBy(asc(auditLogsTable.id))
    .limit(limit);

  let brokenAt: number | null = null;
  let prevHash = "";
  for (const row of rows) {
    const expectedPrev = prevHash;
    if (row.previousHash !== expectedPrev && !(expectedPrev === "" && row.previousHash === "")) {
      brokenAt = row.id;
      break;
    }
    const canonical = JSON.stringify({
      userId: row.userId,
      userName: row.userName,
      role: row.role,
      action: row.action,
      module: row.module,
      entityType: row.entityType,
      entityId: row.entityId,
      oldValue: row.oldValue,
      newValue: row.newValue,
      reason: row.reason,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      previousHash: row.previousHash,
    });
    const recomputed = computeChainHash(canonical);
    if (recomputed !== row.chainHash) {
      brokenAt = row.id;
      break;
    }
    prevHash = row.chainHash;
  }

  res.json({
    checked: rows.length,
    firstId: rows[0]?.id ?? null,
    lastId: rows[rows.length - 1]?.id ?? null,
    integrity: brokenAt === null ? "ok" : "broken",
    brokenAt,
  });
});

// GET /api/super-admin/payment-logs — payment logs for debug screen
superAdminRouter.get("/payment-logs", requireSuperAdminUsb, requireSuperAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(paymentLogsTable)
    .orderBy(desc(paymentLogsTable.id))
    .limit(200);
  res.json({ logs: rows, total: rows.length });
});


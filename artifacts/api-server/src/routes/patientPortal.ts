import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  patientOtpTable,
  patientSessionsTable,
  patientsTable,
  patientReportsTable,
  testsTable,
  onlineBookingsTable,
} from "@workspace/db/schema";
import { and, desc, eq, gt, inArray, lt, sql, type AnyColumn } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendPlainWhatsappText } from "./whatsapp";
import { ensurePublicToken } from "./patient-reports";

/**
 * Patient portal — real auth boundary for the public booking mobile app.
 *
 * Remediation of SECURITY_FINDING_PUBLIC_BOOKING_PHI_EXPOSURE:
 *  - OTP codes are generated with crypto.randomInt, stored ONLY as SHA-256
 *    hashes, delivered out-of-band via WhatsApp, and NEVER echoed in any
 *    response.
 *  - A verified OTP mints a server-side session token (patient_sessions,
 *    same model as the staff portal_sessions), which every data endpoint
 *    requires as a Bearer header. A bare phone number no longer unlocks
 *    anything.
 *  - send-otp only messages numbers already known to the clinic (a patient
 *    record or a prior booking), returning an identical response either way
 *    so it neither enumerates patients nor lets an attacker WhatsApp-bomb an
 *    arbitrary number from the clinic's Business line.
 *  - OTP attempts are consumed via a single atomic conditional UPDATE, so the
 *    per-challenge guess cap holds under concurrent requests.
 *  - Rate limiters are keyed by BOTH ip and phone, so rotating source IPs
 *    can't multiply the guess/send budget for one target.
 *  - Data endpoints return minimal projections keyed to the verified session
 *    phone (matched on normalized digits, since stored numbers may carry a
 *    +91 / spaces / dashes).
 *
 * The legacy phone-keyed endpoints in public-booking.ts (send-otp,
 * verify-otp, my-bookings, my-reports) are retired to 410 Gone in the same
 * change so backend and app move in lockstep.
 */

const patientPortalRouter = Router();

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Reports a patient may see: only finalized states the public PDF route
// itself would serve (see patient-reports.ts /p/r/:token/pdf).
const VISIBLE_REPORT_STATUSES = ["verified", "delivered"];

// ACCEPTED RESIDUAL RISK — phone-as-identity (product decision, documented in
// SECURITY_FINDING_PUBLIC_BOOKING_PHI_EXPOSURE.md §"Patient portal"): reports
// and bookings are scoped to the verified phone, and a clinic patient record's
// `phone` is a contact field, not a per-person id. If the SAME number is put
// on multiple patient records (a family member's phone, or — the case to
// avoid — a shared front-desk/agent number), whoever verifies that number
// sees every report filed under it. This is intended for a genuine personal/
// family number; the operational guard is: never put a shared or clinic-owned
// number on a patient record. Not mitigated in code by design.

// Uniform response for any invalid/expired/exhausted verify — deliberately
// indistinguishable so a caller can't tell whether a live challenge exists
// for a phone (login-activity oracle) or how many guesses remain.
const OTP_REJECT = { error: "Invalid or expired code. Please request a new one." };

// Bucket rate limiters by phone as well as IP so an attacker rotating source
// addresses (proxy pool, IPv6 /64) can't stack the per-IP budget against one
// target. Falls back to IP when no valid phone is supplied.
function ipPlusPhoneKey(req: Request): string {
  const phone = validPhone((req.body as { phone?: string })?.phone) || "nophone";
  return `${req.ip}|${phone}`;
}

const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipPlusPhoneKey,
  message: { error: "Too many code requests. Please try again in a few minutes." },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipPlusPhoneKey,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

const hashOtp = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

function validPhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

// SQL fragment: does this stored (possibly-formatted) phone column match the
// verified session's bare 10-digit phone once both are reduced to their last
// 10 digits? Handles "+91 98765 43210", "098765-43210", etc.
function phoneMatches(column: AnyColumn, phone10: string) {
  return sql`right(regexp_replace(${column}, '[^0-9]', '', 'g'), 10) = ${phone10}`;
}

// Does this phone (bare 10 digits) belong to an existing clinic patient or a
// prior online booking? Gate OTP delivery on this so the clinic's WhatsApp
// line can't be used to message arbitrary strangers.
async function isKnownPhone(phone10: string): Promise<boolean> {
  const [hit] = await db
    .select({ one: sql<number>`1` })
    .from(patientsTable)
    .where(phoneMatches(patientsTable.phone, phone10))
    .limit(1);
  if (hit) return true;
  const [booking] = await db
    .select({ one: sql<number>`1` })
    .from(onlineBookingsTable)
    .where(phoneMatches(onlineBookingsTable.phone, phone10))
    .limit(1);
  return !!booking;
}

// ── POST /api/patient/send-otp ───────────────────────────────────────────────
patientPortalRouter.post("/send-otp", otpSendLimiter, async (req, res) => {
  const phone = validPhone((req.body as { phone?: string })?.phone);
  if (!phone) return res.status(400).json({ error: "A valid 10-digit phone number is required." });

  // Uniform success response used on every non-error path, so the caller
  // cannot distinguish "known number, code sent" from "unknown number,
  // nothing sent" (no patient enumeration) or "still in cooldown".
  const uniformOk = () => res.json({ sent: true, channel: "whatsapp" });

  // Per-phone resend cooldown (on top of the ip+phone limiter).
  const [latest] = await db
    .select({ createdAt: patientOtpTable.createdAt })
    .from(patientOtpTable)
    .where(eq(patientOtpTable.phone, phone))
    .orderBy(desc(patientOtpTable.createdAt))
    .limit(1);
  if (latest && Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return uniformOk();
  }

  // Only ever message a number the clinic already knows.
  if (!(await isKnownPhone(phone))) {
    logger.info({ phone: phone.slice(-4) }, "patient OTP requested for unknown number — not sent");
    return uniformOk();
  }

  const code = String(crypto.randomInt(100000, 1000000));

  // Deliver FIRST — only persist a challenge that actually went out.
  const sent = await sendPlainWhatsappText(
    phone,
    `${code} is your Care Diagnostics login code. It expires in 5 minutes. Never share this code.`,
  );
  if (!sent.ok) {
    logger.warn({ phone: phone.slice(-4), error: sent.error, skipped: sent.skipped }, "patient OTP WhatsApp send failed");
    return res.status(502).json({
      error: "Could not deliver the code via WhatsApp. Please try again or contact the clinic.",
    });
  }

  // One live challenge per phone.
  await db.delete(patientOtpTable).where(eq(patientOtpTable.phone, phone));
  await db.insert(patientOtpTable).values({
    phone,
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  return uniformOk();
});

// ── POST /api/patient/verify-otp ─────────────────────────────────────────────
patientPortalRouter.post("/verify-otp", otpVerifyLimiter, async (req, res) => {
  const body = req.body as { phone?: string; code?: string; name?: string };
  const phone = validPhone(body?.phone);
  const code = String(body?.code ?? "").replace(/\D/g, "");
  if (!phone || code.length !== 6) {
    return res.status(400).json({ error: "Phone and 6-digit code are required." });
  }

  const [challenge] = await db
    .select()
    .from(patientOtpTable)
    .where(eq(patientOtpTable.phone, phone))
    .orderBy(desc(patientOtpTable.createdAt))
    .limit(1);

  if (!challenge) {
    return res.status(400).json(OTP_REJECT);
  }

  // Consume one attempt ATOMICALLY before comparing: a single conditional
  // UPDATE that only succeeds while the challenge is unexpired and under the
  // attempt cap. Concurrent guesses each increment exactly once, so the cap
  // holds regardless of race — the previous read-then-write was a lost-update
  // TOCTOU that let a burst of parallel guesses share one attempt slot.
  const claimed = await db
    .update(patientOtpTable)
    .set({ attempts: sql`${patientOtpTable.attempts} + 1` })
    .where(
      and(
        eq(patientOtpTable.id, challenge.id),
        lt(patientOtpTable.attempts, OTP_MAX_ATTEMPTS),
        gt(patientOtpTable.expiresAt, new Date()),
      ),
    )
    .returning({ id: patientOtpTable.id });
  if (claimed.length === 0) {
    // Expired or attempts exhausted — uniform rejection.
    return res.status(400).json(OTP_REJECT);
  }

  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(hashOtp(code), "hex");
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    return res.status(400).json(OTP_REJECT);
  }

  await db.delete(patientOtpTable).where(eq(patientOtpTable.phone, phone));

  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : null;
  const token = crypto.randomBytes(24).toString("hex");
  await db.insert(patientSessionsTable).values({
    token,
    phone,
    name: name || null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").slice(0, 100),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
  });

  return res.json({ verified: true, token, phone, name: name || "" });
});

// ── Session middleware ───────────────────────────────────────────────────────

type PatientRequest = Request & { patientPhone?: string; patientSessionId?: number };

async function requirePatientSession(req: PatientRequest, res: Response, next: NextFunction): Promise<void> {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length < 32) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  const [session] = await db
    .select()
    .from(patientSessionsTable)
    .where(and(eq(patientSessionsTable.token, token), gt(patientSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!session) {
    res.status(401).json({ error: "Session expired. Please log in again." });
    return;
  }
  req.patientPhone = session.phone;
  req.patientSessionId = session.id;
  // Touch activity at most once a minute to avoid a write per request.
  if (Date.now() - session.lastActivityAt.getTime() > 60_000) {
    db.update(patientSessionsTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(patientSessionsTable.id, session.id))
      .catch(() => {});
  }
  next();
}

// ── POST /api/patient/logout ─────────────────────────────────────────────────
patientPortalRouter.post("/logout", requirePatientSession, async (req: PatientRequest, res) => {
  await db.delete(patientSessionsTable).where(eq(patientSessionsTable.id, req.patientSessionId!));
  return res.json({ success: true });
});

// ── GET /api/patient/my-bookings ─────────────────────────────────────────────
// Minimal projection — no email, notes, test lists, or gateway txn ids here;
// per-booking detail stays on GET /api/public/booking/by-ref (ref-keyed).
patientPortalRouter.get("/my-bookings", requirePatientSession, async (req: PatientRequest, res) => {
  const rows = await db
    .select({
      id: onlineBookingsTable.id,
      bookingRef: onlineBookingsTable.bookingRef,
      name: onlineBookingsTable.name,
      selectedDate: onlineBookingsTable.selectedDate,
      timeSlot: onlineBookingsTable.timeSlot,
      status: onlineBookingsTable.status,
      totalAmount: onlineBookingsTable.totalAmount,
      createdAt: onlineBookingsTable.createdAt,
    })
    .from(onlineBookingsTable)
    .where(phoneMatches(onlineBookingsTable.phone, req.patientPhone!))
    .orderBy(desc(onlineBookingsTable.id))
    .limit(50);
  return res.json({ bookings: rows });
});

// ── GET /api/patient/my-reports ──────────────────────────────────────────────
// Reports belonging to clinic patients whose registered phone matches the
// verified session phone. Metadata only — the PDF itself is fetched through
// a short-lived token minted by POST /reports/:id/link.
patientPortalRouter.get("/my-reports", requirePatientSession, async (req: PatientRequest, res) => {
  const patients = await db
    .select({ id: patientsTable.id, firstName: patientsTable.firstName, lastName: patientsTable.lastName })
    .from(patientsTable)
    .where(phoneMatches(patientsTable.phone, req.patientPhone!));
  if (patients.length === 0) return res.json({ reports: [] });

  const nameById = new Map(patients.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
  const rows = await db
    .select({
      id: patientReportsTable.id,
      reportNumber: patientReportsTable.reportNumber,
      title: patientReportsTable.title,
      type: patientReportsTable.type,
      status: patientReportsTable.status,
      patientId: patientReportsTable.patientId,
      verifiedAt: patientReportsTable.verifiedAt,
      createdAt: patientReportsTable.createdAt,
      testName: testsTable.name,
    })
    .from(patientReportsTable)
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(
      and(
        inArray(patientReportsTable.patientId, patients.map((p) => p.id)),
        inArray(patientReportsTable.status, VISIBLE_REPORT_STATUSES),
      ),
    )
    .orderBy(desc(patientReportsTable.createdAt))
    .limit(100);

  return res.json({
    reports: rows.map((r) => ({
      id: r.id,
      reportNumber: r.reportNumber,
      title: r.title || r.testName || "Lab Report",
      type: r.type,
      status: r.status,
      patientName: nameById.get(r.patientId) || "",
      date: (r.verifiedAt ?? r.createdAt)?.toISOString?.() ?? null,
    })),
  });
});

// ── POST /api/patient/reports/:id/link ───────────────────────────────────────
// Mint (or reuse) the short-lived public PDF token for a report the session
// owner is entitled to, and return the relative URL of the existing public
// serving route. Ownership = report.patientId belongs to a clinic patient
// whose phone matches the session phone; status must be patient-visible.
patientPortalRouter.post("/reports/:id/link", requirePatientSession, async (req: PatientRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });

  const [report] = await db
    .select({
      id: patientReportsTable.id,
      status: patientReportsTable.status,
      patientId: patientReportsTable.patientId,
    })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.id, id));
  if (!report || !VISIBLE_REPORT_STATUSES.includes(report.status)) {
    return res.status(404).json({ error: "Report not found" });
  }

  const [owner] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, report.patientId), phoneMatches(patientsTable.phone, req.patientPhone!)))
    .limit(1);
  if (!owner) return res.status(404).json({ error: "Report not found" });

  const token = await ensurePublicToken(report.id);
  if (!token) return res.status(500).json({ error: "Could not create report link" });

  logger.info({ reportId: report.id, phone: req.patientPhone!.slice(-4) }, "patient portal report link minted");
  return res.json({ url: `/api/p/r/${token}/pdf` });
});

export { patientPortalRouter };

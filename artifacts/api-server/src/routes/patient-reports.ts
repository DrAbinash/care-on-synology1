import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import {
  patientReportsTable,
  reportSharesTable,
  signaturesTable,
  patientsTable,
  testsTable,
  clinicSettingsTable,
  reportTemplatesTable,
  radiologyStudiesTable,
  radiologyInstitutionalStylesTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql, ilike, or, isNull, isNotNull } from "drizzle-orm";
import { sendReportWhatsapp, sendReportDelivery } from "./whatsapp";
import crypto from "node:crypto";
import {
  whatsappSettingsTable,
  radiologyShareLinksTable,
} from "@workspace/db/schema";
import { sendReportEmail } from "../email";
import { requireStaffAuth } from "../middleware/requireStaffAuth";

export const patientReportsRouter: IRouter = Router();
export const signaturesRouter: IRouter = Router();
// Public — no auth. Mounted at /api/p/r in routes/index.ts. Used by patient
// WhatsApp links to download a verified report PDF without staff sign-in.
export const publicReportsRouter: IRouter = Router();

// One-time startup backfill: clear any publicToken values that were minted
// before the publicTokenExpiresAt column existed. Those tokens have no expiry
// and the public download route now treats NULL expiry as expired, so clearing
// the token field simply makes the rejection explicit and immediate.
export async function backfillExpirePublicTokens(): Promise<void> {
  // Only target rows that already have a token but lack an expiry — rows that
  // never had a public token need no change and should not be touched.
  const result = await db.update(patientReportsTable)
    .set({ publicToken: null, publicTokenExpiresAt: null })
    .where(and(isNotNull(patientReportsTable.publicToken), isNull(patientReportsTable.publicTokenExpiresAt)));
  // result.rowCount may or may not be defined depending on driver version
  const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (count > 0) {
    // Use process.stdout to avoid circular import with logger
    process.stdout.write(`[startup] Cleared ${count} legacy public token(s) without expiry\n`);
  }
}

// AUTO_SHARE_TTL_MS: links minted automatically (e.g. on WhatsApp delivery) last
// 72 hours. Explicit /public-link requests always rotate immediately.
const AUTO_SHARE_TTL_MS = 72 * 60 * 60 * 1000;

// ensurePublicToken — used by auto-share paths (WhatsApp on verify).
// Reuses an existing token only if it is still valid; otherwise rotates.
async function ensurePublicToken(reportId: number): Promise<string | null> {
  const [row] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId));
  if (!row) return null;
  const now = new Date();
  const tokenStillValid =
    row.publicToken &&
    row.publicTokenExpiresAt &&
    row.publicTokenExpiresAt > now;
  if (tokenStillValid) return row.publicToken!;
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + AUTO_SHARE_TTL_MS);
  const [updated] = await db.update(patientReportsTable)
    .set({ publicToken: token, publicTokenExpiresAt: expiresAt })
    .where(eq(patientReportsTable.id, reportId))
    .returning();
  return updated?.publicToken ?? token;
}

// rotatePublicToken — always issues a fresh token with a new expiry.
// Called by the explicit POST /patient-reports/:id/public-link endpoint so
// that every share request invalidates the previous link.
async function rotatePublicToken(reportId: number): Promise<{ token: string; expiresAt: Date } | null> {
  const [row] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId));
  if (!row) return null;
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + AUTO_SHARE_TTL_MS);
  await db.update(patientReportsTable)
    .set({ publicToken: token, publicTokenExpiresAt: expiresAt })
    .where(eq(patientReportsTable.id, reportId));
  return { token, expiresAt };
}

// Defense-in-depth: enforce staff authentication at the router level.
// The print/pdf/share endpoints render patient PHI into HTML; the create/patch
// endpoints store parameters whose flag values are interpolated into HTML.
// Neither must be reachable without a valid staff session.
patientReportsRouter.use(requireStaffAuth);
signaturesRouter.use(requireStaffAuth);

// ────────────────────────────────────────────────────────────────────────────
// Signatures CRUD
// ────────────────────────────────────────────────────────────────────────────
signaturesRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(signaturesTable).orderBy(desc(signaturesTable.isActive), signaturesTable.name);
  res.json(rows);
});

// Strict allowlist: PNG/JPEG base64 data URLs only. Rejects SVG (script-bearing),
// non-base64 encodings, and anything that could break out of the <img src="…"> attribute.
const SIGNATURE_DATA_URL_RE = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/;

signaturesRouter.post("/", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const imageDataUrl = String(b.imageDataUrl ?? "").trim();
  if (!name || !imageDataUrl) {
    res.status(400).json({ error: "name and imageDataUrl are required" });
    return;
  }
  if (!SIGNATURE_DATA_URL_RE.test(imageDataUrl)) {
    res.status(400).json({ error: "imageDataUrl must be a base64 data URL of a PNG or JPEG (no SVG)" });
    return;
  }
  const [row] = await db.insert(signaturesTable).values({
    name,
    role: String(b.role ?? "Doctor").trim() || "Doctor",
    qualification: String(b.qualification ?? "").trim(),
    registrationNo: String(b.registrationNo ?? "").trim(),
    imageDataUrl,
    isActive: b.isActive === false ? false : true,
  }).returning();
  res.status(201).json(row);
});

signaturesRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (typeof b.name === "string") updates.name = b.name.trim();
  if (typeof b.role === "string") updates.role = b.role.trim();
  if (typeof b.qualification === "string") updates.qualification = b.qualification.trim();
  if (typeof b.registrationNo === "string") updates.registrationNo = b.registrationNo.trim();
  if (typeof b.imageDataUrl === "string" && b.imageDataUrl) {
    if (!SIGNATURE_DATA_URL_RE.test(b.imageDataUrl)) {
      res.status(400).json({ error: "imageDataUrl must be a base64 data URL of a PNG or JPEG (no SVG)" });
      return;
    }
    updates.imageDataUrl = b.imageDataUrl;
  }
  if (typeof b.isActive === "boolean") updates.isActive = b.isActive;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [row] = await db.update(signaturesTable).set(updates).where(eq(signaturesTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Signature not found" });
    return;
  }
  res.json(row);
});

signaturesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  // Soft-delete (deactivate) so existing reports retain their signature reference.
  const [row] = await db.update(signaturesTable).set({ isActive: false }).where(eq(signaturesTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Signature not found" });
    return;
  }
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────────────
// Reports — list + filter
// ────────────────────────────────────────────────────────────────────────────
patientReportsRouter.get("/", async (req, res) => {
  const { status, type, critical, patientId, search } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conds = [] as ReturnType<typeof eq>[];
  if (status) conds.push(eq(patientReportsTable.status, status));
  if (type) conds.push(eq(patientReportsTable.type, type));
  if (critical === "true") conds.push(eq(patientReportsTable.isCritical, true));
  if (patientId) conds.push(eq(patientReportsTable.patientId, Number(patientId)));
  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    conds.push(or(
      ilike(patientReportsTable.reportNumber, like),
      ilike(patientReportsTable.title, like),
      ilike(patientsTable.firstName, like),
      ilike(patientsTable.lastName, like),
      ilike(patientsTable.patientId, like),
    )!);
  }

  let q = db
    .select({
      r: patientReportsTable,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      patientCode: patientsTable.patientId,
      patientPhone: patientsTable.phone,
      patientEmail: patientsTable.email,
      testName: testsTable.name,
      testCode: testsTable.code,
    })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientReportsTable.patientId, patientsTable.id))
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .$dynamic();
  if (conds.length > 0) q = q.where(and(...conds));

  let countQ = db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientReportsTable.patientId, patientsTable.id))
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .$dynamic();
  if (conds.length > 0) countQ = countQ.where(and(...conds));

  const [rows, [{ n: total } = { n: 0 }]] = await Promise.all([
    q.orderBy(desc(patientReportsTable.createdAt)).limit(limit).offset(offset),
    countQ,
  ]);

  const items = rows.map((row) => ({
    ...row.r,
    patientName: [row.patientFirstName, row.patientLastName].filter(Boolean).join(" "),
    patientCode: row.patientCode,
    patientPhone: row.patientPhone,
    patientEmail: row.patientEmail,
    testName: row.testName,
    testCode: row.testCode,
  }));

  // Backward-compatible: also return raw array shape via header negotiation off.
  // Frontend handles both shapes (Array.isArray check), but new shape carries pagination metadata.
  res.json({ items, total, limit, offset });
});

patientReportsRouter.get("/stats", async (_req, res) => {
  const [{ totalReports = 0, criticalUnack = 0, pendingVerification = 0, drafts = 0, deliveredToday = 0 }] = await db.execute<{
    totalReports: number; criticalUnack: number; pendingVerification: number; drafts: number; deliveredToday: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM patient_reports) AS "totalReports",
      (SELECT COUNT(*)::int FROM patient_reports WHERE is_critical = true AND critical_acknowledged_at IS NULL) AS "criticalUnack",
      (SELECT COUNT(*)::int FROM patient_reports WHERE status = 'pending_verification') AS "pendingVerification",
      (SELECT COUNT(*)::int FROM patient_reports WHERE status = 'draft') AS "drafts",
      (SELECT COUNT(*)::int FROM patient_reports WHERE delivered_at >= NOW() - INTERVAL '24 hours') AS "deliveredToday"
  `).then((r) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows ?? [])) as unknown as [{
    totalReports: number; criticalUnack: number; pendingVerification: number; drafts: number; deliveredToday: number;
  }];
  res.json({ totalReports, criticalUnack, pendingVerification, drafts, deliveredToday });
});

patientReportsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .select({
      r: patientReportsTable,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      patientCode: patientsTable.patientId,
      patientPhone: patientsTable.phone,
      patientEmail: patientsTable.email,
      patientGender: patientsTable.gender,
      patientDob: patientsTable.dateOfBirth,
      testName: testsTable.name,
      testCode: testsTable.code,
    })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientReportsTable.patientId, patientsTable.id))
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(eq(patientReportsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  const shares = await db.select().from(reportSharesTable).where(eq(reportSharesTable.reportId, id)).orderBy(desc(reportSharesTable.createdAt));
  res.json({
    ...row.r,
    patientName: [row.patientFirstName, row.patientLastName].filter(Boolean).join(" "),
    patientCode: row.patientCode,
    patientPhone: row.patientPhone,
    patientEmail: row.patientEmail,
    patientGender: row.patientGender,
    patientDob: row.patientDob,
    testName: row.testName,
    testCode: row.testCode,
    shares,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Previous reports for a patient (radiology)
// ────────────────────────────────────────────────────────────────────────────

patientReportsRouter.get("/patient/:patientId", async (req, res) => {
  const patientId = Number(req.params.patientId);
  if (!patientId) {
    res.status(400).json({ error: "patientId is required" });
    return;
  }
  const { type } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conds = [eq(patientReportsTable.patientId, patientId)];
  conds.push(eq(patientReportsTable.type, type || "radiology"));

  const rows = await db
    .select({
      r: patientReportsTable,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      testName: testsTable.name,
      testCode: testsTable.code,
    })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientReportsTable.patientId, patientsTable.id))
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(and(...conds))
    .orderBy(desc(patientReportsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total = 0 }] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(patientReportsTable)
    .where(and(...conds));

  res.json({
    items: rows.map((row) => ({
      ...row.r,
      patientName: [row.patientFirstName, row.patientLastName].filter(Boolean).join(" "),
      testName: row.testName,
      testCode: row.testCode,
    })),
    total,
    limit,
    offset,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Report-number generator (RPT-YYYYMMDD-NNN)
// ────────────────────────────────────────────────────────────────────────────
function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
async function nextReportNumber(): Promise<string> {
  const stamp = todayStamp();
  const prefix = `RPT-${stamp}-`;
  // Count today's reports → next sequence number. UNIQUE index protects against
  // collisions; callers retry on collision (very rare in practice).
  const [{ n = 0 }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM patient_reports WHERE report_number LIKE ${prefix + "%"}
  `).then((r) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows ?? [])) as unknown as [{ n: number }];
  return `${prefix}${String(n + 1).padStart(3, "0")}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Create
// ────────────────────────────────────────────────────────────────────────────
patientReportsRouter.post("/", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const patientId = Number(b.patientId);
  const testId = Number(b.testId);
  if (!patientId || !testId) {
    res.status(400).json({ error: "patientId and testId are required" });
    return;
  }
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  const [test] = await db.select().from(testsTable).where(eq(testsTable.id, testId));
  if (!patient || !test) {
    res.status(404).json({ error: "Patient or test not found" });
    return;
  }
  const type = (String(b.type ?? "") || (test.department && /(USG|MRI|CT|X-?RAY|MAMMO|DEXA|RAD)/i.test(test.department) ? "radiology" : "pathology")).toLowerCase();

  let presetUsed = typeof b.stylePresetUsed === "string" ? b.stylePresetUsed : null;
  if (!presetUsed && type === "radiology") {
    try {
      const [style] = await db.select({ presetName: radiologyInstitutionalStylesTable.presetName }).from(radiologyInstitutionalStylesTable).limit(1);
      if (style) {
        presetUsed = style.presetName;
      }
    } catch {
      // ignore query error
    }
  }

  // Retry on UNIQUE collision for the report number.
  for (let attempt = 0; attempt < 3; attempt++) {
    const reportNumber = await nextReportNumber();
    try {
      const [row] = await db.insert(patientReportsTable).values({
        reportNumber,
        type,
        patientId,
        testId,
        orderTestId: b.orderTestId ? Number(b.orderTestId) : null,
        orderId: b.orderId ? Number(b.orderId) : null,
        billId: b.billId ? Number(b.billId) : null,
        studyId: b.studyId ? Number(b.studyId) : null,
        title: String(b.title ?? `${test.name} — Report`).trim(),
        body: typeof b.body === "string" ? b.body : "",
        parameters: typeof b.parameters === "string" ? b.parameters : (b.parameters ? JSON.stringify(b.parameters) : null),
        impression: typeof b.impression === "string" ? b.impression : null,
        templateId: b.templateId ? Number(b.templateId) : null,
        createdBy: typeof b.createdBy === "string" ? b.createdBy : null,
        isCritical: b.isCritical === true,
        criticalNote: typeof b.criticalNote === "string" ? b.criticalNote : null,
        stylePresetUsed: presetUsed,
      }).returning();
      res.status(201).json(row);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate key|unique/i.test(msg) || attempt === 2) {
        req.log?.error({ err }, "patient_reports insert failed");
        res.status(500).json({ error: "Failed to create report" });
        return;
      }
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Update body / parameters / critical
// ────────────────────────────────────────────────────────────────────────────
patientReportsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const [existing] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  // Once verified, only critical-ack and re-share are allowed.
  if (existing.status === "verified" || existing.status === "delivered") {
    if (
      typeof b.body === "string" || typeof b.parameters !== "undefined" ||
      typeof b.title === "string" || typeof b.impression === "string"
    ) {
      res.status(409).json({ error: "Verified reports cannot be edited. Use Amend instead." });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (typeof b.title === "string") updates.title = b.title.trim();
  if (typeof b.body === "string") updates.body = b.body;
  if (typeof b.impression === "string") updates.impression = b.impression;
  if (typeof b.parameters === "string") updates.parameters = b.parameters;
  if (Array.isArray(b.parameters)) updates.parameters = JSON.stringify(b.parameters);
  if (typeof b.templateId === "number") updates.templateId = b.templateId;
  if (typeof b.isCritical === "boolean") {
    updates.isCritical = b.isCritical;
    if (!b.isCritical) {
      updates.criticalNote = null;
      updates.criticalAcknowledgedAt = null;
      updates.criticalAcknowledgedBy = null;
    }
  }
  if (typeof b.criticalNote === "string") updates.criticalNote = b.criticalNote;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [row] = await db.update(patientReportsTable).set(updates).where(eq(patientReportsTable.id, id)).returning();
  res.json(row);
});

// ────────────────────────────────────────────────────────────────────────────
// Sign — primary doctor signs and moves status to pending_verification
// ────────────────────────────────────────────────────────────────────────────
patientReportsRouter.post("/:id/sign", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const signatureId = b.signatureId ? Number(b.signatureId) : null;
  const [existing] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  if (existing.status === "verified" || existing.status === "delivered") {
    res.status(409).json({ error: "Report already verified" });
    return;
  }
  let signedByName = typeof b.signedByName === "string" ? b.signedByName.trim() : "";
  if (signatureId) {
    const [sig] = await db.select().from(signaturesTable).where(eq(signaturesTable.id, signatureId));
    if (!sig) {
      res.status(404).json({ error: "Signature not found" });
      return;
    }
    if (!signedByName) signedByName = sig.name;
  }
  if (!signedByName) {
    res.status(400).json({ error: "signedByName or signatureId required" });
    return;
  }
  const [row] = await db.update(patientReportsTable).set({
    signatureId,
    signedByName,
    signedAt: new Date(),
    status: "pending_verification",
  }).where(eq(patientReportsTable.id, id)).returning();
  res.json(row);
});

// ────────────────────────────────────────────────────────────────────────────
// Verify — different person counter-signs and moves status to verified
// ────────────────────────────────────────────────────────────────────────────
patientReportsRouter.post("/:id/verify", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const verifierSigId = b.signatureId ? Number(b.signatureId) : null;
  const [existing] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  if (existing.status === "draft") {
    res.status(409).json({ error: "Sign the report first before verifying" });
    return;
  }
  if (existing.status === "verified" || existing.status === "delivered") {
    res.status(409).json({ error: "Report already verified" });
    return;
  }
  let verifiedByName = typeof b.verifiedByName === "string" ? b.verifiedByName.trim() : "";
  if (verifierSigId) {
    const [sig] = await db.select().from(signaturesTable).where(eq(signaturesTable.id, verifierSigId));
    if (!sig) {
      res.status(404).json({ error: "Verifier signature not found" });
      return;
    }
    if (!verifiedByName) verifiedByName = sig.name;
    if (existing.signatureId && existing.signatureId === verifierSigId) {
      res.status(409).json({ error: "Verifier must be a different person from the signer" });
      return;
    }
  }
  if (!verifiedByName) {
    res.status(400).json({ error: "verifiedByName or signatureId required" });
    return;
  }
  // Block name-based bypass: even if no signatureId is provided, the verifier's
  // name must differ (case-insensitively) from the signer's recorded name.
  if (existing.signedByName && existing.signedByName.trim().toLowerCase() === verifiedByName.toLowerCase()) {
    res.status(409).json({ error: "Verifier must be a different person from the signer" });
    return;
  }
  const [row] = await db.update(patientReportsTable).set({
    verifiedBySignatureId: verifierSigId,
    verifiedByName,
    verifiedAt: new Date(),
    verifierNotes: typeof b.verifierNotes === "string" ? b.verifierNotes : null,
    status: "verified",
  }).where(eq(patientReportsTable.id, id)).returning();

  // Auto-WhatsApp delivery on verify (Feature 3) — best-effort, never blocks
  // the verify response. Honours whatsapp_settings.autoSendOnVerify.
  void (async () => {
    try {
      const [wa] = await db.select().from(whatsappSettingsTable).limit(1);
      if (!wa || !wa.enabled || !wa.autoSendOnVerify) return;
      const [info] = await db
        .select({
          phone: patientsTable.phone,
          firstName: patientsTable.firstName,
          lastName: patientsTable.lastName,
          testName: testsTable.name,
        })
        .from(patientReportsTable)
        .leftJoin(patientsTable, eq(patientReportsTable.patientId, patientsTable.id))
        .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
        .where(eq(patientReportsTable.id, id));
      if (!info?.phone) return;
      const token = await ensurePublicToken(id);
      const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "";
      const reportUrl = `${proto}://${host}/api/p/r/${token}/pdf`;
      // Image viewer: only for radiology reports linked to a study.
      let viewerUrl: string | null = null;
      if (row.studyId && wa.includeViewerLink !== false) {
        // Reuse / mint a "patient" share link for the study viewer.
        const [existing] = await db
          .select()
          .from(radiologyShareLinksTable)
          .where(and(
            eq(radiologyShareLinksTable.studyId, row.studyId),
            eq(radiologyShareLinksTable.audience, "patient"),
          ))
          .orderBy(desc(radiologyShareLinksTable.createdAt))
          .limit(1);
        let viewerToken = existing && !existing.revokedAt && (!existing.expiresAt || existing.expiresAt.getTime() > Date.now())
          ? existing.token
          : null;
        if (!viewerToken) {
          viewerToken = crypto.randomBytes(24).toString("base64url");
          await db.insert(radiologyShareLinksTable).values({
            token: viewerToken,
            studyId: row.studyId,
            audience: "patient",
            expiresAt: new Date(Date.now() + 168 * 3600 * 1000),
          });
        }
        viewerUrl = `${proto}://${host}/api/teleradiology/share/${viewerToken}`;
      }
      const result = await sendReportDelivery({
        phone: info.phone,
        patientName: [info.firstName, info.lastName].filter(Boolean).join(" "),
        reportNumber: row.reportNumber,
        testName: info.testName ?? "Report",
        reportUrl,
        viewerUrl,
      });
      const status = result.ok ? "sent" : "failed";
      await db.insert(reportSharesTable).values({
        reportId: id, channel: "whatsapp", recipient: info.phone,
        sharedBy: "auto-on-verify", status, errorMessage: result.error ?? null,
      }).catch(() => undefined);
      if (result.ok) {
        await db.update(patientReportsTable)
          .set({ status: "delivered", deliveredAt: new Date() })
          .where(eq(patientReportsTable.id, id))
          .catch(() => undefined);
      }
    } catch (err) {
      req.log?.error({ err }, "auto-whatsapp-on-verify failed");
    }
  })();

  res.json(row);
});

// ────────────────────────────────────────────────────────────────────────────
// Tokenized PDF / public download — staff endpoint that mints a token.
// POST /api/patient-reports/:id/public-link → { url, token }
// ────────────────────────────────────────────────────────────────────────────
patientReportsRouter.post("/:id/public-link", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
  if (!row) { res.status(404).json({ error: "Report not found" }); return; }
  if (row.status !== "verified" && row.status !== "delivered") {
    res.status(409).json({ error: "Report must be verified before generating a public link" }); return;
  }
  const rotated = await rotatePublicToken(id);
  if (!rotated) { res.status(500).json({ error: "Could not allocate token" }); return; }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  res.json({ token: rotated.token, expiresAt: rotated.expiresAt.toISOString(), url: `${proto}://${host}/api/p/r/${rotated.token}/pdf` });
});

// Acknowledge a critical alert (silences the dashboard counter).
patientReportsRouter.post("/:id/acknowledge-critical", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const acknowledgedBy = typeof b.acknowledgedBy === "string" ? b.acknowledgedBy.trim() : "";
  if (!acknowledgedBy) {
    res.status(400).json({ error: "acknowledgedBy required" });
    return;
  }
  const [row] = await db.update(patientReportsTable).set({
    criticalAcknowledgedAt: new Date(),
    criticalAcknowledgedBy: acknowledgedBy,
  }).where(eq(patientReportsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(row);
});

// ────────────────────────────────────────────────────────────────────────────
// Print HTML — full A4 letterhead view (also serves as the PDF source)
// ────────────────────────────────────────────────────────────────────────────
function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

type Param = { name: string; result?: string; value?: string; unit?: string; refRange?: string; flag?: string };

export async function buildReportHtml(reportId: number, autoPrint: boolean, useUpdatedStyle?: boolean): Promise<string | null> {
  const [row] = await db
    .select({
      r: patientReportsTable,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      patientCode: patientsTable.patientId,
      patientGender: patientsTable.gender,
      patientDob: patientsTable.dateOfBirth,
      testName: testsTable.name,
      testCode: testsTable.code,
    })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientReportsTable.patientId, patientsTable.id))
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(eq(patientReportsTable.id, reportId));
  if (!row) return null;
  const r = row.r;

  const [clinic] = await db.select().from(clinicSettingsTable).limit(1);

  // Load institutional style if radiology report
  let instStyle: any = null;
  if (r.type === "radiology") {
    try {
      if (useUpdatedStyle || r.status === "draft" || r.status === "pending_verification") {
        const [active] = await db.select().from(radiologyInstitutionalStylesTable).limit(1);
        if (active) instStyle = active;
      } else if (r.stylePresetUsed) {
        const [active] = await db.select().from(radiologyInstitutionalStylesTable).limit(1);
        if (active && active.presetName === r.stylePresetUsed) {
          instStyle = active;
        } else {
          const PRESETS: Record<string, any> = {
            "Care Diagnostics Default": {
              presetName: "Care Diagnostics Default",
              sectionOrder: "Technique,Findings,Impression",
              showClinicalHistory: true, showComparison: true, showRecommendation: true, showCriticalCommunication: true, showMeasurements: true,
              headingStyle: "underlined", abnormalEmphasis: "bold_abnormal", spacing: "standard", printLayout: "letterhead", margins: "standard", fontSize: "standard",
              showRadiologistName: true, showDegree: true, showRegNumber: true, showDigitalSignature: true, showTimestamp: true, showQrVerification: true,
            },
            "Compact Radiology": {
              presetName: "Compact Radiology",
              sectionOrder: "Technique,Findings,Impression",
              showClinicalHistory: false, showComparison: false, showRecommendation: true, showCriticalCommunication: true, showMeasurements: false,
              headingStyle: "bold", abnormalEmphasis: "bold_both", spacing: "compact", printLayout: "half_page", margins: "narrow", fontSize: "small",
              showRadiologistName: true, showDegree: true, showRegNumber: false, showDigitalSignature: true, showTimestamp: false, showQrVerification: false,
            },
            "Formal Letterpad": {
              presetName: "Formal Letterpad",
              sectionOrder: "Technique,Findings,Impression",
              showClinicalHistory: true, showComparison: true, showRecommendation: true, showCriticalCommunication: true, showMeasurements: true,
              headingStyle: "bold_underlined", abnormalEmphasis: "bold_impression", spacing: "comfortable", printLayout: "letterhead", margins: "standard", fontSize: "standard",
              showRadiologistName: true, showDegree: true, showRegNumber: true, showDigitalSignature: true, showTimestamp: true, showQrVerification: true,
            },
            "Plain A4": {
              presetName: "Plain A4",
              sectionOrder: "Technique,Findings,Impression",
              showClinicalHistory: true, showComparison: true, showRecommendation: true, showCriticalCommunication: true, showMeasurements: true,
              headingStyle: "plain", abnormalEmphasis: "none", spacing: "standard", printLayout: "a4_plain", margins: "standard", fontSize: "standard",
              showRadiologistName: true, showDegree: true, showRegNumber: true, showDigitalSignature: true, showTimestamp: true, showQrVerification: true,
            }
          };
          const matchedPreset = PRESETS[r.stylePresetUsed];
          if (matchedPreset) {
            instStyle = matchedPreset;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Fallback signature settings
  const showRadiologistName = instStyle ? instStyle.showRadiologistName : true;
  const showDegree = instStyle ? instStyle.showDegree : true;
  const showRegNumber = instStyle ? instStyle.showRegNumber : true;
  const showDigitalSignature = instStyle ? instStyle.showDigitalSignature : true;
  const showTimestamp = instStyle ? instStyle.showTimestamp : true;
  const showQrVerification = instStyle ? instStyle.showQrVerification : true;

  const sigPrimary = r.signatureId ? (await db.select().from(signaturesTable).where(eq(signaturesTable.id, r.signatureId)))[0] : null;
  const sigVerifier = r.verifiedBySignatureId ? (await db.select().from(signaturesTable).where(eq(signaturesTable.id, r.verifiedBySignatureId)))[0] : null;

  const patientName = [row.patientFirstName, row.patientLastName].filter(Boolean).join(" ");
  const ageStr = (() => {
    if (!row.patientDob) return "";
    const dob = new Date(row.patientDob);
    const yrs = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
    return `${yrs}y`;
  })();

  let parametersHtml = "";
  if (r.parameters) {
    try {
      const arr = JSON.parse(r.parameters) as Param[];
      if (Array.isArray(arr) && arr.length > 0) {
        parametersHtml = `
          <table class="params">
            <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference Range</th></tr></thead>
            <tbody>
              ${arr.map((p) => {
                const result = String(p.result ?? p.value ?? "");
                const flag = String(p.flag ?? "normal").toLowerCase();
                // Restrict flag to a safe CSS class suffix: only lowercase letters,
                // digits, and hyphens. This prevents attribute injection.
                const safeFlag = flag.replace(/[^a-z0-9-]/g, "");
                const flagged = safeFlag !== "normal" && safeFlag !== "";
                return `<tr class="${flagged ? "abnormal" : ""}">
                  <td>${escapeHtml(p.name)}</td>
                  <td><strong>${escapeHtml(result)}</strong>${flagged ? ` <span class="flag flag-${safeFlag}">${escapeHtml(safeFlag.toUpperCase())}</span>` : ""}</td>
                  <td>${escapeHtml(p.unit ?? "")}</td>
                  <td>${escapeHtml(p.refRange ?? "")}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>`;
      }
    } catch { /* ignore parse errors */ }
  }

  const verifiedBlock = r.verifiedAt
    ? `<div class="stamp verified">VERIFIED on ${new Date(r.verifiedAt).toLocaleString("en-IN")}</div>`
    : (r.signedAt ? `<div class="stamp pending">PRELIMINARY — pending verification</div>` : `<div class="stamp draft">DRAFT (not signed)</div>`);
  const criticalBanner = r.isCritical
    ? `<div class="critical">⚠ CRITICAL VALUE — IMMEDIATE ATTENTION REQUIRED${r.criticalNote ? `: ${escapeHtml(r.criticalNote)}` : ""}</div>`
    : "";

  function sigBlock(sig: typeof sigPrimary, fallbackName: string | null, label: string, when: Date | null) {
    if (!sig && !fallbackName) return "";
    const img = (sig?.imageDataUrl && showDigitalSignature) ? `<img src="${sig.imageDataUrl}" alt="signature"/>` : "";
    const name = showRadiologistName ? (sig?.name ?? fallbackName ?? "") : "";
    const reg = (sig?.registrationNo && showRegNumber) ? `Reg. No: ${escapeHtml(sig.registrationNo)}` : "";
    const qual = (sig?.qualification && showDegree) ? escapeHtml(sig.qualification) : "";
    const role = sig?.role ? escapeHtml(sig.role) : "";
    const timeStr = (when && showTimestamp) ? ` ${new Date(when).toLocaleString("en-IN")}` : "";
    return `
      <div class="sigbox">
        <div class="sigimg">${img}</div>
        <div class="sigline"></div>
        <div class="signame">${escapeHtml(name)}</div>
        <div class="sigmeta">${qual}${qual && role ? " • " : ""}${role}</div>
        <div class="sigmeta">${reg}</div>
        <div class="sigmeta sigwhen">${label}${timeStr}</div>
      </div>`;
  }

  // Build style overrides
  let customStyles = "";
  if (instStyle) {
    const fs = instStyle.fontSize === "small" ? "11px" : instStyle.fontSize === "large" ? "15px" : "13px";
    const marginVal = instStyle.margins === "narrow" ? "14mm 10mm" : instStyle.margins === "wide" ? "20mm 25mm" : "14mm";
    const spacingVal = instStyle.spacing === "compact" ? "2px" : instStyle.spacing === "comfortable" ? "18px" : "10px";
    const lineHt = instStyle.spacing === "compact" ? "1.2" : instStyle.spacing === "comfortable" ? "1.7" : "1.45";

    customStyles = `
      @page { size: A4; margin: ${marginVal}; }
      body { font-size: ${fs} !important; line-height: ${lineHt} !important; }
      .body p, .body div { margin-bottom: ${spacingVal} !important; }
    `;

    if (instStyle.printLayout === "screen_only") {
      customStyles += `
        @media print {
          body { display: none !important; }
        }
      `;
    }
    if (instStyle.printLayout === "half_page") {
      customStyles += `
        body { height: 50% !important; border: 1px dashed #ccc !important; padding: 10px !important; }
      `;
    }
  }

  const qrHtml = (showQrVerification && r.type === "radiology") ? `
    <div style="float:left;margin-top:10px;text-align:left;">
      <div style="display:inline-block;padding:4px;border:1px solid #ccc;background:#fff;border-radius:4px;">
        <span style="font-size:8px;display:block;color:#666;font-weight:bold;">QR Verification</span>
        <div style="width:50px;height:50px;background:#000;color:#fff;font-size:7px;display:flex;align-items:center;justify-content:center;font-weight:bold;">SECURE</div>
      </div>
    </div>
  ` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.reportNumber)} — ${escapeHtml(r.title)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color:#111; margin:0; font-size:12px; }
      .hdr { display:flex; align-items:center; gap:14px; border-bottom:3px solid #4338ca; padding-bottom:10px; margin-bottom:12px; }
      .hdr img { width:60px; height:60px; object-fit:contain; }
      .hdr .name { font-size:20px; font-weight:800; color:#1e1b4b; line-height:1.1; }
      .hdr .tagline { color:#475569; font-size:11px; }
      .hdr .contact { margin-left:auto; text-align:right; font-size:10px; color:#475569; line-height:1.4; }
      .meta { display:grid; grid-template-columns:repeat(4, 1fr); gap:6px 14px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px; margin-bottom:14px; }
      .meta div span { color:#64748b; display:block; font-size:9px; text-transform:uppercase; letter-spacing:0.5px; }
      .meta div strong { font-size:12px; }
      h1.title { font-size:16px; margin:0 0 6px; color:#1e1b4b; }
      .impression { background:#fef9c3; border-left:3px solid #ca8a04; padding:8px 12px; margin:0 0 12px; font-size:12px; }
      .body { white-space:pre-wrap; line-height:1.5; margin:0 0 14px; }
      .params { width:100%; border-collapse:collapse; margin:10px 0 16px; font-size:11px; }
      .params th { background:#1e1b4b; color:#fff; padding:6px 8px; text-align:left; }
      .params td { padding:5px 8px; border-bottom:1px solid #e2e8f0; }
      .params tr.abnormal td { background:#fef2f2; }
      .flag { font-size:9px; padding:1px 5px; border-radius:3px; font-weight:700; }
      .flag-low { background:#dbeafe; color:#1e40af; }
      .flag-high { background:#fee2e2; color:#b91c1c; }
      .flag-critical { background:#7f1d1d; color:#fff; }
      .stamp { display:inline-block; padding:4px 12px; border-radius:4px; font-weight:700; font-size:11px; margin:8px 0; }
      .stamp.verified { background:#dcfce7; color:#166534; border:1px solid #86efac; }
      .stamp.pending { background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
      .stamp.draft { background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; }
      .critical { background:#7f1d1d; color:#fff; padding:8px 12px; font-weight:800; font-size:13px; margin:0 0 12px; border-radius:4px; letter-spacing:0.3px; }
      .sigs { display:flex; gap:30px; justify-content:flex-end; margin-top:30px; }
      .sigbox { width:200px; text-align:center; }
      .sigbox .sigimg { height:50px; display:flex; align-items:flex-end; justify-content:center; }
      .sigbox .sigimg img { max-height:50px; max-width:180px; object-fit:contain; }
      .sigline { border-top:1.5px solid #111; margin:2px 0 4px; }
      .signame { font-weight:700; font-size:12px; }
      .sigmeta { font-size:10px; color:#475569; line-height:1.3; }
      .sigwhen { margin-top:3px; font-style:italic; }
      .ftr { margin-top:18px; font-size:9px; color:#64748b; text-align:center; border-top:1px solid #cbd5e1; padding-top:6px; clear: both; }
      .reportno { float:right; font-family:monospace; color:#475569; font-size:10px; }
      ${customStyles}
    </style></head><body>
      <div class="hdr">
        ${clinic?.logoDataUrl ? `<img src="${clinic.logoDataUrl}" alt="logo"/>` : ""}
        <div>
          <div class="name">${escapeHtml(clinic?.name ?? "Care Diagnostics")}</div>
          <div class="tagline">${escapeHtml(clinic?.tagline ?? "")}</div>
        </div>
        <div class="contact">
          ${escapeHtml(clinic?.address ?? "")}<br/>
          ${escapeHtml(clinic?.phone ?? "")} ${clinic?.email ? `• ${escapeHtml(clinic.email)}` : ""}<br/>
          ${clinic?.website ? escapeHtml(clinic.website) : ""}
        </div>
      </div>
      <span class="reportno">Report #: ${escapeHtml(r.reportNumber)}</span>
      <h1 class="title">${escapeHtml(r.title)}</h1>
      <div class="meta">
        <div><span>Patient</span><strong>${escapeHtml(patientName)}</strong></div>
        <div><span>Patient ID</span><strong>${escapeHtml(row.patientCode ?? "—")}</strong></div>
        <div><span>Age / Sex</span><strong>${ageStr}${ageStr && row.patientGender ? " / " : ""}${escapeHtml(row.patientGender ?? "")}</strong></div>
        <div><span>Date</span><strong>${new Date(r.createdAt).toLocaleDateString("en-IN")}</strong></div>
        <div><span>Test</span><strong>${escapeHtml(row.testName ?? "—")}</strong></div>
        <div><span>Test Code</span><strong>${escapeHtml(row.testCode ?? "—")}</strong></div>
        <div><span>Type</span><strong>${escapeHtml(r.type.toUpperCase())}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(r.status.replace(/_/g, " ").toUpperCase())}</strong></div>
      </div>
      ${criticalBanner}
      ${r.impression ? `<div class="impression"><strong>Impression:</strong> ${escapeHtml(r.impression)}</div>` : ""}
      ${parametersHtml}
      ${r.body ? `<div class="body">${r.type === "radiology" ? r.body : escapeHtml(r.body)}</div>` : ""}
      ${verifiedBlock}
      <div class="sigs">
        ${sigBlock(sigPrimary, r.signedByName, "Signed:", r.signedAt as Date | null)}
        ${sigBlock(sigVerifier, r.verifiedByName, "Verified:", r.verifiedAt as Date | null)}
      </div>
      ${qrHtml}
      <div class="ftr">${escapeHtml(clinic?.footerNote ?? "")} • Generated ${new Date().toLocaleString("en-IN")}</div>
      ${autoPrint ? `<script>window.onload=()=>{setTimeout(()=>window.print(),250);}</script>` : ""}
    </body></html>`;
}

patientReportsRouter.get("/:id/print", async (req, res) => {
  const id = Number(req.params.id);
  const useUpdatedStyle = req.query.useUpdatedStyle === "true";
  const html = await buildReportHtml(id, true, useUpdatedStyle);
  if (!html) {
    res.status(404).send("Report not found");
    return;
  }
  // Log a "print" share entry (best-effort).
  await db.insert(reportSharesTable).values({ reportId: id, channel: "print", sharedBy: (req.query.by as string) || null }).catch(() => {});
  // If the report was verified, mark as delivered on first print.
  await markDeliveredIfVerified(id).catch(() => {});
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// PDF endpoint = same HTML but without auto-print (browser/user can save as PDF).
patientReportsRouter.get("/:id/pdf", async (req, res) => {
  const id = Number(req.params.id);
  const useUpdatedStyle = req.query.useUpdatedStyle === "true";
  const html = await buildReportHtml(id, false, useUpdatedStyle);
  if (!html) {
    res.status(404).send("Report not found");
    return;
  }
  await db.insert(reportSharesTable).values({ reportId: id, channel: "pdf", sharedBy: (req.query.by as string) || null }).catch(() => {});
  await markDeliveredIfVerified(id).catch(() => {});
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// PUBLIC tokenized PDF — no staff auth. Looked up by random token, only
// returns reports that are already verified (no drafts leak to patients).
// Tokens are time-limited: requests after publicTokenExpiresAt are rejected.
publicReportsRouter.get("/:token/pdf", async (req, res) => {
  const token = req.params.token;
  if (!token || token.length < 16) { res.status(404).send("Not found"); return; }
  const [row] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.publicToken, token));
  if (!row) { res.status(404).send("Not found"); return; }
  // Reject tokens that have no expiry (legacy pre-migration tokens) or that
  // have passed their expiry. NULL expiry is treated as expired so that any
  // link minted before this expiry system was introduced cannot be replayed.
  if (!row.publicTokenExpiresAt || row.publicTokenExpiresAt < new Date()) {
    res.status(410).send("This link has expired. Please contact the clinic for a new report link."); return;
  }
  if (row.status !== "verified" && row.status !== "delivered") {
    res.status(403).send("Report not yet finalized"); return;
  }
  const useUpdatedStyle = req.query.useUpdatedStyle === "true";
  const html = await buildReportHtml(row.id, false, useUpdatedStyle);
  if (!html) { res.status(404).send("Not found"); return; }
  await db.insert(reportSharesTable).values({
    reportId: row.id, channel: "pdf", recipient: "public-link",
    sharedBy: "patient-link", status: "sent",
  }).catch(() => undefined);
  await markDeliveredIfVerified(row.id).catch(() => undefined);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

async function markDeliveredIfVerified(id: number) {
  const [row] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
  if (!row) return;
  if (row.status === "verified") {
    await db.update(patientReportsTable).set({ status: "delivered", deliveredAt: new Date() }).where(eq(patientReportsTable.id, id));
  } else if (row.status === "delivered" && !row.deliveredAt) {
    await db.update(patientReportsTable).set({ deliveredAt: new Date() }).where(eq(patientReportsTable.id, id));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Share — WhatsApp / Email
// ────────────────────────────────────────────────────────────────────────────
function reportPublicUrl(req: Request, reportId: number): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}/api/patient-reports/${reportId}/pdf`;
}

patientReportsRouter.post("/:id/share", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const channel = String(b.channel ?? "").toLowerCase();
  if (!["whatsapp", "email", "pdf", "print"].includes(channel)) {
    res.status(400).json({ error: "channel must be whatsapp|email|pdf|print" });
    return;
  }

  const [row] = await db
    .select({ r: patientReportsTable, patientPhone: patientsTable.phone, patientEmail: patientsTable.email, patientFirstName: patientsTable.firstName, patientLastName: patientsTable.lastName, testName: testsTable.name })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientReportsTable.patientId, patientsTable.id))
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(eq(patientReportsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  if (row.r.status !== "verified" && row.r.status !== "delivered") {
    res.status(409).json({ error: "Report must be verified before sharing" });
    return;
  }

  const recipient = (typeof b.recipient === "string" && b.recipient.trim()) ||
    (channel === "whatsapp" ? row.patientPhone : channel === "email" ? row.patientEmail : null);
  const sharedBy = typeof b.sharedBy === "string" ? b.sharedBy : null;
  const url = reportPublicUrl(req, id);
  const patientName = [row.patientFirstName, row.patientLastName].filter(Boolean).join(" ");

  let status: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;

  if (channel === "whatsapp") {
    if (!recipient) {
      res.status(400).json({ error: "No phone number on file. Provide recipient." });
      return;
    }
    const result = await sendReportWhatsapp({ phone: recipient, patientName, reportNumber: row.r.reportNumber, testName: row.testName ?? "Lab Report", reportUrl: url });
    if (!result.ok) { status = "failed"; errorMessage = result.error ?? "WhatsApp send failed"; }
  } else if (channel === "email") {
    if (!recipient) {
      res.status(400).json({ error: "No email on file. Provide recipient." });
      return;
    }
    const html = await buildReportHtml(id, false);
    const result = await sendReportEmail({ to: recipient, subject: `Your Report: ${row.r.reportNumber}`, html: html ?? "", patientName, reportNumber: row.r.reportNumber });
    if (!result.ok) { status = "failed"; errorMessage = result.error ?? "Email send failed"; }
  }

  const [share] = await db.insert(reportSharesTable).values({ reportId: id, channel, recipient, sharedBy, status, errorMessage }).returning();
  if (status === "sent") await markDeliveredIfVerified(id);

  res.json({ ok: status === "sent", share, error: errorMessage });
});

// Helper: list templates for a test (mirror of report-templates filter for convenience).
patientReportsRouter.get("/templates/:testId", async (req, res) => {
  const testId = Number(req.params.testId);
  const rows = await db.select().from(reportTemplatesTable).where(eq(reportTemplatesTable.testId, testId)).orderBy(desc(reportTemplatesTable.isDefault), reportTemplatesTable.name);
  res.json(rows);
});

// Helper: surface radiology-finalized reports as candidates so the hub can
// "promote" them into the patient_reports table without re-typing the body.
patientReportsRouter.get("/from-study/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  res.json({
    patientId: study.patientId,
    testId: study.testId,
    orderTestId: study.orderTestId,
    orderId: study.orderId,
    billId: study.billId,
    studyId: study.id,
    type: "radiology" as const,
    title: `${study.modality} Report — ${study.accessionNumber}`,
    body: study.finalReport ?? study.prelimReport ?? "",
  });
});

export default patientReportsRouter;

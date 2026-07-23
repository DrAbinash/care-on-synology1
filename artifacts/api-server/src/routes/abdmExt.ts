// abdmExt.ts — ABDM/ABHA consent-request lifecycle + ABHA enrolment sessions.
// Additive extension of routes/abdm.ts. Mounted at /api/abdm (second router)
// behind requireStaffAuth + requireStaffPermission("/settings"). Gated by the
// ff_abdm_abha DB flag (Shadow Mode); any real gateway call additionally
// requires ABDM_ENABLED + credentials (isAbdmConfigured) and 503s otherwise.
// Non-financial, additive.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { abdmConsentRequestsTable, abhaEnrolmentSessionsTable, abdmGatewayLogTable, abhaLinksTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { isAbdmConfigured, abdmPost } from "../lib/abdmGateway";
import { canTransitionConsent, last4, buildConsentRequestPayload, buildEnrolmentOtpPayload, buildEnrolmentVerifyPayload } from "../lib/abdmConsentProtocol";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const abdmExtRouter = Router();
abdmExtRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_abdm_abha")) { next(); return; }
  res.status(503).json({ error: "ABDM/ABHA health-ID is disabled. Enable ff_abdm_abha." });
});

function actorOf(req: Request) { const s = (req as StaffAuthRequest).staffSession; return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" }; }
const audit = (req: Request, e: { action: string; entityType?: string; entityId?: string; newValue?: string; reason?: string }) =>
  auditFromRequest(req, { ...actorOf(req), module: "abdm", ...e });

async function logGateway(direction: "in" | "out", endpoint: string, extra: Partial<{ requestId: string; statusCode: number; ok: boolean; summary: string }>): Promise<void> {
  try {
    await db.insert(abdmGatewayLogTable).values({ direction, endpoint, requestId: extra.requestId ?? null, statusCode: extra.statusCode ?? null, ok: extra.ok ?? false, summary: extra.summary ?? null });
  } catch { /* best-effort */ }
}

// ── Consent requests (HIU-initiated) ──────────────────────────────────────────
const consentBody = z.object({
  patientId: z.number().int().positive().optional(),
  abhaAddress: z.string().trim().min(1),
  hiTypes: z.array(z.string().trim().min(1)).min(1).default(["DiagnosticReport"]),
  purposeCode: z.string().trim().optional(),
  purposeText: z.string().trim().optional(),
  dateFrom: z.string(),
  dateTo: z.string(),
  expiry: z.string(),
});

abdmExtRouter.post("/consent-requests", async (req, res) => {
  const p = consentBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const requestId = randomUUID();
  const a = actorOf(req);
  const [row] = await db.insert(abdmConsentRequestsTable).values({
    requestId, patientId: p.data.patientId ?? null, abhaAddress: p.data.abhaAddress,
    purposeCode: p.data.purposeCode ?? "CAREMGT", purposeText: p.data.purposeText ?? null,
    hiTypes: p.data.hiTypes.join(","), dateFrom: new Date(p.data.dateFrom), dateTo: new Date(p.data.dateTo),
    expiry: new Date(p.data.expiry), status: "REQUESTED", initiatedBy: a.userName,
  }).returning();

  // Best-effort gateway initiation (only when configured); never blocks the record.
  if (isAbdmConfigured()) {
    const payload = buildConsentRequestPayload({
      requestId, abhaAddress: p.data.abhaAddress, hiTypes: p.data.hiTypes, purposeCode: p.data.purposeCode ?? "CAREMGT",
      purposeText: p.data.purposeText, dateFrom: p.data.dateFrom, dateTo: p.data.dateTo, expiry: p.data.expiry,
      hiuId: process.env.ABDM_HIP_ID ?? "",
    });
    try {
      const r = await abdmPost("/api/hiecm/consent/v3/request/init", payload, requestId);
      await logGateway("out", "consent/request/init", { requestId, statusCode: r.status, ok: r.ok, summary: r.ok ? "initiated" : "gateway error" });
    } catch (err) {
      await logGateway("out", "consent/request/init", { requestId, ok: false, summary: err instanceof Error ? err.message : "error" });
    }
  }
  await audit(req, { action: "create", entityType: "consent_request", entityId: String(row.id), newValue: requestId });
  res.status(201).json(row);
});

abdmExtRouter.get("/consent-requests", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const rows = await db.select().from(abdmConsentRequestsTable)
    .where(status ? eq(abdmConsentRequestsTable.status, status) : undefined)
    .orderBy(desc(abdmConsentRequestsTable.createdAt)).limit(500);
  res.json(rows);
});

// Transition a consent request (grant / deny / revoke / expire), validated.
abdmExtRouter.post("/consent-requests/:id/transition", async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const p = z.object({ to: z.enum(["GRANTED", "DENIED", "REVOKED", "EXPIRED"]), consentId: z.string().optional() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const [row] = await db.select().from(abdmConsentRequestsTable).where(eq(abdmConsentRequestsTable.id, id.data)).limit(1);
  if (!row) { res.status(404).json({ error: "Consent request not found" }); return; }
  if (!canTransitionConsent(row.status, p.data.to)) { res.status(409).json({ error: `Cannot transition ${row.status} → ${p.data.to}` }); return; }

  // Best-effort gateway revoke when configured.
  if (p.data.to === "REVOKED" && isAbdmConfigured() && row.consentId) {
    try {
      const r = await abdmPost("/api/hiecm/consent/v3/revoke", { consentId: row.consentId }, row.requestId);
      await logGateway("out", "consent/revoke", { requestId: row.requestId, statusCode: r.status, ok: r.ok });
    } catch (err) { await logGateway("out", "consent/revoke", { requestId: row.requestId, ok: false, summary: err instanceof Error ? err.message : "error" }); }
  }

  const [updated] = await db.update(abdmConsentRequestsTable)
    .set({ status: p.data.to, consentId: p.data.consentId ?? row.consentId })
    .where(eq(abdmConsentRequestsTable.id, id.data)).returning();
  await audit(req, { action: p.data.to.toLowerCase(), entityType: "consent_request", entityId: String(id.data) });
  res.json(updated);
});

// ── ABHA enrolment (OTP) — requires a configured gateway ──────────────────────
abdmExtRouter.post("/enrolment/otp", async (req, res) => {
  const p = z.object({ patientId: z.number().int().positive().optional(), method: z.enum(["aadhaar-otp", "mobile-otp"]), identifier: z.string().trim().min(4), scope: z.string().optional() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  if (!isAbdmConfigured()) { res.status(503).json({ error: "ABDM gateway is not configured (set ABDM_ENABLED + credentials)" }); return; }

  const txnId = randomUUID();
  const payload = buildEnrolmentOtpPayload({ txnId, method: p.data.method, identifier: p.data.identifier, scope: p.data.scope });
  let ok = false; let statusCode = 0; let err: string | null = null;
  try {
    const r = await abdmPost("/api/abha/enrol/v3/request/otp", payload, txnId);
    ok = r.ok; statusCode = r.status; if (!r.ok) err = "gateway error";
  } catch (e) { err = e instanceof Error ? e.message : "error"; }
  await logGateway("out", "abha/enrol/request/otp", { requestId: txnId, statusCode, ok });

  const [row] = await db.insert(abhaEnrolmentSessionsTable).values({
    txnId, patientId: p.data.patientId ?? null, method: p.data.method, identifierLast4: last4(p.data.identifier),
    status: ok ? "otp_sent" : "failed", step: "otp_requested", scope: p.data.scope ?? null,
    lastError: err, expiresAt: new Date(Date.now() + 10 * 60 * 1000), createdBy: actorOf(req).userName,
  }).returning();
  await audit(req, { action: "enrol_otp", entityType: "abha_enrolment", entityId: String(row.id) });
  // Never echo the OTP or identifier back.
  res.status(ok ? 201 : 502).json({ ...row, error: err ?? undefined });
});

abdmExtRouter.post("/enrolment/:txnId/verify", async (req, res) => {
  const p = z.object({ otp: z.string().trim().min(4).max(10) }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  if (!isAbdmConfigured()) { res.status(503).json({ error: "ABDM gateway is not configured" }); return; }
  const [session] = await db.select().from(abhaEnrolmentSessionsTable).where(eq(abhaEnrolmentSessionsTable.txnId, String(req.params.txnId))).limit(1);
  if (!session) { res.status(404).json({ error: "Enrolment session not found" }); return; }
  if (session.expiresAt && session.expiresAt < new Date()) { res.status(410).json({ error: "Session expired" }); return; }

  const payload = buildEnrolmentVerifyPayload({ txnId: session.txnId, otp: p.data.otp });
  let ok = false; let statusCode = 0; let err: string | null = null;
  try {
    const r = await abdmPost("/api/abha/enrol/v3/verify/otp", payload, session.txnId);
    ok = r.ok; statusCode = r.status; if (!r.ok) err = "gateway error";
  } catch (e) { err = e instanceof Error ? e.message : "error"; }
  await logGateway("out", "abha/enrol/verify/otp", { requestId: session.txnId, statusCode, ok });

  const [updated] = await db.update(abhaEnrolmentSessionsTable)
    .set({ status: ok ? "verified" : "failed", step: ok ? "verified" : "otp_requested", lastError: err })
    .where(eq(abhaEnrolmentSessionsTable.id, session.id)).returning();
  await audit(req, { action: "enrol_verify", entityType: "abha_enrolment", entityId: String(session.id) });
  res.status(ok ? 200 : 502).json({ ...updated, error: err ?? undefined });
});

abdmExtRouter.get("/enrolment", async (_req, res) => {
  const rows = await db.select().from(abhaEnrolmentSessionsTable).orderBy(desc(abhaEnrolmentSessionsTable.createdAt)).limit(200);
  res.json(rows);
});

export default abdmExtRouter;

/**
 * abdm.ts — ABDM / ABHA integration endpoints.
 *
 * Two routers:
 *   - default  (management): staff-authenticated. Link a patient's ABHA, register
 *     care contexts, view consents/status. Mounted at /api/abdm behind staff auth.
 *   - callbackRouter (gateway callbacks): PUBLIC transport, gated by ABDM_ENABLED
 *     and a shared ABDM_CALLBACK_SECRET bearer (fail-closed). Mounted at
 *     /api/abdm/callback. Receives consent notifications and care-context
 *     discovery from the gateway.
 *
 * Everything returns 503 until ABDM_ENABLED=true (+ credentials). The local
 * pieces — ABHA validation/storage, care-context registration, discovery lookup
 * — are fully functional; the gateway-dependent push/exchange is best-effort and
 * clearly gated. Health-data EXCHANGE (encrypted payloads, X-HMAC signature
 * verification) is intentionally not implemented — see the docs before going live.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { abhaLinksTable, abdmCareContextsTable, abdmConsentArtefactsTable, abdmGatewayLogTable, patientsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { formatAbhaNumber, isValidAbhaNumber, normalizeAbhaAddress } from "../lib/abdmProtocol";
import { isAbdmConfigured } from "../lib/abdmGateway";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const ABDM_ENABLED = () => (process.env.ABDM_ENABLED ?? "").toLowerCase() === "true";

async function logGateway(direction: "in" | "out", endpoint: string, extra: Partial<{ requestId: string; correlationId: string; statusCode: number; ok: boolean; summary: string }>): Promise<void> {
  try {
    await db.insert(abdmGatewayLogTable).values({
      direction, endpoint,
      requestId: extra.requestId ?? null, correlationId: extra.correlationId ?? null,
      statusCode: extra.statusCode ?? null, ok: extra.ok ?? false, summary: extra.summary ?? null,
    });
  } catch { /* audit log is best-effort */ }
}

// ── Management router (staff-authenticated via the mount in index.ts) ─────────
const router = Router();

// Gate every management route behind the feature flag (503 when off).
router.use((_req, res, next) => {
  if (!ABDM_ENABLED()) { res.status(503).json({ error: "ABDM integration is not enabled on this server" }); return; }
  next();
});

router.get("/status", (_req, res) => {
  res.json({ enabled: ABDM_ENABLED(), configured: isAbdmConfigured() });
});

const LinkAbhaBody = z.object({
  patientId: z.number().int().positive(),
  abhaNumber: z.string().trim().nullish(),
  abhaAddress: z.string().trim().nullish(),
  name: z.string().trim().nullish(),
  gender: z.string().trim().nullish(),
  yearOfBirth: z.number().int().min(1900).max(2100).nullish(),
  linkedVia: z.enum(["aadhaar-otp", "mobile-otp", "demographic"]).nullish(),
}).refine((b) => b.abhaNumber || b.abhaAddress, { message: "abhaNumber or abhaAddress is required" });

// POST /api/abdm/abha/link — associate an ABHA identity with a CARE patient.
router.post("/abha/link", async (req: StaffAuthRequest, res) => {
  const parsed = LinkAbhaBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.error.issues }); return; }
  const b = parsed.data;

  let abhaNumber: string | null = null;
  if (b.abhaNumber) {
    if (!isValidAbhaNumber(b.abhaNumber)) { res.status(400).json({ error: "Invalid ABHA number (must be 14 digits)" }); return; }
    abhaNumber = formatAbhaNumber(b.abhaNumber);
  }
  let abhaAddress: string | null = null;
  if (b.abhaAddress) {
    abhaAddress = normalizeAbhaAddress(b.abhaAddress);
    if (!abhaAddress) { res.status(400).json({ error: "Invalid ABHA address (expected handle@registrar)" }); return; }
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, b.patientId)).limit(1);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

  // Upsert on (patient_id, abha_address) when an address is present.
  if (abhaAddress) {
    const [existing] = await db.select().from(abhaLinksTable)
      .where(and(eq(abhaLinksTable.patientId, b.patientId), eq(abhaLinksTable.abhaAddress, abhaAddress))).limit(1);
    if (existing) {
      const [updated] = await db.update(abhaLinksTable)
        .set({ abhaNumber: abhaNumber ?? existing.abhaNumber, name: b.name ?? existing.name, gender: b.gender ?? existing.gender, yearOfBirth: b.yearOfBirth ?? existing.yearOfBirth, linkedVia: b.linkedVia ?? existing.linkedVia, status: "linked" })
        .where(eq(abhaLinksTable.id, existing.id)).returning();
      res.json(updated);
      return;
    }
  }
  const [created] = await db.insert(abhaLinksTable).values({
    patientId: b.patientId, abhaNumber, abhaAddress, name: b.name ?? null, gender: b.gender ?? null,
    yearOfBirth: b.yearOfBirth ?? null, linkedVia: b.linkedVia ?? null, status: "linked", verified: false,
  }).returning();
  res.status(201).json(created);
});

// GET /api/abdm/abha/by-patient/:patientId
router.get("/abha/by-patient/:patientId", async (req, res) => {
  const patientId = Number(req.params.patientId);
  if (!Number.isInteger(patientId)) { res.status(400).json({ error: "bad patientId" }); return; }
  const rows = await db.select().from(abhaLinksTable).where(eq(abhaLinksTable.patientId, patientId)).orderBy(desc(abhaLinksTable.linkedAt));
  res.json(rows);
});

// POST /api/abdm/abha/:id/unlink — soft unlink.
router.post("/abha/:id/unlink", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [row] = await db.update(abhaLinksTable).set({ status: "unlinked" }).where(eq(abhaLinksTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "ABHA link not found" }); return; }
  res.json(row);
});

const CareContextBody = z.object({
  abhaLinkId: z.number().int().positive(),
  careContexts: z.array(z.object({
    careContextRef: z.string().trim().min(1),
    display: z.string().trim().min(1),
    hiType: z.string().trim().default("DiagnosticReport"),
  })).min(1),
});

// POST /api/abdm/care-contexts — register CARE records as discoverable care
// contexts. Idempotent on (abha_link_id, care_context_ref). If ABDM is
// configured, the gateway push can be wired here; today we store + mark pending.
router.post("/care-contexts", async (req, res) => {
  const parsed = CareContextBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.error.issues }); return; }
  const { abhaLinkId, careContexts } = parsed.data;
  const [link] = await db.select().from(abhaLinksTable).where(eq(abhaLinksTable.id, abhaLinkId)).limit(1);
  if (!link) { res.status(404).json({ error: "ABHA link not found" }); return; }

  const created = [];
  for (const c of careContexts) {
    const [existing] = await db.select().from(abdmCareContextsTable)
      .where(and(eq(abdmCareContextsTable.abhaLinkId, abhaLinkId), eq(abdmCareContextsTable.careContextRef, c.careContextRef))).limit(1);
    if (existing) { created.push(existing); continue; }
    const [row] = await db.insert(abdmCareContextsTable).values({
      abhaLinkId, patientId: link.patientId, careContextRef: c.careContextRef, display: c.display, hiType: c.hiType, linked: false,
    }).returning();
    created.push(row);
  }
  await logGateway("out", "/care-contexts/register", { summary: `registered ${created.length} care context(s) for abha_link ${abhaLinkId}`, ok: true });
  res.status(201).json({ careContexts: created, gatewayPush: isAbdmConfigured() ? "pending" : "disabled" });
});

// GET /api/abdm/care-contexts/by-patient/:patientId
router.get("/care-contexts/by-patient/:patientId", async (req, res) => {
  const patientId = Number(req.params.patientId);
  if (!Number.isInteger(patientId)) { res.status(400).json({ error: "bad patientId" }); return; }
  const rows = await db.select().from(abdmCareContextsTable).where(eq(abdmCareContextsTable.patientId, patientId)).orderBy(desc(abdmCareContextsTable.createdAt));
  res.json(rows);
});

// GET /api/abdm/consents — consent artefacts received from the gateway.
router.get("/consents", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const base = db.select().from(abdmConsentArtefactsTable).orderBy(desc(abdmConsentArtefactsTable.createdAt));
  const rows = status ? await base.where(eq(abdmConsentArtefactsTable.status, status)) : await base;
  res.json(rows);
});

export default router;

// ── Gateway callback router (public transport, secret-gated) ──────────────────
export const callbackRouter = Router();

function requireCallbackAuth(req: Request, res: Response, next: NextFunction): void {
  // Fail closed: disabled unless the feature flag AND a callback secret are set.
  // NOTE: production must replace this shared-secret check with ABDM's X-HMAC
  // signature verification over the raw body. See docs/CARE_ERP_ABDM_INTEGRATION.md.
  const secret = process.env.ABDM_CALLBACK_SECRET ?? "";
  if (!ABDM_ENABLED() || !secret) { res.status(503).json({ error: "ABDM callbacks not configured" }); return; }
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const ok = token.length > 0 && timingSafeEqual(createHash("sha256").update(token).digest(), createHash("sha256").update(secret).digest());
  if (!ok) { res.status(401).json({ error: "Invalid callback credentials" }); return; }
  next();
}
callbackRouter.use(requireCallbackAuth);

// Consent notification: the Consent Manager tells us a consent artefact's state.
const ConsentNotifyBody = z.object({
  consentId: z.string().trim().min(1),
  status: z.string().trim().min(1),
  abhaAddress: z.string().trim().nullish(),
  purposeCode: z.string().trim().nullish(),
  purposeText: z.string().trim().nullish(),
  hiuId: z.string().trim().nullish(),
  hiTypes: z.array(z.string()).nullish(),
  dateRangeFrom: z.string().trim().nullish(),
  dateRangeTo: z.string().trim().nullish(),
  expiry: z.string().trim().nullish(),
});
callbackRouter.post("/consents/hip/notify", async (req, res) => {
  const parsed = ConsentNotifyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid consent notification", details: parsed.error.issues }); return; }
  const b = parsed.data;
  const requestId = randomUUID();
  const values = {
    consentId: b.consentId, status: b.status.toUpperCase(), abhaAddress: b.abhaAddress ?? null,
    purposeCode: b.purposeCode ?? null, purposeText: b.purposeText ?? null, hiuId: b.hiuId ?? null,
    hiTypes: b.hiTypes?.join(",") ?? null,
    dateRangeFrom: b.dateRangeFrom ? new Date(b.dateRangeFrom) : null,
    dateRangeTo: b.dateRangeTo ? new Date(b.dateRangeTo) : null,
    expiry: b.expiry ? new Date(b.expiry) : null,
    grantedAt: b.status.toUpperCase() === "GRANTED" ? new Date() : null,
    raw: req.body,
  };
  // Upsert on consent_id.
  const [existing] = await db.select().from(abdmConsentArtefactsTable).where(eq(abdmConsentArtefactsTable.consentId, b.consentId)).limit(1);
  if (existing) await db.update(abdmConsentArtefactsTable).set(values).where(eq(abdmConsentArtefactsTable.id, existing.id));
  else await db.insert(abdmConsentArtefactsTable).values(values);
  await logGateway("in", "/consents/hip/notify", { requestId, ok: true, summary: `consent ${b.consentId} → ${values.status}` });
  res.status(202).json({ requestId, acknowledged: true });
});

// Care-context discovery: the gateway asks which care contexts we hold for a
// patient (matched by ABHA address). Returns references + display labels only —
// never clinical content (that flows later, encrypted, after consent).
const DiscoverBody = z.object({ abhaAddress: z.string().trim().min(1) });
callbackRouter.post("/care-contexts/discover", async (req, res) => {
  const parsed = DiscoverBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid discovery request", details: parsed.error.issues }); return; }
  const address = normalizeAbhaAddress(parsed.data.abhaAddress);
  const requestId = randomUUID();
  if (!address) { res.status(400).json({ error: "Invalid ABHA address" }); return; }
  const [link] = await db.select().from(abhaLinksTable).where(and(eq(abhaLinksTable.abhaAddress, address), eq(abhaLinksTable.status, "linked"))).limit(1);
  if (!link) {
    await logGateway("in", "/care-contexts/discover", { requestId, ok: true, summary: `no match for ${address}` });
    res.status(404).json({ requestId, error: "No patient found for that ABHA address" });
    return;
  }
  const contexts = await db.select().from(abdmCareContextsTable).where(eq(abdmCareContextsTable.abhaLinkId, link.id));
  await logGateway("in", "/care-contexts/discover", { requestId, ok: true, summary: `discovered ${contexts.length} context(s) for ${address}` });
  res.json({
    requestId,
    patient: { referenceNumber: String(link.patientId), display: link.name ?? undefined,
      careContexts: contexts.map((c) => ({ referenceNumber: c.careContextRef, display: c.display, hiType: c.hiType })) },
  });
});

// Health-information request: acknowledged and logged, but the encrypted data
// push is intentionally NOT implemented in this scaffold.
callbackRouter.post("/health-information/request", async (req, res) => {
  const requestId = randomUUID();
  await logGateway("in", "/health-information/request", { requestId, ok: false, summary: "received; encrypted data push not implemented in scaffold" });
  res.status(501).json({ requestId, error: "Health-information exchange not implemented; see docs/CARE_ERP_ABDM_INTEGRATION.md" });
});

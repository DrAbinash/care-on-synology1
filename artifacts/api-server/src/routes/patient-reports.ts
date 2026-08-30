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
  pacsSettingsTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql, ilike, or, isNull, isNotNull, inArray } from "drizzle-orm";
import {
  freezeReportPresentation, parseExplicitTemplateParam, resolveTemplateForRender,
  resolveTemplateRecordForRender,
} from "../lib/presentationTemplateStore";
import type { CopyType } from "../lib/presentationTemplateModel";
import { sendReportDelivery } from "./whatsapp";
import crypto from "node:crypto";
import {
  whatsappSettingsTable,
  radiologyShareLinksTable,
} from "@workspace/db/schema";
import { sendReportEmail } from "../email";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { hookConsumeOnReportVerified } from "../lib/inventoryConsumption";
import { renderHtmlToPdf } from "../lib/htmlToPdf";
import { isObstetricUsgStudy } from "../lib/usgModality";
import { checkPcpndtFormFCompliance, PCPNDT_OVERRIDE_ROLES } from "../lib/pcpndtCompliance";
// ── Ticket D5 — structured signed-report path (flag-gated, legacy default) ───
import {
  radiologyReportDraftsTable,
  radiologyWorklistTable,
  reportFindingInstancesTable,
  radiologyQuickFindingsTable,
  auditLogsTable,
  patientReportAmendmentsTable,
} from "@workspace/db/schema";
// ── Ticket D7 — structured amendment chain ───────────────────────────────────
import {
  prepareStructuredAmendment,
  type AmendmentParent,
} from "../lib/radiologyD1AmendmentWriter";
import { asc } from "drizzle-orm";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import {
  RadiologyIdentityError,
  bindRadiologyReportIdentity,
  claimWorklistForFinalize,
  isRadiologyReportType,
  type BoundRadiologyIdentity,
} from "../lib/radiologyIdentity";
import {
  canStructuredSign,
  canStructuredVerify,
  SIGN_DENY_ROLES,
  prepareStructuredFinalReport,
  buildFinalD1Source,
  parseDraftImpression,
  STRUCTURED_RENDERER_VERSION,
  type FinalWorklistRow,
} from "../lib/radiologyD1FinalWriter";
import { verifyContentSha256 } from "../lib/structuredReport/hash";
import {
  renderReportDocument,
  type ReportDocumentModel, type ReportKeyImageModel, type ReportParameterRow, type ReportSignatureModel,
} from "../lib/reportPresentation";
import { resolveReportPrintKeyImages } from "../lib/frozenKeyImages";
import {
  REPORT_HEADER_SCALE_KEY,
  REPORT_LOGO_SCALE_KEY,
  REPORT_FOOTER_SCALE_KEY,
} from "../lib/reportLetterheadScale";
import {
  applyInstitutionalTemplateOverrides,
  buildReportSurfaceCss,
  DEFAULT_INSTITUTIONAL_STYLE,
} from "../lib/institutionalReportStyle";
import {
  materializeFindings,
  CatalogStoreFindingResolver,
  type MaterializationOutput,
} from "../lib/radiologyFindingMaterializer";
import { DrizzleCatalogStore } from "../lib/radiologyCatalog/drizzleStore";
import { DrizzleStructuredReportCatalogPort } from "../lib/structuredReport/catalogAccess";
import { validateStructuredReport } from "../lib/structuredReport/validator";
import { noFindingsCatalogPort } from "../lib/radiologyD1DraftWriter";
import { UnavailableAiRulesRegistryPort } from "../lib/structuredReport/aiRulesRegistry";
import { canonicalHashPayload, computeChainHash, auditLog } from "../lib/audit";
// BEND-1 — durable D10 re-delivery obligations + shared recipient masking.
import { maskRecipient } from "../lib/redeliveryRules";
import { createObligationsForAmendment, completeObligationsForDelivery, isRedeliveryAutoSendEnabled } from "../lib/redeliveryObligations";
import { enqueueRadiologyJob } from "../lib/radiologyJobs";
import { REDELIVERY_SEND_JOB } from "../lib/radiologyJobHandlers";
import { radiologyRedeliveryObligationsTable } from "@workspace/db/schema";
// ── Ticket D6 — structured read path (flag-gated, legacy display default) ───
import { readStructuredReport, type StructuredReadResult } from "../lib/radiologyStructuredRead";
// ── Ticket D8 — canonical amendment-chain resolution (read-only) ─────────────
import {
  resolveReportVersion,
  type ResolvedReportVersion,
  type ResolveMode,
} from "../lib/radiologyReportVersion";

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

// ensurePublicToken — used by auto-share paths (WhatsApp on verify) and by
// the patient portal (session-authenticated "view my report" links).
// Reuses an existing token only if it is still valid; otherwise rotates.
export async function ensurePublicToken(reportId: number): Promise<string | null> {
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

/** Public base URL for report links built without an HTTP request to derive
 *  them from (matches the identical pattern in radiologyJobHandlers.ts's
 *  publicBaseUrl(), used for the WhatsApp/email delivery links this report's
 *  QR now points at the same way). */
function qrPublicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || "";
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * R1.4 — a REAL, scannable QR code (PNG data: URL) encoding the report's
 * own public verification link — the same tokenized /api/p/r/:token/pdf
 * link WhatsApp/email delivery already sends, generated server-side with the
 * `qrcode` package (already used elsewhere in this codebase for bills/kiosk/
 * UPI QR codes). Replaces a static placeholder box that encoded nothing.
 *
 * Only ever generated for a report that is actually publicly downloadable
 * (verified/delivered — the same statuses the public pdf route itself
 * requires) so a scan can never land on a 403 "not yet finalized" page; a
 * draft/pending report renders with no QR block at all rather than a QR
 * pointing at a link that doesn't work yet. Failure-tolerant like every
 * other optional presentation element (key images, logo): a QR generation
 * or token-mint problem must never block printing.
 */
async function generateReportQrDataUrl(reportId: number, status: string): Promise<string | null> {
  if (status !== "verified" && status !== "delivered") return null;
  const base = qrPublicBaseUrl();
  if (!base) return null;
  try {
    const token = await ensurePublicToken(reportId);
    if (!token) return null;
    const QRCode = await import("qrcode");
    return await QRCode.toDataURL(`${base}/api/p/r/${token}/pdf`, {
      errorCorrectionLevel: "M", margin: 1, width: 200,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return null;
  }
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
// Ticket D6 — structured read path (flag-gated; legacy display is the default)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Run the D6 read pipeline for one patient_reports row when the read flag is
 * on and the row is a radiology report carrying structured_json. Returns null
 * whenever the display must be the stored legacy body with no diagnostics
 * attached (flag off / not radiology / no structured document) — callers then
 * behave byte-identically to the pre-D6 route. NEVER writes anything.
 */
async function applyStructuredRead(r: {
  id: number;
  type: string;
  body: string;
  structuredJson: unknown;
  renderEngineVersion: string | null;
  catalogVersion: string | null;
}): Promise<StructuredReadResult | null> {
  if (r.type !== "radiology" || r.structuredJson == null) return null;
  try {
    // Flag check INSIDE the try: a transient feature_flags read failure must
    // degrade to the stored legacy body, never 500 a report display.
    if (!(await isFeatureEnabledServer("ff_radiology_structured_read"))) return null;
    const catalogStore = new DrizzleCatalogStore();
    const result = await readStructuredReport(
      { body: r.body, structuredJson: r.structuredJson, renderEngineVersion: r.renderEngineVersion, catalogVersion: r.catalogVersion },
      {
        catalogPort: new DrizzleStructuredReportCatalogPort(catalogStore),
        // R14b: the finalize audit row D5 wrote for this document. entityType
        // is part of the predicate so the (entity_type, entity_id) composite
        // index serves this lookup — without it the planner has to scan every
        // 'finalize' row ever written, on every structured report display.
        auditLogLookup: async (docId, hash) => {
          const rows = await db
            .select({ newValue: auditLogsTable.newValue })
            .from(auditLogsTable)
            .where(and(
              eq(auditLogsTable.action, "finalize"),
              eq(auditLogsTable.entityType, "structured_report"),
              eq(auditLogsTable.entityId, docId),
            ))
            .limit(5);
          return rows.some((row) => (row.newValue ?? "").includes(hash));
        },
        // R14c (D7): the validator asks about the PRIOR document of an
        // amendment row. The linkage row is the proof it exists and was
        // signed-final at amend time; the parent row's live document supplies
        // the state. "Already amended" must exclude the very document being
        // read — a chain is linear, and the row on screen IS that amendment.
        amendsLookup: async (priorDocId) => {
          const [link] = await db
            .select()
            .from(patientReportAmendmentsTable)
            .where(eq(patientReportAmendmentsTable.originalDocumentId, priorDocId))
            .limit(1);
          if (!link) return null;
          const [parentRow] = await db
            .select({ structuredJson: patientReportsTable.structuredJson })
            .from(patientReportsTable)
            .where(eq(patientReportsTable.id, link.originalReportId))
            .limit(1);
          const parentDoc = parentRow?.structuredJson as { audit?: { signature?: { state?: string } } } | null;
          const state = parentDoc?.audit?.signature?.state;
          if (typeof state !== "string") return null;
          const selfDocId = (r.structuredJson as { document_id?: unknown })?.document_id;
          return {
            state,
            alreadyAmendedBy: link.amendedDocumentId === selfDocId ? null : link.amendedDocumentId,
          };
        },
      },
    );
    // Phase 5 audit: a divergence or integrity failure must leave a server-
    // side trace on EVERY surface (GET /:id and all five buildReportHtml
    // consumers inherit this single choke point). Log-only — the read path
    // never writes to the database.
    if (result.comparisonClass === "CLINICAL_DIFFERENCE" || result.comparisonClass === "INVALID_STRUCTURED_JSON") {
      console.warn("[patient-reports] D6 structured read fell back to the stored body:", JSON.stringify({
        reportId: r.id,
        comparisonClass: result.comparisonClass,
        hashVerified: result.diagnostics.hashVerified,
        fallbackReason: result.diagnostics.fallbackReason,
        divergentLines: result.diagnostics.divergentLines.length,
        validationErrors: result.diagnostics.validationErrors.map((e) => e.rule),
      }));
    }
    return result;
  } catch (err) {
    // A read-path failure must never break report display — legacy body wins.
    console.error("[patient-reports] D6 structured read failed (non-fatal, serving stored body):", err);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Ticket D7 — structured amendment chain (helpers; route registered below)
// ────────────────────────────────────────────────────────────────────────────

export interface AmendmentChainInfo {
  rootReportId: number;
  latestReportId: number;
  superseded: boolean;
  chain: Array<{
    sequenceNumber: number;
    originalReportId: number;
    amendedReportId: number;
    amendedDocumentId: string;
    reason: string;
    amendedByName: string;
    createdAt: Date;
  }>;
}

/**
 * Ticket D8 — the D7-shaped `amendment` response key, now derived from the
 * canonical resolver's output (one chain implementation, zero duplicate
 * queries). Shape is unchanged for existing clients; null when the served
 * row has no amendment chain. `superseded` describes the row being SERVED.
 */
function amendmentKeyFromVersion(version: ResolvedReportVersion): AmendmentChainInfo | null {
  if (version.resolutionReason === "no_chain" || !version.links || version.links.length === 0) return null;
  return {
    rootReportId: version.rootReportId,
    latestReportId: version.latestReportId,
    superseded: version.resolvedSuperseded,
    chain: version.links.map((l) => ({
      sequenceNumber: l.sequenceNumber,
      originalReportId: l.originalReportId,
      amendedReportId: l.amendedReportId,
      amendedDocumentId: l.amendedDocumentId,
      reason: l.reason,
      amendedByName: l.amendedByName,
      createdAt: l.createdAt,
    })),
  };
}

/** D8 — the additive `version` metadata object every read/delivery surface
 *  reports. Never includes full rows; ids + banner facts only. */
function versionMetadata(version: ResolvedReportVersion) {
  return {
    requestedReportId: version.requestedReportId,
    resolvedReportId: version.resolvedReportId,
    rootReportId: version.rootReportId,
    latestReportId: version.latestReportId,
    sequenceNumber: version.sequenceNumber,
    totalVersions: version.totalVersions,
    superseded: version.resolvedSuperseded,
    requestedSuperseded: version.superseded,
    amendmentReason: version.amendmentReason,
    latestAmendmentReason: version.latestAmendmentReason,
    resolutionReason: version.resolutionReason,
    warnings: version.warnings,
    ...(version.chain ? { chain: version.chain } : {}),
  };
}

/** D8 Phase 7 — one structured diagnostic line per resolution that matters:
 *  a redirect, a superseded serve, or a chain-integrity warning. Read paths
 *  stay write-free; this is log-only. */
function logVersionResolution(surface: string, version: ResolvedReportVersion, context?: Record<string, unknown>) {
  if (
    version.resolvedReportId === version.requestedReportId &&
    !version.resolvedSuperseded &&
    version.warnings.length === 0
  ) return;
  console.warn("[patient-reports] D8 version resolution:", JSON.stringify({
    surface,
    requestedReportId: version.requestedReportId,
    deliveredReportId: version.resolvedReportId,
    rootReportId: version.rootReportId,
    latestReportId: version.latestReportId,
    sequenceNumber: version.sequenceNumber,
    totalVersions: version.totalVersions,
    superseded: version.resolvedSuperseded,
    historicalOverride: version.resolutionReason === "explicit_specific" || version.resolutionReason === "explicit_root",
    resolutionReason: version.resolutionReason,
    warnings: version.warnings,
    ...context,
  }));
}

/** D8 — pick the effective resolve mode for a surface: explicit query wins;
 *  otherwise default to LATEST only when the structured-final flag (the only
 *  mechanism that creates amendments) is on. Flag OFF ⇒ "specific", i.e. the
 *  exact pre-D8 behavior. A flag-read failure degrades to "specific". */
async function effectiveResolveMode(explicit: string | undefined): Promise<ResolveMode> {
  if (explicit === "latest" || explicit === "specific" || explicit === "root") return explicit;
  try {
    return (await isFeatureEnabledServer("ff_radiology_structured_final")) ? "latest" : "specific";
  } catch {
    return "specific";
  }
}

/** D8 Phase 5 — response metadata stating exactly which revision was
 *  delivered (also what file-naming keys off). Additive headers only. */
function setVersionHeaders(res: { setHeader(name: string, value: string): unknown }, version: ResolvedReportVersion) {
  res.setHeader("X-Report-Requested-Id", String(version.requestedReportId));
  res.setHeader("X-Report-Delivered-Id", String(version.resolvedReportId));
  res.setHeader("X-Report-Version", `${version.sequenceNumber}/${version.totalVersions}`);
  if (version.resolvedSuperseded) res.setHeader("X-Report-Superseded", "true");
}

/** D8 Phase 6/7 — the auditable requested-vs-delivered record for delivery
 *  surfaces. Written to the hash-chained audit log ONLY when the resolution
 *  is noteworthy (redirect, superseded serve, historical override, or chain
 *  warning); an ordinary same-id delivery stays exactly as cheap as before.
 *  auditLog never throws (fire-and-forget contract), so deliveries cannot be
 *  broken by audit failures. Signed report bytes are never touched. */
async function auditDeliveryResolution(
  surface: string,
  version: ResolvedReportVersion,
  actor: { userId?: number | null; userName?: string; role?: string },
  context?: Record<string, unknown>,
) {
  const historicalOverride =
    version.resolutionReason === "explicit_specific" || version.resolutionReason === "explicit_root";
  if (
    version.resolvedReportId === version.requestedReportId &&
    !version.resolvedSuperseded &&
    !historicalOverride &&
    version.warnings.length === 0
  ) return;
  await auditLog({
    userId: actor.userId ?? null,
    userName: actor.userName ?? "system",
    role: actor.role ?? "system",
    action: "deliver_version",
    module: "radiology",
    entityType: "patient_report",
    entityId: String(version.resolvedReportId),
    newValue: JSON.stringify({
      surface,
      requestedReportId: version.requestedReportId,
      deliveredReportId: version.resolvedReportId,
      rootReportId: version.rootReportId,
      latestReportId: version.latestReportId,
      sequenceNumber: version.sequenceNumber,
      totalVersions: version.totalVersions,
      superseded: version.resolvedSuperseded,
      historicalOverride,
      warnings: version.warnings,
      ...context,
    }),
    reason: version.resolutionReason,
  });
}

/** D8 — version-suffixed filename for saved PDFs/HTML ("where practical":
 *  only when the report actually has multiple versions). */
function versionedFilename(version: ResolvedReportVersion): string {
  const base = (version.resolvedReport.reportNumber || `report-${version.resolvedReportId}`).replace(/[^A-Za-z0-9._-]+/g, "_");
  const suffix = version.totalVersions > 1 ? `-v${version.sequenceNumber}of${version.totalVersions}${version.resolvedSuperseded ? "-SUPERSEDED" : ""}` : "";
  return `${base}${suffix}.pdf`;
}

// ── Ticket D9 — amendment verify-path hardening ──────────────────────────────

interface StructuredSignedDocShape {
  document_id: string;
  audit: {
    revision?: number;
    signature: {
      state?: string;
      signed_by?: string;
      signed_at?: string;
      signed_content_sha256?: string;
      amends_document_id?: string;
    };
  };
}

/** The row carries a signed-FINAL structured document (shape gate only —
 *  full D1 validation is D6's job; this decides which lifecycle the sign/
 *  verify routes apply). */
function structuredSignedDocOf(structuredJson: unknown): StructuredSignedDocShape | null {
  const doc = structuredJson as StructuredSignedDocShape | null;
  if (
    doc && typeof doc === "object" && !Array.isArray(doc) &&
    typeof doc.document_id === "string" &&
    doc.audit?.signature?.state === "final"
  ) return doc;
  return null;
}

/** D9 Phase 7 — hash-chained lifecycle audit record (attempts, rejections,
 *  legacy-sign refusals). Success events are written INSIDE the verify
 *  transaction instead, so they roll back with it. auditLog never throws. */
async function auditLifecycleEvent(
  action: "verify_attempt" | "verify_rejected" | "legacy_sign_rejected",
  actor: { userId?: number | null; userName?: string; role?: string },
  entityId: string,
  payload: Record<string, unknown>,
  reason: string,
) {
  await auditLog({
    userId: actor.userId ?? null,
    userName: actor.userName ?? "system",
    role: actor.role ?? "system",
    action,
    module: "radiology",
    entityType: "patient_report",
    entityId,
    newValue: JSON.stringify(payload),
    reason,
  });
}

/**
 * D9 Phase 3 — structured countersign. Verifies a structured-SIGNED root or
 * amendment directly from its current lifecycle state (draft — legacy sign
 * is refused for these rows, the D1 signature IS the sign step).
 *
 * Guarantees:
 *  - verifier identity comes exclusively from the authenticated session;
 *  - verifier must differ from the original signer (row AND document);
 *  - content_sha256 must verify BEFORE verification — tampered documents are
 *    never countersigned;
 *  - superseded historical versions are never verified (no policy override
 *    in D9) and a corrupt chain blocks verification outright;
 *  - the signed structured document bytes are NEVER touched — only row-level
 *    verification fields + status are stamped;
 *  - row update and the hash-chained "verify" audit record commit in ONE
 *    transaction; any failure rolls both back.
 *
 * Returns {status, body} for the route to send.
 */
async function performStructuredVerify(
  session: NonNullable<StaffAuthRequest["staffSession"]>,
  existing: { id: number; status: string; signedByName: string | null; signatureId: number | null; structuredJson: unknown },
  doc: StructuredSignedDocShape,
  verifierSigId: number | null,
  verifierNotes: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const actor = { userId: session.subjectId, userName: session.subjectName, role: session.role };
  const revision = doc.audit.revision ?? null;
  await auditLifecycleEvent("verify_attempt", actor, doc.document_id, { reportId: existing.id, revision }, "structured_countersign");

  const authority = canStructuredVerify(session);
  if (!authority.allowed) {
    await auditLifecycleEvent("verify_rejected", actor, doc.document_id, { reportId: existing.id, revision }, authority.reason ?? "verify_authority_required");
    return { status: 403, body: { error: "verify_authority_required", detail: authority.reason } };
  }

  if (existing.status === "verified" || existing.status === "delivered") {
    return { status: 409, body: { error: "Report already verified" } };
  }

  // Signer/verifier distinctness — against BOTH the row-level signer and the
  // document's cryptographic signer. Session identity only; client strings
  // never participate.
  const sessionName = session.subjectName.trim().toLowerCase();
  const rowSigner = (existing.signedByName ?? "").trim().toLowerCase();
  const docSigner = (doc.audit.signature.signed_by ?? "").trim().toLowerCase();
  if (sessionName === rowSigner || sessionName === docSigner) {
    await auditLifecycleEvent("verify_rejected", actor, doc.document_id, { reportId: existing.id, revision, signer: existing.signedByName }, "verifier_must_differ_from_signer");
    return { status: 409, body: { error: "verifier_must_differ", message: "Verifier must be a different person from the signer" } };
  }

  // Integrity gate: the stored document must hash-verify before anyone
  // countersigns it.
  const hashCheck = verifyContentSha256(existing.structuredJson as Parameters<typeof verifyContentSha256>[0]);
  if (!hashCheck.ok) {
    await auditLifecycleEvent("verify_rejected", actor, doc.document_id, { reportId: existing.id, revision }, "content_hash_verification_failed");
    return { status: 409, body: { error: "structured_hash_verification_failed", message: "The stored structured document does not verify against its content hash. Verification refused; investigate before countersigning." } };
  }

  // Chain position: only the version that is (still) the newest may normally
  // become deliverable. Corrupt chains block verification outright.
  const version = await resolveReportVersion(existing.id, { mode: "specific", includeChain: true });
  if (version && version.warnings.length > 0) {
    await auditLifecycleEvent("verify_rejected", actor, doc.document_id, { reportId: existing.id, revision, warnings: version.warnings }, "chain_integrity_warning");
    return { status: 409, body: { error: "chain_integrity_warning", detail: version.warnings } };
  }
  if (version && version.superseded) {
    await auditLifecycleEvent("verify_rejected", actor, doc.document_id, { reportId: existing.id, revision, latestReportId: version.latestReportId }, "superseded_version_cannot_be_verified");
    return { status: 409, body: { error: "superseded_version_cannot_be_verified", message: "A newer signed amendment exists; verify the latest version instead.", latestReportId: version.latestReportId } };
  }

  // Optional verifier signature image — validated like the legacy path, and
  // still bound by distinctness on the signature id.
  if (verifierSigId != null) {
    const [sig] = await db.select().from(signaturesTable).where(eq(signaturesTable.id, verifierSigId));
    if (!sig) return { status: 404, body: { error: "Verifier signature not found" } };
    if (existing.signatureId && existing.signatureId === verifierSigId) {
      await auditLifecycleEvent("verify_rejected", actor, doc.document_id, { reportId: existing.id, revision }, "verifier_signature_matches_signer");
      return { status: 409, body: { error: "verifier_must_differ", message: "Verifier must be a different person from the signer" } };
    }
  }

  try {
    const updated = await db.transaction(async (tx) => {
      // Re-read inside the transaction — the pre-checks above are advisory;
      // these are authoritative.
      const [row] = await tx.select().from(patientReportsTable).where(eq(patientReportsTable.id, existing.id)).limit(1);
      if (!row) throw new AmendError(404, "report_not_found");
      if (row.status === "verified" || row.status === "delivered") throw new AmendError(409, "already_verified");
      const [link] = await tx
        .select()
        .from(patientReportAmendmentsTable)
        .where(eq(patientReportAmendmentsTable.originalReportId, existing.id))
        .limit(1);
      if (link) throw new AmendError(409, "superseded_version_cannot_be_verified", { amendedReportId: link.amendedReportId });

      const [updatedRow] = await tx.update(patientReportsTable).set({
        verifiedBySignatureId: verifierSigId,
        verifiedByName: session.subjectName, // session identity, never client input
        verifiedAt: new Date(),
        verifierNotes,
        status: "verified",
      }).where(eq(patientReportsTable.id, existing.id)).returning();

      // Hash-chained success record, same chain protocol as D5/D7 finalize.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_audit_chain'))`);
      const [prevAudit] = await tx
        .select({ chainHash: auditLogsTable.chainHash })
        .from(auditLogsTable)
        .orderBy(desc(auditLogsTable.id))
        .limit(1);
      const previousHash = prevAudit?.chainHash ?? "";
      const createdAt = new Date();
      const newValue = JSON.stringify({
        report_id: existing.id,
        document_id: doc.document_id,
        signed_content_sha256: doc.audit.signature.signed_content_sha256 ?? null,
        verified_by: session.subjectName,
        verified_by_id: session.subjectId,
        revision,
        root_report_id: version?.rootReportId ?? existing.id,
        latest_report_id: version?.latestReportId ?? existing.id,
        sequence_number: version?.sequenceNumber ?? 1,
      });
      const canonical = canonicalHashPayload({
        userId: session.subjectId,
        userName: session.subjectName,
        role: session.role,
        action: "verify",
        module: "radiology",
        entityType: "structured_report",
        entityId: doc.document_id,
        oldValue: null,
        newValue,
        reason: "structured_countersign",
        ipAddress: "",
        userAgent: "",
        createdAt: createdAt.toISOString(),
        previousHash,
      });
      await tx.insert(auditLogsTable).values({
        userId: session.subjectId,
        userName: session.subjectName,
        role: session.role,
        action: "verify",
        module: "radiology",
        entityType: "structured_report",
        entityId: doc.document_id,
        oldValue: null,
        newValue,
        ipAddress: "",
        userAgent: "",
        reason: "structured_countersign",
        previousHash,
        chainHash: computeChainHash(canonical),
        createdAt,
      });

      return updatedRow;
    });
    hookConsumeOnReportVerified({
      id: updated.id,
      testId: updated.testId,
      verifiedByName: session.subjectName,
    });
    return {
      status: 200,
      body: {
        ...updated,
        structuredVerify: {
          documentId: doc.document_id,
          revision,
          contentSha256Verified: true,
          verifiedBy: session.subjectName,
        },
      },
    };
  } catch (err) {
    if (err instanceof AmendError) {
      await auditLifecycleEvent("verify_rejected", actor, doc.document_id, { reportId: existing.id, revision, detail: err.detail }, err.code);
      return { status: err.httpStatus, body: { error: err.code, detail: err.detail } };
    }
    await auditLifecycleEvent("verify_rejected", actor, doc.document_id, { reportId: existing.id, revision }, "verify_transaction_failed");
    return { status: 500, body: { error: "verify_transaction_failed" } };
  }
}

// Masked recipient display — moved to lib/redeliveryRules (BEND-1) so the
// durable obligation store and this read path share ONE masking rule.

/** D9 Phase 4/6 — additive lifecycle metadata for the read API. Computed
 *  only (no durable notification store yet — explicitly deferred); read-only.
 *  `version` is the D8 resolution for the row actually being served. */
async function buildLifecycleMetadata(
  row: {
    id: number;
    type: string;
    status: string;
    structuredJson: unknown;
    verifiedAt: Date | null;
    verifiedByName: string | null;
    signedByName: string | null;
    createdAt: Date;
  },
  version: ResolvedReportVersion,
) {
  const doc = structuredSignedDocOf(row.structuredJson);
  const superseded = version.resolvedSuperseded;
  const deliverable = row.status === "verified" || row.status === "delivered";
  const isAmendment = version.sequenceNumber > 1;
  const pendingVerification = !!doc && !deliverable && !superseded;
  const state = superseded
    ? "superseded"
    : row.status === "delivered"
      ? "delivered"
      : row.status === "verified"
        ? "verified"
        : pendingVerification
          ? "pending_verification"
          : isAmendment
            ? "amendment_created"
            : row.status;

  // Phase 6 — prior recipients on OLDER versions of a verified latest
  // amendment. One IN query, only when it can matter; deduped by
  // channel+recipient; recipients masked. "Completed" is inferred from a
  // sent share row on THIS latest version (the only durable mechanism that
  // exists today); acknowledged/dismissed durable state is deferred.
  let priorDeliveries: Array<{ channel: string; recipient: string | null; reportId: number; at: string | null }> = [];
  let recipientNotificationPending = false;
  if (doc && isAmendment && deliverable && !superseded && version.totalVersions > 1) {
    const olderIds = (version.chain ?? [])
      .filter((c) => c.sequenceNumber < version.sequenceNumber)
      .map((c) => c.reportId);
    if (olderIds.length > 0) {
      const shareRows = await db
        .select()
        .from(reportSharesTable)
        .where(and(
          inArray(reportSharesTable.reportId, [...olderIds, row.id]),
          eq(reportSharesTable.status, "sent"),
        ));
      const seen = new Set<string>();
      let redelivered = false;
      for (const s of shareRows) {
        if (s.reportId === row.id) { redelivered = true; continue; }
        const key = `${s.channel}:${s.recipient ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        priorDeliveries.push({
          channel: s.channel,
          recipient: maskRecipient(s.recipient),
          reportId: s.reportId,
          at: s.createdAt ? new Date(s.createdAt).toISOString() : null,
        });
      }
      recipientNotificationPending = priorDeliveries.length > 0 && !redelivered;
      if (recipientNotificationPending) {
        // Phase 7 — prompt creation is observable server-side. Log-only: the
        // read path stays write-free; durable prompt state is deferred.
        console.warn("[patient-reports] D9 re-delivery prompt:", JSON.stringify({
          reportId: row.id,
          rootReportId: version.rootReportId,
          revision: version.sequenceNumber,
          priorChannels: priorDeliveries.map((p) => p.channel),
        }));
      }
    }
  }

  return {
    state,
    structuredSigned: !!doc,
    amendmentPendingVerification: !!doc && isAmendment && pendingVerification,
    pendingVerification,
    deliverable,
    superseded,
    latestVersion: !superseded,
    verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null,
    verifiedBy: row.verifiedByName,
    recipientNotificationPending,
    priorDeliveries,
  };
}

/** Typed HTTP failure for the amend transaction — no partial amendments:
 *  any throw rolls the whole transaction back and maps to one clear error. */
class AmendError extends Error {
  constructor(public httpStatus: number, public code: string, public detail?: unknown) {
    super(code);
    this.name = "AmendError";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Ticket D5 — structured signed finalize (flag-gated; legacy path is default)
// ────────────────────────────────────────────────────────────────────────────

/** Typed control-flow throw for "structured path cannot proceed safely" —
 *  rolls back the transaction; the caller falls back to the legacy finalize
 *  with the reason recorded. Never silently signs divergent content. */
class StructuredFinalSkip extends Error {
  constructor(public skipCode: string, public detail?: unknown) {
    super(skipCode);
    this.name = "StructuredFinalSkip";
  }
}

interface StructuredFinalizeArgs {
  reportNumber: string;
  studyId: number;
  patientId: number;
  testId: number;
  orderTestId: number | null;
  orderId: number | null;
  billId: number | null;
  title: string;
  parameters: string | null;
  clientImpressionText: string | null;
  templateId: number | null;
  isCritical: boolean;
  criticalNote: string | null;
  presetUsed: string | null;
}

type StructuredFinalizeOutcome =
  | { kind: "signed"; row: typeof patientReportsTable.$inferSelect; diagnostics: Record<string, unknown> }
  | { kind: "skipped"; diagnostics: Record<string, unknown> };

/**
 * The D5 signed transaction (Phase 3). ONE db.transaction:
 *  re-read draft + finding instances → materialize (D3.5) → prepare the FINAL
 *  D1 document (D2 writer, finalize mode) + D4 render + legacy-equivalence
 *  check → insert the finalize audit row (chain protocol, reserved id) →
 *  authoritative D1 validation (real R14b lookup against that row) → insert
 *  patient_reports (D4 body + structured_json + versions + server authorship)
 *  → snapshot finding instances with report_id → stamp draft.final_report_id.
 * Any skip/failure throws → the WHOLE transaction rolls back (no partial
 * signed state, audit chain intact) → caller falls back to legacy finalize.
 */
async function structuredFinalizeTransaction(
  req: StaffAuthRequest,
  args: StructuredFinalizeArgs,
): Promise<StructuredFinalizeOutcome> {
  const session = req.staffSession!;
  const signedAtIso = new Date().toISOString();

  try {
    const row = await db.transaction(async (tx) => {
      // 1) Re-read the authoritative draft for this study (latest wins).
      const [draft] = await tx
        .select()
        .from(radiologyReportDraftsTable)
        .where(eq(radiologyReportDraftsTable.studyId, args.studyId))
        .orderBy(desc(radiologyReportDraftsTable.updatedAt))
        .limit(1);
      if (!draft) throw new StructuredFinalSkip("no_draft_for_study");

      // 2) Re-read current finding instances (source of truth, A3.2).
      const instances = await tx
        .select()
        .from(reportFindingInstancesTable)
        .where(eq(reportFindingInstancesTable.draftId, draft.id))
        .orderBy(asc(reportFindingInstancesTable.id));

      // 3) Worklist row → study identifiers.
      let worklist: FinalWorklistRow | null = null;
      if (draft.worklistId != null) {
        const [w] = await tx
          .select()
          .from(radiologyWorklistTable)
          .where(eq(radiologyWorklistTable.id, draft.worklistId))
          .limit(1);
        worklist = (w as FinalWorklistRow | undefined) ?? null;
      }
      const claimId = draft.worklistId ?? args.studyId;
      if (claimId) {
        await claimWorklistForFinalize(tx, claimId);
      }

      // 4) Materialize truthful D1 findings via the catalog (D3.5). Without
      //    the catalog there is nothing to sign structurally — prepare will
      //    return render_empty and this transaction rolls back to legacy.
      const source = buildFinalD1Source(
        draft,
        worklist,
        instances.map((r) => ({ findingId: r.findingId, structuredJson: r.structuredJson, source: r.source })),
      );
      let materialized: MaterializationOutput = { findings: [], measurements: [], recommendations: [], skipped: [] };
      let catalogPort = noFindingsCatalogPort;
      if (await isFeatureEnabledServer("ff_radiology_catalog")) {
        const catalogStore = new DrizzleCatalogStore();
        const resolver = new CatalogStoreFindingResolver(catalogStore, async (qfId) => {
          const [qf] = await tx
            .select({ label: radiologyQuickFindingsTable.label })
            .from(radiologyQuickFindingsTable)
            .where(eq(radiologyQuickFindingsTable.id, qfId))
            .limit(1);
          return qf?.label ? { label: qf.label } : null;
        });
        materialized = await materializeFindings(
          source.findingSelections.map((s) => ({ findingId: s.findingId, params: s.params as Record<string, unknown>, source: s.source })),
          resolver,
          { actor: source.createdBy ?? session.subjectName, createdAtIso: source.createdAtIso },
        );
        catalogPort = new DrizzleStructuredReportCatalogPort(catalogStore);
      }

      // 5) Reserve the audit-chain row id (sequences are non-transactional, so
      //    this cannot collide even across concurrent finalizes). The id is
      //    hashed INTO the signed document (audit_log_ref), which is why it
      //    must exist before the writer runs.
      const nextvalRes = await tx.execute(
        sql`SELECT nextval(pg_get_serial_sequence('audit_logs','id')) AS id`,
      );
      const nextvalRows = (Array.isArray(nextvalRes) ? nextvalRes : (nextvalRes as { rows?: unknown[] }).rows ?? []) as Array<{ id: unknown }>;
      const auditLogRef = Number(nextvalRows[0]?.id);
      if (!Number.isFinite(auditLogRef) || auditLogRef <= 0) {
        throw new StructuredFinalSkip("audit_id_reservation_failed");
      }

      // 6) PURE preparation: final D1 document (D2 writer, finalize mode) +
      //    D4 render + legacy-equivalence verdict. Validation here runs
      //    without the audit lookup (the row is not inserted yet) — the
      //    authoritative validation with the real lookup runs at step 9.
      const prepared = await prepareStructuredFinalReport({
        source,
        materialized,
        draftLegacy: {
          rawFindings: draft.rawFindings,
          impression: parseDraftImpression(draft.impression),
          recommendation: draft.recommendation,
          clientImpressionText: args.clientImpressionText,
        },
        sign: {
          signedBy: session.subjectName,
          signedRole: session.role,
          signedById: session.subjectId,
          signedAtIso,
          auditLogRef,
        },
        validationPorts: { catalogPort, amendsLookup: async () => null },
      });
      if (!prepared.ok) {
        throw new StructuredFinalSkip(`prepare_${prepared.stage}`, {
          skipReasons: prepared.skipReasons,
          validationErrors: prepared.validationErrors,
        });
      }

      // 7) Legacy-equivalence policy (Phase 4): only sign structured content
      //    that is clinically identical (after approved formatting
      //    normalizations) to the draft's own legacy fields. Anything else
      //    falls back to the legacy finalize with the mismatch recorded.
      if (prepared.equivalence.verdict !== "equivalent") {
        throw new StructuredFinalSkip("clinical_divergence", prepared.equivalence);
      }

      // 8) Insert the finalize audit row at the reserved id, following the
      //    exact audit-chain protocol (xact-scoped chain lock → read previous
      //    chainHash → canonical payload hash → insert). `id` is not part of
      //    the hashed payload, so the explicit id does not affect the chain.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_audit_chain'))`);
      const [prevAudit] = await tx
        .select({ chainHash: auditLogsTable.chainHash })
        .from(auditLogsTable)
        .orderBy(desc(auditLogsTable.id))
        .limit(1);
      const previousHash = prevAudit?.chainHash ?? "";
      const auditCreatedAt = new Date();
      const forwarded = req.headers["x-forwarded-for"];
      const ipAddress = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : (req.ip ?? req.socket?.remoteAddress ?? "");
      const userAgent = String(req.headers["user-agent"] ?? "");
      const auditNewValue = JSON.stringify({
        document_id: prepared.document.document_id,
        signed_content_sha256: prepared.document.audit.signature.signed_content_sha256,
        report_number: args.reportNumber,
        draft_id: draft.id,
      });
      const canonical = canonicalHashPayload({
        userId: session.subjectId,
        userName: session.subjectName,
        role: session.role,
        action: "finalize",
        module: "radiology",
        entityType: "structured_report",
        entityId: prepared.document.document_id,
        oldValue: null,
        newValue: auditNewValue,
        reason: null,
        ipAddress,
        userAgent,
        createdAt: auditCreatedAt.toISOString(),
        previousHash,
      });
      await tx.insert(auditLogsTable).values({
        id: auditLogRef,
        userId: session.subjectId,
        userName: session.subjectName,
        role: session.role,
        action: "finalize",
        module: "radiology",
        entityType: "structured_report",
        entityId: prepared.document.document_id,
        oldValue: null,
        newValue: auditNewValue,
        ipAddress,
        userAgent,
        reason: null,
        previousHash,
        chainHash: computeChainHash(canonical),
        createdAt: auditCreatedAt,
      });

      // 9) AUTHORITATIVE validation — finalize mode with the REAL R14b lookup
      //    against the row just inserted. Any blocking error rolls everything
      //    back (audit row included; chain lock is xact-scoped).
      const authoritative = await validateStructuredReport(prepared.document, {
        catalog: catalogPort,
        aiRules: new UnavailableAiRulesRegistryPort(),
        mode: "finalize",
        auditLogLookup: async (docId, hash) => {
          const [row] = await tx.select().from(auditLogsTable).where(eq(auditLogsTable.id, auditLogRef)).limit(1);
          return !!row && row.action === "finalize" && row.entityId === docId && (row.newValue ?? "").includes(hash);
        },
        amendsLookup: async () => null,
      });
      if (!authoritative.ok) {
        throw new StructuredFinalSkip("d1_validation_failed", { validationErrors: authoritative.errors });
      }

      // 10) Insert the signed patient_reports row. body = D4 render;
      //     authorship = server session identity (client createdBy ignored).
      const [reportRow] = await tx.insert(patientReportsTable).values({
        reportNumber: args.reportNumber,
        type: "radiology",
        patientId: args.patientId,
        testId: args.testId,
        orderTestId: args.orderTestId,
        orderId: args.orderId,
        billId: args.billId,
        studyId: args.studyId,
        title: args.title,
        body: prepared.renderedBody,
        parameters: args.parameters,
        impression: prepared.legacyShape.impression.join("\n") || null,
        templateId: args.templateId,
        createdBy: session.subjectName,
        signedByName: session.subjectName,
        signedAt: new Date(signedAtIso),
        isCritical: args.isCritical,
        criticalNote: args.criticalNote,
        stylePresetUsed: args.presetUsed,
        structuredJson: prepared.document,
        renderEngineVersion: STRUCTURED_RENDERER_VERSION,
        templateVersion: draft.templateId,
        catalogVersion: source.catalogSchemaVersion,
      }).returning();

      // 11) Snapshot the signed finding instances with report_id. Copies carry
      //     reportId and a NULL draftId so the A4 cache / A5 drift logic
      //     (which query by draftId) never see them as live draft rows.
      if (instances.length > 0) {
        await tx.insert(reportFindingInstancesTable).values(
          instances.map((r) => ({
            draftId: null,
            reportId: reportRow.id,
            findingId: r.findingId,
            anatomicZoneId: r.anatomicZoneId,
            structureId: r.structureId,
            category: r.category,
            modality: r.modality,
            structuredJson: r.structuredJson,
            catalogVersion: r.catalogVersion,
            source: r.source,
            confirmed: r.confirmed,
            confirmedBy: r.confirmedBy,
            confirmedAt: r.confirmedAt,
          })),
        );
      }

      // 12) Promote the draft (the column's documented purpose). Draft status
      //     is deliberately untouched — nothing sets it today (legacy
      //     contract), and the workspace manages its own finalized state.
      await tx
        .update(radiologyReportDraftsTable)
        .set({ finalReportId: reportRow.id })
        .where(eq(radiologyReportDraftsTable.id, draft.id));

      if (claimId) {
        await tx
          .update(radiologyWorklistTable)
          .set({ reportId: reportRow.id, updatedAt: new Date() })
          .where(eq(radiologyWorklistTable.id, claimId));
      }

      return reportRow;
    });

    return {
      kind: "signed",
      row,
      diagnostics: {
        attempted: true,
        signed: true,
        documentId: (row.structuredJson as { document_id?: string } | null)?.document_id,
        renderEngineVersion: STRUCTURED_RENDERER_VERSION,
      },
    };
  } catch (err) {
    if (err instanceof StructuredFinalSkip) {
      req.log?.warn?.({ skip: err.skipCode, detail: err.detail }, "D5 structured finalize skipped — falling back to legacy");
      return {
        kind: "skipped",
        diagnostics: { attempted: true, signed: false, fallback: "legacy", reason: err.skipCode, detail: err.detail },
      };
    }
    throw err; // unexpected → caller decides (falls back to legacy, reason recorded)
  }
}


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
  const requestedId = Number(req.params.id);
  // Ticket D8 — canonical version resolution. Explicit ?version=latest|
  // specific|root wins (D7's ?resolve=latest is kept as an alias for
  // "latest"); otherwise clinical display defaults to the LATEST signed
  // version when ff_radiology_structured_final is on, and to the exact
  // requested row (pre-D8 behavior) when it is off. Read-only — this route
  // performs no writes regardless of resolution outcome.
  const explicitMode = typeof req.query.version === "string"
    ? req.query.version.toLowerCase()
    : req.query.resolve === "latest" ? "latest" : undefined;
  const mode = await effectiveResolveMode(explicitMode);
  const version = await resolveReportVersion(requestedId, { mode, includeChain: true });
  if (!version) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  const id = version.resolvedReportId;
  logVersionResolution("viewer_get", version);
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
  // Ticket D6 — flag-gated display cutover for the viewer. Response-level
  // only (nothing is written): body is served from the validated D4 render
  // when it is IDENTICAL / APPROVED_FORMATTING_ONLY vs the stored signed
  // body; otherwise (and with the flag off) the stored body passes through
  // unchanged. Diagnostics ride along additively for audit.
  //
  // The `body` key is substituted ONLY on rows the PATCH route refuses to
  // edit (verified/delivered): editors round-trip GET /:id's `body` straight
  // back through PATCH on save, so substituting it on an editable row would
  // let a zero-edit save silently overwrite the stored signed bytes with the
  // render (adversarial-review finding, D6). On editable rows the render is
  // still available additively as `displayBody`.
  const structuredRead = await applyStructuredRead(row.r);
  const bodyImmutable = row.r.status === "verified" || row.r.status === "delivered";
  // D7 back-compat `amendment` key + D8 additive `version` metadata, both
  // describing the row actually being SERVED — derived from one resolution.
  const amendment = amendmentKeyFromVersion(version);
  // D9 — additive lifecycle metadata (pending verification, deliverability,
  // recipient re-delivery prompt). Computed only; GET stays write-free.
  const lifecycle = await buildLifecycleMetadata(row.r, version);
  res.json({
    ...row.r,
    ...(structuredRead
      ? {
          ...(bodyImmutable ? { body: structuredRead.body } : { displayBody: structuredRead.body }),
          structuredRead: structuredRead.diagnostics,
        }
      : {}),
    ...(amendment ? { amendment } : {}),
    version: versionMetadata(version),
    lifecycle,
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
// Ticket D7 — Amend: a signed structured report is superseded by a NEW signed
// row; the original row/document is never modified. One transaction, no
// partial amendments; failures return a typed error (there is no legacy
// fallback — amending is an explicit structured-path action).
// ────────────────────────────────────────────────────────────────────────────
patientReportsRouter.post("/:id/amend", async (req, res) => {
  const parentReportId = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  const session = (req as StaffAuthRequest).staffSession;

  try {
    if (!parentReportId) throw new AmendError(400, "invalid_report_id");
    if (!reason) throw new AmendError(400, "amendment_reason_required");
    if (!(await isFeatureEnabledServer("ff_radiology_structured_final"))) {
      throw new AmendError(409, "structured_final_flag_disabled");
    }
    const authority = canStructuredSign(session ?? null);
    if (!authority.allowed) throw new AmendError(403, "sign_authority_required", authority.reason);

    const signedAtIso = new Date().toISOString();

    const outcome = await db.transaction(async (tx) => {
      // 1) Reload the signed parent row.
      const [parent] = await tx
        .select()
        .from(patientReportsTable)
        .where(eq(patientReportsTable.id, parentReportId))
        .limit(1);
      if (!parent) throw new AmendError(404, "report_not_found");
      if (parent.type !== "radiology" || parent.structuredJson == null) {
        throw new AmendError(409, "not_a_signed_structured_report");
      }
      const parentDoc = parent.structuredJson as { document_id?: string; audit?: { signature?: { state?: string } } };
      if (parentDoc?.audit?.signature?.state !== "final" || !parentDoc.document_id) {
        throw new AmendError(409, "not_a_signed_structured_report");
      }

      // Linear chain: the parent must not already be amended (authoritative
      // re-check inside the tx; the UNIQUE(original_report_id) constraint is
      // the race-proof backstop at insert time).
      const [existingLink] = await tx
        .select()
        .from(patientReportAmendmentsTable)
        .where(eq(patientReportAmendmentsTable.originalReportId, parent.id))
        .limit(1);
      if (existingLink) throw new AmendError(409, "already_amended", { amendedReportId: existingLink.amendedReportId });

      // Chain root/sequence: if the parent is itself an amendment, carry root.
      const [parentAsAmendment] = await tx
        .select()
        .from(patientReportAmendmentsTable)
        .where(eq(patientReportAmendmentsTable.amendedReportId, parent.id))
        .limit(1);
      const rootReportId = parentAsAmendment?.rootReportId ?? parent.id;
      const priorAmendmentCount = parentAsAmendment?.sequenceNumber ?? 0;
      const rootDocumentId = parentAsAmendment
        ? (await tx
            .select({ originalDocumentId: patientReportAmendmentsTable.originalDocumentId })
            .from(patientReportAmendmentsTable)
            .where(eq(patientReportAmendmentsTable.rootReportId, rootReportId))
            .orderBy(asc(patientReportAmendmentsTable.sequenceNumber))
            .limit(1)).at(0)?.originalDocumentId ?? null
        : null;

      // 2) Reload the amendment draft (the study's authoritative draft) + 3) findings.
      if (parent.studyId == null) throw new AmendError(409, "no_study_for_report");
      const [draft] = await tx
        .select()
        .from(radiologyReportDraftsTable)
        .where(eq(radiologyReportDraftsTable.studyId, parent.studyId))
        .orderBy(desc(radiologyReportDraftsTable.updatedAt))
        .limit(1);
      if (!draft) throw new AmendError(409, "no_amendment_draft_for_study");
      const instances = await tx
        .select()
        .from(reportFindingInstancesTable)
        .where(eq(reportFindingInstancesTable.draftId, draft.id))
        .orderBy(asc(reportFindingInstancesTable.id));

      let worklist: FinalWorklistRow | null = null;
      if (draft.worklistId != null) {
        const [w] = await tx.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, draft.worklistId)).limit(1);
        worklist = (w as FinalWorklistRow | undefined) ?? null;
      }

      const source = buildFinalD1Source(
        draft,
        worklist,
        instances.map((r) => ({ findingId: r.findingId, structuredJson: r.structuredJson, source: r.source })),
      );
      let materialized: MaterializationOutput = { findings: [], measurements: [], recommendations: [], skipped: [] };
      let catalogPort = noFindingsCatalogPort;
      if (await isFeatureEnabledServer("ff_radiology_catalog")) {
        const catalogStore = new DrizzleCatalogStore();
        const resolver = new CatalogStoreFindingResolver(catalogStore, async (qfId) => {
          const [qf] = await tx
            .select({ label: radiologyQuickFindingsTable.label })
            .from(radiologyQuickFindingsTable)
            .where(eq(radiologyQuickFindingsTable.id, qfId))
            .limit(1);
          return qf?.label ? { label: qf.label } : null;
        });
        materialized = await materializeFindings(
          source.findingSelections.map((s) => ({ findingId: s.findingId, params: s.params as Record<string, unknown>, source: s.source })),
          resolver,
          { actor: source.createdBy ?? session!.subjectName, createdAtIso: source.createdAtIso },
        );
        catalogPort = new DrizzleStructuredReportCatalogPort(catalogStore);
      }

      // Reserve the NEW patient_reports id (the amendment document_id derives
      // from it — a disjoint id space from draft-derived ids) + the audit id.
      const ridRes = await tx.execute(sql`SELECT nextval(pg_get_serial_sequence('patient_reports','id')) AS id`);
      const ridRows = (Array.isArray(ridRes) ? ridRes : (ridRes as { rows?: unknown[] }).rows ?? []) as Array<{ id: unknown }>;
      const newReportId = Number(ridRows[0]?.id);
      const aidRes = await tx.execute(sql`SELECT nextval(pg_get_serial_sequence('audit_logs','id')) AS id`);
      const aidRows = (Array.isArray(aidRes) ? aidRes : (aidRes as { rows?: unknown[] }).rows ?? []) as Array<{ id: unknown }>;
      const auditLogRef = Number(aidRows[0]?.id);
      if (!Number.isFinite(newReportId) || newReportId <= 0 || !Number.isFinite(auditLogRef) || auditLogRef <= 0) {
        throw new AmendError(500, "id_reservation_failed");
      }

      // 4) Build the amendment document (pure), 5) validated below.
      const parentInput: AmendmentParent = {
        reportId: parent.id,
        patientId: parent.patientId,
        document: parent.structuredJson,
        rootDocumentId,
        rootReportId,
        priorAmendmentCount,
      };
      const prepared = await prepareStructuredAmendment({
        parent: parentInput,
        source,
        materialized,
        draftLegacy: {
          rawFindings: draft.rawFindings,
          impression: parseDraftImpression(draft.impression),
          recommendation: draft.recommendation,
          clientImpressionText: typeof b.impression === "string" ? b.impression : null,
        },
        sign: {
          signedBy: session!.subjectName,
          signedRole: session!.role,
          signedById: session!.subjectId,
          signedAtIso,
          auditLogRef,
        },
        reason,
        newReportId,
        draftPatientId: draft.patientId,
        // R14c at prepare time: the amendment doc names the parent as its
        // prior, and this tx has already verified the parent is signed-final
        // and not yet amended (pre-check above). The authoritative re-check
        // with the live linkage query runs again below, before the insert.
        validationPorts: {
          catalogPort,
          amendsLookup: async (docId) =>
            docId === parentDoc.document_id
              ? { state: parentDoc.audit!.signature!.state as string, alreadyAmendedBy: null }
              : null,
        },
      });
      if (!prepared.ok) throw new AmendError(409, `amendment_${prepared.stage}`, {
        detail: prepared.detail, skipReasons: prepared.skipReasons, validationErrors: prepared.validationErrors,
      });
      if (prepared.equivalence.verdict !== "equivalent") {
        throw new AmendError(409, "amendment_clinical_divergence", prepared.equivalence);
      }

      // Finalize audit row (chain protocol, reserved id) — R14b for the NEW doc.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_audit_chain'))`);
      const [prevAudit] = await tx
        .select({ chainHash: auditLogsTable.chainHash })
        .from(auditLogsTable)
        .orderBy(desc(auditLogsTable.id))
        .limit(1);
      const previousHash = prevAudit?.chainHash ?? "";
      const auditCreatedAt = new Date();
      const forwarded = req.headers["x-forwarded-for"];
      const ipAddress = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : (req.ip ?? req.socket?.remoteAddress ?? "");
      const userAgent = String(req.headers["user-agent"] ?? "");
      const auditNewValue = JSON.stringify({
        document_id: prepared.document.document_id,
        signed_content_sha256: prepared.document.audit.signature.signed_content_sha256,
        amends_document_id: prepared.amendment.amendsDocumentId,
        amends_report_id: parent.id,
        sequence_number: prepared.amendment.sequenceNumber,
      });
      const canonical = canonicalHashPayload({
        userId: session!.subjectId,
        userName: session!.subjectName,
        role: session!.role,
        action: "finalize",
        module: "radiology",
        entityType: "structured_report",
        entityId: prepared.document.document_id,
        oldValue: null,
        newValue: auditNewValue,
        reason,
        ipAddress,
        userAgent,
        createdAt: auditCreatedAt.toISOString(),
        previousHash,
      });
      await tx.insert(auditLogsTable).values({
        id: auditLogRef,
        userId: session!.subjectId,
        userName: session!.subjectName,
        role: session!.role,
        action: "finalize",
        module: "radiology",
        entityType: "structured_report",
        entityId: prepared.document.document_id,
        oldValue: null,
        newValue: auditNewValue,
        ipAddress,
        userAgent,
        reason,
        previousHash,
        chainHash: computeChainHash(canonical),
        createdAt: auditCreatedAt,
      });

      // 5) AUTHORITATIVE validation with the REAL lookups (R14b + R14c).
      const authoritative = await validateStructuredReport(prepared.document, {
        catalog: catalogPort,
        aiRules: new UnavailableAiRulesRegistryPort(),
        mode: "finalize",
        auditLogLookup: async (docId, hash) => {
          const [row] = await tx.select().from(auditLogsTable).where(eq(auditLogsTable.id, auditLogRef)).limit(1);
          return !!row && row.action === "finalize" && row.entityId === docId && (row.newValue ?? "").includes(hash);
        },
        amendsLookup: async (docId) => {
          if (docId !== parentDoc.document_id) return null;
          const [link] = await tx
            .select()
            .from(patientReportAmendmentsTable)
            .where(eq(patientReportAmendmentsTable.originalReportId, parent.id))
            .limit(1);
          return {
            state: parentDoc.audit!.signature!.state as string,
            alreadyAmendedBy: link ? link.amendedDocumentId : null,
          };
        },
      });
      if (!authoritative.ok) {
        throw new AmendError(409, "amendment_d1_validation_failed", { validationErrors: authoritative.errors });
      }

      // 7) Insert the NEW signed row at the reserved id.
      const reportNumber = await nextReportNumber();
      const [newRow] = await tx.insert(patientReportsTable).values({
        id: newReportId,
        reportNumber,
        type: "radiology",
        patientId: parent.patientId,
        testId: parent.testId,
        orderTestId: parent.orderTestId,
        orderId: parent.orderId,
        billId: parent.billId,
        studyId: parent.studyId,
        title: parent.title,
        body: prepared.renderedBody,
        parameters: parent.parameters,
        impression: prepared.legacyShape.impression.join("\n") || null,
        templateId: parent.templateId,
        createdBy: session!.subjectName,
        signedByName: session!.subjectName,
        signedAt: new Date(signedAtIso),
        isCritical: parent.isCritical,
        criticalNote: parent.criticalNote,
        stylePresetUsed: parent.stylePresetUsed,
        structuredJson: prepared.document,
        renderEngineVersion: STRUCTURED_RENDERER_VERSION,
        templateVersion: draft.templateId,
        catalogVersion: source.catalogSchemaVersion,
      }).returning();

      // 8) Snapshot the amendment's finding instances.
      if (instances.length > 0) {
        await tx.insert(reportFindingInstancesTable).values(
          instances.map((r) => ({
            draftId: null,
            reportId: newRow.id,
            findingId: r.findingId,
            anatomicZoneId: r.anatomicZoneId,
            structureId: r.structureId,
            category: r.category,
            modality: r.modality,
            structuredJson: r.structuredJson,
            catalogVersion: r.catalogVersion,
            source: r.source,
            confirmed: r.confirmed,
            confirmedBy: r.confirmedBy,
            confirmedAt: r.confirmedAt,
          })),
        );
      }

      // 9) Amendment linkage — UNIQUE(original_report_id) makes a concurrent
      // double-amend fail THIS insert, rolling the whole amendment back.
      await tx.insert(patientReportAmendmentsTable).values({
        originalReportId: parent.id,
        amendedReportId: newRow.id,
        rootReportId,
        originalDocumentId: parentDoc.document_id,
        amendedDocumentId: prepared.document.document_id,
        sequenceNumber: prepared.amendment.sequenceNumber,
        reason,
        amendedById: session!.subjectId,
        amendedByName: session!.subjectName,
      });

      // Draft points at the newest signed version (D5 semantics carried forward).
      await tx
        .update(radiologyReportDraftsTable)
        .set({ finalReportId: newRow.id })
        .where(eq(radiologyReportDraftsTable.id, draft.id));

      // 10) The parent row is deliberately never written. 11) Commit.
      return { newRow, amendment: prepared.amendment };
    });

    // 12) Downstream state after commit — BEND-1 (D10 closure): persist the
    // re-delivery obligations this amendment creates (recipients of older
    // revisions are owed the new one) and the per-revision PACS re-archive
    // duty. Creation only — NOTHING is sent unless the default-OFF auto-send
    // policy was explicitly enabled, in which case durable jobs are queued.
    let redeliverySummary: { created: number; skipped: number; pacsPending: boolean } | null = null;
    try {
      redeliverySummary = await createObligationsForAmendment(outcome.newRow.id, {
        userId: session!.subjectId,
        userName: session!.subjectName,
        role: session!.role,
      });
      if (redeliverySummary.created > 0 && await isRedeliveryAutoSendEnabled()) {
        const open = await db
          .select({ id: radiologyRedeliveryObligationsTable.id, status: radiologyRedeliveryObligationsTable.status })
          .from(radiologyRedeliveryObligationsTable)
          .where(eq(radiologyRedeliveryObligationsTable.reportId, outcome.newRow.id));
        for (const o of open) {
          if (o.status !== "pending") continue;
          await db.update(radiologyRedeliveryObligationsTable)
            .set({ status: "queued", actedBy: "auto-send-policy", actedAt: new Date(), updatedAt: new Date() })
            .where(eq(radiologyRedeliveryObligationsTable.id, o.id));
          await enqueueRadiologyJob({
            operationType: REDELIVERY_SEND_JOB,
            entityType: "report",
            entityId: outcome.newRow.id,
            payload: { obligationId: o.id },
            idempotencyKey: `${REDELIVERY_SEND_JOB}:${o.id}`,
          });
        }
      }
    } catch (err) {
      // Obligation creation must never fail the committed amendment; the
      // reconcile repair action recovers any missed creation from the
      // immutable amendment + share history.
      req.log?.error({ err }, "BEND-1 obligation creation after amendment failed");
    }

    void freezeSignedReportPresentation(outcome.newRow.id);
    res.status(201).json({
      report: outcome.newRow,
      amendment: {
        ...outcome.amendment,
        amendedReportId: outcome.newRow.id,
      },
      redelivery: redeliverySummary,
    });
  } catch (err) {
    if (err instanceof AmendError) {
      res.status(err.httpStatus).json({ error: err.code, detail: err.detail ?? null });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    // The UNIQUE(original_report_id) constraint firing = concurrent double-amend.
    if (/duplicate key|unique/i.test(msg)) {
      res.status(409).json({ error: "already_amended", detail: "concurrent amendment detected" });
      return;
    }
    req.log?.error({ err }, "D7 amendment transaction failed");
    res.status(500).json({ error: "amendment_failed" });
  }
});

// PCPNDT server-side finalize guard — resolves the DB-authoritative
// modality/studyDescription for a POST /api/patient-reports `studyId`,
// never trusting client-supplied values (e.g. the `parameters` blob, which
// is opaque, unvalidated JSON stored verbatim). The frontend sends
// `worklistId ?? studyId` as this field (see radiologyReportLifecycle.ts),
// so it may be either a radiology_worklist.id or a radiology_studies.id —
// try both, matching how POST /api/internal/radiology/report-status already
// resolves the same ambiguity for its own PCPNDT guard.
async function resolveWorklistRowForPcpndtGuard(
  studyIdNum: number,
): Promise<{ modality: string; studyDescription: string | null } | null> {
  const [byWorklistId] = await db
    .select({ modality: radiologyWorklistTable.modality, studyDescription: radiologyWorklistTable.studyDescription })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, studyIdNum))
    .limit(1);
  if (byWorklistId) return byWorklistId;
  const [byStudyId] = await db
    .select({ modality: radiologyWorklistTable.modality, studyDescription: radiologyWorklistTable.studyDescription })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyId, studyIdNum))
    .limit(1);
  return byStudyId ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Create
// ────────────────────────────────────────────────────────────────────────────
patientReportsRouter.post("/", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const typeHint = String(b.type ?? "").toLowerCase();
  const studyRef = b.studyId ? Number(b.studyId) : null;
  const worklistIdIn = b.worklistId ? Number(b.worklistId) : null;
  // Only bind when the client supplies a study/worklist reference. Study-less
  // radiology create (legacy / D5 fixtures / non-workspace tools) keeps the
  // pre-hardening path intentionally — workspace finalize always sends
  // studyId/worklistId and must pass the Match Center gate. Requiring bind for
  // all type=radiology would break those study-less flows; do that as a
  // separate product decision with fixture updates.
  const shouldBindRadiology = !!(studyRef || worklistIdIn);

  let bound: BoundRadiologyIdentity | null = null;
  if (shouldBindRadiology) {
    try {
      bound = await bindRadiologyReportIdentity({
        studyRef,
        worklistId: worklistIdIn,
        patientId: b.patientId ? Number(b.patientId) : null,
        testId: b.testId ? Number(b.testId) : null,
        orderId: b.orderId ? Number(b.orderId) : null,
        orderTestId: b.orderTestId ? Number(b.orderTestId) : null,
      });
    } catch (err) {
      if (err instanceof RadiologyIdentityError) {
        res.status(err.httpStatus).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  }

  const patientId = bound ? bound.patientId : Number(b.patientId);
  const testId = bound ? bound.testId : Number(b.testId);
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
  const type = (typeHint || (test.department && /(USG|MRI|CT|X-?RAY|MAMMO|DEXA|RAD)/i.test(test.department) ? "radiology" : "pathology")).toLowerCase();

  // PCPNDT server-side finalize gate. This is the actual content-persisting
  // write (creates the signed-eligible patient_reports row) — checking here,
  // BEFORE any row is created or the D5 structured-finalize transaction
  // runs, prevents an obstetric/fetal ultrasound report's content from ever
  // being persisted or auto-signed without PCPNDT Form F compliance. Scoped
  // strictly to type === "radiology" with a resolvable worklist row, so
  // pathology/lab reports and every other radiology study (MRI, CT,
  // non-obstetric USG) are completely unaffected.
  //
  // Roadmap §1.4 step 2 (docs/usg-reporting/pcpndt-canonical-roadmap.md):
  // this is no longer a blanket block. It now runs the SAME shared Form F
  // verification the legacy usgReports.ts finalize has always enforced
  // (lib/pcpndtCompliance.ts) — a compliant obstetric study finalizes here
  // normally; a non-compliant one is refused with the exact missing fields.
  // Step 4: an admin/super_admin may override a failing check with a
  // documented reason (mirrors the legacy finalize-force gate) — audited.
  if (type === "radiology") {
    const studyIdForGuard = b.studyId ? Number(b.studyId) : null;
    const worklistRowForGuard = studyIdForGuard ? await resolveWorklistRowForPcpndtGuard(studyIdForGuard) : null;
    if (worklistRowForGuard && isObstetricUsgStudy(worklistRowForGuard.modality, worklistRowForGuard.studyDescription)) {
      const compliance = await checkPcpndtFormFCompliance(patientId);
      if (!compliance.compliant) {
        const overrideReason = typeof b.pcpndtOverrideReason === "string" ? b.pcpndtOverrideReason.trim() : "";
        const sessionRole = (req as StaffAuthRequest).staffSession?.role ?? "";
        const overrideRequested = b.pcpndtOverride === true;
        if (overrideRequested && PCPNDT_OVERRIDE_ROLES.has(sessionRole) && overrideReason.length >= 3) {
          // Audited escape hatch for exceptional cases — same roles and
          // documented-reason requirement as legacy POST /:id/finalize-force.
          const session = (req as StaffAuthRequest).staffSession;
          await auditLog({
            userId: session?.subjectId ?? null,
            userName: session?.subjectName ?? "system",
            role: sessionRole || "system",
            action: "pcpndt_override_finalize",
            module: "radiology",
            entityType: "patient_report",
            entityId: null,
            newValue: JSON.stringify({
              patientId,
              studyId: studyIdForGuard,
              complianceErrors: compliance.errors,
            }),
            reason: overrideReason,
          });
        } else {
          res.status(409).json({
            error: "pcpndt_compliance_required",
            message:
              "This is an obstetric/fetal ultrasound study and its PCPNDT Form F record is missing or incomplete. Complete and verify Form F for this patient (Form F page), then finalize again. An admin/super_admin may override with a documented reason (pcpndtOverride + pcpndtOverrideReason).",
            validationErrors: compliance.errors,
            formFId: compliance.formFId,
          });
          return;
        }
      }
    }
  }

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

  // ── Ticket D5 — structured signed finalize (default OFF) ─────────────────
  // Only a radiology report tied to a study is eligible, only when
  // ff_radiology_structured_final is enabled, and only for a session with
  // real sign authority. Every ineligible/failed case falls through to the
  // legacy path below — flag OFF is byte-identical to the pre-D5 route.
  let structuredDiagnostics: Record<string, unknown> | null = null;
  const studyIdNum = bound?.worklistId ?? (b.studyId ? Number(b.studyId) : null);
  if (bound?.worklist.reportId) {
    const [existingReport] = await db
      .select()
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, bound.worklist.reportId))
      .limit(1);
    if (existingReport) {
      res.status(200).json({ ...existingReport, idempotent: true });
      return;
    }
  }
  if (type === "radiology" && studyIdNum && (await isFeatureEnabledServer("ff_radiology_structured_final"))) {
    const session = (req as StaffAuthRequest).staffSession;
    const authority = canStructuredSign(session ?? null);
    if (!authority.allowed) {
      // Structured signing denied (typist / missing :sign grant / no session).
      // The legacy finalize below proceeds exactly as today.
      structuredDiagnostics = { attempted: false, signed: false, fallback: "legacy", reason: authority.reason };
    } else {
      for (let attempt = 0; attempt < 3; attempt++) {
        const reportNumber = await nextReportNumber();
        try {
          const outcome = await structuredFinalizeTransaction(req as StaffAuthRequest, {
            reportNumber,
            studyId: bound?.worklistId ?? studyIdNum,
            patientId,
            testId,
            orderTestId: bound?.orderTestId ?? (b.orderTestId ? Number(b.orderTestId) : null),
            orderId: bound?.orderId ?? (b.orderId ? Number(b.orderId) : null),
            billId: bound?.billId ?? (b.billId ? Number(b.billId) : null),
            title: String(b.title ?? `${test.name} — Report`).trim(),
            parameters: typeof b.parameters === "string" ? b.parameters : (b.parameters ? JSON.stringify(b.parameters) : null),
            clientImpressionText: typeof b.impression === "string" ? b.impression : null,
            templateId: b.templateId ? Number(b.templateId) : null,
            isCritical: b.isCritical === true,
            criticalNote: typeof b.criticalNote === "string" ? b.criticalNote : null,
            presetUsed,
          });
          if (outcome.kind === "signed") {
            if (bound) {
              await db
                .update(radiologyWorklistTable)
                .set({ reportId: outcome.row.id, updatedAt: new Date() })
                .where(eq(radiologyWorklistTable.id, bound.worklistId));
            }
            void freezeSignedReportPresentation(outcome.row.id);
            res.status(201).json({ ...outcome.row, structuredFinal: outcome.diagnostics });
            return;
          }
          structuredDiagnostics = outcome.diagnostics;
          break; // clean skip → legacy fallback
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/duplicate key|unique/i.test(msg) && attempt < 2) continue; // fresh number, retry
          // Unexpected failure: the transaction already rolled back (no partial
          // signed state). Record it and fall back to the legacy finalize.
          req.log?.error({ err }, "D5 structured finalize transaction failed — falling back to legacy");
          structuredDiagnostics = { attempted: true, signed: false, fallback: "legacy", reason: "structured_txn_failed", error: msg };
          break;
        }
      }
    }
  }

  // Retry on UNIQUE collision for the report number.
  for (let attempt = 0; attempt < 3; attempt++) {
    const reportNumber = await nextReportNumber();
    try {
      const insertValues = {
        reportNumber,
        type,
        patientId,
        testId,
        orderTestId: bound?.orderTestId ?? (b.orderTestId ? Number(b.orderTestId) : null),
        orderId: bound?.orderId ?? (b.orderId ? Number(b.orderId) : null),
        billId: bound?.billId ?? (b.billId ? Number(b.billId) : null),
        studyId: bound?.worklistId ?? (b.studyId ? Number(b.studyId) : null),
        title: String(b.title ?? `${test.name} — Report`).trim(),
        body: typeof b.body === "string" ? b.body : "",
        parameters: typeof b.parameters === "string" ? b.parameters : (b.parameters ? JSON.stringify(b.parameters) : null),
        impression: typeof b.impression === "string" ? b.impression : null,
        templateId: b.templateId ? Number(b.templateId) : null,
        createdBy: typeof b.createdBy === "string" ? b.createdBy : null,
        isCritical: b.isCritical === true,
        criticalNote: typeof b.criticalNote === "string" ? b.criticalNote : null,
        stylePresetUsed: presetUsed,
      };
      const row = bound
        ? await db.transaction(async (tx) => {
            await claimWorklistForFinalize(tx, bound!.worklistId);
            const [created] = await tx.insert(patientReportsTable).values(insertValues).returning();
            await tx
              .update(radiologyWorklistTable)
              .set({ reportId: created!.id, updatedAt: new Date() })
              .where(eq(radiologyWorklistTable.id, bound!.worklistId));
            return created!;
          })
        : (await db.insert(patientReportsTable).values(insertValues).returning())[0];
      // Legacy response is byte-identical when no structured attempt was made
      // (flag OFF); with the flag ON, fallback diagnostics ride along additively.
      res.status(201).json(structuredDiagnostics ? { ...row, structuredFinal: structuredDiagnostics } : row);
      return;
    } catch (err) {
      if (err instanceof RadiologyIdentityError) {
        if (err.code === "ALREADY_FINALIZED" && bound?.worklist.reportId) {
          const [existingReport] = await db
            .select()
            .from(patientReportsTable)
            .where(eq(patientReportsTable.id, bound.worklist.reportId))
            .limit(1);
          if (existingReport) {
            res.status(200).json({ ...existingReport, idempotent: true });
            return;
          }
        }
        res.status(err.httpStatus).json({ error: err.message, code: err.code });
        return;
      }
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
  // Ticket D6 defense-in-depth: a row carrying a SIGNED-final structured
  // document (D5) is a signed medico-legal artifact regardless of the legacy
  // status column (D5 rows keep the schema default "draft"). Editing its
  // content in place would silently diverge — or destroy — the signed bytes,
  // so it gets the same use-Amend contract as verified reports.
  const signedStructured =
    (existing.structuredJson as { audit?: { signature?: { state?: string } } } | null)?.audit?.signature?.state === "final";
  if (signedStructured) {
    if (
      typeof b.body === "string" || typeof b.parameters !== "undefined" ||
      typeof b.title === "string" || typeof b.impression === "string"
    ) {
      res.status(409).json({ error: "Signed structured reports cannot be edited. Use Amend instead." });
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
  // D9 defense in depth: roles that may never sign are refused up front,
  // even on the legacy path and even if the UI already hides the action.
  const session = (req as StaffAuthRequest).staffSession;
  const sessionRole = (session?.role ?? "").toLowerCase();
  if (SIGN_DENY_ROLES.has(sessionRole)) {
    await auditLifecycleEvent("legacy_sign_rejected", { userId: session?.subjectId, userName: session?.subjectName, role: session?.role }, String(id), { reportId: id }, `role_cannot_sign:${sessionRole}`);
    res.status(403).json({ error: "role_cannot_sign", message: "This role is not authorized to sign reports." });
    return;
  }
  const [existing] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  if (existing.status === "verified" || existing.status === "delivered") {
    res.status(409).json({ error: "Report already verified" });
    return;
  }
  // D9 Phase 2 — a report carrying a signed-FINAL structured document is
  // already cryptographically signed (D5/D7 stamped row authorship from the
  // server session). Legacy sign would overwrite signedByName/signedAt/
  // signatureId with client-supplied values and misrepresent lifecycle
  // state; it is refused, and the caller is pointed at the structured
  // countersign workflow. Legacy unstructured reports are untouched.
  const signedDoc = structuredSignedDocOf(existing.structuredJson);
  if (signedDoc) {
    await auditLifecycleEvent(
      "legacy_sign_rejected",
      { userId: session?.subjectId, userName: session?.subjectName, role: session?.role },
      signedDoc.document_id,
      { reportId: id, documentId: signedDoc.document_id, signedBy: existing.signedByName },
      "structured_signed_report",
    );
    res.status(409).json({
      error: "structured_signed_report",
      message: "This report carries a signed structured document; its signature cannot be overwritten. Use POST /:id/verify to countersign it.",
    });
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
  if (row) void freezeSignedReportPresentation(row.id);
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
  // D9 Phase 3 — structured countersign. A row carrying a signed-FINAL
  // structured document is verifiable directly from its current lifecycle
  // state (the D1 signature IS the sign step; legacy sign is refused for
  // these rows). Flag OFF falls through to the exact pre-D9 legacy guards.
  const structuredDoc = structuredSignedDocOf(existing.structuredJson);
  if (structuredDoc && (await isFeatureEnabledServer("ff_radiology_structured_final"))) {
    const session = (req as StaffAuthRequest).staffSession;
    if (!session) {
      res.status(401).json({ error: "Staff authentication required" });
      return;
    }
    const result = await performStructuredVerify(
      session,
      existing,
      structuredDoc,
      verifierSigId,
      typeof b.verifierNotes === "string" ? b.verifierNotes : null,
    );
    res.status(result.status).json(result.body);
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

  hookConsumeOnReportVerified({
    id: row.id,
    testId: row.testId,
    verifiedByName: row.verifiedByName,
  });

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
      // result.ok alone is not "sent" anymore -- sendReportDelivery now goes
      // through the wa_outbox chokepoint, where ok:true can also mean
      // "shadow-mode suppressed, never reached Meta" (result.skipped) or
      // "durably queued, not yet attempted." Recording that as sent/delivered
      // would falsely mark a report as reaching the patient. reportSharesTable
      // has no third "skipped" state, so a skipped send is recorded as
      // "failed" (honest: it was NOT sent) rather than falsely "sent".
      const actuallySent = result.ok && !result.skipped;
      const status = actuallySent ? "sent" : "failed";
      await db.insert(reportSharesTable).values({
        reportId: id, channel: "whatsapp", recipient: info.phone,
        sharedBy: "auto-on-verify", status,
        errorMessage: result.skipped ? "WhatsApp sending is disabled/suppressed" : (result.error ?? null),
      }).catch(() => undefined);
      if (actuallySent) {
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

// ── Ticket D8 — version-aware artifact builder ───────────────────────────────
// Every server-rendered delivery surface (print, PDF, public-token PDF, email
// share, PACS archive) flows through here. Resolution to the LATEST signed
// version is the default (flag-gated via effectiveResolveMode); explicit
// historical access renders the exact requested row WITH a superseded
// watermark. Read-only with respect to report rows.

export interface ReportArtifactOptions {
  autoPrint?: boolean;
  useUpdatedStyle?: boolean;
  /** Diagnostic label for Phase 7 logging: print|pdf|public_pdf|email|pacs. */
  surface?: string;
  /** Explicit resolve mode; undefined → flag-gated default. */
  versionMode?: ResolveMode;
  /** Patient-facing surfaces pass ["verified","delivered"] so "latest" never
   *  resolves to a version that surface is not allowed to deliver. */
  deliverableStatuses?: string[];
  /** R1.1/R1.2 — presentation template override "key" or "key@version"
   *  (staff print/PDF only). When absent, precedence applies: frozen signed
   *  identity → copy-type active selection → standard active → care-classic. */
  templateId?: string;
  /** R1.2 — copy type demanded by the surface (public delivery → patient). */
  copyType?: CopyType;
}

export interface ReportArtifact {
  html: string;
  version: ResolvedReportVersion;
}

export async function buildReportArtifact(
  reportId: number,
  opts: ReportArtifactOptions = {},
): Promise<ReportArtifact | null> {
  const mode = await effectiveResolveMode(opts.versionMode);
  const version = await resolveReportVersion(reportId, {
    mode,
    includeChain: true,
    deliverableStatuses: opts.deliverableStatuses,
  });
  if (!version) return null;
  logVersionResolution(opts.surface ?? "artifact", version);
  const html = await renderReportVersionHtml(version.resolvedReportId, opts.autoPrint === true, opts.useUpdatedStyle, version, opts.templateId, opts.copyType);
  if (html == null) return null;
  return { html, version };
}

// R1.2 Phase 3 — record the presentation template a report was SIGNED
// under. Best-effort: signing must never fail because of presentation
// bookkeeping; unique(report_id) makes it idempotent and never-rewriting.
async function freezeSignedReportPresentation(reportId: number): Promise<void> {
  try {
    // Freeze the STANDARD (clinical) identity WITH its full definition, so the
    // finalized report re-renders exactly even if the version row is later lost.
    const record = await resolveTemplateRecordForRender({ copyType: "standard" });
    await freezeReportPresentation(reportId, record);
  } catch { /* the freeze-less report falls back to the active selection */ }
}

/** Pre-D8 surface kept verbatim for existing callers: default version policy,
 *  html-only result. */
export async function buildReportHtml(reportId: number, autoPrint: boolean, useUpdatedStyle?: boolean): Promise<string | null> {
  const artifact = await buildReportArtifact(reportId, { autoPrint, useUpdatedStyle });
  return artifact ? artifact.html : null;
}

/** D8 Phase 4 — the visual safeguards. A superseded row NEVER renders without
 *  the banner + diagonal watermark; the latest amendment announces itself with
 *  version number and reason; a corrupt chain surfaces an integrity warning.
 *  Pure string building — no queries, no writes. */
function versionSafeguardHtml(version: ResolvedReportVersion): { banner: string; watermark: string } {
  const parts: string[] = [];
  let watermark = "";
  if (version.warnings.length > 0) {
    parts.push(`<div class="version-warning">⚠ AMENDMENT HISTORY WARNING — the amendment chain for this report could not be verified (${escapeHtml(version.warnings[0])}). Showing the exact requested version.</div>`);
  }
  if (version.resolvedSuperseded) {
    const superseding = version.chain?.find((c) => c.sequenceNumber === version.sequenceNumber + 1) ?? null;
    const supersedingInfo = superseding
      ? `<br/>Amended${superseding.amendedAt ? ` on ${new Date(superseding.amendedAt).toLocaleString("en-IN")}` : ""}${superseding.amendedByName ? ` by ${escapeHtml(superseding.amendedByName)}` : ""}${superseding.reason ? ` — Reason: ${escapeHtml(superseding.reason)}` : ""}`
      : "";
    parts.push(`<div class="superseded-banner">SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS<br/>This document is Version ${version.sequenceNumber} of ${version.totalVersions} and must not be used for clinical decisions. Latest version: ${escapeHtml(version.latestReport?.reportNumber ?? `#${version.latestReportId}`)}.${supersedingInfo}</div>`);
    watermark = `<div class="superseded-watermark" aria-hidden="true">SUPERSEDED</div>`;
  } else if (version.sequenceNumber > 1) {
    parts.push(`<div class="amended-banner">AMENDED REPORT — Version ${version.sequenceNumber} of ${version.totalVersions}${version.amendmentReason ? ` • Reason: ${escapeHtml(version.amendmentReason)}` : ""}<br/>This version supersedes all earlier versions. Previous versions remain on file.</div>`);
  }
  return { banner: parts.join("\n      "), watermark };
}

async function renderReportVersionHtml(reportId: number, autoPrint: boolean, useUpdatedStyle?: boolean, version?: ResolvedReportVersion, templateId?: string, copyType?: CopyType): Promise<string | null> {
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

  // Ticket D6 — flag-gated display cutover for every server-rendered surface
  // that flows through this builder (print, PDF, public/WhatsApp PDF, email
  // share, PACS archive). Local variable only; the row/DB are never written.
  const structuredRead = await applyStructuredRead(r);
  const displayBody = structuredRead ? structuredRead.body : r.body;

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
              ...DEFAULT_INSTITUTIONAL_STYLE,
              presetName: "Care Diagnostics Default",
            },
            "Compact Radiology": {
              ...DEFAULT_INSTITUTIONAL_STYLE,
              presetName: "Compact Radiology",
              sectionOrder: "Technique,Findings,Impression",
              showClinicalHistory: false, showComparison: false, showRecommendation: true, showCriticalCommunication: true, showMeasurements: false,
              headingStyle: "bold", subheadingStyle: "bold", abnormalEmphasis: "bold_both", spacing: "compact", lineGap: "compact",
              printLayout: "half_page", margins: "narrow", fontSize: "small",
              logoPosition: "left", signaturePosition: "right", imagePlacement: "inline", studyTitleStyle: "plain",
              showRadiologistName: true, showDegree: true, showRegNumber: false, showDigitalSignature: true, showTimestamp: false, showQrVerification: false,
            },
            "Formal Letterpad": {
              ...DEFAULT_INSTITUTIONAL_STYLE,
              presetName: "Formal Letterpad",
              headingStyle: "bold_underlined", subheadingStyle: "underlined", abnormalEmphasis: "bold_impression",
              spacing: "comfortable", lineGap: "comfortable", studyTitleStyle: "underlined",
              logoPosition: "left", signaturePosition: "right", imagePlacement: "inline",
            },
            "Plain A4": {
              ...DEFAULT_INSTITUTIONAL_STYLE,
              presetName: "Plain A4",
              headingStyle: "plain", subheadingStyle: "plain", abnormalEmphasis: "none",
              printLayout: "a4_plain", studyTitleStyle: "plain",
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

  // R1.1 — parameters, stamp, banners and signatures are now MODELED and the
  // shared presentation layer renders them (one pipeline, no duplicated HTML).
  let parameterRows: ReportParameterRow[] = [];
  if (r.parameters) {
    try {
      const arr = JSON.parse(r.parameters) as Param[];
      if (Array.isArray(arr)) {
        parameterRows = arr.map((p) => {
          const flag = String(p.flag ?? "normal").toLowerCase().replace(/[^a-z0-9-]/g, "");
          return {
            name: p.name,
            result: String(p.result ?? p.value ?? ""),
            unit: p.unit ?? "",
            refRange: p.refRange ?? "",
            flag: flag === "normal" ? "" : flag,
          };
        });
      }
    } catch { /* ignore parse errors */ }
  }

  const stamp: ReportDocumentModel["stamp"] = r.verifiedAt
    ? { kind: "verified", label: `VERIFIED on ${new Date(r.verifiedAt).toLocaleString("en-IN")}` }
    : r.signedAt
      ? { kind: "pending", label: "PRELIMINARY — pending verification" }
      : { kind: "draft", label: "DRAFT (not signed)" };

  function sigModel(sig: typeof sigPrimary, fallbackName: string | null, label: string, when: Date | null): ReportSignatureModel | null {
    if (!sig && !fallbackName) return null;
    return {
      imageDataUrl: showDigitalSignature ? sig?.imageDataUrl ?? null : null,
      name: showRadiologistName ? (sig?.name ?? fallbackName ?? "") : "",
      qualification: showDegree ? sig?.qualification ?? null : null,
      role: sig?.role ?? null,
      registrationNo: showRegNumber ? sig?.registrationNo ?? null : null,
      label,
      whenLabel: when && showTimestamp ? ` ${new Date(when).toLocaleString("en-IN")}` : "",
    };
  }

  // Style chrome is built after template resolution so CARE letter-pad
  // templates skip the square-logo dropdown / Style header overrides.

  // D8 — visual safeguards for the served version (empty strings when the
  // report has no amendment chain). Semantics are FROZEN — the fragments pass
  // through the presentation layer unchanged.
  const safeguards = version ? versionSafeguardHtml(version) : { banner: "", watermark: "" };

  // R1.1 — selected key images resolve from persisted DICOM references
  // (draft → final_report_id linkage; amendments share the root's draft).
  // Failure-tolerant: a slow/absent PACS never blocks printing.
  let keyImages: ReportKeyImageModel[] = [];
  if (r.type === "radiology") {
    try {
      keyImages = await resolveReportPrintKeyImages([
        version?.rootReportId ?? reportId,
        version?.resolvedReportId ?? reportId,
        reportId,
      ]);
    } catch { keyImages = []; }
  }

  // R1.4 — a real scannable QR (see generateReportQrDataUrl); null for any
  // report not yet verified/delivered, or when showQrVerification is off —
  // renderReportDocument then emits no QR block at all rather than a stub.
  const qrDataUrl = showQrVerification && r.type === "radiology"
    ? await generateReportQrDataUrl(version?.resolvedReportId ?? reportId, r.status)
    : null;

  const model: ReportDocumentModel = {
    reportNumber: r.reportNumber,
    studyTitle: r.title,
    typeLabel: r.type.toUpperCase(),
    statusLabel: r.status.replace(/_/g, " ").toUpperCase(),
    clinic: {
      name: clinic?.name ?? "Care Diagnostics",
      tagline: clinic?.tagline ?? "",
      address: clinic?.address ?? "",
      phone: clinic?.phone ?? "",
      email: clinic?.email ?? "",
      website: clinic?.website ?? "",
      logoDataUrl: clinic?.logoDataUrl ?? null,
    },
    patientRows: [
      { label: "Patient", value: patientName },
      { label: "Patient ID", value: row.patientCode ?? "\u2014" },
      { label: "Age / Sex", value: `${ageStr}${ageStr && row.patientGender ? " / " : ""}${row.patientGender ?? ""}` },
      { label: "Date", value: new Date(r.createdAt).toLocaleDateString("en-IN") },
      { label: "Test", value: row.testName ?? "\u2014" },
      { label: "Test Code", value: row.testCode ?? "\u2014" },
      { label: "Type", value: r.type.toUpperCase() },
      { label: "Status", value: r.status.replace(/_/g, " ").toUpperCase() },
    ],
    safeguardBannerHtml: safeguards.banner,
    safeguardWatermarkHtml: safeguards.watermark,
    isCritical: r.isCritical,
    criticalNote: r.criticalNote,
    impression: r.impression,
    parameters: parameterRows,
    // Radiology bodies are trusted HTML from the frozen render pipeline;
    // everything else is escaped plain text (unchanged behavior).
    ...(r.type === "radiology" ? { bodyHtml: displayBody ?? "" } : { bodyText: displayBody ?? "" }),
    keyImages,
    stamp,
    signatures: [
      sigModel(sigPrimary, r.signedByName, "Signed:", r.signedAt as Date | null),
      sigModel(sigVerifier, r.verifiedByName, "Verified:", r.verifiedAt as Date | null),
    ].filter((s): s is ReportSignatureModel => s != null),
    showQrPlaceholder: showQrVerification && r.type === "radiology",
    qrDataUrl,
    footerNote: clinic?.footerNote ?? "",
    // R1.4 — a signed/verified/delivered report is a fixed historical
    // document: its footer should show WHEN IT WAS ISSUED, not the instant
    // of this particular render. Previously this was new Date() on every
    // single call, so re-printing or re-downloading the exact same signed
    // report minutes apart produced different bytes and a different visible
    // timestamp each time. Drafts/pending reports (still actively being
    // worked on, no stable issue time yet) keep showing the render instant.
    generatedAtLabel: (
      (r.status === "verified" || r.status === "delivered")
        ? (r.verifiedAt as Date | null) ?? (r.signedAt as Date | null) ?? (r.createdAt as Date | null)
        : null
    )?.toLocaleString("en-IN") ?? new Date().toLocaleString("en-IN"),
    autoPrint,
  };

  // R1.2 — deterministic template resolution: explicit staff override →
  // frozen signed identity of THIS revision → copy-type active selection →
  // standard active selection → care-classic. Never throws; a resolution
  // problem can never stop a report from printing.
  const baseTemplate = await resolveTemplateForRender({ explicit: templateId, reportId, copyType });
  const template = applyInstitutionalTemplateOverrides(baseTemplate, instStyle);

  let customStyles = "";
  try {
    const scaleRows = await db.select({ key: pacsSettingsTable.key, value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(and(
        inArray(pacsSettingsTable.key, [REPORT_HEADER_SCALE_KEY, REPORT_LOGO_SCALE_KEY, REPORT_FOOTER_SCALE_KEY]),
        eq(pacsSettingsTable.category, "report"),
      ));
    const scaleVal = (k: string) => scaleRows.find((row) => row.key === k)?.value;
    customStyles += buildReportSurfaceCss(template, instStyle, {
      headerScale: scaleVal(REPORT_HEADER_SCALE_KEY),
      logoScale: scaleVal(REPORT_LOGO_SCALE_KEY),
      footerScale: scaleVal(REPORT_FOOTER_SCALE_KEY),
    });
  } catch {
    customStyles += buildReportSurfaceCss(template, instStyle);
  }

  return renderReportDocument(model, template, { customCss: customStyles });
}

// D8 — print/PDF default to the LATEST signed version (flag-gated); explicit
// ?version=specific|root keeps exact historical access, rendered WITH the
// superseded banner + watermark. Delivery side effects (share log, delivered
// stamp, audit) always target the row actually served.
function explicitTemplateParam(req: Request): string | undefined {
  const t = typeof req.query.template === "string" ? req.query.template.trim() : "";
  return parseExplicitTemplateParam(t) ? t : undefined;
}

function explicitVersionParam(req: Request): ResolveMode | undefined {
  const v = typeof req.query.version === "string" ? req.query.version.toLowerCase() : "";
  return v === "latest" || v === "specific" || v === "root" ? v : undefined;
}

patientReportsRouter.get("/:id/print", async (req, res) => {
  const id = Number(req.params.id);
  const useUpdatedStyle = req.query.useUpdatedStyle === "true";
  // R1.1 — ?preview=true renders the SAME artifact for on-screen preview
  // WITHOUT delivery bookkeeping (no share log, no delivered stamp, no
  // delivery audit) and without the auto-print script. Presentation only.
  const previewOnly = req.query.preview === "true";
  const artifact = await buildReportArtifact(id, {
    autoPrint: !previewOnly, useUpdatedStyle, surface: previewOnly ? "print_preview" : "print", versionMode: explicitVersionParam(req),
    templateId: explicitTemplateParam(req),
  });
  if (!artifact) {
    res.status(404).send("Report not found");
    return;
  }
  const servedId = artifact.version.resolvedReportId;
  if (!previewOnly) {
    // Log a "print" share entry (best-effort).
    await db.insert(reportSharesTable).values({ reportId: servedId, channel: "print", sharedBy: (req.query.by as string) || null }).catch(() => {});
    // If the served report was verified, mark as delivered on first print.
    await markDeliveredIfVerified(servedId).catch(() => {});
    const session = (req as StaffAuthRequest).staffSession;
    await auditDeliveryResolution("print", artifact.version, { userId: session?.subjectId, userName: session?.subjectName, role: session?.role });
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // R1.3 — patient data (incl. inlined DICOM key images) is never cacheable.
  res.setHeader("Cache-Control", "no-store");
  setVersionHeaders(res, artifact.version);
  res.send(artifact.html);
});

// PDF endpoint — the same artifact HTML the /print route serves, rendered to
// a real PDF via headless Chromium (see htmlToPdf.ts) rather than sent as
// HTML with a misleading Content-Type.
patientReportsRouter.get("/:id/pdf", async (req, res) => {
  const id = Number(req.params.id);
  const useUpdatedStyle = req.query.useUpdatedStyle === "true";
  const artifact = await buildReportArtifact(id, {
    useUpdatedStyle, surface: "pdf", versionMode: explicitVersionParam(req),
    templateId: explicitTemplateParam(req),
  });
  if (!artifact) {
    res.status(404).send("Report not found");
    return;
  }
  const servedId = artifact.version.resolvedReportId;
  await db.insert(reportSharesTable).values({ reportId: servedId, channel: "pdf", sharedBy: (req.query.by as string) || null }).catch(() => {});
  await markDeliveredIfVerified(servedId).catch(() => {});
  const session = (req as StaffAuthRequest).staffSession;
  await auditDeliveryResolution("pdf", artifact.version, { userId: session?.subjectId, userName: session?.subjectName, role: session?.role });
  const pdfBuffer = await renderHtmlToPdf(artifact.html);
  res.setHeader("Content-Type", "application/pdf");
  // R1.3 — patient data (incl. inlined DICOM key images) is never cacheable.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `inline; filename="${versionedFilename(artifact.version)}"`);
  setVersionHeaders(res, artifact.version);
  res.send(pdfBuffer);
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
  if (row.status !== "verified" && row.status !== "delivered" && row.status !== "pending_verification") {
    res.status(403).send("Report not yet finalized"); return;
  }
  const useUpdatedStyle = req.query.useUpdatedStyle === "true";
  // D8 Phase 6 — a token minted for a now-superseded report resolves to the
  // latest signed amendment by default, but ONLY to a version this surface is
  // allowed to deliver (signed/verified/delivered — drafts never leak).
  // If no newer version qualifies yet, the token's own row is served WITH the
  // superseded banner + watermark — never presented as current. Access
  // control is unchanged: the token was validated against its row above, no
  // new token is minted, no internal ids appear in the URL, and there is no
  // patient-controllable version parameter.
  const artifact = await buildReportArtifact(row.id, {
    useUpdatedStyle, surface: "public_pdf",
    deliverableStatuses: ["pending_verification", "verified", "delivered"],
    copyType: "patient",
  });
  if (!artifact) { res.status(404).send("Not found"); return; }
  const servedId = artifact.version.resolvedReportId;
  await db.insert(reportSharesTable).values({
    reportId: servedId, channel: "pdf", recipient: "public-link",
    sharedBy: "patient-link", status: "sent",
  }).catch(() => undefined);
  await markDeliveredIfVerified(servedId).catch(() => undefined);
  await auditDeliveryResolution("public_pdf", artifact.version, { userName: "patient-link", role: "public" }, { tokenReportId: row.id });
  const pdfBuffer = await renderHtmlToPdf(artifact.html);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `inline; filename="${versionedFilename(artifact.version)}"`);
  setVersionHeaders(res, artifact.version);
  res.send(pdfBuffer);
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
function reportStaffPdfUrl(req: Request, reportId: number): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}/api/patient-reports/${reportId}/pdf`;
}

/** Patient-openable PDF URL (public token). Falls back to staff URL only if mint fails. */
async function reportPatientPdfUrl(req: Request, reportId: number): Promise<string> {
  const token = await ensurePublicToken(reportId);
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  if (token) return `${proto}://${host}/api/p/r/${token}/pdf`;
  return reportStaffPdfUrl(req, reportId);
}

patientReportsRouter.post("/:id/share", async (req, res) => {
  const requestedId = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const channel = String(b.channel ?? "").toLowerCase();
  if (!["whatsapp", "email", "pdf", "print"].includes(channel)) {
    res.status(400).json({ error: "channel must be whatsapp|email|pdf|print" });
    return;
  }

  // D8 — sharing targets the LATEST deliverable version by default
  // (flag-gated; never resolves to a draft). The share log, delivery stamp,
  // WhatsApp link, and email HTML all reference the row actually shared.
  const shareVersion = await resolveReportVersion(requestedId, {
    mode: await effectiveResolveMode(undefined),
    // Signed reports (pending countersign) are deliverable via WhatsApp from
    // the reporting workspace — drafts still never resolve.
    deliverableStatuses: ["pending_verification", "verified", "delivered"],
  });
  if (!shareVersion) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  const id = shareVersion.resolvedReportId;

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
  if (row.r.status !== "verified" && row.r.status !== "delivered" && row.r.status !== "pending_verification") {
    res.status(409).json({ error: "Report must be signed before sharing" });
    return;
  }

  const recipient = (typeof b.recipient === "string" && b.recipient.trim()) ||
    (channel === "whatsapp" ? row.patientPhone : channel === "email" ? row.patientEmail : null);
  const sharedBy = typeof b.sharedBy === "string" ? b.sharedBy : null;
  const patientName = [row.patientFirstName, row.patientLastName].filter(Boolean).join(" ");

  let status: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;
  let reportUrl: string | null = null;

  if (channel === "whatsapp") {
    if (!recipient) {
      res.status(400).json({ error: "No phone number on file. Provide recipient." });
      return;
    }
    // Patient-openable public PDF (same path as auto-on-verify), not the staff auth PDF.
    reportUrl = await reportPatientPdfUrl(req, id);
    const result = await sendReportDelivery({
      phone: recipient,
      patientName,
      reportNumber: row.r.reportNumber,
      testName: row.testName ?? "Radiology Report",
      reportUrl,
    });
    // Not just !result.ok -- sendReportDelivery goes through wa_outbox, where
    // ok:true also covers shadow-mode-suppressed sends (result.skipped) that
    // never reached Meta at all. Treating that as "sent" would falsely mark
    // this report delivered and complete a BEND-1 re-delivery obligation for
    // a message that was never sent.
    if (!result.ok || result.skipped) { status = "failed"; errorMessage = result.skipped ? "WhatsApp sending is disabled/suppressed" : (result.error ?? "WhatsApp send failed"); }
  } else if (channel === "email") {
    if (!recipient) {
      res.status(400).json({ error: "No email on file. Provide recipient." });
      return;
    }
    // `id` is already the resolved version; "specific" renders exactly that
    // row (its banner still reflects its own chain position).
    const emailArtifact = await buildReportArtifact(id, { surface: "email", versionMode: "specific" });
    const result = await sendReportEmail({ to: recipient, subject: `Your Report: ${row.r.reportNumber}`, html: emailArtifact?.html ?? "", patientName, reportNumber: row.r.reportNumber });
    if (!result.ok) { status = "failed"; errorMessage = result.error ?? "Email send failed"; }
  }

  const [share] = await db.insert(reportSharesTable).values({ reportId: id, channel, recipient, sharedBy, status, errorMessage }).returning();
  if (status === "sent") await markDeliveredIfVerified(id);
  const session = (req as StaffAuthRequest).staffSession;
  await auditDeliveryResolution(`share_${channel}`, shareVersion, { userId: session?.subjectId, userName: session?.subjectName ?? sharedBy ?? "system", role: session?.role }, { recipient });
  // BEND-1 (D10) — a sent share of the chain's LATEST revision completes any
  // matching open re-delivery obligation; old-revision shares complete none.
  if (status === "sent") {
    await completeObligationsForDelivery({
      deliveredReportId: id,
      latestReportId: shareVersion.latestReportId,
      rootReportId: shareVersion.rootReportId,
      channel,
      recipient,
      actor: { userId: session?.subjectId, userName: session?.subjectName ?? sharedBy ?? "system", role: session?.role },
    }).catch((err) => req.log?.error({ err }, "BEND-1 obligation completion failed"));
  }

  res.json({ ok: status === "sent", share, error: errorMessage, reportUrl });
});

// Helper: list templates for a test (mirror of report-templates filter for convenience).
patientReportsRouter.get("/templates/:testId", async (req, res) => {
  const testId = Number(req.params.testId);
  const rows = await db.select().from(reportTemplatesTable).where(eq(reportTemplatesTable.testId, testId)).orderBy(desc(reportTemplatesTable.isDefault), reportTemplatesTable.name);
  res.json(rows);
});

// Helper: surface radiology-finalized reports as candidates so the hub can
// "promote" them into the patient_reports table without re-typing the body.
// ── PCPNDT Form F compliance status (read-only) ─────────────────────────────
// Lets the canonical Reporting Workspace show — BEFORE a finalize attempt —
// whether an obstetric study's patient has a complete, verified Form F
// record, instead of hard-blocking unconditionally. Same shared check as
// every finalize gate (lib/pcpndtCompliance.ts); returns field-presence
// status only, no Form F content. Mounted under /patient-reports so it
// carries the same /reports-family staff permission as the finalize itself.
patientReportsRouter.get("/pcpndt-compliance/:patientId", async (req, res) => {
  const patientId = Number(req.params.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    res.status(400).json({ error: "valid patientId required" });
    return;
  }
  const compliance = await checkPcpndtFormFCompliance(patientId);
  res.json(compliance);
});

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

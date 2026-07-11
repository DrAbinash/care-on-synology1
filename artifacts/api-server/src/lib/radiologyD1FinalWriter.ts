// ─────────────────────────────────────────────────────────────────────────────
// radiologyD1FinalWriter.ts — Ticket D5 (Final Report Persistence and
// Controlled Renderer Cutover). PURE preparation of a SIGNED canonical D1
// structured report at radiology finalize time, plus the sign-authority and
// legacy-equivalence policies the route enforces.
//
// This module does NO database access. The route (patient-reports.ts) re-reads
// the authoritative rows inside its transaction, reserves the audit-chain row
// id, and passes everything in; validator ports that need live rows
// (auditLogLookup) are injected, closing over the caller's transaction — the
// same honest-gap port pattern the D1 validator was built with.
//
// AUTHORSHIP INVARIANT: the D1 signature identity comes ONLY from the
// authenticated staff session (SignContext, built by the route from
// req.staffSession). Client-supplied author strings are never accepted here —
// there is deliberately no field for them.
//
// LEGACY-EQUIVALENCE POLICY (Phase 4, decision documented in the D5 report):
// the D4-rendered clinical sections are compared against the DRAFT's own
// persisted legacy fields (rawFindings / impression[] / recommendation — the
// server-side authoritative record of what the radiologist authored), after
// APPROVED formatting normalizations only (trim, blank-line removal,
// "N."/"N)" numbering strip, whitespace collapse). Any other difference is an
// UNAPPROVED clinical-text difference: the route then falls back to the legacy
// finalize (report signs exactly as today, structured content is NOT signed,
// the mismatch is recorded) — divergent structured and prose content are never
// silently signed together.
// ─────────────────────────────────────────────────────────────────────────────

import {
  buildDraftD1WriterInput,
  noFindingsCatalogPort,
  type DraftD1Source,
} from "./radiologyD1DraftWriter";
import type { MaterializationOutput } from "./radiologyFindingMaterializer";
import { writeStructuredReport } from "./structuredReport/writer";
import type { StructuredReportCatalogPort } from "./structuredReport/catalogAccess";
import { UnavailableAiRulesRegistryPort } from "./structuredReport/aiRulesRegistry";
import type { ValidationIssue, ValidationResult } from "./structuredReport/validator";
import type { StructuredReportDocument } from "./structuredReport/types";
import {
  renderStructuredReport,
  STRUCTURED_RENDERER_VERSION,
  type RenderResult,
} from "./structuredReport/renderer";
import { toLegacyReportShape, type LegacyReportShape } from "./structuredReport/rendererLegacyAdapter";

export { STRUCTURED_RENDERER_VERSION };

/** Mirrors requireStaffAuth's FULL_ACCESS_ROLES — declared locally (not
 *  imported) because that middleware module imports @workspace/db at load
 *  time, which would break this module's no-DB purity (and its tests). The
 *  set is tiny and stable; a drift test in the route suite would catch a
 *  divergence if the middleware set ever changed. */
const FULL_ACCESS_ROLES = new Set(["admin", "super_admin"]);

// ── Sign authority (Phase 5) ─────────────────────────────────────────────────

/** The authenticated session fields the route passes in — never client input. */
export interface SignerSession {
  subjectId: number;
  subjectName: string;
  role: string;
  permissions: string[];
}

export interface SignAuthority {
  allowed: boolean;
  reason: string | null;
}

/** Roles that may NEVER produce a structured signature, regardless of any
 *  permission grant. Typists transcribe; they do not sign. Automation/AI
 *  identities never hold a staff session, but are listed for defense in depth.
 *  Exported for D9's legacy-sign hardening (same deny list, same rationale). */
export const SIGN_DENY_ROLES = new Set(["typist", "ai", "system", "bot"]);

/**
 * Whether this authenticated session may produce a STRUCTURED SIGNATURE.
 * Stricter than requireStaffSubPermission's convention (where the bare module
 * permission implies every sub-action): signing requires the explicit
 * "/reports:sign" grant or a full-access role, and deny-listed roles are
 * refused even if granted. This gate only guards the structured signature —
 * the legacy finalize path is unchanged for everyone.
 */
export function canStructuredSign(session: SignerSession | null | undefined): SignAuthority {
  if (!session || !session.subjectName?.trim()) {
    return { allowed: false, reason: "no_authenticated_session" };
  }
  const role = (session.role ?? "").toLowerCase();
  if (SIGN_DENY_ROLES.has(role)) {
    return { allowed: false, reason: `role_cannot_sign:${role}` };
  }
  if (FULL_ACCESS_ROLES.has(role)) return { allowed: true, reason: null };
  if (session.permissions.includes("/reports:sign")) return { allowed: true, reason: null };
  return { allowed: false, reason: "missing_sign_permission:/reports:sign" };
}

/**
 * Ticket D9 — whether this session may COUNTERSIGN (verify) a structured-
 * signed report. Same deny list as signing; allowed for full-access roles,
 * an explicit "/reports:verify" grant, or a "/reports:sign" grant (a doctor
 * authorized to sign reports is authorized to countersign a colleague's —
 * signer/verifier DISTINCTNESS is enforced separately by the route against
 * the report being verified, never here). Pure; session comes from the
 * authenticated server session only.
 */
export function canStructuredVerify(session: SignerSession | null | undefined): SignAuthority {
  if (!session || !session.subjectName?.trim()) {
    return { allowed: false, reason: "no_authenticated_session" };
  }
  const role = (session.role ?? "").toLowerCase();
  if (SIGN_DENY_ROLES.has(role)) {
    return { allowed: false, reason: `role_cannot_verify:${role}` };
  }
  if (FULL_ACCESS_ROLES.has(role)) return { allowed: true, reason: null };
  if (session.permissions.includes("/reports:verify") || session.permissions.includes("/reports:sign")) {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: "missing_verify_permission:/reports:verify" };
}

// ── Legacy equivalence (Phase 4) ─────────────────────────────────────────────

/** The draft's own persisted legacy fields (server-side authoritative). */
export interface DraftLegacyFields {
  rawFindings: string | null;
  impression: string[] | null;
  recommendation: string | null;
  /** The impression the CLIENT submitted at finalize (newline-joined) — used
   *  only as a staleness cross-check against the draft's persisted impression. */
  clientImpressionText?: string | null;
}

export type EquivalenceVerdict = "equivalent" | "formatting_only" | "clinical_divergence";

export interface EquivalenceResult {
  verdict: EquivalenceVerdict;
  /** Per-section diagnostics: which sections diverged and how. */
  differences: Array<{ section: string; draft: string[]; d4: string[] }>;
  /** True when the client's submitted impression no longer matches the draft's
   *  persisted impression (stale draft — structured content may not reflect
   *  what the radiologist sees). Treated as clinical divergence. */
  staleDraft: boolean;
}

/** APPROVED formatting normalizations — the ONLY differences that do not count
 *  as clinical divergence: leading/trailing space, blank lines, "N."/"N)"
 *  numbering prefixes, and internal whitespace runs. */
export function normalizeClinicalLines(text: string | string[] | null | undefined): string[] {
  const lines = Array.isArray(text) ? text : (text ?? "").split("\n");
  return lines
    .map((l) => l.replace(/^\s*\d+[.)]\s+/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l !== "");
}

/**
 * Compare the D4 render against the draft's persisted legacy fields.
 * Line-sequence equality per section after approved normalizations only.
 */
export function compareAgainstDraft(render: RenderResult, draft: DraftLegacyFields): EquivalenceResult {
  const differences: EquivalenceResult["differences"] = [];

  const sections: Array<{ section: string; draftLines: string[]; d4Lines: string[] }> = [
    {
      section: "findings",
      draftLines: normalizeClinicalLines(draft.rawFindings),
      d4Lines: normalizeClinicalLines(render.findings.map((l) => l.text)),
    },
    {
      section: "impression",
      draftLines: normalizeClinicalLines(draft.impression ?? []),
      d4Lines: normalizeClinicalLines(render.impression.map((l) => l.text)),
    },
    {
      section: "recommendation",
      draftLines: normalizeClinicalLines(draft.recommendation),
      d4Lines: normalizeClinicalLines(render.recommendations.map((l) => l.text)),
    },
  ];

  for (const s of sections) {
    const equal = s.draftLines.length === s.d4Lines.length && s.draftLines.every((l, i) => l === s.d4Lines[i]);
    if (!equal) differences.push({ section: s.section, draft: s.draftLines, d4: s.d4Lines });
  }

  // Staleness cross-check: the client's submitted impression must match the
  // draft's persisted impression, else the draft (and everything derived from
  // it) may lag what the radiologist actually sees on screen.
  let staleDraft = false;
  if (draft.clientImpressionText != null) {
    const clientLines = normalizeClinicalLines(draft.clientImpressionText);
    const draftLines = normalizeClinicalLines(draft.impression ?? []);
    staleDraft = !(clientLines.length === draftLines.length && clientLines.every((l, i) => l === draftLines[i]));
  }

  if (staleDraft || differences.length > 0) {
    return { verdict: "clinical_divergence", differences, staleDraft };
  }
  // Equal after normalization. Whether the RAW strings differed only by the
  // approved formatting is not distinguished further — both are safe to sign.
  return { verdict: "equivalent", differences: [], staleDraft: false };
}

// ── Final document preparation (Phase 2) ─────────────────────────────────────

export interface SignContext {
  /** From req.staffSession ONLY. */
  signedBy: string;
  signedRole: string;
  signedById: number;
  /** Route-supplied timestamp (keeps this module clock-free/deterministic). */
  signedAtIso: string;
  /** Reserved audit_logs row id this signature will reference (R14b). */
  auditLogRef: number;
}

export interface FinalValidationPorts {
  catalogPort?: StructuredReportCatalogPort;
  /** R14b: resolves the (already inserted) finalize audit row — tx-bound. */
  auditLogLookup?: (documentId: string, signedContentSha256: string) => Promise<boolean>;
  amendsLookup?: (priorDocumentId: string) => Promise<{ state: string; alreadyAmendedBy: string | null } | null>;
}

export interface PrepareStructuredFinalInput {
  /** Same truthful source shape D3/D3.5 build from the draft + worklist rows. */
  source: DraftD1Source;
  /** D3.5 materialization of the draft's finding instances (may be empty). */
  materialized: MaterializationOutput;
  /** The draft's persisted legacy fields, for the equivalence policy. */
  draftLegacy: DraftLegacyFields;
  sign: SignContext;
  validationPorts?: FinalValidationPorts;
}

export type PrepareStructuredFinalResult =
  | {
      ok: true;
      document: StructuredReportDocument;
      contentSha256: string;
      renderedBody: string;
      render: RenderResult;
      legacyShape: LegacyReportShape;
      equivalence: EquivalenceResult;
      validation: ValidationResult;
      warnings: ValidationIssue[];
    }
  | {
      ok: false;
      stage: "adapter_skip" | "validation_failed" | "render_empty";
      skipReasons?: string[];
      validationErrors?: ValidationIssue[];
      equivalence?: EquivalenceResult;
    };

/** Final documents are revision 2: revision 1 is the draft-lifecycle document
 *  (D3 pins drafts at revision 1); the finalize save is the next monotonic
 *  save of the same document_id (D1 §8.1). */
export const D5_FINAL_REVISION = 2 as const;

/**
 * Build, sign-stamp, validate, and render the FINAL canonical D1 document.
 * Pure: no DB, no clock, no flag reads. Signature fields come exclusively from
 * `sign` (server session); the writer's finalize mode stamps
 * signed_content_sha256 = content_sha256 via the D2 hash — nothing here
 * reimplements hashing.
 */
export async function prepareStructuredFinalReport(
  input: PrepareStructuredFinalInput,
): Promise<PrepareStructuredFinalResult> {
  const { source, materialized, draftLegacy, sign } = input;

  if (!sign.signedBy?.trim()) {
    return { ok: false, stage: "adapter_skip", skipReasons: ["signature.signed_by unavailable (no authenticated session identity)"] };
  }

  // 1) Base writer input from the shared D3/D3.5 adapter (skips truthfully when
  //    required D1 fields are unavailable).
  const adapted = buildDraftD1WriterInput({ ...source, materialized });
  if (!adapted.ok) return { ok: false, stage: "adapter_skip", skipReasons: adapted.skipReasons };

  // 2) Override the audit block for FINALIZE: revision 2, milestone log, the
  //    reserved audit-chain ref, and the session-derived signature. The D2
  //    writer reconciles provenance.revision = audit.revision (R10b) and stamps
  //    signed_content_sha256 at finalize.
  const writerInput = {
    ...adapted.input,
    audit: {
      ...adapted.input.audit,
      last_modified_at: sign.signedAtIso,
      revision: D5_FINAL_REVISION,
      revisions: [
        { revision: 1, at: source.createdAtIso, by: source.createdBy ?? sign.signedBy, action: "created" },
        { revision: D5_FINAL_REVISION, at: sign.signedAtIso, by: sign.signedBy, action: "finalized" },
      ],
      audit_log_ref: sign.auditLogRef,
      signature: {
        state: "final" as const,
        signed_by: sign.signedBy,
        signed_role: sign.signedRole,
        signed_at: sign.signedAtIso,
        amends_document_id: null,
      },
    },
  };

  // 3) Write + validate in FINALIZE mode (R13/R14/R14b/R14c enforced).
  const hasFindings = materialized.findings.length > 0;
  const catalog = hasFindings
    ? (input.validationPorts?.catalogPort ?? noFindingsCatalogPort)
    : noFindingsCatalogPort;
  const result = await writeStructuredReport(writerInput, {
    mode: "finalize",
    validation: {
      catalog,
      aiRules: new UnavailableAiRulesRegistryPort(),
      auditLogLookup: input.validationPorts?.auditLogLookup,
      amendsLookup: input.validationPorts?.amendsLookup,
    },
  });

  if (!result.validation || !result.validation.ok) {
    return {
      ok: false,
      stage: "validation_failed",
      validationErrors: result.validation?.errors ?? [],
    };
  }

  // 4) Render the signed document through D4 (the ONLY body producer here).
  const render = renderStructuredReport(result.document);
  const legacyShape = toLegacyReportShape(render);
  if (!render.body.trim()) {
    // An empty rendered body can never be a signed report body.
    return { ok: false, stage: "render_empty" };
  }

  // 5) Legacy equivalence policy (Phase 4).
  const equivalence = compareAgainstDraft(render, draftLegacy);

  return {
    ok: true,
    document: result.document,
    contentSha256: result.contentSha256,
    renderedBody: render.body,
    render,
    legacyShape,
    equivalence,
    validation: result.validation,
    warnings: result.validation.warnings,
  };
}

// ── Row → source assembly (used by the route inside its transaction) ────────

/** Plain row shapes as re-read inside the finalize transaction. */
export interface FinalDraftRow {
  id: number;
  worklistId: number | null;
  patientId: number | null;
  templateId: string | null;
  modality: string | null;
  studyName: string | null;
  rawFindings: string | null;
  impression: string | null; // JSON array string (legacy draft storage)
  recommendation: string | null;
  createdBy: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface FinalWorklistRow {
  patientId: number | null;
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  studyDate: string | null;
  studyDescription: string | null;
  referringDoctor: string | null;
  assignedRadiologist: string | null;
}

export interface FinalFindingInstanceRow {
  findingId: number;
  structuredJson: unknown;
  source: string;
}

function toIsoOrEmpty(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.length > 0 && !Number.isNaN(new Date(v).getTime())) {
    return new Date(v).toISOString();
  }
  return "";
}

function dicomDateToIso(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v.trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;
  return toIsoOrEmpty(v);
}

/** Same truthful sourcing rules as the D3 route helper (buildD1DraftSource),
 *  reproduced here for the finalize path so the route files stay decoupled —
 *  every value is sourced truthfully or left null/"" so the adapter SKIPS
 *  rather than fabricate. */
export function buildFinalD1Source(
  draft: FinalDraftRow,
  worklist: FinalWorklistRow | null,
  instances: FinalFindingInstanceRow[],
): DraftD1Source {
  const patientRefValue =
    draft.patientId != null ? String(draft.patientId)
    : worklist?.patientId != null ? String(worklist.patientId)
    : "";
  return {
    draftId: draft.id,
    createdBy: draft.createdBy ?? null,
    createdAtIso: toIsoOrEmpty(draft.createdAt),
    updatedAtIso: toIsoOrEmpty(draft.updatedAt),
    modality: draft.modality ?? null,
    bodyRegion: worklist?.studyDescription ?? null,
    studyType: draft.studyName ?? null,
    templateId: draft.templateId ?? null,
    identifiers: worklist
      ? {
          studyInstanceUid: worklist.studyInstanceUID ?? "",
          accessionNumber: worklist.accessionNumber ?? "",
          patientRefValue,
          studyDatetimeIso: dicomDateToIso(worklist.studyDate),
          referringPhysician: worklist.referringDoctor ?? "",
          performingPhysician: worklist.assignedRadiologist ?? "",
        }
      : null,
    catalogSchemaVersion: "0",
    contentPackVersions: {},
    aiRulesVersions: {},
    findingSelections: instances.map((r) => ({
      findingId: r.findingId,
      params: r.structuredJson ?? {},
      source: r.source || "quickselect",
    })),
  };
}

/** Parse the draft's legacy impression column (JSON array string) safely. */
export function parseDraftImpression(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  }
}

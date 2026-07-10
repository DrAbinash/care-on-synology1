// ─────────────────────────────────────────────────────────────────────────────
// radiologyD1DraftWriter.ts — Radiology Roadmap Ticket D3 (Draft Structured
// JSON Persistence). PURE bridge from the current radiology draft model to a
// canonical D1 structured-report document (docs/STRUCTURED_REPORT_JSON_SPEC_v1.md),
// produced by the D2 writer (./structuredReport/writer.ts).
//
// This module has NO database and NO feature-flag dependency and reads no
// clock/random — it is a pure function of its input, so it is exhaustively
// unit-testable and its output is deterministic (same input → same document →
// same content_sha256). The route (radiology-report-generator.ts) supplies a
// truthful DraftD1Source built from the draft row (+ worklist row when linked)
// and does the flag gate + DB write.
//
// HONEST SCOPE (see the D3 compatibility report):
//   • The current capture (report_finding_instances + AbnormalityInstance
//     params = {side,severity,chronicity,level,value}) does NOT carry the
//     clinically-required D1 finding fields (presence, certainty, rendered
//     `sentence`, `impression_fragment`, `sentence_source`). Producing them is
//     either fabrication (forbidden) or a D4-renderer job (out of scope). So
//     this adapter emits `findings: []` and carries the truthful RAW selection
//     in the sanctioned `extensions` channel (D1 §11.1) — no fabricated
//     clinical field. Real D1 findings are a later ticket, after the capture
//     records presence/certainty and D4 renders sentences.
//   • `study_context` requires modality/body_region/study_type/template_ref +
//     a fully-populated `identifiers` block. When any required piece cannot be
//     TRUTHFULLY produced, the adapter returns a skip (with reasons) and the
//     route persists nothing — the legacy draft save is never affected.
// ─────────────────────────────────────────────────────────────────────────────

import {
  STRUCTURED_REPORT_KIND,
  STRUCTURED_REPORT_SCHEMA_VERSION,
  DOCUMENT_ID_PATTERN,
  type StructuredReportDocument,
} from "./structuredReport/types";
import {
  writeStructuredReport,
  type WriteStructuredReportInput,
} from "./structuredReport/writer";
import type { StructuredReportCatalogPort } from "./structuredReport/catalogAccess";
import { UnavailableAiRulesRegistryPort } from "./structuredReport/aiRulesRegistry";
import type { ValidationIssue } from "./structuredReport/validator";
import {
  materializeFindings,
  type MaterializationOutput,
  type FindingCatalogResolver,
  type FindingSelectionParams,
} from "./radiologyFindingMaterializer";

/** Authoring app identity stamped into provenance/audit — truthful constants,
 *  not placeholders (the version is this bridge's own version, not a fake
 *  catalog/render version). */
export const D3_AUTHORING_APP = "care-radiology-report-generator" as const;
export const D3_AUTHORING_APP_VERSION = "0.1.0-d3-draft-bridge" as const;
/** Drafts have no revision counter (only updatedAt). D1 requires a revision and
 *  requires provenance.revision === audit.revision; every draft document is
 *  pinned to the baseline revision 1. */
export const D3_DRAFT_REVISION = 1 as const;

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // excludes I,L,O,U — matches DOCUMENT_ID_PATTERN

/**
 * Deterministic, draft-scoped `document_id` derived from the draft's numeric id
 * — stable across every save of the same draft (D1 §1.3 wants a stable id) and
 * unique per draft, with no extra storage. It matches the ULID character
 * pattern (`^[0-9A-HJKMNP-TV-Z]{26}$`, validator R18) but is NOT a
 * time-ordered ULID: a real minted ULID is a finalize-time concern (a later
 * ticket), not needed for a draft cache document.
 */
export function deriveDraftDocumentId(draftId: number): string {
  if (!Number.isInteger(draftId) || draftId < 0) {
    throw new Error(`deriveDraftDocumentId: draftId must be a non-negative integer, got ${draftId}`);
  }
  let n = draftId;
  let base32 = n === 0 ? "0" : "";
  while (n > 0) {
    base32 = CROCKFORD_BASE32[n % 32] + base32;
    n = Math.floor(n / 32);
  }
  return base32.padStart(26, "0");
}

// ── Truthful source (assembled by the route from DB rows) ────────────────────

/** The 6 D1-required study identifiers (D1 §3.1). All must be truthfully
 *  present or the adapter skips — none are fabricated. */
export interface DraftD1Identifiers {
  studyInstanceUid: string;
  accessionNumber: string;
  patientRefValue: string; // care.patient_id value
  studyDatetimeIso: string; // ISO-8601
  referringPhysician: string;
  performingPhysician: string;
}

/** One selected structured finding, carried verbatim (no fabrication) into the
 *  document's extension channel. */
export interface DraftD1FindingSelection {
  findingId: number;
  params: unknown; // AbnormalityInstance shape, opaque/verbatim
  source: string; // quickselect | manual | voice | ai | ...
}

/** Everything the pure adapter needs. The route sources each field truthfully
 *  or leaves it null (→ the adapter skips). */
export interface DraftD1Source {
  draftId: number;
  createdBy: string | null;
  createdAtIso: string;
  updatedAtIso: string;
  modality: string | null;
  bodyRegion: string | null;
  studyType: string | null;
  templateId: string | null;
  identifiers: DraftD1Identifiers | null;
  catalogSchemaVersion: string;
  contentPackVersions: Record<string, string>;
  aiRulesVersions: Record<string, string>;
  findingSelections: DraftD1FindingSelection[];
  /** Ticket D3.5 — when present, real D1 findings[]/measurements[]/
   *  recommendations[] (from the FindingMaterializer) are emitted, and only the
   *  UN-materialized (skipped) selections are preserved in extensions. When
   *  absent (catalog off/unavailable), D3's behavior stands: findings:[] and the
   *  full raw selection carried in extensions. */
  materialized?: MaterializationOutput;
}

export type BuildWriterInputResult =
  | { ok: true; input: WriteStructuredReportInput }
  | { ok: false; skipReasons: string[] };

function isNonEmpty(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isIsoDateTime(v: string | null | undefined): v is string {
  return typeof v === "string" && v.length > 0 && !Number.isNaN(new Date(v).getTime());
}

/**
 * Pure adapter: current draft data → D2 WriterInput, or a skip with reasons.
 * Emits `findings: []` (see HONEST SCOPE) and carries the raw selection in
 * `extensions.x_care_draft`. Never fabricates a required D1 field: if one
 * cannot be truthfully produced it is reported as a skip reason.
 */
export function buildDraftD1WriterInput(src: DraftD1Source): BuildWriterInputResult {
  const skipReasons: string[] = [];

  if (!isNonEmpty(src.createdBy)) skipReasons.push("provenance.created_by unavailable (draft has no createdBy)");
  if (!isIsoDateTime(src.createdAtIso)) skipReasons.push("audit.created_at is not a valid ISO-8601 datetime");
  if (!isIsoDateTime(src.updatedAtIso)) skipReasons.push("audit.last_modified_at is not a valid ISO-8601 datetime");
  if (!isNonEmpty(src.modality)) skipReasons.push("study_context.modality unavailable");
  if (!isNonEmpty(src.bodyRegion)) skipReasons.push("study_context.body_region unavailable (no truthful source on the draft)");
  if (!isNonEmpty(src.studyType)) skipReasons.push("study_context.study_type unavailable");
  if (!isNonEmpty(src.templateId)) skipReasons.push("study_context.template_ref unavailable (draft has no templateId)");
  if (!isNonEmpty(src.catalogSchemaVersion)) skipReasons.push("catalog_snapshot.catalog_schema_version unavailable");

  const idf = src.identifiers;
  if (!idf) {
    skipReasons.push("study_context.identifiers unavailable (manual draft or no linked study/worklist)");
  } else {
    if (!isNonEmpty(idf.studyInstanceUid)) skipReasons.push("identifiers.study_instance_uid unavailable");
    if (!isNonEmpty(idf.accessionNumber)) skipReasons.push("identifiers.accession_number unavailable");
    if (!isNonEmpty(idf.patientRefValue)) skipReasons.push("identifiers.patient_ref unavailable");
    if (!isIsoDateTime(idf.studyDatetimeIso)) skipReasons.push("identifiers.study_datetime is not a valid ISO-8601 datetime");
    if (!isNonEmpty(idf.referringPhysician)) skipReasons.push("identifiers.referring_physician_ref unavailable");
    if (!isNonEmpty(idf.performingPhysician)) skipReasons.push("identifiers.performing_physician_ref unavailable");
  }

  if (skipReasons.length > 0 || !idf) {
    return { ok: false, skipReasons };
  }

  const templateRef = `tpl.${src.templateId}`;
  // Deduplicated, sorted for determinism.
  const inputMethods = Array.from(new Set(src.findingSelections.map((f) => f.source))).sort();

  // Ticket D3.5 — real D1 findings from the materializer when available; else
  // D3's empty findings[] + full raw selection carried in extensions.
  const mat = src.materialized;
  const findings = mat ? mat.findings : [];
  const measurements = mat ? mat.measurements : [];
  const recommendations = mat ? mat.recommendations : [];
  const draftExtension: Record<string, unknown> = mat
    ? {
        source: "radiology_report_drafts",
        draft_id: src.draftId,
        materialized_count: mat.findings.length,
        // Only the selections that could NOT be truthfully materialized are
        // preserved here for audit (D3.5); materialized ones now live in findings[].
        skipped_findings: mat.skipped,
      }
    : {
        source: "radiology_report_drafts",
        draft_id: src.draftId,
        quick_select_findings: src.findingSelections.map((f) => ({
          finding_id: f.findingId,
          params: f.params,
          source: f.source,
        })),
      };

  const input: WriteStructuredReportInput = {
    document_id: deriveDraftDocumentId(src.draftId),
    schema_version: STRUCTURED_REPORT_SCHEMA_VERSION,
    catalog_snapshot: {
      content_pack_versions: src.contentPackVersions,
      catalog_schema_version: src.catalogSchemaVersion,
      ai_rules_version: src.aiRulesVersions,
    },
    study_context: {
      modality: src.modality!,
      body_region: src.bodyRegion!,
      study_type: src.studyType!,
      template_ref: templateRef,
      laterality_default: null,
      comparison: { has_prior: false, prior_study_ref: null, interval_note: null },
      identifiers: {
        study_instance_uid: idf.studyInstanceUid,
        accession_number: idf.accessionNumber,
        patient_ref: { system: "care.patient_id", value: idf.patientRefValue },
        study_datetime: idf.studyDatetimeIso,
        referring_physician_ref: { system: "care.staff", value: idf.referringPhysician },
        performing_physician_ref: { system: "care.staff", value: idf.performingPhysician },
      },
    },
    // D3.5: real D1 findings from the catalog materializer when available;
    // otherwise D3's truthful empty set (see HONEST SCOPE).
    findings,
    measurements,
    recommendations,
    critical_flags: [],
    provenance: {
      created_by: src.createdBy!,
      created_at: src.createdAtIso,
      authoring_app: D3_AUTHORING_APP,
      authoring_app_version: D3_AUTHORING_APP_VERSION,
      input_methods: inputMethods,
      content_pack_versions: src.contentPackVersions,
      template_ref: templateRef,
      revision: D3_DRAFT_REVISION,
    },
    ai: { runs: [], guarding: { auto_sign: false } },
    audit: {
      schema_version: STRUCTURED_REPORT_SCHEMA_VERSION,
      created_at: src.createdAtIso,
      last_modified_at: src.updatedAtIso,
      revision: D3_DRAFT_REVISION,
      revisions: [{ revision: D3_DRAFT_REVISION, at: src.createdAtIso, by: src.createdBy!, action: "created" }],
      audit_log_ref: null,
      signature: {
        state: "draft",
        signed_by: null,
        signed_role: null,
        signed_at: null,
        amends_document_id: null,
      },
    },
    // Sanctioned open channel (D1 §11.1). Without materialization this carries
    // the full raw selection (D3); with materialization it carries only the
    // skipped selections for audit (D3.5) — materialized findings live in
    // findings[] above.
    extensions: { x_care_draft: draftExtension },
  };

  return { ok: true, input };
}

// ── Build + validate (pure; no DB, no flag) ──────────────────────────────────

/**
 * No-op catalog port. SAFE because every D3 draft document carries
 * `findings: []` / `measurements: []` / `recommendations: []` — the validator's
 * catalog-backed rules (R1/R4/R5/R6/R8) iterate those arrays and therefore
 * never call any method here. If a future D3 revision emits real findings, it
 * must swap this for the real DrizzleStructuredReportCatalogPort.
 */
export const noFindingsCatalogPort: StructuredReportCatalogPort = {
  async resolveFinding() { return null; },
  async resolveParameterGroup() { return null; },
  async resolveParameterOption() { return null; },
  async resolveFindingParameterBinding() { return null; },
  async listRequiredParameterBindings() { return []; },
  async resolveFindingSeverity() { return null; },
  async resolveFindingLocation() { return null; },
  async resolveFindingMeasurement() { return null; },
};

export type BuildDraftD1Result =
  | { ok: true; document: StructuredReportDocument; contentSha256: string; warnings: ValidationIssue[] }
  | { ok: false; skipReasons: string[]; validationErrors?: ValidationIssue[] };

export interface BuildDraftD1Options {
  /** Catalog port used to validate finding/param/measurement refs (R1/R4/R5).
   *  REQUIRED when materialized findings are produced (D3.5); ignored otherwise.
   *  Defaults to the no-op port, which is only safe for findings:[] documents. */
  catalogPort?: StructuredReportCatalogPort;
  /** Ticket D3.5 — when provided, the source's findingSelections are
   *  materialized into real D1 findings via this resolver (and validated with
   *  `catalogPort`). When omitted, any pre-set `src.materialized` is used, else
   *  D3's findings:[] behavior stands. */
  resolver?: FindingCatalogResolver;
}

/**
 * Build the canonical D1 document via the D2 writer and validate it with the
 * D1 validator in DRAFT mode. Pure (no DB, no flag, no clock). Returns a skip
 * (never throws for adapter/validation issues) so the caller can log-and-skip
 * without endangering the legacy draft save.
 *
 * When the source carries D3.5 materialized findings, pass `opts.catalogPort`
 * (a real catalog port) so R1/R4/R5 can resolve the emitted refs; the default
 * no-op port only suffices for D3's findings:[] documents.
 */
export async function buildAndValidateDraftD1Document(
  src: DraftD1Source,
  opts: BuildDraftD1Options = {},
): Promise<BuildDraftD1Result> {
  // D3.5 — materialize the selections through the catalog when a resolver is
  // supplied. Runs BEFORE assembly so the materialized findings/measurements/
  // recommendations flow into the document (and skipped ones into extensions).
  let effectiveSrc = src;
  if (opts.resolver) {
    const materialized = await materializeFindings(
      src.findingSelections.map((s) => ({ findingId: s.findingId, params: s.params as FindingSelectionParams, source: s.source })),
      opts.resolver,
      { actor: src.createdBy ?? "unknown", createdAtIso: src.createdAtIso },
    );
    effectiveSrc = { ...src, materialized };
  }

  const adapted = buildDraftD1WriterInput(effectiveSrc);
  if (!adapted.ok) return { ok: false, skipReasons: adapted.skipReasons };

  const hasFindings = (effectiveSrc.materialized?.findings.length ?? 0) > 0;
  const catalog = hasFindings ? (opts.catalogPort ?? noFindingsCatalogPort) : noFindingsCatalogPort;

  const result = await writeStructuredReport(adapted.input, {
    mode: "draft",
    // WriterValidationContext = Omit<ValidationContext, "mode">; the writer
    // supplies mode ("draft") from the options above.
    validation: { catalog, aiRules: new UnavailableAiRulesRegistryPort() },
  });

  if (!result.validation || !result.validation.ok) {
    return {
      ok: false,
      skipReasons: ["d1_validation_failed"],
      validationErrors: result.validation?.errors ?? [],
    };
  }

  // Sanity: content_sha256 must come only from the D2 writer (never recomputed
  // or reimplemented here). Assert the document is internally consistent.
  return {
    ok: true,
    document: result.document,
    contentSha256: result.contentSha256,
    warnings: result.validation.warnings,
  };
}

/** Exposed for the R18/pattern sanity assertion in tests. */
export const DRAFT_DOCUMENT_ID_PATTERN = DOCUMENT_ID_PATTERN;
export { STRUCTURED_REPORT_KIND };

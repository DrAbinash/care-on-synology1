// ─────────────────────────────────────────────────────────────────────────────
// Structured Report Writer / serializer — Ticket D2, D1 §19 item 3
// (docs/STRUCTURED_REPORT_JSON_SPEC_v1.md, frozen spec revision 2 — NOT
// redesigned here; this is the writer the spec named "the next phase must
// build").
//
// What it does, and ONLY what it does:
//   • Assemble a canonical StructuredReportDocument from its constituent parts
//     (findings, measurements, impression, recommendations, critical flags,
//     AI provenance, catalog snapshot, study context, document provenance,
//     audit metadata) in the D1 §1.1 top-level field order.
//   • Reconcile the two revision counters so provenance.revision === audit.revision
//     on every save (D1 §8.1 / validator R10b) — audit.revision is authoritative.
//   • Compute content_sha256 via RFC 8785 JCS + SHA-256 (hash.ts, D1 §10) and
//     stamp it; at finalize, stamp signature.signed_content_sha256 = content_sha256.
//   • Emit a byte-stable canonical JSON serialization (JCS of the whole document).
//   • Optionally run the frozen validator (validator.ts) in the given mode and
//     return its result, so a single call round-trips Input → Writer → Validator.
//
// What it deliberately does NOT do (spec + ticket constraints): no DB write, no
// migration, no HTTP endpoint, no new specification, no rendering-string
// generation (the rendered `sentence`/`impression_fragment`/`rendered` strings
// are pinned at author time per D1 §3.4/§7 and are supplied to the writer, not
// synthesized by it — synthesizing prose is the renderer's job, D1 §19 item 6).
//
// PURITY / DETERMINISM: the writer never reads a clock or a random source.
// document_id and every timestamp are supplied by the caller. The same input
// therefore always produces byte-identical output and an identical digest —
// which is exactly what the golden byte-for-byte fixtures rely on.
//
// Parameters note (D1 §3.2/§5): parameters are FINDING-SCOPED and live inside
// each finding's `parameters[]` array — the frozen D1 schema has no top-level
// parameters array (`additionalProperties:false` at the root would reject one).
// The writer therefore accepts parameters as part of `findings`, not as a
// separate top-level input, honoring the frozen schema rather than inventing a
// shape it forbids.
// ─────────────────────────────────────────────────────────────────────────────

import {
  STRUCTURED_REPORT_KIND,
  STRUCTURED_REPORT_SCHEMA_VERSION,
  type AuditBlock,
  type AuditRevisionEntry,
  type AuditSignature,
  type CatalogSnapshotPin,
  type CriticalFlag,
  type DocumentAiBlock,
  type DocumentProvenance,
  type Finding,
  type HashAlgorithm,
  type Impression,
  type Measurement,
  type Recommendation,
  type Section,
  type SignatureState,
  type StructuredReportDocument,
  type StudyContext,
} from "./types";
import { jcsCanonicalize } from "./canonicalizer";
import { CONTENT_HASH_ALGORITHM, computeContentSha256 } from "./hash";
import {
  validateStructuredReport,
  type ValidationMode,
  type ValidationResult,
  type ValidationContext,
} from "./validator";

// ── Input shapes ──────────────────────────────────────────────────────────────

/** The signature fields a caller supplies; `signed_content_sha256` is NOT
 *  accepted here — the writer computes it (== content_sha256) at finalize. */
export interface WriterSignatureInput {
  state: SignatureState;
  signed_by: string | null;
  signed_role: string | null;
  signed_at: string | null;
  amends_document_id: string | null;
}

/** The audit fields a caller supplies; `content_sha256` and the signature's
 *  `signed_content_sha256` are NOT accepted here — the writer computes them
 *  (D1 §10). `hash_algorithm`/`schema_version` default when omitted. */
export interface WriterAuditInput {
  schema_version?: string;
  hash_algorithm?: HashAlgorithm;
  created_at: string;
  last_modified_at: string;
  revision: number;
  revisions: AuditRevisionEntry[];
  audit_log_ref: number | null;
  signature: WriterSignatureInput;
}

/** Everything the writer needs to assemble one canonical document. Optional
 *  arrays default to empty; `sections`/`impression`/`extensions` are omitted
 *  from the output when not supplied (they are optional in the frozen schema). */
export interface WriteStructuredReportInput {
  document_id: string;
  /** Defaults to STRUCTURED_REPORT_SCHEMA_VERSION ("1.0.0"). */
  schema_version?: string;
  catalog_snapshot: CatalogSnapshotPin;
  study_context: StudyContext;
  /** Findings, each carrying its own finding-scoped `parameters[]` (see header). */
  findings: Finding[];
  measurements?: Measurement[];
  impression?: Impression;
  recommendations?: Recommendation[];
  critical_flags?: CriticalFlag[];
  sections?: Section[];
  /** Document-level provenance; its `revision` is overwritten to equal
   *  `audit.revision` (R10b) — pass either value, they are reconciled. */
  provenance: DocumentProvenance;
  /** AI run registry (D1 §9.1) — REQUIRED even when empty
   *  (`{ runs: [], guarding: { auto_sign: false } }`). */
  ai: DocumentAiBlock;
  audit: WriterAuditInput;
  extensions?: Record<string, unknown>;
}

// ── Output shapes ───────────────────────────────────────────────────────────────

export interface BuiltStructuredReport {
  /** The fully assembled, hash-stamped document (canonical field order). */
  document: StructuredReportDocument;
  /** RFC 8785 JCS serialization of `document` — byte-stable for a given input. */
  canonicalJson: string;
  /** The stamped digest, `"sha256:<hex>"` (also at `document.audit.content_sha256`). */
  contentSha256: string;
}

export interface WriteStructuredReportResult extends BuiltStructuredReport {
  /** Validator result in the requested mode; `null` when no validation context
   *  was supplied to {@link writeStructuredReport}. */
  validation: ValidationResult | null;
}

/** Validation dependencies threaded to the frozen validator (validator.ts). The
 *  `mode` is taken from {@link WriteOptions}, not repeated here. */
export type WriterValidationContext = Omit<ValidationContext, "mode">;

export interface WriteOptions {
  /** "draft" stamps content_sha256 only; "finalize" also stamps
   *  signature.signed_content_sha256 = content_sha256 and validates the
   *  finalize-only rules (R13 signed_by, R14/R14b/R14c). */
  mode: ValidationMode;
  /** When present, the built document is validated in `mode` and the result is
   *  returned; when absent, only assembly + hashing runs (validation === null). */
  validation?: WriterValidationContext;
}

// ── Assembly (pure, synchronous) ────────────────────────────────────────────────

/**
 * Assemble + hash a canonical document from its parts. Pure and synchronous; no
 * validation, no IO. Prefer {@link writeStructuredReport} when you also want the
 * document validated in one call.
 */
export function buildStructuredReportDocument(
  input: WriteStructuredReportInput,
  mode: ValidationMode,
): BuiltStructuredReport {
  const schema_version = input.schema_version ?? STRUCTURED_REPORT_SCHEMA_VERSION;
  const revision = input.audit.revision;

  // R10b: keep provenance.revision === audit.revision on every save. audit is
  // authoritative; the caller's provenance.revision (if different) is corrected
  // here rather than left to fail validation.
  const provenance: DocumentProvenance = { ...input.provenance, revision };

  const signature: AuditSignature = {
    state: input.audit.signature.state,
    signed_by: input.audit.signature.signed_by,
    signed_role: input.audit.signature.signed_role,
    signed_at: input.audit.signature.signed_at,
    signed_content_sha256: null, // computed below at finalize; excluded from the hash regardless (D1 §10)
    amends_document_id: input.audit.signature.amends_document_id,
  };

  const audit: AuditBlock = {
    schema_version: input.audit.schema_version ?? schema_version,
    hash_algorithm: input.audit.hash_algorithm ?? CONTENT_HASH_ALGORITHM,
    created_at: input.audit.created_at,
    last_modified_at: input.audit.last_modified_at,
    revision,
    revisions: input.audit.revisions,
    content_sha256: "", // placeholder; excluded from the preimage, stamped below
    audit_log_ref: input.audit.audit_log_ref,
    signature,
  };

  // Assemble in the D1 §1.1 top-level field order. Optional members are inserted
  // (via conditional spread) at their canonical position only when supplied.
  const document: StructuredReportDocument = {
    schema_version,
    kind: STRUCTURED_REPORT_KIND,
    document_id: input.document_id,
    catalog_snapshot: input.catalog_snapshot,
    study_context: input.study_context,
    // `!= null` (not `!== undefined`) so a caller/decompose path that models an
    // absent optional as `null` omits it entirely rather than emitting an
    // explicit `null`, which would violate the frozen tier-A schema (these
    // members are typed array/object, non-nullable) — matches the module's
    // existing `!= null` convention.
    ...(input.sections != null ? { sections: input.sections } : {}),
    findings: input.findings,
    measurements: input.measurements ?? [],
    ...(input.impression != null ? { impression: input.impression } : {}),
    recommendations: input.recommendations ?? [],
    critical_flags: input.critical_flags ?? [],
    provenance,
    ai: input.ai,
    audit,
    ...(input.extensions != null ? { extensions: input.extensions } : {}),
  };

  // Compute the digest over the document with the two D1 §10 members excluded,
  // then stamp. Because both stamped fields are outside the preimage, stamping
  // does not change the digest — the digest is a fixed point (see hash.ts).
  const contentSha256 = computeContentSha256(document);
  document.audit.content_sha256 = contentSha256;
  if (mode === "finalize") {
    // signed_content_sha256 is frozen at signing and equals content_sha256 at
    // that instant (D1 §10, validator R14). Also outside the preimage.
    document.audit.signature.signed_content_sha256 = contentSha256;
  }

  const canonicalJson = jcsCanonicalize(document);
  return { document, canonicalJson, contentSha256 };
}

// ── Write (assemble + hash + optionally validate) ───────────────────────────────

/**
 * Assemble, hash, and (when a validation context is supplied) validate a
 * structured-report document in one call — the Input → Writer → Validator
 * round-trip of D1 §19 item 3.
 *
 * The returned `document` is always fully hash-stamped even if validation fails,
 * so a caller can inspect both the document and the errors; enforcement (refuse
 * to persist on `validation.ok === false`) is the caller's decision, keeping
 * this function pure and testable.
 */
export async function writeStructuredReport(
  input: WriteStructuredReportInput,
  options: WriteOptions,
): Promise<WriteStructuredReportResult> {
  const built = buildStructuredReportDocument(input, options.mode);
  let validation: ValidationResult | null = null;
  if (options.validation) {
    validation = await validateStructuredReport(built.document, { ...options.validation, mode: options.mode });
  }
  return { ...built, validation };
}

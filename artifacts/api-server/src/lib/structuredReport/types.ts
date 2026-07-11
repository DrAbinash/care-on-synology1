// ─────────────────────────────────────────────────────────────────────────────
// Canonical Structured Report JSON (Ticket D1, frozen spec revision 2 —
// docs/STRUCTURED_REPORT_JSON_SPEC_v1.md) — TypeScript document shape.
//
// This module is a direct transcription of D1 §1–§11 and §18. It does not
// invent fields, enums, or defaults beyond what the spec states. Where the
// spec marks a field optional/nullable, the type reflects that exactly.
//
// FOUNDATION ONLY: nothing in the running product reads or writes this shape
// yet. It is the type surface the validator (./validator.ts) checks against
// and the future writer/renderer (D1 §19 items 3–6, not built by this
// ticket) will produce/consume.
// ─────────────────────────────────────────────────────────────────────────────

export const STRUCTURED_REPORT_SCHEMA_VERSION = "1.0.0" as const;
export const STRUCTURED_REPORT_KIND = "radiology.structured_report" as const;

// ── §18 canonical enumerations ────────────────────────────────────────────────

export const PRESENCE_VALUES = ["present", "absent", "normal", "indeterminate"] as const;
export type Presence = (typeof PRESENCE_VALUES)[number];

export const CERTAINTY_VALUES = ["definite", "probable", "possible", "cannot_exclude"] as const;
export type Certainty = (typeof CERTAINTY_VALUES)[number];

export const SENTENCE_SOURCE_VALUES = ["content_pack_default", "rule", "edited", "manual"] as const;
export type SentenceSource = (typeof SENTENCE_SOURCE_VALUES)[number];

export const INTERVAL_CHANGE_VALUES = ["new", "stable", "increased", "decreased", "resolved"] as const;
export type IntervalChange = (typeof INTERVAL_CHANGE_VALUES)[number];

export const INCLUDED_FROM_KIND_VALUES = ["included_findings_ref", "combo"] as const;
export type IncludedFromKind = (typeof INCLUDED_FROM_KIND_VALUES)[number];

export const VALUE_KIND_VALUES = ["scalar", "ratio", "range", "derived", "index", "date"] as const;
export type ValueKind = (typeof VALUE_KIND_VALUES)[number];

export const MEASUREMENT_SOURCE_VALUES = ["manual", "dicom_sr", "ocr", "ai", "calculated"] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCE_VALUES)[number];

// Universal provenance.origin — OPEN (R10w warns on unrecognized, never rejects, §2.5).
// This documented list is what R10w checks membership against.
export const PROVENANCE_ORIGIN_VALUES = [
  "manual", "quick_select", "content_pack_default", "template", "voice",
  "ai_suggestion", "measurement_import", "calculated", "ocr", "schema_migration", "backfill",
] as const;
export type ProvenanceOrigin = (typeof PROVENANCE_ORIGIN_VALUES)[number];

export const IMPRESSION_FRAGMENT_SOURCE_VALUES = ["finding_fragment", "rule", "manual", "ai_suggestion"] as const;
export type ImpressionFragmentSource = (typeof IMPRESSION_FRAGMENT_SOURCE_VALUES)[number];

export const SECTION_KIND_VALUES = [
  "clinical_history", "technique", "comparison", "findings", "impression", "recommendation", "advice",
] as const;
export type SectionKind = (typeof SECTION_KIND_VALUES)[number];

export const RECOMMENDATION_PRIORITY_VALUES = ["routine", "urgent", "critical"] as const;
export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITY_VALUES)[number];

export const CRITICAL_FLAG_STATUS_VALUES = ["raised", "acknowledged", "communicated"] as const;
export type CriticalFlagStatus = (typeof CRITICAL_FLAG_STATUS_VALUES)[number];

export const SIGNATURE_STATE_VALUES = ["draft", "preliminary", "final", "addendum", "amended"] as const;
export type SignatureState = (typeof SIGNATURE_STATE_VALUES)[number];

export const HASH_ALGORITHM_VALUES = ["jcs-sha256/1"] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHM_VALUES)[number];

// `lat.*` — a fixed closed vocabulary owned by this spec (§1.4, §18), not a catalog table.
export const LATERALITY_VALUES = ["left", "right", "bilateral", "midline", "na", "none"] as const;
export type LateralityValue = (typeof LATERALITY_VALUES)[number];
/** A `lat.<value>` reference string, e.g. "lat.right". */
export type LateralityRef = `lat.${LateralityValue}`;

export const AI_RUN_HUMAN_REVIEW_VALUES = ["accepted_verbatim", "accepted_edited", "rejected", "pending"] as const;
export type AiRunHumanReview = (typeof AI_RUN_HUMAN_REVIEW_VALUES)[number];

export const AI_RUN_PURPOSE_VALUES = [
  "finding_suggestion", "impression_suggestion", "measurement_extraction", "qc", "completeness", "contradiction",
] as const;
export type AiRunPurpose = (typeof AI_RUN_PURPOSE_VALUES)[number];

export const PARAMETER_KIND_VALUES = ["option", "numeric", "boolean", "text"] as const;
export type ParameterKind = (typeof PARAMETER_KIND_VALUES)[number];

// ── §1.4 reference namespaces ─────────────────────────────────────────────────

/** A "<namespace>.<key>" reference, split on the FIRST dot only (§1.4) — key is opaque. */
export type Ref = string;

export function splitRef(ref: string): { namespace: string; key: string } | null {
  const i = ref.indexOf(".");
  if (i < 0) return null;
  return { namespace: ref.slice(0, i), key: ref.slice(i + 1) };
}

// ── §3.1 study_context ────────────────────────────────────────────────────────

export interface SystemValueRef {
  system: string;
  value: string;
}

export interface StudyComparison {
  has_prior: boolean;
  prior_study_ref: string | null;
  interval_note: string | null;
}

export interface StudyIdentifiers {
  study_instance_uid: string;
  accession_number: string;
  patient_ref: SystemValueRef;
  study_datetime: string; // ISO-8601
  referring_physician_ref: SystemValueRef;
  performing_physician_ref: SystemValueRef;
}

export interface StudyContext {
  modality: string;
  body_region: string;
  study_type: string;
  template_ref: Ref; // tpl.*
  laterality_default: LateralityRef | null;
  comparison: StudyComparison;
  identifiers: StudyIdentifiers;
}

// ── §8 provenance ─────────────────────────────────────────────────────────────

/** Instance-level provenance (§8.2) — attached to every finding/measurement/
 *  impression-fragment/recommendation/critical-flag. */
export interface InstanceProvenance {
  origin: string; // ProvenanceOrigin documented values; open set, R10w warns only (§2.5)
  actor: string;
  source_ref?: string;
  created_at: string; // ISO-8601
  edited: boolean;
  edited_by?: string | null;
  edited_at?: string | null;
}

/** Document-level provenance (§8.1). */
export interface DocumentProvenance {
  created_by: string;
  created_at: string;
  authoring_app: string;
  authoring_app_version: string;
  input_methods: string[];
  content_pack_versions: Record<string, string>;
  template_ref: Ref;
  revision: number; // MUST equal audit.revision, R10b
}

// ── §9 AI metadata ─────────────────────────────────────────────────────────────

export interface AiRun {
  run_id: string;
  purpose: AiRunPurpose;
  provider: string;
  model_ref: string; // never an unpinned alias ("latest"/"prod") — R12
  model_digest?: string;
  prompt_ref: Ref; // aiprompt.*
  prompt_version: number;
  prompt_digest: string; // required on every run — R12
  params?: Record<string, unknown>;
  input_digest: string;
  input_refs?: Record<string, unknown>;
  output_lids: string[]; // anti-laundering link — R11b
  started_at: string;
  latency_ms?: number;
  output_digest?: string;
  human_review: AiRunHumanReview;
}

export interface AiGuarding {
  auto_sign: false; // R13: must always be false at finalize
}

/** Document-level `ai` block — REQUIRED even when empty (§9.1). */
export interface DocumentAiBlock {
  runs: AiRun[];
  guarding: AiGuarding;
}

/** Instance-level `ai` block (§9.2) — required whenever the atom's
 *  provenance.origin === "ai_suggestion" (R11). */
export interface InstanceAiBlock {
  suggested: true;
  run_id: string;
  accepted_verbatim: boolean;
  confidence: number; // 0..1
  model_ref: string; // MUST equal the referenced run's model_ref — R11c
  prompt_ref: Ref; // MUST equal the referenced run's prompt_ref — R11c
  prompt_version: number; // MUST equal the referenced run's prompt_version — R11c
}

// ── §5 parameters ──────────────────────────────────────────────────────────────

interface ParameterBase {
  param: Ref; // param.<group key> — GLOBAL (§1.4)
  kind: ParameterKind;
  label: string;
}
export interface OptionParameter extends ParameterBase {
  kind: "option";
  option: string; // parameter_options.key, verbatim/opaque, scoped by sibling `param` (§1.4/§5)
}
export interface NumericParameter extends ParameterBase {
  kind: "numeric";
  value: number;
  unit?: string;
}
export interface BooleanParameter extends ParameterBase {
  kind: "boolean";
  value: boolean;
}
export interface TextParameter extends ParameterBase {
  kind: "text";
  value: string;
}
export type ParameterEntry = OptionParameter | NumericParameter | BooleanParameter | TextParameter;

// ── §3.6 critical flags ────────────────────────────────────────────────────────

export interface CriticalFlag {
  lid: string;
  critical_ref: Ref; // crit.* — content-pack registry (§1.4), not a live B1/B2 table
  finding_ref: string; // findings[].lid
  status: CriticalFlagStatus;
  raised_at: string;
  raised_by: string;
  provenance: InstanceProvenance;
}

// ── §3.5 composition ───────────────────────────────────────────────────────────

export interface IncludedFrom {
  kind: IncludedFromKind;
  ref: Ref; // names the PARENT finding.* (included_findings_ref) or the combo.* tile
  tile_lid?: string; // present when kind === "combo"
}

// ── §3.2 finding ────────────────────────────────────────────────────────────────

export interface StatusFlags {
  is_significant: boolean;
  is_critical: boolean;
  is_incidental: boolean;
}

export interface Finding {
  lid: string;
  definition_ref: Ref; // finding.* — GLOBAL, must resolve to finding_definitions.key (R1)
  presence: Presence;
  certainty: Certainty;
  laterality: LateralityRef | null;
  locations: Ref[]; // loc.* — finding-scoped, bare keys (§1.4)
  severity: Ref | null; // sev.* — finding-scoped
  interval_change: IntervalChange | null;
  parameters: ParameterEntry[];
  measurement_refs: string[]; // lids of measurements OWNED by this finding (R2b: exact match)
  sentence: string; // always present and rendered (§2.2/§3.4)
  impression_fragment: string; // always present and rendered
  sentence_source: SentenceSource;
  status_flags: StatusFlags;
  included_from: IncludedFrom | null;
  provenance: InstanceProvenance;
  ai: InstanceAiBlock | null;
  order: number;
}

// ── §4 measurements ────────────────────────────────────────────────────────────

export interface MeasurementRange {
  low: number;
  high: number;
}

export interface NormalRange {
  low: number;
  high: number;
  unit: string;
  source: string; // e.g. "catalog"
}

export interface MeasurementComponent {
  measurement_ref: Ref;
  value: number;
  unit: string;
}

export interface MeasurementProvenance {
  origin: string; // ProvenanceOrigin — "how the atom entered the document" (R10/R11)
  source: MeasurementSource; // measurement-only, narrower "raw-data source" question
  confidence: number; // 0..1
  sop_instance_uid?: string;
  frame_number?: number;
  captured_at?: string;
  actor?: string;
  edited: boolean;
}

export interface Measurement {
  lid: string;
  measurement_ref: Ref; // meas.* — finding-scoped, resolved within finding_ref's own bindings
  finding_ref: string; // REQUIRED non-null for any meas.*-backed measurement (§4, R5)
  site?: Ref | null; // loc.* — finding-scoped anatomical site
  laterality?: LateralityRef | null;
  value: number | null; // canonical NUMERIC value, never a display string
  unit: string | null; // UCUM-compatible
  value_kind: ValueKind;
  value_iso: string | null; // ISO-8601 date/datetime, used only when value_kind === "date"
  range: MeasurementRange | null; // used when value_kind === "range"
  components: MeasurementComponent[] | null; // required when value_kind === "derived"
  normal_range: NormalRange | null;
  abnormal: boolean;
  prior_value: number | null;
  prior_measurement_ref_document: string | null; // document_id of the prior report
  change_pct: number | null;
  provenance: MeasurementProvenance;
  display: string;
}

// ── §6 recommendations ─────────────────────────────────────────────────────────

export interface Recommendation {
  lid: string;
  recommendation_ref: Ref | null; // rec.* content-pack registry code, or null for free-text
  finding_refs: string[]; // findings this recommendation follows from
  text: string;
  priority: RecommendationPriority;
  provenance: InstanceProvenance;
  ai: InstanceAiBlock | null;
}

// ── §7 impression ───────────────────────────────────────────────────────────────

export interface ImpressionFragment {
  lid: string;
  finding_ref: string | null;
  text: string;
  source: ImpressionFragmentSource;
  rank: number;
  provenance: InstanceProvenance;
  ai: InstanceAiBlock | null; // REQUIRED (non-null) whenever source === "ai_suggestion" (R11)
}

export interface ImpressionItem {
  lid: string;
  fragment_refs: string[]; // impression.fragments[].lid
  text: string;
}

export interface Impression {
  fragments: ImpressionFragment[];
  items: ImpressionItem[];
  rendered: string;
}

// ── §7.4 sections (optional, derivable) ────────────────────────────────────────

export interface Section {
  lid: string;
  kind: SectionKind;
  title?: string;
  finding_refs?: string[];
  measurement_refs?: string[];
  rendered: string;
}

// ── §1.1 catalog_snapshot ───────────────────────────────────────────────────────

export interface CatalogSnapshotPin {
  content_pack_versions: Record<string, string>;
  catalog_schema_version: string;
  ai_rules_version: Record<string, string>;
}

// ── §10 audit ───────────────────────────────────────────────────────────────────

export interface AuditRevisionEntry {
  revision: number;
  at: string;
  by: string;
  action: string; // e.g. "created" | "finalized" | "amended" | "migrated" — open, sparse milestone log
}

export interface AuditSignature {
  state: SignatureState;
  signed_by: string | null;
  signed_role: string | null;
  signed_at: string | null;
  signed_content_sha256: string | null;
  amends_document_id: string | null;
}

export interface AuditBlock {
  schema_version: string;
  hash_algorithm: HashAlgorithm;
  created_at: string;
  last_modified_at: string;
  revision: number; // MUST equal provenance.revision, R10b
  revisions: AuditRevisionEntry[];
  content_sha256: string;
  audit_log_ref: number | null; // REQUIRED non-null at finalize (R14b)
  signature: AuditSignature;
}

// ── §1.1 top-level envelope ──────────────────────────────────────────────────────

export interface StructuredReportDocument {
  schema_version: string;
  kind: typeof STRUCTURED_REPORT_KIND;
  document_id: string; // ULID, ^[0-9A-HJKMNP-TV-Z]{26}$ (§1.3, R18)
  catalog_snapshot: CatalogSnapshotPin;
  study_context: StudyContext;
  sections?: Section[]; // OPTIONAL, derivable (§7.4)
  findings: Finding[];
  measurements: Measurement[];
  impression?: Impression;
  recommendations: Recommendation[];
  critical_flags: CriticalFlag[];
  provenance: DocumentProvenance;
  ai: DocumentAiBlock; // REQUIRED even when empty (§1.1, §9.1)
  audit: AuditBlock;
  extensions?: Record<string, unknown>;
}

// document_id pattern (§1.3) — Crockford Base32, exactly 26 chars, excludes I/L/O/U.
export const DOCUMENT_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const SCHEMA_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

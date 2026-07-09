// ─────────────────────────────────────────────────────────────────────────────
// Radiology YAML content-pack pipeline (Tickets K1/K2/K3) — pack format types.
//
// The canonical YAML packs live in another branch and are NOT in this repo. This
// module implements the complete validator + dry-run + transactional importer
// against DEVELOPER FIXTURES (packs/__fixtures__), designed to run unchanged the
// moment the real packs are merged. No clinical content is invented here.
//
// The pack format below is the authoring surface that normalizes onto the
// already-built B1/B2 canonical catalog (lib/db/src/schema/radiologyCatalog.ts).
// It intentionally does NOT redesign the catalog: parameters/options/categories/
// findings and the finding_* bindings map onto existing tables; `criticals` and
// `templates` are validated as references but have no catalog table yet, so the
// importer records them as validation-only registries (see graph.ts / importer.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const PACK_SCHEMA_VERSION = "1.0.0";
/** Pack schema_versions this pipeline can import (semver major must match). */
export const SUPPORTED_MAJOR = 1;

/** Reference namespaces (D1 spec). A finding references shared libraries as `<prefix>.<key>`. */
export const REF_PREFIXES = ["param", "sev", "lat", "loc", "meas", "rec", "crit", "tpl"] as const;
export type RefPrefix = (typeof REF_PREFIXES)[number];

export type DataType = "option" | "numeric" | "text" | "boolean";
export const DATA_TYPES: DataType[] = ["option", "numeric", "text", "boolean"];

export type Priority = "routine" | "urgent" | "critical";
export const PRIORITIES: Priority[] = ["routine", "urgent", "critical"];

export type Laterality = "left" | "right" | "bilateral" | "midline";
export const LATERALITIES: Laterality[] = ["left", "right", "bilateral", "midline"];

// ── Shared-library declarations (a pack may introduce these) ──────────────────

export interface ParamOptionDecl { key: string; label: string; code_system?: string; code_value?: string; }
export interface ParameterDecl {
  key: string; label: string; data_type: DataType; unit?: string; allow_multiple?: boolean;
  options?: ParamOptionDecl[];
}
export interface SeverityDecl { key: string; label: string; rank?: number; }
export interface LocationDecl { key: string; label: string; laterality?: Laterality; }
export interface RecommendationDecl { code: string; text: string; priority?: Priority; }
export interface CriticalDecl { key: string; label: string; }
export interface TemplateDecl { key: string; label: string; }
export interface CategoryDecl { key: string; display_name: string; parent?: string | null; modality?: string; }

// ── Finding-level bindings ────────────────────────────────────────────────────

export interface FindingParamBinding { ref: string; required?: boolean; default?: string; sort_order?: number; }
export interface FindingMeasurementBinding { key: string; label: string; unit?: string; min?: number; max?: number; }
export interface AiContradictionRule { id: string; message: string; when: string[]; forbid: string[]; }
export interface AiCompletenessRule { id: string; message: string; require: string[]; }

export interface FindingDecl {
  id_key: string;
  display_name: string;
  category: string;
  default_sentence: string;
  impression_fragment: string;
  keyboard_alias?: string;
  aliases?: string[];
  extends?: string | null;                 // id_key of a base finding
  included_findings_ref?: string[];         // combo/include: id_keys materialized alongside
  parameters?: FindingParamBinding[];       // ref → param.<key>
  severities?: string[];                    // sev.<key>
  locations?: string[];                     // loc.<key>
  measurements?: FindingMeasurementBinding[];
  recommendations?: string[];               // rec.<code>
  criticals?: string[];                     // crit.<key>  (validation-only)
  template?: string | null;                 // tpl.<key>   (validation-only)
  ai_contradiction_rules?: AiContradictionRule[];
  ai_completeness_rules?: AiCompletenessRule[];
  status?: string;                          // draft|active|deprecated (default draft)
}

export interface PackMeta { id: string; version: string; modality?: string; title?: string; }

export interface ContentPack {
  schema_version: string;
  pack: PackMeta;
  parameters?: ParameterDecl[];
  severities?: SeverityDecl[];
  locations?: LocationDecl[];
  recommendations?: RecommendationDecl[];
  criticals?: CriticalDecl[];
  templates?: TemplateDecl[];
  categories?: CategoryDecl[];
  findings?: FindingDecl[];
}

/** A pack as loaded from disk (or a fixture), with its source name for error reporting. */
export interface LoadedPack {
  source: string;             // file name or fixture id
  raw: string;                // original YAML text
  parsed: ContentPack | null; // null when YAML failed to parse
  parseError?: string;
}

// ── Validation / diagnostics ──────────────────────────────────────────────────

export type IssueCode =
  | "YAML_PARSE_ERROR"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_ENUM"
  | "INVALID_KEY"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "DUPLICATE_ID_KEY"
  | "DUPLICATE_ALIAS"
  | "ALIAS_PREFIX_COLLISION"
  | "DUPLICATE_LIBRARY_KEY"
  | "UNKNOWN_PARAM_REF"
  | "UNKNOWN_SEVERITY_REF"
  | "UNKNOWN_LOCATION_REF"
  | "UNKNOWN_RECOMMENDATION_REF"
  | "UNKNOWN_CRITICAL_REF"
  | "UNKNOWN_TEMPLATE_REF"
  | "UNKNOWN_SHARED_REF"
  | "INVALID_PARAM_BINDING"
  | "INVALID_MEASUREMENT_BINDING"
  | "INVALID_RECOMMENDATION_BINDING"
  | "INVALID_COMBO_REF"
  | "UNKNOWN_EXTENDS_REF"
  | "CIRCULAR_EXTENDS"
  | "MISSING_AI_SECTION"
  | "IMMUTABLE_ID_KEY_VIOLATION"
  | "UNKNOWN_CATEGORY_REF"
  | "IMPORT_ERROR";

export interface PackIssue {
  code: IssueCode;
  severity: "error" | "warning";
  pack?: string;
  path?: string;       // e.g. "findings[2].parameters[0].ref"
  message: string;
  detail?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;                 // false if ANY error — NO PARTIAL SUCCESS
  errors: PackIssue[];
  warnings: PackIssue[];
}

/** Strip a known ref prefix: "param.echogenicity" → "echogenicity". */
export function stripPrefix(ref: string, prefix: RefPrefix): string {
  return ref.startsWith(`${prefix}.`) ? ref.slice(prefix.length + 1) : ref;
}

/** Normalize alias/synonym text for collision checks (mirrors B1/B2 normalizeText). */
export function normalizeAlias(s: string): string {
  return s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

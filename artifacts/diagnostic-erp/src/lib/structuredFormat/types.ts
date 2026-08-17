/**
 * Structured format v2 — radiologist-configurable report schema.
 *
 * Consumed by the existing Reporting Workspace via findingsMap + reportFieldMerge.
 * No executable JS in this JSON. sentence_tile is deferred to P2.
 */

export const STRUCTURED_FORMAT_SCHEMA_VERSION = 2 as const;

export type CanonicalSeverity = "normal" | "mild" | "moderate" | "severe" | "critical";

export type CombineMode = "separate_sentences" | "comma_list" | "conjunction";

export type FieldType =
  | "single_select"
  | "multi_select"
  | "checkbox"
  | "radio"
  | "toggle"
  | "text"
  | "textarea"
  | "number"
  | "measurement"
  | "laterality"
  | "grade"
  | "normal_abnormal";

export type ContributesTo = "findings" | "technique" | "impression" | "recommendation";

export type MutexMode = "exclusive" | "normal-clears-abnormal";

export type MutexGroupDef = {
  id: string;
  mode: MutexMode;
};

export type RepeatingGroupItem = {
  id: string;
  label: string;
};

export type RepeatingGroupDef = {
  id: string;
  label: string;
  /** Token name bound on expand, typically "level". */
  itemToken: string;
  items: RepeatingGroupItem[];
};

export type FormatOption = {
  id: string;
  label: string;
  value: string;
  canonicalKey?: string;
  outputSentence?: string;
  impressionSentence?: string;
  /** 0 or undefined → no impression candidate. Higher surfaces first. */
  impressionWeight?: number;
  severity?: CanonicalSeverity;
  tags?: string[];
  mutexGroup?: string;
};

export type FormatField = {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unit?: string;
  mutexGroup?: string;
  /** Binds this field's value to a token, e.g. "severity", "measurement", "side". */
  token?: string;
  combineMode?: CombineMode;
  options: FormatOption[];
};

export type FormatSection = {
  id: string;
  label: string;
  headingVisible: boolean;
  required: boolean;
  collapsedByDefault: boolean;
  contributesTo: ContributesTo[];
  defaultText: string;
  normalText: string;
  repeat?: { groupId: string };
  fields: FormatField[];
};

export type StructuredFormatDoc = {
  schemaVersion: typeof STRUCTURED_FORMAT_SCHEMA_VERSION;
  technique?: string;
  tokens: string[];
  mutexGroups: MutexGroupDef[];
  repeatingGroupDefs: RepeatingGroupDef[];
  sections: FormatSection[];
};

/** v1 on-disk shape (existing presets). */
export type V1SectionsJson = {
  technique?: string;
  findingsItems?: Array<{ label: string; normal: string }>;
  impression?: string;
  placeholders?: unknown;
  schemaVersion?: number;
};

export type FieldValue = string | string[] | boolean | number | null;

export type StructuredValues = Record<string, FieldValue>;

export type FindingsMap = Record<string, { normal: boolean; text: string }>;

export type GeneratedContribution = {
  findingsMap: FindingsMap;
  findingsText: string;
  techniqueText: string;
  impressionCandidates: ImpressionCandidate[];
  recommendationText: string;
};

export type ImpressionCandidate = {
  text: string;
  weight: number;
  fieldPathKey: string;
  optionId?: string;
  canonicalKey?: string;
};

export const CARE_STRUCTURED_FORMAT_STATE_KIND = "care.structured_format_state";

export type StructuredFormatDraftState = {
  kind: typeof CARE_STRUCTURED_FORMAT_STATE_KIND;
  formatId: number;
  formatVersion: number;
  values: StructuredValues;
  updatedAt: string;
};

export function slugId(label: string, fallback: string): string {
  const s = label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

export function isCanonicalSeverity(v: unknown): v is CanonicalSeverity {
  return v === "normal" || v === "mild" || v === "moderate" || v === "severe" || v === "critical";
}

export function severityToken(severity: CanonicalSeverity | undefined): string {
  if (!severity || severity === "normal") return "";
  return severity;
}

export function emptyFormatDoc(technique = ""): StructuredFormatDoc {
  return {
    schemaVersion: STRUCTURED_FORMAT_SCHEMA_VERSION,
    technique,
    tokens: ["level", "side", "severity", "measurement", "unit", "root", "grade"],
    mutexGroups: [],
    repeatingGroupDefs: [],
    sections: [],
  };
}

/** Derive which report fields this format can write — never stored at doc top-level. */
export function contributesFromSections(doc: StructuredFormatDoc): Record<ContributesTo, boolean> {
  const out: Record<ContributesTo, boolean> = {
    findings: false,
    technique: false,
    impression: false,
    recommendation: false,
  };
  for (const s of doc.sections) {
    for (const c of s.contributesTo) out[c] = true;
  }
  if ((doc.technique ?? "").trim()) out.technique = true;
  return out;
}

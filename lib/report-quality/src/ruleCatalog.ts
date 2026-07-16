// ruleCatalog.ts — the single source of rule identity.
//
// Every quality rule has a STABLE id (never derived from message text) so that
// analytics, dashboards, suppression, overrides, auditing and future
// localization key off the id, not the wording. Message text may change freely;
// ids never do.
//
// Id scheme:
//   Q0xx — completeness / measurement presence (from computeQualityScore)
//   Q1xx — free-text consistency/laterality/terminology (from validateReport)
// Later phases add Q2xx (structured measurement), Q3xx (comparison),
// Q4xx (recommendation/knowledge-pack), etc.

import type { QualityCategory, Severity, DataTier } from "./contract";

/** Bumped whenever the rule set or its semantics change — persisted per evaluation. */
export const RULE_CATALOG_VERSION = "1.0.0";

export interface RuleCatalogEntry {
  id: string;
  title: string;
  category: QualityCategory;
  tier: DataTier;
  defaultSeverity: Severity;
  description: string;
}

export const RULE_CATALOG = {
  // ── Completeness (Q0xx) ──
  Q001: { id: "Q001", title: "Findings section empty", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "The Findings section has no content." },
  Q002: { id: "Q002", title: "Impression section empty", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "The Impression section has no content." },
  Q003: { id: "Q003", title: "Technique not documented", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "The Technique section is blank." },
  Q004: { id: "Q004", title: "Clinical history not documented", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "No clinical history recorded." },
  Q005: { id: "Q005", title: "No recommendation given", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "No recommendation/advice recorded." },
  Q006: { id: "Q006", title: "Protocol checklist incomplete", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "The active protocol checklist is not fully addressed." },
  Q007: { id: "Q007", title: "Required measurement missing", category: "measurement", tier: "heuristic", defaultSeverity: "warning", description: "A required measurement label is absent from the report text." },
  // ── Free-text consistency (Q1xx) ──
  Q101: { id: "Q101", title: "Duplicate sentence in findings", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "A sentence is repeated in the Findings." },
  Q102: { id: "Q102", title: "Duplicate impression line", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "An impression line is repeated." },
  Q103: { id: "Q103", title: "Normal phrase with pathology", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "A 'normal study' phrase co-occurs with a pathology term." },
  Q104: { id: "Q104", title: "Impression laterality not in findings", category: "laterality", tier: "heuristic", defaultSeverity: "warning", description: "A side named in the Impression is absent from the Findings." },
  Q105: { id: "Q105", title: "Pathology without impression", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "Findings describe pathology but the Impression is empty." },
  Q106: { id: "Q106", title: "Unfilled measurement placeholder", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "An un-filled {value} placeholder remains in the text." },
  Q107: { id: "Q107", title: "Laterality vs study description", category: "laterality", tier: "heuristic", defaultSeverity: "warning", description: "Report laterality contradicts the study description." },
  Q108: { id: "Q108", title: "Protrusion direction ambiguous", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Both anterior and posterior protrusions mentioned." },
  Q109: { id: "Q109", title: "Gender/anatomy contradiction", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Report mentions anatomy inconsistent with patient sex." },
  Q110: { id: "Q110", title: "Age-inappropriate wording", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Wording inconsistent with the patient's age." },
  Q111: { id: "Q111", title: "Modality terminology mismatch", category: "terminology", tier: "heuristic", defaultSeverity: "warning", description: "Terminology from another modality found in the report." },
  Q112: { id: "Q112", title: "Contrast contradiction", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Contrast usage in text contradicts the study description." },
  Q113: { id: "Q113", title: "Normal findings, abnormal impression", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Findings normal but Impression lists an abnormality." },
  Q114: { id: "Q114", title: "Abnormal findings, normal impression", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Findings abnormal but Impression describes a normal study." },
  Q115: { id: "Q115", title: "Repeated word (dictation artifact)", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "A word is accidentally repeated — likely dictation." },
} as const satisfies Record<string, RuleCatalogEntry>;

export type RuleId = keyof typeof RULE_CATALOG;

export function getRuleEntry(id: RuleId): RuleCatalogEntry {
  return RULE_CATALOG[id];
}

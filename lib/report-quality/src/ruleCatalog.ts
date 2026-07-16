// ruleCatalog.ts — the single source of rule identity.
//
// Every quality rule has a STABLE id (never derived from message text) so that
// analytics, dashboards, suppression, overrides, auditing and future
// localization key off the id, not the wording. Message text may change freely;
// ids never do.
//
// Phase 2.5 adds forward-looking metadata WITHOUT changing the existing ids:
//   - canonicalId : hierarchical, namespaced id for ownership + prefix analytics
//                   (e.g. "care.text.laterality.impression-vs-findings").
//   - legacyAlias : the original flat id (Q0xx/Q1xx), grandfathered forever.
//   - owner       : who maintains the rule ("care-core" for built-ins).
//   - pack        : owning Quality/Knowledge Pack, or null for built-ins.
//   - version     : per-rule version for granular reproducibility.
//   - dependsOn   : rule ids this rule logically depends on (dashboards +
//                   future ordered execution; the runner does NOT consume it yet).
//
// The flat `id` (Q0xx/Q1xx) remains the stable primary key emitted on findings.
// New rules should use hierarchical canonicalIds as their primary id.
//
// Id scheme (flat, legacy): Q0xx completeness/measurement · Q1xx free-text.

import type { QualityCategory, Severity, DataTier } from "./contract";

/** Bumped whenever the rule SET changes; per-rule `version` gives finer grain. */
export const RULE_CATALOG_VERSION = "1.1.0";

export interface RuleCatalogEntry {
  /** Stable primary id emitted on findings (e.g. "Q104"). */
  id: string;
  /** Hierarchical, namespaced id (e.g. "care.text.laterality.impression-vs-findings"). */
  canonicalId: string;
  /** Original flat id, grandfathered as a permanent alias. */
  legacyAlias: string;
  title: string;
  category: QualityCategory;
  tier: DataTier;
  defaultSeverity: Severity;
  /** Maintainer of the rule ("care-core" for built-ins). */
  owner: string;
  /** Owning Quality/Knowledge Pack, or null for built-ins. */
  pack: string | null;
  /** Per-rule version for granular reproducibility. */
  version: string;
  /** Rule ids this rule logically depends on (dashboards + future ordering; not consumed by the runner). */
  dependsOn?: string[];
  description: string;
}

// Shared defaults for all built-in Phase 0-2 rules.
const CORE = { owner: "care-core", pack: null, version: "1.0.0" } as const;

export const RULE_CATALOG = {
  // ── Completeness (Q0xx) ──
  Q001: { id: "Q001", legacyAlias: "Q001", canonicalId: "care.completeness.section.findings", ...CORE, title: "Findings section empty", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "The Findings section has no content." },
  Q002: { id: "Q002", legacyAlias: "Q002", canonicalId: "care.completeness.section.impression", ...CORE, title: "Impression section empty", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "The Impression section has no content." },
  Q003: { id: "Q003", legacyAlias: "Q003", canonicalId: "care.completeness.section.technique", ...CORE, title: "Technique not documented", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "The Technique section is blank." },
  Q004: { id: "Q004", legacyAlias: "Q004", canonicalId: "care.completeness.section.clinical-history", ...CORE, title: "Clinical history not documented", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "No clinical history recorded." },
  Q005: { id: "Q005", legacyAlias: "Q005", canonicalId: "care.completeness.section.recommendation", ...CORE, title: "No recommendation given", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "No recommendation/advice recorded." },
  Q006: { id: "Q006", legacyAlias: "Q006", canonicalId: "care.completeness.checklist.incomplete", ...CORE, title: "Protocol checklist incomplete", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "The active protocol checklist is not fully addressed." },
  Q007: { id: "Q007", legacyAlias: "Q007", canonicalId: "care.measurement.required.missing", ...CORE, title: "Required measurement missing", category: "measurement", tier: "heuristic", defaultSeverity: "warning", description: "A required measurement label is absent from the report text." },
  // ── Free-text consistency (Q1xx) ──
  Q101: { id: "Q101", legacyAlias: "Q101", canonicalId: "care.text.consistency.duplicate-sentence", ...CORE, title: "Duplicate sentence in findings", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "A sentence is repeated in the Findings." },
  Q102: { id: "Q102", legacyAlias: "Q102", canonicalId: "care.text.consistency.duplicate-impression-line", ...CORE, title: "Duplicate impression line", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "An impression line is repeated." },
  Q103: { id: "Q103", legacyAlias: "Q103", canonicalId: "care.text.consistency.normal-vs-pathology", ...CORE, title: "Normal phrase with pathology", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "A 'normal study' phrase co-occurs with a pathology term." },
  Q104: { id: "Q104", legacyAlias: "Q104", canonicalId: "care.text.laterality.impression-vs-findings", ...CORE, title: "Impression laterality not in findings", category: "laterality", tier: "heuristic", defaultSeverity: "warning", description: "A side named in the Impression is absent from the Findings." },
  Q105: { id: "Q105", legacyAlias: "Q105", canonicalId: "care.completeness.pathology-without-impression", ...CORE, title: "Pathology without impression", category: "completeness", tier: "heuristic", defaultSeverity: "warning", description: "Findings describe pathology but the Impression is empty." },
  Q106: { id: "Q106", legacyAlias: "Q106", canonicalId: "care.text.consistency.unfilled-placeholder", ...CORE, title: "Unfilled measurement placeholder", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "An un-filled {value} placeholder remains in the text." },
  Q107: { id: "Q107", legacyAlias: "Q107", canonicalId: "care.text.laterality.vs-study-description", ...CORE, title: "Laterality vs study description", category: "laterality", tier: "heuristic", defaultSeverity: "warning", description: "Report laterality contradicts the study description." },
  Q108: { id: "Q108", legacyAlias: "Q108", canonicalId: "care.text.consistency.protrusion-direction", ...CORE, title: "Protrusion direction ambiguous", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Both anterior and posterior protrusions mentioned." },
  Q109: { id: "Q109", legacyAlias: "Q109", canonicalId: "care.text.consistency.gender-anatomy", ...CORE, title: "Gender/anatomy contradiction", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Report mentions anatomy inconsistent with patient sex." },
  Q110: { id: "Q110", legacyAlias: "Q110", canonicalId: "care.text.consistency.age-appropriateness", ...CORE, title: "Age-inappropriate wording", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Wording inconsistent with the patient's age." },
  Q111: { id: "Q111", legacyAlias: "Q111", canonicalId: "care.text.terminology.modality-mismatch", ...CORE, title: "Modality terminology mismatch", category: "terminology", tier: "heuristic", defaultSeverity: "warning", description: "Terminology from another modality found in the report." },
  Q112: { id: "Q112", legacyAlias: "Q112", canonicalId: "care.text.consistency.contrast", ...CORE, title: "Contrast contradiction", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Contrast usage in text contradicts the study description." },
  Q113: { id: "Q113", legacyAlias: "Q113", canonicalId: "care.text.consistency.findings-normal-impression-abnormal", ...CORE, title: "Normal findings, abnormal impression", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Findings normal but Impression lists an abnormality." },
  Q114: { id: "Q114", legacyAlias: "Q114", canonicalId: "care.text.consistency.findings-abnormal-impression-normal", ...CORE, title: "Abnormal findings, normal impression", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "Findings abnormal but Impression describes a normal study." },
  Q115: { id: "Q115", legacyAlias: "Q115", canonicalId: "care.text.consistency.repeated-word", ...CORE, title: "Repeated word (dictation artifact)", category: "consistency", tier: "heuristic", defaultSeverity: "warning", description: "A word is accidentally repeated — likely dictation." },
} as const satisfies Record<string, RuleCatalogEntry>;

export type RuleId = keyof typeof RULE_CATALOG;

export function getRuleEntry(id: RuleId): RuleCatalogEntry {
  return RULE_CATALOG[id];
}

/** Look up an entry by either its flat id or its canonicalId (nullable). */
export function findRuleEntry(idOrCanonical: string): RuleCatalogEntry | undefined {
  const direct = (RULE_CATALOG as Record<string, RuleCatalogEntry>)[idOrCanonical];
  if (direct) return direct;
  return Object.values(RULE_CATALOG).find((e) => e.canonicalId === idOrCanonical);
}

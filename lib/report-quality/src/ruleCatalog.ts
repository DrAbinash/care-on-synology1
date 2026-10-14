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
export const RULE_CATALOG_VERSION = "1.4.0";

/**
 * Rule significance — the classification the sign dialog needs and the severity
 * field cannot express.
 *
 * Named for the RULE, not for "clinical significance" at large: that phrase
 * already means something else in this codebase. api-server's
 * reportComposer/clinicalSignificance.ts answers "did this AI edit change a
 * clinically significant token", which is a diff between two versions of one
 * report. This answers "what kind of fact does this rule read", which is a
 * property of the rule and is the same for every report it ever runs on.
 *
 * Every one of the 30 rules below is `defaultSeverity: "warning"` and
 * `tier: "heuristic"`, and `phase2.test.ts` pins exactly that ("all Phase-2 text
 * rules are advisory heuristic (never blockers)"). That is settled policy, so
 * severity cannot carry the distinction — it is the same value for a repeated
 * dictation word and for an Impression that puts the infarct on the wrong side of
 * the brain. `category` cannot carry it either: Q115 ("repeated word — likely
 * dictation") and Q119 ("one section withdraws a finding the other still
 * reports") are both `category: "consistency"`.
 *
 * So the distinction gets its own field, on the entry, where a new rule cannot be
 * added without declaring it:
 *
 *   "high"     the rule reports a contradiction about THIS PATIENT's clinical
 *              facts — laterality, spinal level, severity grade, a named
 *              diagnosis nothing in the report describes, a region outside the
 *              examination, contrast that was not given, anatomy that does not
 *              belong to the recorded sex or age, a modality's wording inside
 *              another modality's report. §8's HIGH.
 *   "advisory" the rule reports something about the PROSE or the completeness of
 *              the document — an empty or missing section, a duplicate sentence,
 *              an unfilled placeholder, a repeated word, an absent optional
 *              recommendation. §8's ADVISORY.
 *
 * §8's CRITICAL is deliberately NOT here. It names verified patient/study
 * identity mismatch and invalid report association, which are facts about the
 * record rather than readings of its text, and they are settled elsewhere: the
 * finalize identity binding, and the structured tier's critical-range
 * measurement, which is the one thing that emits `severity: "blocker"` and so
 * already reaches `computeUnresolvedBlockers`. Three "high" rules read the same
 * facts heuristically — Q109 (sex vs anatomy), Q110 (age vs wording), Q111
 * (modality wording) — and are the candidates if the owner ever wants a text-tier
 * CRITICAL. That promotion is a clinical policy decision, not a code change, and
 * nothing here makes it.
 *
 * THIS FIELD ENFORCES NOTHING. `isHardBlockingFinding` still reads severity and
 * tier, `computeUnresolvedBlockers` still reads that, and no `canConfirm` in any
 * dialog reads this. It exists so a screen can say "two clinical contradictions"
 * instead of "Ready to sign". Wiring it into authorization would reverse the
 * block-vs-warn decision that ARCHITECTURE.md §8.1 reserves to the product owner.
 */
export type RuleSignificance = "high" | "advisory";

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
  /**
   * Whether this rule reports a contradiction about the patient's clinical facts
   * ("high") or about the report's prose and completeness ("advisory"). Display
   * and triage only — see the RuleSignificance note above. Nothing enforces it,
   * and `defaultSeverity`/`tier` are unchanged by it.
   */
  significance: RuleSignificance;
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
  Q001: { id: "Q001", legacyAlias: "Q001", canonicalId: "care.completeness.section.findings", ...CORE, title: "Findings section empty", category: "completeness", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "The Findings section has no content." },
  Q002: { id: "Q002", legacyAlias: "Q002", canonicalId: "care.completeness.section.impression", ...CORE, title: "Impression section empty", category: "completeness", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "The Impression section has no content." },
  Q003: { id: "Q003", legacyAlias: "Q003", canonicalId: "care.completeness.section.technique", ...CORE, title: "Technique not documented", category: "completeness", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "The Technique section is blank." },
  Q004: { id: "Q004", legacyAlias: "Q004", canonicalId: "care.completeness.section.clinical-history", ...CORE, title: "Clinical history not documented", category: "completeness", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "No clinical history recorded." },
  // Q005 is conditional where Q001-Q004 are not: an empty Recommendation section is
  // what CARE's anti-filler policy produces on purpose, so only a stated plan makes it
  // a gap. The predicate lives in ./text/recommendation.ts. Id, canonical id and
  // advisory classification are unchanged — only what the rule now means.
  Q005: { id: "Q005", legacyAlias: "Q005", canonicalId: "care.completeness.section.recommendation", ...CORE, title: "Recommendation missing for a stated plan", category: "completeness", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "The Impression states a plan but the Recommendation section is empty." },
  Q006: { id: "Q006", legacyAlias: "Q006", canonicalId: "care.completeness.checklist.incomplete", ...CORE, title: "Protocol checklist incomplete", category: "completeness", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "The active protocol checklist is not fully addressed." },
  Q007: { id: "Q007", legacyAlias: "Q007", canonicalId: "care.measurement.required.missing", ...CORE, title: "Required measurement missing", category: "measurement", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "A required measurement label is absent from the report text." },
  // ── Free-text consistency (Q1xx) ──
  Q101: { id: "Q101", legacyAlias: "Q101", canonicalId: "care.text.consistency.duplicate-sentence", ...CORE, title: "Duplicate sentence in findings", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "A sentence is repeated in the Findings." },
  Q102: { id: "Q102", legacyAlias: "Q102", canonicalId: "care.text.consistency.duplicate-impression-line", ...CORE, title: "Duplicate impression line", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "An impression line is repeated." },
  Q103: { id: "Q103", legacyAlias: "Q103", canonicalId: "care.text.consistency.normal-vs-pathology", ...CORE, title: "Normal phrase with pathology", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "A 'normal study' phrase co-occurs with a pathology term." },
  Q104: { id: "Q104", legacyAlias: "Q104", canonicalId: "care.text.laterality.impression-vs-findings", ...CORE, title: "Impression laterality not in findings", category: "laterality", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "A side named in the Impression is absent from the Findings." },
  Q105: { id: "Q105", legacyAlias: "Q105", canonicalId: "care.completeness.pathology-without-impression", ...CORE, title: "Pathology without impression", category: "completeness", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "Findings describe pathology but the Impression is empty." },
  Q106: { id: "Q106", legacyAlias: "Q106", canonicalId: "care.text.consistency.unfilled-placeholder", ...CORE, title: "Unfilled measurement placeholder", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "An un-filled {value} placeholder remains in the text." },
  Q107: { id: "Q107", legacyAlias: "Q107", canonicalId: "care.text.laterality.vs-study-description", ...CORE, title: "Laterality vs study description", category: "laterality", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Report laterality contradicts the study description." },
  Q108: { id: "Q108", legacyAlias: "Q108", canonicalId: "care.text.consistency.protrusion-direction", ...CORE, title: "Protrusion direction ambiguous", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "Both anterior and posterior protrusions mentioned." },
  Q109: { id: "Q109", legacyAlias: "Q109", canonicalId: "care.text.consistency.gender-anatomy", ...CORE, title: "Gender/anatomy contradiction", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Report mentions anatomy inconsistent with patient sex." },
  Q110: { id: "Q110", legacyAlias: "Q110", canonicalId: "care.text.consistency.age-appropriateness", ...CORE, title: "Age-inappropriate wording", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Wording inconsistent with the patient's age." },
  Q111: { id: "Q111", legacyAlias: "Q111", canonicalId: "care.text.terminology.modality-mismatch", ...CORE, title: "Modality terminology mismatch", category: "terminology", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Terminology from another modality found in the report." },
  Q112: { id: "Q112", legacyAlias: "Q112", canonicalId: "care.text.consistency.contrast", ...CORE, title: "Contrast contradiction", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Contrast usage in text contradicts the study description." },
  Q113: { id: "Q113", legacyAlias: "Q113", canonicalId: "care.text.consistency.findings-normal-impression-abnormal", ...CORE, title: "Normal findings, abnormal impression", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Findings normal but Impression lists an abnormality." },
  Q114: { id: "Q114", legacyAlias: "Q114", canonicalId: "care.text.consistency.findings-abnormal-impression-normal", ...CORE, title: "Abnormal findings, normal impression", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Findings abnormal but Impression describes a normal study." },
  Q115: { id: "Q115", legacyAlias: "Q115", canonicalId: "care.text.consistency.repeated-word", ...CORE, title: "Repeated word (dictation artifact)", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "advisory", description: "A word is accidentally repeated — likely dictation." },
  Q116: { id: "Q116", legacyAlias: "Q116", canonicalId: "care.text.consistency.birads-vs-findings", ...CORE, title: "BI-RADS assessment contradicts findings", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "The stated BI-RADS category is not supported by the Findings it summarises." },
  Q117: { id: "Q117", legacyAlias: "Q117", canonicalId: "care.text.consistency.ungrounded-diagnosis", ...CORE, title: "Impression names a diagnosis the report never describes", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "A specific named diagnosis appears in the Impression and in no other section of the report." },
  Q118: { id: "Q118", legacyAlias: "Q118", canonicalId: "care.text.consistency.anatomical-scope", ...CORE, title: "Report describes a region outside the examination", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Spine levels or regions named in the report that the study title does not cover." },
  // ── Findings↔Impression (Q119-Q123) ──
  // One contract, two consumers: ./text/findingsImpression.ts is called by both
  // this tier and the live workspace validator, so these five ids are what the
  // server records for the checks the badge has always printed. Q120 and Q121
  // existed only as unnumbered warnings before, which meant nothing server-side
  // persisted them, and Q119 did not exist at all.
  Q119: { id: "Q119", legacyAlias: "Q119", canonicalId: "care.text.consistency.section-state", ...CORE, title: "One section withdraws a finding the other still reports", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "The Findings and the Impression disagree about whether a named finding is present, denied or held open." },
  Q120: { id: "Q120", legacyAlias: "Q120", canonicalId: "care.text.consistency.spinal-level", ...CORE, title: "Findings and Impression name different spinal levels", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Both sections describe the same spinal anatomy but share no level." },
  Q121: { id: "Q121", legacyAlias: "Q121", canonicalId: "care.text.consistency.severity-grade", ...CORE, title: "Findings and Impression grade the same finding differently", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "One section grades a finding mild, the other moderate or severe, with no grade in common." },
  Q122: { id: "Q122", legacyAlias: "Q122", canonicalId: "care.text.consistency.basal-ganglia", ...CORE, title: "Basal ganglia described as normal and as a haemorrhage", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "The same structure is cleared and bled into within one report." },
  Q123: { id: "Q123", legacyAlias: "Q123", canonicalId: "care.text.consistency.diffusion-infarct", ...CORE, title: "Diffusion reported negative alongside an acute infarct", category: "consistency", tier: "heuristic", defaultSeverity: "warning", significance: "high", description: "Restricted diffusion is denied in a report that concludes an acute infarct, the finding that sequence exists to show." },
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

/**
 * The significance of a rule id, or null when the id is not in the catalogue.
 * Null is not "advisory": a finding whose rule this build does not know is a
 * finding whose significance nobody has declared, and a caller that folded the
 * two together would be reporting an unknown rule as prose-level.
 */
export function significanceOfRule(idOrCanonical: string): RuleSignificance | null {
  return findRuleEntry(idOrCanonical)?.significance ?? null;
}

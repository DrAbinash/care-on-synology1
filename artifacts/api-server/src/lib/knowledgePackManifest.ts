/**
 * knowledgePackManifest.ts — CARE Knowledge Pack Engine (pure core).
 *
 * The manifest type, reconciliation helpers (bridging the several study-type
 * identity spaces), and a deterministic pack VALIDATOR. Pure + alias-free
 * (root-testable). No DB access here — the route assembles live coverage and
 * passes it in.
 */

// ── Reconciliation ────────────────────────────────────────────────────────────
// The platform has several study-type identity spaces (Title-Case region names
// in radiology_study_tabs.name, lower_snake builderType in
// radiology_impression_rules, UPPER_SNAKE UsgTemplateId, modality+bodyPart on
// structured templates). A pack keys by region name (the single source of truth
// at report time — matchStudyRegion) and stores the others explicitly.

export function slug(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Pack id = `{modality}.{slug(region)}` — e.g. "mri.brain", "usg.whole_abdomen". */
export function packIdFor(modality: string, region: string): string {
  return `${slug(modality)}.${slug(region)}`;
}

// ── Manifest (the manifest_json blob) ─────────────────────────────────────────
// Declarative pack-level content that does NOT have a dedicated live table today.
// Everything else (findings/protocols/history/measurements/impression-rules/
// templates/teaching/knowledge) is referenced by key and assembled live.

export interface PackManifest {
  /** Copilot module ids this pack activates (registered in copilotModules.ts). */
  copilotModules: string[];
  /** Companion follow-up prompts (e.g. "Stone → hydronephrosis? level? size?"). */
  companionRules: string[];
  /** Measurement labels the previous-comparison engine should track for this study. */
  comparisonMeasurements: string[];
  /** Critical-finding watch terms for this study. */
  criticalFindings: string[];
  /** Rule-based recommendation phrases (e.g. "MRI correlation", "Follow-up CT"). */
  recommendations: string[];
  /** Deterministic quality/reporting rules (free-text, admin-editable). */
  qualityRules: string[];
  /**
   * Gold-Standard sections that are clinically not-applicable to this study and
   * should be excluded from the readiness denominator (and not flagged as
   * missing). Purpose: descriptive modalities — e.g. most plain radiographs —
   * legitimately carry no measurements; forcing them would misrepresent
   * "Clinical Readiness". Must be a subset of PACK_SECTIONS; defaults to empty
   * so MRI/USG/CT packs behave exactly as before.
   */
  notApplicableSections: string[];
  /** Normal-value references (label → normal range text). */
  normalValues: { label: string; value: string }[];
  reportingNotes: string;
  references: string[];
  teachingNotes: string;
}

export function emptyManifest(): PackManifest {
  return {
    copilotModules: [], companionRules: [], comparisonMeasurements: [], criticalFindings: [],
    recommendations: [], qualityRules: [], notApplicableSections: [], normalValues: [], reportingNotes: "", references: [], teachingNotes: "",
  };
}

export function parseManifest(json: string | null | undefined): PackManifest {
  const base = emptyManifest();
  if (!json) return base;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object") return base;
    const o = v as Record<string, unknown>;
    const arr = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : []);
    return {
      copilotModules: arr(o.copilotModules),
      companionRules: arr(o.companionRules),
      comparisonMeasurements: arr(o.comparisonMeasurements),
      criticalFindings: arr(o.criticalFindings),
      recommendations: arr(o.recommendations),
      qualityRules: arr(o.qualityRules),
      // Keep only recognized section names so a typo can never silently exclude a real section from scoring.
      notApplicableSections: arr(o.notApplicableSections).filter((s) => (PACK_SECTIONS as readonly string[]).includes(s)),
      normalValues: Array.isArray(o.normalValues)
        ? (o.normalValues as unknown[]).map((n) => {
            const r = (n ?? {}) as Record<string, unknown>;
            return { label: String(r.label ?? ""), value: String(r.value ?? "") };
          }).filter((n) => n.label)
        : [],
      reportingNotes: typeof o.reportingNotes === "string" ? o.reportingNotes : "",
      references: arr(o.references),
      teachingNotes: typeof o.teachingNotes === "string" ? o.teachingNotes : "",
    };
  } catch {
    return base;
  }
}

// ── Live coverage (assembled by the route from existing tables) ───────────────


// ── Universal Measurement Registry resolution (Step 7) ───────────────────────
// Packs keep describing WHICH measurements they care about as strings in their
// manifest (backward compatible), but consumers resolve those strings through
// the Universal Measurement Registry so packs never re-define WHAT a
// measurement means. Unresolved labels are surfaced (admin impact analysis +
// pack validation) instead of silently treated as new measurement identities.

import { resolveMeasurement } from "@workspace/measurements";

export interface ResolvedPackMeasurement {
  /** The manifest's original string. */
  label: string;
  /** Canonical registry id, when the label resolves (e.g. "CBD"). */
  measurementId: string | null;
  /** Canonical display name for UI, when resolved. */
  displayName: string | null;
}

/** Resolve a pack manifest's comparisonMeasurements to canonical identities. */
export function resolvePackMeasurements(manifest: PackManifest): ResolvedPackMeasurement[] {
  return manifest.comparisonMeasurements.map((label) => {
    const r = resolveMeasurement(label);
    return {
      label,
      measurementId: r?.definition.id ?? null,
      displayName: r?.definition.displayName ?? null,
    };
  });
}

export interface PackCoverage {
  hasTemplate: boolean;
  quickFindings: number;
  structuredFindings: number;   // quick findings carrying questionsJson (structured follow-ups)
  protocols: number;
  clinicalHistory: number;
  quickMeasurements: number;
  requiredMeasurements: number;
  checklistProtocols: number;   // protocols carrying a checklist
  impressionRules: number;
  structuredTemplates: number;
  teachingCases: number;
  knowledgeArticles: number;
}

export function emptyCoverage(): PackCoverage {
  return {
    hasTemplate: false, quickFindings: 0, structuredFindings: 0, protocols: 0, clinicalHistory: 0,
    quickMeasurements: 0, requiredMeasurements: 0, checklistProtocols: 0, impressionRules: 0,
    structuredTemplates: 0, teachingCases: 0, knowledgeArticles: 0,
  };
}

// ── Validator ─────────────────────────────────────────────────────────────────

export type PackStatus = "enabled" | "disabled" | "placeholder" | "planned";
export type PackHealth = "ok" | "warn" | "error" | "placeholder" | "disabled";

export interface PackValidationIssue {
  section: string;
  severity: "error" | "warn" | "info";
  message: string;
}

export interface PackValidationResult {
  health: PackHealth;
  ok: boolean;
  issues: PackValidationIssue[];
  /** How many of the standard sections are present (live content or manifest). */
  coveredSections: number;
  totalSections: number;
  /** Gold-standard completion for this pack: coveredSections / totalSections. */
  readinessPercent: number;
  /** Section-by-section presence (drives the validation report). */
  sections: Record<string, boolean>;
}

export interface PackForValidation {
  packId: string;
  status: PackStatus | string;
  modality: string;
  dependsOn: string[];
  manifest: PackManifest;
}

/** The 15 sections a fully-populated Gold-Standard pack covers. */
export const PACK_SECTIONS = [
  "template", "protocol", "clinicalHistory", "quickFindings", "structuredFindings",
  "measurements", "checklist", "companion", "copilot", "recommendations",
  "previousComparison", "criticalFindings", "teaching", "knowledge", "references",
] as const;

/** Per-section presence, from live coverage + the pack manifest. */
export function packSections(coverage: PackCoverage, manifest: PackManifest): Record<string, boolean> {
  return {
    template: coverage.hasTemplate,
    protocol: coverage.protocols > 0,
    clinicalHistory: coverage.clinicalHistory > 0,
    quickFindings: coverage.quickFindings > 0,
    structuredFindings: coverage.structuredFindings > 0,
    measurements: coverage.quickMeasurements > 0 || coverage.requiredMeasurements > 0,
    checklist: coverage.checklistProtocols > 0,
    companion: coverage.structuredFindings > 0 || manifest.companionRules.length > 0,
    copilot: coverage.impressionRules > 0 || manifest.copilotModules.length > 0,
    recommendations: coverage.protocols > 0 || manifest.recommendations.length > 0,
    previousComparison: manifest.comparisonMeasurements.length > 0,
    criticalFindings: manifest.criticalFindings.length > 0,
    teaching: coverage.teachingCases > 0,
    knowledge: coverage.knowledgeArticles > 0 || manifest.normalValues.length > 0,
    references: manifest.references.length > 0,
  };
}

export function coveredSectionCount(coverage: PackCoverage, manifest: PackManifest): number {
  return Object.values(packSections(coverage, manifest)).filter(Boolean).length;
}

/**
 * Validate a pack against its live coverage. Deterministic + explainable.
 * Placeholder/planned/disabled packs are intentionally not required to have
 * content. Enabled packs warn on missing recommended sections and error only
 * when a dependency is missing or an enabled pack is entirely empty.
 */
const SECTION_SEVERITY: Record<string, "warn" | "info"> = {
  template: "warn", protocol: "warn", quickFindings: "warn", criticalFindings: "warn",
  clinicalHistory: "info", structuredFindings: "info", measurements: "info", checklist: "info",
  companion: "info", copilot: "info", recommendations: "info", previousComparison: "info",
  teaching: "info", knowledge: "info", references: "info",
};

export function validatePack(
  pack: PackForValidation,
  coverage: PackCoverage,
  knownPackIds: Set<string>,
): PackValidationResult {
  const issues: PackValidationIssue[] = [];
  const sections = packSections(coverage, pack.manifest);
  // Sections a pack declares clinically not-applicable (e.g. measurements on a
  // descriptive radiograph) are excluded from scoring so readiness reflects
  // what the study SHOULD have, not a fixed 15.
  const na = new Set(pack.manifest.notApplicableSections ?? []);
  const applicable = PACK_SECTIONS.filter((s) => !na.has(s));
  const covered = applicable.filter((s) => sections[s]).length;
  const total = applicable.length;
  const readinessPercent = total > 0 ? Math.round((covered / total) * 100) : 100;
  const base = (health: PackHealth): PackValidationResult =>
    ({ health, ok: health !== "error", issues, coveredSections: covered, totalSections: total, readinessPercent, sections });

  // Dependencies must resolve regardless of status.
  for (const dep of pack.dependsOn) {
    if (!knownPackIds.has(dep)) {
      issues.push({ section: "dependencies", severity: "error", message: `Missing dependency pack "${dep}".` });
    }
  }

  if (pack.status === "placeholder" || pack.status === "planned") {
    issues.push({ section: "content", severity: "info", message: "Placeholder pack — awaiting Gold-Standard content." });
    return base(issues.some((i) => i.severity === "error") ? "error" : "placeholder");
  }
  if (pack.status === "disabled") return base("disabled");

  // Enabled pack — one issue per missing APPLICABLE section (warn for core, info for the rest).
  for (const section of applicable) {
    if (!sections[section]) {
      issues.push({ section, severity: SECTION_SEVERITY[section] ?? "info", message: `${section} not defined for this pack.` });
    }
  }
  if (covered === 0) issues.push({ section: "content", severity: "error", message: "Enabled pack has no content in any section." });

  const health: PackHealth = issues.some((i) => i.severity === "error")
    ? "error"
    : issues.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";
  return base(health);
}

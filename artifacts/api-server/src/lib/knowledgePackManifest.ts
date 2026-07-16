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
  /** Measurement labels the previous-comparison engine should track for this study. */
  comparisonMeasurements: string[];
  /** Critical-finding watch terms for this study. */
  criticalFindings: string[];
  /** Deterministic quality/reporting rules (free-text, admin-editable). */
  qualityRules: string[];
  /** Normal-value references (label → normal range text). */
  normalValues: { label: string; value: string }[];
  reportingNotes: string;
  references: string[];
  teachingNotes: string;
}

export function emptyManifest(): PackManifest {
  return {
    copilotModules: [], comparisonMeasurements: [], criticalFindings: [],
    qualityRules: [], normalValues: [], reportingNotes: "", references: [], teachingNotes: "",
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
      comparisonMeasurements: arr(o.comparisonMeasurements),
      criticalFindings: arr(o.criticalFindings),
      qualityRules: arr(o.qualityRules),
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

export interface PackCoverage {
  hasTemplate: boolean;
  quickFindings: number;
  protocols: number;
  clinicalHistory: number;
  quickMeasurements: number;
  requiredMeasurements: number;
  impressionRules: number;
  structuredTemplates: number;
  teachingCases: number;
  knowledgeArticles: number;
}

export function emptyCoverage(): PackCoverage {
  return {
    hasTemplate: false, quickFindings: 0, protocols: 0, clinicalHistory: 0,
    quickMeasurements: 0, requiredMeasurements: 0, impressionRules: 0,
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
  /** How many of the standard sections have live content. */
  coveredSections: number;
  totalSections: number;
}

export interface PackForValidation {
  packId: string;
  status: PackStatus | string;
  modality: string;
  dependsOn: string[];
  manifest: PackManifest;
}

/** Standard sections a fully-populated Gold-Standard pack covers. */
export const PACK_SECTIONS = [
  "template", "protocol", "quickFindings", "clinicalHistory",
  "measurements", "impressionRules", "teaching", "knowledge",
] as const;

export function coveredSectionCount(coverage: PackCoverage): number {
  let n = 0;
  if (coverage.hasTemplate) n++;
  if (coverage.protocols > 0) n++;
  if (coverage.quickFindings > 0) n++;
  if (coverage.clinicalHistory > 0) n++;
  if (coverage.quickMeasurements > 0 || coverage.requiredMeasurements > 0) n++;
  if (coverage.impressionRules > 0) n++;
  if (coverage.teachingCases > 0) n++;
  if (coverage.knowledgeArticles > 0) n++;
  return n;
}

/**
 * Validate a pack against its live coverage. Deterministic + explainable.
 * Placeholder/planned/disabled packs are intentionally not required to have
 * content. Enabled packs warn on missing recommended sections and error only
 * when a dependency is missing or an enabled pack is entirely empty.
 */
export function validatePack(
  pack: PackForValidation,
  coverage: PackCoverage,
  knownPackIds: Set<string>,
): PackValidationResult {
  const issues: PackValidationIssue[] = [];
  const covered = coveredSectionCount(coverage);
  const total = PACK_SECTIONS.length;

  // Dependencies must resolve regardless of status.
  for (const dep of pack.dependsOn) {
    if (!knownPackIds.has(dep)) {
      issues.push({ section: "dependencies", severity: "error", message: `Missing dependency pack "${dep}".` });
    }
  }

  if (pack.status === "placeholder" || pack.status === "planned") {
    issues.push({ section: "content", severity: "info", message: "Placeholder pack — awaiting Gold-Standard content." });
    const health: PackHealth = issues.some((i) => i.severity === "error") ? "error" : "placeholder";
    return { health, ok: health !== "error", issues, coveredSections: covered, totalSections: total };
  }

  if (pack.status === "disabled") {
    return { health: "disabled", ok: true, issues, coveredSections: covered, totalSections: total };
  }

  // Enabled pack — check recommended sections.
  if (!coverage.hasTemplate) issues.push({ section: "template", severity: "warn", message: "No report template resolves for this study type." });
  if (coverage.protocols === 0) issues.push({ section: "protocol", severity: "warn", message: "No protocol defined for this study type." });
  if (coverage.quickFindings === 0) issues.push({ section: "quickFindings", severity: "warn", message: "No quick findings defined." });
  if (coverage.clinicalHistory === 0) issues.push({ section: "clinicalHistory", severity: "info", message: "No clinical-history chips defined." });
  if (coverage.quickMeasurements === 0 && coverage.requiredMeasurements === 0) issues.push({ section: "measurements", severity: "info", message: "No measurements or required-measurement checklist defined." });
  if (coverage.impressionRules === 0) issues.push({ section: "impressionRules", severity: "info", message: "No rule-based impression rules defined." });
  if (coverage.teachingCases === 0) issues.push({ section: "teaching", severity: "info", message: "No teaching cases linked." });
  if (coverage.knowledgeArticles === 0) issues.push({ section: "knowledge", severity: "info", message: "No knowledge-base articles linked." });

  if (covered === 0) issues.push({ section: "content", severity: "error", message: "Enabled pack has no live content in any section." });

  const health: PackHealth = issues.some((i) => i.severity === "error")
    ? "error"
    : issues.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";
  return { health, ok: health !== "error", issues, coveredSections: covered, totalSections: total };
}

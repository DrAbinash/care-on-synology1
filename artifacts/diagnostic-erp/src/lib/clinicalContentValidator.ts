/**
 * clinicalContentValidator.ts — the Clinical Content Validator (pure lib).
 *
 * "The ESLint of the CARE Reporting Platform": read-only analysis of clinical
 * content that NEVER affects runtime. It aggregates the platform's EXISTING
 * validators instead of duplicating them —
 *
 *   • Knowledge-Pack issues come from the pack engine's validatePack()
 *     (via GET /api/radiology/knowledge-packs/coverage) — passed through.
 *   • Measurement issues come from the Measurement Registry's own validation
 *     (GET /api/measurement-registry/validation) — passed through.
 *   • Recommendation-registry and CROSS-registry checks (duplicates, broken
 *     references, orphans, status/content mismatches) are implemented HERE,
 *     once — this lib is their single home.
 *
 * Health scoring penalties are data (parameter), not hardcoded.
 */
import {
  CLINICAL_RECOMMENDATION_REGISTRY,
  type ClinicalRecommendation,
} from "./clinicalRecommendations";
import type { CoverageRow } from "./clinicalCoverage";

export type FindingSeverity = "error" | "warn" | "info";

export interface ContentFinding {
  /** Stable machine code, e.g. rec.broken-pack-ref */
  code: string;
  severity: FindingSeverity;
  /** Which registry/area the finding belongs to. */
  area: "knowledge-pack" | "recommendation" | "measurement" | "cross-registry";
  /** The offending object (pack id, recommendation id, label…). */
  subject: string;
  message: string;
  /** Suggested fix — always actionable, never vague. */
  fix?: string;
  /** Where the check ran (this lib, pack validator, measurement registry). */
  source: "content-validator" | "pack-validator" | "measurement-registry";
}

// ── Recommendation Registry validation (single home for these checks) ────────

const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);
const VALID_PRIORITIES = new Set(["routine", "urgent", "immediate"]);
const VALID_EVIDENCE = new Set(["guideline", "consensus", "local-policy"]);

export function validateRecommendationRegistry(
  registry: ClinicalRecommendation[] = CLINICAL_RECOMMENDATION_REGISTRY,
  knownPackIds?: Set<string>,
): ContentFinding[] {
  const out: ContentFinding[] = [];
  const seenIds = new Map<string, number>();
  const triggerSigs = new Map<string, string>();

  for (const r of registry) {
    seenIds.set(r.id, (seenIds.get(r.id) ?? 0) + 1);

    if (!/^rec\./.test(r.id)) {
      out.push({ code: "rec.bad-id", severity: "error", area: "recommendation", subject: r.id, source: "content-validator", message: `Recommendation id "${r.id}" is not hierarchical (rec.*).`, fix: "Rename to rec.<modality|scope>.<slug>." });
    }
    if (!/^\d+\.\d+\.\d+$/.test(r.version)) {
      out.push({ code: "rec.bad-version", severity: "error", area: "recommendation", subject: r.id, source: "content-validator", message: `Version "${r.version}" is not semver.`, fix: "Use MAJOR.MINOR.PATCH." });
    }
    if (!VALID_SEVERITIES.has(r.severity)) {
      out.push({ code: "rec.bad-severity", severity: "error", area: "recommendation", subject: r.id, source: "content-validator", message: `Unknown severity "${r.severity}".`, fix: "Use info | warning | critical." });
    }
    if (!VALID_PRIORITIES.has(r.priority)) {
      out.push({ code: "rec.bad-priority", severity: "error", area: "recommendation", subject: r.id, source: "content-validator", message: `Unknown priority "${r.priority}".`, fix: "Use routine | urgent | immediate." });
    }
    if (!VALID_EVIDENCE.has(r.evidenceLevel)) {
      out.push({ code: "rec.bad-evidence", severity: "warn", area: "recommendation", subject: r.id, source: "content-validator", message: `Unknown evidence level "${r.evidenceLevel}".` });
    }
    if (!r.followUp.action.trim() || !r.rationale.trim()) {
      out.push({ code: "rec.incomplete", severity: "error", area: "recommendation", subject: r.id, source: "content-validator", message: "Missing follow-up action or rationale.", fix: "Every recommendation must state its action and why." });
    }
    const anchored = r.knowledgePackRefs.length || r.qualityRuleRefs.length || r.measurementRefs.length || r.trigger.kind === "condition";
    if (!anchored) {
      out.push({ code: "rec.orphan", severity: "warn", area: "recommendation", subject: r.id, source: "content-validator", message: "Orphan recommendation: anchors to no pack, quality rule, measurement or graded condition.", fix: "Add knowledgePackRefs / qualityRuleRefs / measurementRefs." });
    }
    if (knownPackIds) {
      for (const ref of r.knowledgePackRefs) {
        if (!knownPackIds.has(ref)) {
          out.push({ code: "rec.broken-pack-ref", severity: "error", area: "recommendation", subject: r.id, source: "content-validator", message: `References unknown Knowledge Pack "${ref}".`, fix: "Fix the pack id or add the pack." });
        }
      }
    }
    for (const ref of r.qualityRuleRefs) {
      if (!/^(Q\d{3}|care\.)/.test(ref)) {
        out.push({ code: "rec.bad-rule-ref", severity: "warn", area: "recommendation", subject: r.id, source: "content-validator", message: `Quality-rule reference "${ref}" is neither Q### nor care.* — cannot belong to the rule catalog.`, fix: "Use the catalog id (legacy Q### or canonical care.*)." });
      }
    }
    if (r.trigger.kind === "measurement") {
      for (const l of r.trigger.labels) for (const m of r.modalities) {
        const sig = `${l.toLowerCase()}|${r.trigger.comparator}|${m}`;
        const prev = triggerSigs.get(sig);
        if (prev && prev !== r.id) {
          out.push({ code: "rec.conflicting-trigger", severity: "error", area: "recommendation", subject: r.id, source: "content-validator", message: `Conflicting trigger with ${prev} on (${l} ${r.trigger.comparator} · ${m}) — two recommendations would fire on the same threshold direction.`, fix: "Merge the entries or split thresholds/modalities." });
        }
        triggerSigs.set(sig, r.id);
      }
    }
  }
  for (const [id, n] of seenIds) {
    if (n > 1) {
      out.push({ code: "rec.duplicate-id", severity: "error", area: "recommendation", subject: id, source: "content-validator", message: `Recommendation id declared ${n} times.`, fix: "Ids must be unique." });
    }
  }
  return out;
}

// ── Cross-registry checks over the pack coverage rows ────────────────────────

export function validatePackRegistry(rows: CoverageRow[]): ContentFinding[] {
  const out: ContentFinding[] = [];
  const byId = new Map<string, number>();
  const byStudy = new Map<string, string[]>();

  for (const r of rows) {
    byId.set(r.packId, (byId.get(r.packId) ?? 0) + 1);
    if (r.studyType) {
      const k = `${r.modality}|${r.studyType.toLowerCase()}`;
      byStudy.set(k, [...(byStudy.get(k) ?? []), r.packId]);
    }
    const coveredCount = Object.values(r.sections).filter(Boolean).length;
    if (r.status === "enabled" && coveredCount === 0) {
      out.push({ code: "pack.enabled-empty", severity: "error", area: "knowledge-pack", subject: r.packId, source: "content-validator", message: "Enabled pack has no content in any section (orphan pack).", fix: "Seed content or set status back to placeholder." });
    }
    if (r.status === "placeholder" && coveredCount >= 8) {
      out.push({ code: "pack.placeholder-rich", severity: "info", area: "knowledge-pack", subject: r.packId, source: "content-validator", message: `Placeholder pack already covers ${coveredCount} sections — status/content mismatch.`, fix: "Review and enable the pack." });
    }
  }
  for (const [id, n] of byId) {
    if (n > 1) out.push({ code: "pack.duplicate-id", severity: "error", area: "knowledge-pack", subject: id, source: "content-validator", message: `Pack id appears ${n} times.`, fix: "Pack ids must be unique." });
  }
  for (const [key, ids] of byStudy) {
    if (ids.length > 1) {
      out.push({ code: "pack.duplicate-study", severity: "warn", area: "knowledge-pack", subject: ids.join(", "), source: "content-validator", message: `Multiple packs claim the same study "${key.split("|")[1]}" (${key.split("|")[0]}).`, fix: "One pack per (modality, studyType); merge or disambiguate." });
    }
  }
  return out;
}

/** Pass-through of the pack engine's own validatePack() issues — reused, not duplicated. */
export function passthroughPackIssues(rows: CoverageRow[]): ContentFinding[] {
  const out: ContentFinding[] = [];
  for (const r of rows) {
    for (const i of r.issues ?? []) {
      const severity: FindingSeverity = i.severity === "error" ? "error" : i.severity === "warn" ? "warn" : "info";
      out.push({ code: `pack.${i.section}`, severity, area: "knowledge-pack", subject: r.packId, source: "pack-validator", message: i.message });
    }
  }
  return out;
}

/** Pass-through of the Measurement Registry's own validation payload. */
export interface MeasurementValidationPayload {
  healthy: boolean;
  registryIssues: string[];
  unresolvedLabels: string[];
  unreferencedMeasurements: string[];
}

export function passthroughMeasurementIssues(v: MeasurementValidationPayload | null | undefined): ContentFinding[] {
  if (!v) return [];
  const out: ContentFinding[] = [];
  for (const msg of v.registryIssues ?? []) {
    out.push({ code: "meas.registry-issue", severity: "error", area: "measurement", subject: "measurement-registry", source: "measurement-registry", message: msg });
  }
  for (const label of v.unresolvedLabels ?? []) {
    out.push({ code: "meas.unresolved-label", severity: "warn", area: "measurement", subject: label, source: "measurement-registry", message: `Live content label "${label}" does not resolve to a registry measurement.`, fix: "Add the measurement or fix the label." });
  }
  for (const id of v.unreferencedMeasurements ?? []) {
    out.push({ code: "meas.unreferenced", severity: "info", area: "measurement", subject: id, source: "measurement-registry", message: "Registry measurement is referenced by no live content (unused).", fix: "Reference it from content or deprecate it." });
  }
  return out;
}

// ── Health score + report (penalties are data) ───────────────────────────────

export const DEFAULT_PENALTIES: Record<FindingSeverity, number> = { error: 10, warn: 3, info: 0.5 };

export function healthScore(
  findings: ContentFinding[],
  penalties: Record<FindingSeverity, number> = DEFAULT_PENALTIES,
): number {
  const penalty = findings.reduce((s, f) => s + (penalties[f.severity] ?? 0), 0);
  return Math.max(0, Math.round(100 - penalty));
}

export interface ContentValidationReport {
  healthScore: number;
  totals: Record<FindingSeverity, number>;
  byArea: Record<string, number>;
  findings: ContentFinding[];
}

export function buildReport(
  findings: ContentFinding[],
  penalties: Record<FindingSeverity, number> = DEFAULT_PENALTIES,
): ContentValidationReport {
  const totals: Record<FindingSeverity, number> = { error: 0, warn: 0, info: 0 };
  const byArea: Record<string, number> = {};
  for (const f of findings) {
    totals[f.severity]++;
    byArea[f.area] = (byArea[f.area] ?? 0) + 1;
  }
  const order: Record<FindingSeverity, number> = { error: 0, warn: 1, info: 2 };
  return {
    healthScore: healthScore(findings, penalties),
    totals,
    byArea,
    findings: [...findings].sort((a, b) => order[a.severity] - order[b.severity] || a.area.localeCompare(b.area) || a.subject.localeCompare(b.subject)),
  };
}

/** Exportable Markdown report (Step 10). */
export function reportToMarkdown(report: ContentValidationReport, generatedAt: string): string {
  const lines = [
    "# CARE Clinical Content Validation Report",
    "",
    `Generated: ${generatedAt}`,
    `Health score: **${report.healthScore}/100**`,
    `Findings: ${report.totals.error} errors · ${report.totals.warn} warnings · ${report.totals.info} info`,
    "",
    "| Severity | Area | Subject | Message | Suggested fix | Source |",
    "|---|---|---|---|---|---|",
  ];
  for (const f of report.findings) {
    lines.push(`| ${f.severity} | ${f.area} | ${f.subject} | ${f.message.replace(/\|/g, "\\|")} | ${(f.fix ?? "—").replace(/\|/g, "\\|")} | ${f.source} |`);
  }
  return lines.join("\n");
}

/**
 * copilotRecommendationModule.ts — clinical-recommendation Copilot module.
 *
 * Consumes the shared Clinical Recommendation Registry — it does NOT define any
 * recommendation of its own (no Copilot V2, no second engine). It feeds the
 * registry's pure `matchRecommendations()` lookup with data the workspace
 * ALREADY threads through CopilotContext (accepted viewer measurements,
 * previous-comparison significant changes, report text) and surfaces matches as
 * advisories whose `why` explains WHY — rationale, evidence level, references —
 * never silently asserting WHAT to write. The radiologist decides; the optional
 * insertText is advisory, exactly like every other module.
 *
 * Registered on import, pure, alias-free — same pattern as the comparison,
 * measurement-completeness and critical-results modules.
 */
import type { CopilotContext, CopilotItem, Severity } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { matchRecommendations, type RecommendationMatch } from "./clinicalRecommendations";

function toSeverity(rec: RecommendationMatch["recommendation"]): Severity {
  if (rec.severity === "critical") return "critical";
  if (rec.severity === "warning") return "warning";
  return "info";
}

export function recommendationModuleItems(ctx: CopilotContext): CopilotItem[] {
  const matches = matchRecommendations({
    modality: ctx.modality,
    measurements: (ctx.viewerMeasurements ?? []).map((m) => ({
      label: m.label, value: m.value, unit: m.unit,
    })),
    reportText: `${ctx.findings}\n${ctx.impression.join("\n")}`,
    priorChanges: ctx.prior?.significantChanges ?? [],
  });

  return matches.map((m): CopilotItem => {
    const r = m.recommendation;
    const refs = r.references.length ? ` References: ${r.references.join("; ")}.` : "";
    const contra = r.contraindications.length ? ` Caveats: ${r.contraindications.join("; ")}.` : "";
    return {
      id: `recommendation:${r.id}`,
      category: "recommendation",
      severity: toSeverity(r),
      title: r.title,
      detail: `Matched because ${m.matchedBecause}. Suggested follow-up: ${r.followUp.action} (${r.followUp.interval}).`,
      why: `${r.rationale} Evidence: ${r.evidenceLevel}.${refs}${contra} Registry entry ${r.id} v${r.version} — the Copilot explains why; you decide what the report says.`,
      confidence: "high",
      insertText: `${r.followUp.action} (${r.followUp.interval}) is suggested.`,
      insertTarget: "recommendation",
    };
  });
}

registerCopilotModule({
  id: "clinical-recommendations",
  label: "Clinical recommendations (registry)",
  kind: "local",
  analyze: recommendationModuleItems,
});

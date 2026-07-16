/**
 * copilotUsgObstetricModule.ts — Obstetric USG Copilot module
 * (PR B — USG Platform Consolidation, §12). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import. Gated on modality + study
 * description so it contributes nothing for MRI/CT or non-obstetric USG.
 *
 * The PCPNDT reminder below is deliberately non-blocking: per the prior
 * architecture audit (docs/usg-reporting-audit/09-implementation-roadmap.md,
 * Phase 4) the canonical RadiologyReportingWorkspace has no PCPNDT Form F
 * gate today (only the legacy, nav-disconnected UsgReporting.tsx enforces it
 * server-side), and reconciling that is flagged as the single highest-stakes
 * decision in this whole area — deliberately deferred, not silently ignored.
 * This module makes the gap VISIBLE inside the workspace radiologists
 * actually use, using the existing Copilot panel, without adding a second
 * finalize pipeline or blocking the shared finalize path.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const OBSTETRIC_STUDY = /obstet|pregnan|fetal|gestation|nuchal|nt\s*scan|anomaly\s*scan|growth\s*scan|tiffa/i;

export function usgObstetricModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!OBSTETRIC_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (!/\bga\b|gestational\s+age|\bedd\b|weeks?\s*\+?\s*\d|\d+\s*w(eeks)?\s*\d*\s*d(ays)?/i.test(combined)) {
    items.push({
      id: "usg-ob:ga-missing",
      category: "missing",
      severity: "warning",
      title: "Gestational age / EDD not stated",
      detail: "Neither the findings nor the impression states a gestational age or EDD.",
      why: "GA/EDD is the single most safety-critical statement on an obstetric ultrasound report.",
      confidence: "medium",
    });
  }

  if (!/placenta/i.test(combined)) {
    items.push({
      id: "usg-ob:placenta-missing",
      category: "missing",
      severity: "info",
      title: "Placental location not mentioned",
      detail: "Placental location/grade is not mentioned in the report.",
      why: "Placental location (including exclusion of previa) is a standard component of obstetric reporting after the first trimester.",
      confidence: "low",
    });
  }

  if (!/liquor|amniotic\s+fluid|\bafi\b/i.test(combined)) {
    items.push({
      id: "usg-ob:liquor-missing",
      category: "missing",
      severity: "info",
      title: "Liquor / AFI not mentioned",
      detail: "Amniotic fluid volume (liquor / AFI) is not mentioned in the report.",
      why: "Liquor volume assessment is a standard component of growth and anomaly scans.",
      confidence: "low",
    });
  }

  // Non-blocking PCPNDT visibility — always fires for an obstetric USG study,
  // regardless of report content, since the canonical workspace's finalize
  // path does not check this today (see module header comment).
  items.push({
    id: "usg-ob:pcpndt",
    category: "recommendation",
    severity: "warning",
    title: "PCPNDT Form F compliance",
    detail:
      "This is an obstetric ultrasound. Verify the patient's PCPNDT Form F record (ID card, husband/father name, address, consent/procedure date) is complete before finalizing — the workspace does not check this automatically today. Use \"Review & Map to Form F\" or /form-f.",
    why: "PCPNDT Form F is a statutory pre-natal diagnostic technique compliance requirement for obstetric ultrasound in India; the legacy USG reporting page enforces it server-side, but the canonical workspace does not yet.",
    confidence: "high",
  });

  return items;
}

registerCopilotModule({
  id: "usg-obstetric",
  label: "USG Obstetric advisor",
  kind: "local",
  analyze: usgObstetricModuleItems,
});

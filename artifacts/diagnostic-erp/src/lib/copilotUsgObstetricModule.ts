/**
 * copilotUsgObstetricModule.ts — Obstetric USG Copilot module
 * (PR B — USG Platform Consolidation, §12). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import. Gated on modality + study
 * description so it contributes nothing for MRI/CT or non-obstetric USG.
 *
 * The PCPNDT reminder below is one of TWO layers, not the whole guard: the
 * canonical RadiologyReportingWorkspace's finalizeReport() now also HARD-BLOCKS
 * finalize for the same obstetric/fetal classification (see
 * isObstetricUsgStudy() in ./usgModality.ts, consumed directly by the
 * workspace — a Copilot reminder alone is advisory and was found insufficient
 * on its own). This module keeps the gap's regulatory context visible in the
 * panel; the workspace is what actually prevents an unsafe finalize. See
 * docs/usg-reporting/platform-consolidation-pr-b.md §17-18.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isObstetricUsgStudy } from "./usgModality";

export function usgObstetricModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isObstetricUsgStudy(ctx.modality, ctx.studyDescription)) return [];

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

  // Always fires for an obstetric USG study, regardless of report content —
  // this is the SAME classification finalizeReport() uses to hard-block
  // finalize in this workspace (see module header comment).
  items.push({
    id: "usg-ob:pcpndt",
    category: "recommendation",
    severity: "warning",
    title: "PCPNDT Form F compliance",
    detail:
      "This is an obstetric ultrasound. Finalize is blocked in this workspace until it is completed through the PCPNDT Form F-compliant USG Reporting page. Use \"Review & Map to Form F\" below, then finalize via USG Reporting (legacy) or /form-f.",
    why: "PCPNDT Form F is a statutory pre-natal diagnostic technique compliance requirement for obstetric ultrasound in India; only the legacy USG Reporting page enforces it server-side today.",
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

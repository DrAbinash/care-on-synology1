/**
 * copilotUsgDopplerModule.ts — Doppler USG Copilot module
 * (PR B — USG Platform Consolidation, §12 / §16). Plugs into the EXISTING
 * Copilot registry (`copilotModules.ts`, PR #83) — it does not touch the
 * Copilot core.
 *
 * Advisory only, pure, registered on import. The completeness checks below
 * are informed by docs/usg-reporting-audit/06-measurements-and-calculations.md
 * §4 — RI/PI/S-D are independently-typed fields today with no cross-check
 * between them, and S/D is the "simplest of the three... and the one most
 * clearly a low-effort win, but not implemented anywhere." This module does
 * not add a calculation engine (out of scope, see doc 06's own
 * recommendation to finish wiring `structuredReport`'s catalog instead) — it
 * only makes an incomplete Doppler description visible before finalize.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const DOPPLER_CONTEXT = /doppler|\bpsv\b|\bedv\b|resistive\s*index|\bri\b|\bpi\b|s\/d\s*ratio/i;
const HAS_PSV = /\bpsv\b|peak\s+systolic/i;
const HAS_EDV = /\bedv\b|end[-\s]?diastolic/i;
const HAS_RI = /\bri\b|resistive\s*index/i;
const HAS_SD = /s\/d\s*ratio|systolic.?diastolic\s*ratio/i;
const HAS_WAVEFORM = /monophasic|biphasic|triphasic|waveform/i;

export function usgDopplerModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  const combined = `${ctx.studyDescription}\n${ctx.findings}\n${ctx.impression.join("\n")}`;
  if (!DOPPLER_CONTEXT.test(combined)) return [];

  const items: CopilotItem[] = [];
  const hasPsv = HAS_PSV.test(combined);
  const hasEdv = HAS_EDV.test(combined);

  if (hasPsv !== hasEdv) {
    items.push({
      id: "usg-doppler:psv-edv-incomplete",
      category: "missing",
      severity: "warning",
      title: hasPsv ? "EDV not stated alongside PSV" : "PSV not stated alongside EDV",
      detail: "Peak systolic velocity (PSV) and end-diastolic velocity (EDV) are conventionally reported together, but only one is present.",
      why: "RI and S/D ratio are both derived from the PSV/EDV pair; reporting only one makes the velocity data hard to interpret or cross-check.",
      confidence: "medium",
    });
  }

  if (hasPsv && hasEdv && !HAS_RI.test(combined) && !HAS_SD.test(combined)) {
    items.push({
      id: "usg-doppler:derived-index-missing",
      category: "recommendation",
      severity: "info",
      title: "No resistive index or S/D ratio stated",
      detail: "PSV and EDV are both reported, but neither the resistive index (RI) nor the S/D ratio is stated.",
      why: "RI = (PSV − EDV) / PSV and S/D = PSV / EDV are simple, standard derived indices reviewers expect alongside raw velocities.",
      confidence: "low",
    });
  }

  if (!HAS_WAVEFORM.test(combined)) {
    items.push({
      id: "usg-doppler:waveform-missing",
      category: "missing",
      severity: "info",
      title: "Waveform pattern not described",
      detail: "The waveform pattern (e.g. monophasic / biphasic / triphasic) is not described.",
      why: "Waveform morphology is part of a complete Doppler description, especially for arterial studies.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-doppler",
  label: "USG Doppler advisor",
  kind: "local",
  analyze: usgDopplerModuleItems,
});

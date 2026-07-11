/**
 * abnormalityEngine.ts — Abnormality-Driven Reporting Engine (Phase 4).
 *
 * Every selected abnormality is a structured clinical object — ONE internal
 * instance with properties (side, severity, chronicity, level, measurement)
 * — that renders into Findings / Impression / Technique / Recommendation
 * sentences. Changing any property re-renders the instance; the workspace
 * then exact-replaces the previously generated sentences, so the whole
 * report updates instantly while manual edits are never overwritten
 * (an edited generated sentence no longer matches exactly, so replacement
 * skips it and the radiologist's wording wins).
 *
 * Template placeholders (all optional, admin-configurable per button):
 *   {side} {severity} {chronicity} {level} {value}
 * Legacy templates without {side} still adapt laterality via whole-word
 * left/right/bilateral replacement (applySide).
 *
 * Pure, dependency-light, unit-tested (phase4.test.ts).
 */

import { applySide, type Side } from "./sideSwap";

export interface AbnormalityInstance {
  side: Side | "";
  severity: "" | "mild" | "moderate" | "severe";
  chronicity: "" | "acute" | "chronic";
  level: string;      // e.g. "L4-L5"
  value: string;      // measurement value, e.g. "8"
}

export const EMPTY_INSTANCE: AbnormalityInstance = {
  side: "", severity: "", chronicity: "", level: "", value: "",
};

export interface AbnormalityTemplates {
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
}

export interface RenderedAbnormality {
  finding: string;
  impression: string;
  technique: string;
  recommendation: string;
}

/** Renders one template string with an instance's properties. */
export function fillTemplate(template: string, inst: AbnormalityInstance): string {
  if (!template) return "";

  // Empty properties: remove the placeholder together with its natural
  // grammatical chunk so no dangling prepositions remain ("at {level}",
  // "on the {side} side", "measuring {value} mm").
  let t = template;
  if (!inst.level) t = t.replace(/\s*\b(?:at|in|of)\s+\{level\}/gi, "").replace(/\{level\}/g, "");
  if (!inst.value) t = t.replace(/\s*\b(?:measuring|measures)\s+\{value\}\s*(?:mm|cm|cc)?/gi, "").replace(/\{value\}/g, "");
  if (!inst.side) t = t.replace(/\s*\bon\s+the\s+\{side\}\s+side/gi, "").replace(/\{side\}/g, "");

  t = t
    .replace(/\{side\}/g, inst.side)
    .replace(/\{severity\}/g, inst.severity)
    .replace(/\{chronicity\}/g, inst.chronicity)
    .replace(/\{level\}/g, inst.level)
    .replace(/\{value\}/g, inst.value);

  // Legacy laterality: templates written with literal side words (Phase 2
  // seeds) still flip when the instance has a side but no {side} slot.
  if (!/\{side\}/.test(template) && inst.side) {
    t = applySide(t, inst.side);
  }

  // Cleanup: unfilled slots leave gaps — collapse doubled spaces, spaces
  // before punctuation, empty parentheses, and leading "at ." fragments.
  t = t
    .replace(/\(\s*\)/g, "")
    .replace(/\bat\s+([,.])/g, "$1")   // "at ." when {level} empty
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();

  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

/** Renders all four report sections for one abnormality instance. */
export function renderAbnormality(tpl: AbnormalityTemplates, inst: AbnormalityInstance): RenderedAbnormality {
  return {
    finding: fillTemplate(tpl.findingText, inst),
    impression: fillTemplate(tpl.impressionText, inst),
    technique: fillTemplate(tpl.techniqueText, inst),
    recommendation: fillTemplate(tpl.recommendationText, inst),
  };
}

/** Parses the admin-configured comma list of enabled property chips. */
export type PropertyKey = "side" | "severity" | "chronicity" | "level" | "measurement";
const VALID_PROPS: PropertyKey[] = ["side", "severity", "chronicity", "level", "measurement"];

export function parseProperties(raw: string | null | undefined): PropertyKey[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is PropertyKey => (VALID_PROPS as string[]).includes(p));
}

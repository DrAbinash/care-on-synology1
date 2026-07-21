/**
 * usgReportComposer — turns organ sections + structured Finding Objects into the
 * EXISTING canonical draft payload, and back (Phase P0/P1).
 *
 * The dedicated USG workspace persists nothing of its own: an organ section is
 * written into the canonical `findings_sections` JSON as `{ normal, text,
 * findings? }`. The save-draft Zod schema `.passthrough()`es the object variant,
 * so the structured `findings` array rides inside the same canonical column —
 * no parallel store, no second finalized-report format. `impression` is the
 * canonical string[]; `rawFindings` is the flat prose the legacy/plain readers
 * expect. One-click Normal reuses the platform's non-destructive merge helpers.
 */

import { mergeBlock, mergeImpression } from "./quickFindingsMerge";
import { effectiveFindingText, type UsgFindingObject } from "./usgFindingBuilder";

export type OrganStatus = "untouched" | "normal" | "abnormal" | "incomplete";

export interface UsgOrganSection {
  organ: string;                 // organ key
  label: string;                 // organ display label (also the section key)
  normal: boolean;
  text: string;                  // report prose (radiologist-editable)
  findings: UsgFindingObject[];  // structured Finding Objects
}

/** The exact object stored per section inside the canonical `findings_sections`. */
export interface StoredOrganSection {
  normal: boolean;
  text: string;
  findings?: UsgFindingObject[];
}

export function emptySection(organ: string, label: string): UsgOrganSection {
  return { organ, label, normal: false, text: "", findings: [] };
}

/** Derive the organ's rail status from its section state. */
export function organStatus(section: UsgOrganSection): OrganStatus {
  if (section.findings.length > 0) return "abnormal";
  if (section.normal) return "normal";
  if (section.text.trim()) return "abnormal";
  return "untouched";
}

// ── Mutations (all pure — return a new section, never mutate in place) ────────

/** Mark an organ normal: explicit action — sets the baseline normal statement
 *  and clears any structured findings for that organ. */
export function markNormal(section: UsgOrganSection, normalText: string): UsgOrganSection {
  return { ...section, normal: true, findings: [], text: normalText };
}

/** Add a structured finding to an organ, non-destructively appending its prose.
 *  Clears the "normal" baseline first (an abnormality was found). */
export function addFinding(section: UsgOrganSection, obj: UsgFindingObject): UsgOrganSection {
  const base = section.normal ? "" : section.text;   // drop the normal statement
  const text = mergeBlock(base, effectiveFindingText(obj));
  return { ...section, normal: false, findings: [...section.findings, obj], text };
}

/** Remove a structured finding (by index) and rebuild the prose from what
 *  remains — the radiologist's free-text additions outside finding blocks are
 *  preserved only if they were separate paragraphs (mergeBlock semantics). */
export function removeFinding(section: UsgOrganSection, index: number): UsgOrganSection {
  const findings = section.findings.filter((_, i) => i !== index);
  const text = findings.reduce((acc, f) => mergeBlock(acc, effectiveFindingText(f)), "");
  return { ...section, findings, text };
}

/**
 * Normal-all-remaining: fill every still-blank organ with its normal statement.
 * Never touches an organ that is already abnormal or already carries typed text
 * (non-destructive), and de-dupes via the shared merge helper.
 */
export function applyNormalToRemaining(
  sections: UsgOrganSection[],
  normalTextByOrgan: Record<string, string>,
): UsgOrganSection[] {
  return sections.map((s) => {
    if (organStatus(s) === "abnormal") return s;          // never overwrite abnormal
    if (s.text.trim() && !s.normal) return s;             // never overwrite typed text
    const normalText = normalTextByOrgan[s.organ];
    if (!normalText) return s;
    return { ...s, normal: true, text: mergeBlock("", normalText) };
  });
}

// ── Composition into the canonical draft ─────────────────────────────────────

/** Impression bullets from all abnormal organs' finding contributions (deduped). */
export function composeImpression(sections: UsgOrganSection[]): string[] {
  let lines: string[] = [];
  for (const s of sections) {
    for (const f of s.findings) {
      const line = (f.impressionText ?? "").trim();
      if (line) lines = mergeImpression(lines, line);
    }
  }
  return lines;
}

/** The canonical `findings_sections` object (section label → stored section). */
export function composeFindingsSections(sections: UsgOrganSection[]): Record<string, StoredOrganSection> {
  const out: Record<string, StoredOrganSection> = {};
  for (const s of sections) {
    if (organStatus(s) === "untouched") continue;         // don't persist blank organs
    out[s.label] = {
      normal: s.normal,
      text: s.text,
      ...(s.findings.length ? { findings: s.findings } : {}),
    };
  }
  return out;
}

/** Flat prose for the legacy `rawFindings` reader (organ-headed paragraphs). */
export function composeRawFindings(sections: UsgOrganSection[]): string {
  const blocks: string[] = [];
  for (const s of sections) {
    if (organStatus(s) === "untouched") continue;
    const text = s.text.trim();
    if (text) blocks.push(`${s.label.toUpperCase()}: ${text}`);
  }
  return blocks.join("\n");
}

/** Reload: parse a persisted `findings_sections` value back into organ sections. */
export function parseFindingsSections(
  value: string | Record<string, unknown> | null | undefined,
  organLabelToKey: Record<string, string>,
): UsgOrganSection[] {
  let obj: Record<string, unknown> = {};
  if (typeof value === "string") {
    try { obj = JSON.parse(value || "{}"); } catch { obj = {}; }
  } else if (value && typeof value === "object") {
    obj = value as Record<string, unknown>;
  }
  const sections: UsgOrganSection[] = [];
  for (const [label, raw] of Object.entries(obj)) {
    const key = organLabelToKey[label] ?? label;
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      sections.push({
        organ: key,
        label,
        normal: r.normal === true,
        text: typeof r.text === "string" ? r.text : "",
        findings: Array.isArray(r.findings) ? (r.findings as UsgFindingObject[]) : [],
      });
    } else if (typeof raw === "string") {
      // legacy shape: section → plain string
      sections.push({ organ: key, label, normal: false, text: raw, findings: [] });
    }
  }
  return sections;
}

// ── The canonical save-draft payload ─────────────────────────────────────────

export interface UsgDraftPayloadInput {
  draftId?: number | null;
  studyId?: number | null;
  worklistId?: number | null;
  patientId?: number | null;
  templateId?: string | null;
  modality?: string | null;
  studyName?: string | null;
  clinicalHistory?: string | null;
  recommendation?: string | null;
  sections: UsgOrganSection[];
}

/**
 * Build the payload for `POST /api/radiology/report-generator/save-draft`
 * (via `saveRadiologyDraft`). Field names match the canonical draft exactly;
 * `findings: []` because the USG shell persists its structured findings inside
 * `findings_sections`, not the DB-id-keyed quick-select `findings[]` array.
 */
export function buildUsgDraftPayload(input: UsgDraftPayloadInput): Record<string, unknown> {
  return {
    id: input.draftId ?? undefined,
    studyId: input.studyId ?? null,
    worklistId: input.worklistId ?? null,
    patientId: input.patientId ?? null,
    templateId: input.templateId ?? null,
    modality: input.modality ?? null,
    studyName: input.studyName ?? null,
    clinicalHistory: input.clinicalHistory ?? null,
    rawFindings: composeRawFindings(input.sections) || null,
    findingsSections: composeFindingsSections(input.sections),
    impression: composeImpression(input.sections),
    recommendation: input.recommendation ?? null,
    findings: [],
  };
}

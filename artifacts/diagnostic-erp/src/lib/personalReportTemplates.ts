/**
 * Physician-managed personal snippet templates for the reporting cockpit.
 * Stored locally so radiologists can build a library from the UI without
 * touching code or waiting on the full report-format admin flow.
 *
 * Optional `modality` / `region` tags enable study-aware filtering so a
 * Chest XR study preferentially surfaces chest macros (CT Brain stays hidden
 * unless untagged / global). Null / missing tags = usable on every study.
 */

import {
  matchesContentScope,
  type ReportingStudyContext,
} from "@/lib/reportingStudyContext";
import { templateModalityMatches } from "@/lib/radiologyTemplateModality";

export type PersonalTemplateTarget = "findings" | "impression";

export interface PersonalReportTemplate {
  id: string;
  name: string;
  text: string;
  /** Which field this snippet was saved from / prefers to insert into. */
  target: PersonalTemplateTarget;
  createdAt: string;
  /**
   * Worklist / DICOM modality (e.g. "XR", "CT", "MR"). Null / omitted = all studies.
   * Compared via `templateModalityMatches` so MR ≡ MRI.
   */
  modality?: string | null;
  /**
   * `radiology_study_tabs.name` (e.g. "Chest", "Brain"). Null / omitted = all regions.
   * Matched with `matchesContentScope` (includes spine inheritance).
   */
  region?: string | null;
}

export const PERSONAL_TEMPLATES_STORAGE_KEY = "care_personal_report_templates_v1";

const SEED: PersonalReportTemplate[] = [
  {
    id: "seed-normal-chest-xr",
    name: "Normal Chest XR",
    text: "The lungs are clear. Heart size is within normal limits. No pleural effusion or pneumothorax.",
    target: "findings",
    createdAt: "1970-01-01T00:00:00.000Z",
    modality: "XR",
    region: "Chest",
  },
  {
    id: "seed-ct-brain-normal",
    name: "CT Brain Normal",
    text: "No acute intracranial hemorrhage, mass effect, or midline shift. Ventricles and basal cisterns are normal.",
    target: "findings",
    createdAt: "1970-01-01T00:00:00.000Z",
    modality: "CT",
    region: "Brain",
  },
];

function optionalScopeString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeParse(raw: string | null): PersonalReportTemplate[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((row): row is PersonalReportTemplate => {
        return (
          !!row &&
          typeof row === "object" &&
          typeof (row as PersonalReportTemplate).id === "string" &&
          typeof (row as PersonalReportTemplate).name === "string" &&
          typeof (row as PersonalReportTemplate).text === "string" &&
          ((row as PersonalReportTemplate).target === "findings" ||
            (row as PersonalReportTemplate).target === "impression")
        );
      })
      .map((row) => {
        const modality = optionalScopeString((row as PersonalReportTemplate).modality);
        const region = optionalScopeString((row as PersonalReportTemplate).region);
        return {
          id: row.id,
          name: row.name.trim() || "Untitled",
          text: row.text,
          target: row.target,
          createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
          ...(modality !== undefined ? { modality } : {}),
          ...(region !== undefined ? { region } : {}),
        };
      });
  } catch {
    return null;
  }
}

export function readPersonalReportTemplates(
  storage: Pick<Storage, "getItem"> | null | undefined,
): PersonalReportTemplate[] {
  if (!storage) return [...SEED];
  const parsed = safeParse(storage.getItem(PERSONAL_TEMPLATES_STORAGE_KEY));
  if (parsed === null) return [...SEED];
  return parsed;
}

export function writePersonalReportTemplates(
  storage: Pick<Storage, "setItem"> | null | undefined,
  templates: PersonalReportTemplate[],
): void {
  if (!storage) return;
  try {
    storage.setItem(PERSONAL_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function createPersonalTemplate(input: {
  name: string;
  text: string;
  target: PersonalTemplateTarget;
  modality?: string | null;
  region?: string | null;
  now?: Date;
}): PersonalReportTemplate {
  const now = input.now ?? new Date();
  const modality = optionalScopeString(input.modality);
  const region = optionalScopeString(input.region);
  return {
    id: `pt-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || "Untitled template",
    text: input.text,
    target: input.target,
    createdAt: now.toISOString(),
    ...(modality !== undefined ? { modality } : {}),
    ...(region !== undefined ? { region } : {}),
  };
}

/** Append a new template; returns the next list (newest first after seeds). */
export function appendPersonalTemplate(
  existing: PersonalReportTemplate[],
  next: PersonalReportTemplate,
): PersonalReportTemplate[] {
  return [next, ...existing.filter((t) => t.id !== next.id)];
}

/** U5 — edit an existing template in place (name and/or text). */
export function updatePersonalTemplate(
  existing: PersonalReportTemplate[],
  next: PersonalReportTemplate,
): PersonalReportTemplate[] {
  return existing.map((t) => (t.id === next.id ? { ...next } : t));
}

export function removePersonalTemplate(
  existing: PersonalReportTemplate[],
  id: string,
): PersonalReportTemplate[] {
  return existing.filter((t) => t.id !== id);
}

/**
 * Insert template text into the current field value.
 * Empty field → replace; otherwise append with a blank line separator.
 */
export function insertTemplateText(current: string, snippet: string): string {
  const incoming = snippet.trim();
  if (!incoming) return current;
  const cur = current.trimEnd();
  if (!cur) return incoming;
  return `${cur}\n\n${incoming}`;
}

/**
 * U5 — caret-aware insert. `selectionStart`/`selectionEnd` come from the
 * ACTIVE clinical editor's textarea, read at click time (the pill's
 * onMouseDown={preventDefault} keeps the editor's focus and selection). A
 * selection is REPLACED by the snippet; a bare caret mid-text splices the
 * snippet in place (the old path always appended at the field's end); a
 * caret at/after the end, or an unknown caret, keeps the append semantics.
 * Returns the next text plus where the caret should land (just after the
 * inserted snippet).
 */
export function insertTemplateTextAtSelection(
  current: string,
  snippet: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
): { text: string; caretAt: number } {
  const incoming = snippet.trim();
  if (!incoming) return { text: current, caretAt: selectionStart ?? current.length };
  const start =
    typeof selectionStart === "number" && selectionStart >= 0 && selectionStart <= current.length
      ? selectionStart
      : null;
  const end =
    start != null && typeof selectionEnd === "number" && selectionEnd >= start && selectionEnd <= current.length
      ? selectionEnd
      : null;
  if (start == null) {
    const text = insertTemplateText(current, snippet);
    return { text, caretAt: text.length };
  }
  if (end != null && end >= current.length && start >= current.trimEnd().length) {
    // Caret at the very end — keep the blank-line append semantics.
    const text = insertTemplateText(current, snippet);
    return { text, caretAt: text.length };
  }
  const text = current.slice(0, start) + incoming + current.slice(end ?? start);
  return { text, caretAt: start + incoming.length };
}

/** Untagged macros apply to every study. */
export function isGlobalPersonalTemplate(tpl: PersonalReportTemplate): boolean {
  const hasModality = !!(tpl.modality && tpl.modality.trim());
  const hasRegion = !!(tpl.region && tpl.region.trim());
  return !hasModality && !hasRegion;
}

function modalityCompatible(
  studyModality: string | null | undefined,
  templateModality: string | null | undefined,
): boolean {
  if (!templateModality || !templateModality.trim()) return true;
  if (!studyModality) return false;
  return templateModalityMatches(studyModality, templateModality);
}

function regionCompatible(
  ctx: ReportingStudyContext | null | undefined,
  templateRegion: string | null | undefined,
): boolean {
  if (!templateRegion || !templateRegion.trim()) return true;
  if (!ctx?.region) return false;
  return matchesContentScope(ctx, templateRegion);
}

/**
 * Study-aware filter cascade (mirrors report-format picker fallbacks):
 * 1. Modality + region match (when both study + template are scoped)
 * 2. Modality-only match
 * 3. Always include untagged / global macros
 * 4. If no study context → show everything
 *
 * Never returns empty solely because a region is unresolved when modality
 * matches or globals exist.
 */
export function filterPersonalTemplatesForStudy(
  templates: PersonalReportTemplate[],
  ctx: ReportingStudyContext | null | undefined,
): PersonalReportTemplate[] {
  if (!ctx || (!ctx.modality && !ctx.region)) {
    return templates;
  }

  const matched: PersonalReportTemplate[] = [];
  const seen = new Set<string>();
  const push = (tpl: PersonalReportTemplate) => {
    if (seen.has(tpl.id)) return;
    seen.add(tpl.id);
    matched.push(tpl);
  };

  // Prefer modality+region hits first.
  for (const tpl of templates) {
    if (isGlobalPersonalTemplate(tpl)) continue;
    if (
      modalityCompatible(ctx.modality, tpl.modality) &&
      regionCompatible(ctx, tpl.region) &&
      !!(tpl.modality && tpl.modality.trim()) &&
      !!(tpl.region && tpl.region.trim())
    ) {
      push(tpl);
    }
  }

  // Then modality-only (or region-only) scoped templates that still fit.
  for (const tpl of templates) {
    if (isGlobalPersonalTemplate(tpl)) continue;
    if (modalityCompatible(ctx.modality, tpl.modality) && regionCompatible(ctx, tpl.region)) {
      push(tpl);
    }
  }

  // Always keep globals available.
  for (const tpl of templates) {
    if (isGlobalPersonalTemplate(tpl)) push(tpl);
  }

  // Soft fallback: if nothing matched (e.g. exotic modality with only foreign
  // seeds), still surface the full library rather than an empty rail.
  return matched.length > 0 ? matched : templates;
}

/** Human-readable scope chip for a template (e.g. "CT · Brain", "All studies"). */
export function personalTemplateScopeLabel(tpl: PersonalReportTemplate): string {
  if (isGlobalPersonalTemplate(tpl)) return "All studies";
  const parts: string[] = [];
  if (tpl.modality?.trim()) parts.push(tpl.modality.trim().toUpperCase());
  if (tpl.region?.trim()) parts.push(tpl.region.trim());
  return parts.join(" · ");
}

/**
 * studyCombinations.ts — on-the-fly multi-study report assembly (MRI PR 4,
 * "Study Combinations").
 *
 * The workspace reports one study per session, but MRI is routinely acquired as
 * a combination (Brain + Cervical, whole spine as C + D + LS, …). The report
 * ASSEMBLER already exists — `assembleReport()` in radiologyMasterTemplates.ts
 * merges N master templates (deduped impressions, joined techniques, ordered
 * body-part sections) — but nothing in the app calls it, and the command
 * palette reserves a `combination` kind that emits nothing.
 *
 * This module is the thin, pure glue: a curated set of sensible base-template
 * combinations, and helpers that (a) resolve a combination to an AssembledReport
 * via the EXISTING assembler and (b) shape it into the workspace's insertion
 * primitives. No new assembler, no new template store — reuse only.
 *
 * Pure and alias-free (root-testable).
 */
import {
  assembleReport, findMasterTemplateById,
  type AssembledReport, type MasterTemplate,
} from "./radiologyMasterTemplates";

export interface StudyCombination {
  /** Stable palette id, conventionally `combo:<slug>`. */
  id: string;
  label: string;
  /** Base master-template ids (radiologyMasterTemplates), in report order. */
  templateIds: string[];
  modality: string;
  /** Extra searchable text for the palette / voice matcher (never displayed). */
  keywords: string;
}

/**
 * Curated combinations of the SINGLE-body-part master templates. Pre-authored
 * "combined" master templates (mri-brain-cervical-master, mri-whole-spine-master)
 * exist too, but the point here is composing separate base templates on demand
 * through the shared assembler, so the set stays small and orthogonal.
 */
export const STUDY_COMBINATIONS: StudyCombination[] = [
  { id: "combo:brain-cervical", label: "MRI Brain + Cervical Spine", templateIds: ["mri-brain-master", "mri-cervical-master"], modality: "MRI", keywords: "brain cervical neck combined demyelination" },
  { id: "combo:whole-spine", label: "MRI Whole Spine (Cervical + Dorsal + LS)", templateIds: ["mri-cervical-master", "mri-dorsal-master", "mri-ls-master"], modality: "MRI", keywords: "whole spine screening cervical dorsal lumbar" },
  { id: "combo:cervical-dorsal", label: "MRI Cervical + Dorsal Spine", templateIds: ["mri-cervical-master", "mri-dorsal-master"], modality: "MRI", keywords: "cervical dorsal spine" },
  { id: "combo:dorsal-ls", label: "MRI Dorsal + LS Spine", templateIds: ["mri-dorsal-master", "mri-ls-master"], modality: "MRI", keywords: "dorsal lumbar ls spine" },
  { id: "combo:brain-whole-spine", label: "MRI Brain + Whole Spine", templateIds: ["mri-brain-master", "mri-cervical-master", "mri-dorsal-master", "mri-ls-master"], modality: "MRI", keywords: "brain whole spine demyelination multiple sclerosis ms" },
];

export function findStudyCombination(id: string): StudyCombination | undefined {
  return STUDY_COMBINATIONS.find((c) => c.id === id);
}

/** Normalise a modality code so "MR" (workspace) matches "MRI" (combinations). */
function normModality(m: string): string {
  const u = (m || "").toUpperCase().trim();
  if (u === "MR" || u === "MRI") return "MR";
  if (u === "US" || u === "USG") return "US";
  return u;
}

/** Combinations offered for a given study modality (all when unknown). */
export function combinationsForModality(modality?: string | null): StudyCombination[] {
  const mod = normModality(modality || "");
  if (!mod) return STUDY_COMBINATIONS;
  return STUDY_COMBINATIONS.filter((c) => normModality(c.modality) === mod);
}

/**
 * Resolve a spoken/typed term to a single combination (for voice). Exact label
 * match wins; otherwise a unique substring / keyword hit. Returns null when
 * nothing matches or the match is ambiguous — the caller reports that honestly.
 */
const MATCH_STOPWORDS = new Set([
  "and", "with", "plus", "the", "of", "mri", "study", "studies", "combined", "combine", "spine",
]);

export function matchStudyCombination(term: string): StudyCombination | null {
  const q = (term || "").trim().toLowerCase();
  if (!q) return null;
  // Exact label wins outright.
  const exact = STUDY_COMBINATIONS.filter((c) => c.label.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  // Otherwise token-AND over label + keywords, dropping connective words so
  // natural phrasing ("brain and cervical") resolves against "+"-style labels.
  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !MATCH_STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  const hits = STUDY_COMBINATIONS.filter((c) => {
    const hay = `${c.label} ${c.keywords}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Build the assembled report for a combination via the EXISTING assembler.
 * Returns null unless at least two known base templates resolve (a combination
 * of one is just a template — use the template picker for that).
 */
export function buildCombination(templateIds: string[]): AssembledReport | null {
  const templates = templateIds
    .map((id) => findMasterTemplateById(id))
    .filter((t): t is MasterTemplate => !!t);
  if (templates.length < 2) return null;
  return assembleReport(templates, new Map());
}

export interface CombinationInserts {
  title: string;
  technique: string;
  /** Body-part-headed findings sections, in acquisition order. */
  findingsBlocks: { heading: string; text: string }[];
  /** Impression lines (the assembler's deduped block, split per line). */
  impression: string[];
  recommendation: string;
  criticalAlerts: string[];
}

/** Shape an AssembledReport into the workspace's per-section insertion pieces. */
export function combinationInserts(assembled: AssembledReport): CombinationInserts {
  return {
    title: assembled.title,
    technique: assembled.technique,
    findingsBlocks: assembled.findingsSections,
    impression: assembled.impression.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean),
    recommendation: assembled.advice,
    criticalAlerts: assembled.criticalAlerts,
  };
}

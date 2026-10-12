/**
 * regionTransition.ts — PR E PRIORITY 3: what a report may keep when the examination
 * region changes. See `docs/ADR/ADR-004-region-transition-safety.md`.
 *
 * The defect this designs away: choosing a different region in the Study / Region strip
 * today only rewrites `regionOverrides`. The Findings a previous region produced stay on
 * the page exactly as they were. A study re-labelled from Whole Spine to Cervical Spine
 * therefore prints "Dorsal spine: Vertebral bodies show normal height…" and "Lumbar spine:
 * Conus medullaris appears normal…" under a cervical-only examination — normals that
 * describe anatomy the new exam never covered. Nothing warns, nothing records, and the
 * print/PDF renders it.
 *
 * The rules, in order of what a radiologist would notice:
 *
 *  1. Only content that can be PLACED on a spine segment can be retired. A row whose
 *     region, level and text name no segment is kept and reported as unplaced — the
 *     transition never guesses at anatomy, and an unrecognised sentence is never deleted.
 *  2. Only NORMAL content is ever retired (role `baseline` / `screening`). An abnormality
 *     the patient has does not become absent because the examination label changed: it is
 *     surfaced in the confirmation and kept.
 *  3. Text the radiologist wrote themselves is never retired, never rewritten, and its
 *     count is stated in the confirmation.
 *  4. Retirement is a flag plus a reason, never a removal: the row stays in the ledger
 *     with its `lastRendered` contribution intact, so the transition is auditable and
 *     recoverable. Removing a row would be silent data deletion.
 *  5. A transition that retires nothing needs no confirmation — Whole Spine after
 *     Cervical is additive, and asking about it would train the radiologist to press
 *     through dialogs.
 *  6. Outside the spine (Brain → Knee) or into the generic "Spine" tab, the plan has no
 *     opinion at all and the product behaves exactly as it does today. This module must
 *     never become a second region engine.
 */

import { canonicalContentRegion, spineSegmentFromRegion } from "./reportingStudyContext";

export type SpineCoverageSegment = "cervical" | "dorsal" | "lumbar";

/** Everything a reporting region actually acquires. */
export function coverageOfRegion(region: string | null | undefined): Set<SpineCoverageSegment> | null {
  const canonical = canonicalContentRegion(region);
  const segment = spineSegmentFromRegion(canonical || (region ?? ""));
  switch (segment) {
    case "cervical":
      return new Set<SpineCoverageSegment>(["cervical"]);
    case "dorsal":
      return new Set<SpineCoverageSegment>(["dorsal"]);
    case "lumbar":
      return new Set<SpineCoverageSegment>(["lumbar"]);
    case "dorsolumbar":
      return new Set<SpineCoverageSegment>(["dorsal", "lumbar"]);
    case "whole":
      return new Set<SpineCoverageSegment>(["cervical", "dorsal", "lumbar"]);
    // "generic" (the bare "Spine" tab), null (non-spine) and anything unresolved.
    default:
      return null;
  }
}

const LEVEL_SEGMENT: Record<string, SpineCoverageSegment> = {
  cervical: "cervical",
  dorsal: "dorsal",
  thoracic: "dorsal",
  lumbar: "lumbar",
};

/**
 * Which segment a ledger row speaks for, or null when it names none.
 *
 * Level first, because the whole-spine screening bundle stores the segment there
 * (`level: "cervical" | "dorsal" | "lumbar"`) while `region` carries the sub-region it
 * was composed for. Text is the last resort: a row copied out of a template can carry a
 * "Dorsal spine:" prefix and no metadata at all.
 */
export function rowSegment(row: {
  region?: string | null;
  level?: string | null;
  text?: string | null;
}): SpineCoverageSegment | "whole" | null {
  const level = (row.level ?? "").trim().toLowerCase();
  if (level === "whole" || level === "whole spine") return "whole";
  if (LEVEL_SEGMENT[level]) return LEVEL_SEGMENT[level];

  const regionSegment = spineSegmentFromRegion(canonicalContentRegion(row.region) || (row.region ?? ""));
  if (regionSegment === "whole") return "whole";
  if (regionSegment === "cervical" || regionSegment === "dorsal" || regionSegment === "lumbar") return regionSegment;
  // A dorsolumbar row is covered by dorsal-only and lumbar-only exams only in part, so it
  // is not placeable on one segment and is kept. Guessing here would retire a real
  // junction finding.
  if (regionSegment === "dorsolumbar") return null;

  const text = (row.text ?? "").trim().toLowerCase();
  const prefix = text.match(/^(cervical|dorsal|thoracic|lumbar)\s+spine\s*:/);
  if (prefix) return LEVEL_SEGMENT[prefix[1]!] ?? null;
  return null;
}

export type TransitionRow = {
  id: string;
  role?: string | null;
  concept?: string | null;
  region?: string | null;
  level?: string | null;
  /** The sentence(s) this row put on the page — its `lastRendered.findings`. */
  text: string;
};

export type RegionTransitionRecord = {
  kind: "care.region_transition.v1";
  fromRegion: string | null;
  toRegion: string;
  /** Rows taken out of the report, each with the reason it went. */
  retired: Array<{ id: string; concept: string | null; segment: SpineCoverageSegment; text: string }>;
  /** Abnormalities kept although they name anatomy outside the new region. */
  keptAbnormalities: Array<{ id: string; concept: string | null; segment: SpineCoverageSegment; text: string }>;
  /** Count of findings lines owned by no ledger row — the radiologist's own words. */
  manualLinesPreserved: number;
  decidedBy: string;
  at: string;
};

export type RegionTransitionPlan = {
  fromRegion: string | null;
  toRegion: string;
  /** False when this module has no opinion (non-spine, generic Spine, unresolved). */
  actionable: boolean;
  /** Same as `needsConfirmation`, named for what the caller does with it. */
  requiresConfirmation: boolean;
  retire: TransitionRow[];
  keep: TransitionRow[];
  /** Placed outside the new region but abnormal — surfaced, never removed. */
  outOfRegionAbnormalities: TransitionRow[];
  /** Rows that could not be placed on any segment. Kept, and said so. */
  unplaced: TransitionRow[];
  /** Findings lines that belong to no ledger row at all. */
  manualLines: string[];
  summary: string;
  record(input: { decidedBy: string; at?: string }): RegionTransitionRecord;
};

const NORMAL_ROLES = new Set(["baseline", "screening", "normal"]);

function sameText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
}

export function planRegionTransition(input: {
  fromRegion: string | null;
  toRegion: string | null;
  rows: TransitionRow[];
  findingsText: string;
}): RegionTransitionPlan {
  const toRegion = (input.toRegion ?? "").trim();
  const to = coverageOfRegion(toRegion);
  const from = coverageOfRegion(input.fromRegion);

  const empty = (actionable: boolean): RegionTransitionPlan => buildPlan({
    fromRegion: input.fromRegion, toRegion, actionable, to,
    retire: [], keep: input.rows, abnormal: [], unplaced: [], manualLines: [],
  });

  // Rule 6 — no opinion outside the spine, or into the bare "Spine" tab.
  if (!toRegion || !to) return empty(false);
  // Same coverage both sides: nothing can become out of region (Cervical → C-Spine,
  // Whole Spine → whole-spine screening variant).
  if (from && sameCoverage(from, to)) return empty(false);
  // Whole Spine → Cervical is a narrowing; Cervical → Whole Spine is additive and can
  // retire nothing, because every segment the old report held is still covered.
  if (!from || isSuperset(to, from)) {
    return empty(true);
  }

  const retire: TransitionRow[] = [];
  const keep: TransitionRow[] = [];
  const abnormal: TransitionRow[] = [];
  const unplaced: TransitionRow[] = [];
  for (const row of input.rows) {
    const segment = rowSegment({ region: row.region, level: row.level, text: row.text });
    if (segment == null) { unplaced.push(row); keep.push(row); continue; }
    const inCoverage = segment !== "whole" && to.has(segment);
    if (inCoverage) { keep.push(row); continue; }
    // Out of coverage. A normal goes; an abnormality stays and is named in the
    // confirmation, because a finding the patient has does not become absent when the
    // examination label changes.
    if (isNormal(row)) retire.push(row);
    else { abnormal.push(row); keep.push(row); }
  }

  const manualLines = unownedLines(input.findingsText, input.rows);
  return buildPlan({
    fromRegion: input.fromRegion, toRegion, actionable: true, to,
    retire, keep, abnormal, unplaced, manualLines,
  });
}

/**
 * A row states an absence or a normal. `normal_study` is included because the whole-report
 * generator writes the Impression as a row with `role: "impression"` and
 * `concept: "normal_study"` — an "everything is normal" conclusion about segments the new
 * examination does not cover is exactly as unsafe to keep as the per-segment normals it
 * summarises, and it is not a finding the patient has.
 */
function isNormal(row: TransitionRow): boolean {
  const role = (row.role ?? "").trim().toLowerCase();
  if (role === "impression" || role === "normal") return (row.concept ?? "") === "normal_study";
  return NORMAL_ROLES.has(role);
}

function sameCoverage(a: Set<SpineCoverageSegment>, b: Set<SpineCoverageSegment>): boolean {
  return a.size === b.size && [...a].every((s) => b.has(s));
}

function isSuperset(a: Set<SpineCoverageSegment>, b: Set<SpineCoverageSegment>): boolean {
  return [...b].every((s) => a.has(s));
}

/**
 * Findings lines no ledger row owns. Line-based by intent: the whole-report formats put
 * one observation on each line, so an unowned line is the radiologist's own sentence, not
 * a formatting accident.
 */
export function unownedLines(findingsText: string, rows: TransitionRow[]): string[] {
  const owned = rows.map((r) => r.text).filter((t) => t.trim().length > 0);
  return findingsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !owned.some((t) => sameText(t, l) || t.includes(l)));
}

/**
 * The findings text as it reads AFTER the transition: every retired row's own lines are
 * gone, every other line is byte-identical and in the same order. Never re-joins with a
 * different separator, never trims a manual line, never re-wraps.
 */
export function applyPlanToFindingsText(findingsText: string, plan: RegionTransitionPlan): string {
  if (!plan.actionable || plan.retire.length === 0) return findingsText;
  const retired = plan.retire.map((r) => r.text).filter((t) => t.trim().length > 0);
  return findingsText
    .split("\n")
    .filter((line) => !retired.some((t) => sameText(t, line) || sameText(line, t)))
    .join("\n");
}

function buildPlan(input: {
  fromRegion: string | null;
  toRegion: string;
  actionable: boolean;
  to: Set<SpineCoverageSegment> | null;
  retire: TransitionRow[];
  keep: TransitionRow[];
  abnormal: TransitionRow[];
  unplaced: TransitionRow[];
  manualLines: string[];
}): RegionTransitionPlan {
  const requiresConfirmation = input.retire.length > 0 || input.abnormal.length > 0;
  const segments = [...new Set(input.retire.map((r) => rowSegment(r)))].filter(Boolean);
  const summary = requiresConfirmation
    ? `${input.retire.length} normal${input.retire.length === 1 ? "" : "s"} from ${
        segments.length ? segments.join(" and ") : "the previous region"
      } are not covered by ${input.toRegion}${
        input.abnormal.length ? `; ${input.abnormal.length} finding${input.abnormal.length === 1 ? "" : "s"} stay because a finding does not disappear with the label` : ""
      }${input.manualLines.length ? `; your own ${input.manualLines.length} line${input.manualLines.length === 1 ? "" : "s"} stay` : ""}.`
    : `Nothing in the report falls outside ${input.toRegion}.`;

  return {
    fromRegion: input.fromRegion,
    toRegion: input.toRegion,
    actionable: input.actionable,
    requiresConfirmation,
    retire: input.retire,
    keep: input.keep,
    outOfRegionAbnormalities: input.abnormal,
    unplaced: input.unplaced,
    manualLines: input.manualLines,
    summary,
    record: ({ decidedBy, at }) => ({
      kind: "care.region_transition.v1",
      fromRegion: input.fromRegion,
      toRegion: input.toRegion,
      retired: input.retire.map((r) => ({
        id: r.id,
        concept: r.concept ?? null,
        segment: (rowSegment(r) ?? "cervical") as SpineCoverageSegment,
        text: r.text,
      })),
      keptAbnormalities: input.abnormal.map((r) => ({
        id: r.id,
        concept: r.concept ?? null,
        segment: (rowSegment(r) ?? "cervical") as SpineCoverageSegment,
        text: r.text,
      })),
      manualLinesPreserved: input.manualLines.length,
      decidedBy,
      at: at ?? new Date().toISOString(),
    }),
  };
}

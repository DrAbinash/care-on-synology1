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
 *  4. Retirement runs through the report's own withdrawal path (`removeObservation`) in ONE
 *     undo frame, and every sentence that leaves is copied into a `care.region_transition.v1`
 *     record. A `stale` flag was the first design and is wrong here: `serializeObservationLedger`
 *     whitelists the fields it writes and `stale` is not among them, so a flagged row would
 *     come back as a live normal after a reload and print the sentence the transition removed.
 *  5. A transition that retires nothing needs no confirmation — Whole Spine after
 *     Cervical is additive, and asking about it would train the radiologist to press
 *     through dialogs.
 *  6. Outside the spine (Brain → Knee) or into the generic "Spine" tab, the plan has no
 *     opinion at all and the product behaves exactly as it does today. This module must
 *     never become a second region engine.
 */

import {
  canonicalContentRegion,
  spineSegmentFromRegion,
  type ReportingSource,
} from "./reportingStudyContext";
import { readStaffSession } from "./staffSession";
// Coverage is the region vocabulary's own question, and the printed page asks it
// from the API server too — so it is defined once, in `@workspace/report-quality`
// (`lib/report-quality/src/reportingRegion.ts`), and re-exported here unchanged.
import {
  coverageOfRegion,
  coverageUnionOfRegions,
  type SpineCoverageSegment,
} from "@workspace/report-quality";

export { coverageOfRegion, coverageUnionOfRegions };
export type { SpineCoverageSegment };

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
  /**
   * The region the report is about now. Either form is accepted: a single region, or the
   * whole multi-select list (the Study / Region chips are multi-select, and clicking one
   * that is already selected makes it primary rather than removing it). The list wins,
   * and coverage is its union — see `coverageUnionOfRegions`.
   */
  fromRegion?: string | null;
  fromRegions?: readonly string[];
  toRegion?: string | null;
  toRegions?: readonly string[];
  rows: TransitionRow[];
  findingsText: string;
}): RegionTransitionPlan {
  const toList = (input.toRegions ?? []).filter((r) => r.trim().length > 0);
  const toRegion = (toList.length > 0 ? toList.join(" + ") : input.toRegion ?? "").trim();
  const to = toList.length > 0 ? coverageUnionOfRegions(toList) : coverageOfRegion(toRegion);
  const fromList = input.fromRegions ?? [];
  const from = fromList.length > 0
    ? coverageUnionOfRegions(fromList)
    : coverageOfRegion(input.fromRegion);
  const fromLabel = fromList.length > 0 ? fromList.join(" + ") : input.fromRegion ?? null;

  const empty = (actionable: boolean): RegionTransitionPlan => buildPlan({
    fromRegion: fromLabel, toRegion, actionable, to,
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
    fromRegion: fromLabel, toRegion, actionable: true, to,
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

// There is deliberately no text-rewriting helper here. The report's sentences are owned by
// the observation ledger, and `removeObservation` is the product's one withdrawal path:
// it takes the row's sentence out of the text, brings back the baseline that row had been
// covering, detaches its measurements and re-aligns the Recommendation. A line filter in
// this module would have been a second, smaller version of the same job — it would have
// removed text while leaving the ledger row, the covered baseline and the linked
// measurements pointing at a sentence that was no longer on the page.

/** The save-draft REQUEST field the payload below is written to. */
export const REGION_TRANSITION_REQUEST_FIELD = "regionTransitions";
/**
 * The structured_json ENVELOPE key the server stores it under. Two names on purpose, exactly
 * the way vascularTechnique / careVascularTechnique already work: the request field is what the
 * client sends, the envelope key is what comes back on a reload, and reading only the first
 * silently restores nothing — which is how Technique was destroyed by save → reopen once before
 * (B-01, PR #876).
 */
export const REGION_TRANSITION_ENVELOPE_KEY = "careRegionTransitions";

/**
 * The draft envelope entry. `undefined` when nothing has been retired, so a report nobody
 * has re-regioned gains no key — the same rule `vascularTechniquePayload` follows.
 */
export function regionTransitionPayload(
  records: readonly RegionTransitionRecord[] | null | undefined,
): RegionTransitionRecord[] | undefined {
  if (!records || records.length === 0) return undefined;
  return records.map((r) => ({ ...r, retired: r.retired.map((x) => ({ ...x })), keptAbnormalities: r.keptAbnormalities.map((x) => ({ ...x })) }));
}

/**
 * Read the envelope back. Structural, not trusting: a row that does not carry the contract's
 * fields is dropped rather than coerced, because a half-parsed transition record on screen
 * would present an unproven claim about who removed what.
 */
export function extractCareRegionTransitions(column: unknown): RegionTransitionRecord[] {
  const col = (column as { [k: string]: unknown } | null | undefined) ?? null;
  const raw = col?.[REGION_TRANSITION_ENVELOPE_KEY] ?? col?.[REGION_TRANSITION_REQUEST_FIELD];
  if (!Array.isArray(raw)) return [];
  const out: RegionTransitionRecord[] = [];
  for (const item of raw) {
    const r = item as Record<string, unknown> | null;
    if (!r || r.kind !== "care.region_transition.v1") continue;
    if (typeof r.toRegion !== "string" || !Array.isArray(r.retired)) continue;
    const retired = (r.retired as unknown[]).filter((x) => {
      const e = x as Record<string, unknown> | null;
      return !!e && typeof e.id === "string" && typeof e.text === "string";
    }) as RegionTransitionRecord["retired"];
    const kept = Array.isArray(r.keptAbnormalities)
      ? (r.keptAbnormalities as unknown[]).filter((x) => {
          const e = x as Record<string, unknown> | null;
          return !!e && typeof e.id === "string" && typeof e.text === "string";
        }) as RegionTransitionRecord["keptAbnormalities"]
      : [];
    out.push({
      kind: "care.region_transition.v1",
      fromRegion: typeof r.fromRegion === "string" ? r.fromRegion : null,
      toRegion: r.toRegion,
      retired,
      keptAbnormalities: kept,
      manualLinesPreserved: typeof r.manualLinesPreserved === "number" ? r.manualLinesPreserved : 0,
      decidedBy: typeof r.decidedBy === "string" ? r.decidedBy : "",
      at: typeof r.at === "string" ? r.at : "",
    });
  }
  return out;
}

/**
 * Who pressed the button, as far as the browser can tell. The record is an audit *claim*
 * about a client action; the server attests the actor at finalize, the same division the
 * draft's own identity fields live under. Empty string rather than a guess when no session
 * is present (tests, offline).
 */
export function regionTransitionActor(): string {
  // The product's own reader, because it is the product's own key: reading a name off a
  // guessed localStorage path returns "" in the live app, and an empty `decidedBy` is an
  // audit record that says nobody decided. `name` is what staff-login puts there; `email`
  // is the fallback for a session seeded without one.
  const user = readStaffSession()?.user;
  return (user?.name ?? "").trim() || (user?.email ?? "").trim();
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
  // The strip shows this sentence to a radiologist, so it agrees with itself: one normal
  // "is" not covered, two "are"; one finding "stays", two "stay".
  const countWord = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
  const summary = requiresConfirmation
    ? `${countWord(input.retire.length, "normal", "normals")} from ${
        segments.length ? segments.join(" and ") : "the previous region"
      } ${input.retire.length === 1 ? "is" : "are"} not covered by ${input.toRegion}${
        input.abnormal.length
          ? `; ${countWord(input.abnormal.length, "finding", "findings")} ${input.abnormal.length === 1 ? "stays" : "stay"} because a finding does not disappear with the label`
          : ""
      }${input.manualLines.length
        ? `; your own ${countWord(input.manualLines.length, "line", "lines")} ${input.manualLines.length === 1 ? "stays" : "stay"}`
        : ""}.`
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

/**
 * PR E PRIORITY 1 — the reporting identity a write is about to use, checked against the
 * transitions this report has already recorded.
 *
 * A confirmed transition is the radiologist's own decision about which examination this
 * report describes, and ADR-004 keeps the region control session-scoped on purpose:
 * `regionOverrides` is React state (`useReportingStudySetup.ts:164`) and the save body
 * carries no region field (`useDraftPersistence.ts:515` sends only this record), so after
 * save → close → reopen the control reads the booked region again while the text under it is
 * the moved report. That is only safe while nothing acts on the reloaded region.
 *
 * Something did. Measured through the real store and the shipped format library: a whole-spine
 * screening exam generates 16 Findings lines, the confirmed transition retires 11 and leaves 6
 * with no dorsal or lumbar text, and after save → reload one press of Generate against the
 * reloaded (billed) region writes 10 lines back — every one of them a dorsal or lumbar normal
 * the radiologist had just retired — because `resolveNormalBootstrapFormat` picks the
 * examination from the context it is handed and merges that format's sentences into the page.
 * The report again asserted a normal cervical, dorsal and lumbar spine on an exam the
 * radiologist narrowed to the cervical spine. The mount-time auto-bootstrap cannot do this
 * (its `if (existingDraft) return;` guard refuses any study with a saved draft); the press can.
 *
 * The rule reads two things and nothing else: the provenance of the region being used, and the
 * last recorded transition. It is deliberately not a text reader — deciding a region from report
 * prose is the guessing this module exists to prevent. An explicit region choice (`override`) is
 * never overridden by history, because that is the radiologist re-declaring the examination in
 * front of CARE; `billed` / `dicom` / `auto` are all readings CARE made by itself, and an
 * unresolved identity has no regions to compare so the caller's own refusal handles it.
 */
export function conflictingTransitionRecord(input: {
  source: ReportingSource | null | undefined;
  regions: readonly (string | null | undefined)[];
  records: readonly RegionTransitionRecord[] | null | undefined;
}): RegionTransitionRecord | null {
  if (input.source === "override") return null;
  const list = input.records ?? [];
  const last = list.length > 0 ? list[list.length - 1] : null;
  if (!last || typeof last.toRegion !== "string" || !last.toRegion.trim()) return null;
  const target = canonicalContentRegion(last.toRegion).toLowerCase();
  const regions = input.regions
    .map((r) => canonicalContentRegion(r).toLowerCase())
    .filter((r) => r.length > 0);
  if (regions.length === 0) return null;
  return regions.includes(target) ? null : last;
}

export function regionIdentityConflictsWithTransition(input: {
  source: ReportingSource | null | undefined;
  regions: readonly (string | null | undefined)[];
  records: readonly RegionTransitionRecord[] | null | undefined;
}): boolean {
  return conflictingTransitionRecord(input) !== null;
}

/**
 * The sentence both refusal sites show — the store's, and Start Report's before it has run
 * the setup half and written this region's Technique. It names both regions and the one
 * action that resolves the disagreement, because a refusal that does not say what to do next
 * is a dead end the radiologist reads as a broken button.
 */
export function regionIdentityConflictMessage(input: {
  source: ReportingSource | null | undefined;
  regions: readonly (string | null | undefined)[];
  records: readonly RegionTransitionRecord[] | null | undefined;
}): string | null {
  const record = conflictingTransitionRecord(input);
  if (!record) return null;
  const used = input.regions
    .map((r) => (r ?? "").trim())
    .filter((r) => r.length > 0)
    .join(" + ");
  return `Nothing generated. This report was moved to ${record.toRegion} and that decision is recorded, `
    + `but the examination is being read as ${used}. Choose ${record.toRegion} in the Region control, then generate again.`;
}

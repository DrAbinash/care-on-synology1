/**
 * RULING 3 (#174) — the whole-report doors withdraw a contradictory normal FINDING.
 *
 * The Quick Select click door has always done this: a box for a slot retires the
 * scaffold's normal sentence for that slot, keeps every other level's normal, and
 * leaves the radiologist's own wording alone. Measured on the shipped catalogue before
 * this module (tmp/census2b.txt), the two whole-report doors never asked the question:
 *
 *  · Full Normal Format re-materialised the slot it had just withdrawn — L4-L5 disc
 *    contour came back as both prose AND a live ledger row (39/39 normal lines), so the
 *    Findings section declared that disc normal three lines above the herniation.
 *  · the two-format merge wrote the pair's Findings as prose with NO ledger row, so the
 *    contradicting normal arrived unowned and survived save/reload (39/39 after reload).
 *
 * Both doors now consult the live observation ledger through `prepareNormalSupersession`
 * — the click door's own rule, extracted rather than copied. Nothing here reads a
 * keyword list, and nothing here can retire a whole anatomical section: the unit of
 * withdrawal is one baseline slot row, and a row is only touched when every sentence it
 * authored is (a) superseded by a structured observation the report already carries and
 * (b) actually present as a line of the prose this door is about to write. Text and
 * ledger cannot diverge, because one function returns both halves.
 *
 * The withdrawal is a SUSPENSION, not a deletion. A suspended row keeps its
 * `templates`, goes `stale` with an empty `lastRendered`, and the sentence is recorded on
 * the abnormal observation that caused it (`claimRetiredBaselines`) — which is exactly
 * what `removeObservation` reads to put a normal back when the finding is deselected. So
 * "deselect the herniation and the L4-L5 normal returns, and stays gone while a second
 * finding still contradicts it" holds for all four doors on the one shipped mechanism.
 *
 * What a door cannot prove it owns, it keeps and names. `retained` is the ambiguous case
 * the ruling forbids solving by deletion — curated wording, wording another live finding
 * wrote — and it goes to the canvas review banner. A contradicted sentence that is not in
 * the prose this door is writing is not a contradiction it introduces, so it is skipped
 * without a warning rather than reported as one.
 */

import {
  isSystemNormalPatch, reportAssertsAbnormality,
} from "@/lib/conceptCanon/normalImpression";
import {
  hasStructuredOwnership, liveContributionKeys, ownershipFromObservation, type CanonicalObservation,
} from "@/lib/observationSlot";
import { CONTRADICTED_NORMAL_RETAINED_HINT } from "@/lib/observationLedger";
import {
  prepareNormalSupersession, type NormalSupersessionOwner, type PathologyIncoming, type PathologyOwnership,
} from "@/lib/pathologyPatch";
import { normalizeForDedupe, splitToSentences, type InsertSource } from "@/lib/reportFieldMerge";
import { materializeFormatBaseline } from "./fullReportBaseline";
import type { ReportFormat } from "./types";
import type { AppliedPathologyPatch } from "./store";

/** A baseline slot as `materializeFormatBaseline` produces it. */
export type NormalBaselineRow = {
  id: string;
  observation?: CanonicalObservation;
  templates: PathologyIncoming;
  lastRendered?: PathologyIncoming;
  stale?: boolean;
  protected?: boolean;
  /** Carried through so a merge door can put the row on the ledger as it stands. */
  ownership?: PathologyOwnership;
  source?: InsertSource;
  replacedBaseline?: { findings: string[]; impression: string[] };
};

/**
 * The live abnormal observations that may retire a normal sentence. Stale rows are
 * excluded (their contribution is not on the page), as are baseline rows and the
 * study-wide normal itself — those are the sentences under judgement, not judges.
 *
 * Each carries its ledger id so the door can record the retirement ON the observation
 * that caused it, which is where `removeLedgerObservation` looks for what a deselection
 * is allowed to put back.
 */
export type AbnormalSlotOwner = NormalSupersessionOwner & { id: string };

export function abnormalSlotOwners(
  patches: readonly Pick<AppliedPathologyPatch, "id" | "ownership" | "templates" | "observation" | "stale">[],
): AbnormalSlotOwner[] {
  const out: AbnormalSlotOwner[] = [];
  for (const p of patches) {
    if (p.stale) continue;
    if (p.observation?.role === "baseline") continue;
    if (isSystemNormalPatch(p as AppliedPathologyPatch)) continue;
    const o = p.observation;
    if (!o || !hasStructuredOwnership(o)) continue;
    out.push({
      id: p.id,
      concept: o.concept,
      level: o.level,
      laterality: o.laterality,
      anatomicalSection: o.anatomicalSection,
      baselineReplaces: p.ownership.baselineReplaces ?? "",
      ownText: `${p.templates.findings ?? ""} ${p.templates.impression ?? ""}`,
    });
  }
  return out;
}

/** A suspended slot plus the observations it was suspended for — the restore authority. */
export type SuspendedNormalRow = NormalBaselineRow & { withdrawnBy: string[] };

/**
 * What a whole-report door does with its contradicted normals: `suspended` are withdrawn,
 * `retained` are the ones it could not withdraw and must therefore name on the canvas.
 */
export type NormalWithdrawal = {
  incoming: string;
  withheld: string[];
  suspended: SuspendedNormalRow[];
  retained: { sentence: string; slot: string; reason: string }[];
};

/**
 * A baseline slot that this door judged: `retained` null means withdrawn, non-null means
 * kept and named, carrying the fence that kept it.
 */
type JudgedBaselineRow = {
  row: NormalBaselineRow;
  withdrawnBy: string[];
  units: string[];
  retained: string | null;
};

const rowUnits = (row: NormalBaselineRow): string[] => splitToSentences(row.templates.findings ?? "");

/**
 * The one door-facing call. Returns the prose to write, the sentences withheld from it,
 * and the rows to carry as suspended — together, so a door can never withdraw text it
 * cannot account for or suspend a row whose sentence it failed to remove.
 *
 * Matching is at SENTENCE granularity because the merge door re-cuts the pair's Findings
 * at punctuation: a baseline slot authored as one statement can arrive as two lines, and
 * a whole-row line match would silently refuse to withdraw it.
 */
export function withdrawSupersededNormals(opts: {
  /** The Findings prose this door is about to contribute. */
  incoming: string;
  /** The baseline slots this door would otherwise declare. */
  baselineRows: readonly NormalBaselineRow[];
  /** The report as it stands, which owns the abnormal observations. */
  livePatches: readonly AppliedPathologyPatch[];
  /** The door's own abnormality verdict — a genuinely normal report withdraws nothing. */
  assertsAbnormality: boolean;
}): NormalWithdrawal {
  const keep = (): NormalWithdrawal => ({
    incoming: opts.incoming, withheld: [], suspended: [], retained: [],
  });
  if (!opts.assertsAbnormality) return keep();
  const owners = abnormalSlotOwners(opts.livePatches);
  if (owners.length === 0) return keep();
  // A sentence another live observation rendered belongs to that observation; the same
  // Phase 5 eviction fence the click door applies.
  const held = liveContributionKeys(opts.livePatches);
  const page = new Set(splitToSentences(opts.incoming).map((s) => normalizeForDedupe(s)));
  // One prepared judge per owner: the rule is the click door's, and deriving its compound
  // concepts again for every sentence of every slot would make a whole-report door cost the
  // square of the report.
  const judges = owners.map((o) => ({ id: o.id, judge: prepareNormalSupersession(o) }));
  const retired = opts.baselineRows
    .map((row): JudgedBaselineRow | null => {
      if (row.observation?.role !== "baseline") return null;
      const units = rowUnits(row);
      // Whole rows only: a partially superseded normal keeps speaking, because half a
      // sentence is not something this system is ever entitled to delete.
      if (units.length === 0) return null;
      const ownersFor = judges.filter((j) => units.every((u) => j.judge(u)));
      if (ownersFor.length === 0) return null;
      const withdrawnBy = ownersFor.map((j) => j.id);
      // A slot whose sentence is not in the prose this door is about to write is not a
      // contradiction this door introduces — the page simply will not carry it. Silently
      // skipping it is the only honest option: warning about it would tell the
      // radiologist about a clash that is not on his screen.
      if (!units.every((u) => page.has(normalizeForDedupe(u)))) return null;
      // Everything below this line is a fence, not a judgement: the sentence IS on the
      // page, it IS contradicted, and this door is choosing to keep it. That is the
      // ambiguous case the ruling names, so it is reported rather than swallowed.
      if (row.protected) return { row, withdrawnBy, units, retained: "curated or hand-written" as const };
      const heldUnit = units.find((u) => held.has(normalizeForDedupe(u)));
      if (heldUnit) return { row, withdrawnBy, units, retained: "another live finding wrote it" as const };
      return { row, withdrawnBy, units, retained: null };
    })
    .filter((hit): hit is JudgedBaselineRow => hit !== null);
  const blocked = retired.filter((hit) => hit.retained !== null).map((hit) => ({
    sentence: hit.units.join(" "),
    // The banner prints this as the bold label, so it names the clinical slot at issue
    // rather than a vocabulary token the radiologist has never seen.
    slot: `${hit.row.observation?.level || hit.row.observation?.region || "this exam"} · ${hit.row.observation?.concept ?? "finding"}`,
    reason: hit.retained as string,
  }));
  const withdrawn = retired.filter((hit) => hit.retained === null);
  if (withdrawn.length === 0) return { ...keep(), retained: blocked };
  const gone = new Set(withdrawn.flatMap((hit) => hit.units.map((u) => normalizeForDedupe(u))));
  const incoming = opts.incoming
    .split(/\r?\n/)
    .map((line) => {
      const sentences = splitToSentences(line);
      if (sentences.length === 0) return line;
      const survivors = sentences.filter((s) => !gone.has(normalizeForDedupe(s)));
      if (survivors.length === sentences.length) return line;
      if (survivors.length === 0) return "";
      const indent = line.slice(0, line.length - line.trimStart().length);
      return indent + survivors.join(" ");
    })
    .join("\n");
  return {
    incoming,
    withheld: withdrawn.flatMap((hit) => hit.units),
    // The suspension shape `removeObservation` restores from.
    suspended: withdrawn.map((hit) => ({
      ...hit.row,
      withdrawnBy: hit.withdrawnBy,
      stale: true as const,
      lastRendered: { ...(hit.row.lastRendered ?? hit.row.templates), findings: "", impression: "" },
    })),
    retained: blocked,
  };
}

/**
 * The two-format merge door's view of the same decision: the pair's own baseline slots,
 * then the withdrawal above. Read by `applyMergedResult` AND by the Merge Preview, so the
 * sentence struck through on screen is the sentence that never reaches the page.
 *
 * It runs the report's own abnormality verdict internally, exactly as the Impression guard
 * does, because a preview and an Apply that each passed their own copy of that boolean are
 * two decisions wearing one name.
 */
export function mergedFindingsWithdrawal(opts: {
  merged: string;
  formats: readonly ReportFormat[];
  region: string;
  livePatches: readonly AppliedPathologyPatch[];
  fields: { findings: string; impression: string };
}): NormalWithdrawal {
  const rows = opts.formats.flatMap((f) => materializeFormatBaseline(f, opts.region || f.bodyPart).map((p) => ({
    id: p.id,
    observation: p.observation,
    templates: p.templates,
    lastRendered: p.lastRendered,
    protected: p.protected,
    ownership: ownershipFromObservation(p.observation),
    source: p.source,
    replacedBaseline: p.replacedBaseline,
  })));
  return withdrawSupersededNormals({
    incoming: opts.merged,
    baselineRows: rows,
    livePatches: opts.livePatches,
    assertsAbnormality: reportAssertsAbnormality(opts.livePatches, opts.fields),
  });
}

/**
 * Record the retirement ON the observation that caused it.
 *
 * A deselection restores what the removed observation declares — `replacedBaseline`
 * plus the canonical claim set — and `removeLedgerObservation` then filters the result
 * against the observations that are STILL selected. That is the shipped mechanism for
 * "bring the normal back when the finding goes away", and it is keyed on the abnormal
 * row, not on the door that withdrew the sentence. A whole-report door that withheld a
 * normal without writing this down leaves a suspended row whose prose never returns
 * (measured: withdraw at the merge door, deselect the herniation, the L4-L5 normal came
 * back as a live ledger row with no text on the page). So the door says, on the
 * observation's own record, which sentences it withdrew for that observation's sake.
 */
export function claimRetiredBaselines<T extends {
  id: string;
  stale?: boolean;
  replacedBaseline?: { findings: string[]; impression: string[] };
}>(patches: readonly T[], suspended: readonly SuspendedNormalRow[]): T[] {
  if (suspended.length === 0) return [...patches];
  return patches.map((p) => {
    // A stale row's own contribution is not on the page, so it is not standing behind
    // anything and must not become the reason a normal comes back.
    if (p.stale) return p;
    const sentences = suspended
      .filter((row) => row.withdrawnBy.includes(p.id))
      .flatMap((row) => rowUnits(row));
    if (sentences.length === 0) return p;
    return {
      ...p,
      replacedBaseline: {
        findings: [...new Set([...(p.replacedBaseline?.findings ?? []), ...sentences])],
        impression: [...(p.replacedBaseline?.impression ?? [])],
      },
    };
  });
}

/**
 * Arm the canvas review banner for the contradicted normals a door had to KEEP, without
 * discarding warnings the click door already armed. Names the sentence, the slot and the
 * reason — the ruling's own remedy for ambiguous ownership is that he reads it, not that
 * the system decides for him.
 */
export function retainedNormalReviewWarnings(
  prior: readonly { sentence: string; token: string; hint: string }[],
  retained: readonly { sentence: string; slot: string; reason: string }[],
): { sentence: string; token: string; hint: string }[] {
  if (retained.length === 0) return [...prior];
  const keyOf = (token: string, sentence: string) => `${token}::${normalizeForDedupe(sentence)}`;
  const out = [...prior];
  for (const r of retained) {
    const key = keyOf(r.slot, r.sentence);
    if (out.some((w) => keyOf(w.token, w.sentence) === key)) continue;
    out.push({
      token: r.slot,
      sentence: `${r.sentence} — kept, ${r.reason}.`,
      hint: CONTRADICTED_NORMAL_RETAINED_HINT,
    });
  }
  return out;
}

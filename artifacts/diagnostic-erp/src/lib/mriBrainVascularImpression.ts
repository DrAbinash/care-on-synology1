/**
 * mriBrainVascularImpression.ts — §18's ordering of the impression.
 *
 * The impression is assembled by the ledger from the observations the radiologist
 * accepted (`collectImpressionContributions`), which is the right source of truth and is
 * not duplicated here. What the ledger cannot know is clinical priority: its order is the
 * order the rows were applied, so "Variant A1 asymmetry" can arrive above "Occlusion of
 * the left MCA M1" simply because the variant tile was clicked first.
 *
 * This module therefore ranks the assembled LINES, from the same vocabulary §20 uses for
 * critical findings, and reorders them so the clinically significant vascular abnormality
 * leads. It never writes a line, never drops one, and is not called for an impression the
 * radiologist edited by hand — the existing provenance model already protects that, and a
 * hand-reordered impression is the radiologist's own arrangement (§18).
 *
 * The shape mirrors the spine phases' impression-priority seam (`{line, rank, label,
 * ruleId, index}`) so the regions stay comparable rather than each inventing its own.
 *
 * Pure functions only — no store, no React.
 */

export type BrainVascularImpressionRule = {
  id: string;
  /** Lower leads. Spaced by tens so a new priority does not renumber the table. */
  rank: number;
  re: RegExp;
  /** A line matching this is this rule's subject — the rule does not claim it. */
  unless?: RegExp;
  label: string;
};

/**
 * §18's "prioritize clinically significant vascular abnormalities", in the order a
 * clinician reads them: the finding that changes management today, then the finding that
 * changes it this admission, then the findings that explain it, then the variants.
 */
export const BRAIN_VASCULAR_IMPRESSION_RULES: readonly BrainVascularImpressionRule[] = [
  {
    id: "large_vessel_occlusion",
    rank: 10,
    re: /\b(?<!non-)occlusi\w*|\boccluded\b|\babsent flow signal\b/i,
    // A venous line that happens to say "occlusive" is a thrombosis, not a large-vessel
    // occlusion, and belongs with the rest of the venous system (§12).
    unless: /\bvenous\b|\bsinus\b|\bthromb\w*|\bclot\b/i,
    label: "arterial occlusion",
  },
  {
    id: "ruptured_aneurysm",
    rank: 20,
    re: /\baneurysm\b[^.]*\b(?:ruptur\w*|haemorrhage|hemorrhage|subarachnoid)\b|\b(?:ruptured|suspected ruptured|suspected rupture)\b[^.]*\baneurysm/i,
    label: "ruptured or suspected-ruptured aneurysm",
  },
  {
    id: "venous_thrombosis",
    rank: 30,
    re: /\b(?:thromb(?:osis|us)|clot)\b/i,
    label: "dural venous sinus or deep venous thrombosis",
  },
  {
    id: "venous_infarction",
    rank: 40,
    re: /\bvenous infarct\w*|\bhaemorrhagic infarct\w*|\bhemorrhagic infarct\w*|\bacute (?:ischaemic|ischemic) infarct\w*/i,
    label: "venous or acute infarction",
  },
  {
    id: "aneurysm",
    rank: 50,
    re: /\baneurysm\b|\baneurysmal\b/i,
    label: "unruptured aneurysm",
  },
  {
    id: "moyamoya",
    rank: 60,
    re: /\bmoyamoya\b|\blenticulostriate collateral\w*/i,
    label: "moyamoya disease or pattern",
  },
  {
    id: "malformation",
    rank: 70,
    re: /\bavm\b|\barteriovenous malformation\b|\bnidus\b|\bvascular malformation\b|\bdraining vein\b/i,
    label: "arteriovenous malformation",
  },
  {
    id: "dissection",
    rank: 80,
    re: /\bdissection\b|\bintramural (?:h|ae)ematoma\b|\bintimal flap\b/i,
    label: "arterial dissection",
  },
  {
    id: "high_grade_stenosis",
    rank: 90,
    re: /\b(?:severe|high[- ]grade|critical|flow[- ]limiting)\b[^.]{0,40}?\bstenos\w*|\bstenos\w*\b[^.]{0,40}?\b(?:severe|high[- ]grade|critical|flow[- ]limiting)\b|\b100\s*%|\b(?:7[0-9]|8[0-9]|9[0-9])\s*%/i,
    label: "high-grade stenosis",
  },
  {
    id: "other_vascular_abnormality",
    rank: 100,
    re: /\bstenos\w*|\bnarrowing\b|\bectasia\b|\btortuosit\w*|\bpseudoaneurysm\b|\bvasospasm\b|\bhyposensitivity\b|\bflow gap\b|\breduced flow\b/i,
    label: "other vascular abnormality",
  },
  {
    id: "variant",
    rank: 140,
    re: /\bvariant\b|\bhypoplasia\b|\baplasia\b|\bcaliber asymmetry\b|\bdominance\b|\bfetal (?:posterior )?cerebral\b|\bpica termination/i,
    label: "non-pathologic anatomic variant",
  },
  {
    id: "normal_study",
    rank: 150,
    re: /^\s*(?:no|normal|unremarkable|within normal|not seen|without)\b/i,
    label: "normal or negative statement",
  },
];

/** A line no rule claims keeps its place among the findings, below the ranked ones. */
export const BRAIN_VASCULAR_IMPRESSION_UNRANKED = 120;

export type BrainVascularImpressionRank = {
  line: string;
  rank: number;
  label: string;
  ruleId: string;
  index: number;
};

/** The first rule that claims the line. Rules are tested in table order. */
export function rankBrainVascularImpressionLine(line: string, index = 0): BrainVascularImpressionRank {
  const trimmed = line.trim();
  for (const rule of BRAIN_VASCULAR_IMPRESSION_RULES) {
    if (!rule.re.test(trimmed)) continue;
    if (rule.unless?.test(trimmed)) continue;
    return { line: trimmed, rank: rule.rank, label: rule.label, ruleId: rule.id, index };
  }
  return {
    line: trimmed,
    rank: BRAIN_VASCULAR_IMPRESSION_UNRANKED,
    label: "unranked impression line",
    ruleId: "",
    index,
  };
}

/**
 * Clinical priority first, then the order the radiologist applied the observations.
 *
 * A single protected line — one the radiologist wrote by hand — stops the whole reorder:
 * their arrangement of that impression is authoritative (§18), and moving their sentence
 * to "help" is exactly the automatic overwrite the CARE provenance model forbids.
 */
export function orderBrainVascularImpressionLines(
  lines: readonly string[],
  opts: { protectedLine?: (line: string) => boolean } = {},
): string[] {
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  if (cleaned.some((line) => opts.protectedLine?.(line))) return cleaned;
  return cleaned
    .map((line, index) => rankBrainVascularImpressionLine(line, index))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.line);
}

/**
 * The guard the store action needs: a reorder may only ever permute the lines it was
 * given. If the two lists differ by anything other than order, nothing was ordered and
 * the impression is left exactly as it was.
 */
export function isImpressionReorderOf(
  before: readonly string[],
  after: readonly string[],
): boolean {
  const key = (lines: readonly string[]) =>
    lines.map((l) => l.trim().toLowerCase()).filter(Boolean).sort().join("\n");
  return key(before) === key(after);
}

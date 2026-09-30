/**
 * impressionPriority.ts — Impression ordering for MRI spine reporting
 * (spec §37).
 *
 * The Impression must not simply repeat the Findings: acute and urgent problems
 * lead, then the dominant level, then the compressive and structural findings
 * in clinical order, and minor degeneration stays last. The rank table lives
 * here, tested, and NOT in JSX.
 *
 * Ordering is a suggestion the radiologist always overrides: once the
 * Impression is manually reordered or edited, `impressionOrderFrozen` is set in
 * the store and this module stops touching that report.
 */

export type ImpressionPriorityRule = {
  id: string;
  label: string;
  /** Lower sorts first. Mirrors the numbered order in spec §37. */
  rank: number;
  re: RegExp;
};

/**
 * Ranked clinical categories. A line is classified by the rule that matches
 * EARLIEST in the sentence, so "post-operative epidural abscess" is read as a
 * post-operative complication rather than a bare infection, while
 * "spondylodiscitis" still ranks as infection.
 */
export const IMPRESSION_PRIORITY: ImpressionPriorityRule[] = [
  {
    id: "acute-urgent",
    label: "acute / urgent abnormality",
    rank: 1,
    re: /\b(?:acute|urgent|emergent)\b[^.]*\b(?:cauda equina|conus|cord compression|epidural (?:abscess|hematoma)|fracture)\b|\bcauda equina syndrome\b|\bconus (?:syndrome|compression)\b|\bepidural (?:abscess|hematoma)[^.]*compression\b|\bmalignant epidural\b/i,
  },
  {
    id: "dominant-level",
    label: "dominant clinically significant level",
    rank: 2,
    re: /\b(?:most pronounced|dominant|principal|worst) (?:at|level|l\d)|\bmost pronounced\b/i,
  },
  {
    id: "cord-compromise",
    label: "cord compression / intrinsic cord signal change",
    rank: 3,
    re: /\bcord compression\b|\bcompressive myelopathy\b|\bmyelomalacia\b|\bcord flattening\b|\bintrinsic cord signal\b|\bcord signal abnormality\b/i,
  },
  {
    id: "severe-canal-stenosis",
    label: "severe central canal stenosis",
    rank: 3,
    re: /\b(?:severe|marked) (?:central |spinal )?canal stenosis\b/i,
  },
  {
    id: "root-compression",
    label: "definite nerve root compression",
    rank: 4,
    re: /\b(?:nerve root|root) (?:compression|impingement)\b|\b(?:compression|impingement) of the (?:exiting|descending|traversing)(?: (?:left|right|bilateral))? [lts]\d\b|\bcompress(?:es|ing) (?:the )?(?:exiting|descending|traversing)? ?(?:[lts]\d )?(?:nerve )?root\b|\broot compression\b/i,
  },
  {
    id: "foraminal-recess-stenosis",
    label: "significant foraminal / lateral recess stenosis",
    rank: 5,
    re: /\b(?:severe|moderate) [a-z ]*foraminal stenosis\b|\blateral recess stenosis\b|\bforaminal stenosis\b/i,
  },
  {
    id: "ligamentous-ossification",
    label: "OLF / OPLL canal compromise",
    rank: 6,
    re: /\b(?:olf|opll)\b|\bossification of the (?:ligamentum flavum|posterior longitudinal ligament)\b/i,
  },
  {
    id: "disc-extrusion",
    label: "focal disc extrusion / sequestration",
    rank: 6,
    re: /\bdisc (?:extrusion|sequestration)\b|\bsequestered disc\b|\bextruded disc (?:fragment|material)\b/i,
  },
  {
    id: "isthmic-pars",
    label: "isthmic / pars defect",
    rank: 7,
    re: /\bisthmic\b|\bspondylolysis\b|\bpars (?:interarticularis )?defect/i,
  },
  {
    id: "spondylolisthesis",
    label: "spondylolisthesis / malalignment",
    rank: 8,
    re: /\b(?:antero|reto)listhesis\b|\bspondylolisthesis\b/i,
  },
  {
    id: "fracture",
    label: "fracture",
    rank: 9,
    re: /\b(?:compression fracture|burst fracture|wedge fracture|insufficiency fracture|fracture)\b/i,
  },
  {
    id: "infection",
    label: "infection",
    rank: 10,
    re: /\bdiscitis\b|\bosteomyelitis\b|\bspondylodiscitis\b|\babscess\b|\bphlegmon\b|\binfection\b/i,
  },
  {
    id: "mass",
    label: "mass / marrow infiltrative lesion",
    rank: 11,
    re: /\b(?:mass|tumou?r|metastat\w*|myeloma|infiltrative)\b|\bmarrow lesion\b/i,
  },
  {
    id: "conus-cauda",
    label: "conus / cauda equina abnormality",
    rank: 12,
    re: /\bcauda equina\b|\bconus medullaris\b|\btethered cord\b|\barachnoiditis\b|\bfilum terminale\b/i,
  },
  {
    id: "postop-complication",
    label: "significant post-operative finding",
    rank: 13,
    re: /\bpost-?operative\b|\bpost-?surgical\b|\bstatus post\b|\bepidural fibrosis\b|\bpseudomeningocele\b|\bhardware\b|\brecurrent disc\b|\badjacent segment\b/i,
  },
  {
    id: "screening-significant",
    label: "significant screening abnormality",
    rank: 14,
    re: /\bscreening\b/i,
  },
  {
    id: "transitional-vertebra",
    label: "transitional vertebra / numbering",
    rank: 15,
    re: /\blumbosacral transitional vertebra\b|\blstv\b|\bcastellvi\b|\bbertolotti\b/i,
  },
  {
    id: "thoracic-deformity",
    label: "thoracic deformity / junctional angulation",
    rank: 16,
    re: /\bgibbus\b|\bkyphosis\b|\bkyphotic\b|\bscoliosis\b|\bjunctional angulation\b/i,
  },
  {
    id: "minor-degenerative",
    label: "minor degenerative change",
    rank: 90,
    re: /\b(?:mild|moderate) [a-z ]*(?:disc bulge|facet|spondylosis|degenerat|foraminal narrowing)\b|\bdisc desiccation\b|\bosteophytes?\b|\bmodic type(?:\s*(?:ii|iii|2|3))?\b|\bendplate changes\b|\bunremarkable\b/i,
  },
];

/** Anything unclassified sits between the specific findings and minor change. */
export const UNCLASSIFIED_RANK = 50;

export type RankedImpressionLine = {
  line: string;
  rank: number;
  label: string;
  ruleId: string | null;
  index: number;
};

/**
 * Classify one Impression line. The earliest matching rule wins, so the
 * sentence's own subject decides its category; ties break on rank.
 */
export function rankImpressionLine(line: string, index = 0): RankedImpressionLine {
  const text = (line ?? "").trim();
  let best: { rule: ImpressionPriorityRule; at: number } | null = null;
  for (const rule of IMPRESSION_PRIORITY) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const at = m.index;
    if (
      !best
      || at < best.at
      || (at === best.at && rule.rank < best.rule.rank)
    ) {
      best = { rule, at };
    }
  }
  if (!best) {
    return {
      line: text,
      rank: UNCLASSIFIED_RANK,
      label: "other finding",
      ruleId: null,
      index,
    };
  }
  return {
    line: text,
    rank: best.rule.rank,
    label: best.rule.label,
    ruleId: best.rule.id,
    index,
  };
}

export type ImpressionOrderOptions = {
  /** Set once the radiologist edits or reorders the Impression by hand. */
  frozen?: boolean;
  /**
   * Composition-specific classifier (the Dorso-Lumbar §26 order). Only the
   * categories change — this file stays the single place that sorts lines, so
   * the freeze rule cannot be missed by a second sorter.
   */
  rankLine?: (line: string, index: number) => RankedImpressionLine;
};

/**
 * Order Impression lines by clinical priority. Stable for equal ranks; a no-op
 * when frozen, so a hand-built Impression is never reshuffled.
 */
export function orderImpressionLines(
  lines: readonly string[],
  options: ImpressionOrderOptions = {},
): string[] {
  const list = lines.map((line) => (line ?? "").trim()).filter(Boolean);
  if (options.frozen) return list;
  const rank = options.rankLine ?? rankImpressionLine;
  return list
    .map((line, index) => rank(line, index))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((r) => r.line);
}

/** What the UI shows before applying, so nothing moves silently. */
export function impressionPriorityPreview(
  lines: readonly string[],
  options: ImpressionOrderOptions = {},
): Array<RankedImpressionLine & { moves: boolean }> {
  const list = lines.map((line) => (line ?? "").trim()).filter(Boolean);
  const ranked = list.map((line, index) => rankImpressionLine(line, index));
  if (options.frozen) return ranked.map((r) => ({ ...r, moves: false }));
  const order = [...ranked]
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((r) => r.index);
  return ranked.map((r) => ({ ...r, moves: order.indexOf(r.index) !== r.index }));
}

/**
 * Minor degeneration alone should not crowd the Impression (§37). Lines that
 * match only the lowest-priority category are Findings-only material.
 */
export function isImpressionWorthyLine(line: string): boolean {
  const worst = IMPRESSION_PRIORITY[IMPRESSION_PRIORITY.length - 1]!.rank;
  return rankImpressionLine(line).rank < worst;
}

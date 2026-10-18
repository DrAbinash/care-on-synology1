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

import type { SpineSegment } from "@/lib/reportingStudyContext";

export type ImpressionPriorityRule = {
  id: string;
  label: string;
  /** Lower sorts first. Mirrors the numbered order in spec §37. */
  rank: number;
  re: RegExp;
  /**
   * Segment scopes are OPTIONAL and additive. A rule with no `segments` is
   * the shipped ranking and applies to every study. A rule that only makes
   * clinical sense in one segment names it here, so extending one segment's
   * vocabulary can never silently re-rank another segment's already-shipped
   * impression — the same gating the spine prose engine uses for grammar.
   */
  segments?: readonly SpineSegment[];
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
    segments: ["dorsal"],
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
    segments: ["dorsal"],
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
    segments: ["dorsal"],
    rank: 16,
    re: /\bgibbus\b|\bkyphosis\b|\bkyphotic\b|\bscoliosis\b|\bjunctional angulation\b/i,
  },
  {
    /**
     * The owner's ruling of 2026-10-18, first clause: significant neural compression
     * outranks an uncomplicated spondylolisthesis. A disc that says what it does to the
     * sac or a root states that compression, so it is a compressive statement, not a
     * structural one, and it leaves the structural tier.
     *
     * Rank 6 is the whole of the decision, and it is deliberately not 4. The shipped
     * table already ranks definite nerve-root compression at 4 and any canal or foraminal
     * stenosis at 3/5, and the owner has not ruled that sac indentation outranks a
     * moderate central stenosis or a definite root compression — only that it outranks an
     * uncomplicated slip. Promoting it to 4 would have re-sequenced stenosis reports on
     * an inference; 6 moves it exactly as far as the ruling goes, into the tier the focal
     * extrusion already occupies.
     *
     * It matches at the same earliest position as `disc-protrusion-herniation` (both
     * start on "disc …"), and `rankImpressionLine` breaks an equal-position tie on the
     * lower rank, so this rule wins precisely when the sentence carries the compression
     * verb and loses precisely when it does not. No compression clause, no promotion.
     */
    id: "disc-compressing-neural-elements",
    label: "disc pathology compressing neural elements",
    rank: 6,
    re: /\bdisc (?:protrusion|herniation|prolapse|extrusion)\b[^.]*\b(?:compress\w*|imping\w*|indent\w*|effac\w*|flattening)\b[^.]*\b(?:thecal sac|dural sac|spinal cord|cauda equina|nerve root|root)\b|\b(?:thecal|dural) sac (?:compression|flattening|indentation)\b/i,
  },
  {
    /**
     * The owner's ruling of 2026-10-18, second clause: a disc herniation that says only
     * that it herniated does NOT automatically outrank a spondylolisthesis. It stays in
     * this structural tier, tied with the slip at rank 8, and the comparator resolves the
     * tie on anatomy then the stable rule id — never on the mouse. The earlier note here
     * read the same ruling as putting a sac-reaching protrusion *with* the slip; the
     * ruling is about a non-compressive herniation, and a protrusion that reaches the sac
     * is compressive, so it is classified by `disc-compressing-neural-elements` above.
     */
    id: "disc-protrusion-herniation",
    label: "disc protrusion / herniation",
    rank: 8,
    re: /\bdisc (?:protrusion|herniation|prolapse)\b|\bprotrusion\b[^.]*\b(?:thecal sac|dural sac)\b/i,
  },
  {
    /**
     * Tier four of the owner's ruling — bulges and moderate degenerative change.
     * These are the statements a lumbar report carries most often, and until now
     * none of them was classified at all, so all of them sat on
     * `UNCLASSIFIED_RANK` and the click order decided their sequence.
     */
    id: "disc-bulge",
    label: "disc bulge",
    rank: 20,
    re: /\bdiffuse disc bulge\b|\bdisc bulge\b/i,
  },
  {
    id: "moderate-canal-stenosis",
    label: "moderate canal stenosis",
    // Rank 5 with the shipped stenosis tier rather than with the bulges: the
    // table already ranks "moderate foraminal stenosis" at 5, and ranking a
    // moderate CENTRAL stenosis below a moderate foraminal one would invent a
    // hierarchy the owner did not rule on.
    rank: 5,
    re: /\bmoderate (?:central |spinal )?canal stenosis\b/i,
  },
  {
    id: "reduced-disc-height",
    label: "reduced disc height",
    rank: 20,
    re: /\breduced disc height\b|\bdisc height is reduced\b|\bdisc space narrowing\b/i,
  },
  {
    id: "facet-arthropathy",
    label: "facet arthropathy",
    rank: 20,
    re: /\bfacet arthropathy\b|\bfacet joint (?:arthropathy|hypertrophy)\b/i,
  },
  {
    id: "ligamentum-flavum-hypertrophy",
    label: "ligamentum flavum hypertrophy",
    rank: 20,
    re: /\bligamentum flavum hypertrophy\b|\blf hypertrophy\b/i,
  },
  {
    /**
     * Benign incidentals last but still in the Impression. 89 and not 90 because
     * `isImpressionWorthyLine` treats the lowest rank as Findings-only, and a
     * Schmorl node or a typical hemangioma is a statement the radiologist chose
     * to conclude, not background detail.
     */
    id: "benign-incidental",
    label: "benign incidental finding",
    rank: 89,
    re: /\bschmorl(?:'s)? node\b|\bhemangioma\b/i,
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
export function rankImpressionLine(
  line: string,
  index = 0,
  options: { spineSegment?: SpineSegment | null } = {},
): RankedImpressionLine {
  const text = (line ?? "").trim();
  let best: { rule: ImpressionPriorityRule; at: number } | null = null;
  for (const rule of IMPRESSION_PRIORITY) {
    if (rule.segments && !rule.segments.includes(options.spineSegment ?? "whole")) continue;
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
   * The spine segment the report is about. Rules that are scoped to a
   * segment are skipped for any other segment and when this is absent, so
   * every existing caller keeps the shipped ranking exactly.
   */
  spineSegment?: SpineSegment | null;
  /**
   * Composition-specific classifier (the Dorso-Lumbar §26 order). Only the
   * category TABLE changes: this file stays the single place that sorts
   * lines, so the freeze rule cannot be missed by a second sorter.
   */
  rankLine?: (line: string, index: number) => RankedImpressionLine;
};

/**
 * The shipped §37 classifier, scoped to the calling study's segment. A
 * composition with its own category table hands `rankLine` to the sorters
 * instead, so the choice of classifier happens in exactly one expression.
 */
function rankFor(spineSegment?: SpineSegment | null) {
  return (line: string, index: number): RankedImpressionLine =>
    rankImpressionLine(line, index, { spineSegment });
}

/**
 * Craniosacral sort key for one Impression line, so that two statements of the
 * same clinical priority order by anatomy instead of by the order the radiologist
 * happened to click them. `L4-L5` sorts before `L5-S1` on the L4, `T12` sorts
 * before `L1`. A line with no level in it sorts last within its tier, which is
 * where a summary sentence belongs.
 */
/** Spine order, so a tier tie resolves L2 before L5 and cervical before lumbar. */
const LEVEL_BASES = { c: 100, t: 200, l: 300, s: 400 } as const;

export function levelSortKey(line: string): number {
  const m = /\b([ctls])\s*(\d{1,2})\b/i.exec((line ?? "").trim());
  if (!m) return Number.MAX_SAFE_INTEGER;
  // The character class above admits exactly these four letters.
  const letter = m[1]!.toLowerCase() as keyof typeof LEVEL_BASES;
  return LEVEL_BASES[letter] + Number(m[2]);
}

/**
 * The one comparison every sorter here uses: clinical priority, then anatomy,
 * then the stable rule identifier, then the original position. Click order is
 * last, and only ever inside a tier that is otherwise completely identical.
 */
function compareRankedLines(a: RankedImpressionLine, b: RankedImpressionLine): number {
  return (a.rank - b.rank)
    || (levelSortKey(a.line) - levelSortKey(b.line))
    || ((a.ruleId ?? "").localeCompare(b.ruleId ?? ""))
    || (a.index - b.index);
}

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
  // A composition supplies its own category table; every other study uses the
  // shipped table, scoped to its segment. One sorter, one classifier choice.
  const rank = options.rankLine ?? rankFor(options.spineSegment);
  return list
    .map((line, index) => rank(line, index))
    .sort(compareRankedLines)
    .map((r) => r.line);
}

/** What the UI shows before applying, so nothing moves silently. */
export function impressionPriorityPreview(
  lines: readonly string[],
  options: ImpressionOrderOptions = {},
): Array<RankedImpressionLine & { moves: boolean }> {
  const list = lines.map((line) => (line ?? "").trim()).filter(Boolean);
  const rank = options.rankLine ?? rankFor(options.spineSegment);
  const ranked = list.map((line, index) => rank(line, index));
  if (options.frozen) return ranked.map((r) => ({ ...r, moves: false }));
  const order = [...ranked]
    .sort(compareRankedLines)
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

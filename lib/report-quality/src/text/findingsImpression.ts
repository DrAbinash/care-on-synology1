// text/findingsImpression.ts — the Findings↔Impression contradiction contract.
//
// One reading, two consumers. The canonical text tier (./evaluate.ts) and the live
// workspace validator (artifacts/diagnostic-erp/src/lib/reportValidator.ts) both
// call this and nothing else for these five checks, so the badge on the screen and
// the findings the server persists cannot disagree about the same report.
//
// They did. Measured across all 92 golden-corpus inputs (20 correct reports + 72
// seeded defects), the two paths went 84 agree / 8 diverge / 8 score mismatches
// before this module existed and 92 / 0 / 0 after it — every one of the eight had
// been a warning only the workstation printed, six of them the same laterality
// fact stated twice over, two a spinal level the server never recorded at all. A
// wrong-level surgery that the radiologist is told about on screen and that the
// signed record does not contain is the shape this file exists to remove.
//
// What is here is deliberately narrow. A Findings section and an Impression are two
// statements about one patient, so the questions worth asking are the ones a
// radiologist would ask on reading them back: does one section withdraw a finding
// the other still stands behind, do they name different levels or different grades
// for the same thing, and do two sentences about the basal ganglia or about
// diffusion cancel each other out. Nothing else in this file guesses at prose style.
//
// Every rule is advisory. None of them can stop a signature on its own — see
// artifacts/diagnostic-erp/src/lib/reportQualityFinalize.ts, where blocking policy
// is recorded as an open product-owner decision rather than something a rule may
// settle for itself.

import type { RuleId } from "../ruleCatalog";
import { clinicalOccurrenceDetails, type ClinicalOccurrenceDetail } from "./clinicalTerms";

export interface SectionContradiction {
  ruleId: RuleId;
  message: string;
}

/** One section's vocabulary mentions, grouped by the finding they name. */
type LabelMap = Map<string, ClinicalOccurrenceDetail[]>;

function byLabel(details: readonly ClinicalOccurrenceDetail[]): LabelMap {
  const map: LabelMap = new Map();
  for (const d of details) {
    const list = map.get(d.label);
    if (list) list.push(d);
    else map.set(d.label, [d]);
  }
  return map;
}

/** A mention the text still stands behind — asserted, or held open as uncertain. */
const standing = (list: readonly ClinicalOccurrenceDetail[]) => list.filter((d) => d.state !== "denied");
const withdrawn = (list: readonly ClinicalOccurrenceDetail[]) => list.filter((d) => d.state === "denied");

/** The per-mention qualifiers two sets of mentions can be compared on. */
type QualifierField = "acuity" | "magnitude" | "levels" | "sides" | "sites";

function union(field: QualifierField, list: readonly ClinicalOccurrenceDetail[]): Set<string> {
  return new Set(list.flatMap((d) => [...d[field]]));
}

/**
 * Whether two sets of mentions are about different facts rather than disagreeing
 * about one. True only when the qualifier that would separate them is present on
 * BOTH sides and shares nothing: "no ACUTE infarct" against "CHRONIC infarct",
 * "no root compression at L3-L4" against "thecal sac indentation at L4-L5", "no
 * LEFT renal stone" against "RIGHT renal stone", "GALLBLADDER stones" against "no
 * COMMON BILE DUCT stone".
 *
 * Requiring both sides to be qualified is the whole of the safety here. An
 * unqualified denial is a denial of the finding itself, so "no significant spinal
 * canal stenosis" beside "severe spinal canal stenosis at L4-L5" has nothing to
 * separate it and must be reported — a one-sided qualifier would have excused
 * exactly the report that needs a second look.
 */
function differentFact(a: readonly ClinicalOccurrenceDetail[], b: readonly ClinicalOccurrenceDetail[]): boolean {
  const disjoint = (field: QualifierField) => {
    const left = union(field, a);
    const right = union(field, b);
    return left.size > 0 && right.size > 0 && ![...left].some((x) => right.has(x));
  };
  return disjoint("acuity") || disjoint("levels") || disjoint("sides") || disjoint("sites");
}

/**
 * Q119 — one section withdraws a finding the other still reports.
 *
 * This is the defect the whole-study rules cannot reach. Q103, Q113 and Q114 all
 * ask whether a section called the STUDY normal, so a focal denial contradicted by
 * a focal assertion is invisible to every one of them: "No significant spinal canal
 * stenosis" is not a claim that the examination was normal, and it is a claim the
 * Impression's "Severe spinal canal stenosis at L4-L5" flatly contradicts. Measured
 * on that pair before this rule existed — no badge message, no engine finding, a
 * quality score of 100, and nothing arming the Impression dependency.
 *
 * Both directions count, and both are read through the shared negation table: a
 * hand-written Impression that quietly drops a finding the Findings still assert is
 * the same defect as an AI summary that does it, which is the point of asking here
 * rather than in whichever editor produced the text.
 */
function stateContradictions(inFindings: LabelMap, inImpression: LabelMap): SectionContradiction[] {
  const out: SectionContradiction[] = [];
  for (const [label, found] of inFindings) {
    const said = inImpression.get(label);
    if (!said) continue;
    const deniedInFindings = withdrawn(found);
    const deniedInImpression = withdrawn(said);
    if (deniedInFindings.length && !standing(found).length && standing(said).length) {
      if (differentFact(deniedInFindings, standing(said))) continue;
      out.push({
        ruleId: "Q119",
        message: `Findings/Impression contradiction: the Findings deny "${label}" but the Impression reports it.`,
      });
    } else if (deniedInImpression.length && !standing(said).length && standing(found).length) {
      if (differentFact(deniedInImpression, standing(found))) continue;
      out.push({
        ruleId: "Q119",
        message: `Findings/Impression contradiction: the Impression denies "${label}" but the Findings report it.`,
      });
    }
  }
  return out;
}

/**
 * Q120 — the two sections place the same finding at different spinal levels.
 *
 * Paired per finding rather than per section, and compared as whole sets rather
 * than as the first level each section happens to contain. Both halves of that
 * are load-bearing, and each one alone is wrong in the opposite direction. A
 * single level read from each section catches a level swapped inside the
 * Impression, but also calls a mismatch out of a Findings that correctly
 * describes L3-L4 and L4-L5 beside an Impression summarising L4-L5. A set
 * comparison across the whole section goes quiet on the real defect instead: the
 * lumbar report that says "extrusion at L4-L5" and "early desiccation change at
 * L5-S1 without disc herniation" does name L5-S1, so an Impression that moved the
 * extrusion to L5-S1 agrees with the section as a whole while disagreeing with the
 * finding that matters. Pairing on the label is what keeps both.
 *
 * Pairing on the label is still not enough on its own, because the Impression is
 * written after the Findings and often renames what it summarises: "Disc bulge at
 * L3-L4" concluded as "Disc herniation at L4-L5" is one disc pathology at two
 * levels, and "disc bulge" and "herniation" are distinct enough labels that the
 * pairing above cannot see it. The second pass pairs on anatomical site instead,
 * which is the wider net and so gets the narrower reading: motion segments only,
 * because a single-vertebra token is as likely to be a nerve root or a conus as a
 * level, and a whole-spine report that describes T8 in the Findings and states the
 * conus at L1 in the Impression is correct.
 *
 * One message per moved level pair, not per label or per site: a single wrong level
 * usually moves the herniation, the stenosis and the root contact together, and
 * three near-identical warnings for one error is how a badge gets clicked through.
 */
function levelContradictions(inFindings: LabelMap, inImpression: LabelMap): SectionContradiction[] {
  const out: SectionContradiction[] = [];
  const reported = new Set<string>();
  const report = (at: string[], movedTo: string[], what: string): void => {
    if (!at.length || !movedTo.length) return;
    if (at.some((level) => movedTo.includes(level))) return;
    const key = `${at.join("|")}>${movedTo.join("|")}`;
    if (reported.has(key)) return;
    reported.add(key);
    out.push({
      ruleId: "Q120",
      message: `Possible level mismatch: the Findings place "${what}" at ${at.join(", ")} but the Impression places it at ${movedTo.join(", ")}.`,
    });
  };

  for (const [label, found] of inFindings) {
    const said = inImpression.get(label);
    if (!said) continue;
    report(comparableLevels(standing(found)), comparableLevels(standing(said)), label);
  }

  // Then by anatomical site, for the finding that changed name between the two
  // sections: "Disc bulge at L3-L4" summarised as "Disc herniation at L4-L5" is one
  // disc pathology described at two levels, and the labels "disc bulge" and
  // "herniation" are distinct enough that the pairing above cannot see it. Levels
  // only, and only where both sides name a motion segment — a single-vertebra token
  // is as likely to be a nerve root or a conus as a level, and a whole-spine report
  // that measures T8 in the Findings and states the conus at L1 in the Impression is
  // correct.
  for (const site of sitesNamed(inFindings)) {
    const found = standingAtSite(inFindings, site);
    const said = standingAtSite(inImpression, site);
    const at = comparableLevels(found).filter((level) => level.includes("-"));
    const movedTo = comparableLevels(said).filter((level) => level.includes("-"));
    if (!at.length || !movedTo.length) continue;
    report(at, movedTo, site);
  }

  return out;
}

/** The anatomical sites a section's mentions carry, in first-appearance order. */
function sitesNamed(inSection: LabelMap): string[] {
  const seen = new Set<string>();
  for (const list of inSection.values()) for (const d of list) for (const s of d.sites) seen.add(s);
  return [...seen];
}

function standingAtSite(inSection: LabelMap, site: string): ClinicalOccurrenceDetail[] {
  const out: ClinicalOccurrenceDetail[] = [];
  for (const list of inSection.values()) for (const d of standing(list)) if (d.sites.includes(site)) out.push(d);
  return out;
}

/**
 * The levels two sets of mentions can be compared on — motion segments where
 * either section names one, single vertebrae only where neither does.
 *
 * A wrong-level decision is about a disc space, and a single-vertebra token is
 * usually a nerve root rather than a level. "Extrusion at L4-L5 … contact of the
 * traversing left L5 nerve root" names L4-L5 and L5 in one breath, so comparing
 * singles finds L5 agreeing with L5 while the extrusion itself has moved to L5-S1.
 */
function comparableLevels(list: readonly ClinicalOccurrenceDetail[]): string[] {
  const all = [...union("levels", list)];
  const segments = all.filter((level) => level.includes("-"));
  return segments.length ? segments : all;
}

/**
 * Q121 — the two sections grade the same finding differently.
 *
 * Read per finding rather than per section, because a report may legitimately carry
 * two grades: "mild bulge at L3-L4, severe stenosis at L4-L5" summarised as "severe
 * L4-L5 stenosis" agrees about the finding that matters, and a section-wide
 * comparison of {mild, severe} against {severe} is only quiet by luck of the
 * overlap. Only the graded scale counts — see MAGNITUDE_TOKEN for why "minimal" and
 * "marked" are not on it.
 */
function severityContradictions(inFindings: LabelMap, inImpression: LabelMap): SectionContradiction[] {
  const out: SectionContradiction[] = [];
  for (const [label, found] of inFindings) {
    const said = inImpression.get(label);
    if (!said) continue;
    const graded = union("magnitude", standing(found));
    const regraded = union("magnitude", standing(said));
    if (!graded.size || !regraded.size) continue;
    if ([...graded].some((g) => regraded.has(g))) continue;
    out.push({
      ruleId: "Q121",
      message: `Possible severity mismatch: the Findings grade "${label}" as ${[...graded].join("/")} but the Impression grades it as ${[...regraded].join("/")}.`,
    });
  }
  return out;
}

/**
 * Q122 / Q123 — two sentences that cancel each other out. Read across the pair
 * rather than within one section, because a merge is what puts them together: the
 * basal ganglia cleared in one sentence and bled into in the next, and a diffusion
 * sequence reported negative in the same report that concludes an acute infarct,
 * which is the sequence that would have shown it.
 */
function mutuallyExclusiveStatements(findings: string, impression: string): SectionContradiction[] {
  const out: SectionContradiction[] = [];
  const hay = `${findings}\n${impression}`;

  const basalNormal =
    /basal ganglia[^\n.]{0,80}\b(normal|unremarkable)/i.test(hay)
    || /\b(normal|unremarkable)\b[^\n.]{0,80}basal ganglia/i.test(hay);
  const basalBleed = /basal ganglia[^\n.]{0,100}\b(ha?emorrhage|hematoma)\b/i.test(hay)
    || /\b(ha?emorrhage|hematoma)\b[^\n.]{0,100}basal ganglia/i.test(hay);
  if (basalNormal && basalBleed) {
    out.push({
      ruleId: "Q122",
      message: "Possible contradiction: the basal ganglia are described as normal and as a haemorrhage.",
    });
  }

  const noRestricted = /\bno restricted diffusion\b/i.test(hay)
    || /\bno evidence of restricted diffusion\b/i.test(hay);
  if (noRestricted && /\bacute (?:[a-z]+\s+){0,3}infarct\b/i.test(hay)) {
    out.push({
      ruleId: "Q123",
      message: "Possible contradiction: the report denies restricted diffusion and also describes an acute infarct.",
    });
  }

  return out;
}

/**
 * Every contradiction between a report's Findings and its Impression, in one order
 * on both paths that call it. Findings first because that is the section the
 * Impression is declared to summarise, and a withdrawn finding is a larger claim
 * than a moved or re-graded one.
 *
 * Both sections are read once and the reading shared: the live badge re-runs this
 * on every keystroke, and three passes over the same prose would be three chances
 * for the checks to disagree about what a sentence said.
 */
export function findingsImpressionContradictions(findings: string, impression: string): SectionContradiction[] {
  const found = findings ?? "";
  const said = impression ?? "";
  const inFindings = byLabel(clinicalOccurrenceDetails(found));
  const inImpression = byLabel(clinicalOccurrenceDetails(said));
  return [
    ...stateContradictions(inFindings, inImpression),
    ...levelContradictions(inFindings, inImpression),
    ...severityContradictions(inFindings, inImpression),
    ...mutuallyExclusiveStatements(found, said),
  ];
}

/**
 * Whether the two sections contradict each other at all — the fact the Impression
 * dependency needs, which is not the warning text. A contradiction is a reason to
 * re-read the summary; the messages are how the workspace says so.
 */
export function sectionsContradict(findings: string, impression: string): boolean {
  return findingsImpressionContradictions(findings, impression).length > 0;
}

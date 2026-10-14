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
type QualifierField = "acuity" | "magnitude" | "levels" | "sides" | "sites" | "qualifiers";

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
 * Whether the denial is of a SUBSET of the finding rather than of the finding.
 *
 * {@link differentFact} cannot see this one, because it insists the separating
 * qualifier appears on both sides — and a subset word by definition appears on one.
 * "No suspicious masses or calcifications" beside two stable fibroadenomas with
 * coarse calcifications is the correct BI-RADS 2 mammogram, and "No new satellite
 * lesions" beside the enhancing lesion the Impression concludes on is the correct
 * glioma follow-up: in each the section cleared a subset and left the members
 * standing, so there is nothing for the other section to contradict.
 *
 * Every denied mention has to be subset-qualified, not one of them: a Findings that
 * says both "no lesions" and "no new lesions" has denied the finding outright in
 * the first sentence, and the second does not retract that.
 *
 * Known limit, left as the cheaper error. A disjunctive list — "no new or
 * additional lesions" beside an Impression that asserts a new one — reads as a
 * subset and stays quiet, because the prose does not mark whether the qualifiers
 * are conjoined or alternatives. Reporting it would need a reading of "or" that
 * this module does not have, and an advisory rule that marks up the clinic's own
 * benign mammography templates is a rule the badge gets clicked through.
 */
function deniesASubset(
  denied: readonly ClinicalOccurrenceDetail[],
  standing: readonly ClinicalOccurrenceDetail[],
): boolean {
  const said = union("qualifiers", standing);
  return denied.every((d) => d.qualifiers.some((q) => !said.has(q)));
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
 *
 * A denial only contradicts an assertion when it denies the same fact, so two
 * readings sit between the pair and the message: {@link differentFact} for a denial
 * qualified by an acuity, a level, a side or an organ the assertion does not share,
 * and {@link deniesASubset} for a denial that clears a subset — "no suspicious
 * masses" beside the benign masses the same report describes.
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
      if (deniesASubset(deniedInFindings, standing(said))) continue;
      out.push({
        ruleId: "Q119",
        message: `Findings/Impression contradiction: the Findings deny "${label}" but the Impression reports it.`,
      });
    } else if (deniedInImpression.length && !standing(said).length && standing(found).length) {
      if (differentFact(deniedInImpression, standing(found))) continue;
      if (deniesASubset(deniedInImpression, standing(found))) continue;
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
    const [at, movedTo] = comparableLevels(standing(found), standing(said));
    report(at, movedTo, label);
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
    const at = motionSegments(standingAtSite(inFindings, site));
    const movedTo = motionSegments(standingAtSite(inImpression, site));
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

/** The motion segments a set of mentions names, ignoring single vertebrae. */
function motionSegments(list: readonly ClinicalOccurrenceDetail[]): string[] {
  return [...union("levels", list)].filter((level) => level.includes("-"));
}

/**
 * The levels two sets of mentions can be compared on — motion segments where
 * either section names one, single vertebrae only where neither does.
 *
 * Read as a pair, because the unit is a property of the pair and not of either
 * section. Choosing per section is what marked up two of the clinic's own canned
 * formats as wrong-level when both were right: a cervical Findings that says "from
 * C4 through C6" names two vertebrae, and the Impression that concludes "C4-C5 and
 * C5-C6 cord signal change" names two disc spaces; a lumbar Findings at L5-S1 and
 * an Impression spelling the same junction "L5 over S1" are one level counted two
 * ways. Neither has moved anything. Where either side names a motion segment the
 * other is read as naming none, and the caller says nothing.
 *
 * A wrong-level decision is about a disc space, and a single-vertebra token is
 * usually a nerve root rather than a level. "Extrusion at L4-L5 … contact of the
 * traversing left L5 nerve root" names L4-L5 and L5 in one breath, so comparing
 * singles finds L5 agreeing with L5 while the extrusion itself has moved to L5-S1.
 */
function comparableLevels(
  inFindings: readonly ClinicalOccurrenceDetail[],
  inImpression: readonly ClinicalOccurrenceDetail[],
): [string[], string[]] {
  const at = [...union("levels", inFindings)];
  const movedTo = [...union("levels", inImpression)];
  const atSegments = motionSegments(inFindings);
  const movedSegments = motionSegments(inImpression);
  if (atSegments.length || movedSegments.length) return [atSegments, movedSegments];
  return [at, movedTo];
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
 *
 * The abnormal half of each pair is read from the shared occurrence table rather
 * than from a regex over the concatenation, because a regex over both sections
 * cannot tell a statement from its own denial. Seven of the clinic's canned brain
 * formats say "No acute infarct" and "No restricted diffusion on DWI/ADC" in the
 * same Findings — the correct normal report — and `/\bacute … infarct\b/` matches
 * inside the denial, so all seven were marked up as contradicting themselves. The
 * normal half stays a regex: "appear normal in signal" is not a vocabulary term.
 */
function mutuallyExclusiveStatements(
  findings: string,
  impression: string,
  details: readonly ClinicalOccurrenceDetail[],
): SectionContradiction[] {
  const out: SectionContradiction[] = [];
  const hay = `${findings}\n${impression}`;

  const basalNormal =
    /basal ganglia[^\n.]{0,80}\b(normal|unremarkable)/i.test(hay)
    || /\b(normal|unremarkable)\b[^\n.]{0,80}basal ganglia/i.test(hay);
  const basalBleed = details.some(
    (d) => d.label === "haemorrhage" && d.state !== "denied" && d.sites.includes("basal ganglia"),
  );
  if (basalNormal && basalBleed) {
    out.push({
      ruleId: "Q122",
      message: "Possible contradiction: the basal ganglia are described as normal and as a haemorrhage.",
    });
  }

  const noRestricted = /\bno restricted diffusion\b/i.test(hay)
    || /\bno evidence of restricted diffusion\b/i.test(hay);
  const acuteInfarct = details.some(
    (d) => d.label === "infarct" && d.state !== "denied" && d.acuity.includes("acute"),
  );
  if (noRestricted && acuteInfarct) {
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
  const foundDetails = clinicalOccurrenceDetails(found);
  const saidDetails = clinicalOccurrenceDetails(said);
  const inFindings = byLabel(foundDetails);
  const inImpression = byLabel(saidDetails);
  return [
    ...stateContradictions(inFindings, inImpression),
    ...levelContradictions(inFindings, inImpression),
    ...severityContradictions(inFindings, inImpression),
    ...mutuallyExclusiveStatements(found, said, [...foundDetails, ...saidDetails]),
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

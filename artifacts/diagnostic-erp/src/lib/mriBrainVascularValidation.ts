/**
 * mriBrainVascularValidation.ts — vascular contradiction and support checks (§19).
 *
 * `mriBrainContradictions.ts` is the right tool for a sentence about the parenchyma, and
 * it already covers three of §19's bullets for the whole report (enhancement without
 * contrast, diffusion wording without DWI/ADC, blooming without GRE/SWI). What it cannot
 * do is tell which VESSEL a sentence is about: its rules are whole-report regexes, so a
 * report that says the right MCA is patent and the left vertebral artery is occluded
 * would look self-contradictory. §19's vascular bullets are all scoped to "the same
 * vessel", so each sentence here is read through the vessel registry and a pair only
 * contradicts itself when it names the same vessel and side.
 *
 * Three kinds of subject are recognised, in that order of precedence:
 *   - the vessels the sentence names ("the left MCA M1");
 *   - the vessels of the paragraph around it, for a clause the composer split off on its
 *     own ("Severe stenosis." carries no vessel name but belongs to the vessel above it);
 *   - the whole family, when the sentence speaks plurally ("the major intracranial
 *     arteries are normal" is a claim about every intracranial artery, so a named
 *     occlusion does contradict it) or about nothing at all ("occlusion is seen").
 *
 * Three further passes come from the same section:
 *
 *   - `VASCULAR_STATEMENT_RULES` (the §19 wording→acquisition table that ships with the
 *     technique module) says which wording needs which acquisition. This is where it is
 *     consumed: an acquisition the radiologist never stated is a question to answer, not
 *     a finding to delete. A sentence that DENIES the wording ("without filling defect")
 *     is not a claim the technique has to support.
 *   - A calculated value must still agree with the numbers it came from. The aneurysm
 *     sentence prints its dome, its neck and the ratio it derived, so a later hand edit
 *     that breaks the arithmetic is detectable rather than merely possible — and it is
 *     re-checked with the same `aneurysmAspectRatio` the calculator used.
 *   - A numeric stenosis must say where the number came from, a clinical word must match
 *     its own percentage, and a screening-only study must not carry dedicated-workflow
 *     claims.
 *
 * Every result is a warning string. Nothing here blocks finalisation: §19 ends by
 * requiring that radiologist-controlled manual reporting stay possible.
 *
 * Pure functions only — no store, no React.
 */

import {
  vesselConceptEntries,
  vesselsForTerritory,
  vesselsMentionedIn,
  type VascularTerritory,
  type VesselDefinition,
} from "./mriBrainVessels";
import { ALL_VASCULAR_TILES } from "./mriBrainVascularSubMasters";
import { screeningConceptEntries } from "./mriBrainVascularScreening";
import {
  STENOSIS_DESCRIPTORS,
  STENOSIS_PROVENANCE_LABELS,
  stenosisDescriptorConflict,
} from "./mriBrainVascularStenosis";
import { aneurysmAspectRatio } from "./mriBrainMeasures";
import {
  VASCULAR_STATEMENT_RULES,
  vascularGate,
  type VascularTechniqueState,
} from "./mriBrainVascularTechnique";
import type { BrainSequenceContext } from "./mriBrainSequences";

/** Which vessels a rule is allowed to compare. */
export type VascularRuleTerritory = "arterial" | "venous" | "any";

export type VascularContradictionRule = {
  id: string;
  /** A sentence denying the abnormality / asserting the normal. */
  normalRe: RegExp;
  /** A sentence asserting it. Sentences that deny it are not assertions. */
  abnormalRe: RegExp;
  label: string;
  territory: VascularRuleTerritory;
  /**
   * Rules that describe one clinical pair twice (§19 lists the venous normal-versus-
   * thrombosis case generally and then again for an occlusively thrombosed sinus). For a
   * given vessel only the most specific rule of a group speaks.
   */
  group: string;
  priority: number;
};

/**
 * §19's list of what must be detected, as data. The predicates say only what is being
 * asserted — which vessel is being talked about comes from the registry, so a normal and
 * an abnormal sentence about two different arteries never look like a contradiction.
 */
export const BRAIN_VASCULAR_CONTRADICTION_RULES: readonly VascularContradictionRule[] = [
  {
    id: "vessel_normal_vs_occluded",
    normalRe: /\bpatent\b|\bnormal course\b|\bnormal calibe?r\b|\blumen calibe?r\b|\bpreserved (?:venous )?flow(?: signal| voids)?\b|\bnormal flow (?:signal|voids)\b/i,
    abnormalRe: /\b(?<!non-)occlusi\w*\b|\bnot visuali[sz]ed\b|\bnon-?visuali[sz]ation\b|\babsent flow signal\b/i,
    label: "a vessel is called both patent and occluded",
    territory: "arterial",
    group: "occlusion",
    priority: 10,
  },
  {
    id: "vessel_normal_vs_severe_stenosis",
    normalRe: /\bwithout\b[^.]{0,40}?\b(?:stenos\w*|narrowing)\b|\bno\b[^.]{0,40}?\b(?:stenos\w*|narrowing)\b|\bpatent\b|\bnormal (?:course and )?calibe?r\b|\blumen calibe?r\b|\bnormal course\b|\bsymmetric calibe?r\b/i,
    abnormalRe: /\b(?:severe|high[- ]grade|critical|flow[- ]limiting)\b[^.]{0,40}?\bstenos\w*|\bstenos\w*\b[^.]{0,40}?\b(?:severe|high[- ]grade|critical|flow[- ]limiting)\b/i,
    label: "a vessel is called both normal-calibre and severely stenosed",
    territory: "arterial",
    group: "stenosis",
    priority: 10,
  },
  {
    id: "aneurysm_denied_vs_described",
    normalRe: /\b(?:no|without)\b[^.]{0,60}?\baneurysm/i,
    abnormalRe: /\baneurysm\b|\baneurysmal outpouching\b/i,
    label: "the report denies an aneurysm and describes one",
    territory: "arterial",
    group: "aneurysm",
    priority: 10,
  },
  {
    id: "venous_normal_vs_thrombosis",
    normalRe: /\bpatent\b|\bpreserved venous flow\b|\bnormal venous flow\b|\bvenous flow signal is normal\b/i,
    abnormalRe: /\bthromb(?:us|osis)\b|\bclot\b/i,
    label: "the venous system is called both patent and thrombosed",
    territory: "venous",
    group: "thrombosis",
    priority: 5,
  },
  {
    id: "sinus_patent_vs_occlusive_thrombus",
    normalRe: /\bpatent\b|\bpreserved venous flow signal\b/i,
    abnormalRe: /\bocclusive (?:thrombus|thrombosis)\b/i,
    label: "a sinus is called patent and occlusively thrombosed",
    territory: "venous",
    group: "thrombosis",
    priority: 20,
  },
  {
    id: "sinus_normal_caliber_vs_hypoplasia",
    normalRe: /\bnormal\b[^.]{0,30}?\bcalibe?r\b|\bnormal[- ]sized\b|\bcalibe?r\b[^.]{0,30}?\bnormal\b/i,
    abnormalRe: /\bhypoplasia\b|\baplasia\b|\bhypoplastic\b|\baplastic\b/i,
    label: "a sinus is called both normal-calibre and hypoplastic/aplastic",
    territory: "venous",
    group: "caliber",
    priority: 10,
  },
  {
    id: "hemorrhage_denied_vs_described",
    normalRe: /\b(?:no|without)\b[^.]{0,60}?\b(?:haemorrhage|hemorrhage|blood products|subarachnoid blood)\b/i,
    abnormalRe: /\b(?:haemorrhage|hemorrhage|haemorrhagic|hemorrhagic|subarachnoid blood|extravasated blood)\b/i,
    label: "the report denies haemorrhage and describes it",
    territory: "any",
    group: "hemorrhage",
    priority: 10,
  },
];

/** Paragraphs are what the composer emits per observation; sentences are what it says. */
function blocks(text: string): string[] {
  return text.split(/\n+/).map((b) => b.trim()).filter(Boolean);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const DENIAL_RE = /\bno\b|\bnot\b|\bwithout\b|\babsence\b|\babsence of\b|\bfree of\b|\bnegative for\b|\bno evidence\b/i;

/**
 * "Not visualized" is an abnormality, "no aneurysm" is a denial, and the difference is
 * which words the negation covers — so the negation is tested on the sentence with the
 * matched wording removed, rather than on the whole sentence.
 */
function asserts(sentence: string, re: RegExp): boolean {
  const match = sentence.match(re);
  if (!match || match.index == null) return false;
  const rest = `${sentence.slice(0, match.index)} ${sentence.slice(match.index + match[0].length)}`;
  return !DENIAL_RE.test(rest);
}

const ARTERIAL_FAMILY_RE = /\b(?:arter(?:ie)s|vessels|circulation)\b/i;
const VENOUS_FAMILY_RE = /\b(?:sinus(?:es)?|veins)\b/i;

/** The families a sentence speaks about collectively rather than one by one. */
function familyTerritories(sentence: string): VascularTerritory[] {
  const out: VascularTerritory[] = [];
  if (ARTERIAL_FAMILY_RE.test(sentence)) {
    const intracranial = /intracranial|willis|circle of willis/i.test(sentence);
    const neck = /extracranial|cervical|carotid|\bneck\b/i.test(sentence);
    if (!intracranial && !neck) {
      out.push("intracranialArterial", "neckArterial");
    } else {
      if (intracranial) out.push("intracranialArterial");
      if (neck) out.push("neckArterial");
    }
  }
  if (VENOUS_FAMILY_RE.test(sentence)) out.push("venous");
  return out;
}

function territoryMatches(
  vesselTerritory: VascularTerritory,
  territory: VascularRuleTerritory,
): boolean {
  if (territory === "any") return true;
  return territory === "venous"
    ? vesselTerritory === "venous"
    : vesselTerritory !== "venous";
}

function inTerritory(vessel: VesselDefinition, territory: VascularRuleTerritory): boolean {
  return territoryMatches(vessel.territory, territory);
}

function territoryPool(territory: VascularRuleTerritory): VesselDefinition[] {
  if (territory === "venous") return vesselsForTerritory("venous");
  if (territory === "arterial") {
    return [...vesselsForTerritory("intracranialArterial"), ...vesselsForTerritory("neckArterial")];
  }
  return [
    ...vesselsForTerritory("intracranialArterial"),
    ...vesselsForTerritory("neckArterial"),
    ...vesselsForTerritory("venous"),
  ];
}

/**
 * The vessels a sentence makes a claim about.
 *
 * An empty set means the sentence belongs to this rule's territory but names nothing in
 * it — which is not "everything", so it never contradicts a named vessel. A sentence that
 * names nothing anywhere, or speaks of a family as a whole, does claim everything.
 */
function claimSubjects(
  sentence: string,
  block: string,
  territory: VascularRuleTerritory,
): Set<string> {
  const named = vesselsMentionedIn(sentence);
  const blockNamed = named.length ? [] : vesselsMentionedIn(block);
  const pool = (named.length ? named : blockNamed).filter((v) =>
    inTerritory(v, territory),
  );
  const subjects = new Set(pool.map((v) => v.key));
  const families = familyTerritories(sentence).filter((family) =>
    territoryMatches(family, territory),
  );
  for (const family of families) {
    for (const vessel of vesselsForTerritory(family)) {
      subjects.add(vessel.key);
    }
  }
  // Only a clause in a paragraph that names nothing anywhere is a claim about the whole
  // tree. A split-off clause ("Severe stenosis.") belongs to the vessel its own
  // paragraph already named above.
  if (!named.length && !blockNamed.length && !families.length) {
    for (const vessel of territoryPool(territory)) subjects.add(vessel.key);
  }
  return subjects;
}

/**
 * §19's same-vessel normal-versus-abnormal pairs.
 */
export function vascularTextContradictions(opts: {
  findingsText: string;
  impressionText?: string;
}): string[] {
  const text = [opts.findingsText, opts.impressionText ?? ""].filter(Boolean).join("\n");
  const paragraphs = blocks(text);
  const labels = new Map<string, string>();
  for (const vessel of territoryPool("any")) labels.set(vessel.key, vessel.label);
  const best = new Map<string, { rule: VascularContradictionRule; subjects: string[] }>();

  for (const rule of BRAIN_VASCULAR_CONTRADICTION_RULES) {
    const normalKeys = new Set<string>();
    const abnormalKeys = new Set<string>();
    let normals = 0;
    let abnormals = 0;
    for (const block of paragraphs) {
      for (const sentence of sentences(block)) {
        // A single sentence can carry both halves ("patent but occluded distally"), so the
        // two pools are tested independently rather than as alternatives.
        if (rule.normalRe.test(sentence)) {
          normals += 1;
          for (const key of claimSubjects(sentence, block, rule.territory)) normalKeys.add(key);
        }
        if (asserts(sentence, rule.abnormalRe)) {
          abnormals += 1;
          for (const key of claimSubjects(sentence, block, rule.territory)) abnormalKeys.add(key);
        }
      }
    }
    if (!normals || !abnormals) continue;
    const overlap = [...normalKeys].filter((key) => abnormalKeys.has(key));
    // Two disjoint sets are two different vessels, which §19 explicitly must not warn.
    if (!overlap.length) continue;

    const key = `${rule.group}|${[...overlap].sort().join(",")}`;
    const previous = best.get(key);
    if (previous && previous.rule.priority >= rule.priority) continue;
    best.set(key, { rule, subjects: overlap.map((k) => labels.get(k) ?? k) });
  }

  return [...best.values()].map(
    ({ rule, subjects }) =>
      `Vascular contradiction: ${rule.label}${subjects.length ? ` — ${subjects.join(", ")}` : ""}.`,
  );
}

/** Statements the recorded acquisition cannot support (§4, §19). */
export function vascularUnsupportedStatementWarnings(opts: {
  findingsText: string;
  impressionText?: string;
  technique: VascularTechniqueState | null | undefined;
  brain: BrainSequenceContext;
}): string[] {
  const text = [opts.findingsText, opts.impressionText ?? ""].filter(Boolean).join("\n");
  const lines = sentences(text);
  const warnings: string[] = [];
  for (const statement of VASCULAR_STATEMENT_RULES) {
    // "Without a filling defect" is not a filling-defect claim, so the same denial test
    // the contradiction rules use decides whether the wording was actually stated.
    if (!lines.some((line) => asserts(line, statement.re))) continue;
    const gate = vascularGate(statement.feature, opts.technique, opts.brain);
    if (gate.allowed) continue;
    warnings.push(
      `Vascular support: the report states ${statement.label}, but ${gate.missing.join(" / ")} is not recorded. ${gate.notice}`,
    );
  }
  return warnings;
}

const RATIO_RE = /\b(?:dome[- /]neck|dome[- ]to[- ]neck|aspect)?\s*ratio\s+(?:of\s+)?(\d+(?:[.,]\d+)?)/i;
const DOME_RE = /\bdome(?:\s+height)?\s+(\d+(?:[.,]\d+)?)\s*mm|\b(\d+(?:[.,]\d+)?)\s*mm\s+dome/i;
const NECK_RE = /\bneck(?:\s+width)?\s+(\d+(?:[.,]\d+)?)\s*mm|\b(\d+(?:[.,]\d+)?)\s*mm\s+neck/i;

/**
 * §19: "aneurysm ratio inconsistent with entered source measurements". Both builders in
 * this app print the dome, the neck and the derived ratio in one sentence, so the check
 * reads the sentence and re-runs `aneurysmAspectRatio` — the same arithmetic the input
 * used. Hand-editing any of the three numbers is what this catches.
 */
export function vascularMeasurementInconsistencies(opts: {
  findingsText: string;
  impressionText?: string;
}): string[] {
  const text = [opts.findingsText, opts.impressionText ?? ""].filter(Boolean).join("\n");
  const warnings: string[] = [];
  for (const line of sentences(text)) {
    const ratio = line.match(RATIO_RE)?.[1];
    const dome = line.match(DOME_RE)?.[1] ?? line.match(DOME_RE)?.[2];
    const neck = line.match(NECK_RE)?.[1] ?? line.match(NECK_RE)?.[2];
    if (!ratio || !dome || !neck) continue;
    const expected = aneurysmAspectRatio(Number(dome), Number(neck));
    if (expected == null) continue;
    if (Math.abs(expected - Number(ratio)) > 0.011) {
      warnings.push(
        `Vascular measurement: a dome-to-neck ratio of ${ratio} does not follow from the entered dome (${dome} mm) and neck (${neck} mm), which give ${expected}. Edit the measurements, not the calculated value.`,
      );
    }
  }
  return [...new Set(warnings)];
}

/** The same §19 numeric-stenosis wording the technique table already declares. */
const NUMERIC_STENOSIS_RE =
  VASCULAR_STATEMENT_RULES.find((r) => r.feature === "numericStenosis")?.re
  ?? /\d{1,3}\s*%/;

const PROVENANCE_LABELS = Object.values(STENOSIS_PROVENANCE_LABELS) as string[];

/**
 * §19: "numeric NASCET without required measurement/provenance". A calculated row prints
 * its provenance clause in the same paragraph as its percentage, so the paragraph is the
 * unit — a number that reaches the report in a paragraph saying nothing about where it
 * came from is either hand-typed or an edited row.
 */
export function vascularUnattributedNumbers(opts: {
  findingsText: string;
  impressionText?: string;
}): string[] {
  const text = [opts.findingsText, opts.impressionText ?? ""].filter(Boolean).join("\n");
  const warnings: string[] = [];
  for (const block of blocks(text)) {
    if (!NUMERIC_STENOSIS_RE.test(block)) continue;
    if (/no measurement provenance recorded/i.test(block)) {
      warnings.push(
        "Vascular provenance: a numeric stenosis is reported as having no measurement provenance (§11).",
      );
      continue;
    }
    if (/measurement source:/i.test(block)) continue;
    if (PROVENANCE_LABELS.some((label) => block.includes(label))) continue;
    warnings.push(
      "Vascular provenance: a numeric stenosis is reported without the acquisition or caliper it was measured on (§11).",
    );
  }
  return [...new Set(warnings)];
}

/**
 * A number and a clinical word in the same paragraph must describe the same stenosis.
 * `stenosisDescriptorConflict` already decides that at input time; this is the same check
 * on the printed report, so an edited sentence cannot quietly disagree with itself.
 */
export function vascularDescriptorNumberDisagreements(opts: {
  findingsText: string;
  impressionText?: string;
}): string[] {
  const text = [opts.findingsText, opts.impressionText ?? ""].filter(Boolean).join("\n");
  const warnings: string[] = [];
  for (const block of blocks(text)) {
    const percent = block.match(/\b(\d{1,3})\s*%/)?.[1];
    if (percent == null || !/\bstenos\w*|\bnarrowing\b/i.test(block)) continue;
    const descriptor = STENOSIS_DESCRIPTORS.find((word) =>
      new RegExp(`\\b${word.replace("-", "[- ]")}\\b`, "i").test(block),
    );
    if (!descriptor) continue;
    const conflict = stenosisDescriptorConflict(descriptor, Number(percent));
    if (conflict) warnings.push(`Vascular measurement: ${conflict}`);
  }
  return [...new Set(warnings)];
}

/** Dedicated-workflow wording a screening-only study cannot carry (§14, §19). */
export const SCREENING_ONLY_DEDICATED_RE =
  /\bNASCET\b|\bdome[- /]to[- ]?neck\b|\bdome[- /]neck\b|\bdome height\b|\bSpetzler\b|\bintramural (?:h|ae)ematoma\b|\bvessel[- ]wall\b|\bsegment[- ]by[- ]segment\b|\bnidus\b|\bearly (?:venous )?drainage\b/i;

export function vascularScreeningOverreach(opts: {
  findingsText: string;
  impressionText?: string;
  screeningOnly: boolean;
}): string[] {
  if (!opts.screeningOnly) return [];
  const text = [opts.findingsText, opts.impressionText ?? ""].filter(Boolean).join("\n");
  const claims = [
    ...new Set(
      [...text.matchAll(new RegExp(SCREENING_ONLY_DEDICATED_RE.source, "gi"))].map((m) => m[0]),
    ),
  ];
  if (!claims.length) return [];
  return [
    `Vascular scope: this study carries basic intracranial MRA screening only, but the report states ${claims
      .map((c) => `"${c}"`)
      .join(", ")}. A dedicated acquisition is needed for that assessment (§14).`,
  ];
}

/**
 * Whether the report was built by the screening pass rather than a dedicated vascular
 * module. Both vocabularies come from the modules that own them, so a new tile or a new
 * screening row moves this answer without editing a prefix list here.
 */
export function vascularIsScreeningOnly(
  concepts: Iterable<string | null | undefined>,
): boolean {
  const dedicated = new Set<string>([
    ...vesselConceptEntries().map((entry) => entry.concept),
    ...ALL_VASCULAR_TILES.flatMap((tile) => tile.atoms.map((atom) => atom.concept)),
  ]);
  const screening = new Set(screeningConceptEntries().map((entry) => entry.concept));
  const written = [...concepts].map((c) => c ?? "");
  return written.some((c) => screening.has(c)) && !written.some((c) => dedicated.has(c));
}

/**
 * Everything §19 asks of the vascular report, as the one call the workspace makes.
 * Warnings only: the banner never blocks finalisation, and the radiologist keeps the
 * report. The three sequence bullets (contrast / DWI / GRE-SWI wording) are already
 * produced by `brainTextContradictions` and are deliberately not repeated here.
 */
export function brainVascularContradictions(opts: {
  findingsText: string;
  impressionText?: string;
  technique?: VascularTechniqueState | null;
  brain: BrainSequenceContext;
  screeningOnly?: boolean;
}): string[] {
  const warnings = [
    ...vascularTextContradictions(opts),
    ...vascularUnsupportedStatementWarnings({
      findingsText: opts.findingsText,
      impressionText: opts.impressionText,
      technique: opts.technique,
      brain: opts.brain,
    }),
    ...vascularScreeningOverreach({
      findingsText: opts.findingsText,
      impressionText: opts.impressionText,
      screeningOnly: Boolean(opts.screeningOnly),
    }),
    ...vascularMeasurementInconsistencies(opts),
    ...vascularDescriptorNumberDisagreements(opts),
    ...vascularUnattributedNumbers(opts),
  ];
  return [...new Set(warnings)];
}

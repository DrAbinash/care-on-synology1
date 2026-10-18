/**
 * pathologyPatch.ts — smart pathology overlays on a whole-report draft.
 *
 * Reuses reportFieldMerge sentence split/dedupe and provenance rules.
 * A Quick Select / macro patch owns an anatomical block (anatomicalSection /
 * conflictGroup / baselineReplaces — already on clinic Quick Findings).
 * Matching normal or contradictory sentences in Findings/Impression are
 * replaced; unrelated and manually edited sentences are left alone.
 */

import {
  mergeReportFieldContentWithProvenance,
  normalizeForDedupe,
  provenanceFromText,
  splitToSentences,
  fuzzySentenceSimilarity,
  isLightSentenceEdit,
  type FieldProvenanceMap,
  type InsertSource,
} from "./reportFieldMerge";
import { applySide, type Side } from "./sideSwap";
import { fillTemplate, type AbnormalityInstance } from "./abnormalityEngine";
import { stripNormalImpressionLinesProvenanceAware } from "./quickFindingsMerge";
import { assertsAbnormality } from "./generateLocalImpression";
import { globalNormalsSupersededBy } from "./conceptCanon/contentPacks";
import {
  buildCanonicalObservation,
  conceptsAssertedIn,
  extractLevel,
  hasStructuredOwnership,
  liveContributionKeys,
  normalizeLevel,
  sentenceOwnedBySlot,
  type ContributionRow,
} from "./observationSlot";

export type PathologyOwnership = {
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  /** Resolved slot concept — distinct from conflictGroup. */
  concept?: string | null;
  level?: string;
  laterality?: string;
  slotKey?: string;
};

export type ReportNarrative = {
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
};

export type NarrativeProvenance = Partial<Record<keyof ReportNarrative, FieldProvenanceMap>>;

export type PathologyIncoming = {
  findings?: string;
  impression?: string;
  technique?: string;
  recommendation?: string;
};

const ANATOMY_ALIASES: Array<{ key: string; re: RegExp }> = [
  // Brain / CNS
  { key: "basal ganglia", re: /basal ganglia|putamen|caudate|globus pallidus|internal capsule/i },
  { key: "white matter", re: /white matter|fazekas|periventricular/i },
  { key: "mca", re: /\bmca\b|middle cerebral/i },
  { key: "ventricle", re: /ventricular system|ventricles|cisternal/i },
  // Spine
  { key: "disc", re: /\bdisc\b|herniation|bulge/i },
  { key: "cord", re: /spinal cord|thecal sac|canal stenosis/i },
  // Abdomen / USG organs
  { key: "liver", re: /\bliver\b|hepatic|hepatomegaly/i },
  { key: "gallbladder", re: /\bgallbladder\b|gall bladder|cholecyst/i },
  { key: "cbd", re: /\bcbd\b|common bile duct|choledoch/i },
  { key: "pancreas", re: /\bpancreas\b|pancreatic/i },
  { key: "spleen", re: /\bspleen\b|splenic/i },
  { key: "kidney", re: /\bkidney\b|renal|kidneys/i },
  { key: "ureter", re: /\bureter\b|ureteric/i },
  { key: "bladder", re: /\bbladder\b|urinary bladder|vesical/i },
  { key: "prostate", re: /\bprostate\b|prostatic/i },
  { key: "uterus", re: /\buterus\b|uterine|endometri/i },
  { key: "ovary", re: /\bovary\b|ovarian|adnexa/i },
  { key: "appendix", re: /\bappendix\b|appendiceal|vermiform/i },
  { key: "bowel", re: /\bbowel\b|intestin|colon|sigmoid|rectum/i },
  { key: "aorta", re: /\baorta\b|aortic/i },
  { key: "thyroid", re: /\bthyroid\b|thyroidal/i },
  { key: "breast", re: /\bbreast\b|mammary/i },
];

const PATHOLOGY_TERMS = [
  // Severe / acute
  "hemorrhage", "haemorrhage", "infarct", "restricted diffusion",
  "herniation", "stenosis", "fracture", "mass", "tumor", "tumour", "lesion",
  // USG-common abnormalities
  "fatty liver", "fatty infiltration", "hepatomegaly", "cholelithiasis",
  "cholecystitis", "sludge", "polyp", "cyst", "calculus", "calculi",
  "nephrolith", "nephrolithiasis", "hydronephrosis", "hydroureter",
  "prostatomegaly", "pyelonephritis", "cystitis", "ascites",
  "pleural effusion", " collection", "abscess", "pancreatitis",
  "appendicitis", "obstruction", "perforation", "metastasis",
  "cirrhosis", "fibrosis", "echogenic", "hypoechoic",
  "hyperechoic", "heterogeneous", "focal", "nodule",
];

const DENIAL = /\b(no|without|absence of|unremarkable|normal|not identified|not seen|free of|no evidence|no definite|no obvious|no apparent|no focal|no significant|no abnormal|no mass|no lesion|no collection|no effusion|no hernia|no fracture|no displacement)\b/i;

export function inferOwnership(label: string, texts: string[]): PathologyOwnership {
  // Legacy fallback only — prefer explicit Quick Select / chocolate metadata.
  // Do not call this to auto-persist clinically significant ownership.
  const hay = `${label}\n${texts.join("\n")}`;
  for (const a of ANATOMY_ALIASES) {
    if (a.re.test(hay)) return { anatomicalSection: a.key, conflictGroup: a.key };
  }
  const term = PATHOLOGY_TERMS.find((t) => hay.toLowerCase().includes(t));
  if (term) return { conflictGroup: term };
  return { anatomicalSection: (label || "").trim() || undefined };
}

function anatomyKeys(ownership: PathologyOwnership, incoming: string): string[] {
  const keys = new Set<string>();
  const section = (ownership.anatomicalSection ?? "").trim().toLowerCase();
  if (section) keys.add(section);
  const group = (ownership.conflictGroup ?? "").trim().toLowerCase();
  if (group) keys.add(group);
  for (const a of ANATOMY_ALIASES) {
    if (a.re.test(incoming) || (section && a.re.test(section))) keys.add(a.key);
  }
  return [...keys];
}

function sentenceMentions(sentence: string, keys: string[]): boolean {
  const s = sentence.toLowerCase();
  return keys.some((k) => k.length >= 3 && s.includes(k));
}

function assertedPathology(text: string): string[] {
  const lower = text.toLowerCase();
  return PATHOLOGY_TERMS.filter((t) => {
    if (!lower.includes(t)) return false;
    const idx = lower.indexOf(t);
    const window = lower.slice(Math.max(0, idx - 40), idx);
    return !DENIAL.test(window);
  });
}

function deniesPathology(sentence: string, terms: string[]): boolean {
  const lower = sentence.toLowerCase();
  return terms.some((t) => lower.includes(t) && DENIAL.test(lower));
}

function isManualSentence(sentence: string, provenance: FieldProvenanceMap | undefined): boolean {
  const key = normalizeForDedupe(sentence);
  const src = provenance?.[key];
  if (!src || src.length === 0) return false;
  return src.length === 1 && src[0] === "manual";
}

/** Fuzzy threshold for lightly edited owned baseline sentences. */
const FUZZY_OWNED_BASELINE_THRESHOLD = 0.65;

/**
 * True when `sentence` is only a small clinical descriptor tweak of `baseline`
 * (e.g. "unremarkable" → "largely unremarkable"). Authorship annotations
 * ("— radiologist rewrite", "kept manual") are NOT descriptor tweaks.
 */
function isDescriptorOnlyBaselineEdit(baseline: string, sentence: string): boolean {
  if (!(
    fuzzySentenceSimilarity(sentence, baseline) >= FUZZY_OWNED_BASELINE_THRESHOLD
    || isLightSentenceEdit(baseline, sentence)
  )) {
    return false;
  }
  if (/\b(radiologist|rewrite|kept manual|do not overwrite|don'?t overwrite)\b/i.test(sentence)
    && !/\b(radiologist|rewrite|kept manual|do not overwrite|don'?t overwrite)\b/i.test(baseline)) {
    return false;
  }
  // New em-dash / en-dash annotation clause → radiologist authorship, not a descriptor.
  if (/[—–].{6,}/.test(sentence) && !/[—–].{6,}/.test(baseline)) {
    return false;
  }
  const baseTokens = new Set(normalizeForDedupe(baseline).split(" ").filter((t) => t.length > 2));
  const nextTokens = new Set(normalizeForDedupe(sentence).split(" ").filter((t) => t.length > 2));
  let added = 0;
  for (const t of nextTokens) if (!baseTokens.has(t)) added++;
  return added <= 3;
}

/** Template/protocol-sourced sentences should always be replaceable by pathology.
 * Purely manual or materially rewritten sentences need the ambiguous/force guard.
 * Section 4: a small descriptor tweak of an owned baseline may still sync.
 * Radiologist-authored edits (including light QS-chip edits that stamp `manual`)
 * stay protected so re-select opens the overwrite dialog.
 */
export function isProtectedManualSentence(
  sentence: string,
  provenance: FieldProvenanceMap | undefined,
  opts?: { baselineReplaces?: string },
): boolean {
  const baseline = (opts?.baselineReplaces ?? "").trim();
  const key = normalizeForDedupe(sentence);
  const src = provenance?.[key];
  const hasRadiologistAuthorship = Boolean(
    src?.includes("manual") || src?.includes("radiologist-voice"),
  );

  // Owned-baseline descriptor tweaks remain replaceable (Section 4).
  if (baseline && isDescriptorOnlyBaselineEdit(baseline, sentence)) {
    return false;
  }

  // Any radiologist authorship signal protects the sentence.
  if (hasRadiologistAuthorship) return true;

  if (!src || src.length === 0) return false;
  return src.every((s) => s === "manual" || s === "radiologist-voice");
}

/**
 * Resolves a template's parameters against values the radiologist chose.
 *
 * `severity` joins `side` here because the substitution path used to hard-code
 * `severity: ""` into the instance it renders with: a tile that asked
 * "how severe?" could never be answered, so the only two outcomes were literal
 * `{severity}` in the report (when no side was supplied and `fillTemplate` never
 * ran) or the token silently deleted (when a side was supplied and it did). Both
 * are refused at the boundary now — see
 * `zai-workspace/quickSelectParameterContract`.
 *
 * Callers that pass no severity keep the previous behaviour exactly: the early
 * return means their templates are untouched, which is what the structured-format
 * and macro surfaces rely on to fill `{level}` / `{value}` themselves.
 */
export function applySideToIncoming(
  incoming: PathologyIncoming,
  side: Side | "",
  severity: AbnormalityInstance["severity"] = "",
): PathologyIncoming {
  if (!side && !severity) return incoming;
  const inst: AbnormalityInstance = {
    side, severity, chronicity: "", level: "", value: "",
  };
  const fill = (t?: string) => {
    if (!t) return t;
    if (t.includes("{side}") || t.includes("{severity}")) return fillTemplate(t, inst);
    return side ? applySide(t, side) : t;
  };
  return {
    findings: fill(incoming.findings),
    impression: fill(incoming.impression),
    technique: fill(incoming.technique),
    recommendation: fill(incoming.recommendation),
  };
}

export interface ManualKeptSentences {
  findings: string[];
  impression: string[];
}

export interface PathologyPatchResult {
  narrative: ReportNarrative;
  provenance: NarrativeProvenance;
  /** True when a manually edited anatomy sentence would have been replaced. */
  ambiguous: boolean;
  /**
   * Which sentences those were, per field. `ambiguous` says a collision happened;
   * this names the words at risk, so the confirm dialog can show the radiologist
   * the line it is about to delete instead of only the slot that caused it.
   */
  manualKept: ManualKeptSentences;
  replacedSentences: string[];
}

const SCREENING_SECTION_BREAK =
  /\n(?=CERVICAL SPINE SCREENING|DORSAL SPINE SCREENING|THORACIC SPINE SCREENING|WHOLE SPINE SCREENING)/;

/** Keep detailed-study pathology in the detailed block, not after screening. */
function placeIncomingBeforeScreening(fieldText: string, incoming: string | undefined): string {
  const inc = (incoming ?? "").trim();
  if (!inc || !fieldText.includes(inc)) return fieldText;
  const br = fieldText.match(SCREENING_SECTION_BREAK);
  if (!br || br.index == null) return fieldText;
  const incAt = fieldText.lastIndexOf(inc);
  if (incAt < br.index) return fieldText;
  const without = `${fieldText.slice(0, incAt)}${fieldText.slice(incAt + inc.length)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  const nextBr = without.match(SCREENING_SECTION_BREAK);
  if (!nextBr || nextBr.index == null) return fieldText;
  return `${without.slice(0, nextBr.index).trimEnd()}\n${inc}${without.slice(nextBr.index)}`;
}

/**
 * Overlay pathology text onto a whole-report narrative.
 * Never drops unrelated sentences. Manual anatomy sentences are kept and
 * flagged `ambiguous` so the existing overwrite dialog can confirm.
 */
/**
 * Layout lines, not clinical sentences.
 *
 * A report authored as a document — `Disc Level Analysis:` then one readable
 * line per level — has to survive a Quick Select click. Three rules follow:
 * a sub-heading line, a `|` measurement row and a blank separator are never
 * ownable by a tile; a line that opens with a level token keeps that level for
 * every sentence inside it, so one line per level stays clause-targetable; and
 * replacement text goes back where the replaced sentence sat, because text
 * appended at the end of the field prints under whatever heading comes next.
 */
const LINE_LEVEL_PREFIX =
  /^((?:[CDLSST]\s?\d{1,2}\s?[-–—/]\s?(?:S\s?1|[CDLSST]\s?\d{1,2})|S1)\s*:)\s*/i;

/** A line that is only a label ending in a colon — a heading, not a sentence. */
const HEADING_LINE = /^[^|:\n]{1,60}:$/;

function moveIncomingIntoSection(
  lines: string[],
  incoming: string,
  slot: number,
  existingText: string,
): { lines: string[]; inserted: string[] } {
  const already = new Set(splitToSentences(existingText).map((s) => normalizeForDedupe(s)));
  const inserted: string[] = [];
  for (const s of splitToSentences(incoming)) {
    const key = normalizeForDedupe(s);
    if (!key || already.has(key)) continue;
    inserted.push(s);
    already.add(key);
  }
  if (inserted.length === 0) return { lines, inserted };
  const at = Math.min(Math.max(slot, 0), lines.length);
  return { lines: [...lines.slice(0, at), ...inserted, ...lines.slice(at)], inserted };
}

export function applyPathologyPatch(opts: {
  existing: ReportNarrative;
  incoming: PathologyIncoming;
  ownership: PathologyOwnership;
  provenance?: NarrativeProvenance;
  source?: InsertSource;
  /** When true, replace matching manually edited anatomy sentences. */
  force?: boolean;
  /**
   * The other LIVE ledger rows. A finding one of them already rendered is never
   * evicted by this patch — see `liveContributionKeys`, whose comment records why a
   * live row's NORMAL statements stay retirable and what that leaves open. Pass
   * nothing and the patch behaves exactly as it was before, which is what keeps the
   * single-patch tests honest.
   */
  liveRows?: readonly ContributionRow[];
}): PathologyPatchResult {
  const source: InsertSource = opts.source ?? "quick-findings";
  const incomingHay = [
    opts.incoming.findings, opts.incoming.impression,
    opts.incoming.technique, opts.incoming.recommendation,
  ].filter(Boolean).join("\n");
  // Phase 5 — the sentence fence. Keys of findings other live rows already
  // rendered; `owns` below refuses to evict them. Null when the caller passes no
  // ledger, which keeps every single-patch caller exactly as it was tested.
  const protectedKeys = opts.liveRows ? liveContributionKeys(opts.liveRows) : null;
  const slotObs = buildCanonicalObservation({
    concept: opts.ownership.concept,
    conflictGroup: opts.ownership.conflictGroup,
    anatomicalSection: opts.ownership.anatomicalSection,
    baselineReplaces: opts.ownership.baselineReplaces,
    // A tile that names a level owns ONLY that level. Without this, "Disc
    // herniation L4-L5" matched every level's normal sentence and deleted all
    // five, leaving the other discs silent about herniation. Reading the level
    // out of the tile's own wording engages the existing level gate, and a tile
    // that names no level behaves exactly as before.
    level: opts.ownership.level || extractLevel(incomingHay),
    laterality: opts.ownership.laterality,
  });
  // Structured replace only when a concept resolved. A slotKey of `region|*|*|*`
  // is identity, not ownership — unowned findings keep the legacy pathology path.
  const structured = hasStructuredOwnership(slotObs);
  // A compound finding falsifies more than its own concept. The baseline walk
  // below only had the tile's single declared concept to test with, so a basal
  // ganglia hemorrhage retired "No intracranial hemorrhage is seen." and left
  // "Basal ganglia and thalami are normal in signal intensity." standing in the
  // same paragraph — the signed report asserted both. The extra concepts come
  // from the tile's own words through the same oracle the catalogue tests use.
  //
  // Level-bearing tiles are deliberately excluded: spinal ownership is
  // level-scoped by design, and "Disc herniation L4-L5" already widened to every
  // level once and deleted all five normals. Cranial statements carry no level.
  const alsoOwns = structured && !slotObs.level
    ? conceptsAssertedIn(incomingHay, slotObs.concept).filter((c) => c !== slotObs.concept)
    : [];
  const claimedConcepts = new Set([slotObs.concept, ...alsoOwns].filter(Boolean) as string[]);
  // A new statement may overwrite an existing ABNORMAL statement only when it
  // says at least everything that statement says. "Cerebral edema" shares the
  // word edema with "right mass lesion with surrounding edema and mass effect",
  // and on the concept test alone it owned that sentence — so clicking the edema
  // box after the mass box deleted the tumour from the report. Requiring the
  // existing claim to be covered keeps a grade-2 Fazekas replacing a grade-1 one
  // (same concepts, higher grade) while a second, different abnormality can only
  // ever be added beside it.
  const overwritesAbnormalClaim = (probe: string): boolean =>
    !assertsAbnormality(probe)
    || conceptsAssertedIn(probe, slotObs.concept).every((c) => claimedConcepts.has(c));
  const keys = anatomyKeys(opts.ownership, incomingHay);
  const asserted = assertedPathology(incomingHay);
  const baseline = (opts.ownership.baselineReplaces ?? "").trim();
  let ambiguous = false;
  const replacedSentences: string[] = [];
  const manualKept: ManualKeptSentences = { findings: [], impression: [] };

  const patchField = (
    field: "findings" | "impression",
    existing: string,
    incoming: string | undefined,
    provenance: FieldProvenanceMap | undefined,
  ): { text: string; provenance: FieldProvenanceMap } => {
    const incomingOrgans = new Set<string>();
    if (!structured) {
      for (const a of ANATOMY_ALIASES) {
        if (a.re.test(incomingHay)) incomingOrgans.add(a.key);
      }
    }

    const owns = (probe: string, unit: string): boolean => {
      // Phase 5 — an undeclared pair prints both findings. Ownership read off
      // prose must never evict a finding another live observation rendered. The
      // radiologist's manual text has its own protection further down this loop;
      // a tile's contribution is the same class of thing, and losing it is worse
      // because the ledger still says the finding was reported.
      if (protectedKeys?.has(normalizeForDedupe(unit))
        || protectedKeys?.has(normalizeForDedupe(probe))) return false;
      return structured
        ? sentenceOwnedBySlot(probe, {
          concept: slotObs.concept ?? opts.ownership.concept ?? null,
          level: slotObs.level || opts.ownership.level || "",
          laterality: slotObs.laterality || opts.ownership.laterality || "",
          anatomicalSection: slotObs.anatomicalSection,
          baselineReplaces: baseline,
          alsoOwns,
          supersedesGlobals: globalNormalsSupersededBy(slotObs.concept ?? opts.ownership.concept ?? null),
        }) && overwritesAbnormalClaim(probe)
        : Boolean(
          (baseline && probe.includes(baseline))
          || sentenceMentions(probe, keys)
          || (asserted.length > 0 && deniesPathology(probe, asserted))
          || (incomingOrgans.size > 0 && asserted.length > 0 &&
            [...incomingOrgans].some((org) => sentenceMentions(probe, [org]))),
        );
    };

    // Walk the field line by line so a document keeps its document shape.
    const lines = existing.split(/\r?\n/);
    const keptLines: string[] = [];
    /** Where the replaced sentence sat — the replacement goes back here. */
    let replacementSlot = -1;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("|") || HEADING_LINE.test(trimmed)) {
        keptLines.push(rawLine);
        continue;
      }
      const prefixMatch = trimmed.match(LINE_LEVEL_PREFIX);
      const prefix = prefixMatch ? prefixMatch[1].trim() : "";
      const body = prefixMatch ? trimmed.slice(prefixMatch[0].length) : trimmed;
      const units = splitToSentences(body);
      if (units.length === 0) {
        keptLines.push(rawLine);
        continue;
      }
      const keep: string[] = [];
      for (const u of units) {
        // The line's level is part of the sentence for ownership purposes, so
        // `L4-L5: …no herniation…` is reachable by the L4-L5 tile even when the
        // clause itself does not repeat the level.
        const probe = prefix ? `${prefix} ${u}` : u;
        if (!owns(probe, u)) {
          keep.push(u);
          continue;
        }
        // Provenance is keyed by the text as it was written, which may or may
        // not carry the line's level token — a manual "L4-L5: …" line is stored
        // whole. Test both forms, or the radiologist's own wording would lose
        // the protection that makes a re-select ask before overwriting.
        const protectedManual =
          isProtectedManualSentence(u, provenance, { baselineReplaces: baseline })
          || (prefix && isProtectedManualSentence(probe, provenance, { baselineReplaces: baseline }));
        if (protectedManual && !opts.force) {
          ambiguous = true;
          manualKept[field].push(probe);
          keep.push(u);
          continue;
        }
        replacedSentences.push(probe);
        if (replacementSlot < 0) replacementSlot = keptLines.length;
      }
      if (keep.length === 0) continue;
      keptLines.push(prefix ? `${prefix} ${keep.join(" ")}` : keep.join(" "));
    }

    const keptText = keptLines.join("\n");
    const keptProv: FieldProvenanceMap = {};
    for (const s of splitToSentences(keptText)) {
      const k = normalizeForDedupe(s);
      if (k && provenance?.[k]) keptProv[k] = provenance[k]!;
    }
    if (!incoming?.trim()) {
      return { text: keptText, provenance: keptProv };
    }

    // Nothing was replaced and the field is not a document: keep the established
    // merge rules (dedupe, light-edit folding, subsequence handling).
    const isDocument = lines.some((l) => HEADING_LINE.test(l.trim()))
      || lines.some((l) => LINE_LEVEL_PREFIX.test(l.trim()));
    if (replacementSlot < 0 && (field !== "findings" || !isDocument)) {
      return mergeReportFieldContentWithProvenance({
        field,
        existing: keptText,
        incoming,
        source,
        existingProvenance: keptProv,
      });
    }

    /**
     * A document keeps its document shape. The generic merge cannot do this: it
     * re-splits every line into sentences and rejoins with a single newline, so
     * a level line is shredded into fragments and the text lands under whatever
     * heading happens to follow. Instead the incoming sentences go where the
     * replaced clause sat, or — when nothing was replaced — after the last line
     * of the same level, so L4-L5 wording stays in the L4-L5 neighbourhood.
     */
    let slot = replacementSlot;
    if (slot < 0) {
      const wantLevel = slotObs.level || opts.ownership.level || "";
      const lastWithLevel = keptLines.reduce(
        (acc, line, i) => {
          const m = line.trim().match(LINE_LEVEL_PREFIX);
          if (!m) return acc;
          const norm = normalizeLevel(m[1]);
          return norm && norm === normalizeLevel(wantLevel) ? i : acc;
        },
        -1,
      );
      slot = lastWithLevel >= 0 ? lastWithLevel + 1 : keptLines.length;
    }

    const placed = moveIncomingIntoSection(keptLines, incoming, slot, keptText);
    const mergedProv = { ...keptProv, ...provenanceFromText(placed.inserted.join("\n"), source) };
    return { text: placed.lines.join("\n"), provenance: mergedProv };
  };

  const findings = patchField(
    "findings",
    opts.existing.findings,
    opts.incoming.findings,
    opts.provenance?.findings,
  );
  const findingsPlaced = {
    ...findings,
    text: placeIncomingBeforeScreening(findings.text, opts.incoming.findings),
  };

  const impressionIncoming = opts.incoming.impression ?? "";
  const impression = patchField(
    "impression",
    opts.existing.impression,
    impressionIncoming || undefined,
    opts.provenance?.impression,
  );
  let impressionText = impression.text;
  // PR #662 §2 — provenance-aware normal-impression stripping.
  //
  // When abnormal content is inserted, strip leftover template-default
  // normal-impression lines (e.g. "Normal MRI Brain" applied by a Full
  // Report Format). This is PROVENANCE-AWARE: only template / protocol /
  // companion / ai-draft sources are auto-strippable. Sources that own
  // their text (manual, radiologist-voice, quick-select, quick-findings,
  // structured-template, macro, system) are NEVER stripped by this regex
  // sweep — they survive intact and continue to be owned by their
  // original producers.
  //
  // The system-owned normal patch is handled separately by
  // `applyPathologyOverlay` (auto-yield via removeLedgerObservation) before
  // this function is called. This regex sweep is only for non-patch
  // template-default impression text.
  const hasAbnormalContent = asserted.length > 0 || replacedSentences.length > 0;
  if (hasAbnormalContent) {
    // A box that asserts pathology contradicts a "Normal MRI …" impression even
    // when it brings no impression line of its own. Keying the sweep on the
    // impression's own contents used to print that false normality.
    impressionText = stripNormalImpressionLinesProvenanceAware(
      splitToSentences(impressionText),
      {
        onlyIfAbnormal: asserted.length === 0,
        provenance: opts.provenance?.impression,
      },
    ).join("\n");
  }

  const technique = opts.incoming.technique?.trim()
    ? mergeReportFieldContentWithProvenance({
      field: "technique",
      existing: opts.existing.technique,
      incoming: opts.incoming.technique,
      source,
      existingProvenance: opts.provenance?.technique ?? {},
    })
    : { text: opts.existing.technique, provenance: opts.provenance?.technique ?? {} };

  const recommendation = opts.incoming.recommendation?.trim()
    ? mergeReportFieldContentWithProvenance({
      field: "recommendation",
      existing: opts.existing.recommendation,
      incoming: opts.incoming.recommendation,
      source,
      existingProvenance: opts.provenance?.recommendation ?? {},
    })
    : { text: opts.existing.recommendation, provenance: opts.provenance?.recommendation ?? {} };

  return {
    narrative: {
      clinicalHistory: opts.existing.clinicalHistory,
      technique: technique.text,
      findings: findingsPlaced.text,
      impression: impressionText,
      recommendation: recommendation.text,
    },
    provenance: {
      clinicalHistory: opts.provenance?.clinicalHistory,
      technique: technique.provenance,
      findings: findingsPlaced.provenance,
      impression: impression.provenance,
      recommendation: recommendation.provenance,
    },
    ambiguous,
    manualKept,
    replacedSentences,
  };
}

/** Exact-replace previously inserted pathology text after a laterality change. */
export function relateralizeOwnedText(
  fieldText: string,
  previous: string,
  next: string,
): string {
  const prev = previous.trim();
  const nxt = next.trim();
  if (!prev || prev === nxt) return fieldText;
  if (!fieldText.includes(prev)) return fieldText;
  return fieldText.replace(prev, nxt);
}

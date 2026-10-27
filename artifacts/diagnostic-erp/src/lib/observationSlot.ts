/**
 * Canonical runtime observation / slot helper (ownership Phase 1–2).
 *
 * Identity (slotKey) and mutex (conflict) are distinct.
 * Provenance (fieldProvenance) is not ownership — do not use source color as a slot.
 *
 * Concept resolution (runtime only; concept !== conflictGroup in the type):
 *   explicit concept → conflictGroup → safe label/section fallback.
 * Broad anatomy words (disc, spine, brain, …) never become exclusive concepts.
 */

import {
  SLOT_WILDCARD,
  normalizeSlotPart,
  normalizeLevel,
  normalizeLaterality,
  persistenceOwnershipSlotKey,
} from "@workspace/baseline-manifest";
import {
  normalizeForDedupe,
  splitToSentences,
  type FieldProvenanceMap,
  type InsertSource,
} from "./reportFieldMerge";
import type { PathologyIncoming, PathologyOwnership } from "./pathologyPatch";
import { fieldContainsContribution } from "./observationMatch";
import type { ObservationAnchor } from "./observationAnchor";
import { coerceObservationAnchor } from "./observationAnchor";
import {
  resolveCanonicalConcept,
  canonicalConceptTokens,
  generateConceptCanonRecord,
  normaliseConceptKey,
} from "./conceptCanon/conceptCanon";
import { CLINICAL_CONTENT_PACKS, contentPackForConcept } from "./conceptCanon/contentPacks";
import { assertsAbnormality, assertsNormalStatement } from "./generateLocalImpression";

export {
  SLOT_WILDCARD,
  normalizeSlotPart,
  normalizeLevel,
  normalizeLaterality,
};

/**
 * The dorsal spine is spelled `D` on screen and on the page — the same letter the
 * ledger stores, so reading a level back no longer rewrites it. A level that
 * arrives in the older `T` spelling (a draft saved before this, or typed by hand)
 * is relabelled to `D` rather than left as a second name for one vertebra.
 * Only a boundary token is touched, so lumbar and cervical keys pass through
 * untouched.
 */
export function displayLevel(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/(^|[^A-Za-z])T(?=\d)/g, "$1D");
}

export type ConceptResolutionSource = "explicit" | "conflictGroup" | "legacy-fallback" | "none";

export type ObservationRole = "finding" | "impression" | "recommendation" | "baseline" | "screening";
export type ObservationSpecificity = "protocol" | "study" | "region" | "family";
export type MacroSectionOwned = "findings" | "impression" | "recommendation" | "technique";

export type ObservationSlotInput = {
  id?: string;
  catalogId?: number | string;
  region?: string | null;
  /** Distinct from conflictGroup — only set when a caller already has a concept. */
  concept?: string | null;
  conflictGroup?: string | null;
  anatomicalSection?: string | null;
  label?: string | null;
  findingsText?: string | null;
  impressionText?: string | null;
  recommendationText?: string | null;
  level?: string | null;
  laterality?: string | null;
  supportsLaterality?: boolean;
  properties?: string | null;
  baselineReplaces?: string | null;
  source?: InsertSource;
  bundleId?: string | null;
  sectionsOwned?: MacroSectionOwned[];
  role?: ObservationRole;
  specificity?: ObservationSpecificity;
  state?: string | null;
  severity?: string | null;
  measurement?: string | null;
  /** Creation-time image provenance (optional; old drafts omit). */
  anchor?: ObservationAnchor | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/** Runtime observation. `concept` is resolved; `conflictGroup` is the raw catalog field. */
export type CanonicalObservation = {
  id: string;
  catalogId?: number | string;
  region: string;
  anatomicalSection: string;
  concept: string | null;
  conceptSource: ConceptResolutionSource;
  conflictGroup: string;
  level: string;
  laterality: string;
  state: string;
  severity: string;
  measurement: string;
  slotKey: string;
  source: InsertSource;
  baselineReplaces: string;
  supportsLaterality: boolean;
  bundleId: string;
  sectionsOwned: MacroSectionOwned[];
  role: ObservationRole;
  specificity: ObservationSpecificity;
  /** Optional creation-time FRAMES/OHIF provenance snapshot. */
  anchor?: ObservationAnchor;
  createdAt?: string;
  updatedAt?: string;
};

/** Anatomy words that must not be exclusive ownership when structured metadata exists. */
export const BROAD_ANATOMY = new Set([
  "disc", "discs", "spine", "cord", "brain", "white matter", "parenchyma",
  "liver", "kidney", "kidneys", "chest", "abdomen", "organ",
]);

const REGION_NAMES = new Set([
  "brain", "cervical spine", "dorsal spine", "ls spine", "whole spine", "spine",
  "chest", "abdomen", "knee", "shoulder", "breast", "ob", "pns", "pelvis",
]);

/**
 * Concept canon — GENERATED at module load from clinical content packs.
 *
 * The source of truth is `CLINICAL_CONTENT_PACKS` in
 * `conceptCanon/contentPacks.ts`. Editing that array is the ONLY way to
 * add or modify clinical concept aliases. There is no second synonym engine.
 *
 * Kept as a const for fast lookup; the underlying record is frozen by the
 * generator so accidental mutation fails loudly in strict mode.
 */
const CONCEPT_CANON: Readonly<Record<string, string>> = generateConceptCanonRecord();

/**
 * Regex hints for resolving concepts from narrative text when no explicit
 * concept / conflictGroup was supplied. These remain narrowly-scoped
 * (fazekas / ventricles / disc_contour) — broad fallback would be unsafe.
 */
const CONCEPT_HINTS: Array<{ concept: string; re: RegExp }> = [
  { concept: "fazekas", re: /\bfazekas\b/i },
  { concept: "ventricles", re: /\bhydrocephalus\b|\bnormal ventricles\b|\bventricular system\b/i },
  { concept: "disc_contour", re: /\b(disc\s+)?(bulge|herniation|protrusion|no bulge|disc contour)\b/i },
];

export function isBroadAnatomy(raw: string | null | undefined): boolean {
  const n = normalizeSlotPart(raw);
  if (!n) return false;
  if (BROAD_ANATOMY.has(n) || REGION_NAMES.has(n)) return true;
  return [...BROAD_ANATOMY].some((w) => n === w);
}

/** Regional buckets for Whole Spine screening ownership (not disc levels). */
const REGIONAL_LEVEL_BUCKETS = new Set(["cervical", "dorsal", "lumbar"]);

export function extractLevel(...texts: Array<string | null | undefined>): string {
  for (const t of texts) {
    const n = normalizeLevel(t);
    if (n) return n;
    const from = extractLevelFromText(t);
    if (from) return from;
  }
  return "";
}

function extractLevelFromText(raw: string | null | undefined): string {
  const t = (raw ?? "").toUpperCase();
  const m = t.match(/\b([LCDST])\s*(\d{1,2})\s*[-\/]\s*([LCDST])?\s*(\d{1,2})\b/);
  if (!m) return "";
  return normalizeLevel(`${m[1]}${m[2]}-${m[3] || m[1]}${m[4]}`);
}

export function sentenceHasLevel(sentence: string, level: string): boolean {
  const want = normalizeLevel(level);
  if (!want) return true;
  if (REGIONAL_LEVEL_BUCKETS.has(want)) {
    const s = sentence.toLowerCase();
    if (want === "dorsal") return /\b(dorsal|thoracic)\b/.test(s);
    if (want === "lumbar") return /\b(lumbar|lumbosacral)\b/.test(s);
    return s.includes(want);
  }
  const got = extractLevelFromText(sentence);
  if (got) return got === want;
  // Compact forms: L4L5, L4 5
  const compactWant = want.replace(/-/g, "");
  const compactSent = sentence.toUpperCase().replace(/[–—\s\/]/g, "").replace(/T/g, "D");
  return compactSent.includes(compactWant);
}

/** A stray sequence name ("T2", "STIR") reads as a level here, which is the
 * safe direction: it only ever blocks a replacement, never authorises one. */
const ANY_LEVEL_MENTION = /\b[CDLSST]\s?\d{1,2}\b/i;

/** "Lumbosacral" matches its own word only, so "sacral" cannot leak out of it. */
const ANY_REGION_MENTION =
  /\b(cervical|craniovertebral|cervicothoracic|thoracolumbar|dorsal|thoracic|lumbar|lumbosacral|sacral|sacroiliac)\b/i;

function namesAnyLevel(sentence: string): boolean {
  return extractLevelFromText(sentence) !== "" || ANY_LEVEL_MENTION.test(sentence);
}

/**
 * The region words a level-bearing observation calls its own — the words its own
 * region names itself with in prose. The level's prefix letter IS the region:
 * `L4-L5` is a lumbar level, `C5-C6` cervical, `D8-D9` dorsal (`normalizeLevel`
 * rewrites T to D; both keys map the same set so no caller has to care).
 *
 * Deliberately NOT included, because a word that stays a pin can only ever keep
 * a sentence on the page — the safe direction — while a word that stops being
 * one can delete a sentence that is still true:
 *  - "lumbosacral" usually names the L5-S1 junction, not the whole lumbar
 *    territory, so an L1-L4 tile must not own a lumbosacral-worded sentence;
 *  - "sacral" / "sacroiliac" are the sacral territory's own words, and a
 *    lumbar-level observation never owns another territory's claims;
 *  - "craniovertebral" / "cervicothoracic" / "thoracolumbar" name junctions,
 *    and a sentence about a junction is that site's claim, not the region's.
 */
const OWN_REGION_WORDS_BY_LEVEL_PREFIX: Readonly<Record<string, ReadonlySet<string>>> = {
  L: new Set(["lumbar"]),
  C: new Set(["cervical"]),
  D: new Set(["dorsal", "thoracic"]),
  T: new Set(["dorsal", "thoracic"]),
  S: new Set(),
};

/** Does the sentence name a region the observation is not itself part of? */
function namesForeignRegion(sentence: string, own: ReadonlySet<string>): boolean {
  const re = /\b(cervical|craniovertebral|cervicothoracic|thoracolumbar|dorsal|thoracic|lumbar|lumbosacral|sacral|sacroiliac)\b/gi;
  for (const m of sentence.matchAll(re)) {
    if (!own.has(m[1]!.toLowerCase())) return true;
  }
  return false;
}

/**
 * The level gate's study-wide test, region-aware.
 *
 * A study-wide normal names no level, and its anatomy wording may name its own
 * region: "Lumbar facet joints are unremarkable." says "Lumbar" because that is
 * what the facet joints of a lumbar study are called — the word names the
 * observation's own territory, not a different site, so it is not a site pin.
 * Within that study the sentence speaks for every level, and one level's
 * pathology falsifies it. A FOREIGN region word — "Cervical facet joints are
 * unremarkable." under a lumbar-level tile — still pins the sentence to another
 * region's claim, and the tile never owns it.
 */
function isStudyWideClaimForLevel(sentence: string, level: string): boolean {
  if (namesAnyLevel(sentence)) return false;
  const own = OWN_REGION_WORDS_BY_LEVEL_PREFIX[level[0]?.toUpperCase() ?? ""];
  if (!own) return !ANY_REGION_MENTION.test(sentence);
  return !namesForeignRegion(sentence, own);
}

/**
 * Resolve a raw concept / alias string to its canonical concept id.
 *
 * Uses the content-pack-driven resolver first. If the input is unknown to
 * the content packs but is NOT broad anatomy, we conservatively fall back
 * to the slug-normalised input (preserves legacy behaviour where unknown
 * strings like "compression fracture" became `compression_fracture`).
 *
 * Returns null only for empty input or broad-anatomy words — never maps an
 * unknown input to a wrong canonical concept.
 */
function canonConcept(raw: string): string | null {
  const n = normalizeSlotPart(raw);
  if (!n || isBroadAnatomy(n)) return null;
  const fromPack = resolveCanonicalConcept(n);
  if (fromPack) return fromPack;
  // Conservative legacy fallback: slug-normalise unknown input.
  // This preserves the historical behaviour where unknown-but-meaningful
  // strings (e.g. "compression fracture") became unique concept ids
  // rather than silently collapsing onto an unrelated canonical concept.
  return n.replace(/\s+/g, "_");
}

export function resolveConcept(input: ObservationSlotInput): {
  concept: string | null;
  source: ConceptResolutionSource;
} {
  const explicit = (input.concept ?? "").trim();
  if (explicit) {
    const c = canonConcept(explicit);
    return { concept: c, source: c ? "explicit" : "none" };
  }
  const group = (input.conflictGroup ?? "").trim();
  if (group && !isBroadAnatomy(group) && !REGION_NAMES.has(normalizeSlotPart(group))) {
    const c = canonConcept(group);
    if (c) return { concept: c, source: "conflictGroup" };
  }
  const hay = `${input.label ?? ""} ${input.anatomicalSection ?? ""} ${input.findingsText ?? ""}`;
  for (const hint of CONCEPT_HINTS) {
    if (!hint.re.test(hay)) continue;
    if (hint.concept === "disc_contour") {
      const lvl = extractLevel(input.level, input.anatomicalSection, input.label, input.findingsText);
      if (!lvl) continue;
    }
    return { concept: hint.concept, source: "legacy-fallback" };
  }
  const section = (input.anatomicalSection ?? "").trim();
  if (section && !isBroadAnatomy(section) && !REGION_NAMES.has(normalizeSlotPart(section))) {
    const n = normalizeSlotPart(section);
    if (CONCEPT_CANON[n] || CONCEPT_CANON[n.replace(/_/g, " ")]) {
      return { concept: canonConcept(section), source: "legacy-fallback" };
    }
    // Single-token sections (mca, pituitary) are safe; free-text labels are not.
    if (!/\s/.test(n) && n.length >= 3 && n.length <= 32) {
      const c = canonConcept(section);
      if (c && c !== "disc") return { concept: c, source: "legacy-fallback" };
    }
  }
  return { concept: null, source: "none" };
}

export function inferSupportsLaterality(input: ObservationSlotInput): boolean {
  if (input.supportsLaterality) return true;
  const props = (input.properties ?? "").toLowerCase();
  if (/(^|,)\s*side\s*(,|$)/.test(props)) return true;
  const text = `${input.findingsText ?? ""}`;
  return /\{side\}/i.test(text);
}

export function buildSlotKey(parts: {
  region: string;
  concept: string | null;
  level: string;
  laterality: string;
}): string {
  return persistenceOwnershipSlotKey({
    region: parts.region,
    concept: parts.concept ?? "",
    level: parts.level,
    laterality: parts.laterality,
  });
}

export function buildCanonicalObservation(input: ObservationSlotInput): CanonicalObservation {
  const resolved = resolveConcept(input);
  const supportsLaterality = inferSupportsLaterality(input);
  const level = extractLevel(input.level, input.anatomicalSection, input.label, input.findingsText);
  const laterality = supportsLaterality ? normalizeLaterality(input.laterality) : "";
  const region = (input.region ?? "").trim() || SLOT_WILDCARD;
  const slotKey = buildSlotKey({
    region,
    concept: resolved.concept,
    level,
    laterality,
  });
  return {
    id: input.id ?? "",
    catalogId: input.catalogId,
    region,
    anatomicalSection: (input.anatomicalSection ?? "").trim(),
    concept: resolved.concept,
    conceptSource: resolved.source,
    conflictGroup: (input.conflictGroup ?? "").trim(),
    level,
    laterality,
    state: (input.state ?? "").trim(),
    severity: (input.severity ?? "").trim(),
    measurement: (input.measurement ?? "").trim(),
    slotKey,
    source: input.source ?? "quick-findings",
    baselineReplaces: (input.baselineReplaces ?? "").trim(),
    supportsLaterality,
    bundleId: (input.bundleId ?? "").trim(),
    sectionsOwned: input.sectionsOwned?.length ? input.sectionsOwned : ["findings"],
    role: input.role ?? "finding",
    specificity: input.specificity ?? "region",
    ...(input.anchor ? { anchor: coerceObservationAnchor(input.anchor) } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  };
}

export function hasStructuredOwnership(obs: Pick<CanonicalObservation, "concept" | "conceptSource">): boolean {
  return Boolean(obs.concept) && obs.conceptSource !== "none";
}

export function isOppositeLaterality(a: string, b: string): boolean {
  const la = normalizeLaterality(a);
  const lb = normalizeLaterality(b);
  return (la === "left" && lb === "right") || (la === "right" && lb === "left");
}

/**
 * Mutex is NOT identity. Left vs right of the same concept/level may coexist
 * (bilateral disease as two observations). Empty laterality still mutexes
 * (Fazekas). Bilateral mutexes with left/right of the same slot family.
 */
export function observationsMutuallyExclusive(
  a: Pick<CanonicalObservation, "region" | "concept" | "level" | "laterality">,
  b: Pick<CanonicalObservation, "region" | "concept" | "level" | "laterality">,
): boolean {
  if (!a.concept || !b.concept) return false;
  if (normalizeSlotPart(a.region) !== normalizeSlotPart(b.region)) return false;
  if (a.concept !== b.concept) return false;
  const la = normalizeLevel(a.level) || SLOT_WILDCARD;
  const lb = normalizeLevel(b.level) || SLOT_WILDCARD;
  if (la !== lb) return false;
  if (isOppositeLaterality(a.laterality, b.laterality)) return false;
  return true;
}

/** Tokens that identify a concept in narrative text, sourced from content packs. */
function conceptMatchTokens(concept: string): string[] {
  // Generated from CLINICAL_CONTENT_PACKS via conceptCanon — no second
  // synonym list. Returns [] for unknown concepts (conservative).
  return canonicalConceptTokens(concept).filter((t) => !isBroadAnatomy(t));
}

export function sentenceMatchesConcept(sentence: string, concept: string | null): boolean {
  if (!concept) return false;
  const s = sentence.toLowerCase();
  if (concept === "fazekas") return /\bfazekas\b/.test(s);
  if (concept === "ventricles") {
    return /\bventric(?:le|ular)\b|\bhydrocephalus\b|\bcisternal spaces\b/i.test(sentence);
  }
  if (concept === "disc_contour") {
    return /\b(disc\s+)?(bulge|herniation|protrusion|prolapse)\b/i.test(sentence);
  }
  return conceptMatchTokens(concept).some((token) => s.includes(token));
}

/**
 * Is `token` present as a word?
 *
 * The derived scan cannot use plain `includes`: the hemorrhage pack carries the
 * alias "ich", so "maximum thickness ___ mm" would read as a hemorrhage and the
 * engine would delete a normal that is still true. A concept the radiologist
 * authored on the tile keeps the established looser match; concepts inferred from
 * prose get the strict one.
 */
function mentionsWord(hay: string, token: string): boolean {
  let from = 0;
  for (;;) {
    const at = hay.indexOf(token, from);
    if (at === -1) return false;
    const beforeOpen = at === 0 || !/[a-z0-9]/.test(hay[at - 1]);
    const end = at + token.length;
    const afterOpen = end === hay.length || !/[a-z0-9]/.test(hay[end]);
    if (beforeOpen && afterOpen) return true;
    from = at + 1;
  }
}

let ASSERTABLE_TOKENS: Map<string, string[]> | null = null;
/** Every pack concept with at least one non-broad token, computed once. */
function assertableTokens(): Map<string, string[]> {
  if (ASSERTABLE_TOKENS) return ASSERTABLE_TOKENS;
  const m = new Map<string, string[]>();
  for (const pack of CLINICAL_CONTENT_PACKS) {
    const toks = conceptMatchTokens(pack.concept);
    if (toks.length > 0) m.set(pack.concept, toks);
  }
  ASSERTABLE_TOKENS = m;
  return m;
}

/** Does the statement name this concept as a word? Strict — for derived ownership only. */
function namesConcept(sentence: string, concept: string): boolean {
  const tokens = assertableTokens().get(concept);
  if (!tokens) return false;
  const hay = normaliseConceptKey(sentence);
  return tokens.some((t) => mentionsWord(hay, t));
}

/**
 * Which canonical concepts a statement positively asserts.
 *
 * A Quick Select box can state several things at once. "Acute intraparenchymal
 * hemorrhage in the right basal ganglia with midline shift of 6 mm" asserts a
 * hemorrhage, a basal ganglia abnormality and a midline abnormality, so the
 * scaffold's "Basal ganglia and thalami are normal" and "No midline shift is
 * seen." are both falsified by it. Ownership used to be tested against the tile's
 * single declared concept only, which left those normals standing next to the
 * finding that contradicts them — a report that says the basal ganglia both
 * bleeds and is normal.
 *
 * Denied clauses are excluded by `assertsAbnormality`, so "No midline shift"
 * agrees with the baseline instead of retiring it, and a box that restates a
 * normal cannot delete it.
 *
 * `regionOfConcept` bounds the scan to anatomy that can appear in the same
 * examination. The packs carry cross-region aliases ("cavitation" also names a
 * lung finding, "mass_like_opacity" a chest one), and a brain box must not be
 * able to retire a chest normal through a shared word. An unknown host concept
 * claims nothing at all — fail closed.
 *
 * This is also the oracle the catalogue tests measure against, so the engine and
 * its test cannot drift into two different matching rules again.
 */
export function conceptsAssertedIn(text: string, regionOfConcept?: string | null): string[] {
  let allowed: Set<string> | null = null;
  if (regionOfConcept !== undefined) {
    if (!regionOfConcept) return [];
    const host = contentPackForConcept(regionOfConcept);
    if (!host) return [];
    if (!host.regions.includes("*")) {
      allowed = new Set(host.regions);
    }
  }
  const clauses = splitToSentences(text).filter((c) => assertsAbnormality(c));
  if (clauses.length === 0) return [];
  const joined = clauses.join(" ");
  const out: string[] = [];
  for (const pack of CLINICAL_CONTENT_PACKS) {
    if (allowed && !pack.regions.includes("*") && !pack.regions.some((r) => allowed.has(r))) continue;
    if (out.includes(pack.concept)) continue;
    if (namesConcept(joined, pack.concept)) out.push(pack.concept);
  }
  return out;
}

/** Laterality mentioned as a lesion side — not used as automatic mutex. */
export function lateralityMentionedInSentence(sentence: string): string {
  const s = sentence.toLowerCase();
  if (/\bbilateral\b/.test(s)) return "bilateral";
  const hasRight = /\bright\b/.test(s);
  const hasLeft = /\bleft\b/.test(s);
  if (hasRight && hasLeft) return "bilateral";
  if (hasRight) return "right";
  if (hasLeft) return "left";
  return "";
}

/**
 * Does an explicit baseline claim cover this sentence?
 *
 * A claim may state its normal in more than one sentence — the dorsal alignment
 * normal is "Thoracic kyphosis is within normal limits. Normal alignment of the
 * dorsal and dorsolumbar spine without listhesis." The report is walked one
 * sentence at a time (`pathologyPatch` splits every line), so a whole-string test
 * matched none of its parts: the contract named both sentences as contradicted
 * while the engine retired neither, and a documented retrolisthesis printed under
 * "Normal alignment … without listhesis". Each sentence of the claim is its own
 * claim. Sentences the claim does not state are untouched.
 */
function baselineClaimCovers(claim: string, sentence: string): boolean {
  if (sentence.includes(claim)) return true;
  const parts = splitToSentences(claim);
  if (parts.length < 2) return false;
  return parts.some((part) => sentence.includes(part));
}

/**
 * Slot-aware sentence ownership. Does not use broad "disc"/organ matching.
 * Legacy callers without a resolved concept must use pathologyPatch's old path.
 * Opposite laterality is a different clinical identity, not an owned sibling.
 */
export function sentenceOwnedBySlot(
  sentence: string,
  obs: Pick<CanonicalObservation, "concept" | "level" | "laterality" | "anatomicalSection" | "baselineReplaces"> & {
    /** Concepts the statement asserts in its own words, beyond its declared one. */
    alsoOwns?: string[];
    /**
     * Whole-examination normals this concept's lesion sits inside of — the
     * explicit supersession contract, not something read off the sentence.
     */
    supersedesGlobals?: readonly string[];
  },
): boolean {
  const baseline = (obs.baselineReplaces ?? "").trim();
  if (baseline && baselineClaimCovers(baseline, sentence)) return true;
  // Prose-derived concepts may widen retirement over the scaffold's NORMALS only.
  // A second aneurysm, a second DAI site and a second lacune all name their own
  // family's word, so letting prose decide would let one abnormality delete
  // another — three aneurysms arriving as two, which is exactly how a real study
  // loses a sac. Only the tile's declared concept may claim a sentence that
  // itself asserts something abnormal.
  const derived = (obs.alsoOwns?.length ?? 0) > 0 && !assertsAbnormality(sentence)
    && obs.alsoOwns!.some((c) => c !== obs.concept && namesConcept(sentence, c));
  // An explicit contract retires a whole-examination normal — the one class of
  // normal sentence prose inference cannot reach, because a lesion described as
  // "encephalomalacia", "intraparenchymal" or "MCA territory" never spells
  // "brain parenchyma". One gate keeps it inside that job: the sentence must
  // positively state normality. Not "it does not assert abnormality" — that test
  // also answers false for a finding whose cue word is missing from the list, and
  // a sentence-deleting rule must never read one of those as a normal.
  //
  // Cross-level and cross-region sentences are NOT handled here. The level gate
  // below already refuses them, and it is the same rule the cervical and dorsal
  // catalogues depend on ("Disc herniation L4-L5" widening to every level once
  // deleted all five normals), so repeating the test in this arm would be a guard
  // no mutant can break — which reads as coverage and is not.
  const supersedes = (obs.supersedesGlobals?.length ?? 0) > 0
    && assertsNormalStatement(sentence)
    && obs.supersedesGlobals!.some((t) => namesConcept(sentence, t));
  const matchesConcept = sentenceMatchesConcept(sentence, obs.concept) || derived || supersedes;
  const level = normalizeLevel(obs.level);
  if (level && !sentenceHasLevel(sentence, level)) {
    // A study-wide sentence speaks for every level, so one level's pathology
    // falsifies it and the tile owns it. A sentence pinned to another level or
    // another region is that site's claim, and stays. The study-wide test is
    // region-aware (`isStudyWideClaimForLevel`): the observation's own region
    // word — "Lumbar" for an L4-L5 tile — is anatomy wording, not a site pin,
    // which is what lets "Facet arthropathy at L4-L5." retire "Lumbar facet
    // joints are unremarkable." instead of printing beside it (the facet
    // contradiction). A foreign region word still refuses ownership, so a
    // lumbar tile never takes a cervical or sacral sentence.
    if (!matchesConcept || !isStudyWideClaimForLevel(sentence, level)) return false;
  }
  const obsLat = normalizeLaterality(obs.laterality);
  if (obsLat && obsLat !== "bilateral") {
    const mentioned = lateralityMentionedInSentence(sentence);
    if (mentioned && mentioned !== "bilateral" && mentioned !== obsLat) return false;
  }
  if (matchesConcept) return true;
  // An explicit baseline contract is the ownership boundary. Anatomy/level
  // identifies where that concept lives, but must not absorb other concepts
  // at the same site. Legacy overlays without a contract retain section scope.
  if (obs.concept && baseline) return false;
  const section = (obs.anatomicalSection ?? "").trim();
  if (section && !isBroadAnatomy(section) && sentence.toLowerCase().includes(section.toLowerCase())) {
    return true;
  }
  return false;
}

export function contributionPresent(fieldText: string, contribution: string | undefined): boolean {
  const c = (contribution ?? "").trim();
  if (!c) return false;
  if (fieldContainsContribution(fieldText, c)) return true;
  const parts = splitToSentences(c);
  return parts.length > 1 && parts.every((s) => fieldContainsContribution(fieldText, s) || fieldText.includes(s));
}

export function contributionProtected(
  contribution: string | undefined,
  provenance: FieldProvenanceMap | undefined,
): boolean {
  const c = (contribution ?? "").trim();
  if (!c) return false;
  return splitToSentences(c).some((s) => {
    const key = normalizeForDedupe(s);
    const src = provenance?.[key];
    if (!src || src.length === 0) return false;
    return src.includes("manual") || src.includes("radiologist-voice");
  });
}

/** A ledger row, narrowed to what the contribution fence needs. */
export type ContributionRow = {
  stale?: boolean;
  source?: string;
  observation?: { role?: string };
  lastRendered?: { findings?: string; impression?: string };
};

/**
 * Rows that state a FINDING. A materialized Full Normal baseline row and the
 * system-owned normal impression are excluded by kind, not only by wording: the
 * sweep showed why. `xrayChestSubMasters`, `cervicalQuickSelectCatalogue` and
 * `reportPreviewHarness` all broke the moment only the wording test was left,
 * because a baseline row also carries sentences that are not normal statements at
 * all — "Routine six sequences were acquired.", a section heading, a comparison
 * note — and those are exactly what a later tile's anatomy match would have
 * protected, freezing the baseline the first abnormality is supposed to retire.
 */
function findingRows(rows: readonly ContributionRow[]): ContributionRow[] {
  return rows.filter((row) => !row.stale
    && row.source !== "system"
    && row.observation?.role !== "baseline");
}

function renderedSentences(row: ContributionRow): string[] {
  const out: string[] = [];
  for (const text of [row.lastRendered?.findings, row.lastRendered?.impression]) {
    for (const s of splitToSentences(text ?? "")) {
      const k = normalizeForDedupe(s);
      if (k) out.push(k);
    }
  }
  return out;
}

/**
 * The words that other live observations already put on the page as FINDINGS.
 *
 * Ownership is inferred from prose (`conceptsAssertedIn`) and prose is loose: a
 * sentence describing a post-resection cavity "suggestive of edema" reads as an
 * edema statement, so the Cerebral edema box owned the Glioma box's own sentence
 * and deleted it while the Glioma row stayed live on the ledger — a finding the
 * radiologist believes they reported, present in the state and absent from the
 * page. Measured over the undeclared MRI Brain abnormal pairs, every sentence
 * lost to another tile was a tile's own contribution.
 *
 * So the fence is identity, not prose: a finding another live row rendered belongs
 * to that row, and only the row that wrote it — or a mutex sibling replacing it,
 * which the caller has already dropped from the list — may take it away.
 *
 * A live row's NORMAL statements deliberately stay outside the fence. The
 * radiologist journey requires contradictory normals to go away automatically,
 * and "No midline shift." inside the hydrocephalus box is a normal even though it
 * travels with a finding: once a selected hemorrhage states a midline shift, the
 * report cannot carry both. Baseline scaffold normals are not contributions
 * either, so every retirement path the brain and spine catalogues depend on is
 * untouched — together with the row-kind exclusions in `findingRows`.
 */
export function liveContributionKeys(rows: readonly ContributionRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of findingRows(rows)) {
    for (const k of renderedSentences(row)) {
      if (assertsNormalStatement(k)) continue;
      keys.add(k);
    }
  }
  return keys;
}

/**
 * RESIDUAL, measured and left open on purpose. Eviction only looks backwards at what
 * is already on the page, so a pair whose second box also carries a normal clause
 * resolves differently by order: hemorrhage-after-hydrocephalus retires "No midline
 * shift.", hydrocephalus-after-hemorrhage writes it. Suppressing the incoming normal
 * here makes the two agree — and breaks four shipped tests in
 * `siblingContradiction.ownership.test.ts` (T1, T2, T7, T9) that exist to keep that
 * very sentence on the page AND warn about it: a normal the radiologist clicked is
 * theirs, visible with a warning, and the engine may not delete it quietly to make a
 * test pass. The bounded truth is that a contradicted normal is either retired or
 * printed-and-named, never printed silently; closing the last bit of the asymmetry
 * needs the contradiction check to read the ledger rather than the page, which is a
 * composition-model change and not a fence.
 */
export function selectedQuickFindingIds(patchIds: string[]): number[] {
  const out: number[] = [];
  for (const id of patchIds) {
    // The side suffix is optional and deliberately loose. `quickFindingRowId`
    // gives Left and Right of one box their own row, and a chip has to read as
    // selected whichever side is on the page — an exact-shape match here is what
    // would silently un-light every sided box the moment it recorded its side.
    // Duplicates are kept: both sides of one box push the same id, and the caller
    // builds a Set.
    const m = /^qf-(\d+)(?::[a-z]+)?$/.exec(id);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

export function ownershipFromObservation(obs: CanonicalObservation): PathologyOwnership {
  return {
    anatomicalSection: obs.anatomicalSection || undefined,
    conflictGroup: obs.conflictGroup || undefined,
    baselineReplaces: obs.baselineReplaces || undefined,
    concept: obs.concept,
    level: obs.level || undefined,
    laterality: obs.laterality || undefined,
    slotKey: obs.slotKey,
  };
}

/**
 * Same-slot replacement plan for structured finding insertion.
 *
 * Slot identity is already CARE's `slotKey` / `observationsMutuallyExclusive`
 * (region|concept|level|laterality). Severity and measurement values do NOT
 * define a new slot. When a mutex sibling exists, prefer updating that
 * observation in place (stable id) so measurements / key images / anchors
 * stay linked.
 *
 * Legacy / unstructured (no resolved concept) → no silent sibling replacement.
 */
export type SameSlotSibling = {
  id: string;
  observation: CanonicalObservation;
  lastRendered: PathologyIncoming;
  protected: boolean;
  source: InsertSource;
};

export type SameSlotPlan =
  | { action: "insert"; reason: "no-sibling" | "unstructured" }
  | {
    action: "noop";
    existingId: string;
    existing: SameSlotSibling;
  }
  | {
    action: "update";
    existingId: string;
    existing: SameSlotSibling;
    /** Extra mutex siblings (same slot) that are superseded by this update. */
    supersededIds: string[];
    requiresConfirmation: boolean;
  };

function renderedEqual(a: string | undefined, b: string | undefined): boolean {
  return normalizeForDedupe(a ?? "") === normalizeForDedupe(b ?? "");
}

/** Find ledger patches that share the clinical slot with `incoming`. */
export function findSameSlotSiblings(
  patches: ReadonlyArray<{
    id: string;
    observation?: CanonicalObservation;
    lastRendered?: PathologyIncoming;
    protected?: boolean;
    source?: InsertSource;
  }>,
  incoming: Pick<CanonicalObservation, "region" | "concept" | "level" | "laterality">,
): SameSlotSibling[] {
  if (!incoming.concept) return [];
  const out: SameSlotSibling[] = [];
  for (const p of patches) {
    const other = p.observation;
    if (!other?.concept) continue;
    if (!observationsMutuallyExclusive(incoming, other)) continue;
    out.push({
      id: p.id,
      observation: other,
      lastRendered: p.lastRendered ?? {},
      protected: Boolean(p.protected),
      source: p.source ?? "quick-findings",
    });
  }
  return out;
}

/**
 * Prefer the oldest stable sibling as the identity to preserve (createdAt, then id).
 * Caller must pass siblings from findSameSlotSiblings.
 */
export function pickSameSlotPrimary(siblings: readonly SameSlotSibling[]): SameSlotSibling | null {
  if (siblings.length === 0) return null;
  return [...siblings].sort((a, b) => {
    const ac = a.observation.createdAt ?? "";
    const bc = b.observation.createdAt ?? "";
    if (ac && bc && ac !== bc) return ac.localeCompare(bc);
    return a.id.localeCompare(b.id);
  })[0] ?? null;
}

export function planSameSlotReplacement(input: {
  incoming: CanonicalObservation;
  incomingFindings?: string | null;
  incomingImpression?: string | null;
  siblings: readonly SameSlotSibling[];
  /** True when findings/impression contribution has meaningful manual edits. */
  contributionIsManual?: boolean;
  force?: boolean;
}): SameSlotPlan {
  if (!hasStructuredOwnership(input.incoming)) {
    return { action: "insert", reason: "unstructured" };
  }
  if (input.siblings.length === 0) {
    return { action: "insert", reason: "no-sibling" };
  }
  const primary = pickSameSlotPrimary(input.siblings);
  if (!primary) return { action: "insert", reason: "no-sibling" };

  const sameFindings = renderedEqual(primary.lastRendered.findings, input.incomingFindings ?? "");
  const sameImpression = renderedEqual(
    primary.lastRendered.impression,
    input.incomingImpression ?? primary.lastRendered.impression ?? "",
  );
  // Exact re-click of the same structured finding → idempotent.
  if (sameFindings && sameImpression) {
    return { action: "noop", existingId: primary.id, existing: primary };
  }

  const requiresConfirmation = Boolean(
    !input.force
    && (primary.protected || input.contributionIsManual),
  );
  const supersededIds = input.siblings.filter((s) => s.id !== primary.id).map((s) => s.id);
  return {
    action: "update",
    existingId: primary.id,
    existing: primary,
    supersededIds,
    requiresConfirmation,
  };
}

/**
 * Merge incoming observation onto the preserved sibling identity.
 * Keeps id, anchor, createdAt; refreshes text-driving fields + updatedAt.
 */
export function mergeObservationInPlace(
  existing: CanonicalObservation,
  incoming: CanonicalObservation,
): CanonicalObservation {
  return {
    ...incoming,
    id: existing.id || incoming.id,
    // Evidence / jump-back must survive severity/text changes.
    anchor: existing.anchor ?? incoming.anchor,
    createdAt: existing.createdAt ?? incoming.createdAt,
    updatedAt: incoming.updatedAt ?? new Date().toISOString(),
    // Measurement string on the observation is instance data — keep unless incoming sets one.
    measurement: (incoming.measurement ?? "").trim() || existing.measurement,
  };
}

export function templatesFromObservation(lastRendered: PathologyIncoming): PathologyIncoming {
  return {
    findings: lastRendered.findings,
    impression: lastRendered.impression,
    technique: lastRendered.technique,
    recommendation: lastRendered.recommendation,
  };
}

/** Slot identity plus instance authority. Provenance stays in fieldProvenance. */
export type RuntimeObservation = CanonicalObservation & {
  lastRendered: PathologyIncoming;
  protected: boolean;
};

export function toRuntimeObservation(input: {
  observation: CanonicalObservation;
  lastRendered: PathologyIncoming;
  protected?: boolean;
}): RuntimeObservation {
  return {
    ...input.observation,
    lastRendered: input.lastRendered,
    protected: Boolean(input.protected),
  };
}

const OBSERVATION_ROLES: ObservationRole[] = ["finding", "impression", "recommendation", "baseline", "screening"];
const OBSERVATION_SPECIFICITIES: ObservationSpecificity[] = ["protocol", "study", "region", "family"];

export function coerceObservationRole(raw: unknown): ObservationRole {
  return OBSERVATION_ROLES.includes(raw as ObservationRole) ? (raw as ObservationRole) : "finding";
}

export function coerceObservationSpecificity(raw: unknown): ObservationSpecificity {
  return OBSERVATION_SPECIFICITIES.includes(raw as ObservationSpecificity)
    ? (raw as ObservationSpecificity)
    : "study";
}

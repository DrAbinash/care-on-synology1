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
  normalizeForDedupe,
  splitToSentences,
  type FieldProvenanceMap,
  type InsertSource,
} from "./reportFieldMerge";
import type { PathologyIncoming, PathologyOwnership } from "./pathologyPatch";
import { fieldContainsContribution } from "./observationMatch";
import type { ObservationAnchor } from "./observationAnchor";
import { coerceObservationAnchor } from "./observationAnchor";

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

export const SLOT_WILDCARD = "*";

/** Anatomy words that must not be exclusive ownership when structured metadata exists. */
export const BROAD_ANATOMY = new Set([
  "disc", "discs", "spine", "cord", "brain", "white matter", "parenchyma",
  "liver", "kidney", "kidneys", "chest", "abdomen", "organ",
]);

const REGION_NAMES = new Set([
  "brain", "cervical spine", "dorsal spine", "ls spine", "whole spine", "spine",
  "chest", "abdomen", "knee", "shoulder", "breast", "ob", "pns", "pelvis",
]);

/** Equivalence for mutex/slot identity only — not a new catalog. */
const CONCEPT_CANON: Record<string, string> = {
  fazekas: "fazekas",
  ventricles: "ventricles",
  ventricle: "ventricles",
  ventricular: "ventricles",
  hydrocephalus: "ventricles",
  disc_contour: "disc_contour",
  "disc-bulge": "disc_contour",
  "disc bulge": "disc_contour",
  "disc_bulge": "disc_contour",
  "disc herniation": "disc_contour",
  "disc-herniation": "disc_contour",
  herniation: "disc_contour",
  protrusion: "disc_contour",
  "disc protrusion": "disc_contour",
  "disc-protrusion": "disc_contour",
  disc_signal: "disc_signal",
  desiccation: "disc_signal",
  disc_height: "disc_height",
  "disc height": "disc_height",
  canal_stenosis: "canal_stenosis",
  "canal stenosis": "canal_stenosis",
  spondylolisthesis: "spondylolisthesis",
  listhesis: "spondylolisthesis",
  meniscus: "meniscus",
  rotator_cuff: "rotator_cuff",
  "rotator cuff": "rotator_cuff",
  orbital: "orbital",
  orbit: "orbital",
  sinus: "sinus",
  sinuses: "sinus",
  osteophytes: "osteophytes",
  osteophyte: "osteophytes",
  facet_joint: "facet_joint",
  facet: "facet_joint",
  endplate: "endplate",
  senile_atrophy: "senile_atrophy",
  senile: "senile_atrophy",
  hemorrhage: "hemorrhage",
  haemorrhage: "hemorrhage",
  infarct: "infarct",
  renal: "renal",
  kidney: "renal",
  hip: "hip",
  menisci: "meniscus",
};

const CONCEPT_HINTS: Array<{ concept: string; re: RegExp }> = [
  { concept: "fazekas", re: /\bfazekas\b/i },
  { concept: "ventricles", re: /\bhydrocephalus\b|\bnormal ventricles\b|\bventricular system\b/i },
  { concept: "disc_contour", re: /\b(disc\s+)?(bulge|herniation|protrusion|no bulge|disc contour)\b/i },
];

export function normalizeSlotPart(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isBroadAnatomy(raw: string | null | undefined): boolean {
  const n = normalizeSlotPart(raw);
  if (!n) return false;
  if (BROAD_ANATOMY.has(n) || REGION_NAMES.has(n)) return true;
  return [...BROAD_ANATOMY].some((w) => n === w);
}

/** Canonical spine level: L4-L5, C5-C6, D7-D8. Empty if none. */
export function normalizeLevel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().toUpperCase().replace(/[–—]/g, "-");
  if (!t) return "";
  const compact = t.replace(/\s+/g, "").replace(/\//g, "-").replace(/T/g, "D");
  const paired = compact.match(/^([LCDS])(\d{1,2})-?([LCDS])?(\d{1,2})$/);
  if (paired) {
    const a = paired[1]!;
    const aN = paired[2]!;
    const b = paired[3] || a;
    const bN = paired[4]!;
    return `${a}${aN}-${b}${bN}`;
  }
  const embedded = t.match(/\b([LCDST])\s*(\d{1,2})\s*[-\/]\s*([LCDST])?\s*(\d{1,2})\b/i);
  if (embedded) {
    const a = embedded[1]!.toUpperCase().replace("T", "D");
    const b = (embedded[3] || embedded[1]!).toUpperCase().replace("T", "D");
    return `${a}${embedded[2]}-${b}${embedded[4]}`;
  }
  return "";
}

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
  const got = extractLevelFromText(sentence);
  if (got) return got === want;
  // Compact forms: L4L5, L4 5
  const compactWant = want.replace(/-/g, "");
  const compactSent = sentence.toUpperCase().replace(/[–—\s\/]/g, "").replace(/T/g, "D");
  return compactSent.includes(compactWant);
}

export function normalizeLaterality(raw: string | null | undefined): string {
  const n = normalizeSlotPart(raw);
  if (n === "left" || n === "right" || n === "bilateral") return n;
  if (n === "l") return "left";
  if (n === "r") return "right";
  if (n === "b/l" || n === "bilat" || n === "bl") return "bilateral";
  return "";
}

function canonConcept(raw: string): string | null {
  const n = normalizeSlotPart(raw);
  if (!n || isBroadAnatomy(n)) return null;
  if (CONCEPT_CANON[n]) return CONCEPT_CANON[n]!;
  const spaced = n.replace(/_/g, " ");
  if (CONCEPT_CANON[spaced]) return CONCEPT_CANON[spaced]!;
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
  const region = (parts.region ?? "").trim() || SLOT_WILDCARD;
  const concept = parts.concept || SLOT_WILDCARD;
  const level = normalizeLevel(parts.level) || SLOT_WILDCARD;
  const laterality = normalizeLaterality(parts.laterality) || SLOT_WILDCARD;
  return `${region}|${concept}|${level}|${laterality}`;
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

/** Tokens that identify a concept in narrative text, including CONCEPT_CANON synonyms. */
function conceptMatchTokens(concept: string): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const spaced = raw.replace(/[_-]+/g, " ").toLowerCase().trim();
    if (spaced.length < 3 || isBroadAnatomy(spaced)) return;
    if (!out.includes(spaced)) out.push(spaced);
  };
  add(concept);
  for (const [k, v] of Object.entries(CONCEPT_CANON)) {
    if (v === concept) add(k);
  }
  return out;
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
 * Slot-aware sentence ownership. Does not use broad "disc"/organ matching.
 * Legacy callers without a resolved concept must use pathologyPatch's old path.
 * Opposite laterality is a different clinical identity, not an owned sibling.
 */
export function sentenceOwnedBySlot(
  sentence: string,
  obs: Pick<CanonicalObservation, "concept" | "level" | "laterality" | "anatomicalSection" | "baselineReplaces">,
): boolean {
  const baseline = (obs.baselineReplaces ?? "").trim();
  if (baseline && sentence.includes(baseline)) return true;
  const level = normalizeLevel(obs.level);
  if (level && !sentenceHasLevel(sentence, level)) return false;
  const obsLat = normalizeLaterality(obs.laterality);
  if (obsLat && obsLat !== "bilateral") {
    const mentioned = lateralityMentionedInSentence(sentence);
    if (mentioned && mentioned !== "bilateral" && mentioned !== obsLat) return false;
  }
  if (sentenceMatchesConcept(sentence, obs.concept)) return true;
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

export function selectedQuickFindingIds(patchIds: string[]): number[] {
  const out: number[] = [];
  for (const id of patchIds) {
    const m = /^qf-(\d+)$/.exec(id);
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

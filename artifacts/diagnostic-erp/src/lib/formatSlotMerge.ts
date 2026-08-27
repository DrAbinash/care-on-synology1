/**
 * Dual Full Report Format merge — by section, region, slot, and specificity.
 * Replaces unsafe sentence-union internals of mergeTwoFormats.
 * Picker UX / preview dialog / confirmation stay the same.
 */

import { mergeTechnique } from "./reportFieldMerge";
import { isAbnormalFindingLine } from "./generateLocalImpression";
import {
  buildCanonicalObservation,
  observationsMutuallyExclusive,
  type CanonicalObservation,
} from "./observationSlot";
import {
  findingsRegionOrder,
  formatSpecificity,
  isScreeningFormat,
  specificityRank,
} from "./contentSpecificity";
import type {
  MergeFieldResult,
  MergeResult,
  MergeSentence,
  ReportFormat,
} from "./zai-workspace/types";

const SCREENING_HEADING =
  /^(CERVICAL SPINE SCREENING|DORSAL SPINE SCREENING|THORACIC SPINE SCREENING|WHOLE SPINE SCREENING|LUMBOSACRAL SPINE|LS SPINE)\s*$/i;

function splitSentences(t: string): string[] {
  if (!t?.trim()) return [];
  return t
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      if (SCREENING_HEADING.test(trimmed)) return [trimmed];
      return trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
    });
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/___+/g, "___").replace(/[^a-z0-9\s]/g, "").trim();
}

function isNormalImpressionLine(s: string): boolean {
  if (isAbnormalFindingLine(s)) return false;
  return /^(normal mri|no significant abnormality|no acute (intracranial |bony )?abnormality|no cord compression or significant disc)/i.test(s.trim());
}

function regionFromHeading(text: string, fallback: string): string {
  if (/CERVICAL SPINE SCREENING/i.test(text)) return "Cervical Spine";
  if (/DORSAL SPINE SCREENING|THORACIC SPINE SCREENING/i.test(text)) return "Dorsal Spine";
  if (/LUMBOSACRAL SPINE|LS SPINE/i.test(text)) return "LS Spine";
  if (/WHOLE SPINE SCREENING/i.test(text)) return "Whole Spine";
  return fallback;
}

function observationForSentence(sentence: string, region: string): CanonicalObservation {
  const lat = sentence.match(/\b(bilateral|left|right)\b/i)?.[1];
  return buildCanonicalObservation({
    region,
    findingsText: sentence,
    label: sentence.slice(0, 80),
    laterality: lat,
    supportsLaterality: Boolean(lat),
  });
}

type Tagged = {
  text: string;
  source: MergeSentence["source"];
  region: string;
  screening: boolean;
  heading: boolean;
  obs: CanonicalObservation;
  specRank: number;
};

function tagSentences(format: ReportFormat, source: "from-a" | "from-b"): Tagged[] {
  const screening = isScreeningFormat(format);
  const specRank = specificityRank(formatSpecificity(format));
  let region = format.bodyPart;
  return splitSentences(format.findings).map((text) => {
    if (SCREENING_HEADING.test(text)) region = regionFromHeading(text, format.bodyPart);
    return {
      text,
      source,
      region,
      screening: screening || /screening/i.test(text),
      heading: SCREENING_HEADING.test(text),
      obs: observationForSentence(text, region),
      specRank,
    };
  });
}

function pathologyBeats(a: Tagged, b: Tagged): Tagged {
  const aAbn = isAbnormalFindingLine(a.text);
  const bAbn = isAbnormalFindingLine(b.text);
  if (aAbn && !bAbn) return a;
  if (bAbn && !aAbn) return b;
  if (a.specRank !== b.specRank) return a.specRank >= b.specRank ? a : b;
  return a;
}

function sameSlot(a: Tagged, b: Tagged): boolean {
  if (a.heading || b.heading) return false;
  if (observationsMutuallyExclusive(a.obs, b.obs)) return true;
  return Boolean(a.obs.concept && a.obs.slotKey === b.obs.slotKey);
}

function sameRegionGroup(a: Tagged, b: Tagged): boolean {
  return findingsRegionOrder(a.region) === findingsRegionOrder(b.region);
}

function mergeTagged(fromA: Tagged[], fromB: Tagged[]): { kept: Tagged[]; discarded: string[] } {
  const kept: Tagged[] = [];
  const discarded: string[] = [];
  const usedB = new Set<number>();

  for (const a of fromA) {
    const n = norm(a.text);
    const dupB = fromB.findIndex((b, i) => !usedB.has(i) && norm(b.text) === n && sameRegionGroup(a, b));
    if (dupB >= 0) {
      usedB.add(dupB);
      kept.push({ ...a, source: "common" });
      discarded.push(fromB[dupB]!.text);
      continue;
    }
    const clash = fromB.findIndex((b, i) => !usedB.has(i) && sameSlot(a, b));
    if (clash >= 0) {
      usedB.add(clash);
      const winner = pathologyBeats(a, fromB[clash]!);
      const loser = winner === a ? fromB[clash]! : a;
      kept.push(winner);
      discarded.push(loser.text);
      continue;
    }
    kept.push(a);
  }

  for (let i = 0; i < fromB.length; i++) {
    if (usedB.has(i)) continue;
    const b = fromB[i]!;
    const clash = kept.findIndex((k) => sameSlot(k, b));
    if (clash >= 0) {
      const winner = pathologyBeats(kept[clash]!, b);
      discarded.push(winner === b ? kept[clash]!.text : b.text);
      kept[clash] = winner;
      continue;
    }
    kept.push(b);
  }

  kept.sort((x, y) => {
    const sx = x.screening ? 1 : 0;
    const sy = y.screening ? 1 : 0;
    if (sx !== sy) return sx - sy;
    return findingsRegionOrder(x.region) - findingsRegionOrder(y.region);
  });

  return { kept, discarded };
}

function toFieldResult(kept: Tagged[], discarded: string[]): MergeFieldResult {
  const sentences: MergeSentence[] = kept.map((k) => ({ text: k.text, source: k.source }));
  const common = sentences.filter((s) => s.source === "common").length;
  const addedFromA = sentences.filter((s) => s.source === "from-a").length;
  const addedFromB = sentences.filter((s) => s.source === "from-b").length;
  return {
    text: kept.map((k) => k.text).join("\n"),
    sentences,
    common,
    addedFromA,
    addedFromB,
    discarded,
  };
}

function mergeHistory(fa: string, fb: string): MergeFieldResult {
  const sa = splitSentences(fa);
  const sb = splitSentences(fb);
  const seen = new Set<string>();
  const sentences: MergeSentence[] = [];
  const discarded: string[] = [];
  let common = 0;
  let addedFromA = 0;
  let addedFromB = 0;
  for (const s of sa) {
    const n = norm(s);
    if (seen.has(n)) continue;
    const inB = sb.some((x) => norm(x) === n);
    sentences.push({ text: s, source: inB ? "common" : "from-a" });
    seen.add(n);
    if (inB) common++;
    else addedFromA++;
  }
  for (const s of sb) {
    const n = norm(s);
    if (seen.has(n)) {
      discarded.push(s);
      continue;
    }
    sentences.push({ text: s, source: "from-b" });
    seen.add(n);
    addedFromB++;
  }
  return { text: sentences.map((s) => s.text).join(" "), sentences, common, addedFromA, addedFromB, discarded };
}

function mergeImpressions(a: ReportFormat, b: ReportFormat, findingsHasPathology: boolean): MergeFieldResult {
  const taggedA = splitSentences(a.impression).map((text) => ({
    text,
    source: "from-a" as const,
    screening: isScreeningFormat(a),
    region: a.bodyPart,
  }));
  const taggedB = splitSentences(b.impression).map((text) => ({
    text,
    source: "from-b" as const,
    screening: isScreeningFormat(b),
    region: b.bodyPart,
  }));
  const all = [...taggedA, ...taggedB];
  const seen = new Set<string>();
  const sentences: MergeSentence[] = [];
  const discarded: string[] = [];
  const hasAbnormal = findingsHasPathology || all.some((s) => isAbnormalFindingLine(s.text));

  const ordered = all.slice().sort((x, y) => {
    const ax = isAbnormalFindingLine(x.text) ? 0 : 1;
    const ay = isAbnormalFindingLine(y.text) ? 0 : 1;
    if (ax !== ay) return ax - ay;
    const sx = x.screening ? 1 : 0;
    const sy = y.screening ? 1 : 0;
    if (sx !== sy) return sx - sy;
    return findingsRegionOrder(x.region) - findingsRegionOrder(y.region);
  });

  for (const s of ordered) {
    const n = norm(s.text);
    if (seen.has(n)) {
      discarded.push(s.text);
      continue;
    }
    if (hasAbnormal && isNormalImpressionLine(s.text)) {
      discarded.push(s.text);
      continue;
    }
    if (s.screening && !isAbnormalFindingLine(s.text)) {
      discarded.push(s.text);
      continue;
    }
    seen.add(n);
    const alsoInOther = (s.source === "from-a" ? taggedB : taggedA).some((o) => norm(o.text) === n);
    sentences.push({ text: s.text, source: alsoInOther ? "common" : s.source });
  }

  return {
    text: sentences.map((s) => s.text).join("\n"),
    sentences,
    common: sentences.filter((s) => s.source === "common").length,
    addedFromA: sentences.filter((s) => s.source === "from-a").length,
    addedFromB: sentences.filter((s) => s.source === "from-b").length,
    discarded,
  };
}

function mergeRecommendations(a: ReportFormat, b: ReportFormat, impressionKept: string[]): MergeFieldResult {
  const sa = splitSentences(a.recommendation);
  const sb = splitSentences(b.recommendation);
  const impressionHay = impressionKept.join(" ").toLowerCase();
  const dropIfOrphan = (s: string, format: ReportFormat) => {
    if (!s.trim()) return true;
    if (!isAbnormalFindingLine(format.findings) && isAbnormalFindingLine(s) && impressionHay.length > 0) {
      return !impressionHay.includes(norm(s).slice(0, 24));
    }
    return false;
  };
  const sentences: MergeSentence[] = [];
  const discarded: string[] = [];
  const seen = new Set<string>();
  for (const s of sa) {
    const n = norm(s);
    if (!n || seen.has(n)) continue;
    if (dropIfOrphan(s, a)) {
      discarded.push(s);
      continue;
    }
    const inB = sb.some((x) => norm(x) === n);
    sentences.push({ text: s, source: inB ? "common" : "from-a" });
    seen.add(n);
  }
  for (const s of sb) {
    const n = norm(s);
    if (!n) continue;
    if (seen.has(n)) {
      discarded.push(s);
      continue;
    }
    if (dropIfOrphan(s, b)) {
      discarded.push(s);
      continue;
    }
    sentences.push({ text: s, source: "from-b" });
    seen.add(n);
  }
  return {
    text: sentences.map((s) => s.text).join("\n"),
    sentences,
    common: sentences.filter((s) => s.source === "common").length,
    addedFromA: sentences.filter((s) => s.source === "from-a").length,
    addedFromB: sentences.filter((s) => s.source === "from-b").length,
    discarded,
  };
}

export function combinedFormatTitle(a: ReportFormat, b: ReportFormat): string | null {
  const pair = [a, b];
  const hasLs = pair.some((f) => /ls spine|lumbar|lumbosacral/i.test(f.bodyPart) && !isScreeningFormat(f));
  const hasWholeScreen = pair.some((f) => /whole spine/i.test(f.bodyPart) && isScreeningFormat(f));
  const hasCervScreen = pair.some((f) => /cervical/i.test(f.bodyPart) && isScreeningFormat(f));
  const hasDorsScreen = pair.some((f) => /dorsal|thoracic/i.test(f.bodyPart) && isScreeningFormat(f));
  if (hasLs && (hasWholeScreen || (hasCervScreen && hasDorsScreen))) {
    return "MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING";
  }
  return null;
}

function mergeTechniquePreservingScreening(a: string, b: string, fa?: ReportFormat, fb?: ReportFormat): { text: string; sentences: MergeSentence[] } {
  const taggedA = fa?.techniqueFragments?.length ? fa.techniqueFragments : null;
  const taggedB = fb?.techniqueFragments?.length ? fb.techniqueFragments : null;
  if (taggedA || taggedB) {
    return mergeTechniqueFragments(taggedA ?? deriveTechniqueFragments(a), taggedB ?? deriveTechniqueFragments(b));
  }
  const tA = a.trim();
  const tB = b.trim();
  const merged = mergeTechnique(tA, tB);
  let text = merged;
  const extra: MergeSentence[] = [];
  const consider = (t: string, source: MergeSentence["source"]) => {
    if (!/screening|limited planar|limited sequence/i.test(t)) return;
    for (const s of splitSentences(t)) {
      if (!/limited|screening/i.test(s)) continue;
      const probe = s.slice(0, Math.min(48, s.length)).toLowerCase();
      if (text.toLowerCase().includes(probe)) continue;
      text = text.trim() ? `${text.trim()} ${s}` : s;
      extra.push({ text: s, source });
    }
  };
  consider(tA, "from-a");
  consider(tB, "from-b");
  const sameTech = extra.length === 0 && (text === tA || text === tB || norm(tA) === norm(tB));
  const sentences: MergeSentence[] = sameTech
    ? [{ text, source: "common" }]
    : [
      ...splitSentences(merged).map((s) => ({ text: s, source: "common" as const })),
      ...extra,
    ];
  return { text, sentences };
}

const TECHNIQUE_PRESERVE =
  /\b(mri|ct|t1w|t2w|stir|flair|dwi|adc|sagittal|axial|coronal|planar|sequence|screening|limited|3t|1\.5t)\b/i;

export function deriveTechniqueFragments(technique: string): Array<{ text: string; dedupeKey: string; preserve: boolean }> {
  return splitSentences(technique).map((text) => ({
    text,
    dedupeKey: norm(text).slice(0, 48) || text.slice(0, 32),
    preserve: TECHNIQUE_PRESERVE.test(text),
  }));
}

/**
 * Union technique fragments by dedupeKey. Preserved sentences always survive.
 * Order: detailed (non-screening) first, screening/limited fragments appended.
 */
export function mergeTechniqueFragments(
  a: Array<{ text: string; dedupeKey: string; preserve?: boolean }>,
  b: Array<{ text: string; dedupeKey: string; preserve?: boolean }>,
): { text: string; sentences: MergeSentence[] } {
  type Frag = { text: string; dedupeKey: string; preserve: boolean; source: MergeSentence["source"]; screening: boolean };
  const tag = (list: typeof a, source: MergeSentence["source"]): Frag[] =>
    list.map((f) => ({
      text: f.text,
      dedupeKey: f.dedupeKey || norm(f.text).slice(0, 48),
      preserve: f.preserve !== false,
      source,
      screening: /screening|limited/i.test(f.text),
    }));
  const all = [...tag(a, "from-a"), ...tag(b, "from-b")];
  const kept: Frag[] = [];
  const seen = new Set<string>();
  const detailed = all.filter((f) => !f.screening);
  const screening = all.filter((f) => f.screening);
  for (const f of [...detailed, ...screening]) {
    const key = f.dedupeKey;
    if (seen.has(key)) {
      const existing = kept.find((k) => k.dedupeKey === key);
      if (existing && f.preserve) existing.preserve = true;
      continue;
    }
    // Drop only when a later duplicate key exists AND this fragment is not preserved.
    const dup = all.filter((x) => x.dedupeKey === key);
    if (!f.preserve && dup.some((d) => d.preserve && d.text !== f.text)) continue;
    seen.add(key);
    const alsoOther = all.some((x) => x.source !== f.source && x.dedupeKey === key);
    kept.push({ ...f, source: alsoOther ? "common" : f.source });
  }
  for (const f of all) {
    if (f.preserve && !kept.some((k) => k.dedupeKey === f.dedupeKey || norm(k.text) === norm(f.text))) {
      kept.push(f);
    }
  }
  const sentences: MergeSentence[] = kept.map((k) => ({ text: k.text, source: k.source }));
  return { text: kept.map((k) => k.text).join(" "), sentences };
}

export function mergeTwoFormatsBySlot(a: ReportFormat, b: ReportFormat): MergeResult {
  const tech = mergeTechniquePreservingScreening(a.technique ?? "", b.technique ?? "", a, b);

  const hm = mergeHistory(a.clinicalHistory ?? "", b.clinicalHistory ?? "");
  const tagged = mergeTagged(tagSentences(a, "from-a"), tagSentences(b, "from-b"));
  const fm = toFieldResult(tagged.kept, tagged.discarded);
  const findingsHasPathology = tagged.kept.some((k) => !k.heading && isAbnormalFindingLine(k.text));
  const im = mergeImpressions(a, b, findingsHasPathology);
  const rm = mergeRecommendations(a, b, im.sentences.map((s) => s.text));
  const combinedTitle = combinedFormatTitle(a, b);

  return {
    clinicalHistory: hm.text,
    clinicalHistorySentences: hm.sentences,
    technique: tech.text,
    techniqueSentences: tech.sentences,
    findings: fm.text,
    impression: im.text,
    recommendation: rm.text,
    findingsMerged: fm,
    impressionMerged: im,
    recommendationMerged: rm,
    stats: {
      commonSentencesDiscarded: hm.common + fm.common + im.common + rm.common,
      addedFromA: hm.addedFromA + fm.addedFromA + im.addedFromA + rm.addedFromA,
      addedFromB: hm.addedFromB + fm.addedFromB + im.addedFromB + rm.addedFromB,
      totalFinal: hm.sentences.length + fm.sentences.length + im.sentences.length + rm.sentences.length,
    },
    combinedReportTitle: combinedTitle,
  };
}

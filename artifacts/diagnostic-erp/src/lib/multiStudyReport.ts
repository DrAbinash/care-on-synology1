/**
 * Multi-study combined report — findings sub-sections on top of the
 * existing pathology overlay. One findings document, two headed blocks.
 * Overlay logic stays in applyPathologyOverlay; this module only splits,
 * routes, and stitches the findings field.
 */

import {
  normalizeForDedupe,
  splitToSentences,
  type FieldProvenanceMap,
} from "@/lib/reportFieldMerge";

export type FindingsStudySection = {
  studyId: string;
  title: string;
  modality?: string | null;
  studyDescription?: string | null;
  region?: string | null;
  accessionNumber?: string | null;
  studyInstanceUID?: string | null;
};

const MODALITY_LABEL: Record<string, string> = {
  MR: "MRI",
  MRI: "MRI",
  CT: "CT",
  US: "USG",
  USG: "USG",
  XR: "XRAY",
  CR: "XRAY",
  DX: "XRAY",
};

const REGION_MARKERS: Array<{ token: string; pattern: RegExp }> = [
  { token: "brain", pattern: /\b(brain|cranial|cerebr|intracranial|parenchyma|ventric)/i },
  { token: "cervical", pattern: /\b(cervical|c[\s-]?spine|neck)\b/i },
  { token: "dorsal", pattern: /\b(dorsal|thoracic|d[\s-]?spine)\b/i },
  { token: "lumbar", pattern: /\b(lumbar|l[\s-]?spine|ls[\s-]?spine)\b/i },
];

export function formatStudySectionTitle(
  modality?: string | null,
  description?: string | null,
): string {
  const modRaw = (modality ?? "").trim().toUpperCase();
  const mod = MODALITY_LABEL[modRaw]
    ?? (modRaw.startsWith("MR") ? "MRI" : modRaw.startsWith("CT") ? "CT" : modRaw);
  const desc = (description ?? "").trim().replace(/\s+/g, " ");
  if (!desc) return mod || "STUDY";
  const upper = desc.toUpperCase();
  if (mod && (upper === mod || upper.startsWith(`${mod} `))) return upper;
  if (mod) return `${mod} ${upper}`;
  return upper;
}

export function findingsSectionFromStudy(input: {
  studyId: string | number;
  modality?: string | null;
  studyDescription?: string | null;
  region?: string | null;
  accessionNumber?: string | null;
  studyInstanceUID?: string | null;
}): FindingsStudySection {
  const studyDescription = (input.studyDescription ?? "").trim() || null;
  return {
    studyId: String(input.studyId),
    title: formatStudySectionTitle(input.modality, studyDescription || input.region),
    modality: input.modality ?? null,
    studyDescription,
    region: input.region ?? null,
    accessionNumber: input.accessionNumber ?? null,
    studyInstanceUID: input.studyInstanceUID ?? null,
  };
}

function titleKey(title: string): string {
  return title.trim().toUpperCase();
}

/** Strip a trailing " (n)" occurrence suffix some titles carry after disambiguation. */
function baseTitleKey(title: string): { base: string; occurrence: number } {
  const m = title.trim().toUpperCase().match(/^(.*?)\s*\((\d+)\)$/);
  if (m && Number(m[2]) > 1) return { base: m[1]!.trim(), occurrence: Number(m[2]) };
  return { base: title.trim().toUpperCase(), occurrence: 1 };
}

/**
 * Two same-titled studies on one combined report is ordinary practice —
 * duplicate catalogue names are legal, and a multi-test bill can stamp one
 * description on every study it fans out to. Left as-is, both sections
 * collapse to one block on every split (the last one swallowing the first's
 * findings), so the second and later same-titled sections are numbered
 * "TITLE (2)"… at SPLIT time — the stored payload keeps its raw title, the
 * disambiguation is purely how the document headers read and re-parse.
 */
function disambiguateSectionTitles(
  sections: FindingsStudySection[],
): Array<{ studyId: string; title: string; baseKey: string; occurrence: number }> {
  const seen = new Map<string, number>();
  return sections.map((s) => {
    const { base } = baseTitleKey(s.title);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const title = occurrence > 1 ? `${s.title.trim()} (${occurrence})` : s.title;
    return { studyId: s.studyId, title, baseKey: base, occurrence };
  });
}

function trimSectionBody(body: string): string {
  return body.replace(/^\n+/, "").replace(/\n+$/, "");
}

export function findingsSectionBlocks(
  full: string,
  sections: FindingsStudySection[],
): Array<{ studyId: string; title: string; body: string }> {
  const titled = disambiguateSectionTitles(sections);
  const ordered = titled.map((s) => ({ ...s, bodyLines: [] as string[] }));
  const byTitle = new Map<string, number>();
  titled.forEach((s, i) => byTitle.set(titleKey(s.title), i));
  const byBase = new Map<string, number[]>();
  titled.forEach((s, i) => {
    const list = byBase.get(s.baseKey) ?? [];
    list.push(i);
    byBase.set(s.baseKey, list);
  });
  const lines = (full ?? "").replace(/\r\n/g, "\n").split("\n");
  let idx = 0;
  let seenHeader = false;
  const preamble: string[] = [];
  // A legacy document saved before disambiguation carries two IDENTICAL bare
  // headers. The first consumes the exact title; the second falls through to
  // occurrence routing (2nd hit of the base → the "(2)" section), so those
  // documents re-split without merging one study's findings into the other's.
  const usedExact = new Set<string>();
  const baseHits = new Map<string, number>();
  const openBlock = (target: number) => {
    if (!seenHeader && preamble.length > 0) {
      ordered[0]?.bodyLines.push(...preamble);
      preamble.length = 0;
    }
    seenHeader = true;
    idx = target;
  };
  for (const line of lines) {
    const key = titleKey(line);
    const exact = byTitle.has(key) && !usedExact.has(key) ? byTitle.get(key)! : null;
    if (exact != null) {
      usedExact.add(key);
      const base = titled[exact]!.baseKey;
      baseHits.set(base, (baseHits.get(base) ?? 0) + 1);
      openBlock(exact);
      continue;
    }
    const { base } = baseTitleKey(line);
    if (byBase.has(base)) {
      const n = (baseHits.get(base) ?? 0) + 1;
      const target = byBase.get(base)!.find((i) => titled[i]!.occurrence === n);
      if (target != null) {
        baseHits.set(base, n);
        openBlock(target);
        continue;
      }
    }
    if (!seenHeader) preamble.push(line);
    else ordered[idx]?.bodyLines.push(line);
  }
  if (!seenHeader && ordered[0]) ordered[0].bodyLines.push(...preamble);
  return ordered.map((s) => ({
    studyId: s.studyId,
    title: s.title,
    body: trimSectionBody(s.bodyLines.join("\n")),
  }));
}

export function composeSectionedFindings(
  blocks: Array<{ title: string; body: string }>,
): string {
  return blocks
    .map((b) => {
      const body = trimSectionBody(b.body);
      return body ? `${b.title}\n${body}` : b.title;
    })
    .join("\n\n");
}

export function ensureSectionedFindings(
  full: string,
  primary: FindingsStudySection,
  linked: FindingsStudySection,
): string {
  const blocks = findingsSectionBlocks(full, [primary, linked]);
  return composeSectionedFindings(blocks);
}

export function replaceFindingsSectionBody(
  full: string,
  sections: FindingsStudySection[],
  targetSectionId: string,
  nextBody: string,
): string {
  const blocks = findingsSectionBlocks(full, sections).map((b) =>
    b.studyId === targetSectionId ? { ...b, body: nextBody } : b,
  );
  return composeSectionedFindings(blocks);
}

export function flattenSectionedFindings(
  full: string,
  sections: FindingsStudySection[],
): string {
  return findingsSectionBlocks(full, sections)
    .map((b) => b.body.trim())
    .filter(Boolean)
    .join("\n\n");
}

function markerTokens(text: string): Set<string> {
  const set = new Set<string>();
  for (const marker of REGION_MARKERS) {
    if (marker.pattern.test(text)) set.add(marker.token);
  }
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 4) set.add(raw);
  }
  return set;
}

/**
 * Chip metadata wins when it uniquely matches one sub-section.
 * Otherwise the active sub-section focus is used, then the primary study.
 */
export function routeChipToFindingsSection(opts: {
  sections: FindingsStudySection[];
  activeSectionId?: string | null;
  anatomicalSection?: string | null;
  region?: string | null;
  studyType?: string | null;
}): string | null {
  if (opts.sections.length === 0) return null;
  if (opts.sections.length === 1) return opts.sections[0]!.studyId;
  const studyType = (opts.studyType ?? "").trim();
  const focused = studyType
    ? [studyType, opts.anatomicalSection].filter(Boolean).join(" ")
    : [opts.studyType, opts.anatomicalSection, opts.region].filter(Boolean).join(" ");
  const needle = markerTokens(focused);
  const scores = opts.sections.map((section) => {
    const hay = markerTokens(
      [section.title, section.studyDescription, section.region].filter(Boolean).join(" "),
    );
    let score = 0;
    for (const token of needle) if (hay.has(token)) score += 1;
    return { id: section.studyId, score };
  });
  const best = Math.max(...scores.map((s) => s.score));
  const winners = scores.filter((s) => s.score === best && s.score > 0);
  if (winners.length === 1) return winners[0]!.id;
  if (opts.activeSectionId && opts.sections.some((s) => s.studyId === opts.activeSectionId)) {
    return opts.activeSectionId;
  }
  return opts.sections[0]!.studyId;
}

export function mergeScopedFindingsProvenance(opts: {
  previous: FieldProvenanceMap | undefined;
  sectionBefore: string;
  sectionAfter: string;
  sectionProvenance: FieldProvenanceMap | undefined;
}): FieldProvenanceMap {
  const merged: FieldProvenanceMap = { ...(opts.previous ?? {}) };
  const after = new Set(
    splitToSentences(opts.sectionAfter).map((s) => normalizeForDedupe(s)).filter(Boolean),
  );
  for (const sentence of splitToSentences(opts.sectionBefore)) {
    const key = normalizeForDedupe(sentence);
    if (key && !after.has(key)) delete merged[key];
  }
  for (const [key, sources] of Object.entries(opts.sectionProvenance ?? {})) {
    merged[key] = sources;
  }
  return merged;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read `structuredJson.linkedStudyId` / `careLinkedStudy` from a draft envelope. */
export function extractLinkedStudyFromStructuredJson(column: unknown): FindingsStudySection | null {
  if (!isRecord(column)) return null;
  const raw = isRecord(column.careLinkedStudy) ? column.careLinkedStudy : null;
  const id = column.linkedStudyId ?? raw?.studyId;
  if (id == null || id === "") return null;
  const studyId = String(typeof raw?.studyId === "number" || typeof raw?.studyId === "string" ? raw.studyId : id);
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  return {
    studyId,
    title: title || `STUDY ${studyId}`,
    modality: typeof raw?.modality === "string" ? raw.modality : null,
    studyDescription: typeof raw?.studyDescription === "string" ? raw.studyDescription : null,
    region: typeof raw?.region === "string" ? raw.region : null,
    accessionNumber: typeof raw?.accessionNumber === "string" ? raw.accessionNumber : null,
    studyInstanceUID: typeof raw?.studyInstanceUID === "string" ? raw.studyInstanceUID : null,
  };
}

export function linkedStudyPayload(section: FindingsStudySection | null): {
  studyId: number | string;
  title: string;
  modality?: string | null;
  studyDescription?: string | null;
  region?: string | null;
  accessionNumber?: string | null;
  studyInstanceUID?: string | null;
} | null {
  if (!section) return null;
  const numeric = Number(section.studyId);
  return {
    studyId: Number.isInteger(numeric) && String(numeric) === section.studyId ? numeric : section.studyId,
    title: section.title,
    modality: section.modality ?? null,
    studyDescription: section.studyDescription ?? null,
    region: section.region ?? null,
    accessionNumber: section.accessionNumber ?? null,
    studyInstanceUID: section.studyInstanceUID ?? null,
  };
}

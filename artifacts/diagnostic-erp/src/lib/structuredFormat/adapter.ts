/**
 * v1 (findingsItems) → v2 StructuredFormatDoc adapter.
 *
 * Existing presets MUST produce the same all-normal findingsMap after adapt
 * (same section labels, same normal text, same order).
 */

import {
  emptyFormatDoc,
  slugId,
  type FindingsMap,
  type FormatSection,
  type StructuredFormatDoc,
  type V1SectionsJson,
} from "./types";

export function parseSectionsJsonUnknown(raw: string | null | undefined): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

export function isV2FormatDoc(value: unknown): value is StructuredFormatDoc {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<StructuredFormatDoc>;
  return v.schemaVersion === 2 && Array.isArray(v.sections);
}

export function isV1Sections(value: unknown): value is V1SectionsJson {
  if (!value || typeof value !== "object") return false;
  const v = value as V1SectionsJson;
  if (v.schemaVersion === 2) return false;
  return Array.isArray(v.findingsItems) || typeof v.technique === "string";
}

function sectionFromV1Item(item: { label: string; normal: string }, index: number): FormatSection {
  const label = (item.label || "").trim() || `Section ${index + 1}`;
  return {
    id: slugId(label, `section-${index + 1}`),
    label,
    headingVisible: true,
    required: false,
    collapsedByDefault: false,
    contributesTo: ["findings"],
    defaultText: item.normal ?? "",
    normalText: item.normal ?? "",
    fields: [],
  };
}

/** Adapt any stored sections_json into a v2 document. v2 passthrough. */
export function adaptToV2(raw: unknown): StructuredFormatDoc {
  if (isV2FormatDoc(raw)) return raw;
  const v1 = (raw && typeof raw === "object" ? raw : {}) as V1SectionsJson;
  const items = Array.isArray(v1.findingsItems) ? v1.findingsItems : [];
  const used = new Set<string>();
  const sections = items.map((item, i) => {
    const base = sectionFromV1Item(item, i);
    let id = base.id;
    let n = 2;
    while (used.has(id)) {
      id = `${base.id}-${n}`;
      n++;
    }
    used.add(id);
    return { ...base, id };
  });
  const doc = emptyFormatDoc(v1.technique ?? "");
  doc.sections = sections;
  return doc;
}

export function adaptSectionsJson(json: string | null | undefined): StructuredFormatDoc {
  return adaptToV2(parseSectionsJsonUnknown(json));
}

/**
 * All-normal findingsMap in template section order.
 * Repeating groups expand to one key per item (item.label), at the position
 * of the first section that repeats that group.
 */
export function allNormalFindingsMap(doc: StructuredFormatDoc): FindingsMap {
  const map: FindingsMap = {};
  const emittedGroups = new Set<string>();
  for (const section of doc.sections) {
    if (section.repeat) {
      if (emittedGroups.has(section.repeat.groupId)) continue;
      emittedGroups.add(section.repeat.groupId);
      const group = doc.repeatingGroupDefs.find((g) => g.id === section.repeat!.groupId);
      if (!group) continue;
      const repeating = doc.sections.filter((s) => s.repeat?.groupId === group.id);
      for (const item of group.items) {
        const parts = repeating
          .map((s) => fillItemTokens(s.normalText, group.itemToken, item.label).trim())
          .filter(Boolean);
        const unique: string[] = [];
        for (const p of parts) if (!unique.includes(p)) unique.push(p);
        map[item.label] = { normal: true, text: unique.join(" ") };
      }
      continue;
    }
    map[section.label] = { normal: true, text: section.normalText };
  }
  return map;
}

export function fillItemTokens(text: string, token: string, itemLabel: string): string {
  if (!text) return "";
  const re = new RegExp(`\\{${token}\\}`, "g");
  return text.replace(re, itemLabel);
}

/** Ordered findingsMap labels for a format (expanded). */
export function findingsMapLabels(doc: StructuredFormatDoc): string[] {
  return Object.keys(allNormalFindingsMap(doc));
}

export function findingsMapToText(map: FindingsMap): string {
  return Object.entries(map)
    .map(([, v]) => v.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** v1 findingsItems → all-normal findingsMap (baseline for adapter gate). */
export function v1AllNormalFindingsMap(raw: unknown): FindingsMap {
  const v1 = (raw && typeof raw === "object" ? raw : {}) as V1SectionsJson;
  const map: FindingsMap = {};
  for (const item of v1.findingsItems ?? []) {
    if (!item.label) continue;
    map[item.label] = { normal: true, text: item.normal ?? "" };
  }
  return map;
}

export function findingsMapsEqual(a: FindingsMap, b: FindingsMap): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const ak = aKeys[i]!;
    if (a[ak]!.normal !== b[ak]!.normal) return false;
    if (a[ak]!.text !== b[ak]!.text) return false;
  }
  return true;
}

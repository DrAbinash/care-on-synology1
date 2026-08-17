/**
 * Opt-in upgrade: copied per-level v1 sections → one repeating group.
 * Never auto-migrates. Apply only when all-normal findingsMap is byte-identical.
 */

import { adaptToV2, allNormalFindingsMap, findingsMapsEqual, v1AllNormalFindingsMap } from "./adapter";
import type { FormatSection, RepeatingGroupDef, StructuredFormatDoc, V1SectionsJson } from "./types";
import { slugId } from "./types";

const LEVEL_RE = /^([CTLDS])(\d{1,2})\s*[-–/]\s*([CTLDS]?)(\d{1,2}|S\d)$/i;

export function looksLikeLevelLabel(label: string): boolean {
  const t = label.trim();
  if (LEVEL_RE.test(t)) return true;
  // L1-L2, C5-C6, T11-T12, L5-S1
  return /^[CTLDS]\d{1,2}\s*[-–/]\s*[CTLDS]?\d{1,2}$/i.test(t.replace(/\s+/g, ""));
}

export type UpgradePreview = {
  eligible: boolean;
  reason: string;
  copiedCount: number;
  groupLabel: string;
  itemLabels: string[];
  proposed: StructuredFormatDoc | null;
  allNormalIdentical: boolean;
};

function detectCopiedLevelRun(items: Array<{ label: string; normal: string }>): {
  start: number;
  end: number;
  labels: string[];
} | null {
  let start = -1;
  for (let i = 0; i < items.length; i++) {
    if (looksLikeLevelLabel(items[i]!.label)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= 3) return { start, end: i, labels: items.slice(start, i).map((x) => x.label) };
      start = -1;
    }
  }
  if (start >= 0 && items.length - start >= 3) {
    return { start, end: items.length, labels: items.slice(start).map((x) => x.label) };
  }
  return null;
}

export function previewCopiedLevelUpgrade(raw: unknown): UpgradePreview {
  const v1 = (raw && typeof raw === "object" ? raw : {}) as V1SectionsJson;
  if ((raw as { schemaVersion?: number })?.schemaVersion === 2) {
    return {
      eligible: false,
      reason: "Already a v2 structured format.",
      copiedCount: 0,
      groupLabel: "",
      itemLabels: [],
      proposed: null,
      allNormalIdentical: false,
    };
  }
  const items = v1.findingsItems ?? [];
  const run = detectCopiedLevelRun(items);
  if (!run) {
    return {
      eligible: false,
      reason: "No run of copied anatomical levels (need ≥3 consecutive level sections).",
      copiedCount: 0,
      groupLabel: "",
      itemLabels: [],
      proposed: null,
      allNormalIdentical: false,
    };
  }

  const proposed = buildRepeatingUpgrade(v1, run.start, run.end);
  const identical = findingsMapsEqual(v1AllNormalFindingsMap(v1), allNormalFindingsMap(proposed));
  return {
    eligible: true,
    reason: identical
      ? `This format has ${run.labels.length} copied disc sections. The repeating-group format produces the same all-normal output.`
      : `This format has ${run.labels.length} copied disc sections, but the repeating-group preview is not byte-identical — Apply is blocked.`,
    copiedCount: run.labels.length,
    groupLabel: "Anatomical levels",
    itemLabels: run.labels,
    proposed,
    allNormalIdentical: identical,
  };
}

function buildRepeatingUpgrade(
  v1: V1SectionsJson,
  start: number,
  end: number,
): StructuredFormatDoc {
  const doc = adaptToV2({
    technique: v1.technique,
    findingsItems: [
      ...v1.findingsItems!.slice(0, start),
      v1.findingsItems![start],
      ...v1.findingsItems!.slice(end),
    ],
  });

  const levelItems = v1.findingsItems!.slice(start, end);
  const group: RepeatingGroupDef = {
    id: "anatomical-level",
    label: "Anatomical levels",
    itemToken: "level",
    items: levelItems.map((it, i) => ({
      id: slugId(it.label, `lvl-${i + 1}`),
      label: it.label,
    })),
  };

  const firstNormal = levelItems[0]?.normal ?? "";
  const discSection: FormatSection = {
    id: "repeating-levels",
    label: "Levels",
    headingVisible: false,
    required: false,
    collapsedByDefault: false,
    contributesTo: ["findings"],
    defaultText: firstNormal,
    normalText: firstNormal,
    repeat: { groupId: group.id },
    fields: [],
  };

  const before = doc.sections.slice(0, start);
  const after = doc.sections.slice(start + 1); // adaptToV2 kept one placeholder level
  doc.repeatingGroupDefs = [group];
  doc.sections = [...before, discSection, ...after];
  return doc;
}

export function applyCopiedLevelUpgrade(raw: unknown): StructuredFormatDoc {
  const preview = previewCopiedLevelUpgrade(raw);
  if (!preview.allNormalIdentical || !preview.proposed) {
    throw new Error(preview.reason);
  }
  return preview.proposed;
}

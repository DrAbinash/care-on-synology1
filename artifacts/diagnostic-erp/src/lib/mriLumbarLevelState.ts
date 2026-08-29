/**
 * Pure R2 lumbar level derivation — ledger ↔ editor ↔ display.
 * Anatomical levels (L3-L4 …) are NOT Study Tabs.
 */

import type { AppliedPathologyPatch, PendingPathologyPatch } from "@/lib/zai-workspace/store";
import {
  CANAL_STENOSIS_OPTIONS,
  DISC_MORPHOLOGY_OPTIONS,
  LATERALITY_OPTIONS,
  MODIC_OPTIONS,
  composeLumbarLevelNarrative,
  inferTraversingRoot,
  type LumbarLevelSelection,
} from "@/lib/mriLumbarRegions";
import { normalizeLevel } from "@/lib/observationSlot";
import { splitToSentences } from "@/lib/reportFieldMerge";

/** Per-level baseline from CARE LS structured format (LEVEL_NORMAL). */
export const LS_LEVEL_DISC_BASELINE =
  "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis.";

export const LS_LEVEL_CANAL_BASELINE = "No spinal canal stenosis.";
export const LS_LEVEL_ENDPLATE_BASELINE = "No Modic endplate changes.";
export const LS_LEVEL_ROOT_BASELINE = "No nerve root contact or compression.";
export const LS_LEVEL_FORAMINAL_BASELINE = "Neural foramina patent.";
export const LS_LEVEL_SIGNAL_BASELINE = "Disc signal is preserved.";
export const LS_LEVEL_HEIGHT_BASELINE = "Disc height is preserved.";

/** True when Apply would emit at least one observation (incl. foraminal / AP-only). */
export function lumbarLevelApplyHasContent(sel: LumbarLevelSelection): boolean {
  return !!(
    sel.morphology
    || sel.desiccation
    || sel.reducedHeight
    || sel.canal
    || sel.modic
    || sel.rootContact
    || sel.foraminalSeverity
    || sel.canalApMm != null
  );
}

export type LevelBlockDisplayKind =
  | "structured"
  | "template-narrative"
  | "empty"
  | "stale"
  | "conflict";

export type LevelBlockDisplay = {
  kind: LevelBlockDisplayKind;
  label: string;
  summaryLines: string[];
  patches: AppliedPathologyPatch[];
};

function levelKey(raw: string): string {
  return normalizeLevel(raw) || raw.trim().toUpperCase();
}

/** Patches whose canonical level matches this disc level. */
export function patchesForLumbarLevel(
  patches: AppliedPathologyPatch[],
  level: string,
): AppliedPathologyPatch[] {
  const want = levelKey(level);
  if (!want) return [];
  return patches.filter((p) => {
    const lvl = levelKey(p.observation?.level ?? p.ownership.anatomicalSection ?? "");
    return lvl === want;
  });
}

/** True when findings prose mentions this disc level (template/format narrative). */
export function narrativeMentionsLevel(findingsText: string | null | undefined, level: string): boolean {
  const want = levelKey(level);
  if (!want || !(findingsText ?? "").trim()) return false;
  const esc = want.replace(/-/g, "[-–—\\s]?");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  return re.test(findingsText!);
}

/**
 * Derive chip state from canonical ledger rows for this level.
 * Prefer structured concept slots; do not invent from free prose.
 */
export function deriveLumbarLevelSelection(
  patches: AppliedPathologyPatch[],
  level: string,
): LumbarLevelSelection {
  const rows = patchesForLumbarLevel(patches, level).filter((p) => !p.stale);
  const sel: LumbarLevelSelection = {};

  for (const p of rows) {
    const concept = (p.observation?.concept ?? p.ownership.concept ?? p.ownership.conflictGroup ?? "").toLowerCase();
    const findings = (p.lastRendered.findings ?? p.templates.findings ?? "").toLowerCase();
    const lat = (p.observation?.laterality || p.ownership.laterality || "").toLowerCase();
    const sev = (p.observation?.severity || "").toLowerCase();

    if (concept === "disc_contour" || /bulge|protrusion|extrusion|sequestration|herniation|no disc herniation|disc height and signal/.test(findings)) {
      if (/sequestration/.test(findings)) sel.morphology = "sequestration";
      else if (/extrusion/.test(findings)) sel.morphology = "extrusion";
      else if (/protrusion/.test(findings)) sel.morphology = "protrusion";
      else if (/bulge/.test(findings)) sel.morphology = "bulge";
      else if (/annular fissure/.test(findings)) sel.morphology = "annular-fissure";
      else if (/no herniation|preserved with no herniation|normal disc/.test(findings)) sel.morphology = "normal";
      if (lat.includes("left") && lat.includes("para")) sel.laterality = "left-paracentral";
      else if (lat.includes("right") && lat.includes("para")) sel.laterality = "right-paracentral";
      else if (lat.includes("left") && lat.includes("foram")) sel.laterality = "left-foraminal";
      else if (lat.includes("right") && lat.includes("foram")) sel.laterality = "right-foraminal";
      else if (lat.includes("bilateral") || /bilateral/.test(findings)) sel.laterality = "bilateral";
      else if (lat.includes("central") || /central/.test(findings)) sel.laterality = "central";
      else {
        const latOpt = LATERALITY_OPTIONS.find((o) => o.id === lat || findings.includes(o.label.toLowerCase()));
        if (latOpt) sel.laterality = latOpt.id;
      }
    }

    if (concept === "disc_signal" || /desiccat/.test(findings)) {
      sel.desiccation = true;
    }
    if (concept === "disc_height" || /reduced (disc )?height|height (is )?reduc/.test(findings)) {
      sel.reducedHeight = true;
    }

    if (concept === "canal_stenosis" || /canal stenosis/.test(findings)) {
      if (/severe/.test(sev) || /severe canal/.test(findings)) sel.canal = "severe";
      else if (/moderate/.test(sev) || /moderate canal/.test(findings)) sel.canal = "moderate";
      else if (/mild/.test(sev) || /mild canal/.test(findings)) sel.canal = "mild";
      else if (/no spinal canal stenosis|no significant canal/.test(findings)) sel.canal = "none";
    }

    if (concept === "endplate" || /modic/.test(findings)) {
      if (/type\s*3|modic 3/.test(findings)) sel.modic = "type3";
      else if (/type\s*2|modic 2/.test(findings)) sel.modic = "type2";
      else if (/type\s*1|modic 1/.test(findings)) sel.modic = "type1";
    }

    if (concept === "root_contact" || /root contact|nerve root|root compression|root impingement/.test(findings)) {
      sel.rootContact = true;
      const rootMatch = findings.match(/\b(L\d|S1)\b/i);
      if (rootMatch) sel.rootLevel = rootMatch[1]!.toUpperCase();
      const state = (p.observation?.state || "").toLowerCase();
      if (state.includes("compress") || /compression|impingement/.test(findings)) {
        sel.rootRelation = "compression";
      } else {
        sel.rootRelation = "contact";
      }
    }

    if (concept === "foraminal_stenosis" || /foraminal (stenosis|narrowing)/.test(findings)) {
      if (/bilateral/.test(findings) || lat.includes("bilateral")) sel.foraminalLaterality = "bilateral";
      else if (/left/.test(findings) || lat.includes("left")) sel.foraminalLaterality = "left";
      else if (/right/.test(findings) || lat.includes("right")) sel.foraminalLaterality = "right";
      if (/severe/.test(findings)) sel.foraminalSeverity = "severe";
      else if (/moderate/.test(findings)) sel.foraminalSeverity = "moderate";
      else if (/mild/.test(findings)) sel.foraminalSeverity = "mild";
    }

    if (concept === "canal_ap" || /ap canal diameter|canal ap/.test(findings)) {
      const m = findings.match(/(\d+(?:\.\d+)?)\s*mm/);
      if (m) sel.canalApMm = Number(m[1]);
    }
    const meas = (p.observation?.measurement || "").trim();
    if (meas && concept === "canal_ap") {
      const n = Number(meas.replace(/[^\d.]/g, ""));
      if (Number.isFinite(n)) sel.canalApMm = n;
    }
  }

  return sel;
}

export function summarizeLumbarLevelLines(patches: AppliedPathologyPatch[], level: string): string[] {
  const rows = patchesForLumbarLevel(patches, level);
  const lines: string[] = [];
  for (const p of rows) {
    const concept = p.observation?.concept ?? p.ownership.conflictGroup ?? "obs";
    const lat = p.observation?.laterality || "";
    const sev = p.observation?.severity || "";
    const snippet = (p.lastRendered.findings ?? "").trim();
    const short = [
      concept,
      lat,
      sev,
      p.stale ? "STALE" : "",
    ].filter(Boolean).join(" · ");
    if (snippet) {
      lines.push(`${short}: ${snippet.length > 120 ? `${snippet.slice(0, 117)}…` : snippet}`);
    } else {
      lines.push(short);
    }
  }
  return lines;
}

export function deriveLevelBlockDisplay(
  patches: AppliedPathologyPatch[],
  level: string,
  findingsText: string,
  contradictionHints: string[] = [],
): LevelBlockDisplay {
  const levelPatches = patchesForLumbarLevel(patches, level);
  const active = levelPatches.filter((p) => !p.stale);
  const stale = levelPatches.filter((p) => p.stale);
  const summaryLines = summarizeLumbarLevelLines(levelPatches, level);
  const mentions = narrativeMentionsLevel(findingsText, level);
  const conflict = contradictionHints.some((w) => {
    const want = levelKey(level);
    return want && w.toUpperCase().includes(want);
  });

  if (conflict) {
    return { kind: "conflict", label: "Conflict", summaryLines, patches: levelPatches };
  }
  if (stale.length > 0 && active.length === 0) {
    return { kind: "stale", label: "Stale ledger", summaryLines, patches: levelPatches };
  }
  if (active.length > 0) {
    return { kind: "structured", label: summaryLines[0]?.split(":")[0] ?? "Structured", summaryLines, patches: levelPatches };
  }
  if (mentions || (findingsText.trim() && !levelPatches.length && narrativeMentionsLevel(findingsText, level))) {
    return {
      kind: "template-narrative",
      label: "Template / narrative",
      summaryLines: mentions
        ? ["Narrative references this level — not yet structured in ledger"]
        : [],
      patches: levelPatches,
    };
  }
  if (findingsText.trim() && !mentions && levelPatches.length === 0) {
    // Global template may exist without per-level mention — still not "Empty" clinically if format applied
    return { kind: "empty", label: "Empty", summaryLines: [], patches: [] };
  }
  return { kind: "empty", label: "Empty", summaryLines: [], patches: [] };
}

/** When findings have template prose but no structured rows at any disc level. */
export function deriveCanvasNarrativeState(opts: {
  findingsText: string;
  patches: AppliedPathologyPatch[];
  isLumbar: boolean;
}): { hasUnstructuredNarrative: boolean; banner: string | null } {
  if (!opts.isLumbar) return { hasUnstructuredNarrative: false, banner: null };
  const text = (opts.findingsText ?? "").trim();
  if (!text) return { hasUnstructuredNarrative: false, banner: null };
  const structuredLevels = opts.patches.filter(
    (p) => !p.stale && normalizeLevel(p.observation?.level ?? p.ownership.anatomicalSection ?? ""),
  );
  if (structuredLevels.length > 0) {
    return { hasUnstructuredNarrative: false, banner: null };
  }
  // Format/template prose without ledger ownership
  return {
    hasUnstructuredNarrative: true,
    banner: "Report contains unstructured/template narrative not represented in level ledger.",
  };
}

export type LumbarAtomicPending = PendingPathologyPatch & { force?: boolean };

function patchId(level: string, concept: string, laterality?: string): string {
  const lvl = level.replace(/\s+/g, "");
  const lat = (laterality ?? "").replace(/\s+/g, "") || "na";
  return `r2-ls-${lvl}-${concept}-${lat}`;
}

/**
 * Build atomic PendingPathologyPatch rows for one level Apply.
 * Human still sees one composed sentence; ledger gets separable concepts.
 */
export function buildLumbarLevelApplyBundle(opts: {
  level: string;
  sel: LumbarLevelSelection;
  region: string;
  bundleId?: string;
}): { bundleId: string; observations: LumbarAtomicPending[]; composed: ReturnType<typeof composeLumbarLevelNarrative> } {
  const level = opts.level;
  const sel = opts.sel;
  const region = opts.region || "LS Spine";
  const bundleId = opts.bundleId || `r2-ls-bundle-${level.replace(/\s+/g, "")}-${Date.now().toString(36)}`;
  const composed = composeLumbarLevelNarrative(level, sel);
  const observations: LumbarAtomicPending[] = [];

  const morph = DISC_MORPHOLOGY_OPTIONS.find((o) => o.id === sel.morphology);
  const lat = LATERALITY_OPTIONS.find((o) => o.id === sel.laterality);
  const canal = CANAL_STENOSIS_OPTIONS.find((o) => o.id === sel.canal);
  const modic = MODIC_OPTIONS.find((o) => o.id === sel.modic);

  // Disc morphology / contour (incl. normal)
  if (morph) {
    const latId = morph.id === "normal" ? "" : (lat?.id ?? "");
    let findings: string;
    let impression = "";
    if (morph.id === "normal") {
      findings = `At ${level}, disc height and signal are preserved with no herniation.`;
    } else {
      const latPhrase = lat ? `${lat.label.toLowerCase()} ` : "";
      findings = `At ${level}, a ${latPhrase}${morph.findings}.`;
      impression = `${level}: ${latPhrase}${morph.impression}.`.trim();
    }
    observations.push({
      id: patchId(level, "disc_contour", latId),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "disc_contour",
        baselineReplaces: LS_LEVEL_DISC_BASELINE,
        concept: "disc_contour",
        level,
        laterality: latId,
      },
      source: "structured-template",
      region,
      level,
      laterality: latId,
      concept: "disc_contour",
      label: `${level} disc_contour`,
      findingsText: findings,
      bundleId,
    });
  }

  if (sel.desiccation) {
    const findings = `At ${level}, disc desiccation with loss of T2 signal is noted.`;
    observations.push({
      id: patchId(level, "disc_signal"),
      incoming: { findings, impression: `${level}: disc desiccation.` },
      templates: { findings, impression: `${level}: disc desiccation.` },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "disc_signal",
        baselineReplaces: LS_LEVEL_SIGNAL_BASELINE,
        concept: "disc_signal",
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: "disc_signal",
      label: `${level} disc_signal`,
      findingsText: findings,
      bundleId,
    });
  }

  if (sel.reducedHeight) {
    const findings = `At ${level}, disc height is reduced.`;
    observations.push({
      id: patchId(level, "disc_height"),
      incoming: { findings, impression: `${level}: reduced disc height.` },
      templates: { findings, impression: `${level}: reduced disc height.` },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "disc_height",
        baselineReplaces: LS_LEVEL_HEIGHT_BASELINE,
        concept: "disc_height",
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: "disc_height",
      label: `${level} disc_height`,
      findingsText: findings,
      bundleId,
    });
  }

  if (canal && canal.id !== "none") {
    const findings = `At ${level}, there is ${canal.findings}.`;
    const impression = `${level}: ${canal.findings}.`;
    observations.push({
      id: patchId(level, "canal_stenosis"),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "canal_stenosis",
        baselineReplaces: LS_LEVEL_CANAL_BASELINE,
        concept: "canal_stenosis",
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: "canal_stenosis",
      severity: canal.severity,
      label: `${level} canal_stenosis`,
      findingsText: findings,
      bundleId,
    });
  } else if (morph?.id === "normal" && (!canal || canal.id === "none")) {
    // Normal level may assert patent canal via disc baseline; optional explicit none skipped
  }

  if (sel.foraminalSeverity && sel.foraminalSeverity !== "none") {
    const side = sel.foraminalLaterality ?? "bilateral";
    const sideLabel = side === "bilateral" ? "bilateral" : `${side}`;
    const findings = `At ${level}, ${sel.foraminalSeverity} ${sideLabel} neural foraminal stenosis is noted.`;
    observations.push({
      id: patchId(level, "foraminal_stenosis", side),
      incoming: { findings, impression: `${level}: ${sel.foraminalSeverity} ${sideLabel} foraminal stenosis.` },
      templates: { findings, impression: `${level}: ${sel.foraminalSeverity} ${sideLabel} foraminal stenosis.` },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "foraminal_stenosis",
        baselineReplaces: LS_LEVEL_FORAMINAL_BASELINE,
        concept: "foraminal_stenosis",
        level,
        laterality: side,
      },
      source: "structured-template",
      region,
      level,
      laterality: side,
      concept: "foraminal_stenosis",
      severity: sel.foraminalSeverity,
      label: `${level} foraminal_stenosis`,
      findingsText: findings,
      bundleId,
      supportsLaterality: true,
    });
  }

  if (sel.rootContact) {
    const root = (sel.rootLevel ?? "").trim() || inferTraversingRoot(level);
    const relation = sel.rootRelation === "compression" ? "compression" : "contact";
    const verb = relation === "compression" ? "compresses" : "contacts";
    const findings = `At ${level}, disc material ${verb} the ${root} nerve root.`;
    const impression = `${level}: ${root} root ${relation}.`;
    observations.push({
      id: patchId(level, "root_contact", root),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "root_contact",
        baselineReplaces: LS_LEVEL_ROOT_BASELINE,
        concept: "root_contact",
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: "root_contact",
      state: relation,
      label: `${level} root_contact`,
      findingsText: findings,
      bundleId,
    });
  }

  if (modic && modic.id !== "none" && modic.findings) {
    const findings = `At ${level}, ${modic.findings} are present.`;
    const impression = `${level}: ${modic.findings}.`;
    observations.push({
      id: patchId(level, "endplate"),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "endplate",
        baselineReplaces: LS_LEVEL_ENDPLATE_BASELINE,
        concept: "endplate",
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: "endplate",
      label: `${level} endplate`,
      findingsText: findings,
      bundleId,
    });
  }

  if (sel.canalApMm != null && Number.isFinite(sel.canalApMm)) {
    const findings = `At ${level}, AP canal diameter measures ${sel.canalApMm} mm.`;
    observations.push({
      id: patchId(level, "canal_ap"),
      incoming: { findings, impression: `${level}: AP canal ${sel.canalApMm} mm.` },
      templates: { findings, impression: `${level}: AP canal ${sel.canalApMm} mm.` },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "canal_ap",
        baselineReplaces: "",
        concept: "canal_ap",
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: "canal_ap",
      measurement: String(sel.canalApMm),
      label: `${level} canal_ap`,
      findingsText: findings,
      bundleId,
    });
  }

  // Atomic rows keep separable narrative sentences — preview still uses composed.
  return { bundleId, observations, composed };
}

/** Coverage scope key from Study Tab / reporting region (not anatomical level). */
export function coverageScopeKey(region: string | null | undefined): string {
  const r = (region ?? "").trim();
  return r || "__unscoped__";
}

export function ledgerSeverityContradiction(
  patches: AppliedPathologyPatch[],
  impressionText: string,
): string[] {
  const warnings: string[] = [];
  const sentences = splitToSentences(impressionText ?? "").map((s) => s.toLowerCase());
  for (const p of patches) {
    if (p.stale) continue;
    const concept = p.observation?.concept ?? "";
    if (concept !== "canal_stenosis") continue;
    const level = p.observation?.level ?? p.ownership.anatomicalSection ?? "";
    const sev = (p.observation?.severity || "").toLowerCase();
    if (!level || !sev) continue;
    const lvl = level.toLowerCase();
    const lvlCompact = lvl.replace(/-/g, "");
    for (const sentence of sentences) {
      const hasLevel = sentence.includes(lvl) || sentence.includes(lvlCompact);
      if (!hasLevel) continue;
      for (const other of ["mild", "moderate", "severe"] as const) {
        if (other === sev) continue;
        const hasOtherSev =
          sentence.includes(`${other} canal`)
          || sentence.includes(`${other} ${lvl}`)
          || (sentence.includes(other) && sentence.includes("stenosis"));
        if (hasOtherSev) {
          warnings.push(
            `Structured mismatch: Findings ledger has ${sev} canal stenosis at ${level} but Impression mentions ${other}.`,
          );
        }
      }
    }
  }
  return warnings;
}

/**
 * Structured-vs-structured: AP canal < 10 mm coexisting with canal stenosis
 * marked none/mild at the same level is clinically inconsistent.
 */
export function structuredCanalApContradiction(patches: AppliedPathologyPatch[]): string[] {
  const warnings: string[] = [];
  const byLevel = new Map<string, { ap: number | null; canalSev: string | null; levelLabel: string }>();

  for (const p of patches) {
    if (p.stale) continue;
    const level = (p.observation?.level || p.ownership.anatomicalSection || "").trim();
    if (!level) continue;
    const key = levelKey(level) || level.toUpperCase();
    const slot = byLevel.get(key) ?? { ap: null, canalSev: null, levelLabel: level };
    const concept = (p.observation?.concept || p.ownership.concept || "").toLowerCase();
    if (concept === "canal_ap" || concept === "canal_ap_diameter") {
      const raw = p.observation?.measurement || "";
      const n = Number(String(raw).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);
      if (Number.isFinite(n)) slot.ap = n;
    }
    if (concept === "canal_stenosis") {
      slot.canalSev = (p.observation?.severity || "").toLowerCase() || "none";
    }
    byLevel.set(key, slot);
  }

  for (const slot of byLevel.values()) {
    if (slot.ap == null || !(slot.ap < 10)) continue;
    if (slot.canalSev !== "none" && slot.canalSev !== "mild") continue;
    warnings.push(
      `Structured mismatch: AP canal ${slot.ap} mm at ${slot.levelLabel} coexists with canal stenosis marked ${slot.canalSev}.`,
    );
  }
  return warnings;
}

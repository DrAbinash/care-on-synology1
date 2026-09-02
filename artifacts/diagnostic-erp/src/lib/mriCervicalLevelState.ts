/**
 * mriCervicalLevelState.ts — pure R2 cervical level derivation + bundle builder.
 *
 * Mirrors mriLumbarLevelState.ts architecture but uses cervical-specific
 * clinical semantics:
 *
 *   - Cervical root numbering (C5-C6 disc → exiting C6 root, C7-T1 → C8)
 *   - NO automatic lumbar-style "traversing root" exposure in the UI.
 *     The cervical canvas shows only the "corresponding exiting nerve root"
 *     for foraminal disease. Central/paracentral disc effects are described
 *     through cord/thecal sac findings (cord_compression, thecal_compression).
 *   - Cord signal change is a first-class cervical concept (myelopathy).
 *
 * Anatomical levels (C2-C3 … C7-T1) are NOT Study Tabs.
 *
 * Reuses the SAME canonical reporting architecture:
 *   - applyMacroBundle (bundle of atomic observations)
 *   - applyPathologyOverlay (same-slot replacement)
 *   - observationSlot (region | concept | level | laterality)
 *   - canalApProvenance (persisted measurement store)
 *
 * Does NOT create a second reporting engine. Every observation passes
 * through the same canonical ledger as Quick Select / Structured / Voice.
 */

import type { AppliedPathologyPatch, PendingPathologyPatch } from "@/lib/zai-workspace/store";
import { normalizeLevel } from "@/lib/observationSlot";
import { inferCervicalExitingRoot } from "./mriSpineCanvasRegions";

// ─── Cervical clinical concepts ──────────────────────────────────────────

/**
 * Cervical disc morphology options.
 *
 * Clinically appropriate for cervical spine. Includes disc-osteophyte
 * complex (common cervical finding — distinct from pure bulge).
 */
export const CERVICAL_DISC_MORPHOLOGY_OPTIONS = [
  { id: "normal", label: "Normal", findings: "Normal disc height and signal with no herniation." },
  { id: "desiccation", label: "Desiccation", findings: "disc desiccation with loss of T2 signal" },
  { id: "bulge", label: "Bulge", findings: "diffuse disc bulge" },
  { id: "protrusion", label: "Protrusion", findings: "focal disc protrusion" },
  { id: "disc-osteophyte", label: "Disc-osteophyte", findings: "disc-osteophyte complex" },
  { id: "extrusion", label: "Extrusion", findings: "disc extrusion" },
] as const;

/**
 * Cervical thecal sac / canal effect.
 *
 * Cervical canal stenosis is graded as in lumbar (mild/moderate/severe).
 */
export const CERVICAL_CANAL_OPTIONS = [
  { id: "none", label: "None", findings: "No anterior thecal sac indentation.", severity: "" },
  { id: "indentation", label: "Indentation", findings: "anterior thecal sac indentation", severity: "mild" },
  { id: "compression", label: "Compression", findings: "anterior thecal sac compression", severity: "moderate" },
  { id: "stenosis-mild", label: "Stenosis (mild)", findings: "mild canal stenosis", severity: "mild" },
  { id: "stenosis-moderate", label: "Stenosis (moderate)", findings: "moderate canal stenosis", severity: "moderate" },
  { id: "stenosis-severe", label: "Stenosis (severe)", findings: "severe canal stenosis", severity: "severe" },
] as const;

/**
 * Cervical foraminal narrowing.
 *
 * Left / right / bilateral coexist (two observations at the same level).
 */
export const CERVICAL_FORAMINAL_OPTIONS = [
  { id: "none", label: "None" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "bilateral", label: "Bilateral" },
] as const;

export const CERVICAL_FORAMINAL_SEVERITY = [
  { id: "none", label: "None" },
  { id: "mild", label: "Mild" },
  { id: "moderate", label: "Moderate" },
  { id: "severe", label: "Severe" },
] as const;

/**
 * Cervical cord status.
 *
 * Cord compression + T2 signal change = myelopathic concern.
 */
export const CERVICAL_CORD_OPTIONS = [
  { id: "normal", label: "Normal", findings: "Cervical cord shows normal signal with no compression." },
  { id: "compression", label: "Compression", findings: "Cervical cord compression is noted at this level." },
  { id: "t2-change", label: "T2 ↑ (myelopathy)", findings: "T2 hyperintense signal in the cord at this level — suggestive of myelopathic change." },
] as const;

/**
 * Cervical posterior element options.
 */
export const CERVICAL_FACET_OPTIONS = [
  { id: "none", label: "None" },
  { id: "arthropathy", label: "Facet arthropathy" },
  { id: "uncovertebral", label: "Uncovertebral hypertrophy" },
] as const;

/**
 * Cervical ligament options.
 */
export const CERVICAL_LIGAMENT_OPTIONS = [
  { id: "none", label: "None" },
  { id: "lf-hypertrophy", label: "LF hypertrophy" },
  { id: "pll-thickening", label: "PLL thickening" },
] as const;

// ─── Cervical selection type ─────────────────────────────────────────────

export type CervicalLevelSelection = {
  morphology?: (typeof CERVICAL_DISC_MORPHOLOGY_OPTIONS)[number]["id"];
  canal?: (typeof CERVICAL_CANAL_OPTIONS)[number]["id"];
  foraminal?: (typeof CERVICAL_FORAMINAL_OPTIONS)[number]["id"];
  foraminalSeverity?: (typeof CERVICAL_FORAMINAL_SEVERITY)[number]["id"];
  cord?: (typeof CERVICAL_CORD_OPTIONS)[number]["id"];
  facet?: (typeof CERVICAL_FACET_OPTIONS)[number]["id"];
  ligament?: (typeof CERVICAL_LIGAMENT_OPTIONS)[number]["id"];
  canalApMm?: number | null;
};

// ─── Baselines ────────────────────────────────────────────────────────────

export const CERVICAL_LEVEL_DISC_BASELINE =
  "Normal disc height and signal. No disc herniation.";
export const CERVICAL_LEVEL_CANAL_BASELINE = "No canal stenosis.";
export const CERVICAL_LEVEL_CORD_BASELINE = "Cervical cord is normal in signal with no compression.";
export const CERVICAL_LEVEL_FORAMINAL_BASELINE = "Neural foramina are patent.";
export const CERVICAL_LEVEL_FACET_BASELINE = "Facet joints are normal.";

// ─── Apply-content check ────────────────────────────────────────────────

/** True when Apply would emit at least one observation. */
export function cervicalLevelApplyHasContent(sel: CervicalLevelSelection): boolean {
  return !!(
    sel.morphology
    || sel.canal
    || sel.foraminal
    || sel.cord
    || sel.facet
    || sel.ligament
    || sel.canalApMm != null
  );
}

// ─── Display derivation (shared pattern with lumbar) ────────────────────

export type CervicalLevelBlockDisplayKind =
  | "structured"
  | "template-narrative"
  | "empty"
  | "stale"
  | "conflict";

export type CervicalLevelBlockDisplay = {
  kind: CervicalLevelBlockDisplayKind;
  label: string;
  summaryLines: string[];
  patches: AppliedPathologyPatch[];
};

function levelKey(raw: string): string {
  return normalizeLevel(raw) || raw.trim().toUpperCase();
}

/** Patches whose canonical level matches this cervical disc level. */
export function patchesForCervicalLevel(
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

function narrativeMentionsLevel(findingsText: string | null | undefined, level: string): boolean {
  const want = levelKey(level);
  if (!want || !(findingsText ?? "").trim()) return false;
  const esc = want.replace(/-/g, "[-–—\\s]?");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  return re.test(findingsText!);
}

/**
 * Derive chip state from canonical ledger rows for this cervical level.
 * Prefer structured concept slots; do not invent from free prose.
 */
export function deriveCervicalLevelSelection(
  patches: AppliedPathologyPatch[],
  level: string,
): CervicalLevelSelection {
  const rows = patchesForCervicalLevel(patches, level).filter((p) => !p.stale);
  const sel: CervicalLevelSelection = {};

  for (const p of rows) {
    const concept = (p.observation?.concept ?? p.ownership.concept ?? p.ownership.conflictGroup ?? "").toLowerCase();
    const findings = (p.lastRendered.findings ?? p.templates.findings ?? "").toLowerCase();
    const lat = (p.observation?.laterality || p.ownership.laterality || "").toLowerCase();
    const sev = (p.observation?.severity || "").toLowerCase();

    if (concept === "disc_contour") {
      if (/disc-osteophyte complex/.test(findings)) sel.morphology = "disc-osteophyte";
      else if (/extrusion/.test(findings)) sel.morphology = "extrusion";
      else if (/protrusion/.test(findings)) sel.morphology = "protrusion";
      else if (/bulge/.test(findings)) sel.morphology = "bulge";
      else if (/no herniation|normal disc/.test(findings)) sel.morphology = "normal";
    }

    if (concept === "disc_signal" || /desiccat/.test(findings)) {
      sel.morphology = sel.morphology ?? "desiccation";
    }

    if (concept === "canal_stenosis" || concept === "thecal_compression") {
      if (/severe/.test(sev) || /severe canal/.test(findings)) sel.canal = "stenosis-severe";
      else if (/moderate/.test(sev) || /moderate canal/.test(findings)) sel.canal = "stenosis-moderate";
      else if (/mild/.test(sev) || /mild canal/.test(findings)) sel.canal = "stenosis-mild";
      else if (/compression/.test(findings)) sel.canal = "compression";
      else if (/indentation/.test(findings)) sel.canal = "indentation";
      else if (/no canal|no anterior thecal/.test(findings)) sel.canal = "none";
    }

    if (concept === "foraminal_stenosis" || /foraminal/.test(findings)) {
      if (/bilateral/.test(findings) || lat.includes("bilateral")) sel.foraminal = "bilateral";
      else if (/left/.test(findings) || lat.includes("left")) sel.foraminal = "left";
      else if (/right/.test(findings) || lat.includes("right")) sel.foraminal = "right";
      else sel.foraminal = "none";
      if (/severe/.test(findings)) sel.foraminalSeverity = "severe";
      else if (/moderate/.test(findings)) sel.foraminalSeverity = "moderate";
      else if (/mild/.test(findings)) sel.foraminalSeverity = "mild";
    }

    if (concept === "cord_compression" || concept === "cord_signal" || /cord/.test(findings)) {
      if (/t2.*hyperintense|myelopath/.test(findings)) sel.cord = "t2-change";
      else if (/compress/.test(findings)) sel.cord = "compression";
      else if (/normal.*cord|cord.*normal/.test(findings)) sel.cord = "normal";
    }

    if (concept === "facet_joint" || /facet/.test(findings)) {
      if (/uncovertebral/.test(findings)) sel.facet = "uncovertebral";
      else if (/arthropathy|hypertrophy/.test(findings)) sel.facet = "arthropathy";
    }

    if (concept === "ligamentum_flavum" || /ligamentum flavum/.test(findings)) {
      sel.ligament = "lf-hypertrophy";
    }
    if (/pll.*thicken|thicken.*pll/.test(findings)) {
      sel.ligament = "pll-thickening";
    }

    if (concept === "canal_ap") {
      const meas = (p.observation?.measurement || "").trim();
      const n = Number(meas.replace(/[^\d.]/g, ""));
      if (Number.isFinite(n)) sel.canalApMm = n;
    }
  }

  return sel;
}

function summarizeCervicalLevelLines(patches: AppliedPathologyPatch[], level: string): string[] {
  const rows = patchesForCervicalLevel(patches, level);
  const lines: string[] = [];
  for (const p of rows) {
    const concept = p.observation?.concept ?? p.ownership.conflictGroup ?? "obs";
    const lat = p.observation?.laterality || "";
    const sev = p.observation?.severity || "";
    const snippet = (p.lastRendered.findings ?? "").trim();
    const short = [concept, lat, sev, p.stale ? "STALE" : ""].filter(Boolean).join(" · ");
    if (snippet) {
      lines.push(`${short}: ${snippet.length > 120 ? `${snippet.slice(0, 117)}…` : snippet}`);
    } else {
      lines.push(short);
    }
  }
  return lines;
}

export function deriveCervicalLevelBlockDisplay(
  patches: AppliedPathologyPatch[],
  level: string,
  findingsText: string,
  contradictionHints: string[] = [],
): CervicalLevelBlockDisplay {
  const levelPatches = patchesForCervicalLevel(patches, level);
  const active = levelPatches.filter((p) => !p.stale);
  const stale = levelPatches.filter((p) => p.stale);
  const summaryLines = summarizeCervicalLevelLines(levelPatches, level);
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
  return { kind: "empty", label: "Empty", summaryLines: [], patches: [] };
}

// ─── Apply bundle builder ────────────────────────────────────────────────

export type CervicalAtomicPending = PendingPathologyPatch & { force?: boolean };

function cervicalPatchId(level: string, concept: string, laterality?: string): string {
  const lvl = level.replace(/\s+/g, "");
  const lat = (laterality ?? "").replace(/\s+/g, "") || "na";
  return `r2-cerv-${lvl}-${concept}-${lat}`;
}

/**
 * Build atomic PendingPathologyPatch rows for one cervical level Apply.
 *
 * Each concept becomes a SEPARATE observation (disc_contour, canal_stenosis,
 * foraminal_stenosis, cord_compression, facet_joint, ligamentum_flavum, canal_ap).
 * They share a bundleId so the entire level can be re-applied atomically.
 *
 * All observations use the SAME canonical architecture:
 *   - applyMacroBundle → applyPathologyOverlay → observationSlot
 *   - region | concept | level | laterality slotKey identity
 *   - same-slot replacement, different-level coexistence
 *   - manual protection, measurements, anchors, undo semantics
 *
 * NO cervical traversing-root observation is emitted. For foraminal disease,
 * the "corresponding exiting nerve root" is shown as a read-only hint in the
 * UI (derived from inferCervicalExitingRoot). The radiologist may override.
 */
export function buildCervicalLevelApplyBundle(opts: {
  level: string;
  sel: CervicalLevelSelection;
  region: string;
  bundleId?: string;
}): { bundleId: string; observations: CervicalAtomicPending[] } {
  const level = opts.level;
  const sel = opts.sel;
  const region = opts.region || "Cervical Spine";
  const bundleId = opts.bundleId || `r2-cerv-bundle-${level.replace(/\s+/g, "")}-${Date.now().toString(36)}`;
  const observations: CervicalAtomicPending[] = [];

  const morph = CERVICAL_DISC_MORPHOLOGY_OPTIONS.find((o) => o.id === sel.morphology);
  const canal = CERVICAL_CANAL_OPTIONS.find((o) => o.id === sel.canal);
  const cord = CERVICAL_CORD_OPTIONS.find((o) => o.id === sel.cord);
  const facet = CERVICAL_FACET_OPTIONS.find((o) => o.id === sel.facet);
  const ligament = CERVICAL_LIGAMENT_OPTIONS.find((o) => o.id === sel.ligament);

  // 1. Disc morphology / contour
  if (morph) {
    let findings: string;
    let impression = "";
    if (morph.id === "normal") {
      findings = `At ${level}, disc height and signal are preserved with no herniation.`;
    } else {
      findings = `At ${level}, ${morph.findings} is noted.`;
      impression = `${level}: ${morph.findings}.`;
    }
    observations.push({
      id: cervicalPatchId(level, "disc_contour"),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "disc_contour",
        baselineReplaces: CERVICAL_LEVEL_DISC_BASELINE,
        concept: "disc_contour",
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: "disc_contour",
      label: `${level} disc_contour`,
      findingsText: findings,
      bundleId,
    });
  }

  // 2. Canal / thecal sac
  if (canal && canal.id !== "none") {
    const findings = `At ${level}, there is ${canal.findings}.`;
    const impression = `${level}: ${canal.findings}.`;
    observations.push({
      id: cervicalPatchId(level, "canal_stenosis"),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "canal_stenosis",
        baselineReplaces: CERVICAL_LEVEL_CANAL_BASELINE,
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
  }

  // 3. Foraminal narrowing (left/right/bilateral coexist as separate obs)
  if (sel.foraminal && sel.foraminal !== "none" && sel.foraminalSeverity && sel.foraminalSeverity !== "none") {
    const sides: string[] = sel.foraminal === "bilateral" ? ["left", "right"] : [sel.foraminal];
    for (const side of sides) {
      const findings = `At ${level}, ${sel.foraminalSeverity} ${side} neural foraminal narrowing is noted.`;
      const impression = `${level}: ${sel.foraminalSeverity} ${side} foraminal narrowing.`;
      observations.push({
        id: cervicalPatchId(level, "foraminal_stenosis", side),
        incoming: { findings, impression },
        templates: { findings, impression },
        ownership: {
          anatomicalSection: level,
          conflictGroup: "foraminal_stenosis",
          baselineReplaces: CERVICAL_LEVEL_FORAMINAL_BASELINE,
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
        label: `${level} foraminal_stenosis ${side}`,
        findingsText: findings,
        bundleId,
        supportsLaterality: true,
      });
    }
  }

  // 4. Cord status (compression / T2 signal change)
  if (cord && cord.id !== "normal") {
    const conceptId = cord.id === "t2-change" ? "cord_signal" : "cord_compression";
    const findings = `At ${level}, ${cord.findings}`;
    const impression = `${level}: ${cord.id === "t2-change" ? "cord T2 signal change (myelopathic)" : "cord compression"}.`;
    observations.push({
      id: cervicalPatchId(level, conceptId),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: conceptId,
        baselineReplaces: CERVICAL_LEVEL_CORD_BASELINE,
        concept: conceptId,
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: conceptId,
      label: `${level} ${conceptId}`,
      findingsText: findings,
      bundleId,
    });
  }

  // 5. Facet / uncovertebral
  if (facet && facet.id !== "none") {
    const findings = facet.id === "uncovertebral"
      ? `At ${level}, uncovertebral joint hypertrophy is noted.`
      : `At ${level}, facet arthropathy is noted.`;
    observations.push({
      id: cervicalPatchId(level, "facet_joint"),
      incoming: { findings },
      templates: { findings },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "facet_joint",
        baselineReplaces: CERVICAL_LEVEL_FACET_BASELINE,
        concept: "facet_joint",
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: "facet_joint",
      label: `${level} facet_joint`,
      findingsText: findings,
      bundleId,
    });
  }

  // 6. Ligament (LF hypertrophy / PLL thickening)
  if (ligament && ligament.id !== "none") {
    const conceptId = ligament.id === "lf-hypertrophy" ? "ligamentum_flavum" : "pll_thickening";
    const findings = ligament.id === "lf-hypertrophy"
      ? `At ${level}, ligamentum flavum hypertrophy is noted.`
      : `At ${level}, posterior longitudinal ligament (PLL) thickening is noted.`;
    observations.push({
      id: cervicalPatchId(level, conceptId),
      incoming: { findings },
      templates: { findings },
      ownership: {
        anatomicalSection: level,
        conflictGroup: conceptId,
        concept: conceptId,
        level,
      },
      source: "structured-template",
      region,
      level,
      concept: conceptId,
      label: `${level} ${conceptId}`,
      findingsText: findings,
      bundleId,
    });
  }

  // 7. AP canal measurement (narrative only; numeric value is persisted in canalApProvenance)
  if (sel.canalApMm != null && Number.isFinite(sel.canalApMm)) {
    const findings = `At ${level}, AP canal diameter measures ${sel.canalApMm} mm.`;
    observations.push({
      id: cervicalPatchId(level, "canal_ap"),
      incoming: { findings },
      templates: { findings },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "canal_ap",
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

  return { bundleId, observations };
}

/**
 * Get the "corresponding exiting nerve root" hint for a cervical level.
 *
 * This is a UI hint ONLY — not emitted as an observation. The radiologist
 * may override. Used to display e.g. "Corresponding exiting nerve root: C6"
 * next to the foraminal narrowing selector.
 *
 * Returns null for non-cervical levels.
 */
export function cervicalExitingRootHint(level: string): string | null {
  if (!/^C\d+[-–—]?C?\d+/i.test(level) && !/C7[-–—]T1/i.test(level)) return null;
  return inferCervicalExitingRoot(level);
}

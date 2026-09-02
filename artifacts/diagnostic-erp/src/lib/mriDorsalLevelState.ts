/**
 * mriDorsalLevelState.ts — pure R2 dorsal/thoracic level derivation + bundle builder.
 *
 * Mirrors the cervical/lumbar architecture but uses dorsal-specific clinical
 * semantics:
 *   - Dorsal levels T1-T2 through T12-L1
 *   - Cord compression / signal change (thoracic cord is clinically significant)
 *   - Infection/spondylodiscitis structured observations (NOT a one-click "TB" diagnosis)
 *   - Vertebral collapse / fracture
 *
 * Anatomical levels are NOT Study Tabs.
 *
 * Reuses the SAME canonical reporting architecture as cervical/lumbar.
 */

import type { AppliedPathologyPatch, PendingPathologyPatch } from "@/lib/zai-workspace/store";
import { normalizeLevel } from "@/lib/observationSlot";

// ─── Dorsal clinical concepts ────────────────────────────────────────────

export const DORSAL_DISC_MORPHOLOGY_OPTIONS = [
  { id: "normal", label: "Normal", findings: "Normal disc height and signal with no herniation." },
  { id: "desiccation", label: "Desiccation", findings: "disc desiccation with loss of T2 signal" },
  { id: "bulge", label: "Bulge", findings: "disc bulge" },
  { id: "protrusion", label: "Protrusion", findings: "disc protrusion" },
  { id: "extrusion", label: "Extrusion", findings: "disc extrusion" },
] as const;

export const DORSAL_CANAL_OPTIONS = [
  { id: "none", label: "None", findings: "No canal stenosis.", severity: "" },
  { id: "indentation", label: "Indentation", findings: "anterior thecal sac indentation", severity: "mild" },
  { id: "compression", label: "Compression", findings: "anterior thecal sac compression", severity: "moderate" },
  { id: "stenosis-mild", label: "Stenosis (mild)", findings: "mild canal stenosis", severity: "mild" },
  { id: "stenosis-moderate", label: "Stenosis (moderate)", findings: "moderate canal stenosis", severity: "moderate" },
  { id: "stenosis-severe", label: "Stenosis (severe)", findings: "severe canal stenosis", severity: "severe" },
] as const;

export const DORSAL_FORAMINAL_OPTIONS = [
  { id: "none", label: "None" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "bilateral", label: "Bilateral" },
] as const;

export const DORSAL_FORAMINAL_SEVERITY = [
  { id: "none", label: "None" },
  { id: "mild", label: "Mild" },
  { id: "moderate", label: "Moderate" },
  { id: "severe", label: "Severe" },
] as const;

export const DORSAL_CORD_OPTIONS = [
  { id: "normal", label: "Normal", findings: "Thoracic cord shows normal signal with no compression." },
  { id: "compression", label: "Compression", findings: "Thoracic cord compression is noted at this level." },
  { id: "t2-change", label: "T2 ↑", findings: "T2 hyperintense signal in the cord at this level." },
] as const;

/**
 * Dorsal vertebral body / fracture options.
 *
 * Includes infection/spondylodiscitis structured observations — NOT a
 * one-click "TB" diagnosis. Each infection-related finding is a separate
 * observation so the radiologist controls the diagnostic synthesis.
 */
export const DORSAL_VERTEBRAL_OPTIONS = [
  { id: "none", label: "None" },
  { id: "marrow-edema", label: "Marrow edema", findings: "vertebral marrow edema" },
  { id: "endplate-erosion", label: "Endplate erosion", findings: "endplate erosion/destruction" },
  { id: "fracture", label: "Compression fracture", findings: "wedge compression fracture" },
  { id: "collapse", label: "Vertebral collapse", findings: "vertebral body collapse" },
] as const;

/**
 * Dorsal infection / collection options.
 *
 * These are STRUCTURED OBSERVATIONS — the radiologist assembles them into
 * a diagnosis. There is NO "TB" one-click button.
 */
export const DORSAL_INFECTION_OPTIONS = [
  { id: "none", label: "None" },
  { id: "disc-involvement", label: "Disc involvement", findings: "disc signal abnormality with infective morphology" },
  { id: "paravertebral-collection", label: "Paravertebral collection", findings: "paravertebral soft tissue collection" },
  { id: "epidural-component", label: "Epidural component", findings: "epidural collection/component" },
] as const;

// ─── Dorsal selection type ───────────────────────────────────────────────

export type DorsalLevelSelection = {
  morphology?: (typeof DORSAL_DISC_MORPHOLOGY_OPTIONS)[number]["id"];
  canal?: (typeof DORSAL_CANAL_OPTIONS)[number]["id"];
  foraminal?: (typeof DORSAL_FORAMINAL_OPTIONS)[number]["id"];
  foraminalSeverity?: (typeof DORSAL_FORAMINAL_SEVERITY)[number]["id"];
  cord?: (typeof DORSAL_CORD_OPTIONS)[number]["id"];
  vertebral?: (typeof DORSAL_VERTEBRAL_OPTIONS)[number]["id"];
  infection?: (typeof DORSAL_INFECTION_OPTIONS)[number]["id"];
};

// ─── Baselines ────────────────────────────────────────────────────────────

export const DORSAL_LEVEL_DISC_BASELINE =
  "Normal disc height and signal. No disc herniation.";
export const DORSAL_LEVEL_CANAL_BASELINE = "No canal stenosis.";
export const DORSAL_LEVEL_CORD_BASELINE = "Thoracic cord is normal in signal with no compression.";
export const DORSAL_LEVEL_FORAMINAL_BASELINE = "Neural foramina are patent.";
export const DORSAL_LEVEL_VERTEBRAL_BASELINE = "Vertebral body height and marrow signal are preserved.";

// ─── Apply-content check ────────────────────────────────────────────────

export function dorsalLevelApplyHasContent(sel: DorsalLevelSelection): boolean {
  return !!(
    sel.morphology
    || sel.canal
    || sel.foraminal
    || sel.cord
    || sel.vertebral
    || sel.infection
  );
}

// ─── Display derivation ──────────────────────────────────────────────────

export type DorsalLevelBlockDisplayKind =
  | "structured"
  | "template-narrative"
  | "empty"
  | "stale"
  | "conflict";

export type DorsalLevelBlockDisplay = {
  kind: DorsalLevelBlockDisplayKind;
  label: string;
  summaryLines: string[];
  patches: AppliedPathologyPatch[];
};

function levelKey(raw: string): string {
  return normalizeLevel(raw) || raw.trim().toUpperCase();
}

export function patchesForDorsalLevel(
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

export function deriveDorsalLevelSelection(
  patches: AppliedPathologyPatch[],
  level: string,
): DorsalLevelSelection {
  const rows = patchesForDorsalLevel(patches, level).filter((p) => !p.stale);
  const sel: DorsalLevelSelection = {};

  for (const p of rows) {
    const concept = (p.observation?.concept ?? p.ownership.concept ?? p.ownership.conflictGroup ?? "").toLowerCase();
    const findings = (p.lastRendered.findings ?? p.templates.findings ?? "").toLowerCase();
    const lat = (p.observation?.laterality || p.ownership.laterality || "").toLowerCase();
    const sev = (p.observation?.severity || "").toLowerCase();

    if (concept === "disc_contour") {
      if (/extrusion/.test(findings)) sel.morphology = "extrusion";
      else if (/protrusion/.test(findings)) sel.morphology = "protrusion";
      else if (/bulge/.test(findings)) sel.morphology = "bulge";
      else if (/no herniation|normal disc/.test(findings)) sel.morphology = "normal";
    }

    if (concept === "disc_signal" || /desiccat/.test(findings)) {
      sel.morphology = sel.morphology ?? "desiccation";
    }

    if (concept === "canal_stenosis") {
      if (/severe/.test(sev) || /severe canal/.test(findings)) sel.canal = "stenosis-severe";
      else if (/moderate/.test(sev) || /moderate canal/.test(findings)) sel.canal = "stenosis-moderate";
      else if (/mild/.test(sev) || /mild canal/.test(findings)) sel.canal = "stenosis-mild";
      else if (/compression/.test(findings)) sel.canal = "compression";
      else if (/indentation/.test(findings)) sel.canal = "indentation";
    }

    if (concept === "foraminal_stenosis" || /foraminal/.test(findings)) {
      if (/bilateral/.test(findings) || lat.includes("bilateral")) sel.foraminal = "bilateral";
      else if (/left/.test(findings) || lat.includes("left")) sel.foraminal = "left";
      else if (/right/.test(findings) || lat.includes("right")) sel.foraminal = "right";
      if (/severe/.test(findings)) sel.foraminalSeverity = "severe";
      else if (/moderate/.test(findings)) sel.foraminalSeverity = "moderate";
      else if (/mild/.test(findings)) sel.foraminalSeverity = "mild";
    }

    if (concept === "cord_compression" || concept === "cord_signal" || /cord/.test(findings)) {
      if (/t2.*hyperintense|myelopath/.test(findings)) sel.cord = "t2-change";
      else if (/compress/.test(findings)) sel.cord = "compression";
    }

    if (concept === "compression_fracture" || /fracture/.test(findings)) {
      sel.vertebral = "fracture";
    }
    if (/collapse/.test(findings)) {
      sel.vertebral = "collapse";
    }
    if (concept === "endplate" || /endplate erosion|marrow edema/.test(findings)) {
      if (/erosion/.test(findings)) sel.vertebral = "endplate-erosion";
      else if (/edema/.test(findings)) sel.vertebral = "marrow-edema";
    }

    if (concept === "spondylodiscitis" || /spondylodiscitis|disc involvement|paravertebral/.test(findings)) {
      if (/paravertebral/.test(findings)) sel.infection = "paravertebral-collection";
      else if (/epidural/.test(findings)) sel.infection = "epidural-component";
      else if (/disc/.test(findings)) sel.infection = "disc-involvement";
    }
  }

  return sel;
}

function summarizeDorsalLevelLines(patches: AppliedPathologyPatch[], level: string): string[] {
  const rows = patchesForDorsalLevel(patches, level);
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

export function deriveDorsalLevelBlockDisplay(
  patches: AppliedPathologyPatch[],
  level: string,
  findingsText: string,
  contradictionHints: string[] = [],
): DorsalLevelBlockDisplay {
  const levelPatches = patchesForDorsalLevel(patches, level);
  const active = levelPatches.filter((p) => !p.stale);
  const stale = levelPatches.filter((p) => p.stale);
  const summaryLines = summarizeDorsalLevelLines(levelPatches, level);
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

export type DorsalAtomicPending = PendingPathologyPatch & { force?: boolean };

function dorsalPatchId(level: string, concept: string, laterality?: string): string {
  const lvl = level.replace(/\s+/g, "");
  const lat = (laterality ?? "").replace(/\s+/g, "") || "na";
  return `r2-dors-${lvl}-${concept}-${lat}`;
}

/**
 * Build atomic PendingPathologyPatch rows for one dorsal level Apply.
 *
 * Each concept becomes a SEPARATE observation. They share a bundleId.
 *
 * Infection/spondylodiscitis findings are emitted as STRUCTURED OBSERVATIONS
 * (marrow edema, endplate erosion, disc involvement, paravertebral collection,
 * epidural component). There is NO one-click "TB" diagnosis — the radiologist
 * assembles these observations into a diagnostic conclusion.
 */
export function buildDorsalLevelApplyBundle(opts: {
  level: string;
  sel: DorsalLevelSelection;
  region: string;
  bundleId?: string;
}): { bundleId: string; observations: DorsalAtomicPending[] } {
  const level = opts.level;
  const sel = opts.sel;
  const region = opts.region || "Dorsal Spine";
  const bundleId = opts.bundleId || `r2-dors-bundle-${level.replace(/\s+/g, "")}-${Date.now().toString(36)}`;
  const observations: DorsalAtomicPending[] = [];

  const morph = DORSAL_DISC_MORPHOLOGY_OPTIONS.find((o) => o.id === sel.morphology);
  const canal = DORSAL_CANAL_OPTIONS.find((o) => o.id === sel.canal);
  const cord = DORSAL_CORD_OPTIONS.find((o) => o.id === sel.cord);
  const vertebral = DORSAL_VERTEBRAL_OPTIONS.find((o) => o.id === sel.vertebral);
  const infection = DORSAL_INFECTION_OPTIONS.find((o) => o.id === sel.infection);

  // 1. Disc morphology / contour
  //
  // CLINICAL CONCEPT MAPPING (same as cervical):
  //   - desiccation → disc_signal (NOT disc_contour — distinct ownership slot)
  //   - normal/bulge/protrusion/extrusion → disc_contour
  if (morph) {
    if (morph.id === "desiccation") {
      const findings = `At ${level}, ${morph.findings}.`;
      const impression = `${level}: ${morph.findings}.`;
      observations.push({
        id: dorsalPatchId(level, "disc_signal"),
        incoming: { findings, impression },
        templates: { findings, impression },
        ownership: {
          anatomicalSection: level,
          conflictGroup: "disc_signal",
          baselineReplaces: DORSAL_LEVEL_DISC_BASELINE,
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
    } else {
      let findings: string;
      let impression = "";
      if (morph.id === "normal") {
        findings = `At ${level}, disc height and signal are preserved with no herniation.`;
      } else {
        findings = `At ${level}, ${morph.findings} is noted.`;
        impression = `${level}: ${morph.findings}.`;
      }
      observations.push({
        id: dorsalPatchId(level, "disc_contour"),
        incoming: { findings, impression },
        templates: { findings, impression },
        ownership: {
          anatomicalSection: level,
          conflictGroup: "disc_contour",
          baselineReplaces: DORSAL_LEVEL_DISC_BASELINE,
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
  }

  // 2. Canal / thecal sac
  if (canal && canal.id !== "none") {
    const findings = `At ${level}, there is ${canal.findings}.`;
    const impression = `${level}: ${canal.findings}.`;
    observations.push({
      id: dorsalPatchId(level, "canal_stenosis"),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: "canal_stenosis",
        baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE,
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

  // 3. Foraminal narrowing
  if (sel.foraminal && sel.foraminal !== "none" && sel.foraminalSeverity && sel.foraminalSeverity !== "none") {
    const sides: string[] = sel.foraminal === "bilateral" ? ["left", "right"] : [sel.foraminal];
    for (const side of sides) {
      const findings = `At ${level}, ${sel.foraminalSeverity} ${side} neural foraminal narrowing is noted.`;
      const impression = `${level}: ${sel.foraminalSeverity} ${side} foraminal narrowing.`;
      observations.push({
        id: dorsalPatchId(level, "foraminal_stenosis", side),
        incoming: { findings, impression },
        templates: { findings, impression },
        ownership: {
          anatomicalSection: level,
          conflictGroup: "foraminal_stenosis",
          baselineReplaces: DORSAL_LEVEL_FORAMINAL_BASELINE,
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

  // 4. Cord status
  if (cord && cord.id !== "normal") {
    const conceptId = cord.id === "t2-change" ? "cord_signal" : "cord_compression";
    const findings = `At ${level}, ${cord.findings}`;
    const impression = `${level}: ${cord.id === "t2-change" ? "cord T2 signal change" : "cord compression"}.`;
    observations.push({
      id: dorsalPatchId(level, conceptId),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: conceptId,
        baselineReplaces: DORSAL_LEVEL_CORD_BASELINE,
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

  // 5. Vertebral body / fracture / collapse / endplate erosion
  if (vertebral && vertebral.id !== "none") {
    const conceptId = vertebral.id === "fracture"
      ? "compression_fracture"
      : vertebral.id === "collapse"
        ? "vertebral_collapse"
        : vertebral.id === "endplate-erosion"
          ? "endplate_erosion"
          : "marrow_edema";
    const findings = `At ${level}, ${vertebral.findings} is noted.`;
    const impression = `${level}: ${vertebral.findings}.`;
    observations.push({
      id: dorsalPatchId(level, conceptId),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: level,
        conflictGroup: conceptId,
        baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE,
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

  // 6. Infection / spondylodiscitis structured observations
  if (infection && infection.id !== "none") {
    const conceptId = infection.id === "disc-involvement"
      ? "spondylodiscitis"
      : infection.id === "paravertebral-collection"
        ? "paravertebral_collection"
        : "epidural_collection";
    const findings = `At ${level}, ${infection.findings} is noted.`;
    observations.push({
      id: dorsalPatchId(level, conceptId),
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

  return { bundleId, observations };
}

/**
 * Brain / Stroke Measures Engine — pure client-side math + ledger atoms.
 *
 * Mirrors mriSpineGrading.ts: deterministic grammar only, no AI, no store
 * shape change. Atoms flow through applyMacroBundle / applyPathologyOverlay.
 *
 * Measures:
 *   ABC/2 ICH volume (cc)
 *   Midline shift (mm + side)
 *   ASPECTS (10 − affected MCA regions)
 *   Aneurysm (dome / neck / aspect ratio)
 */

import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";

// ─── ASPECTS regions (MCA territory) ─────────────────────────────────────

export const ASPECTS_REGIONS = [
  { id: "M1" as const, label: "M1" },
  { id: "M2" as const, label: "M2" },
  { id: "M3" as const, label: "M3" },
  { id: "M4" as const, label: "M4" },
  { id: "M5" as const, label: "M5" },
  { id: "M6" as const, label: "M6" },
  { id: "I" as const, label: "I (insula)" },
  { id: "L" as const, label: "L (lentiform)" },
  { id: "C" as const, label: "C (caudate)" },
  { id: "IC" as const, label: "IC (internal capsule)" },
] as const;

export type AspectsRegionId = (typeof ASPECTS_REGIONS)[number]["id"];

export const MIDLINE_SIDES = [
  { id: "right" as const, label: "Right" },
  { id: "left" as const, label: "Left" },
] as const;

export type MidlineSide = (typeof MIDLINE_SIDES)[number]["id"];

export type BrainMeasureSeverity = "critical" | "urgent" | "significant" | "";

// ─── Math ────────────────────────────────────────────────────────────────

/** ABC/2 ellipsoid volume in cubic centimetres. Inputs in cm. */
export function abc2Volume(aCm: number, bCm: number, cCm: number): number {
  const a = Number(aCm);
  const b = Number(bCm);
  const c = Number(cCm);
  if (![a, b, c].every((n) => Number.isFinite(n) && n >= 0)) return NaN;
  // Round to 1 decimal for clinical reporting (30.0 stays 30).
  const raw = (a * b * c) / 2;
  return Math.round(raw * 10) / 10;
}

/** ASPECTS = 10 − number of affected MCA regions (unique). */
export function aspectsScore(affectedRegions: readonly AspectsRegionId[]): number {
  const uniq = new Set(affectedRegions);
  const count = [...uniq].filter((id) =>
    ASPECTS_REGIONS.some((r) => r.id === id),
  ).length;
  return Math.max(0, Math.min(10, 10 - count));
}

export function aneurysmAspectRatio(domeMm: number, neckMm: number): number | null {
  const d = Number(domeMm);
  const n = Number(neckMm);
  if (!Number.isFinite(d) || !Number.isFinite(n) || n <= 0) return null;
  return Math.round((d / n) * 100) / 100;
}

// ─── Severity thresholds ─────────────────────────────────────────────────

export function severityForAbc2(volumeCc: number): BrainMeasureSeverity {
  if (!Number.isFinite(volumeCc)) return "";
  if (volumeCc >= 30) return "critical";
  if (volumeCc > 0) return "significant";
  return "";
}

export function severityForMidline(mm: number): BrainMeasureSeverity {
  if (!Number.isFinite(mm) || mm <= 0) return "";
  if (mm >= 5) return "critical";
  return "significant";
}

export function severityForAspects(score: number): BrainMeasureSeverity {
  if (!Number.isFinite(score)) return "";
  if (score <= 7) return "urgent";
  if (score < 10) return "significant";
  return "";
}

export function severityForAneurysm(domeMm: number): BrainMeasureSeverity {
  if (!Number.isFinite(domeMm) || domeMm <= 0) return "";
  if (domeMm >= 7) return "urgent";
  return "significant";
}

// ─── Sentence composers (deterministic neurosurgical wording) ────────────

export function composeIchSentence(opts: {
  location: string;
  a: number;
  b: number;
  c: number;
  volume: number;
}): string {
  const loc = (opts.location || "").trim() || "brain parenchyma";
  const vol = Number.isFinite(opts.volume) ? opts.volume : abc2Volume(opts.a, opts.b, opts.c);
  const volLabel = Number.isInteger(vol) ? String(vol) : vol.toFixed(1);
  return (
    `Intracerebral haemorrhage in the ${loc} measuring `
    + `${opts.a} × ${opts.b} × ${opts.c} cm, `
    + `estimated ABC/2 volume ${volLabel} cc.`
  );
}

export function composeMidlineSentence(opts: { mm: number; side: MidlineSide | string }): string {
  const side = String(opts.side || "").trim().toLowerCase() || "right";
  const mm = Number(opts.mm);
  const mmLabel = Number.isInteger(mm) ? String(mm) : String(mm);
  return `Midline shift of ${mmLabel} mm to the ${side}.`;
}

export function composeAspectsSentence(opts: {
  score: number;
  affectedRegions: readonly AspectsRegionId[];
}): string {
  const regions = opts.affectedRegions.length
    ? opts.affectedRegions.join(", ")
    : "none";
  if (opts.score >= 10) {
    return `ASPECTS ${opts.score}/10 — no early ischemic change in the MCA territory.`;
  }
  // Include "acute infarct" so existing detectCriticalFindings / finalizeSafety
  // pick up ASPECTS ≤ 7 without a new alert module.
  return (
    `ASPECTS ${opts.score}/10 with early ischemic change involving ${regions} `
    + `(consistent with acute infarct in the MCA territory).`
  );
}

export function composeAneurysmSentence(opts: {
  location: string;
  domeMm: number;
  neckMm: number;
}): { findings: string; aspectRatio: number | null } {
  const loc = (opts.location || "").trim() || "intracranial artery";
  const ratio = aneurysmAspectRatio(opts.domeMm, opts.neckMm);
  const ratioPhrase = ratio != null ? ` (dome/neck aspect ratio ${ratio})` : "";
  const findings =
    `Saccular cerebral aneurysm at the ${loc} measuring `
    + `${opts.domeMm} mm dome × ${opts.neckMm} mm neck${ratioPhrase}.`;
  return { findings, aspectRatio: ratio };
}

// ─── Ledger atoms ────────────────────────────────────────────────────────

export type BrainMeasureAtom = PendingPathologyPatch & {
  force?: boolean;
};

function atomId(concept: string): string {
  return `r2-brain-${concept}`;
}

/**
 * Build PendingPathologyPatch rows for selected brain measures.
 * Each concept is a separate same-slot observation (region | concept | * | *).
 */
export function buildBrainMeasureAtoms(opts: {
  region?: string;
  bundleId?: string;
  ich?: { location: string; a: number; b: number; c: number } | null;
  midline?: { mm: number; side: MidlineSide | string } | null;
  aspects?: { affectedRegions: readonly AspectsRegionId[] } | null;
  aneurysm?: { location: string; domeMm: number; neckMm: number } | null;
}): { bundleId: string; observations: BrainMeasureAtom[] } {
  const region = opts.region || "Brain";
  const bundleId = opts.bundleId || `r2-brain-measures-${Date.now().toString(36)}`;
  const observations: BrainMeasureAtom[] = [];

  if (opts.ich) {
    const volume = abc2Volume(opts.ich.a, opts.ich.b, opts.ich.c);
    if (Number.isFinite(volume) && opts.ich.a > 0 && opts.ich.b > 0 && opts.ich.c > 0) {
      const findings = composeIchSentence({ ...opts.ich, volume });
      const severity = severityForAbc2(volume);
      const impression =
        `ICH ${opts.ich.location || "parenchyma"} — ABC/2 ${volume} cc`
        + (severity === "critical" ? " (critical volume)." : ".");
      observations.push({
        id: atomId("ich_abc2"),
        incoming: { findings, impression },
        templates: { findings, impression },
        ownership: {
          anatomicalSection: "brain",
          conflictGroup: "ich_abc2",
          concept: "ich_abc2",
          baselineReplaces: "",
        },
        source: "structured-template",
        region,
        concept: "ich_abc2",
        severity,
        measurement: String(volume),
        label: "ICH ABC/2 volume",
        findingsText: findings,
        bundleId,
      });
    }
  }

  if (opts.midline && Number(opts.midline.mm) > 0) {
    const findings = composeMidlineSentence(opts.midline);
    const severity = severityForMidline(Number(opts.midline.mm));
    const impression = `Midline shift ${opts.midline.mm} mm ${opts.midline.side}.`;
    observations.push({
      id: atomId("midline_shift"),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: "brain",
        conflictGroup: "midline",
        concept: "midline_shift",
        baselineReplaces: "No midline shift.",
      },
      source: "structured-template",
      region,
      concept: "midline_shift",
      severity,
      laterality: String(opts.midline.side),
      measurement: String(opts.midline.mm),
      label: "Midline shift",
      findingsText: findings,
      bundleId,
    });
  }

  if (opts.aspects && opts.aspects.affectedRegions.length > 0) {
    const score = aspectsScore(opts.aspects.affectedRegions);
    const findings = composeAspectsSentence({
      score,
      affectedRegions: opts.aspects.affectedRegions,
    });
    const severity = severityForAspects(score);
    const impression = `ASPECTS ${score}/10.`;
    observations.push({
      id: atomId("aspects"),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: "brain",
        conflictGroup: "aspects",
        concept: "aspects",
        baselineReplaces: "",
      },
      source: "structured-template",
      region,
      concept: "aspects",
      severity,
      measurement: String(score),
      state: opts.aspects.affectedRegions.join(","),
      label: "ASPECTS",
      findingsText: findings,
      bundleId,
    });
  }

  if (
    opts.aneurysm
    && Number(opts.aneurysm.domeMm) > 0
    && Number(opts.aneurysm.neckMm) > 0
  ) {
    const { findings, aspectRatio } = composeAneurysmSentence(opts.aneurysm);
    const severity = severityForAneurysm(Number(opts.aneurysm.domeMm));
    const impression =
      `Cerebral aneurysm ${opts.aneurysm.location || ""} `
      + `${opts.aneurysm.domeMm}×${opts.aneurysm.neckMm} mm`
      + (aspectRatio != null ? ` (AR ${aspectRatio})` : "")
      + ".";
    observations.push({
      id: atomId("aneurysm"),
      incoming: { findings, impression },
      templates: { findings, impression },
      ownership: {
        anatomicalSection: "brain",
        conflictGroup: "aneurysm",
        concept: "aneurysm",
        baselineReplaces: "",
      },
      source: "structured-template",
      region,
      concept: "aneurysm",
      severity,
      measurement: String(opts.aneurysm.domeMm),
      state: aspectRatio != null ? String(aspectRatio) : undefined,
      label: "Cerebral aneurysm",
      findingsText: findings,
      bundleId,
    });
  }

  return { bundleId, observations };
}

/** True when at least one measure would emit an observation. */
export function brainMeasuresHasContent(opts: Parameters<typeof buildBrainMeasureAtoms>[0]): boolean {
  return buildBrainMeasureAtoms(opts).observations.length > 0;
}

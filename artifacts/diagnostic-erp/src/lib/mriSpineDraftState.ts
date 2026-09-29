/**
 * mriSpineDraftState.ts — draft persistence for the spine V3 structured state.
 *
 * Numbering mode, sequence availability and the three screening regions are
 * structured capture state, so they must survive save → close → reopen exactly
 * like `canalApProvenance` does. The prose they generate is already persisted
 * inside the observation ledger; this module stores only the inputs so the
 * canvas can rebuild that prose instead of trusting stale text.
 *
 * Defensive by design: this reads a JSON blob that may have been written by an
 * older build, so unknown values fall back to defaults rather than throwing.
 */

import {
  defaultLumbarNumbering,
  type CastellviGrade,
  type LumbarNumberingMode,
  type LumbarNumberingState,
  type LstvSide,
} from "./mriSpineNumbering";
import {
  SPINE_SEQUENCE_KEYS,
  defaultSpineSequences,
  type SpineSequencesAvailable,
} from "./mriSpineSequences";
import {
  defaultScreeningRegionState,
  defaultScreeningState,
  type ScreeningRegionState,
  type ScreeningSelectionValue,
  type ScreeningState,
} from "./mriSpineScreening";
import {
  SPINE_SCREENING_REGIONS,
  type RegionRole,
  type SpineScreeningRegion,
} from "./mriSpineScreeningSchema";

export const SPINE_REPORTING_DRAFT_KEY = "spineReporting";

export type SpineReportingDraftState = {
  lumbarNumbering: LumbarNumberingState;
  sequencesAvailable: SpineSequencesAvailable;
  screening: ScreeningState;
  impressionOrderFrozen: boolean;
};

const NUMBERING_MODES: LumbarNumberingMode[] = [
  "standard",
  "lstv-sacralization",
  "lstv-lumbarization",
  "localizer-based",
  "manual",
];
const CASTELLVI_GRADES: CastellviGrade[] = ["I", "IIa", "IIb", "IIIa", "IIIb", "IV"];
const LSTV_SIDES: LstvSide[] = ["unilateral", "bilateral"];
const REGION_ROLES: RegionRole[] = [
  "primary-dedicated",
  "primary-screening",
  "accompanying-screening",
  "absent",
];

function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

function oneOf<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  const s = str(v);
  return s && (allowed as string[]).includes(s) ? (s as T) : fallback;
}

function parseNumbering(raw: unknown): LumbarNumberingState {
  if (!raw || typeof raw !== "object") return defaultLumbarNumbering();
  const o = raw as Record<string, unknown>;
  return {
    mode: oneOf(o.mode, NUMBERING_MODES, "standard"),
    castellvi: o.castellvi == null ? null : oneOf(o.castellvi, CASTELLVI_GRADES, "I"),
    side: o.side == null ? null : oneOf(o.side, LSTV_SIDES, "unilateral"),
    pseudoarthrosis: bool(o.pseudoarthrosis),
    reactiveMarrowChange: bool(o.reactiveMarrowChange),
    wholeSpineLocalizer: bool(o.wholeSpineLocalizer),
    designatedL5Label: str(o.designatedL5Label) ?? null,
  };
}

function parseSequences(raw: unknown): SpineSequencesAvailable {
  const out = defaultSpineSequences();
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  for (const key of SPINE_SEQUENCE_KEYS) {
    if (typeof o[key] === "boolean") out[key] = o[key];
  }
  return out;
}

function parseSelections(raw: unknown): ScreeningRegionState["selections"] {
  const selections: ScreeningRegionState["selections"] = {};
  if (!raw || typeof raw !== "object") return selections;
  for (const [sectionKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const list: ScreeningSelectionValue[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const optionId = str((item as Record<string, unknown>).optionId);
      if (!optionId) continue;
      const o = item as Record<string, unknown>;
      const mm = typeof o.mm === "number" && Number.isFinite(o.mm) ? o.mm : undefined;
      const side = o.side === "left" || o.side === "right" || o.side === "bilateral" ? o.side : undefined;
      list.push({ optionId, level: str(o.level), side, mm });
    }
    if (list.length > 0) selections[sectionKey] = list;
  }
  return selections;
}

function parseRegion(raw: unknown): ScreeningRegionState {
  if (!raw || typeof raw !== "object") return defaultScreeningRegionState();
  const o = raw as Record<string, unknown>;
  const role = oneOf(o.role, REGION_ROLES, "absent");
  const significance: Record<string, boolean> = {};
  if (o.significance && typeof o.significance === "object") {
    for (const [k, v] of Object.entries(o.significance as Record<string, unknown>)) {
      if (typeof v === "boolean") significance[k] = v;
    }
  }
  return {
    role,
    performed: bool(o.performed, role !== "absent"),
    selections: parseSelections(o.selections),
    significance,
    recommendationSelected: bool(o.recommendationSelected),
  };
}

function parseScreening(raw: unknown): ScreeningState {
  const out = defaultScreeningState();
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  for (const region of SPINE_SCREENING_REGIONS) {
    if (o[region] && typeof o[region] === "object") out[region] = parseRegion(o[region]);
  }
  return out;
}

export function extractSpineReportingState(structuredJson: unknown): SpineReportingDraftState | null {
  const blob = structuredJson as Record<string, unknown> | null | undefined;
  const raw = blob?.[SPINE_REPORTING_DRAFT_KEY];
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    lumbarNumbering: parseNumbering(o.lumbarNumbering),
    sequencesAvailable: parseSequences(o.sequencesAvailable),
    screening: parseScreening(o.screening),
    impressionOrderFrozen: bool(o.impressionOrderFrozen),
  };
}

export function spineReportingDraftPayload(state: SpineReportingDraftState): SpineReportingDraftState {
  // Written back verbatim; the payload is already minimal and bounded.
  return {
    lumbarNumbering: state.lumbarNumbering,
    sequencesAvailable: state.sequencesAvailable,
    screening: state.screening,
    impressionOrderFrozen: state.impressionOrderFrozen,
  };
}

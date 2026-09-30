/**
 * mriDorsoLumbarLevelEntry.ts — one level-entry point for a Dorso-Lumbar
 * examination, dispatching to the existing regional builders (spec §5, §6, §12).
 *
 * The Dorso-Lumbar canvas must not grow its own copy of level-detail compiling.
 * Thoracic anatomy is compiled by the dorsal builder and lumbar anatomy by the
 * lumbar builder; what a Dorso-Lumbar study adds is the *decision* about which
 * one owns a given level, and the bridge that neither half owns outright. This
 * module makes that decision once, from the coverage resolver, so:
 *
 *   - a level outside the acquired field of view cannot be populated at all;
 *   - thoracic vocabulary (cord, costovertebral) and lumbar vocabulary (root,
 *     facet, pars) cannot be applied to each other's level;
 *   - the bridge is entered through one region — the canonical junction owner —
 *     so a junction finding written from the thoracic side and one written from
 *     the lumbar side land in the same ledger slot;
 *   - the bundle ids stay the ones the dorsal and lumbar level rows already use,
 *     so re-applying a level replaces it instead of stacking a second copy under
 *     a new Dorso-Lumbar id.
 *
 * The anatomy at each level comes from the coverage resolver, not from the panel
 * that asked: `dorsolumbarNeuralStructure` decides whether the report may say
 * cord, conus or cauda.
 *
 * Pure functions only — no store, no React.
 */

import {
  canonicalDorsoLumbarLevel,
  dorsolumbarConusCovered,
  dorsolumbarLevelDomain,
  dorsolumbarLevelKeys,
  dorsolumbarNeuralStructure,
  isDorsoLumbarLevelAcquired,
  type DorsoLumbarDomain,
  type DorsoLumbarNeuralStructure,
  type DorsoLumbarState,
} from "./mriDorsoLumbarCoverage";
import { buildDorsalLevelBundle } from "./mriDorsalSubMasters";
import {
  dorsalLevelDetailHasContent,
  type DorsalLevelDetail,
} from "./mriDorsalLevelDetail";
import {
  buildLumbarLevelDetailBundle,
  lumbarLevelDetailHasContent,
  type LumbarLevelDetail,
} from "./mriLumbarLevelDetail";
import type { LumbarLevelSelection } from "./mriLumbarRegions";
import type { DorsalNumberingState } from "./mriDorsalNumbering";
import { spineAtomsToPatches } from "./mriSpineAtoms";
import type { SpineSequencesAvailable } from "./mriSpineSequences";
import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";

export type DorsoLumbarDetailKind = "dorsal" | "lumbar";

export type DorsoLumbarLevelEntryRequest = {
  /** Any spelling: "T12-L1", "D12-L1", "L1-T12" all resolve to the bridge. */
  level: string;
  state: DorsoLumbarState;
  sequences: SpineSequencesAvailable;
  dorsal?: DorsalLevelDetail;
  lumbar?: LumbarLevelDetail;
  lumbarSelection?: LumbarLevelSelection;
};

export type DorsoLumbarLevelEntry = {
  /** Canonical printed key, or the input when the level was not recognised. */
  level: string;
  domain: DorsoLumbarDomain | null;
  /** The ledger region the atoms are stamped with. */
  ledgerRegion: string;
  /** Which vocabulary the canvas should be showing for this level. */
  detailKind: DorsoLumbarDetailKind;
  neural: DorsoLumbarNeuralStructure;
  bundleId: string;
  observations: PendingPathologyPatch[];
  structuredChoiceCount: number;
  /** True when nothing was written and the caller must say why. */
  refused: boolean;
  notice: string | null;
};

/**
 * The dorsal half of the coverage state, in the shape the dorsal resolver
 * expects. Coverage is derived from the acquired sequence rather than assumed: a
 * Dorso-Lumbar study that stops above the junction must not gain conus sentences
 * from being labelled Dorso-Lumbar.
 */
export function dorsoLumbarDorsalNumbering(state: DorsoLumbarState): DorsalNumberingState {
  const reachesJunction = dorsolumbarLevelKeys(state).some((entry) => entry.junction === true);
  return {
    mode: dorsalModeFrom(state),
    coverage: reachesJunction ? "thoracolumbar" : "complete",
    wholeSpineLocalizer: state.wholeSpineLocalizer,
    designationNote: state.designationNote ?? null,
  };
}

/**
 * The five shared numbering bases pass straight through. "standard-morphology"
 * is Dorso-Lumbar-only wording (numbering assumes no transitional segment) and
 * has no dorsal equivalent, so it is carried as a manual designation with its own
 * note rather than reported as localizer-confirmed.
 */
function dorsalModeFrom(state: DorsoLumbarState): DorsalNumberingState["mode"] {
  switch (state.numbering) {
    case "localizer-confirmed":
    case "cervicothoracic-landmark":
    case "thoracolumbar-landmark":
    case "manual":
    case "uncertain":
      return state.numbering;
    case "standard-morphology":
      return "manual";
    default:
      return "uncertain";
  }
}

/**
 * Every level the Dorso-Lumbar canvas may offer, in acquired order, with the
 * domain and the vocabulary it belongs to. The canvas renders this list and
 * nothing else, so an unacquired level has no entry point at all.
 */
export function dorsoLumbarLevelEntryOptions(state: DorsoLumbarState): Array<{
  level: string;
  label: string;
  domain: DorsoLumbarDomain;
  detailKind: DorsoLumbarDetailKind;
  neural: DorsoLumbarNeuralStructure;
  junction: boolean;
  transitional: boolean;
}> {
  return dorsolumbarLevelKeys(state).map((entry) => ({
    level: entry.key,
    label: entry.label,
    domain: entry.domain,
    detailKind: entry.domain === "lumbar" ? "lumbar" : "dorsal",
    neural: dorsolumbarNeuralStructure(entry.key, state),
    junction: entry.junction === true,
    transitional: entry.transitional === true,
  }));
}

/**
 * Compile one level of a Dorso-Lumbar study into ledger patches.
 *
 * The bridge takes the thoracic vocabulary: it is where the cord ends, so the
 * conus and cord-transition sentences live in the dorsal builder, and its ledger
 * region is the canonical junction owner. A lumbar detail supplied for the bridge
 * is reported, not silently compiled — running it through the lumbar builder
 * would be a second way to populate the same junction.
 */
export function buildDorsoLumbarLevelEntry(req: DorsoLumbarLevelEntryRequest): DorsoLumbarLevelEntry {
  const canonical = canonicalDorsoLumbarLevel(req.level);
  const domain = canonical?.domain ?? dorsolumbarLevelDomain(req.level);

  if (!canonical || !domain) {
    return refusedEntry(req.level, {
      notice: `"${req.level}" is not a Dorso-Lumbar level, so nothing was recorded.`,
    });
  }

  if (!isDorsoLumbarLevelAcquired(canonical.key, req.state)) {
    const keys = dorsolumbarLevelKeys(req.state);
    const from = keys[0]?.label ?? "—";
    const to = keys[keys.length - 1]?.label ?? "—";
    return refusedEntry(canonical.key, {
      ledgerRegion: canonical.ledgerRegion,
      domain,
      neural: dorsolumbarNeuralStructure(canonical.key, req.state),
      notice: `${canonical.key} is outside the acquired coverage (${from} to ${to}); record it as a limitation instead.`,
    });
  }

  const neural = dorsolumbarNeuralStructure(canonical.key, req.state);

  if (domain === "lumbar") {
    const detail = req.lumbar ?? {};
    if (!lumbarLevelDetailHasContent(detail)) {
      return refusedEntry(canonical.key, {
        ledgerRegion: canonical.ledgerRegion,
        domain,
        detailKind: "lumbar",
        neural,
        notice: "Nothing selected for this lumbar level.",
      });
    }
    // The lumbar level form carries a per-level selection (root level, canal AP)
    // that the shared wrapper does not accept, so this half compiles through the
    // detail builder and stamps the patches with the canonical region itself.
    const built = buildLumbarLevelDetailBundle({
      level: canonical.key,
      detail,
      sel: req.lumbarSelection,
      numbering: req.state.lumbar,
      sequences: req.sequences,
    });
    return {
      level: canonical.key,
      domain,
      ledgerRegion: canonical.ledgerRegion,
      detailKind: "lumbar",
      neural,
      bundleId: built.bundleId,
      observations: spineAtomsToPatches(canonical.ledgerRegion, built.bundleId, built.atoms),
      structuredChoiceCount: built.structuredChoiceCount,
      refused: false,
      notice: req.dorsal && dorsalLevelDetailHasContent(req.dorsal)
        ? "Thoracic-only fields are not recorded at a lumbar level."
        : null,
    };
  }

  // Thoracic and the bridge.
  const detail = req.dorsal ?? {};
  if (!dorsalLevelDetailHasContent(detail)) {
    return refusedEntry(canonical.key, {
      ledgerRegion: canonical.ledgerRegion,
      domain,
      neural,
      notice: `Nothing selected for ${canonical.key}.`,
    });
  }
  const built = buildDorsalLevelBundle({
    level: canonical.key,
    detail,
    numbering: dorsoLumbarDorsalNumbering(req.state),
    sequences: req.sequences,
    region: canonical.ledgerRegion,
  });
  return {
    level: canonical.key,
    domain,
    ledgerRegion: canonical.ledgerRegion,
    detailKind: "dorsal",
    neural,
    bundleId: built.bundleId,
    observations: built.observations,
    structuredChoiceCount: built.structuredChoiceCount,
    refused: false,
    notice: domain === "junction" && req.lumbar && lumbarLevelDetailHasContent(req.lumbar)
      ? "The thoracolumbar junction is recorded once, with the conus and cord-transition vocabulary; lumbar-level fields were not applied here."
      : null,
  };
}

function refusedEntry(
  level: string,
  over: Partial<Omit<DorsoLumbarLevelEntry, "level" | "refused">> & { notice: string },
): DorsoLumbarLevelEntry {
  const { notice, ...rest } = over;
  return {
    level,
    domain: null,
    ledgerRegion: "",
    detailKind: "dorsal",
    neural: "unknown",
    bundleId: "",
    observations: [],
    structuredChoiceCount: 0,
    refused: true,
    notice,
    ...rest,
  };
}

/**
 * Does this Dorso-Lumbar study reach the conus? The bridge and the lumbar top
 * both depend on the answer, and the coverage state — not the label on the
 * booking — decides it.
 */
export function dorsoLumbarConusAvailable(state: DorsoLumbarState): {
  allowed: boolean;
  notice: string | null;
} {
  if (dorsolumbarConusCovered(state)) return { allowed: true, notice: null };
  return {
    allowed: false,
    notice: "Recorded coverage does not reach the conus, so conus sentences are omitted.",
  };
}

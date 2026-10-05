/**
 * Measurement metadata must survive the ledger → composer adapter hop, and the
 * client + server must still agree on what an observation's clinical content is.
 *
 * Proven through the real LS-spine level bundle, the real same-slot dedupe, and
 * a save/reopen (hydrate) round-trip — not a hand-built fixture.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildLumbarLevelApplyBundle } from "@/lib/mriLumbarLevelState";
import {
  extractCareObservationLedger,
  parseObservationLedger,
} from "@/lib/observationLedger";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import {
  canonicalObservationHashPayload as clientHashPayload,
  canonicalObservationKey as clientKey,
  type ComposeObservation,
} from "@/lib/reportComposer/types";
import {
  canonicalObservationHashPayload as serverHashPayload,
  canonicalObservationKey as serverKey,
} from "../../../../api-server/src/lib/reportComposer/snapshot";

const AP_CANAL: Array<[string, number]> = [
  ["L1-L2", 12.6],
  ["L2-L3", 13.3],
  ["L3-L4", 11.6],
  ["L4-L5", 7.1],
  ["L5-S1", 8.1],
];

function resetWorkspace() {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    selectedObservationId: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
  });
}

/** Apply the real per-level bundle for each measured level. */
function applyApCanalLevels() {
  for (const [level, mm] of AP_CANAL) {
    const { bundleId, observations } = buildLumbarLevelApplyBundle({
      level,
      sel: { canalApMm: mm },
      region: "LS Spine",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
  }
}

function deriveFromStore(): ComposeObservation[] {
  return deriveComposeObservations(useWorkspace.getState().appliedPathologyPatches);
}

beforeEach(() => resetWorkspace());
afterEach(() => vi.unstubAllGlobals());

describe("deriveComposeObservations carries measurement", () => {
  it("every measured level reaches the composer with its own value and level", () => {
    applyApCanalLevels();
    const obs = deriveFromStore();
    const byLevel = new Map(obs.filter((o) => o.measurement).map((o) => [o.level, o.measurement]));
    for (const [level, mm] of AP_CANAL) {
      expect(byLevel.get(level)).toBe(String(mm));
    }
    expect(byLevel.size).toBe(AP_CANAL.length);
  });

  it("keeps decimal precision (7.1 not 7, 12.6 not 12)", () => {
    applyApCanalLevels();
    const values = deriveFromStore()
      .filter((o) => o.concept === "canal_ap")
      .map((o) => o.measurement);
    expect(values).toEqual(expect.arrayContaining(["12.6", "13.3", "11.6", "7.1", "8.1"]));
    expect(values).not.toContain("7");
  });

  it("a level with no measurement stays metadata-free", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-disc-l45",
      incoming: { findings: "Disc desiccation at L4-L5." },
      templates: { findings: "Disc desiccation at L4-L5." },
      ownership: { anatomicalSection: "L4-L5", conflictGroup: "disc_signal" },
      source: "quick-select",
      region: "LS Spine",
      level: "L4-L5",
      concept: "disc_signal",
      label: "Disc desiccation L4-L5",
      findingsText: "Disc desiccation at L4-L5.",
    });
    const obs = deriveFromStore();
    expect(obs[0].measurement).toBeUndefined();
  });

  it("trims whitespace and drops empty strings rather than sending them", () => {
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-ap-padded",
      incoming: { findings: "AP canal diameter measured at L4-L5." },
      templates: { findings: "AP canal diameter measured at L4-L5." },
      ownership: { anatomicalSection: "L4-L5", conflictGroup: "canal_ap" },
      source: "structured-template",
      region: "LS Spine",
      level: "L4-L5",
      concept: "canal_ap",
      label: "AP canal L4-L5",
      findingsText: "AP canal diameter measured at L4-L5.",
      measurement: "  9.4 mm  ",
    });
    expect(deriveFromStore()[0].measurement).toBe("9.4 mm");

    resetWorkspace();
    useWorkspace.getState().applyPathologyOverlay({
      id: "qs-ap-blank",
      incoming: { findings: "AP canal diameter measured at L4-L5." },
      templates: { findings: "AP canal diameter measured at L4-L5." },
      ownership: { anatomicalSection: "L4-L5", conflictGroup: "canal_ap" },
      source: "structured-template",
      region: "LS Spine",
      level: "L4-L5",
      concept: "canal_ap",
      label: "AP canal L4-L5",
      findingsText: "AP canal diameter measured at L4-L5.",
      measurement: "   ",
    });
    expect(deriveFromStore()[0].measurement).toBeUndefined();
  });

  it("measurement never splits or merges a clinical slot", () => {
    applyApCanalLevels();
    const withValues = deriveFromStore().filter((o) => o.concept === "canal_ap");
    expect(withValues).toHaveLength(AP_CANAL.length);
    // Re-applying the same levels with different numbers replaces in place —
    // still five rows, still five distinct slots.
    for (const [level, mm] of AP_CANAL) {
      const { bundleId, observations } = buildLumbarLevelApplyBundle({
        level,
        sel: { canalApMm: mm + 1 },
        region: "LS Spine",
      });
      useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    }
    const after = deriveFromStore().filter((o) => o.concept === "canal_ap");
    expect(after).toHaveLength(AP_CANAL.length);
    expect(new Set(after.map((o) => o.level)).size).toBe(AP_CANAL.length);
  });

  it("stale patches stay out of the composer even when they hold measurements", () => {
    applyApCanalLevels();
    useWorkspace.setState((s) => ({
      appliedPathologyPatches: s.appliedPathologyPatches.map((p, i) =>
        i === 0 ? { ...p, stale: true } : p,
      ),
    }));
    const obs = deriveFromStore().filter((o) => o.measurement);
    expect(obs).toHaveLength(AP_CANAL.length - 1);
    expect(obs.some((o) => o.level === "L1-L2")).toBe(false);
  });
});

describe("save → reopen keeps measurement attached to the composer", () => {
  it("a hydrated ledger still yields the same measured observations", () => {
    applyApCanalLevels();
    const before = deriveFromStore().filter((o) => o.measurement);
    expect(before.length).toBe(AP_CANAL.length);

    // What save-draft actually persists, and what reopen actually restores —
    // narrative first, then the ledger, or every patch reads as stale.
    const narrative = {
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
      recommendation: useWorkspace.getState().recommendationText,
      technique: useWorkspace.getState().techniqueText,
      clinicalHistory: useWorkspace.getState().clinicalHistoryText,
    };
    const structuredJson = {
      careObservationLedger: useWorkspace.getState().serializeObservationLedger(),
    };
    resetWorkspace();
    useWorkspace.getState().setEditorContent(narrative);
    const ledger = extractCareObservationLedger(structuredJson);
    const result = useWorkspace.getState().hydrateObservationLedger(ledger);
    expect(result.mode).toBe("restored");
    expect(parseObservationLedger(ledger).status).toBe("restored");

    const after = deriveFromStore().filter((o) => o.measurement);
    expect(after.map((o) => `${o.level}:${o.measurement}`).sort())
      .toEqual(before.map((o) => `${o.level}:${o.measurement}`).sort());
  });
});

describe("client and server hash the same clinical content", () => {
  it("measurement participates in the hash payload on BOTH sides", () => {
    applyApCanalLevels();
    const obs = deriveFromStore().filter((o) => o.measurement);
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      expect(clientHashPayload(o)).toBe(serverHashPayload(o));
      expect(clientKey(o)).toBe(serverKey(o));
    }
  });

  it("changing one level's value changes the payload, on both sides identically", () => {
    const base: ComposeObservation = {
      concept: "canal_ap",
      source: "structured",
      region: "LS Spine",
      level: "L4-L5",
      measurement: "7.1",
      findingsText: "Spinal canal anteroposterior diameter recorded at this level.",
    };
    const changed = { ...base, measurement: "5.8" };
    expect(clientHashPayload(base)).not.toBe(clientHashPayload(changed));
    expect(serverHashPayload(base)).not.toBe(serverHashPayload(changed));
    expect(clientHashPayload(base)).toBe(serverHashPayload(base));
    // Identity is untouched by the value.
    expect(clientKey(base)).toBe(clientKey(changed));
    expect(serverKey(base)).toBe(serverKey(changed));
  });
});

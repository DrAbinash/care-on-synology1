import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch, tileRowId } from "./zai-workspace/quickSelectTileFixture";
import type { QuickSelectTile } from "./zai-workspace/types";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import {
  CARE_VIEWER_MEASUREMENTS_KIND,
  emptyViewerMeasurementsState,
} from "./structuredViewerMeasurements";

/**
 * Item 2 — Undo restores the complete report state, not only the prose.
 *
 * Measured before written. Two facts came out of driving the real doors and
 * scanning every door that pushes a frame:
 *
 *  1. The frame carried 17 keys, and the frame-pushing doors write more than
 *     that. `selectedObservationId`, `structuredViewerMeasurements`,
 *     `ownershipReviewWarnings` and `normalLinesRemovedByRadiologist` were left
 *     behind, so the sentence went back and the surface did not: the Quick Select
 *     row stayed lit, and the viewer measurements — which
 *     `useDraftPersistence.ts:742` puts in the saved draft — stayed as the action
 *     had left them.
 *  2. The copilot rail's Insert button wrote a Findings sentence through
 *     `mergeField`, which pushes no frame. Undo therefore stepped PAST it: the
 *     radiologist pressed Ctrl+Shift+Z to take the measurement out and got whatever
 *     edit they had made before it, with the measurement still on the page.
 *
 * `impressionDependencyReasons` looks like a fifth leak in a state diff and is
 * not one: `undoLastPatch`/`redoLastPatch` re-derive the whole dependency trio
 * from the restored text, which is the single predicate instead of a copied value.
 *
 * Content is synthetic — shipped tiles, invented measurements, no patient data.
 */

const tile = (label: string): QuickSelectTile => {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};
const BURST_C5 = tile("Burst fracture C5");
const S = () => useWorkspace.getState();
const holds = (sentence: string, text = S().findingsText): boolean =>
  splitToSentences(text).map(normalizeForDedupe).includes(normalizeForDedupe(sentence));

function reset(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    activeStudyId: "study-A",
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    patchUndoStack: [],
    patchRedoStack: [],
    lastPatchSnapshot: null,
    impressionNeedsRefresh: false,
    impressionDependencyReasons: [],
    impressionBasis: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    voiceComposerObservations: [],
    measurements: [],
    canalApProvenance: {},
    regionTransitions: [],
    coverageMarks: [],
    coverageByScope: {},
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    selectedObservationId: null,
    ownershipReviewWarnings: [],
    normalLinesRemovedByRadiologist: [],
    appliedPatternMarkers: [],
    isFinalized: false,
    isDirty: false,
    startingCanvasBaseline: null,
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Cervical Spine Plain",
      regions: ["Cervical Spine"],
      source: "auto",
    }),
  });
}

const click = (t: QuickSelectTile) => {
  const outcome = S().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
  if (outcome !== "applied") throw new Error(`${t.label} click was ${outcome}`);
};

describe("the frame carries what the doors write", () => {
  it("un-lights the Quick Select row whose sentence it takes back", () => {
    reset();
    expect(S().selectedObservationId, "nothing is selected to begin with").toBeNull();

    click(BURST_C5);
    expect(S().selectedObservationId).toBe(tileRowId(BURST_C5));

    expect(S().undoLastPatch()).toBe(true);
    expect(
      S().selectedObservationId,
      "the sentence is off the page, so the row that wrote it cannot still read selected",
    ).toBeNull();
  });

  it("puts the viewer measurement back on the row the deselect detached it from", () => {
    reset();
    const rowId = tileRowId(BURST_C5);
    const attached = {
      kind: CARE_VIEWER_MEASUREMENTS_KIND,
      version: 1 as const,
      items: [
        {
          id: "vm-1",
          concept: "canal_ap",
          values: { primary: 11.4, unit: "mm" },
          observationId: rowId,
          manualOverride: false,
          createdAt: "2026-11-13T00:00:00.000Z",
          updatedAt: "2026-11-13T00:00:00.000Z",
        },
      ],
    };
    click(BURST_C5);
    useWorkspace.setState({ structuredViewerMeasurements: attached });
    S().removeObservation(rowId);

    expect(
      S().structuredViewerMeasurements.items.find((i) => i.id === "vm-1")?.observationId,
      "the deselect detached it — that is what the action is for",
    ).not.toBe(rowId);

    expect(S().undoLastPatch()).toBe(true);
    expect(
      S().structuredViewerMeasurements.items.find((i) => i.id === "vm-1")?.observationId,
      "the draft payload carries this set, so an undo that leaves it detached autosaves a "
      + "measurement the radiologist just took back",
    ).toBe(rowId);
  });

  it("restores the removal memory with the line it removed", () => {
    reset();
    // The memory is what stops the next automatic pass re-adding a normal line he
    // deleted. Stepping back over the pass that recorded it must clear the record,
    // or the line comes back onto the page and the following pass eats it again.
    useWorkspace.setState({
      normalLinesRemovedByRadiologist: ["Normal cervical lordosis is maintained."],
      ownershipReviewWarnings: [{ sentence: "x", token: "t", hint: "h" }],
    });
    const before = {
      removed: [...S().normalLinesRemovedByRadiologist],
      warnings: [...S().ownershipReviewWarnings],
    };
    click(BURST_C5);
    useWorkspace.setState({
      normalLinesRemovedByRadiologist: [],
      ownershipReviewWarnings: [],
    });

    expect(S().undoLastPatch()).toBe(true);
    expect(S().normalLinesRemovedByRadiologist).toEqual(before.removed);
    expect(S().ownershipReviewWarnings).toEqual(before.warnings);
  });

  it("carries every key the frame-pushing doors write", () => {
    const src = readFileSync(
      path.resolve(__dirname, "zai-workspace/store.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");

    const capStart = src.indexOf("function captureClinicalSnapshot");
    const captured = new Set(
      [...src.slice(capStart, src.indexOf("\n}", capStart)).matchAll(/^ {4}(\w+):/gm)].map(
        (m) => m[1],
      ),
    );

    const topLevelKeys = (openBrace: number): { keys: string[]; spreads: string[] } => {
      const keys: string[] = [];
      const spreads: string[] = [];
      let depth = 0;
      let quote: string | null = null;
      let buf = "";
      for (let i = openBrace; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          if (c === "\\") { i++; continue; }
          if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; buf += c; continue; }
        if (c === "{" || c === "(" || c === "[") {
          depth++;
          if (depth === 1) { buf = ""; continue; }
        }
        if (c === "}" || c === ")" || c === "]") {
          depth--;
          if (depth === 0) break;
        }
        if (depth !== 1) continue;
        if (c === ",") {
          const sp = /^\s*\.\.\.\s*([A-Za-z_][\w.]*)/.exec(buf);
          if (sp) spreads.push(sp[1]);
          buf = "";
          continue;
        }
        buf += c;
        const m = /^\s*([A-Za-z_]\w*)\s*:/.exec(buf);
        if (m) { keys.push(m[1]); buf = ""; }
      }
      return { keys, spreads };
    };

    /** A spread contributes the keys of the local it names, or of a helper's `Pick<S, …>`. */
    const spreadKeys = (expr: string, from: number, to: number): string[] => {
      const name = expr.split("(")[0].trim();
      const out: string[] = [];
      const def = new RegExp(`\\b(?:const|let) ${name}\\s*[:=]`).exec(src.slice(from, to));
      if (def) {
        const brace = src.indexOf("{", from + def.index + def[0].length - 1);
        if (brace > 0 && brace < to) out.push(...topLevelKeys(brace).keys);
      }
      const fn = new RegExp(`function ${name}\\b`).exec(src);
      if (fn) {
        const sig = src.slice(fn.index, src.indexOf("{", fn.index + fn[0].length) + 1);
        const pick = /Pick<S,\s*([^)]*)>/.exec(sig);
        if (pick) for (const k of pick[1].matchAll(/"([A-Za-z_]\w*)"/g)) out.push(k[1]);
      }
      return out;
    };

    // Not report state: the history mechanism itself, the dirty flag, and the
    // dialogs a step back must not re-open. Anything added here needs a reason.
    const NOT_CLINICAL = new Set([
      "patchUndoStack", "patchRedoStack", "lastPatchSnapshot", "lastVoiceApplyId", "isDirty",
      "confirmOverwriteOpen", "pendingPathologyPatch", "pendingNormalReplacement",
      "pendingFormatIds", "pendingFormatOverwrite", "pendingFormatRegion",
      "pendingFormatNormalPlan", "reportFormats", "reportFormatPickerOpen",
      "lastMergeResult", "lastMergeFormats", "mergePreviewOpen",
      "abnormalPatternConfirm", "activeMacroPrompt",
      // Re-derived from the restored pair by undo and redo alike.
      "impressionDependencyReasons",
    ]);

    const actions = [...src.matchAll(/\n  ([A-Za-z_]\w*): /g)].map((m) => ({
      name: m[1],
      at: m.index,
    }));
    const missed: string[] = [];
    let m: RegExpExecArray | null;
    const re = /withPushedClinicalUndo\(/g;
    while ((m = re.exec(src))) {
      let door: { name: string; at: number } | null = null;
      for (const a of actions) if (a.at < m.index) door = a; else break;
      if (!door) continue;
      const next = actions.find((a) => a.at > door!.at);
      const body = src.slice(door.at, next ? next.at : src.length);
      const keys = new Set<string>();
      let p = 0;
      while ((p = body.indexOf("set(", p)) >= 0) {
        const brace = body.indexOf("{", p);
        if (brace > 0 && brace - p < 30) {
          const r = topLevelKeys(door.at + brace);
          for (const k of r.keys) keys.add(k);
          for (const s of r.spreads) for (const k of spreadKeys(s, door.at, next ? next.at : src.length)) keys.add(k);
        }
        p += 4;
      }
      for (const k of keys) {
        if (!captured.has(k) && !NOT_CLINICAL.has(k)) missed.push(`${door.name} → ${k}`);
      }
    }
    expect(missed, `doors that push a frame write keys the frame does not carry:\n${missed.join("\n")}`).toEqual([]);
  });
});

describe("a measurement click is a clinical change, so it is undoable", () => {
  const row = {
    id: "m1",
    name: "AP canal diameter C5-C6",
    value: 11.4,
    unit: "mm",
    source: "viewer" as const,
    inserted: false,
  };
  const SENTENCE = "AP canal diameter C5-C6: 11.4mm.";

  it("takes the sentence and the rail's inserted flag back together", () => {
    reset();
    S().setMeasurements([row]);
    S().insertMeasurement("m1");
    expect(holds(SENTENCE), "the click wrote it").toBe(true);
    expect(S().measurements[0]!.inserted, "and marked the row").toBe(true);

    expect(S().undoLastPatch(), "the click is on the history").toBe(true);
    expect(holds(SENTENCE), "undo removes the sentence").toBe(false);
    expect(
      S().measurements[0]!.inserted,
      "and the rail's flag with it, or the row reads inserted for text that is gone",
    ).toBe(false);

    expect(S().redoLastPatch()).toBe(true);
    expect(holds(SENTENCE) && S().measurements[0]!.inserted, "redo returns both").toBe(true);
  });

  it("does not spend an undo step on a click that wrote nothing", () => {
    reset();
    useWorkspace.setState({ findingsText: SENTENCE });
    S().setMeasurements([row]);
    click(BURST_C5);

    S().insertMeasurement("m1");
    expect(
      S().patchUndoStack.length,
      "the sentence was already on the page, so the merge wrote nothing",
    ).toBe(1);

    expect(S().undoLastPatch()).toBe(true);
    expect(
      holds("Burst fracture of the C5 vertebral body with loss of posterior vertebral body height."),
      "and the step the radiologist gets back is the real one",
    ).toBe(false);
    expect(holds(SENTENCE), "the pre-existing measurement line is untouched").toBe(true);
  });

  it("still refuses the write on a signed report, frame and all", () => {
    reset();
    S().setMeasurements([row]);
    useWorkspace.setState({ isFinalized: true });

    S().insertMeasurement("m1");
    expect(holds(SENTENCE), "nothing was written").toBe(false);
    expect(S().patchUndoStack.length, "and no frame was pushed").toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";

const BRAIN_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;

type Tile = {
  label: string;
  sentence: string;
  impressionSentence?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  scopeBodyPart?: string;
  scopeModality?: string;
  field?: string;
};

const TILES_BRAIN = (TILES as unknown as Tile[]).filter(
  (t) => t.scopeModality === "MR" && t.field === "findings" && /brain/i.test(t.scopeBodyPart ?? "BRAIN") && t.sentence,
);

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null,
    reportingContext: buildReportingStudyContext({ modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto" }),
    reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [], voiceComposerObservations: [],
  });
}

function run(order: Tile[]): { text: string; impressions: string[] } {
  reset();
  useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
  for (const [i, tile] of order.entries()) {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: tile.sentence, impression: tile.impressionSentence },
      templates: { findings: tile.sentence, impression: tile.impressionSentence },
      ownership: {
        anatomicalSection: tile.anatomicalSection,
        conflictGroup: tile.conflictGroup,
        baselineReplaces: tile.baselineReplaces,
      },
      source: "quick-select",
      id: `p${i}`,
      region: tile.scopeBodyPart,
      label: tile.label,
      findingsText: tile.sentence,
    });
  }
  const s = useWorkspace.getState();
  return { text: s.findingsText, impressions: [s.impressionText] };
}

/** The clinical content of a field: its sentences as a multiset, ignoring layout. */
function content(text: string): string[] {
  return splitToSentences(text).map(normalizeForDedupe).filter(Boolean).sort();
}

function sameMultiset(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/**
 * The measured register, 2026-10-15, on `origin/main` = `1841668b` + the Stage B
 * catalogue. Nine pairs of shipped MRI Brain findings tiles print DIFFERENT clinical
 * content depending on which was clicked first. Each entry is
 * `first clicked <> second clicked`, and the mechanism is one of:
 *
 *   - a normal clicked last re-adds its sentence beside the abnormal already on the page
 *     (six pairs, including `Subarachnoid hemorrhage`, where the report then states both
 *     "No evidence of acute infarct, hemorrhage, or mass lesion" and "Acute subarachnoid
 *     hemorrhage"), or
 *   - an abnormal clicked last is evicted by the normal that follows it
 *     (`Hydrocephalus`, `Demyelinating lesion`), or
 *   - one abnormal evicts another (`Glioma recurrence` + `Cerebral edema`: the
 *     post-resection tumour sentence disappears when edema is clicked second).
 *
 * The set is pinned, not just the count, so a tenth pair cannot appear while an
 * eleventh is fixed. Retirement of a baseline normal is the intended direction; a
 * contribution that silently revives or deletes a statement is not. Lowering this list
 * is v4 Stage C-2, and when it empties the register must be deleted rather than left at
 * zero, so that a regression has to be re-added deliberately.
 */
const CROSS_GROUP_ORDER_DEPENDENCE_REGISTER: readonly string[] = [
  "Normal brain parenchyma (brain_parenchyma) <> Cerebral edema (edema)",
  "Normal brain parenchyma (brain_parenchyma) <> Demyelinating lesion (demyelinating)",
  "Normal brain parenchyma (brain_parenchyma) <> Fazekas 1 (fazekas)",
  "Normal brain parenchyma (brain_parenchyma) <> Fazekas 2 (fazekas)",
  "Normal brain parenchyma (brain_parenchyma) <> Fazekas 3 (fazekas)",
  "Normal brain parenchyma (brain_parenchyma) <> Lacunar infarcts (lacunar)",
  "Normal brain parenchyma (brain_parenchyma) <> Subarachnoid hemorrhage (subarachnoid hemorrhage)",
  "Normal ventricles (ventricular) <> Hydrocephalus (hydrocephalus)",
  "Glioma recurrence (tumor recurrence) <> Cerebral edema (edema)",
];

/**
 * RATCHET — shrink-only. Same content in a different sequence: a presentation defect,
 * not a clinical one, and §16's ordinal metadata is what closes it (v4 Stage D).
 */
const ORDERED_SEQUENCE_DEBT_CEILING = 51;

describe("Quick Select click-order determinism (v4 Stage C census)", () => {
  it("lets no tile change what an unrelated tile says when the click order changes", () => {
    const crossGroup: string[] = [];
    const withinGroup: string[] = [];
    const sequenceDiffers: string[] = [];
    let pairs = 0;
    for (let i = 0; i < TILES_BRAIN.length; i++) {
      for (let j = i + 1; j < TILES_BRAIN.length; j++) {
        const a = TILES_BRAIN[i]!, b = TILES_BRAIN[j]!;
        const fwd = run([a, b]);
        const rev = run([b, a]);
        pairs++;
        if (fwd.text === rev.text) continue;
        const ca = content(fwd.text), cb = content(rev.text);
        if (sameMultiset(ca, cb)) {
          sequenceDiffers.push(`${a.label} <> ${b.label}`);
          continue;
        }
        const entry = `${a.label} (${a.conflictGroup || "no group"}) <> ${b.label} (${b.conflictGroup || "no group"})`;
        // Two tiles in one conflict group are mutually exclusive by declaration, and the
        // later click is the radiologist's intent: the grade they chose last is the grade
        // that prints. That is a decision, not a loss.
        if (a.conflictGroup && a.conflictGroup === b.conflictGroup) withinGroup.push(entry);
        else crossGroup.push(entry);
      }
    }
    console.log(
      `CENSUS tiles=${TILES_BRAIN.length} pairs=${pairs} identical=${pairs - sequenceDiffers.length - crossGroup.length - withinGroup.length} ` +
      `sequence-only=${sequenceDiffers.length} content-within-group=${withinGroup.length} content-across-groups=${crossGroup.length}`,
    );

    expect(
      crossGroup.sort(),
      `pairs whose printed findings differ by click order across conflict groups:\n    ${crossGroup.join("\n    ")}`,
    ).toEqual([...CROSS_GROUP_ORDER_DEPENDENCE_REGISTER].sort());
    expect(
      sequenceDiffers.length,
      `order-dependent SEQUENCE debt grew: ${sequenceDiffers.length} > ${ORDERED_SEQUENCE_DEBT_CEILING}\n    ${sequenceDiffers.join("\n    ")}`,
    ).toBeLessThanOrEqual(ORDERED_SEQUENCE_DEBT_CEILING);
    // The register is only meaningful if the run can see the pairs at all.
    expect(withinGroup.length, "same-group pairs, where last-click-wins is intended").toBeGreaterThan(0);
  });

  it("measures the census population from the shipped library, not from a hand-kept count", () => {
    expect(TILES_BRAIN.length).toBeGreaterThan(20);
    expect(pairsOf(TILES_BRAIN.length)).toBe((TILES_BRAIN.length * (TILES_BRAIN.length - 1)) / 2);
  });
});

function pairsOf(n: number): number {
  return (n * (n - 1)) / 2;
}

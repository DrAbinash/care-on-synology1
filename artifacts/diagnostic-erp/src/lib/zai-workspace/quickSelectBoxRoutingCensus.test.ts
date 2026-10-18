/**
 * Every shipped box, one click, no sentence misfiled.
 *
 * The Quick Select strip used to render the browser's tile cache and click
 * through `quickSelectTilePatch`, which wrote one sentence per box and put
 * everything that was not a findings box into the Impression: the technique
 * boxes printed "CT on 128-slice scanner. Slice thickness 5 mm." as a
 * radiologist's conclusion, and the four advice boxes printed "Clinical
 * correlation advised." as one too. The strip renders database boxes now and
 * clicks through `quickFindingPatch`, which carries all four columns.
 *
 * A Phase-3 census measured the change over all 127 boxes and found the routing
 * was the only clinical difference between the two paths. This is the permanent
 * form of that finding, and it is stated as a property of the new path alone —
 * the old builder is deleted, and a test that re-imports a deleted function to
 * compare against it is a ratchet on the past rather than on the report.
 *
 * Two directions, because either one alone passes vacuously:
 *   · every sentence a box carries reaches the section it is carried for, and
 *   · no section says anything the box did not carry.
 * Plus a coverage assertion, so a catalogue that lost its technique boxes could
 * not leave the first two passing over a population that no longer exercises
 * the property.
 *
 * Five sections, not four. Clinical History is one of the five a box's `field`
 * can name, and a history box's sentence lives in the `finding_text` column
 * because the table has no column for history — so reading that column as a
 * finding reported an indication as an observation of the scan. The click
 * measured here is the one the workspace makes, including the branch that hands
 * a history box to the Clinical History toggle instead of the overlay.
 */
import { describe, expect, it } from "vitest";
import { useWorkspace } from "./store";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { clinicalBoxForTile } from "./quickSelectTileFixture";
import {
  isClinicalHistoryBox,
  quickFindingClickRoute,
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import { quickSelectBoxSentence } from "./quickSelectBoxCatalogue";
import { resolveHistoryPhrase } from "@/lib/clinicalHistoryText";
import { applySideToIncoming } from "@/lib/pathologyPatch";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import type { QuickSelectParameterValues } from "./quickSelectParameterContract";
import type { QuickSelectTile } from "./types";

const SECTIONS = ["clinicalHistory", "findings", "impression", "technique", "recommendation"] as const;
type Section = (typeof SECTIONS)[number];

const TILES = DEFAULT_QUICK_SELECT_TILES as unknown as QuickSelectTile[];

const sents = (t: unknown) =>
  splitToSentences(String(t ?? ""))
    .map(normalizeForDedupe)
    .filter(Boolean)
    .sort();

/** The workspace as a fresh study of this tile's own scope, nothing filled in. */
function resetTo(tile: QuickSelectTile): void {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    impressionNeedsRefresh: false,
    lastPatchSnapshot: null,
    patchUndoStack: [],
    patchRedoStack: [],
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    startingCanvasBaseline: null,
    appliedFormatReportTitle: null,
    voiceComposerObservations: [],
    reportingContext: buildReportingStudyContext({
      modality: tile.scopeModality || "MR",
      studyDescription: tile.scopeBodyPart ?? "",
      regions: tile.scopeBodyPart ? [tile.scopeBodyPart] : [],
      source: "auto",
    }),
  });
}

/**
 * The parameters the strip would have collected before this click. Resolving
 * them is what lets the census cover the 23 boxes that carry a `{side}` or a
 * `{severity}` at all — unresolved they refuse, on purpose, and a refusal is
 * asserted separately.
 */
function paramsFor(box: ClinicalQuickFindingBox): QuickSelectParameterValues {
  const all = `${box.findingText} ${box.impressionText} ${box.techniqueText} ${box.recommendationText}`;
  const p: QuickSelectParameterValues = {};
  if (/\{side\}/i.test(all)) p.side = "left";
  if (/\{severity\}/i.test(all)) p.severity = "moderate";
  return p;
}

function click(tile: QuickSelectTile) {
  const box = clinicalBoxForTile(tile);
  const params = paramsFor(box);
  resetTo(tile);
  const patch = quickFindingPatch(box, { region: box.studyType }, params);
  const state = useWorkspace.getState();
  // The click handler's own route decision, called rather than re-implemented:
  // a clinical-history box contributes through the Clinical History toggle, and
  // only a patch that also carries body prose reaches the overlay. Measuring one
  // half of the click would not tell a sentence filed in the wrong section from a
  // sentence that was never written at all.
  const route = quickFindingClickRoute(patch);
  let verdict: string;
  if (route.clinicalHistory) {
    verdict = state.toggleClinicalHistoryContribution(route.clinicalHistory, true, params.side);
    if (!route.writesBody) return finish(verdict, box, params);
  }
  verdict = String(state.applyPathologyOverlay(patch));
  return finish(verdict, box, params);
}

function finish(verdict: string, box: ClinicalQuickFindingBox, params: QuickSelectParameterValues) {
  const s = useWorkspace.getState();
  const text: Record<Section, string> = {
    clinicalHistory: s.clinicalHistoryText,
    findings: s.findingsText,
    impression: s.impressionText,
    technique: s.techniqueText,
    recommendation: s.recommendationText,
  };
  const historyBox = isClinicalHistoryBox(box);
  const history = quickSelectBoxSentence(box, "clinicalHistory");
  // The expectation is derived from the box's own columns and the rule that a
  // history box's sentence belongs to Clinical History, never from the patch the
  // builder returned. Reading the patch would make a misfiled sentence its own
  // justification, which is the failure this census exists to catch.
  //
  // `applySideToIncoming` and `resolveHistoryPhrase` are the substitutions the
  // two writes actually apply, so the wording compared is the wording received.
  const resolved = applySideToIncoming(
    {
      findings: historyBox ? "" : box.findingText,
      impression: box.impressionText,
      technique: box.techniqueText,
      recommendation: box.recommendationText,
    },
    (params.side ?? "") as never,
    (params.severity ?? "") as never,
  );
  return {
    verdict: String(verdict),
    text,
    resolved: {
      ...resolved,
      clinicalHistory: historyBox ? resolveHistoryPhrase(history, params.side ?? "") : "",
    } as Record<Section, string>,
  };
}

describe("the whole shipped catalogue, one box at a time", () => {
  it("puts every sentence a box carries into the section it is carried for, and nothing else", () => {
    const exercised = new Set<Section>();
    const faults: string[] = [];

    for (const tile of TILES) {
      const { verdict, text, resolved } = click(tile);
      if (verdict === "refused") {
        faults.push(`${tile.label}: refused with every parameter resolved`);
        continue;
      }
      for (const section of SECTIONS) {
        const carried = sents(resolved[section]);
        const said = sents(text[section]);
        if (carried.length) exercised.add(section);
        for (const sentence of carried) {
          if (!said.includes(sentence)) {
            faults.push(`${tile.label} → ${section}: lost "${sentence}"`);
          }
        }
        for (const sentence of said) {
          if (!carried.includes(sentence)) {
            faults.push(`${tile.label} → ${section}: invented "${sentence}"`);
          }
        }
      }
    }

    expect(faults.slice(0, 40)).toEqual([]);
    expect([...exercised].sort(), "the catalogue stopped exercising a section").toEqual(
      [...SECTIONS].sort(),
    );
  });

  it("refuses a box whose parameter nobody chose, on every section, instead of printing the token", () => {
    const refused: string[] = [];
    const tokenLeaked: string[] = [];

    for (const tile of TILES) {
      const box = clinicalBoxForTile(tile);
      if (!Object.keys(paramsFor(box)).length) continue;
      resetTo(tile);
      const patch = quickFindingPatch(box, { region: box.studyType });
      const state = useWorkspace.getState();
      const verdict = String(
        patch.clinicalHistory
          ? state.toggleClinicalHistoryContribution(patch.clinicalHistory, true)
          : state.applyPathologyOverlay(patch),
      );
      if (verdict !== "refused") refused.push(`${tile.label}: ${verdict}`);
      const s = useWorkspace.getState();
      const texts: Record<Section, string> = {
        clinicalHistory: s.clinicalHistoryText,
        findings: s.findingsText,
        impression: s.impressionText,
        technique: s.techniqueText,
        recommendation: s.recommendationText,
      };
      for (const section of SECTIONS) {
        if (/\{side\}|\{severity\}/i.test(texts[section])) tokenLeaked.push(`${tile.label} → ${section}`);
      }
    }

    expect(refused, "a parameterized box wrote without a chosen value").toEqual([]);
    expect(tokenLeaked, "an unresolved token reached the report").toEqual([]);
    // Without this the two above pass vacuously on a catalogue that stopped
    // shipping any box with a parameter.
    expect(
      TILES.filter((t) => Object.keys(paramsFor(clinicalBoxForTile(t))).length).length,
      "the catalogue no longer ships any parameterized box",
    ).toBeGreaterThan(0);
  });
});

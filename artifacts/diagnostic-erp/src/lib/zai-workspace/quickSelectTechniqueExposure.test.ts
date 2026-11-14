import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { factorySeedRows } from "../../../../../scripts/src/generate-quick-select-factory-boxes";
import { buildReportingStudyContext } from "../reportingStudyContext";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./quick-select-tiles.data";
import { clickedTilePatch, clinicalBoxForTile } from "./quickSelectTileFixture";
import {
  lookupBoxesForContext,
  quickSelectBoxWrittenText,
  type QuickSelectCatalogueBox,
} from "./quickSelectBoxCatalogue";
import { withholdContrastOnlyBoxes } from "./quickSelectContrastGate";
import { useWorkspace } from "./store";
import type { QuickSelectTile } from "./types";

/**
 * Audit item 17 — "expose configured History/Technique Quick Select options".
 *
 * Measured on `ba207aa62`, not assumed:
 *
 *  - The catalogue ships 175 boxes. Seven are authored for Technique and eleven
 *    for Clinical History (`factorySeedRows` census below re-reads the count from
 *    the corpus rather than trusting it).
 *  - Four strips render, for findings / impression ×2 / recommendation. None
 *    renders `technique`, so the Technique accordion section — which has a
 *    protocol strip and a free-text editor and nothing else — offered zero of
 *    the seven sentences somebody sat down and wrote.
 *  - Clinical History is NOT missing: its boxes reach the report through the
 *    Findings panel, which applies no field filter, and are routed to the
 *    history section on click. A `field="clinicalHistory"` strip is deliberately
 *    pinned away (`clinicalHistorySection2.test.ts:25`) because that section
 *    already has one control over one field — a strip backed by its own table —
 *    and a Quick Select strip beside it would be a second one. So this file
 *    restates that ban rather than breaking it, and mounts the technique half
 *    only.
 *  - Five of the seven technique boxes are cross-region (the seed filed them with
 *    `study_type = ''`), so the panel's non-search pool (`contentTabs.has`) never
 *    holds them, and its search tests `label`, `tags`, `findingText` and
 *    `impressionText` — all of which are empty or a name for a technique box.
 *    "128-slice", "contrast-enhanced" and "convex transducer" each searched to
 *    nothing. The strip searches `quickSelectBoxSentence(box, field)`, which is
 *    why mounting it is the fix and not the panel's search alone; the search half
 *    is pinned too, because the panel remains the only surface for the other
 *    cross-region sections.
 *
 * Everything except the last describe is executable over the whole shipped
 * corpus. The wiring is a source contract because this package has no component
 * renderer.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

const SEED = factorySeedRows(TILES as never);

/** Every shipped tile, widened the way the wire widens it. */
function allBoxes(): QuickSelectCatalogueBox[] {
  return TILES.map((tile, i) => ({
    ...clinicalBoxForTile(tile),
    field: SEED[i]!.field ?? null,
    scopeModality: tile.scopeModality ?? null,
  })) as QuickSelectCatalogueBox[];
}

const TECHNIQUE = TILES.map((tile, i) => ({ tile, box: {
  ...clinicalBoxForTile(tile),
  field: SEED[i]!.field ?? null,
  scopeModality: tile.scopeModality ?? null,
} as QuickSelectCatalogueBox })).filter((x) => (x.box.field ?? "") === "technique");

/** A study of the box's own scope, so a refusal for scope cannot read as a pass. */
function ctxFor(tile: QuickSelectTile) {
  const modality = tile.scopeModality || "MR";
  const region = tile.scopeBodyPart || (modality === "MG" ? "Breast" : modality === "US" ? "Abdomen" : modality === "CT" ? "Brain" : modality === "XR" ? "Chest" : "Brain");
  return buildReportingStudyContext({
    modality, studyDescription: region, regions: [region], source: "auto",
  });
}

function resetStore() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, patchUndoStack: [],
    patchRedoStack: [], confirmOverwriteOpen: false, pendingPathologyPatch: null,
    isFinalized: false, isDirty: false,
  });
}

describe("the seven shipped technique boxes are reachable by the technique field", () => {
  it("has seven of them, and they are technique boxes and nothing else", () => {
    expect(TECHNIQUE.length).toBe(7);
    for (const { box, tile } of TECHNIQUE) {
      const sentence = String(box.techniqueText ?? "").trim();
      expect(sentence.length, `${tile.label} ships no technique sentence`).toBeGreaterThan(0);
      // A technique tile must not also be pretending to be a finding: the seed
      // files its one sentence in the technique column and leaves the rest empty.
      expect(String(box.findingText ?? "").trim(), `${tile.label} also claims Findings`).toBe("");
    }
  });

  it("a technique strip scoped to the box's own study offers it", () => {
    const boxes = allBoxes();
    const missed: string[] = [];
    for (const { tile, box } of TECHNIQUE) {
      const ctx = ctxFor(tile);
      const scoped = lookupBoxesForContext(boxes, "technique", tile.scopeModality || undefined, ctx);
      if (!scoped.some((b) => b.id === box.id)) {
        missed.push(`${tile.label} (modality=${tile.scopeModality} region=${tile.scopeBodyPart || "cross-region"})`);
      }
    }
    expect(missed, "the scoping library withheld these technique boxes").toEqual([]);
  });

  it("withholds none of them for a contrast rule, so the strip cannot come up empty", () => {
    // The technique strip is the one strip whose own field decides plain vs
    // contrast (`mriBrainSequences.ts`), and the contrast gate reads that text.
    // If a technique sentence asserted enhancement, an MR Plain study would hide
    // the very box that describes what was done. Measured here rather than hoped.
    const boxes = allBoxes();
    const scoped = lookupBoxesForContext(boxes, "technique", "MR", ctxFor({ scopeModality: "MR" } as QuickSelectTile));
    const { withheld } = withholdContrastOnlyBoxes(scoped, { modality: "MR", status: "not-given" });
    expect(withheld.map((b) => b.label), `withheld on MR Plain: ${withheld.map((b) => b.techniqueText).join(" / ")}`).toEqual([]);
  });
});

describe("clicking one writes Technique and only Technique", () => {
  beforeEach(resetStore);

  it("puts the sentence in the Technique field, leaving the other three sections untouched", () => {
    const faults: string[] = [];
    for (const { tile } of TECHNIQUE) {
      resetStore();
      const verdict = useWorkspace.getState().applyPathologyOverlay(clickedTilePatch(tile, "technique"));
      const s = useWorkspace.getState();
      const sentence = String(tile.sentence ?? "").replace(/\{side\}/g, "").replace(/\s+/g, " ").trim();
      if (verdict === "refused") faults.push(`${tile.label}: refused (${String(verdict)})`);
      if (!s.techniqueText.includes(sentence.slice(0, 24))) {
        faults.push(`${tile.label}: Technique = ${JSON.stringify(s.techniqueText.slice(0, 90))}`);
      }
      for (const section of ["findingsText", "impressionText", "recommendationText"] as const) {
        if (String(s[section]).trim()) faults.push(`${tile.label} also wrote ${section}`);
      }
    }
    expect(faults).toEqual([]);
  });

  it("is one undo frame, so a mis-click does not cost the technique the radiologist typed", () => {
    useWorkspace.setState({ techniqueText: "MRI Brain on 3T. Sagittal T1, T2, FLAIR." });
    useWorkspace.getState().applyPathologyOverlay(clickedTilePatch(TECHNIQUE[0]!.tile, "technique"));
    expect(useWorkspace.getState().techniqueText).not.toBe("MRI Brain on 3T. Sagittal T1, T2, FLAIR.");
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().techniqueText).toBe("MRI Brain on 3T. Sagittal T1, T2, FLAIR.");
  });
});

describe("a cross-region box is findable by what it says", () => {
  it("five of the seven are cross-region, so the panel's tab pool cannot hold them", () => {
    const cross = TECHNIQUE.filter(({ box }) => !String(box.studyType ?? "").trim());
    expect(cross.map(({ tile }) => tile.label).sort()).toEqual([
      "CT non-contrast", "CT with contrast", "MG standard", "MRI 3T standard", "XR standard",
    ]);
  });

  it("the words that distinguish them appear nowhere the old search looked", () => {
    // The search expression this replaces tested label, tags, findingText and
    // impressionText. For these seven all four are either a two-word name or
    // empty, so a radiologist hunting for a contrast technique got nothing.
    const probes: Array<[string, string]> = [
      ["128-slice", "CT non-contrast"],
      ["contrast-enhanced", "CT with contrast"],
      ["convex transducer", "US abdomen"],
      ["3T scanner", "MRI 3T standard"],
    ];
    const byLabel = new Map(TECHNIQUE.map(({ tile, box }) => [tile.label, box]));
    for (const [needle, label] of probes) {
      const box = byLabel.get(label)!;
      const oldHay = `${box.label} ${box.findingText ?? ""} ${box.impressionText ?? ""}`.toLowerCase();
      expect(oldHay.includes(needle.toLowerCase()), `${label}: the OLD expression already found ${needle}`).toBe(false);
      expect(quickSelectBoxWrittenText(box).toLowerCase(), label).toContain(needle.toLowerCase());
    }
  });

  it("the panel searches the text the box writes, not two of its four columns", () => {
    const panel = read("components/radiology/QuickFindingsPanel.tsx");
    const matcher = /const matchesSearch = \(f: QuickFinding\) =>[\s\S]*?;\n/.exec(panel);
    expect(matcher, "the panel no longer declares matchesSearch — this pin is stale").not.toBeNull();
    expect(matcher![0]).toContain("quickSelectBoxWrittenText(f)");
    // Not a substring hunt for a word: the two columns that made it miss must be
    // gone from the matcher, or the widening is decoration.
    expect(matcher![0]).not.toContain("f.findingText.toLowerCase()");
    expect(matcher![0]).not.toContain("f.impressionText.toLowerCase()");
  });
});

describe("the Technique section mounts the strip (source contract)", () => {
  const canvas = read("components/radiology/workspace/ReportCanvas.tsx");

  it("renders a technique strip inside the technique accordion section", () => {
    const section = /\{\/\* 5\. TECHNIQUE[\s\S]*?<\/ReportAccordionSection>/.exec(canvas);
    expect(section, "the TECHNIQUE section is no longer where it was — re-read this").not.toBeNull();
    expect(section![0]).toMatch(/<QuickSelectStrip\s+field="technique"/);
  });

  it("routes a parameterised box like the other strips do", () => {
    // `quickSelectStripStructuredRouting` walks every <QuickSelectStrip> for
    // exactly this. Written out here too because a section added without it is
    // the one way this mount could print an unresolved {token} into Technique.
    const el = /<QuickSelectStrip\s+field="technique"[\s\S]*?\/>/.exec(canvas);
    expect(el).not.toBeNull();
    expect(el![0]).toContain("onToggle={handleQuickToggle}");
    expect(el![0]).toMatch(/onStructuredPick=\{\(b\) =>\s*studySetup\.handleFindingClick\(b, selectedQuickIds, handleQuickToggle\)\s*\}/);
    expect(el![0]).toContain("disabled={contentLocked}");
    expect(el![0]).toContain('bodyPart={studySetup.matchedStudyRegion}');
  });

  it("keeps the history ban that this PR deliberately does not break", () => {
    expect(canvas).not.toMatch(/<QuickSelectStrip\s+field="clinicalHistory"/);
  });
});

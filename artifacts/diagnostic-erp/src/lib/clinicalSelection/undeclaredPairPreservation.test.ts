import { describe, expect, it } from "vitest";
import { useWorkspace } from "../zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "../zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "../zai-workspace/quickSelectTilePayload";
import { buildReportingStudyContext } from "../reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "../reportFieldMerge";

/**
 * Stage C Phase 5 · the undeclared pair must print both findings and evict neither.
 *
 * This is the runtime half of the sentence the catalogue contract already wrote down and skipped:
 * `lib/db/src/schema/clinicalSelectionContract.db.test.ts:523` — "prints both members of an undeclared
 * pair and evicts neither, in either click order". A schema cannot answer it, so the answer is a
 * report.
 *
 * MEASURED, not assumed. The census over every undeclared MRI Brain abnormal pair (distinct concept
 * AND distinct conflict group, no declared relationship) found 117 pairs, 4 that split by click order
 * and 4 that lose a finding — and instrumentation across both click orders shows the same shape in
 * every one of them: **the ledger row stays `live` and the sentence leaves Findings.** So this is not
 * slot mutex (`observationsMutuallyExclusive` needs an identical concept, which these pairs do not
 * have) and it is not the same-slot replacement plan. It is the narrative/ownership layer:
 * `conceptsAssertedIn` (`observationSlot.ts:436`) reads a sentence as asserting *every* concept it
 * mentions, so "Acute intraparenchymal hemorrhage … with midline shift of 6 mm" asserts a midline
 * abnormality and then retires the sentence belonging to another selected tile —
 * "No midline shift is seen." — as if it were a normal the new abnormality contradicts.
 *
 * The clinically significant case is the third pair, where the text that disappears is not a normal at
 * all but the finding itself: "Heterogeneously enhancing area in the right frontal operculum at the
 * post-resection cavity … suggestive of edema" is deleted from a report that still carries the row,
 * because the Cerebral edema tile mentions edema. A row that is on the ledger and absent from the page
 * is a finding the radiologist believes they reported.
 *
 * The assertions below are the REQUIRED end state. They are written as `it.fails` so they are executed
 * and enforced today — not skipped, not deleted — and each becomes `it(...)` the moment the composition
 * layer stops treating another observation's words as a normal to retire. The paired `it(...)` blocks
 * pin what is already true (the row survives), which is the half of the diagnosis that stays fixed
 * whichever way the fix goes.
 *
 * The baselines are **synthetic by design**: the Stage B catalogue ships examination rows only, so
 * there is no approved publication to bind to and nothing here claims to be one.
 */

type Tile = (typeof TILES)[number];

function tile(label: string): Tile {
  const found = (TILES as unknown as Tile[]).find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

const BASELINE = [
  "Cerebral hemispheres demonstrate normal signal intensity.",
  "Ventricular system and cisternal spaces are normal in size and configuration.",
  "No midline shift is seen.",
  "No acute intracranial hemorrhage is identified.",
].join("\n");

function reset(): void {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null, voiceComposerObservations: [],
    startingCanvasBaseline: {
      formatName: "Synthetic MRI Brain — Normal",
      formatRevision: null,
      findings: BASELINE,
      impression: "Synthetic normal brain.",
      appliedAt: "2026-10-16T00:00:00.000Z",
    },
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain Plain",
      regions: ["Brain"], source: "auto",
    }),
  });
  useWorkspace.getState().setField("findings", BASELINE, {
    source: "template", replaceProvenance: true,
  });
}

function select(...tiles: Tile[]): void {
  for (const t of tiles) {
    const outcome = useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
    if (outcome === "refused") throw new Error(`selection refused for ${t.label}`);
  }
}

/** Every sentence of the field, keyed the way the ledger keys everything. */
function field(): string[] {
  return splitToSentences(useWorkspace.getState().findingsText).map(normalizeForDedupe).filter(Boolean);
}

/** A tile's contribution is several sentences, so it is "on the page" only when all of them are. */
function holds(t: Tile, sentences = field()): boolean {
  const own = splitToSentences(t.sentence).map(normalizeForDedupe).filter(Boolean);
  return own.length > 0 && own.every((s) => sentences.includes(s));
}

function rowOf(t: Tile) {
  return useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === `qs-${t.id}`) ?? null;
}

/** The four pairs the census measured. Nothing is chosen to pass. */
const PAIRS: Array<[Tile, Tile]> = [
  [tile("Hydrocephalus"), tile("Acute ICH")],
  [tile("Hydrocephalus"), tile("SDH")],
  [tile("Glioma recurrence"), tile("Cerebral edema")],
  [tile("Acute infarct (CT)"), tile("Stroke team")],
];

describe("Stage C Phase 5 · an undeclared pair coexists", () => {
  it("holds the measured premise: these pairs are unrelated by concept and by conflict group", () => {
    for (const [a, b] of PAIRS) {
      expect(a.concept, `${a.label} and ${b.label} must not share a concept`);
      expect(a.concept).not.toBe(b.concept);
      expect(a.conflictGroup).not.toBe(b.conflictGroup);
    }
    expect(PAIRS).toHaveLength(4);
  });

  for (const [a, b] of PAIRS) {
    const name = `${a.label} + ${b.label}`;

    it(`MECHANISM, today: ${name} keeps both rows on the ledger`, () => {
      // Pinned as a passing test, because it is the half of the diagnosis that must not change: if a
      // future fix made this fail, the loss would have moved from the narrative layer to the ledger,
      // and the whole investigation would need repeating. Supersession would be the wrong remedy.
      reset();
      select(a, b);
      expect(rowOf(a), "the first row must still be on the ledger").not.toBeNull();
      expect(rowOf(b), "the second row must still be on the ledger").not.toBeNull();
      expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(2);
      reset();
      select(b, a);
      expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(2);
    });

    it.fails(`REQUIRED: ${name} prints both findings, whichever is clicked first`, () => {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        reset();
        select(x, y);
        expect(holds(x), `${x.label} is selected, so its own words must be on the page`)
          .toBe(true);
        expect(holds(y), `${y.label} is selected, so its own words must be on the page`)
          .toBe(true);
      }
    });

    it.fails(`REQUIRED: ${name} yields one report, not two depending on the mouse`, () => {
      reset();
      select(a, b);
      const forward = field().slice().sort();
      reset();
      select(b, a);
      expect(field().slice().sort(), `click order changed which sentences exist in ${name}`)
        .toEqual(forward);
    });
  }

  it.fails("REQUIRED: a selected tile's sentence is never a normal for another tile to retire", () => {
    // The clinical statement, in one case. Glioma recurrence is a post-resection enhancing mass; the
    // cerebral edema tile does not make it less true. Losing that sentence is losing a finding.
    reset();
    select(tile("Glioma recurrence"));
    expect(holds(tile("Glioma recurrence")), "the finding is on the page before the second click")
      .toBe(true);
    select(tile("Cerebral edema"));
    expect(holds(tile("Glioma recurrence")),
      "a compatible abnormality was added, so the first finding must still be printed").toBe(true);
    expect(holds(tile("Cerebral edema"))).toBe(true);
  });

  it("leaves the radiologist's own words alone through the same pair", () => {
    // This half already works, and it must keep working: the fix may not reach manual text with the
    // same authority it reaches a tile's contribution.
    reset();
    const MANUAL = "The patient declined contrast; the study is non-contrast only.";
    useWorkspace.getState().setField("findings", `${BASELINE}\n${MANUAL}`, {
      source: "manual", replaceProvenance: true,
    });
    select(tile("Glioma recurrence"), tile("Cerebral edema"));
    expect(field()).toContain(normalizeForDedupe(MANUAL));
  });

  it("restores the whole baseline once both tiles are deselected", () => {
    // Deselection is the other half of the contract already discharged by the shared-normal work;
    // asserted here so a Phase 5 fix cannot regress it while touching the composition layer.
    reset();
    const [a, b] = PAIRS[2];
    select(a, b);
    useWorkspace.getState().removeObservation(`qs-${b.id}`);
    useWorkspace.getState().removeObservation(`qs-${a.id}`);
    for (const sentence of splitToSentences(BASELINE).map(normalizeForDedupe)) {
      expect(field(), `${sentence} should be back with nothing selected`).toContain(sentence);
    }
  });
});

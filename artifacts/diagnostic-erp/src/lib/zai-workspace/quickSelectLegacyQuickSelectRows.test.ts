/**
 * Drafts and signed reports written before this catalogue keep Quick Select rows
 * whose id is `qs-…` and whose `source` is `quick-select`. Those rows were made by
 * the strip this branch removed; the strip is gone, the rows are not.
 *
 * What that has to mean, measured rather than assumed: the row stays visible, its
 * clinical wording and its section do not move, a second click of the box it came
 * from does not print the same sentence twice, and the row can still be withdrawn
 * by its exact id. Nothing here rewrites stored data — a legacy tile id was minted
 * with `Math.random()` at module load (`quick-select-tiles.data.ts` in `e6f508da`),
 * so it names no database box, and mapping it by label would be guessing at a
 * radiologist's document. There is therefore no migration in this PR, and none
 * should be added: these tests are the reason it is safe.
 *
 * The legacy payloads below are not re-imported from the deleted builder — that
 * code is gone and a test that resurrects it ratchets the past. They are the shape
 * it sent (verbatim from `e6f508da`) fed through the production overlay, so the row
 * under test is one the real engine wrote and the reader under test is the one the
 * app uses.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildReportingStudyContext } from "../reportingStudyContext";
import { selectedQuickFindingIds } from "../observationSlot";
import { useWorkspace, type PendingPathologyPatch } from "./store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./quick-select-tiles.data";
import { clinicalBoxForTile } from "./quickSelectTileFixture";
import {
  quickFindingClickRoute,
  quickFindingCrossSectionClash,
  quickFindingPatch,
} from "./quickSelectTilePayload";
import type { QuickSelectTile } from "./types";

/**
 * The id the deleted strip gave a tile. `quick-select-tiles.data.ts` minted these with
 * Math.random() at module load, so they differ every browser and every import —
 * which is exactly why a legacy row cannot be mapped onto a database box, and why
 * these tests read the id off the tile rather than spelling it.
 */
const qsId = (t: QuickSelectTile, side = "") => (side ? `qs-${t.id}:${side}` : `qs-${t.id}`);

function findTile(label: string): QuickSelectTile {
  const t = TILES.find((x) => x.label === label);
  expect(t, `the catalogue no longer ships ${label}`).toBeTruthy();
  return t as QuickSelectTile;
}

/**
 * The payload the deleted tile strip sent. Its one branch is the point of the
 * whole file: a findings box wrote three sections, and EVERY other box — the
 * advice boxes, the technique boxes, the history boxes — wrote its sentence into
 * Impression and nothing else. `quickFindingPatch` files each sentence in its own
 * section, which is the correction; what it means for a draft already holding the
 * old filing is what these tests measure.
 */
function legacyPatch(box: QuickSelectTile, side = ""): PendingPathologyPatch {
  const templates = box.field === "findings"
    ? {
      findings: box.sentence,
      impression: box.impressionSentence,
      recommendation: box.recommendationSentence,
    }
    : { impression: box.sentence };
  return {
    incoming: templates,
    templates,
    ownership: {
      anatomicalSection: box.anatomicalSection || undefined,
      conflictGroup: box.conflictGroup || undefined,
      baselineReplaces: box.baselineReplaces,
      concept: box.concept,
    },
    source: "quick-select",
    id: qsId(box, side),
    region: box.scopeBodyPart,
    concept: box.concept,
    label: box.label,
    findingsText: box.sentence,
    supportsLaterality: /\{side\}/i.test(`${box.sentence} ${box.impressionSentence ?? ""}`),
    ...(side ? { side } : {}),
  } as unknown as PendingPathologyPatch;
}

function blankStudy(modality = "MR", region = "Brain"): void {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, patchUndoStack: [],
    patchRedoStack: [], confirmOverwriteOpen: false, pendingPathologyPatch: null,
    appliedFormatReportTitle: null, startingCanvasBaseline: null, isFinalized: false,
    reportingContext: buildReportingStudyContext({
      modality, studyDescription: region, regions: region ? [region] : [], source: "auto",
    }),
  });
}

const body = () => {
  const s = useWorkspace.getState();
  return {
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
    technique: s.techniqueText,
  };
};

/** Write a legacy row, save it, then reopen exactly as `useDraftPersistence` does. */
function saveAndReopen(shipped: QuickSelectTile, side = "") {
  blankStudy(shipped.scopeModality ?? "MR", shipped.scopeBodyPart ?? "Brain");
  const verdict = String(useWorkspace.getState().applyPathologyOverlay(legacyPatch(shipped, side)));
  const written = body();
  const rowsWritten = useWorkspace.getState().appliedPathologyPatches.map((p) => ({
    id: p.id, source: p.source, lastRendered: p.lastRendered,
  }));
  const envelope = useWorkspace.getState().serializeObservationLedger();

  blankStudy(shipped.scopeModality ?? "MR", shipped.scopeBodyPart ?? "Brain");
  useWorkspace.getState().setEditorContent({ ...written, clinicalHistory: "" });
  const hydrate = useWorkspace.getState().hydrateObservationLedger(envelope);
  return { verdict, written, rowsWritten, envelope, hydrate, reopened: body() };
}

const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("a draft that carries qs- Quick Select rows", () => {
  it("reopens with the legacy row, its id, its wording and its section intact", () => {
    const shipped = findTile("Hydrocephalus");
    const r = saveAndReopen(shipped);
    expect(r.verdict, "the legacy payload must reach the ledger").toBe("applied");
    expect(r.hydrate).toMatchObject({ ok: true, mode: "restored", patchCount: 1 });
    const rows = useWorkspace.getState().appliedPathologyPatches;
    expect(rows.map((p) => p.id)).toEqual([qsId(shipped)]);
    expect(rows[0]!.source).toBe("quick-select");
    expect(rows[0]!.stale, "a faithful reopen must not mark the row stale").toBeFalsy();
    expect(r.reopened).toEqual(r.written);
    expect(r.reopened.findings).toContain("consistent with hydrocephalus");
    expect(r.reopened.impression).toContain("Hydrocephalus.");
  });

  it("saves the row back exactly as it was stored, so no migration is needed", () => {
    const shipped = findTile("Hydrocephalus");
    const r = saveAndReopen(shipped);
    const again = useWorkspace.getState().serializeObservationLedger();
    const before = r.envelope.patches[0]!;
    const after = again.patches[0]!;
    // The id is not rewritten to the new space and the row is not dropped: an old
    // draft stays readable whether or not anyone ever saves it again.
    expect(after.id).toBe(before.id);
    expect(after.source).toBe(before.source);
    expect(after.lastRendered).toEqual(before.lastRendered);
    expect(after.observation.slotKey).toEqual(before.observation.slotKey);
    expect(JSON.stringify(again.patches)).toBe(JSON.stringify(r.envelope.patches));
  });

  it("does not print the same sentence twice when the box is clicked again", () => {
    const shipped = findTile("Hydrocephalus");
    const r = saveAndReopen(shipped);
    expect(r.reopened.findings).toBe(r.written.findings);
    const db = clinicalBoxForTile(shipped);
    const route = quickFindingClickRoute(quickFindingPatch(db, { region: db.studyType }));
    expect(route.writesBody, "a findings box must still write the body").toBe(true);
    const verdict = String(useWorkspace.getState().applyPathologyOverlay(
      quickFindingPatch(db, { region: db.studyType }),
    ));
    expect(verdict).toBe("applied");
    const s = useWorkspace.getState();
    const phrase = "The ventricular system is dilated, consistent with hydrocephalus.";
    expect(occurrences(s.findingsText, phrase), s.findingsText).toBe(1);
    expect(occurrences(s.impressionText, "Hydrocephalus."), s.impressionText).toBe(1);
    expect(s.appliedPathologyPatches.map((p) => p.id), "one box, one row").toEqual([qsId(shipped)]);
  });

  it("keeps a sided legacy row and the other side as the two claims they are", () => {
    const shipped = findTile("Midline shift");
    const r = saveAndReopen(shipped, "right");
    expect(r.reopened.findings).toContain("toward the right");
    const db = clinicalBoxForTile(shipped);
    useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(db, { region: db.studyType }, { side: "left" }));
    const s = useWorkspace.getState();
    expect(occurrences(s.findingsText, "toward the right"), s.findingsText).toBe(1);
    expect(occurrences(s.findingsText, "toward the left"), s.findingsText).toBe(1);
    expect(s.appliedPathologyPatches.map((p) => p.id).sort()).toEqual(
      [`qf-${db.id}:left`, qsId(shipped, "right")].sort(),
    );
  });

  it("withdraws a legacy row by its exact id and leaves the rest of the report alone", () => {
    const shipped = findTile("Midline shift");
    const r = saveAndReopen(shipped, "right");
    const db = clinicalBoxForTile(shipped);
    useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(db, { region: db.studyType }, { side: "left" }));
    const before = body();
    const outcome = useWorkspace.getState().removeObservation(qsId(shipped, "right"));
    expect(outcome).toBe("removed");
    const s = useWorkspace.getState();
    expect(s.findingsText).not.toContain("toward the right");
    expect(s.findingsText).toContain("toward the left");
    expect(s.impressionText).toContain("toward left");
    expect(s.appliedPathologyPatches.map((p) => p.id)).toEqual([`qf-${db.id}:left`]);
    expect(before.findings).toContain("toward the right");
  });

  it("cannot deselect a legacy row from the catalogue, and does not pretend to", () => {
    // Pinned deliberately: `qf-` is the id space the new surfaces write, so a
    // `qs-` row reads as unselected. The alternative — lighting a chip for a row
    // nothing can control — would let a click look like a withdrawal that changed
    // nothing. What a legacy row CAN do is shown by the test above: it is
    // withdrawable by its exact id, and its wording is editable in the section it
    // sits in.
    expect(selectedQuickFindingIds(["qs-qs_abc123", "qs-qs_abc123:right", "qf-2:left", "system-normal-study"]))
      .toEqual([2]);
  });
});

describe("the cross-section copy the cutover can cause", () => {
  /**
   * An advice box used to write Impression; `quickFindingPatch` files it in
   * Recommendation, which is the correction this PR makes. On a draft that
   * already carries the advice in Impression from a `qs-` row, the corrected click
   * would print the same sentence a second time, in a different section — so the
   * click path refuses it. Measured here in both directions: what the overlay
   * would have done, and what the guard stops.
   */
  const advice = () => findTile("Clinical correlation");

  it("would have written the wording a second time, in another section", () => {
    const shipped = advice();
    saveAndReopen(shipped);
    const db = clinicalBoxForTile(shipped);
    useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(db, { region: db.studyType }));
    const s = useWorkspace.getState();
    const sentence = "Clinical correlation advised.";
    expect(s.impressionText).toContain(sentence);
    expect(s.recommendationText).toContain(sentence);
    expect(occurrences(`${s.impressionText}\n${s.recommendationText}`, sentence))
      .toBe(2);
  });

  it("names the section the wording already sits in", () => {
    const shipped = advice();
    saveAndReopen(shipped);
    const db = clinicalBoxForTile(shipped);
    const patch = quickFindingPatch(db, { region: db.studyType });
    const clash = quickFindingCrossSectionClash(useWorkspace.getState().appliedPathologyPatches, patch);
    expect(clash, "the legacy Impression copy must be detected").toEqual({
      section: "impression",
      sentence: "clinical correlation advised",
    });
  });

  it("reports no clash for a box the legacy row does not already cover", () => {
    const hydro = findTile("Hydrocephalus");
    saveAndReopen(hydro);
    const db = clinicalBoxForTile(hydro);
    const patch = quickFindingPatch(db, { region: db.studyType });
    // Same box, same section: the engine's own re-click rule handles that (see the
    // duplicate test above), so the guard must not fire and refuse a real click.
    expect(quickFindingCrossSectionClash(useWorkspace.getState().appliedPathologyPatches, patch)).toBeNull();

    // A different box whose wording is nowhere else must be free to click.
    const other = clinicalBoxForTile(findTile("Cerebral atrophy"));
    expect(quickFindingCrossSectionClash(
      useWorkspace.getState().appliedPathologyPatches,
      quickFindingPatch(other, { region: other.studyType }),
    )).toBeNull();
  });

  it("consults only the strip's own legacy rows, never a live one", () => {
    const shipped = advice();
    blankStudy();
    const db = clinicalBoxForTile(shipped);
    useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(db, { region: db.studyType }));
    const rows = useWorkspace.getState().appliedPathologyPatches;
    expect(rows[0]!.source).toBe("quick-findings");
    // The same box clicked again is a live row this very box owns: the guard has no
    // business refusing it.
    expect(quickFindingCrossSectionClash(rows, quickFindingPatch(db, { region: db.studyType }))).toBeNull();

    // A live row that carries the same wording in a DIFFERENT section is not this
    // guard's case either. It covers the cutover only: a row written by a writer
    // that no longer exists, which no control in the app can click off. Everything
    // the report owns today stays the engine's business, because refusing a real
    // click a radiologist meant is worse than the repeat it would have prevented.
    const asLive = [{
      id: rows[0]!.id,
      source: "quick-findings" as const,
      lastRendered: { impression: rows[0]!.lastRendered.recommendation },
    }];
    expect(quickFindingCrossSectionClash(asLive, quickFindingPatch(db, { region: db.studyType })))
      .toBeNull();
    // The same row stamped as the strip's own is caught, which is what makes the
    // line above a scope test rather than an accident of the data.
    expect(quickFindingCrossSectionClash(
      [{ ...asLive[0]!, source: "quick-select" as const }],
      quickFindingPatch(db, { region: db.studyType }),
    )).toEqual({ section: "impression", sentence: "clinical correlation advised" });
  });

  it("the click path refuses the copy before the overlay writes it", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..",
        "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const start = source.indexOf("const handleQuickToggle = useCallback");
    expect(start).toBeGreaterThan(-1);
    const toggle = source.slice(start, source.indexOf("\n  }, [", start));
    expect(toggle).toContain("quickFindingCrossSectionClash");
    expect(toggle, "the guard must be live, not short-circuited").toMatch(/if \(clash\) \{/);
    expect(
      toggle.indexOf("quickFindingCrossSectionClash"),
      "the guard must run before the overlay it is protecting",
    ).toBeLessThan(toggle.indexOf("applyPathologyOverlay(patch)"));
  });
});

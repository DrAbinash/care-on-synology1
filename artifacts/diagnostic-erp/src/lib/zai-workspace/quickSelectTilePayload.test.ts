/**
 * One Quick Select box, one coherent report.
 *
 * The owner's workflow is: the Normal format opens, he reads the images, he
 * clicks one box, he prints. For that to be safe the box has to finish the whole
 * report — the sentence in Findings, the line in Impression, and the advice in
 * Recommendation — and undo all three when he clicks it off again. Recommendation
 * was silently dropped by the button even though the engine and the database
 * column both supported it, so a herniation could print with "Normal MRI
 * lumbo-sacral spine" advice underneath it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  quickFindingPatch,
  quickFindingRowBelongsTo,
  quickFindingRowId,
} from "./quickSelectTilePayload";
import { quickSelectTilePatch } from "./quickSelectTileFixture";
import { splitToSentences } from "../reportFieldMerge";
import { selectedQuickFindingIds } from "@/lib/observationSlot";
import { DEFAULT_QUICK_SELECT_TILES, lookupTilesForContext } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_LS_SPINE_STANDARD_NORMAL_NAME } from "./fullReportBaseline";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "./store";
import type { QuickSelectTile } from "./types";

function tile(label: string): QuickSelectTile {
  const found = (DEFAULT_QUICK_SELECT_TILES as unknown as QuickSelectTile[]).find(
    (t) => t.label === label,
  );
  if (!found) throw new Error(`Quick Select tile "${label}" is missing from the catalog`);
  return found;
}

const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME)!;

function resetWorkspace() {
  // Opening a format reports its use; this suite is about the report, not the hit.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
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
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    startingCanvasBaseline: null,
    appliedFormatName: null,
    appliedFormatReportTitle: null,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    isFinalized: false,
  });
  // The Normal report is opened the way the workspace opens it, so the sections
  // carry the provenance the engine needs to know it may rewrite them.
  useWorkspace.getState().applyFormatById(LS_NORMAL.id);
}

describe("one click on a normal report", () => {
  beforeEach(resetWorkspace);

  it("finishes the report: findings, impression and recommendation together", () => {
    const tileData = tile("Disc herniation L4-L5");
    const status = useWorkspace.getState().applyPathologyOverlay(
      quickSelectTilePatch(tileData, "findings"),
    );
    expect(status).toBe("applied");
    const s = useWorkspace.getState();

    expect(s.findingsText).toContain("Broad-based disc bulge at L4-L5");
    expect(s.impressionText).toContain("Disc herniation at L4-L5");
    // Sentence-level, because a substring on the first half of the normal proves
    // nothing: withdrawing only "Normal MRI of the lumbosacral spine." would keep
    // this test green while the report still told the referring clinician there
    // was no compressive abnormality at all. Measured with that half-withdrawal
    // installed on purpose: this block fails and `not.toContain("Normal MRI")`
    // passed.
    const remaining = splitToSentences(s.impressionText);
    for (const normalSentence of splitToSentences(LS_NORMAL.impression)) {
      expect(remaining, `the normal's "${normalSentence}" survived the click`).not.toContain(
        normalSentence,
      );
    }
    expect(remaining).toEqual([String(tile("Disc herniation L4-L5").impressionSentence)]);
    expect(s.recommendationText).toContain(
      "Conservative management with NSAIDs and physiotherapy",
    );
  });

  it("puts the advice back the way it was when the box is clicked off", () => {
    const tileData = tile("Disc herniation L4-L5");
    const id = quickSelectTilePatch(tileData, "findings").id!;
    useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(tileData, "findings"));
    expect(useWorkspace.getState().recommendationText).not.toBe(LS_NORMAL.recommendation);

    useWorkspace.getState().removeObservation(id);
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("No significant disc bulge or protrusion");
    expect(s.impressionText).toBe(LS_NORMAL.impression);
    expect(s.recommendationText).toBe(LS_NORMAL.recommendation);
  });

  it("says the advice once, not once per click", () => {
    const patch = quickSelectTilePatch(tile("Disc herniation L4-L5"), "findings");
    useWorkspace.getState().applyPathologyOverlay(patch);
    useWorkspace.getState().applyPathologyOverlay({ ...patch, id: `${patch.id}-again` });
    const text = useWorkspace.getState().recommendationText;
    const hits = text.split("Conservative management with NSAIDs").length - 1;
    expect(hits).toBe(1);
  });

  it("leaves a section the box has no wording for exactly as the report had it", () => {
    // Every box row carries all four text columns, so three of them are routinely
    // empty. Empty has to mean "this box says nothing here" and not "write an
    // empty sentence": the difference is whether opening a Normal report and
    // clicking one box strips the Technique and the advice the format brought.
    const bare = tile("Normal LS spine");
    expect(bare.recommendationSentence ?? "", "the catalogue box this pins").toBe("");
    const before = useWorkspace.getState();
    expect(before.techniqueText.trim()).not.toBe("");
    expect(useWorkspace.getState().applyPathologyOverlay(
      quickSelectTilePatch(bare, "findings"),
    )).toBe("applied");
    const after = useWorkspace.getState();
    expect(after.techniqueText).toBe(before.techniqueText);
    expect(after.recommendationText).toBe(before.recommendationText);
  });
});

describe("boxes reachable on the study being read", () => {
  const ctxFor = (region: string) => buildReportingStudyContext({
    modality: "MR", studyDescription: `MRI ${region}`, regions: [region], source: "auto",
  });
  const labels = (region: string) => lookupTilesForContext(
    DEFAULT_QUICK_SELECT_TILES, "findings", "MR", ctxFor(region),
  ).map((t) => t.label);

  it("opens up on a Whole Spine screening study, which is three examinations", () => {
    const shown = labels("Whole Spine");
    expect(shown, "measured empty before this fix").toContain("Disc herniation L4-L5");
    expect(shown).toContain("Loss of cervical lordosis");
  });

  it("does not widen a single-segment study", () => {
    const shown = labels("LS Spine");
    expect(shown).toContain("Disc herniation L4-L5");
    expect(shown).not.toContain("Loss of cervical lordosis");
  });

  it("keeps a lumbar box owned by the lumbar region when a whole-spine study clicks it", () => {
    const patch = quickSelectTilePatch(tile("Disc herniation L4-L5"), "findings");
    expect(patch.region).toBe("LS Spine");
  });
});

describe("a box the radiologist authors himself", () => {
  it("keeps the advice he typed and puts it in the report", () => {
    // Authoring goes through the API into radiology_quick_findings now, so the box
    // arrives in the shape the API returns rather than from a save handler in the
    // store. The property is the one that mattered then: his own advice reaches
    // Recommendation, one sentence per line, underneath the format's own — and a
    // section he left blank is not a section the box is allowed to empty.
    resetWorkspace();
    const techniqueBefore = useWorkspace.getState().techniqueText;
    expect(techniqueBefore.trim(), "the Normal format opens with a technique").not.toBe("");

    const advice = "Refer to the spine surgeon. Repeat MRI at 6 weeks.";
    const mine = {
      id: 9001,
      label: "My own herniation box",
      studyType: "LS Spine",
      findingText: "Large right paracentral disc extrusion at L5-S1 compressing the S1 root.",
      impressionText: "Disc extrusion at L5-S1 with S1 root compression.",
      techniqueText: "",
      recommendationText: advice,
    };
    expect(useWorkspace.getState().applyPathologyOverlay(
      quickFindingPatch(mine, { region: "LS Spine" }),
    )).toBe("applied");

    const s = useWorkspace.getState();
    expect(s.recommendationText.split("\n")).toEqual([
      "Clinical correlation.",
      "Refer to the spine surgeon.",
      "Repeat MRI at 6 weeks.",
    ]);
    expect(s.techniqueText).toBe(techniqueBefore);
  });
});

describe("editing a shipped box keeps what it carries", () => {
  // Checked out with CRLF on this repo, so normalise before slicing: an anchor
  // that does not match silently slices to "" and every assertion below it passes.
  const editorCode = readFileSync(
    fileURLToPath(new URL(
      "../../components/radiology/WorkspaceQuickFindingEditor.tsx",
      import.meta.url,
    )),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("saves every sentence the box was seeded with, not only the ones with an input", () => {
    // Renaming a box used to delete the sentence it wrote into the Impression,
    // because the save payload only carried the fields the form had an input for.
    // The payload is built from the draft, so all four columns have to travel even
    // when the radiologist touched only the label.
    const body = editorCode.slice(
      editorCode.indexOf("const body = {"),
      editorCode.indexOf("if (!body.studyType"),
    );
    expect(body.length).toBeGreaterThan(0);
    for (const column of ["findingText", "impressionText", "techniqueText", "recommendationText"]) {
      expect(body, `${column} must be in the save body`).toMatch(
        new RegExp(`${column}:\\s*draft\\.${column}`),
      );
    }
    // Positive control: the scanner sees a column sent from the draft…
    expect("findingText: draft.findingText").toMatch(/findingText:\s*draft\.findingText/);
    // …and not one it blanks or reads off something else.
    expect("findingText: finding?.findingText ?? ''").not.toMatch(/findingText:\s*draft\.findingText/);
    expect("techniqueText: ''").not.toMatch(/techniqueText:\s*draft\.techniqueText/);
  });

  it("seeds the draft from all four columns of the row being edited", () => {
    // The other half of the same contract: a column the draft never read is a
    // column the save then blanks, whichever way the body is written.
    const seeded = editorCode.slice(
      editorCode.indexOf("return {\n    id: f.id,"),
      editorCode.indexOf("anatomicalSection: f.anatomicalSection"),
    );
    expect(seeded.length).toBeGreaterThan(0);
    for (const column of ["findingText", "impressionText", "techniqueText", "recommendationText"]) {
      expect(seeded, `${column} must seed the draft`).toContain(`${column}: f.${column}`);
    }
  });

  it("keeps advice on the boxes the clinic relies on for a one-click report", () => {
    // "Loss of cervical lordosis" left this list in the final corrections round
    // (PR #1077): the owner's neutral-wording ruling retired its routine
    // NSAIDs/physiotherapy advice — the Recommendation field stays the doctor's
    // to write — exactly as the lumbar tile's advice was retired by the
    // 2026-10-19 ruling before it.
    for (const label of [
      "Acute infarct (DWI)",
      "Fazekas 1",
      "Fazekas 2",
      "Glioma recurrence",
      "Hydrocephalus",
      "Disc herniation L4-L5",
      "Grade 1 spondylolisthesis L4-L5",
      "Compression fracture L1",
    ]) {
      expect(tile(label).recommendationSentence, label).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The builder itself, over the shapes the API actually returns.
//
// Two callers used to build the overlay for one box click: the strip with
// `quickSelectTilePatch` over a localStorage tile, and the panel's list inline
// inside `handleQuickToggle`. The inline copy carried less — no concept, no
// severity, no declared laterality, and one ledger row id for both sides — so a
// box clicked from the database was not clinically equal to the same box clicked
// from the strip. `quickFindingPatch` is now the only builder and every surface
// calls it. The describes above this line still drive the shipped catalogue, but
// through `quickSelectTileFixture`, so the payload they assert on is the one a
// real click sends.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A box exactly as the API returns it — every column, camelCase. The two
 * fixtures below are not invented: Hydrocephalus and Midline shift are boxes a
 * real clinic already has, and ADOPTED_HYDRO is the state a deploy measurably
 * leaves such a row in (migration-bootstrap-smoke §5) — the clinic's own
 * sentence, stamped customized, and no concept, conflict group, baseline or
 * category at all.
 */
function dbBox(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    studyType: "Brain",
    studyTabId: null,
    label: "Box",
    field: "findings",
    sonKind: "",
    parentId: null,
    mnemonic: "",
    concept: "",
    scopeModality: "",
    category: null,
    anatomicalSection: "",
    conflictGroup: "",
    baselineReplaces: "",
    icdCode: null,
    tags: "",
    suggests: "",
    properties: "",
    questionsJson: "[]",
    findingText: "",
    impressionText: "",
    techniqueText: "",
    recommendationText: "",
    sortOrder: 100,
    isActive: true,
    ...over,
  };
}

/** What the factory ships for Midline shift, and the clinic row a deploy adopts. */
const FACTORY_MIDLINE = dbBox({
  id: 96, label: "Midline shift", concept: "midline", scopeModality: "MR", mnemonic: "mls",
  category: "critical", conflictGroup: "midline shift", properties: "side",
  baselineReplaces: "No midline shift is seen.",
  findingText: "Midline shift of ___ mm toward the {side}.",
  impressionText: "Midline shift toward {side}.",
  recommendationText: "Clinical correlation.",
});
const ADOPTED_HYDRO = dbBox({
  id: 12, label: "Hydrocephalus", anatomicalSection: "Ventricles & CSF Spaces",
  findingText: "Dilatation of the ventricular system out of proportion to the sulci, suggestive of hydrocephalus.",
  impressionText: "Hydrocephalus.",
});

describe("the payload one database box click sends", () => {
  it("carries the concept into the observation, not only the wording", () => {
    // The single field whose absence made the two callers unequal. The engine
    // reads ownership.concept (pathologyPatch.ts:353) and feeds it to
    // resolveConcept as the explicit tier, so without it a box that names its
    // own concept falls back to guessing one from its sentence — and for
    // Midline shift there is no CONCEPT_HINTS rule, so it guesses nothing.
    const patch = quickFindingPatch(FACTORY_MIDLINE, { region: "Brain" }, { side: "right" });
    expect(patch.ownership.concept).toBe("midline");
    // The top-level field is what the tile path has always set. The two must not
    // drift, or a reader of one gets a concept the other never had.
    expect(patch.concept).toBe("midline");
  });

  it("writes every sentence a database box can carry, technique included", () => {
    // A database box has four text columns; a strip tile has three. Dropping
    // technique would regress against the panel path this replaces, which has
    // always sent it.
    const box = dbBox({
      findingText: "F.", impressionText: "I.", techniqueText: "T.", recommendationText: "R.",
    });
    const patch = quickFindingPatch(box, { region: "Brain" });
    expect(patch.incoming).toEqual({
      findings: "F.", impression: "I.", technique: "T.", recommendation: "R.",
    });
    // incoming and templates are the same shape for a box click: there is no
    // separate display wording, and a divergence between them is how a deselect
    // comes to remove something other than what was inserted.
    expect(patch.templates).toEqual(patch.incoming);
  });

  it("declares laterality when {side} appears only in the impression", () => {
    // A box whose side shows up only in the Impression still owns two sides, and
    // without the flag the engine treats Left and Right as one observation, so
    // the second click replaces the first.
    const box = dbBox({
      findingText: "The disc bulges.", impressionText: "Disc bulge to the {side}.",
    });
    expect(quickFindingPatch(box, { region: "LS Spine" }, { side: "left" }).supportsLaterality).toBe(true);
  });

  it("declares laterality when {side} appears only in the findings", () => {
    const box = dbBox({
      findingText: "{side} foraminal stenosis.", impressionText: "Foraminal stenosis.",
    });
    expect(quickFindingPatch(box, { region: "LS Spine" }, { side: "left" }).supportsLaterality).toBe(true);
  });

  it("declares laterality when {side} appears only in the recommendation", () => {
    const box = dbBox({
      findingText: "Canal stenosis.", recommendationText: "Follow up the {side} side.",
    });
    expect(quickFindingPatch(box, { region: "LS Spine" }, { side: "left" }).supportsLaterality).toBe(true);
  });

  it("does not declare laterality for a box that never asks for a side", () => {
    const patch = quickFindingPatch(ADOPTED_HYDRO, { region: "Brain" });
    expect(patch.supportsLaterality).toBe(false);
    expect(patch.side, "no side is invented for a box that does not ask for one").toBeUndefined();
  });

  it("carries the severity the radiologist chose", () => {
    const box = dbBox({ properties: "severity", findingText: "{severity} canal stenosis." });
    expect(quickFindingPatch(box, { region: "LS Spine" }, { severity: "severe" }).severity).toBe("severe");
    expect(quickFindingPatch(box, { region: "LS Spine" }).severity).toBeUndefined();
  });

  it("keeps the routing fields the panel path already sent", () => {
    // studyType routes multi-study sub-sections and catalogId ties the ledger
    // row back to the box. Losing either is a regression this change must not
    // introduce while fixing the four fields above.
    const patch = quickFindingPatch(
      FACTORY_MIDLINE, { region: "Brain", studyType: "Brain" }, { side: "right" },
    );
    expect(patch.studyType).toBe("Brain");
    expect(patch.catalogId).toBe(96);
    expect(patch.properties).toBe("side");
    expect(patch.source).toBe("quick-findings");
    expect(patch.label).toBe("Midline shift");
    // The box asks for a side and never for a millimetre figure, so the door drops
    // "of ___ mm" from what it writes. This field is the text the ledger row keeps —
    // a reopened study re-applies ledger rows, so a raw blank stored here would come
    // back after the report had been saved and closed. catalogId 96 is what ties the
    // row to the box; the catalogue column itself stays untouched.
    expect(patch.findingsText).toBe("Midline shift toward the {side}.");
  });

  it("sends the region the study decided, not the box's own study_type", () => {
    // handleQuickToggle resolves studySetup.matchedStudyRegion first. A
    // cross-region box has study_type '' and must still land in the region the
    // radiologist is actually reporting.
    const regionless = dbBox({
      studyType: "", label: "Clinical correlation", findingText: "Clinical correlation.",
    });
    expect(quickFindingPatch(regionless, { region: "LS Spine" }).region).toBe("LS Spine");
  });

  it("treats an empty ownership column as no ownership", () => {
    const patch = quickFindingPatch(ADOPTED_HYDRO, { region: "Brain" });
    expect(patch.ownership.anatomicalSection).toBe("Ventricles & CSF Spaces");
    expect(patch.ownership.conflictGroup, "an empty string is not a conflict group").toBeUndefined();
    // The load-bearing one: an empty baselineReplaces must never be handed to the
    // engine as a sentence to retire, or a concept-less box silently suppresses
    // whatever normal happens to be on the page.
    expect(patch.ownership.baselineReplaces, "an empty string must not retire a normal").toBeUndefined();
  });
});

describe("the ledger row one database box owns", () => {
  it("gives each chosen side its own row, and no side the id it has always had", () => {
    expect(quickFindingRowId(12)).toBe("qf-12");
    expect(quickFindingRowId(12, "")).toBe("qf-12");
    expect(quickFindingRowId(12, "left")).toBe("qf-12:left");
    expect(quickFindingRowId(12, "Right")).toBe("qf-12:right");
    const left = quickFindingPatch(FACTORY_MIDLINE, { region: "Brain" }, { side: "left" });
    const right = quickFindingPatch(FACTORY_MIDLINE, { region: "Brain" }, { side: "right" });
    expect(left.id).not.toBe(right.id);
    // Every existing deselect caller passes the plain id; a box that asks for no
    // side must keep it, or clicking it off stops finding its own row.
    expect(quickFindingPatch(ADOPTED_HYDRO, { region: "Brain" }).id).toBe("qf-12");
  });

  it("finds every row one box wrote, and only that box's", () => {
    expect(quickFindingRowBelongsTo("qf-12", 12)).toBe(true);
    expect(quickFindingRowBelongsTo("qf-12:left", 12)).toBe(true);
    expect(quickFindingRowBelongsTo("qf-123:left", 12)).toBe(false);
    expect(quickFindingRowBelongsTo("qf-12:left", 13)).toBe(false);
    expect(quickFindingRowBelongsTo("qs-12:left", 12), "a strip tile row is not this box").toBe(false);
  });

  it("writes an id the selection parser can read back", () => {
    // The contract that silently breaks the chip. selectedQuickFindingIds parsed
    // /^qf-(\d+)$/ — an exact shape with no side — so the moment a row id gained
    // ":left" every box would stop reading as selected while its sentence stayed
    // on the page. Neither half of this pair is testable on its own.
    const ids = [
      quickFindingPatch(FACTORY_MIDLINE, { region: "Brain" }, { side: "left" }).id!,
      quickFindingPatch(FACTORY_MIDLINE, { region: "Brain" }, { side: "right" }).id!,
      quickFindingPatch(ADOPTED_HYDRO, { region: "Brain" }).id!,
    ];
    expect(selectedQuickFindingIds(ids)).toEqual([96, 96, 12]);
    // Both sides of one box keep it lit; the Set the chip reads dedupes.
    expect(new Set(selectedQuickFindingIds(ids.slice(0, 2)))).toEqual(new Set([96]));
  });

  it("still reads the historical unsided id, and refuses ids that are no box's", () => {
    expect(selectedQuickFindingIds(["qf-7"])).toEqual([7]);
    expect(selectedQuickFindingIds(["qs-7", "qf-abc", "bundle-1", ""])).toEqual([]);
  });
});

describe("a box with no clinical metadata is still a usable box", () => {
  it("builds a patch for a concept-less box instead of refusing it", () => {
    // Owner ruling: existing concept-less boxes stay usable through their
    // established text-insertion behaviour, and no anatomical ownership is
    // manufactured for them. Hydrocephalus as a deploy actually leaves it is
    // exactly this box.
    const patch = quickFindingPatch(ADOPTED_HYDRO, { region: "Brain" });
    expect(patch.ownership.concept, "no concept is invented from the sentence").toBeFalsy();
    expect(patch.concept).toBeFalsy();
    expect(patch.incoming.findings).toBe(ADOPTED_HYDRO.findingText);
    expect(patch.incoming.impression).toBe(ADOPTED_HYDRO.impressionText);
  });

  it("carries a concept the radiologist assigns later, with no other change", () => {
    // The remedy for the three adopted boxes is the editor, not a migration: the
    // day he picks a concept, the same click must start recording it.
    const owned = { ...ADOPTED_HYDRO, concept: "ventricles" };
    expect(quickFindingPatch(owned, { region: "Brain" }).ownership.concept).toBe("ventricles");
  });
});

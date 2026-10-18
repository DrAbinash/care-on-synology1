/**
 * The fifteen lumbar spine Impression statements the radiologist approved on
 * 2026-10-18, and the report behaviour that approval depends on.
 *
 * Sixteen LS Spine Quick Select boxes carried Findings and nothing else, so a
 * click left the Conclusion section saying "Normal MRI lumbo-sacral spine" under
 * a disc extrusion. The wording below is the owner's, reviewed tile by tile, and
 * it is pinned here by exact string: a future edit that re-words one of these
 * sentences without a review is a change to a clinical document, and it has to
 * fail a test rather than pass a code review.
 *
 * The second half matters more than the first. An Impression that is only a
 * string in a catalogue is not a clinical conclusion; it is one because clicking
 * the box writes it, clicking it off removes it, changing the grade replaces it,
 * two levels coexist, a parameterised box substitutes the side and severity the
 * radiologist chose, and a sentence he typed himself survives all of that. These
 * drive `quickFindingPatch` — the builder the live strip uses for a database box
 * (`quickSelectBoxCatalogue.ts`), not the in-code fixture path — through the real
 * overlay and removal actions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  quickFindingPatch,
  quickFindingRowId,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_LS_SPINE_STANDARD_NORMAL_NAME } from "./fullReportBaseline";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { normalizeForDedupe } from "@/lib/reportFieldMerge";
import { useWorkspace } from "./store";

type CatalogTile = (typeof DEFAULT_QUICK_SELECT_TILES)[number];

function tile(label: string): CatalogTile {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`Quick Select tile "${label}" is missing from the catalog`);
  return found as CatalogTile;
}

/**
 * The box as `/api/radiology/quick-findings` returns one and the strip holds it.
 * `id` is per-test only: the production row id decides the ledger row id, and a
 * fixture id is as good as any for a builder that is otherwise pure.
 */
function box(label: string, id: number): ClinicalQuickFindingBox {
  const t = tile(label) as unknown as CatalogTile & Record<string, string | undefined>;
  return {
    id,
    label: t.label,
    studyType: "LS Spine",
    findingText: t.sentence,
    impressionText: (t as unknown as { impressionSentence?: string }).impressionSentence ?? "",
    techniqueText: "",
    recommendationText: (t as unknown as { recommendationSentence?: string }).recommendationSentence ?? "",
    concept: t.concept ?? null,
    anatomicalSection: t.anatomicalSection,
    conflictGroup: t.conflictGroup,
    baselineReplaces: t.baselineReplaces,
    properties: t.properties,
    field: t.field,
  };
}

const CTX = { region: "LS Spine", studyType: "LS Spine" };
const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME)!;

function openNormalLsSpine() {
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
  useWorkspace.getState().applyFormatById(LS_NORMAL.id);
}

/** The approved wording, exactly as reviewed. Nothing here is the engine's idea. */
const APPROVED = [
  ["Disc bulge L3-L4", "Disc bulge at L3-L4 without nerve root compression."],
  ["Disc protrusion L5-S1", "Posterocentral disc protrusion at L5-S1 indenting the thecal sac."],
  ["Disc desiccation L4-L5", "Disc desiccation at L4-L5."],
  ["Reduced disc height L4-L5", "Reduced disc height at L4-L5."],
  ["Grade 1 spondylolisthesis L4-L5", "Grade 1 spondylolisthesis at L4-L5."],
  ["Grade 2 spondylolisthesis L4-L5", "Grade 2 spondylolisthesis at L4-L5."],
  ["Modic type 1 L4-L5", "Modic type 1 endplate changes at L4-L5."],
  ["Modic type 2 L4-L5", "Modic type 2 endplate changes at L4-L5."],
  ["Facet arthropathy L4-L5", "Facet arthropathy at L4-L5."],
  [
    "Compression fracture L1",
    "Acute compression fracture of the L1 vertebral body with marrow edema; posterior wall intact.",
  ],
  ["LF hypertrophy L4-L5", "Ligamentum flavum hypertrophy at L4-L5."],
  ["Foraminal stenosis L4-L5", "{severity} {side} neural foraminal stenosis at L4-L5."],
  ["Schmorl node L1", "Schmorl node at the L1 endplate."],
  ["Vertebral hemangioma L1", "Typical vertebral hemangioma at L1."],
  ["Disc desiccation L5-S1", "Disc desiccation at L5-S1."],
] as const;

const impressionLines = () =>
  useWorkspace.getState().impressionText.split("\n").map((l) => l.trim()).filter(Boolean);

describe("the approved LS Spine Impression wording is the shipped wording", () => {
  it("pins all fifteen sentences the radiologist reviewed", () => {
    for (const [label, expected] of APPROVED) {
      expect(
        (tile(label) as unknown as { impressionSentence?: string }).impressionSentence,
        `box "${label}"`,
      ).toBe(expected);
    }
  });

  it("leaves the Normal LS spine box with no Impression of its own", () => {
    // DECISION A: a whole-study normal conclusion belongs to the approved normal
    // baseline, not to a box whose Findings only cover alignment, marrow and
    // disc spaces. Giving it "Normal lumbar spine." would let one chip assert a
    // conclusion about the canal, the foramina and the conus it never describes.
    const normal = tile("Normal LS spine") as unknown as { impressionSentence?: string };
    expect(normal.impressionSentence ?? "").toBe("");
  });

  it("keeps the negative in the L3-L4 bulge and the posterior wall in the fracture", () => {
    // DECISIONS B and the owner's correction: the L3-L4 line keeps "without
    // nerve root compression", and the L1 fracture says the posterior wall is
    // intact without calling the fracture stable — stability is a clinical
    // judgement this report does not own.
    expect(tile("Disc bulge L3-L4").sentence).toContain("without nerve root compression");
    const imp = (tile("Disc bulge L3-L4") as unknown as { impressionSentence: string }).impressionSentence;
    expect(imp).toContain("without nerve root compression");
    const fracture = (tile("Compression fracture L1") as unknown as { impressionSentence: string })
      .impressionSentence;
    expect(fracture).toContain("posterior wall intact");
    expect(fracture.toLowerCase()).not.toMatch(/stable|stability|unstable/);
  });

  it("gives each disc-desiccation level its own conflict group", () => {
    // DECISION D. A shared non-empty group means "mutually exclusive within the
    // study" (`radiologyQuickFindings.ts` schema note), and L4-L5 desiccation and
    // L5-S1 desiccation are two true statements about two discs.
    const groups = [
      "Disc desiccation L4-L5",
      "Disc desiccation L5-S1",
      "Disc desiccation C5-C6",
      "Disc desiccation C6-C7",
    ].map((label) => (tile(label) as unknown as { conflictGroup?: string }).conflictGroup);
    expect(new Set(groups).size).toBe(4);
    expect(groups).toContain("disc desiccation l4-l5");
    expect(groups).toContain("disc desiccation l5-s1");
  });

  it("declares the parameters the foraminal box actually asks for", () => {
    // DECISION C: the box asks for a severity and a side in both sections, so
    // both have to be declared, or the dialog that collects them is not offered.
    const t = tile("Foraminal stenosis L4-L5") as unknown as {
      properties?: string;
      impressionSentence: string;
    };
    expect((t.properties ?? "").split(",").map((s) => s.trim()).sort()).toEqual(["severity", "side"]);
    expect(t.impressionSentence).toContain("{severity}");
    expect(t.impressionSentence).toContain("{side}");
  });

  it("leaves no LS Spine findings box without a conclusion except the normal one", () => {
    const unowned = DEFAULT_QUICK_SELECT_TILES.filter(
      (t) =>
        t.field === "findings" &&
        (t as unknown as { scopeBodyPart?: string }).scopeBodyPart === "LS Spine" &&
        !((t as unknown as { impressionSentence?: string }).impressionSentence ?? "").trim(),
    ).map((t) => t.label);
    expect(unowned).toEqual(["Normal LS spine"]);
  });
});

describe("one click writes the conclusion, and un-clicking takes it back", () => {
  beforeEach(openNormalLsSpine);

  it("writes the approved Impression line into the report", () => {
    const b = box("Disc desiccation L4-L5", 901);
    expect(useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(b, CTX))).toBe("applied");
    expect(impressionLines()).toContain("Disc desiccation at L4-L5.");
  });

  it("removes that line again when the box is clicked off", () => {
    const b = box("Disc desiccation L4-L5", 902);
    const patch = quickFindingPatch(b, CTX);
    useWorkspace.getState().applyPathologyOverlay(patch);
    expect(impressionLines()).toContain("Disc desiccation at L4-L5.");
    useWorkspace.getState().removeObservation(patch.id!);
    expect(impressionLines()).not.toContain("Disc desiccation at L4-L5.");
    expect(useWorkspace.getState().findingsText).not.toContain("Loss of T2 signal (desiccation) of the L4-L5 disc.");
  });

  it("restores the normal conclusion verbatim for a box that already wrote one", () => {
    // The control for the test below, measured rather than assumed: a box whose
    // Impression shipped on `origin/main` suspends and restores the normal
    // conclusion as exactly the string the format holds.
    for (const label of ["Moderate canal stenosis L4-L5", "Disc herniation L4-L5"]) {
      openNormalLsSpine();
      const patch = quickFindingPatch(box(label, 950), CTX);
      useWorkspace.getState().applyPathologyOverlay(patch);
      useWorkspace.getState().removeObservation(patch.id!);
      expect(useWorkspace.getState().impressionText, label).toBe(LS_NORMAL.impression);
    }
  });

  it("restores the normal conclusion when the last abnormal box comes off, split into two lines", () => {
    // CAT-P4 (defect, pinned not accepted): a box that supersedes no normal
    // sentence of its own (`Facet arthropathy` has no matching normal in the LS
    // baseline) comes back through the rebuild branch, which rejoins the
    // suspended conclusion sentence by sentence — so the report prints
    // "Normal MRI of the lumbosacral spine." and "No significant disc, canal,
    // foraminal or neural compressive abnormality." as two Impression lines where
    // the format holds one line. No clinical statement is gained or lost, and the
    // next finding clears it anyway, but the Impression of a report he clicked
    // and un-clicked is not byte-identical to the one the Normal format opened.
    // The box test above proves this is the restore path, not this wording.
    const b = box("Facet arthropathy L4-L5", 903);
    const patch = quickFindingPatch(b, CTX);
    useWorkspace.getState().applyPathologyOverlay(patch);
    expect(useWorkspace.getState().impressionText).not.toContain(LS_NORMAL.impression);
    useWorkspace.getState().removeObservation(patch.id!);
    const restored = useWorkspace.getState().impressionText;
    expect(restored.replace(/\n/g, " ")).toBe(LS_NORMAL.impression);
    expect(restored.split("\n")).toHaveLength(2);
  });

  it("every approved box lands its own line, one at a time, on a fresh report", () => {
    for (let i = 0; i < APPROVED.length; i++) {
      openNormalLsSpine();
      const [label, expected] = APPROVED[i];
      const parameterised = expected.includes("{");
      const params = parameterised ? { side: "left" as const, severity: "moderate" } : {};
      const status = useWorkspace.getState().applyPathologyOverlay(
        quickFindingPatch(box(label, 1000 + i), CTX, params),
      );
      expect(status, `box "${label}"`).toBe("applied");
      const lines = impressionLines();
      if (parameterised) {
        expect(
          lines.some((l) => /moderate left neural foraminal stenosis at l4-l5/i.test(l)),
          `box "${label}" wrote ${JSON.stringify(lines)}`,
        ).toBe(true);
      } else {
        expect(lines, `box "${label}"`).toContain(expected);
      }
      expect(useWorkspace.getState().impressionText, `box "${label}"`).not.toMatch(/[{][a-z]+[}]/i);
    }
  });

  it("substitutes the chosen severity and side in the Impression, not only the Findings", () => {
    const b = box("Foraminal stenosis L4-L5", 904);
    useWorkspace.getState().applyPathologyOverlay(
      quickFindingPatch(b, CTX, { side: "left", severity: "moderate" }),
    );
    const s = useWorkspace.getState();
    expect(s.findingsText.toLowerCase()).toContain("moderate left neural foraminal stenosis at l4-l5");
    expect(s.impressionText.toLowerCase()).toContain("moderate left neural foraminal stenosis at l4-l5");
    expect(s.impressionText).not.toContain("{severity}");
    expect(s.impressionText).not.toContain("{side}");
  });

  it("keeps two levels of the same concept as two separate conclusions", () => {
    const l45 = box("Disc desiccation L4-L5", 905);
    const l5s1 = box("Disc desiccation L5-S1", 906);
    useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(l45, CTX));
    useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(l5s1, CTX));
    const lines = impressionLines();
    expect(lines).toContain("Disc desiccation at L4-L5.");
    expect(lines).toContain("Disc desiccation at L5-S1.");
    expect(useWorkspace.getState().findingsText).toContain("L4-L5 disc");
    expect(useWorkspace.getState().findingsText).toContain("L5-S1 disc");
  });

  it("replaces the conclusion when the grade of the same level changes", () => {
    useWorkspace.getState().applyPathologyOverlay(
      quickFindingPatch(box("Moderate canal stenosis L4-L5", 907), CTX),
    );
    expect(impressionLines()).toContain("Moderate canal stenosis at L4-L5.");
    useWorkspace.getState().applyPathologyOverlay(
      quickFindingPatch(box("Severe canal stenosis L4-L5", 907), CTX),
    );
    const lines = impressionLines();
    expect(lines).toContain("Severe canal stenosis at L4-L5.");
    expect(lines).not.toContain("Moderate canal stenosis at L4-L5.");
  });

  it("holds a multilevel report together: four boxes, four conclusions, no normal left standing", () => {
    const boxes = [
      box("Disc herniation L4-L5", 908),
      box("Disc desiccation L5-S1", 909),
      box("Modic type 1 L4-L5", 910),
      box("Foraminal stenosis L4-L5", 911),
    ];
    for (const [i, b] of boxes.entries()) {
      const params = i === 3 ? { side: "right", severity: "severe" } : {};
      useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(b, CTX, params));
    }
    const s = useWorkspace.getState();
    const lines = impressionLines();
    expect(lines).toContain("Disc herniation at L4-L5 causing indentation on the thecal sac.");
    expect(lines).toContain("Disc desiccation at L5-S1.");
    expect(lines).toContain("Modic type 1 endplate changes at L4-L5.");
    expect(lines.some((l) => /right neural foraminal stenosis at L4-L5/i.test(l))).toBe(true);
    expect(s.impressionText).not.toContain("Normal MRI");
  });

  it("does not write a second copy of a conclusion the report already carries", () => {
    const b = box("Facet arthropathy L4-L5", 912);
    const patch = quickFindingPatch(b, CTX);
    useWorkspace.getState().applyPathologyOverlay(patch);
    useWorkspace.getState().applyPathologyOverlay(patch);
    expect(impressionLines().filter((l) => l === "Facet arthropathy at L4-L5.")).toHaveLength(1);
  });

  it("refuses to overwrite a conclusion the radiologist wrote himself", () => {
    const hand = "Multilevel degenerative disc disease, maximal at L4-L5, with left L5 nerve root compression.";
    const b = box("Disc bulge L3-L4", 913);
    const patch = quickFindingPatch(b, CTX);
    useWorkspace.getState().applyPathologyOverlay(patch);
    // His own sentence, stamped the way the editor stamps typed text.
    useWorkspace.setState((s) => ({
      impressionText: `${hand}\n${s.impressionText}`.trim(),
      fieldProvenance: {
        ...s.fieldProvenance,
        impression: {
          ...(s.fieldProvenance as Record<string, Record<string, string[]>>).impression,
          [normalizeForDedupe(hand)]: ["manual"],
        },
      },
    }));
    const second = box("LF hypertrophy L4-L5", 914);
    useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(second, CTX));
    expect(useWorkspace.getState().impressionText).toContain(hand);
    // The box he clicked still has a ledger row, so un-clicking it cannot strand
    // its Findings line while his own sentence keeps its protection.
    expect(impressionLines()).toContain("Ligamentum flavum hypertrophy at L4-L5.");
    expect(quickFindingRowId(914)).toBe("qf-914");
  });
});

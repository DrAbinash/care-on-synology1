/**
 * PR E PRIORITY 1 — one examination, one acquisition statement.
 *
 * Measured in a real browser on the billed single-region "MRI DORSAL SPINE" study
 * (`tmp/pr-e-t1-order/order.json`, accession SYN-M1-ACC-0002):
 *
 *   on open      Technique = "MRI Dorsal (Thoracic) Spine: T1W and T2W sagittal, axial at
 *                selected levels."   editor provenance: TEMPLATE
 *   after Generate Technique = that sentence, then a second line
 *                "Multiplanar multisequence MRI of the spine was performed including T1, T2,
 *                and STIR sequences."   editor provenance: PROTOCOL
 *   printed      both lines, under one TECHNIQUE heading, and both saved as
 *                findings_sections.Technique.
 *
 * The second line is not a restatement of the first. The approved template acquires T1W and
 * T2W, sagittal plus axial at selected levels; the Study Tab sentence claims STIR, which no
 * dorsal template establishes, and calls the part "the spine" when the examination is dorsal.
 * So the report prints two acquisition accounts, one of which describes sequences this
 * examination does not have.
 *
 * The writer is `startReportSetup`, which the Generate handler runs before the generator
 * (`useWorkspaceClinicalUi.tsx` `handleStartReport`). Its per-region loop merges each region's
 * Study Tab technique into the field unconditionally, and `applyProtocol`'s non-primary branch
 * merges its protocol technique too — so a field that already states the acquisition gains a
 * second statement on every press.
 *
 * What is NOT changed here, and the tests that hold the line:
 *  - The radiologist's own text. Nothing in this rule deletes a sentence; it refuses to ADD a
 *    machine one. `nondestructiveTechniqueMerge.hardening.test.ts` (B-02A) keeps its guarantees.
 *  - Multi-region composition. Brain + Cervical genuinely acquires differently for each part,
 *    so each region keeps its own statement (`combineStudyRegions.test.ts`).
 *  - `mergeTechniqueWithProvenance` itself, which is a text-composition layer and must not start
 *    deciding clinical precedence — that is the writer's job.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mayAddAutoTechniqueStatement,
  mayReplaceMachineTechniqueWithApproved,
} from "@/lib/techniqueStudyTabOrigin";
import { mergeTechnique, normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

/** The two shipped sentences, verbatim from the product's own stores. */
const APPROVED_DORSAL =
  "MRI Dorsal (Thoracic) Spine: T1W and T2W sagittal, axial at selected levels.";
const STUDY_TAB_GENERIC =
  "Multiplanar multisequence MRI of the spine was performed including T1, T2, and STIR sequences.";

const here = dirname(fileURLToPath(import.meta.url));
const SETUP = resolve(here, "../hooks/useReportingStudySetup.ts");
const read = (abs: string) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n");

describe("the rule: a single-region examination states its acquisition once", () => {
  it("refuses a second machine statement when the field already says one", () => {
    // The measured defect: approved template technique on the page, Study Tab sentence arriving.
    expect(mayAddAutoTechniqueStatement({
      techniqueText: APPROVED_DORSAL,
      regionCount: 1,
    })).toBe(false);
  });

  it("writes the technique when nothing has said it yet", () => {
    expect(mayAddAutoTechniqueStatement({ techniqueText: "", regionCount: 1 })).toBe(true);
    expect(mayAddAutoTechniqueStatement({ techniqueText: "   ", regionCount: 1 })).toBe(true);
  });

  it("keeps composing technique for an examination that covers several regions", () => {
    // Positive control against an over-broad guard: Brain + Cervical is two acquisitions.
    expect(mayAddAutoTechniqueStatement({
      techniqueText: "MRI brain on 3T. T1W, T2W, FLAIR, DWI, ADC.",
      regionCount: 2,
    })).toBe(true);
  });

  it("treats a whole-spine screening examination as one region, not three", () => {
    expect(mayAddAutoTechniqueStatement({
      techniqueText: APPROVED_DORSAL,
      regionCount: 1,
    })).toBe(false);
  });

  it("refuses it beside dictated text as well, because the rule asks only whether the page already says one", () => {
    // Dictation and typing are the brief's two "preserve the radiologist's Technique" cases. The
    // guard never inspects provenance, so it cannot tell an authored sentence from a template one
    // — which is why it can only ever decline to ADD, and can never remove.
    expect(mayAddAutoTechniqueStatement({
      techniqueText: "Three tesla sagittal T1W and T2W images of the dorsal spine.",
      regionCount: 1,
    })).toBe(false);
  });

  it("does not delete anything: the refused write is an addition that does not happen", () => {
    const before = APPROVED_DORSAL;
    const wouldHaveBeen = mergeTechnique(before, STUDY_TAB_GENERIC);
    expect(wouldHaveBeen).not.toBe(before); // proving the merge really would have added a claim
    expect(before).toContain("T1W and T2W sagittal, axial at selected levels");
  });
});

describe("the shipped sentences make this a clinical rule, not a layout rule", () => {
  it("names a sequence the approved dorsal template does not acquire", () => {
    // If the two statements ever agree about sequences, this test must fail so the rule is
    // re-examined rather than quietly kept.
    expect(STUDY_TAB_GENERIC.toUpperCase()).toContain("STIR");
    expect(APPROVED_DORSAL.toUpperCase()).not.toContain("STIR");
  });

  it("reads them from the stores that actually serve them to the workspace", () => {
    const pkgRoot = resolve(here, "../.."); // artifacts/diagnostic-erp
    const tabs = read(resolve(pkgRoot, "../../migrations/z_add_abnormality_engine.sql"));
    const templates = read(resolve(pkgRoot, "../api-server/src/routes/structuredReportTemplates.ts"));
    expect(tabs, "the seeded Study Tab technique the report inherits is not the one under test")
      .toContain(`technique_text = '${STUDY_TAB_GENERIC}'`);
    expect(templates, "the approved dorsal template technique is not the one under test")
      .toContain(`technique: "${APPROVED_DORSAL}"`);
  });
});

/**
 * Source contracts, because this repo has no component-render harness: `startReportSetup` is a
 * hook body, and the behaviour it produces is proven in the browser. These pin that BOTH of its
 * technique writes go through the one rule, so a third writer cannot reappear beside them.
 */
describe("startReportSetup asks the rule before it writes technique", () => {
  const src = read(SETUP);
  const start = src.indexOf("const startReportSetup = useCallback(");
  const body = () => {
    expect(start, "startReportSetup is gone").toBeGreaterThan(-1);
    const end = src.indexOf("\n  }, [", start);
    expect(end, "startReportSetup body does not close where this test expects").toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("consults the shared rule", () => {
    expect(body()).toContain("mayAddAutoTechniqueStatement(");
  });

  it("guards the Study Tab technique merge", () => {
    const line = body().split("\n").find((l) => l.includes("setters.mergeTechnique(tab.techniqueText"));
    expect(line, "the tab technique write is back to being unconditional").toBeDefined();
    expect(line, "the tab write must be conditional on the shared rule, not on its own truthiness")
      .toMatch(/&& allowTechnique\)/);
  });

  it("carries the same decision into the protocol branch", () => {
    // applyProtocol's non-primary branch merges protocol.techniqueText; without the same
    // decision a Cervical or Brain study duplicates exactly the way Dorsal did.
    const line = body().split("\n").find((l) => l.includes("applyProtocol(protocol,"));
    expect(line, "startReportSetup no longer calls applyProtocol").toBeDefined();
    expect(line).toMatch(/technique:\s*/);
  });

  it("still selects the study's template, so the setup half stays a setup", () => {
    expect(body()).toContain("pickStructuredTemplateForRegion(");
    expect(body()).not.toContain("replaceFindings(");
  });
});

/**
 * The decision only helps if the writer it is handed to obeys it. `applyProtocol` is the other
 * half of the same loop — its non-primary branch merges `protocol.techniqueText`, which is how a
 * Cervical or Brain study duplicates — so its side of the contract is pinned here and the
 * behaviour is measured in the browser.
 */
describe("applyProtocol obeys the decision it was given", () => {
  const src = read(SETUP);
  const start = src.indexOf("const applyProtocol = useCallback(");
  const body = () => {
    expect(start, "applyProtocol is gone").toBeGreaterThan(-1);
    const end = src.indexOf("\n  }, [", start);
    expect(end, "applyProtocol body does not close where this test expects").toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("takes the option", () => {
    expect(body()).toContain("options?: { technique?: boolean }");
  });

  it("stops before any technique write when told to, and only there", () => {
    const b = body();
    const gate = b.indexOf("options?.technique === false");
    const write = b.indexOf("if (protocol.techniqueText)");
    expect(gate).toBeGreaterThan(-1);
    expect(write, "applyProtocol no longer writes technique, so this gate has nothing to guard")
      .toBeGreaterThan(-1);
    expect(gate, "the refusal must precede the technique block").toBeLessThan(write);
    // The recommendation is setup information, not acquisition text: refusing technique may not
    // silently stop the protocol from contributing its recommendation.
    expect(b.indexOf("mergeRecommendation(")).toBeLessThan(gate);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The other half: Generate runs AFTER the setup pass, so on a study whose Technique box starts
// empty the setup pass has already written the Study Tab / protocol sentence by the time the
// generator merges the examination's approved acquisition statement. Measured on the billed
// "MRI Whole Spine Screening" study (tmp/pr-e-t1-multi/multi.json): the printed TECHNIQUE block
// held THREE accounts of one examination —
//   "Multiplanar multisequence MRI of the whole spine was performed including T1 and T2 sequences."   (PROTOCOL)
//   "Multiplanar multisequence MRI of the spine was performed including T1, T2, and STIR sequences."  (PROTOCOL)
//   "Limited whole-spine screening with sagittal T1W, T2W and STIR of the cervical, dorsal and lumbar
//    regions (limited planar and limited sequence)."                                                  (approved)
// Refusing to ADD cannot fix that, because the box was empty when each refusal was decided. The
// approved statement has to be what the report says, and the only writing that can be undone
// without losing a human sentence is text no human authored.
// ─────────────────────────────────────────────────────────────────────────────
describe("an approved acquisition statement replaces machine text, never a person's", () => {
  const MACHINE = { [normalizeForDedupe(STUDY_TAB_GENERIC)]: ["protocol"] };
  const WITH_MANUAL = {
    ...MACHINE,
    [normalizeForDedupe("Performed on a 3T scanner.")]: ["manual"],
  };

  it("replaces a machine-only Technique on a single-region examination", () => {
    expect(mayReplaceMachineTechniqueWithApproved({
      techniqueText: STUDY_TAB_GENERIC,
      provenance: MACHINE,
      regionCount: 1,
    })).toBe(true);
  });

  it("keeps a manually typed sentence and merges beside it instead", () => {
    expect(mayReplaceMachineTechniqueWithApproved({
      techniqueText: `${STUDY_TAB_GENERIC}\nPerformed on a 3T scanner.`,
      provenance: WITH_MANUAL,
      regionCount: 1,
    })).toBe(false);
  });

  it("fails closed when there is no provenance to read", () => {
    expect(mayReplaceMachineTechniqueWithApproved({
      techniqueText: STUDY_TAB_GENERIC, provenance: undefined, regionCount: 1,
    })).toBe(false);
    expect(mayReplaceMachineTechniqueWithApproved({
      techniqueText: STUDY_TAB_GENERIC, provenance: {}, regionCount: 1,
    })).toBe(false);
  });

  it("does not touch a multi-region examination's composed technique", () => {
    expect(mayReplaceMachineTechniqueWithApproved({
      techniqueText: STUDY_TAB_GENERIC, provenance: MACHINE, regionCount: 2,
    })).toBe(false);
  });

  it("has nothing to replace when the box is empty", () => {
    expect(mayReplaceMachineTechniqueWithApproved({
      techniqueText: "", provenance: {}, regionCount: 1,
    })).toBe(false);
  });
});

describe("Generate on the shipped MRI Dorsal Spine pathway", () => {
  beforeEach(() => useWorkspace.setState({ reportFormats: DEFAULT_REPORT_FORMATS }));

  const dorsalCtx = () => buildReportingStudyContext({
    modality: "MR", studyDescription: "MRI DORSAL SPINE", regions: ["Dorsal Spine"], source: "billed",
  });

  function blankWorkspace() {
    useWorkspace.setState({
      findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
      clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
      impressionNeedsRefresh: false, impressionOrderFrozen: false, lastPatchSnapshot: null,
      patchUndoStack: [], confirmOverwriteOpen: false, pendingPathologyPatch: null,
      pendingFormatIds: [], mergePreviewOpen: false, appliedFormatReportTitle: null,
      appliedFormatName: null, startingCanvasBaseline: null, canalApProvenance: {},
      dorsalCanalForced: false, isFinalized: false, isDirty: false,
      reportingContext: dorsalCtx(), reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [],
    });
  }

  it("writes one acquisition statement, and the same one whether the box started empty or held machine text", () => {
    blankWorkspace();
    expect(useWorkspace.getState().generateProfessionalReport(dorsalCtx()).status).toBe("generated");
    const fromEmpty = useWorkspace.getState().techniqueText;
    expect(fromEmpty).toBeTruthy();

    blankWorkspace();
    // What the setup pass leaves behind on a study that starts empty.
    useWorkspace.getState().setField("technique", STUDY_TAB_GENERIC, { source: "protocol" });
    expect(useWorkspace.getState().generateProfessionalReport(dorsalCtx()).status).toBe("generated");
    const afterMachine = useWorkspace.getState().techniqueText;

    expect(afterMachine).toBe(fromEmpty);
    expect(afterMachine.toUpperCase()).not.toContain("STIR");
    expect(splitToSentences(afterMachine).length).toBe(splitToSentences(fromEmpty).length);
  });

  it("keeps every sentence the radiologist typed", () => {
    blankWorkspace();
    const typed = "Examination performed on a 3T scanner with sagittal T1W and T2W dorsal sequences.";
    useWorkspace.getState().setField("technique", typed, { source: "manual" });
    expect(useWorkspace.getState().generateProfessionalReport(dorsalCtx()).status).toBe("generated");
    expect(useWorkspace.getState().techniqueText).toContain(typed);
  });

  it("keeps dictated technique", () => {
    blankWorkspace();
    const dictated = "Sagittal T1W and T2W acquired through the thoracic spine.";
    useWorkspace.getState().setField("technique", dictated, { source: "radiologist-voice" });
    expect(useWorkspace.getState().generateProfessionalReport(dorsalCtx()).status).toBe("generated");
    expect(useWorkspace.getState().techniqueText).toContain(dictated);
  });

  it("is still idempotent after the replacement", () => {
    blankWorkspace();
    useWorkspace.getState().setField("technique", STUDY_TAB_GENERIC, { source: "protocol" });
    useWorkspace.getState().generateProfessionalReport(dorsalCtx());
    const first = useWorkspace.getState().techniqueText;
    expect(useWorkspace.getState().generateProfessionalReport(dorsalCtx()).status).toBe("generated");
    expect(useWorkspace.getState().techniqueText).toBe(first);
  });
});

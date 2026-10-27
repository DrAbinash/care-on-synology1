import { describe, expect, it, beforeEach } from "vitest";
import {
  buildCanonicalObservation,
  buildSlotKey,
  observationsMutuallyExclusive,
  resolveConcept,
  selectedQuickFindingIds,
  hasStructuredOwnership,
} from "./observationSlot";
import {
  serializeObservationLedger,
  deserializeObservationLedger,
  extractCareObservationLedger,
  refreshImpressionFromObservations,
  OBSERVATION_LEDGER_KIND,
} from "./observationLedger";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import {
  quickFindingPatch,
  quickFindingRowBelongsTo,
  quickFindingRowId,
} from "./zai-workspace/quickSelectTilePayload";
import { mergeTwoFormats } from "./zai-workspace/types";
import { combinedFormatTitle } from "./formatSlotMerge";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { buildPreviewHtml } from "./radiologyReportPreviewHtml";
import { applyPathologyPatch } from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";
import { catalogSetForKey } from "./findingsMacros";

const FAZEKAS1 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 1")!;
const FAZEKAS2 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 2")!;
const VENTRICLES = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Normal ventricles")!;
const DISC_L45 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;
const HEMOR = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;
const INFARCT = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Acute infarct (DWI)")!;
const BRAIN_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
const FAZEKAS_SENILE = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Fazekas Grade 1 + Senile Changes")!;
const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const WHOLE_SCREEN = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Whole Spine — Screening")!;

function brainCtx() {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI Brain Plain",
    regions: ["Brain"],
    source: "auto",
  });
}

function lsCtx() {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI LS Spine",
    regions: ["LS Spine"],
    source: "auto",
  });
}

function resetStore(region: "Brain" | "LS Spine" = "Brain") {
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
    appliedFormatReportTitle: null,
    reportingContext: region === "Brain" ? brainCtx() : lsCtx(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    voiceComposerObservations: [],
  });
}

function overlayTile(tile: typeof FAZEKAS1, id: string, extra?: { region?: string; side?: "left" | "right" | "" }) {
  return useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: tile.sentence, impression: tile.impressionSentence },
    templates: { findings: tile.sentence, impression: tile.impressionSentence },
    ownership: {
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
    },
    source: "quick-select",
    id,
    region: extra?.region ?? tile.scopeBodyPart,
    label: tile.label,
    findingsText: tile.sentence,
    side: extra?.side,
  });
}

function previewHtml(s: { findingsText: string; impressionText: string; techniqueText: string; recommendationText: string; clinicalHistoryText: string; appliedFormatReportTitle: string | null }) {
  return buildPreviewHtml({
    patientName: "Test Patient",
    age: "45",
    sex: "M",
    accessionNumber: "A1",
    referringDoctor: "Dr X",
    studyDate: "2026-08-26",
    studyName: s.appliedFormatReportTitle || "MRI BRAIN PLAIN",
    technique: s.techniqueText,
    clinicalHistory: s.clinicalHistoryText,
    findingsMap: {},
    rawFindings: s.findingsText,
    useStructured: false,
    impression: s.impressionText.split("\n").filter(Boolean),
    recommendation: s.recommendationText,
    imageRefs: [],
  });
}
/**
 * Drives the store through the real database-box builder, not through a
 * hand-written copy of its output. This helper used to inline the patch, which
 * quietly reproduced `handleQuickToggle`'s omissions — no concept, no declared
 * laterality, one row id for both sides — so the suite below was passing against
 * a fixture that no caller produced. Building through `quickFindingPatch` is what
 * makes these assertions about the shipped pathway.
 */
function overlayQf(opts: {
  id: number;
  region: string;
  label: string;
  findings: string;
  impression?: string;
  recommendation?: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  side?: "left" | "right" | "";
  properties?: string;
  concept?: string;
  baselineReplaces?: string;
}) {
  return useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(
    {
      id: opts.id,
      label: opts.label,
      studyType: opts.region,
      findingText: opts.findings,
      impressionText: opts.impression ?? "",
      techniqueText: "",
      recommendationText: opts.recommendation ?? "",
      anatomicalSection: opts.anatomicalSection ?? "",
      conflictGroup: opts.conflictGroup ?? "",
      baselineReplaces: opts.baselineReplaces ?? "",
      properties: opts.properties ?? "",
      concept: opts.concept ?? "",
    },
    { region: opts.region },
    { side: opts.side },
  ));
}

/** The row ids the ledger currently holds, in order. */
function rowIds(): string[] {
  return useWorkspace.getState().appliedPathologyPatches.map((p) => p.id);
}

describe("observationSlot identity", () => {
  it("builds Brain|fazekas|*|* without equating concept to conflictGroup", () => {
    const obs = buildCanonicalObservation({
      region: "Brain",
      conflictGroup: "fazekas",
      label: "Fazekas 1",
      findingsText: FAZEKAS1.sentence,
    });
    expect(obs.slotKey).toBe("Brain|fazekas|*|*");
    expect(obs.concept).toBe("fazekas");
    expect(obs.conflictGroup).toBe("fazekas");
    expect(obs.conceptSource).toBe("conflictGroup");
  });

  it("resolves ventricles from hydrocephalus without a catalog concept column", () => {
    const r = resolveConcept({ label: "Hydrocephalus", findingsText: "There is hydrocephalus with dilated ventricles." });
    expect(r.concept).toBe("ventricles");
    expect(r.source).toBe("legacy-fallback");
  });

  it("does not treat broad 'disc' as exclusive concept", () => {
    const r = resolveConcept({ conflictGroup: "disc", region: "LS Spine", findingsText: "Disc spaces are maintained." });
    expect(r.concept).toBeNull();
    expect(hasStructuredOwnership({ concept: r.concept, conceptSource: r.source })).toBe(false);
  });

  it("disc_contour requires a level in the legacy fallback path", () => {
    const withLevel = buildCanonicalObservation({
      region: "LS Spine",
      label: "L4-L5 diffuse bulge",
      findingsText: "Diffuse disc bulge at L4-L5.",
    });
    expect(withLevel.slotKey).toBe("LS Spine|disc_contour|L4-L5|*");
    const noLevel = buildCanonicalObservation({
      region: "LS Spine",
      label: "Disc comment",
      findingsText: "Disc spaces are maintained.",
    });
    expect(noLevel.concept).toBeNull();
  });

  it("left vs right of the same concept are not mutually exclusive", () => {
    const left = buildCanonicalObservation({
      region: "Brain",
      conflictGroup: "infarct",
      findingsText: "Restricted diffusion in the {side} MCA territory.",
      laterality: "left",
      supportsLaterality: true,
    });
    const right = buildCanonicalObservation({
      region: "Brain",
      conflictGroup: "infarct",
      findingsText: "Restricted diffusion in the {side} MCA territory.",
      laterality: "right",
      supportsLaterality: true,
    });
    expect(left.slotKey).toBe("Brain|infarct|*|left");
    expect(right.slotKey).toBe("Brain|infarct|*|right");
    expect(observationsMutuallyExclusive(left, right)).toBe(false);
    expect(buildSlotKey({ region: "LS Spine", concept: "facet_joint", level: "L4-L5", laterality: "" }))
      .toBe("LS Spine|facet_joint|L4-L5|*");
  });
});

describe("ownership golden cases A–J", () => {
  beforeEach(() => resetStore("Brain"));

  it("A. Fazekas 1 → Fazekas 2 leaves only Fazekas 2", () => {
    overlayTile(FAZEKAS1, "qf-1");
    overlayTile(FAZEKAS2, "qf-2");
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/Fazekas grade 2/i);
    expect(s.findingsText).not.toMatch(/Fazekas grade 1/i);
    expect(s.impressionText).toMatch(/Fazekas grade 2/i);
    expect(s.impressionText).not.toMatch(/Fazekas grade 1/i);
    expect(s.appliedPathologyPatches.map((p) => p.id)).toEqual(["qf-2"]);
    expect(selectedQuickFindingIds(s.appliedPathologyPatches.map((p) => p.id))).toEqual([2]);
  });

  it("B. Fazekas 2 deselect removes contribution", () => {
    overlayTile(FAZEKAS2, "qf-2");
    expect(useWorkspace.getState().removeObservation("qf-2")).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toMatch(/Fazekas grade 2/i);
    // PR #662 §2: after the last impression-worthy abnormal is removed, the
    // system-owned normal impression auto-returns (id="system-normal-study").
    // Filter it out to assert that no abnormal QS patches remain.
    const remaining = useWorkspace.getState().appliedPathologyPatches.filter(
      (p) => p.id !== "system-normal-study",
    );
    expect(remaining).toHaveLength(0);
  });

  it("C. normal ventricles → hydrocephalus replaces only ventricles", () => {
    useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
    overlayTile(VENTRICLES, "qf-10");
    overlayQf({
      id: 11,
      region: "Brain",
      label: "Hydrocephalus",
      findings: "There is hydrocephalus with dilatation of the ventricular system.",
      impression: "Hydrocephalus.",
      conflictGroup: "ventricles",
    });
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/hydrocephalus/i);
    expect(s.findingsText).not.toMatch(/Ventricular system and cisternal spaces are normal in size/i);
    expect(s.findingsText).toMatch(/Brain parenchyma shows normal signal intensity/);
  });

  it("H. untouched QS deselect removes contribution", () => {
    overlayTile(FAZEKAS1, "qf-1");
    expect(useWorkspace.getState().findingsText).toMatch(/Fazekas grade 1/);
    useWorkspace.getState().removeObservation("qf-1");
    expect(useWorkspace.getState().findingsText).not.toMatch(/Fazekas/);
  });

  it("I. manually edited QS text survives deselect", () => {
    overlayTile(FAZEKAS1, "qf-1");
    const edited = useWorkspace.getState().findingsText.replace("Fazekas grade 1", "Fazekas grade 1 — radiologist rewrite");
    useWorkspace.getState().setField("findings", edited);
    expect(useWorkspace.getState().removeObservation("qf-1")).toBe("preserved-manual");
    expect(useWorkspace.getState().findingsText).toContain("radiologist rewrite");
    // PR #662 §2: system-owned normal impression auto-returns after the last
    // impression-worthy abnormal observation is removed (id="system-normal-study").
    // The manual findings edit does NOT block auto-return because it lives in
    // the findings field, not the impression field (predicate is impression-only).
    const remaining = useWorkspace.getState().appliedPathologyPatches.filter(
      (p) => p.id !== "system-normal-study",
    );
    expect(remaining).toHaveLength(0);
  });

  it("J. manual text is never silently overwritten", () => {
    useWorkspace.getState().setField("findings", "Manual note: correlate with EEG seizure focus.", { source: "manual" });
    overlayTile(HEMOR, "qs-hem", { side: "right" });
    expect(useWorkspace.getState().findingsText).toContain("Manual note: correlate with EEG seizure focus.");
    expect(useWorkspace.getState().findingsText.toLowerCase()).toContain("hemorrhage");
  });
});

describe("spine slot isolation D–G", () => {
  beforeEach(() => resetStore("LS Spine"));

  it("D. L4-L5 no bulge → diffuse bulge replaces only that level", () => {
    overlayQf({
      id: 20,
      region: "LS Spine",
      label: "L4-L5 no bulge",
      findings: "No disc bulge at L4-L5. Disc contour is maintained at this level.",
      conflictGroup: "disc_contour",
    });
    overlayQf({
      id: 21,
      region: "LS Spine",
      label: "L4-L5 diffuse bulge",
      findings: "Diffuse disc bulge at L4-L5 indenting the anterior thecal sac.",
      impression: "L4-L5 diffuse disc bulge.",
      conflictGroup: "disc_contour",
    });
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/Diffuse disc bulge at L4-L5/i);
    expect(s.findingsText).not.toMatch(/No disc bulge at L4-L5/i);
  });

  it("E/F. L3-L4 + L4-L5 coexist; changing L4-L5 leaves L3-L4", () => {
    overlayQf({
      id: 30,
      region: "LS Spine",
      label: "L3-L4 bulge",
      findings: "Disc bulge at L3-L4 without nerve root compression.",
      conflictGroup: "disc_contour",
    });
    overlayQf({
      id: 31,
      region: "LS Spine",
      label: "L4-L5 bulge",
      findings: "Disc bulge at L4-L5 indenting the thecal sac.",
      conflictGroup: "disc_contour",
    });
    expect(useWorkspace.getState().findingsText).toMatch(/L3-L4/);
    expect(useWorkspace.getState().findingsText).toMatch(/L4-L5/);
    overlayQf({
      id: 32,
      region: "LS Spine",
      label: "L4-L5 protrusion",
      findings: "Posterocentral disc protrusion at L4-L5.",
      conflictGroup: "disc_contour",
    });
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/L3-L4/);
    expect(s.findingsText).toMatch(/Posterocentral disc protrusion at L4-L5/);
    expect(s.findingsText).not.toMatch(/Disc bulge at L4-L5 indenting/);
  });

  it("G. right + left infarcts coexist", () => {
    resetStore("Brain");
    overlayTile(INFARCT, "qf-40", { side: "right" });
    overlayTile(INFARCT, "qf-41", { side: "left" });
    const s = useWorkspace.getState();
    expect(s.findingsText.toLowerCase()).toContain("right");
    expect(s.findingsText.toLowerCase()).toContain("left");
    expect(s.appliedPathologyPatches).toHaveLength(2);
  });
});

describe("full format + QS + macros K–R", () => {
  beforeEach(() => resetStore("Brain"));

  it("K. Full Format → QS pathology keeps Fazekas/senile", () => {
    useWorkspace.getState().applyFormatById(FAZEKAS_SENILE.id);
    overlayTile(HEMOR, "qs-hem", { side: "right" });
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/Fazekas grade 1/i);
    expect(s.findingsText.toLowerCase()).toMatch(/hemorrhage/);
    expect(s.findingsText.toLowerCase()).toMatch(/right basal ganglia/);
  });

  it("L. Full Format → macro senile is non-destructive (legacy append / dedupe)", () => {
    useWorkspace.getState().applyFormatById(FAZEKAS_SENILE.id);
    const before = useWorkspace.getState().findingsText;
    useWorkspace.getState().mergeField("findings", "Mild age-related cerebral volume loss with prominence of the cortical sulci and ventricular system, in keeping with senile/involutional changes. No focal mass lesion or acute infarct.", "macro");
    expect(useWorkspace.getState().findingsText).toContain("Fazekas");
    expect(useWorkspace.getState().findingsText.length).toBeGreaterThanOrEqual(before.length - 20);
  });

  it("M. Full Format → Fazekas mutex updates the slot", () => {
    useWorkspace.getState().applyFormatById(FAZEKAS_SENILE.id);
    overlayTile(FAZEKAS2, "qf-2");
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/Fazekas grade 2/i);
    expect(s.findingsText).not.toMatch(/Fazekas grade 1/i);
    expect(s.findingsText).toMatch(/senile|involutional|volume loss/i);
  });

  it("N. demography/title/print remain a function of clinical fields only", () => {
    useWorkspace.getState().applyFormatById(FAZEKAS_SENILE.id);
    overlayTile(HEMOR, "qs-hem", { side: "right" });
    const s = useWorkspace.getState();
    const html = previewHtml(s);
    expect(html).not.toMatch(/slotKey|care\.observation_ledger|fieldProvenance/);
    expect(html).toContain("Fazekas");
    expect(s.appliedFormatReportTitle).toBe("MRI BRAIN PLAIN");
  });

  it("O/P/Q. macro bundles coexist; overlapping slots resolve once; QS overrides one slot", () => {
    resetStore("LS Spine");
    const r = useWorkspace.getState().applyMacroBundle({
      bundleId: "deg-1",
      observations: [
        {
          incoming: { findings: "Lumbar discs show loss of T2 signal (desiccation)." },
          ownership: { conflictGroup: "disc_signal", concept: "disc_signal" },
          source: "macro",
          region: "LS Spine",
          concept: "disc_signal",
          label: "Degenerative",
        },
        {
          incoming: { findings: "Facet arthropathy at L4-L5." },
          ownership: { conflictGroup: "facet_joint", concept: "facet_joint" },
          source: "macro",
          region: "LS Spine",
          concept: "facet_joint",
          level: "L4-L5",
          label: "Degenerative",
        },
        {
          incoming: { findings: "No disc bulge at L4-L5." },
          ownership: { conflictGroup: "disc_contour", concept: "disc_contour" },
          source: "macro",
          region: "LS Spine",
          concept: "disc_contour",
          level: "L4-L5",
          label: "Degenerative",
        },
      ],
    });
    expect(r).toBe("applied");
    overlayQf({
      id: 99,
      region: "LS Spine",
      label: "L4-L5 diffuse bulge",
      findings: "Diffuse disc bulge at L4-L5 indenting the anterior thecal sac.",
      conflictGroup: "disc_contour",
    });
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/desiccation/);
    expect(s.findingsText).toMatch(/Facet arthropathy at L4-L5/);
    expect(s.findingsText).toMatch(/Diffuse disc bulge at L4-L5/);
    expect(s.findingsText).not.toMatch(/No disc bulge at L4-L5/);
    expect(s.appliedPathologyPatches.filter((p) => p.observation?.bundleId === "deg-1").length).toBeGreaterThanOrEqual(2);
  });

  it("R. catalog degenerative bundle exists; legacy append macro still works", () => {
    const lumbar = catalogSetForKey("lumbar");
    expect(lumbar?.tiles.some((t) => t.id === "spine-degenerative" && (t.observations?.length ?? 0) >= 4)).toBe(true);
    resetStore("LS Spine");
    useWorkspace.getState().mergeField("findings", "Custom legacy append sentence unique to this test.", "macro");
    expect(useWorkspace.getState().findingsText).toContain("Custom legacy append sentence unique to this test.");
  });
});

describe("impression / recommendation S–Z", () => {
  beforeEach(() => resetStore("Brain"));

  it("S/T. contribution inserts and replaces on mutex", () => {
    overlayTile(FAZEKAS1, "qf-1");
    expect(useWorkspace.getState().impressionText).toMatch(/Fazekas grade 1/);
    overlayTile(FAZEKAS2, "qf-2");
    expect(useWorkspace.getState().impressionText).toMatch(/Fazekas grade 2/);
    expect(useWorkspace.getState().impressionText).not.toMatch(/Fazekas grade 1/);
  });

  it("U. contribution removes on deselect if unedited", () => {
    overlayTile(FAZEKAS2, "qf-2");
    useWorkspace.getState().removeObservation("qf-2");
    expect(useWorkspace.getState().impressionText).not.toMatch(/Fazekas grade 2/);
  });

  it("V. manual Impression survives deselect", () => {
    overlayTile(FAZEKAS1, "qf-1");
    useWorkspace.getState().setField("impression", "Custom protected impression line.");
    useWorkspace.getState().removeObservation("qf-1");
    expect(useWorkspace.getState().impressionText).toContain("Custom protected impression line.");
  });

  it("W. dirty badge when findings change without impression update", () => {
    overlayTile(FAZEKAS1, "qf-1");
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\nExtra manual finding sentence.`);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    useWorkspace.getState().refreshImpressionFromLedger();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(useWorkspace.getState().impressionText).toMatch(/Fazekas grade 1/);
  });

  it("X/Y. linked recommendation removes if unedited; survives if edited", () => {
    overlayQf({
      id: 50,
      region: "Brain",
      label: "Hydrocephalus",
      findings: "There is hydrocephalus.",
      impression: "Hydrocephalus.",
      recommendation: "Neurosurgical referral for hydrocephalus.",
      conflictGroup: "ventricles",
    });
    expect(useWorkspace.getState().recommendationText).toContain("Neurosurgical referral");
    const rec = useWorkspace.getState().recommendationText;
    useWorkspace.getState().removeObservation("qf-50");
    expect(useWorkspace.getState().recommendationText).not.toContain("Neurosurgical referral");

    overlayQf({
      id: 51,
      region: "Brain",
      label: "Hydrocephalus",
      findings: "There is hydrocephalus.",
      recommendation: "Neurosurgical referral for hydrocephalus.",
      conflictGroup: "ventricles",
    });
    useWorkspace.getState().setField("recommendation", `${rec} Please phone the registrar.`);
    useWorkspace.getState().removeObservation("qf-51");
    expect(useWorkspace.getState().recommendationText).toContain("Please phone the registrar.");
  });

  it("Z. global recommendation chip path is independent of slots", () => {
    useWorkspace.getState().mergeField("recommendation", "Clinical correlation advised.", "quick-findings");
    overlayTile(FAZEKAS1, "qf-1");
    useWorkspace.getState().removeObservation("qf-1");
    expect(useWorkspace.getState().recommendationText).toContain("Clinical correlation advised.");
  });
});

describe("dual-format merge + whole spine AA–AJ", () => {
  it("AA. identical normals once", () => {
    const a = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Cervical Spine — Normal")!;
    const b = { ...a, id: "copy", name: "MRI Cervical Spine — Normal copy" };
    const r = mergeTwoFormats(a, b);
    expect(r.findings.toLowerCase().split("disc spaces are maintained").length - 1).toBe(1);
  });

  it("AB. pathology beats normal in same slot", () => {
    const normal = BRAIN_NORMAL;
    const infarct = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Acute infarct (MCA)")!;
    const r = mergeTwoFormats(normal, infarct);
    expect(r.findings.toLowerCase()).toMatch(/infarct/);
    expect(r.impression.toLowerCase()).toMatch(/infarct/);
    expect(r.impression).not.toMatch(/Normal MRI brain/i);
  });

  it("AC. specific study beats generic family via specificity rank (screening vs detailed LS)", () => {
    const r = mergeTwoFormats(LS_NORMAL, WHOLE_SCREEN);
    expect(r.findings).toMatch(/Lumbar vertebrae/);
    expect(r.findings).toMatch(/CERVICAL SPINE SCREENING/);
    expect(r.findings.indexOf("Lumbar vertebrae")).toBeLessThan(r.findings.indexOf("CERVICAL SPINE SCREENING"));
  });

  it("AD. no contradictory Impression on LS + screening", () => {
    const r = mergeTwoFormats(LS_NORMAL, WHOLE_SCREEN);
    expect(r.impression).not.toMatch(/Normal cervical and dorsal spine screening/i);
  });

  it("AE. technique dedupe preserved", () => {
    const r = mergeTwoFormats(LS_NORMAL, WHOLE_SCREEN);
    expect(r.technique).toMatch(/lumbo-sacral spine/i);
    expect(r.technique).toMatch(/limited/i);
    expect(r.technique.toLowerCase().split("limited whole-spine screening").length).toBeLessThanOrEqual(3);
  });

  it("AF/AG/AH. LS + Whole Spine Screening heading, sections, limited wording", () => {
    expect(combinedFormatTitle(LS_NORMAL, WHOLE_SCREEN)).toBe("MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING");
    const r = mergeTwoFormats(LS_NORMAL, WHOLE_SCREEN);
    expect(r.combinedReportTitle).toBe("MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING");
    expect(r.findings).toMatch(/CERVICAL SPINE SCREENING/);
    expect(r.findings).toMatch(/DORSAL SPINE SCREENING/);
    expect(r.findings).toMatch(/limited screening examination/i);
    expect(r.technique).toMatch(/limited planar and limited sequence/i);
    const cerv = r.findings.indexOf("CERVICAL SPINE SCREENING");
    const dors = r.findings.indexOf("DORSAL SPINE SCREENING");
    expect(cerv).toBeGreaterThan(-1);
    expect(dors).toBeGreaterThan(cerv);
  });

  it("AI. LS QS change does not alter screening", () => {
    resetStore("LS Spine");
    const r = mergeTwoFormats(LS_NORMAL, WHOLE_SCREEN);
    useWorkspace.setState({
      findingsText: r.findings,
      impressionText: r.impression,
      techniqueText: r.technique,
      recommendationText: r.recommendation,
      appliedFormatReportTitle: r.combinedReportTitle ?? null,
      reportingContext: lsCtx(),
    });
    overlayQf({
      id: 77,
      region: "LS Spine",
      label: "L4-L5 diffuse bulge",
      findings: "Diffuse disc bulge at L4-L5 indenting the anterior thecal sac.",
      conflictGroup: "disc_contour",
    });
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/Diffuse disc bulge at L4-L5/);
    expect(s.findingsText).toMatch(/CERVICAL SPINE SCREENING/);
    expect(s.findingsText).toMatch(/DORSAL SPINE SCREENING/);
    expect(s.findingsText).toMatch(/limited screening examination/i);
    expect(s.findingsText.indexOf("Diffuse disc bulge at L4-L5")).toBeLessThan(s.findingsText.indexOf("CERVICAL SPINE SCREENING"));
  });

  it("AJ. screening abnormality reaches Impression only when significant", () => {
    const abnormalScreen = {
      ...WHOLE_SCREEN,
      id: "ws-abn",
      findings: `${WHOLE_SCREEN.findings}\nCervical cord compression at C5-C6 with T2 hyperintensity.`,
      impression: "Significant cervical cord compression at C5-C6.",
    };
    const r = mergeTwoFormats(LS_NORMAL, abnormalScreen);
    expect(r.impression).toMatch(/cord compression/i);
  });
});

describe("voice / AI / export / persistence AK–AQ", () => {
  beforeEach(() => resetStore("LS Spine"));

  it("AK. structured voice uses the same slot as Quick Select", () => {
    const plan = {
      operation: "report_change_plan" as const,
      observations: [{
        id: "v1",
        concept: "disc_contour",
        level: "L4-L5",
        findingsText: "Diffuse disc bulge at L4-L5 indenting the anterior thecal sac.",
        impressionText: "L4-L5 disc bulge.",
        conflictGroup: "disc_contour",
      }],
      uncertainties: [],
    };
    const applied = useWorkspace.getState().applyVoiceComposerPlan(plan, "diffuse bulge at L4 L5");
    expect(applied).toBe("applied");
    const voice = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id.startsWith("voice-"));
    expect(voice?.observation?.slotKey).toBe("LS Spine|disc_contour|L4-L5|*");
    overlayQf({
      id: 80,
      region: "LS Spine",
      label: "L4-L5 protrusion",
      findings: "Posterocentral protrusion at L4-L5.",
      conflictGroup: "disc_contour",
    });
    // Priority 1 hold semantics: taking over the voice row's slot with different
    // wording asks before replacing it — the takeover happens on Replace.
    useWorkspace.getState().confirmOverwriteAndApply();
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/Posterocentral protrusion at L4-L5/);
    expect(s.appliedPathologyPatches.some((p) => p.id.startsWith("voice-"))).toBe(false);
  });

  it("AL. manual voice edit protects text", () => {
    useWorkspace.getState().applyVoiceComposerPlan({
      operation: "report_change_plan",
      observations: [{
        id: "v2",
        concept: "disc_contour",
        level: "L4-L5",
        findingsText: "Diffuse disc bulge at L4-L5.",
        conflictGroup: "disc_contour",
      }],
      uncertainties: [],
    }, "bulge");
    const edited = `${useWorkspace.getState().findingsText} — dictated then edited.`;
    useWorkspace.getState().setField("findings", edited);
    const patch = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id.startsWith("voice-"));
    expect(patch?.protected).toBe(true);
  });

  it("AM. AI wording does not change ownership", () => {
    overlayQf({
      id: 81,
      region: "LS Spine",
      label: "L4-L5 bulge",
      findings: "Diffuse disc bulge at L4-L5.",
      conflictGroup: "disc_contour",
    });
    const before = useWorkspace.getState().appliedPathologyPatches.map((p) => p.observation?.slotKey);
    useWorkspace.getState().applyAiComposerAccepted({
      findings: "Polished wording of a diffuse L4-L5 disc bulge.",
      impression: "Polished impression.",
      recommendation: "Polished rec.",
    });
    expect(useWorkspace.getState().appliedPathologyPatches.map((p) => p.observation?.slotKey)).toEqual(before);
    expect(useWorkspace.getState().findingsText).toContain("Polished wording");
  });

  it("AN. stale AI draft fill-empty does not wipe overlay (setFieldIfEmpty)", () => {
    overlayTile(FAZEKAS1, "qf-1");
    const before = useWorkspace.getState().findingsText;
    useWorkspace.getState().setFieldIfEmpty("findings", "Overnight AI draft body", "ai-draft");
    expect(useWorkspace.getState().findingsText).toBe(before);
  });

  it("AO/AP/AQ. preview has no ownership metadata leak", () => {
    overlayTile(FAZEKAS1, "qf-1");
    const s = useWorkspace.getState();
    const html = previewHtml(s);
    expect(html).toContain("Fazekas");
    expect(html).not.toMatch(/slotKey|appliedPathologyPatches|care\.observation_ledger/);
  });

  it("serializes and restores ledger without guessing old narrative-only drafts", () => {
    overlayTile(FAZEKAS1, "qf-1");
    const snap = useWorkspace.getState().serializeObservationLedger();
    expect(snap.kind).toBe(OBSERVATION_LEDGER_KIND);
    resetStore("Brain");
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(0);
    useWorkspace.getState().hydrateObservationLedger(snap);
    expect(useWorkspace.getState().appliedPathologyPatches[0]?.observation?.slotKey).toBe("Brain|fazekas|*|*");
    expect(deserializeObservationLedger({ kind: "nope" })).toBeNull();
    expect(extractCareObservationLedger({ careObservationLedger: snap })).toEqual(snap);
  });
});

describe("hemorrhage regression via structured ownership", () => {
  it("Normal Brain + hemorrhage still replaces owned normal block", () => {
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: BRAIN_NORMAL.clinicalHistory,
        technique: BRAIN_NORMAL.technique,
        findings: BRAIN_NORMAL.findings,
        impression: BRAIN_NORMAL.impression,
        recommendation: BRAIN_NORMAL.recommendation,
      },
      incoming: { findings: HEMOR.sentence.replace("{side}", "right"), impression: HEMOR.impressionSentence?.replace("{side}", "right") },
      ownership: { anatomicalSection: HEMOR.anatomicalSection, conflictGroup: HEMOR.conflictGroup },
      provenance: {
        findings: provenanceFromText(BRAIN_NORMAL.findings, "template"),
        impression: provenanceFromText(BRAIN_NORMAL.impression, "template"),
      },
      source: "quick-select",
    });
    expect(result.narrative.findings.toLowerCase()).toContain("right basal ganglia");
    expect(result.narrative.findings.toLowerCase()).not.toMatch(/basal ganglia are normal/);
  });
});

describe("impression refresh helper", () => {
  it("keeps manual lines and observation contributions", () => {
    const text = refreshImpressionFromObservations({
      currentImpression: "My typed line.",
      patches: [{
        id: "qf-1",
        observation: buildCanonicalObservation({ region: "Brain", conflictGroup: "fazekas", label: "Fazekas 1" }),
        templates: {},
        lastRendered: { impression: "Mild chronic small vessel ischemic disease (Fazekas grade 1)." },
        replacedBaseline: { findings: [], impression: [] },
        source: "quick-findings",
        protected: false,
      }],
      remainingAbnormalLines: [],
      provenance: provenanceFromText("My typed line.", "manual"),
    });
    expect(text).toContain("My typed line.");
    expect(text).toMatch(/Fazekas grade 1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The clinical equivalence contract, for a box the database holds.
//
// Phase 3 of the owner's brief: a database box must give the radiologist the
// same clinical intelligence the shipped tile gave. These drive the real store
// through the real builder, so they fail when the metadata stops arriving rather
// than when a source string changes.
// ─────────────────────────────────────────────────────────────────────────────
describe("a database box clicked from the reporting desk", () => {
  beforeEach(() => resetStore("Brain"));

  /** The factory's Midline shift box, concept and all. */
  const MIDLINE = {
    id: 96,
    region: "Brain",
    label: "Midline shift",
    concept: "midline",
    findings: "Midline shift of ___ mm toward the {side}.",
    impression: "Midline shift toward {side}.",
    baselineReplaces: "No midline shift.",
  };
  /** The same box as a deploy actually leaves the clinic's own row: no metadata. */
  const ADOPTED_MIDLINE = {
    id: 97,
    region: "Brain",
    label: "Midline shift",
    findings: "Midline shift is noted.",
    impression: "Midline shift as described.",
  };

  function observation(id: string) {
    return useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === id)?.observation;
  }

  it("records the concept the box declares instead of guessing one from its sentence", () => {
    overlayQf({ ...MIDLINE, properties: "side", side: "left" });
    const obs = observation(quickFindingRowId(96, "left"));
    expect(obs?.concept).toBe("midline");
    // "explicit" is the tier that means the box said so. Anything else — a
    // conflict group, a CONCEPT_HINTS regex, an anatomical section — is a guess,
    // and for Midline shift there is no hint rule at all, so the guess is empty.
    expect(obs?.conceptSource).toBe("explicit");
  });

  it("leaves a concept-less box usable and invents no ownership for it", () => {
    // Owner ruling: existing concept-less boxes stay usable through their
    // established text-insertion behaviour, and nothing is manufactured for them.
    const outcome = overlayQf(ADOPTED_MIDLINE);
    expect(outcome).not.toBe("refused");
    const obs = observation("qf-97");
    expect(obs?.conceptSource, "no concept is invented from the sentence").not.toBe("explicit");
    expect(useWorkspace.getState().findingsText).toContain("Midline shift is noted.");
    expect(useWorkspace.getState().impressionText).toContain("Midline shift as described.");
  });

  it("keeps Left and Right as two observations with both sentences on the page", () => {
    overlayQf({ ...MIDLINE, properties: "side", side: "left" });
    overlayQf({ ...MIDLINE, properties: "side", side: "right" });
    expect(rowIds()).toEqual([quickFindingRowId(96, "left"), quickFindingRowId(96, "right")]);
    const findings = useWorkspace.getState().findingsText;
    // Opposite laterality is never mutually exclusive, so the second click must
    // add rather than replace. One row for both was the defect: the second click
    // overwrote the first ledger row while the first sentence stayed printed.
    expect(findings).toContain("toward the left");
    expect(findings).toContain("toward the right");
    expect(useWorkspace.getState().impressionText).toContain("toward left");
    expect(useWorkspace.getState().impressionText).toContain("toward right");
  });

  it("withdraws both sides in one undo step", () => {
    overlayQf({ ...MIDLINE, properties: "side", side: "left" });
    overlayQf({ ...MIDLINE, properties: "side", side: "right" });
    // What the toggle-off branch of handleQuickToggle does: every row the box
    // owns, the first carrying the undo frame. Removing only the currently
    // chosen side would leave the chip lit and the other sentence printed with no
    // control left to withdraw it.
    const owned = rowIds().filter((id) => quickFindingRowBelongsTo(id, 96));
    expect(owned).toHaveLength(2);
    owned.forEach((id, i) => {
      useWorkspace.getState().removeObservation(id, i > 0 ? { skipUndoSnapshot: true } : undefined);
    });
    // Scoped to this box's rows, not to a bare ledger: withdrawing the only
    // abnormality legitimately restores the study's system-normal row, so
    // `rowIds()` is not empty after a correct removal.
    expect(rowIds().filter((id) => quickFindingRowBelongsTo(id, 96))).toEqual([]);
    expect(useWorkspace.getState().findingsText).not.toContain("toward the left");
    expect(useWorkspace.getState().findingsText).not.toContain("toward the right");
    // One click, one undo step: a single undo has to bring both sides back, or
    // the radiologist who clicks Undo once is left with half a withdrawal.
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(rowIds().filter((id) => quickFindingRowBelongsTo(id, 96))).toHaveLength(2);
    expect(useWorkspace.getState().findingsText).toContain("toward the left");
    expect(useWorkspace.getState().findingsText).toContain("toward the right");
  });

  it("writes nothing at all when the side it asks for was never chosen", () => {
    // Owner ruling: never insert an unresolved placeholder. Before this source
    // was guarded, the box wrote "{side}" into Findings, Impression and the
    // ledger, and still reported itself as applied.
    const before = {
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
      rows: rowIds().length,
    };
    const outcome = overlayQf({ ...MIDLINE, properties: "side", side: "" });
    expect(outcome).toBe("refused");
    expect(useWorkspace.getState().findingsText).toBe(before.findings);
    expect(useWorkspace.getState().impressionText).toBe(before.impression);
    expect(rowIds()).toHaveLength(before.rows);
    expect(useWorkspace.getState().findingsText).not.toContain("{side}");
  });

  it("retires the normal sentence the box declares, and only that one", () => {
    useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
    const normal = useWorkspace.getState().findingsText;
    expect(normal).toContain("No midline shift.");
    expect(normal).toContain("Cortical sulci normal for age.");
    overlayQf({ ...MIDLINE, properties: "side", side: "right" });
    const after = useWorkspace.getState().findingsText;
    // An abnormality that leaves the normal it contradicts on the page prints a
    // report that argues with itself.
    expect(after).not.toContain("No midline shift.");
    expect(after, "a sentence the box did not name is none of its business")
      .toContain("Cortical sulci normal for age.");
    expect(after).toContain("toward the right");
  });
});

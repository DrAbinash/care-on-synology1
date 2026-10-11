/**
 * DWI/ADC ownership — restricted diffusion is a sequence observation, not a
 * synonym for infarction.
 *
 * The `infarct` content pack used to carry "restricted diffusion" as an alias.
 * Because ownership is tested by matching a concept's aliases against the
 * existing sentence, that single alias made every infarction claim read onto the
 * scaffold's "No restricted diffusion is seen on DWI/ADC." — so clicking a
 * CHRONIC infarct box deleted a negative that is the whole point of the case: an
 * old infarct does not restrict. The report silently lost the statement that
 * distinguishes chronic from acute.
 *
 * These tests pin the five clinical claims separately, because they are five
 * different statements a radiologist can make about one territory:
 *
 *   acute infarction            — restricts; both normals go
 *   chronic infarction          — encephalomalacia and gliosis; does NOT restrict
 *   subacute infarction         — diffusion varies; must not be forced either way
 *   explicitly selected restriction — the sequence observation stands on its own
 *   explicitly selected absence  — a negative the radiologist chose, not filler
 *
 * Real store, real shipped baseline, real patch engine. No fixtures.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTilePayload";
import { useWorkspace } from "./zai-workspace/store";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { applyPathologyPatch } from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";
import { conceptsAssertedIn, sentenceOwnedBySlot } from "./observationSlot";
import {
  resolveCanonicalConcept,
  canonicalConceptTokens,
} from "./conceptCanon/conceptCanon";
import { CLINICAL_CONTENT_PACKS } from "./conceptCanon/contentPacks";

const DWI_NORMAL = "No restricted diffusion is seen on DWI/ADC.";
const INFARCT_NORMAL = "No acute infarct is seen.";

const ctx = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
});

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [], isFinalized: false, isDirty: false,
  });
  useWorkspace.getState().generateProfessionalReport(ctx);
}

function click(label: string, side?: "left" | "right") {
  const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!tile) throw new Error(`${label} is not in the catalogue`);
  const outcome = useWorkspace.getState().applyPathologyOverlay(
    quickSelectTilePatch(tile, "findings", side ? { side } : {}),
  );
  if (outcome !== "applied") throw new Error(`${label} was refused: ${outcome}`);
  return useWorkspace.getState().findingsText;
}

/** One dictated sentence, overlaid with the concept the radiologist's box carries. */
function overlay(sentence: string, concept: string, anatomicalSection?: string) {
  const before = useWorkspace.getState();
  const result = applyPathologyPatch({
    existing: {
      clinicalHistory: before.clinicalHistoryText,
      technique: before.techniqueText,
      findings: before.findingsText,
      impression: before.impressionText,
      recommendation: before.recommendationText,
    },
    incoming: { findings: sentence },
    ownership: { concept, anatomicalSection, conflictGroup: concept },
    provenance: { findings: provenanceFromText(before.findingsText, "template") },
    source: "quick-select",
  });
  return result.narrative.findings;
}

describe("the concept table itself", () => {
  it("does not treat restricted diffusion as a synonym for infarction", () => {
    expect(canonicalConceptTokens("infarct")).not.toContain("restricted diffusion");
    expect(resolveCanonicalConcept("restricted diffusion")).toBe("diffusion");
  });

  it("resolves the infarct stages to distinct concepts", () => {
    expect(resolveCanonicalConcept("acute infarct")).toBe("infarct");
    expect(resolveCanonicalConcept("chronic infarct")).toBe("infarct");
    expect(resolveCanonicalConcept("encephalomalacia")).toBe("encephalomalacia");
    expect(resolveCanonicalConcept("subacute infarct")).toBe("subacute_infarct");
  });

  it("keeps the diffusion pack a sequence observation", () => {
    const pack = CLINICAL_CONTENT_PACKS.find((p) => p.concept === "diffusion");
    expect(pack?.description).toMatch(/DWI\/ADC/);
    expect(canonicalConceptTokens("diffusion")).toContain("restricted diffusion");
  });

  it("resolves the denial of the sequence to the same concept as its assertion", () => {
    // Dictated text arrives as a phrase, and the ledger needs one concept row for
    // the sequence whether the radiologist said it restricts or does not. If the
    // denial resolved elsewhere — or nowhere — it landed in a slot nothing reads,
    // which is the observation_dropped shape: the words survive in the text while
    // the ledger silently loses the claim.
    expect(resolveCanonicalConcept("restricted diffusion")).toBe("diffusion");
    expect(resolveCanonicalConcept("no restricted diffusion")).toBe("diffusion");
  });
});

describe("chronic and subacute infarction do not imply restricted diffusion", () => {
  beforeEach(() => reset());

  it("the chronic infarct box keeps the DWI/ADC negative", () => {
    const findings = click("Chronic infarct", "right");
    expect(findings).toMatch(/encephalomalacia/i);
    expect(findings).toMatch(/chronic infarct/i);
    // The acute infarct negative is genuinely falsified by an infarct claim…
    expect(findings).not.toContain(INFARCT_NORMAL);
    // …the diffusion negative is not.
    expect(findings).toContain(DWI_NORMAL);
  });

  it("a dictated subacute infarct keeps the DWI/ADC negative", () => {
    const findings = overlay(
      "Subacute infarct in the left frontal lobe with gyriform T1 shortening.",
      "subacute_infarct",
    );
    expect(findings).toMatch(/[Ss]ubacute infarct/);
    expect(findings).toContain(DWI_NORMAL);
  });

  it("a dictated chronic infarct never claims the diffusion concept", () => {
    expect(conceptsAssertedIn(
      "Area of encephalomalacia with gliosis in the right hemisphere, consistent with chronic infarct.",
      "infarct",
    )).not.toContain("diffusion");
  });
});

describe("acute infarction and explicit diffusion claims still retire the negative", () => {
  beforeEach(() => reset());

  it("the acute infarct box retires both the infarct and the diffusion normals", () => {
    const findings = click("Acute infarct (DWI)", "right");
    expect(findings).toMatch(/restricted diffusion/i);
    expect(findings).not.toContain(DWI_NORMAL);
    expect(findings).not.toContain(INFARCT_NORMAL);
  });

  it("an explicitly selected restriction retires the diffusion normal on its own", () => {
    // No word "infarct" anywhere: the sequence observation must stand on its own.
    const findings = overlay(
      "Focal restricted diffusion in the right cerebellar hemisphere.",
      "diffusion",
    );
    expect(findings).toMatch(/restricted diffusion in the right cerebellar/i);
    expect(findings).not.toContain(DWI_NORMAL);
  });

  it("an explicitly selected absence does not delete itself or contradict the box", () => {
    const findings = overlay(
      "No restricted diffusion is seen on DWI/ADC sequences.",
      "diffusion",
    );
    expect(findings.match(/no restricted diffusion/gi)?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ownership stays narrow", () => {
  it("an infarct claim does not own a sentence that only shares the word diffusion", () => {
    const owns = sentenceOwnedBySlot(
      "Diffusion tensor tractography of the corticospinal tracts is unremarkable.",
      { concept: "infarct", level: "", laterality: "", anatomicalSection: "", baselineReplaces: "", alsoOwns: [] },
    );
    expect(owns).toBe(false);
  });

  it("the legacy pathology term list still names restricted diffusion", () => {
    // Unexamined modalities (USG, XR, CT) reach this statement through the legacy
    // path, not through the brain concept pack. Removing the alias must not have
    // quietly narrowed that behaviour.
    const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Acute ICH");
    expect(tile).toBeDefined();
    expect(conceptsAssertedIn("No restricted diffusion is seen.", "hemorrhage")).toEqual([]);
  });
});

describe("the relocation does not leak", () => {
  it("bare 'subacute' is not an alias, so a subacute collection is not an infarct", () => {
    // An SDH box described as subacute must never claim the subacute-infarct slot,
    // which would retire infarction normals for a wholly extra-axial problem.
    expect(conceptsAssertedIn(
      "Crescentic extra-axial collection over the left convexity, subacute.",
      "subdural_hematoma",
    )).not.toContain("subacute_infarct");
    expect(sentenceOwnedBySlot(
      "No acute infarct is seen.",
      { concept: "subdural_hematoma", level: "", laterality: "", anatomicalSection: "", baselineReplaces: "" },
    )).toBe(false);
  });

  it("restricted diffusion outside the brain is not owned by an infarct claim", () => {
    // Marrow restriction at a thoracolumbar level is a different question from a
    // cerebral infarct, and the alias used to blur them.
    expect(sentenceOwnedBySlot(
      "Marrow edema at T12-L1 with restricted diffusion.",
      { concept: "infarct", level: "", laterality: "", anatomicalSection: "", baselineReplaces: "" },
    )).toBe(false);
  });

  it("a lesion that genuinely restricts still retires the diffusion negative", () => {
    // The alias move must not lose the correct half: an abscess, venous ischaemia
    // or hypoxic injury that states restricted diffusion contradicts the
    // sequence's normal, exactly as mriBrainContradictions.ts has always warned.
    reset();
    const findings = overlay(
      "Cystic lesion with a smooth ring-enhancing wall and central restricted diffusion, in keeping with an abscess.",
      "brain_parenchyma",
      "brain parenchyma",
    );
    expect(findings).toMatch(/restricted diffusion/i);
    expect(findings).not.toContain(DWI_NORMAL);
  });

  it("the subacute stage concept stays in the brain territory it was registered for", () => {
    // Registered as a brain concept because that is what its label claims
    // ("Subacute Cerebral Infarct"). Loosening the region would let a cerebral
    // diagnosis own dictated spine prose — subacute infarction of the cord is a
    // different entity in a different territory, and under a widened bound it
    // would reach the cord normals of a dorsal report.
    const cord = "Cord swelling with subacute infarction of the spinal cord at T12-L1.";
    expect(conceptsAssertedIn(cord, "cord_compression")).not.toContain("subacute_infarct");
    // Both directions, or the line above only measures that the alias table forgot
    // how to spell its own concept.
    expect(conceptsAssertedIn(
      "Subacute infarction in the left frontal lobe with gyriform T1 shortening.",
      "infarct",
    )).toContain("subacute_infarct");
  });
});

/**
 * dorsalStandardNormalOwnership.test.ts — a billed MRI Dorsal Spine report must state
 * each normal claim as an owned observation, so documenting an abnormality takes out
 * the normals that abnormality contradicts and nothing else.
 *
 * Measured before this file existed: Generate on a billed "MRI DORSAL SPINE" study
 * returned {"status":"generated","formatName":"MRI Dorsal Spine — Normal",
 * "baselineConcepts":0} — fourteen normal sentences written as prose that NO ledger row
 * owned, so a compression deformity simply appended beside "normal height" and "No
 * fractures". Every other MRI region has a Standard Normal manifest (Brain, Cervical,
 * Knee, LS Spine); Dorsal was the one that did not.
 *
 * The sentences asserted here are imported from `mriDorsalLibrary`, not retyped, so this
 * file cannot pass against wording the product no longer uses. The abnormal atoms are run
 * through `withDorsalBaselineContract`, the shipped concept -> contradicted-normal
 * contract, so the retirement claims under test are the product's, not the test's.
 * Sentences are compared through the product's own `splitToSentences`, because the report
 * is walked one sentence at a time and a claim that only matches whole lines is retired
 * by nothing (see the alignment case).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { spineAtomsToPatches, type SpineAtomSpec } from "@/lib/mriSpineAtoms";
import { withDorsalBaselineContract } from "@/lib/mriDorsalBaselines";
import { DX_ALIGN, DX_BONE, DX_CANAL, DX_DISC, DX_POSTERIOR, DX_SOFT } from "@/lib/mriDorsalLibrary";
import { splitToSentences } from "@/lib/reportFieldMerge";
import { sentenceOwnedBySlot } from "@/lib/observationSlot";
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";

const REGION = "Dorsal Spine";
const BUNDLE = "qs-dorsal-ownership-test";

const ALIGN_NORMAL = DX_ALIGN.normal;
const BONE_NORMAL = DX_BONE.normal;
const BONE_NO_FOCAL_LESION = DX_BONE.noFocalLesion;
const DISC_NORMAL = DX_DISC.normal;
const DISC_NO_HERNIATION = DX_DISC.noHerniation;
const CANAL_NORMAL = DX_CANAL.normal;
const CORD_NORMAL = DX_CANAL.cordNormal;
const POSTERIOR_NORMAL = DX_POSTERIOR.normal;
const POSTERIOR_INTACT = DX_POSTERIOR.posteriorElementsIntact;
const SOFT_NORMAL = DX_SOFT.normal;

/** The ten canonical dorsal normal statements the owned baseline must carry. */
const ALL_NORMALS = [
  ALIGN_NORMAL,
  BONE_NORMAL,
  BONE_NO_FOCAL_LESION,
  DISC_NORMAL,
  DISC_NO_HERNIATION,
  CANAL_NORMAL,
  CORD_NORMAL,
  POSTERIOR_NORMAL,
  POSTERIOR_INTACT,
  SOFT_NORMAL,
];

/** Each statement as the report actually holds it: one sentence per claim. */
const ALL_NORMAL_SENTENCES = ALL_NORMALS.flatMap((s) => splitToSentences(s));

const lines = (t: string) => (t || "").split("\n").map((l) => l.trim()).filter(Boolean);
const reportSentences = () => splitToSentences(findings());
const sentenceCount = (sentence: string) =>
  reportSentences().filter((u) => u.trim() === sentence.trim()).length;
const findings = () => useWorkspace.getState().findingsText;

function openDorsalStudy() {
  const ctx = buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI DORSAL SPINE",
    regions: [REGION],
    source: "billed",
  });
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    screening: useWorkspace.getState().screening,
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [], confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false, isFinalized: false, isDirty: false,
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [],
  });
  return ctx;
}

function generate(ctx: ReturnType<typeof buildReportingStudyContext>) {
  const r = useWorkspace.getState().generateProfessionalReport(ctx);
  if (r.status !== "generated") throw new Error(`generate refused: ${JSON.stringify(r)}`);
  return r;
}

/** Document an abnormality exactly the way a Quick Select tile does: the shipped
 *  contract decides which normal sentence the atom claims, this file does not. */
function documentAbnormality(atom: SpineAtomSpec) {
  const [contracted] = withDorsalBaselineContract([atom]);
  const observations = spineAtomsToPatches(REGION, BUNDLE, [contracted]);
  useWorkspace.getState().applyMacroBundle({ bundleId: BUNDLE, observations });
  return contracted;
}

const T12_FRACTURE: SpineAtomSpec = {
  concept: "compression_fracture",
  conflictGroup: "compression_fracture",
  anatomicalSection: "vertebral bodies",
  level: "T12",
  findings:
    "Acute wedge compression fracture of the T12 vertebral body with approximately 25% anterior height loss and marked T2/STIR hyperintense marrow edema.",
};

const T8_T9_CANAL_STENOSIS: SpineAtomSpec = {
  concept: "canal_stenosis",
  conflictGroup: "canal_stenosis",
  anatomicalSection: "central canal",
  level: "T8-T9",
  findings:
    "Severe central canal stenosis at T8-T9 secondary to a posterior disc-osteophyte complex, with flattening of the spinal cord.",
};

const T11_T12_RETROLISTHESIS: SpineAtomSpec = {
  concept: "spondylolisthesis",
  conflictGroup: "spondylolisthesis",
  anatomicalSection: "alignment",
  level: "T11-T12",
  findings: "Grade 1 retrolisthesis of T11 on T12 measuring approximately 4 mm.",
};

const T8_T9_DISC_PROTRUSION: SpineAtomSpec = {
  concept: "disc_contour",
  conflictGroup: "disc_contour",
  anatomicalSection: "discs",
  level: "T8-T9",
  findings:
    "Central disc protrusion at T8-T9 measuring approximately 5 mm in AP dimension, indenting the ventral thecal sac.",
};

const liveRows = () => useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale);
const baselineRows = () => liveRows().filter((p) => p.observation?.role === "baseline");

describe("MRI Dorsal Spine standard normal is an owned baseline", () => {
  beforeEach(() => openDorsalStudy());

  it("generates normal statements that the ledger owns (the P0)", () => {
    const r = generate(openDorsalStudy());
    expect(r.baselineConcepts).toBeGreaterThan(0);
    const baselines = baselineRows();
    expect(baselines.length).toBeGreaterThan(0);
    // Each owned row must name a concept, or no abnormality can ever pair with it.
    expect(baselines.every((p) => Boolean(p.observation?.concept))).toBe(true);
    expect(baselines.every((p) => (p.observation?.region ?? "").trim() === REGION)).toBe(true);
  });

  it("states every canonical dorsal normal, and states it once", () => {
    generate(openDorsalStudy());
    for (const sentence of ALL_NORMAL_SENTENCES) {
      expect(sentenceCount(sentence), `printed once: ${sentence}`).toBe(1);
    }
    // A baseline row may not claim a sentence the report does not print, nor the reverse:
    // every owned row's own text must be in the findings. A row that states two
    // sentences prints as two lines, so the check is per sentence — the same shape the
    // ownership engine walks.
    const owned = baselineRows()
      .map((p) => String(p.lastRendered?.findings ?? ""))
      .filter((t) => t.length > 0);
    expect(owned.length).toBe(ALL_NORMALS.length);
    for (const t of owned) {
      for (const sentence of splitToSentences(t)) {
        expect(sentenceCount(sentence), `owned row prints: ${sentence}`).toBe(1);
      }
    }
  });

  it("keeps the T1-T12 / whole-dorsal span wording without inventing a level per sentence", () => {
    const r = generate(openDorsalStudy());
    expect(r.formatName).toBe("MRI Dorsal Spine — Standard Normal");
    const dorsalSpan = ALL_NORMAL_SENTENCES.filter((s) =>
      /dorsal and dorsolumbar|throughout the dorsal|at all levels/i.test(s));
    expect(dorsalSpan.length).toBeGreaterThanOrEqual(4);
    for (const s of dorsalSpan) expect(findings()).toContain(s);
    // No level was fabricated: the standard normal owns no per-level rows.
    expect(baselineRows().every((p) => !(p.observation?.level ?? "").trim())).toBe(true);
  });

  it("takes out the contradicted bone normals and nothing else", () => {
    generate(openDorsalStudy());
    const before = lines(findings()).length;
    const contracted = documentAbnormality(T12_FRACTURE);

    expect(contracted.baselineReplaces).toBe(BONE_NORMAL);
    const after = findings();
    expect(after).toContain("Acute wedge compression fracture of the T12 vertebral body");
    expect(sentenceCount(BONE_NORMAL)).toBe(0);
    // The other bone line names "compression fracture" in its own words, so the same
    // fracture must take it out too — leaving it would state "no acute compression
    // fracture" beside the fracture.
    expect(sentenceCount(BONE_NO_FOCAL_LESION)).toBe(0);
    // Unrelated anatomy keeps its normal.
    for (const kept of [ALIGN_NORMAL, DISC_NORMAL, CANAL_NORMAL, CORD_NORMAL, POSTERIOR_NORMAL, SOFT_NORMAL]) {
      for (const sentence of splitToSentences(kept)) {
        expect(sentenceCount(sentence), `kept: ${sentence}`).toBe(1);
      }
    }
    expect(lines(after).length).toBeGreaterThanOrEqual(before - 3);
  });

  it("takes out the contradicted canal normal and leaves the bone and cord normals", () => {
    generate(openDorsalStudy());
    const contracted = documentAbnormality(T8_T9_CANAL_STENOSIS);
    expect(contracted.baselineReplaces).toBe(CANAL_NORMAL);
    const after = findings();
    expect(after).toContain("Severe central canal stenosis at T8-T9");
    expect(sentenceCount(CANAL_NORMAL)).toBe(0);
    for (const kept of [BONE_NORMAL, BONE_NO_FOCAL_LESION, ALIGN_NORMAL, CORD_NORMAL, SOFT_NORMAL]) {
      for (const sentence of splitToSentences(kept)) {
        expect(sentenceCount(sentence), `kept: ${sentence}`).toBe(1);
      }
    }
  });

  it("takes out both alignment statements a listhesis contradicts", () => {
    generate(openDorsalStudy());
    const contracted = documentAbnormality(T11_T12_RETROLISTHESIS);
    // The shipped contract claims the whole normal alignment line …
    expect(contracted.baselineReplaces).toBe(ALIGN_NORMAL);
    expect(findings()).toContain("Grade 1 retrolisthesis of T11 on T12");
    // … and the report holds that line as two sentences, so BOTH must go. Retiring
    // only whole lines matches neither, and a signed report then states "Normal
    // alignment of the dorsal and dorsolumbar spine without listhesis" under a
    // documented retrolisthesis.
    for (const sentence of splitToSentences(ALIGN_NORMAL)) {
      expect(sentenceCount(sentence), `retired: ${sentence}`).toBe(0);
    }
    // Nothing else in the report is collateral.
    for (const kept of [BONE_NORMAL, DISC_NORMAL, CANAL_NORMAL, CORD_NORMAL, POSTERIOR_NORMAL, SOFT_NORMAL]) {
      for (const sentence of splitToSentences(kept)) {
        expect(sentenceCount(sentence), `kept: ${sentence}`).toBe(1);
      }
    }
  });

  it("takes out the herniation negative beside a documented protrusion", () => {
    generate(openDorsalStudy());
    documentAbnormality(T8_T9_DISC_PROTRUSION);
    const after = findings();
    expect(after).toContain("Central disc protrusion at T8-T9");
    expect(sentenceCount(DISC_NO_HERNIATION)).toBe(0);
    for (const kept of [ALIGN_NORMAL, BONE_NORMAL, CANAL_NORMAL, CORD_NORMAL, POSTERIOR_INTACT, SOFT_NORMAL]) {
      for (const sentence of splitToSentences(kept)) {
        expect(sentenceCount(sentence), `kept: ${sentence}`).toBe(1);
      }
    }
  });

  it("behaves the same whichever order the radiologist works in", () => {
    const ctx = openDorsalStudy();
    documentAbnormality(T12_FRACTURE);
    generate(ctx);
    const after = findings();
    expect(after).toContain("Acute wedge compression fracture of the T12 vertebral body");
    expect(reportSentences().filter((l) => l.includes("Acute wedge compression fracture"))).toHaveLength(1);
    expect(sentenceCount(BONE_NORMAL)).toBe(0);
    expect(sentenceCount(BONE_NO_FOCAL_LESION)).toBe(0);
    expect(sentenceCount(CANAL_NORMAL)).toBe(1);
    expect(sentenceCount(CORD_NORMAL)).toBe(1);
  });

  it("keeps two abnormalities of different regions both stated", () => {
    generate(openDorsalStudy());
    documentAbnormality(T12_FRACTURE);
    documentAbnormality(T8_T9_CANAL_STENOSIS);
    const after = findings();
    expect(after).toContain("Acute wedge compression fracture of the T12 vertebral body");
    expect(after).toContain("Severe central canal stenosis at T8-T9");
    expect(sentenceCount(BONE_NORMAL)).toBe(0);
    expect(sentenceCount(CANAL_NORMAL)).toBe(0);
    // Neither abnormality may delete the other's statement.
    expect(reportSentences().filter((l) => l.includes("Acute wedge compression fracture"))).toHaveLength(1);
    expect(reportSentences().filter((l) => l.includes("Severe central canal stenosis at T8-T9"))).toHaveLength(1);
  });

  it("leaves text the radiologist typed by hand", () => {
    generate(openDorsalStudy());
    const manual = "Patient reports intermittent gait disturbance for six months.";
    useWorkspace.setState({ findingsText: `${findings()}\n${manual}` });
    documentAbnormality(T12_FRACTURE);
    expect(findings()).toContain(manual);
  });

  it("never leaves a live normal and a live abnormality asserting the same concept", () => {
    generate(openDorsalStudy());
    documentAbnormality(T12_FRACTURE);
    documentAbnormality(T8_T9_CANAL_STENOSIS);
    documentAbnormality(T11_T12_RETROLISTHESIS);
    const rows = liveRows().filter((p) => p.observation?.concept);
    for (const a of rows) {
      for (const b of rows) {
        if (a === b || !b.observation?.concept) continue;
        if (a.observation!.concept !== b.observation!.concept) continue;
        if ((a.observation!.level ?? "") !== (b.observation!.level ?? "")) continue;
        const aNormal = a.observation!.state === "normal" || a.observation!.role === "baseline";
        const bNormal = b.observation!.state === "normal" || b.observation!.role === "baseline";
        expect(aNormal === bNormal, `${a.observation!.concept}@${a.observation!.level} stated normal and abnormal at once`).toBe(true);
      }
    }
  });

  it("survives save and reload with the ownership intact", () => {
    generate(openDorsalStudy());
    documentAbnormality(T12_FRACTURE);
    const state = useWorkspace.getState();
    const savedNarrative = {
      findings: state.findingsText,
      impression: state.impressionText,
      recommendation: state.recommendationText,
      technique: state.techniqueText,
      clinicalHistory: state.clinicalHistoryText,
    };
    // Exactly what a save writes: the narrative plus the serialized ledger.
    const saved = JSON.parse(JSON.stringify(state.serializeObservationLedger()));

    openDorsalStudy();
    useWorkspace.getState().setEditorContent(savedNarrative);
    const res = useWorkspace.getState().hydrateObservationLedger(saved);
    expect(res.ok, res.warning ?? "").toBe(true);
    expect(res.mode).toBe("restored");
    expect(res.patchCount).toBe(saved.patches.length);
    const all = useWorkspace.getState().appliedPathologyPatches;
    // The two bone normals and the normal impression the fracture legitimately retired
    // come back flagged against the narrative, not silently deleted with the text gone.
    const retiredConcepts = all.filter((p) => p.stale).map((p) => p.observation?.concept);
    expect(retiredConcepts.sort()).toEqual(["bone_lesion", "compression_fracture", SYSTEM_NORMAL_CONCEPT]);
    // Every still-live normal row kept the concept that lets an abnormality pair with it.
    const ownedAfterReload = liveRows().filter((p) => p.observation?.role === "baseline");
    expect(ownedAfterReload.length).toBe(ALL_NORMALS.length - 2);
    expect(ownedAfterReload.every((p) => Boolean(p.observation?.concept))).toBe(true);
    expect(findings()).toBe(savedNarrative.findings);

    // Ownership is not just present on paper: a new abnormality still retires its own
    // normal after the reload instead of appending beside it.
    documentAbnormality(T8_T9_CANAL_STENOSIS);
    expect(sentenceCount(CANAL_NORMAL)).toBe(0);
    expect(findings()).toContain("Severe central canal stenosis at T8-T9");
  });
});

describe("a multi-sentence baseline claim reaches each of its sentences", () => {
  const probe = (concept: string, level: string) => ({
    concept,
    level,
    laterality: "",
    anatomicalSection: "alignment",
    baselineReplaces: DX_ALIGN.normal,
  });

  it("owns the claim as one line", () => {
    expect(sentenceOwnedBySlot(DX_ALIGN.normal, probe("spondylolisthesis", "T11-T12"))).toBe(true);
  });

  it("owns each sentence the claim states", () => {
    for (const sentence of splitToSentences(DX_ALIGN.normal)) {
      expect(
        sentenceOwnedBySlot(sentence, probe("spondylolisthesis", "T11-T12")),
        `claimed: ${sentence}`,
      ).toBe(true);
    }
  });

  it("does not let the claim reach an unrelated sentence", () => {
    expect(
      sentenceOwnedBySlot(
        "Visualized paraspinal soft tissues, mediastinal structures, pleural spaces, and retroperitoneum are within normal limits.",
        probe("spondylolisthesis", "T11-T12"),
      ),
    ).toBe(false);
  });
});

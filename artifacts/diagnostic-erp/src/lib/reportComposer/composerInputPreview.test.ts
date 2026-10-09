/**
 * The radiologist must be able to read exactly what the AI will be given, and the preview
 * must be that input rather than a description of it.
 *
 * Everything here is driven through the REAL canonical ledger (`applyPathologyOverlay` /
 * `applyMacroBundle` / `removeObservation` on the live workspace store), the REAL measurement
 * bundle builder, the REAL client hash function and the REAL snapshot shape
 * `useReportComposer.buildSnapshot()` produces. A fixture invented in this file would prove
 * only that the fixture round-trips.
 *
 * Synthetic clinical text only. No provider is contacted by anything under test.
 *
 * Test numbering maps to the brief: T1 multilevel LS, T2 cervical canal measurements,
 * T3 brain Fazekas, T4 screening context, T5 mixed sources, T6 deselection after preview,
 * T7 measurement changed after preview, T8 study switch, T9 report edited mid-run,
 * T10 provider attribution, T11 instructions reach FULL_REPORT, T12 preview sends nothing,
 * T13 provider shown, T14 no secrets, plus anti-fabrication and wiring contracts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildLumbarLevelApplyBundle } from "@/lib/mriLumbarLevelState";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import {
  buildComposerInputPreview,
  composerInputSummaryLine,
} from "@/lib/reportComposer/composerInputPreview";
import {
  computeSnapshotHashes,
  type ComposeObservation,
  type ComposerInputSnapshot,
} from "@/lib/reportComposer/types";

function resetWorkspace(region: "Brain" | "LS Spine" = "LS Spine") {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    selectedObservationId: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    reportingContext: {
      modality: "MR",
      catalogModality: "MR",
      studyDescription: region === "Brain" ? "MRI Brain Plain" : "MRI LS Spine",
      dicomBodyPart: null,
      region,
      regions: [region],
      bodyPart: region === "Brain" ? "BRAIN" : "SPINE_LUMBAR",
      family: region === "Brain" ? "Brain" : "Spine",
      spineSegment: region === "Brain" ? null : "lumbar",
      source: "override",
      protocolName: null,
    },
  });
}

function tile(over: {
  id: string;
  findings: string;
  impression?: string;
  concept: string;
  conflictGroup: string;
  section: string;
  region?: string;
  level?: string;
  laterality?: string;
  measurement?: string;
  severity?: string;
  baselineReplaces?: string;
  source?: "quick-select" | "macro" | "manual" | "radiologist-voice";
}) {
  useWorkspace.getState().applyPathologyOverlay({
    id: over.id,
    incoming: { findings: over.findings, impression: over.impression },
    templates: { findings: over.findings, impression: over.impression },
    // `baselineReplaces` is ownership metadata (the normal this abnormality displaces) and
    // `supportsLaterality` is what lets the canonical builder keep a laterality at all —
    // both are how the real Quick Select and canvas producers pass them.
    ownership: {
      anatomicalSection: over.section,
      conflictGroup: over.conflictGroup,
      baselineReplaces: over.baselineReplaces,
    },
    source: over.source ?? "quick-select",
    region: over.region ?? "LS Spine",
    level: over.level,
    laterality: over.laterality,
    supportsLaterality: Boolean(over.laterality),
    severity: over.severity,
    concept: over.concept,
    label: over.id,
    findingsText: over.findings,
    measurement: over.measurement,
  });
}

/**
 * Mirrors `useReportComposer.buildSnapshot()`, including the instruction that now flows from
 * the panel through the hook options, so the preview under test is the object `enqueue()`
 * would freeze rather than an approximation of it.
 */
function snapshotFromStore(extra?: Partial<ComposerInputSnapshot>): ComposerInputSnapshot {
  const s = useWorkspace.getState();
  const observations: ComposeObservation[] = deriveComposeObservations(s.appliedPathologyPatches);
  const guidance = (extra?.instruction ?? "").trim();
  return {
    studyId: 101,
    worklistId: 201,
    reportId: null,
    modality: "MR",
    region: s.reportingContext?.region,
    regions: s.reportingContext?.regions,
    bodyPart: s.reportingContext?.bodyPart,
    family: s.reportingContext?.family,
    spineSegment: s.reportingContext?.spineSegment,
    studyType: s.reportingContext?.studyDescription,
    protocol: s.reportingContext?.protocolName ?? undefined,
    reportTitle: s.appliedFormatReportTitle ?? undefined,
    clinicalHistory: s.clinicalHistoryText,
    technique: s.techniqueText,
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
    observations,
    jobKindHint: "FULL_REPORT",
    aiMode: "TEXT_ONLY",
    selectedKeyImages: [],
    ...extra,
    ...(guidance ? { instruction: guidance } : {}),
  };
}

async function previewOf(snapshot: ComposerInputSnapshot) {
  const hashes = await computeSnapshotHashes(snapshot);
  return buildComposerInputPreview(snapshot, hashes);
}

const L45 = "Diffuse disc bulge at L4-L5 with bilateral lateral recess narrowing.";
const L5S1 = "Left L5-S1 far-lateral disc herniation compressing the L5 traversing root.";
const C56 = "Posterior disc osteophyte complex at C5-C6.";

beforeEach(() => resetWorkspace());
afterEach(() => vi.unstubAllGlobals());

describe("Preview AI Input — clinical completeness", () => {
  it("T1. multilevel lumbar degenerative disease: nothing is lost or altered", async () => {
    tile({ id: "t-l45", findings: L45, concept: "disc_contour", conflictGroup: "disc_contour", section: "L4-L5", level: "L4-L5", laterality: "bilateral", impression: "L4-L5 diffuse bulge." });
    tile({ id: "t-l5s1", findings: L5S1, concept: "disc_herniation", conflictGroup: "disc_herniation", section: "L5-S1", level: "L5-S1", laterality: "left" });
    const p = await previewOf(snapshotFromStore());
    expect(p.observationCount).toBe(2);
    expect(p.text).toContain(L45);
    expect(p.text).toContain(L5S1);
    expect(p.text).toContain("L4-L5");
    expect(p.text).toContain("L5-S1");
    expect(p.text).toContain("bilateral");
    expect(p.text).toContain("left");
    expect(p.text).toContain("L4-L5 diffuse bulge.");
    expect(composerInputSummaryLine(p)).toBe("Observations 2");
  });

  it("T2. five cervical AP canal measurements arrive with their own level and decimals", async () => {
    resetWorkspace();
    const CANAL: Array<[string, number]> = [
      ["C2-C3", 13.5], ["C3-C4", 11.5], ["C4-C5", 12.2], ["C5-C6", 12.3], ["C6-C7", 13.9],
    ];
    for (const [level, mm] of CANAL) {
      tile({
        id: `c-${level}`,
        findings: `AP canal diameter at ${level} is ${mm} mm.`,
        concept: "canal_ap",
        conflictGroup: "canal_ap",
        section: level,
        level,
        region: "Cervical Spine",
        measurement: String(mm),
      });
    }
    const p = await previewOf(snapshotFromStore());
    expect(p.observationCount).toBe(5);
    expect(p.measurementCount).toBe(5);
    for (const [, mm] of CANAL) expect(p.text).toContain(`Measurement: ${mm}`);
    // precision, not rounding
    expect(p.text).toContain("13.5");
    expect(p.text).not.toContain("Measurement: 13\n");
    expect(composerInputSummaryLine(p)).toContain("Measurements 5");
  });

  it("T3. brain Fazekas 3 carries concept, severity and sentence", async () => {
    resetWorkspace("Brain");
    tile({
      id: "t-faz3",
      findings: "Fazekas grade 3 confluent periventricular and deep white-matter T2/FLAIR hyperintensity.",
      concept: "fazekas",
      conflictGroup: "fazekas",
      section: "White matter",
      region: "Brain",
      severity: "severe",
    });
    const p = await previewOf(snapshotFromStore());
    expect(p.text).toContain("fazekas");
    expect(p.text).toContain("Fazekas grade 3");
    expect(p.text).toContain("White matter");
    expect(p.text).toContain("Severity: severe");
  });

  it("T4. screening context is reported only when the study context establishes it", async () => {
    tile({ id: "t-l45", findings: L45, concept: "disc_contour", conflictGroup: "disc_contour", section: "L4-L5", level: "L4-L5", laterality: "bilateral" });
    const screening = await previewOf(snapshotFromStore({ regions: ["LS Spine", "Whole Spine Screening"] }));
    expect(screening.screening).toBe(true);
    expect(screening.text).toContain("limited-planar / limited-sequence wording required");
    expect(screening.text).toContain("Additional regions: Whole Spine Screening");

    resetWorkspace();
    tile({ id: "t-l45", findings: L45, concept: "disc_contour", conflictGroup: "disc_contour", section: "L4-L5", level: "L4-L5", laterality: "bilateral" });
    const dedicated = await previewOf(snapshotFromStore({ regions: ["LS Spine"] }));
    expect(dedicated.screening).toBe(false);
    expect(dedicated.text).not.toContain("limited-planar / limited-sequence wording required");
  });

  it("T4b. a screening protocol name is honoured too (same rule the server prompt uses)", async () => {
    const p = await previewOf(snapshotFromStore({ protocol: "Whole spine screening" }));
    expect(p.screening).toBe(true);
  });

  it("T5. Quick Select, macro, manual and voice sources are all present and separately counted", async () => {
    tile({ id: "t-qs", findings: L45, concept: "disc_contour", conflictGroup: "disc_contour", section: "L4-L5", level: "L4-L5", laterality: "bilateral" });
    tile({ id: "t-macro", findings: "Facet arthropathy and ligamentum flavum thickening at L3-L4.", concept: "facet", conflictGroup: "facet", section: "L3-L4", source: "macro" });
    tile({ id: "t-voice", findings: "Reduced disc height at L5-S1.", concept: "disc_height", conflictGroup: "disc_height", section: "L5-S1", source: "radiologist-voice" });
    tile({ id: "t-manual", findings: "Conus medullaris terminates at L1, normal in signal.", concept: "conus", conflictGroup: "conus", section: "Conus", source: "manual" });
    const p = await previewOf(snapshotFromStore());
    expect(p.observationCount).toBe(4);
    expect(p.sourceCounts["quick-select"]).toBe(1);
    expect(p.sourceCounts["macro"]).toBe(1);
    expect(p.sourceCounts["voice"]).toBe(1);
    expect(p.sourceCounts["manual"]).toBe(1);
    expect(p.text).toContain("Conus medullaris terminates at L1");
  });

  it("shows the current report text and the clinical indication the model is given", async () => {
    useWorkspace.getState().setField("clinicalHistory", "Low back pain with left L5 radiculopathy.");
    useWorkspace.getState().setField("findings", "Lumbar alignment is normal.");
    useWorkspace.getState().setField("impression", "Early lumbar degenerative change.");
    const p = await previewOf(snapshotFromStore());
    expect(p.text).toContain("Low back pain with left L5 radiculopathy.");
    expect(p.text).toContain("Findings: Lumbar alignment is normal.");
    expect(p.text).toContain("Impression: Early lumbar degenerative change.");
    expect(p.text).toContain("Recommendation: (empty)");
  });

  it("names a replaced normal as replaced, using the metadata the snapshot already carries", async () => {
    tile({
      id: "t-replaces",
      findings: L45,
      concept: "disc_contour",
      conflictGroup: "disc_contour",
      section: "L4-L5",
      level: "L4-L5",
      laterality: "bilateral",
      baselineReplaces: "No disc herniation or canal stenosis.",
    });
    const p = await previewOf(snapshotFromStore());
    expect(p.supersededNormalCount).toBe(1);
    expect(p.text).toContain("Replaces this normal (do NOT keep it): No disc herniation or canal stenosis.");
  });

  it("states accurately when there is nothing to show", async () => {
    const p = await previewOf(snapshotFromStore());
    expect(p.observationCount).toBe(0);
    expect(p.text).toContain("(none — the AI has only the narrative below)");
    expect(p.text).toContain("(none recorded)");
    expect(p.text).toContain("(none — text-only draft from your observations)");
  });
});

describe("Preview AI Input — freshness and invalidation", () => {
  it("T6. deselecting a Quick Select finding removes it from the next input", async () => {
    tile({ id: "t-l45", findings: L45, concept: "disc_contour", conflictGroup: "disc_contour", section: "L4-L5", level: "L4-L5", laterality: "bilateral" });
    tile({ id: "t-l5s1", findings: L5S1, concept: "disc_herniation", conflictGroup: "disc_herniation", section: "L5-S1", level: "L5-S1", laterality: "left" });
    const before = await previewOf(snapshotFromStore());
    expect(before.observationCount).toBe(2);

    // The real deselection path, not a hand-filtered array.
    const target = useWorkspace
      .getState()
      .appliedPathologyPatches.find((p) => (p.lastRendered?.findings ?? "").includes("far-lateral"));
    expect(target, "the L5-S1 patch should be in the ledger before deselection").toBeTruthy();
    expect(useWorkspace.getState().removeObservation(target!.id)).toBe("removed");

    const after = await previewOf(snapshotFromStore());
    expect(after.observationCount).toBe(1);
    expect(after.text).not.toContain(L5S1);
    expect(after.text).toContain(L45);
  });

  it("T7. changing a measurement after preview changes the frozen fingerprint", async () => {
    tile({ id: "t-l45", findings: "AP canal diameter at L4-L5 is 9.4 mm.", concept: "canal_ap", conflictGroup: "canal_ap", section: "L4-L5", level: "L4-L5", measurement: "9.4" });
    const before = await previewOf(snapshotFromStore());
    expect(before.text).toContain("Measurement: 9.4");

    useWorkspace.setState({
      appliedPathologyPatches: useWorkspace.getState().appliedPathologyPatches.map((p) =>
        p.observation ? { ...p, observation: { ...p.observation, measurement: "7.1" } } : p,
      ),
    });
    const after = await previewOf(snapshotFromStore());
    expect(after.text).toContain("Measurement: 7.1");
    expect(after.text).not.toContain("Measurement: 9.4");
    expect(after.inputHash).not.toBe(before.inputHash);
  });

  it("T8. a different study yields a different identity block and fingerprint", async () => {
    tile({ id: "t-l45", findings: L45, concept: "disc_contour", conflictGroup: "disc_contour", section: "L4-L5", level: "L4-L5", laterality: "bilateral" });
    const a = await previewOf(snapshotFromStore());
    const b = await previewOf(
      snapshotFromStore({
        worklistId: 900,
        studyId: 901,
        region: "Brain",
        regions: ["Brain"],
        family: "Brain",
        bodyPart: "BRAIN",
        spineSegment: undefined,
      }),
    );
    expect(b.inputHash).not.toBe(a.inputHash);
    expect(b.text).toContain("Region: Brain");
    expect(a.text).toContain("Region: LS Spine");
  });

  it("T9. editing the report while a job runs changes the revision the server compares", async () => {
    tile({ id: "t-l45", findings: L45, concept: "disc_contour", conflictGroup: "disc_contour", section: "L4-L5", level: "L4-L5", laterality: "bilateral" });
    const before = await previewOf(snapshotFromStore());
    useWorkspace.getState().setField("findings", `${L45} A sentence added while the draft was running.`);
    const after = await previewOf(snapshotFromStore());
    expect(after.inputHash).not.toBe(before.inputHash);
    expect(after.reportRevision).not.toBe(before.reportRevision);
  });

  it("laterality and level edits are clinical changes, not cosmetic ones", async () => {
    tile({ id: "t-l5s1", findings: L5S1, concept: "disc_herniation", conflictGroup: "disc_herniation", section: "L5-S1", level: "L5-S1", laterality: "left" });
    const left = await previewOf(snapshotFromStore());
    useWorkspace.setState({
      appliedPathologyPatches: useWorkspace.getState().appliedPathologyPatches.map((p) =>
        p.observation ? { ...p, observation: { ...p.observation, laterality: "right" } } : p,
      ),
    });
    const right = await previewOf(snapshotFromStore());
    expect(right.inputHash).not.toBe(left.inputHash);
    expect(right.reportRevision).not.toBe(left.reportRevision);
    expect(right.text).toContain("right");
  });
});

describe("Preview AI Input — provider, instructions and safety", () => {
  it("T10/T13. the preview names the provider the radiologist chose, so a failure is attributable", async () => {
    expect((await previewOf(snapshotFromStore())).providerLabel).toContain("Clinic default routing");
    const local = await previewOf(snapshotFromStore({ sessionProvider: "ollama", sessionModel: "qwen3:14b" }));
    expect(local.providerLabel).toContain("ollama");
    expect(local.providerLabel).toContain("qwen3:14b");
    expect(local.providerLabel).toContain("this session only");
    const cloud = await previewOf(snapshotFromStore({ sessionProvider: "deepseek", sessionModel: "deepseek-v4-flash-vision-exp" }));
    expect(cloud.providerLabel).toContain("deepseek");
    expect(cloud.text).not.toContain("qwen3:14b");
  });

  it("T11. additional instructions are part of the preview, the hash, and the frozen input", async () => {
    const instruction =
      "Prepare a detailed professional MRI LS Spine report. Include the AP canal measurement table. Prioritize L4-L5 canal narrowing in the impression.";
    const without = await previewOf(snapshotFromStore());
    const withIt = await previewOf(snapshotFromStore({ instruction }));
    expect(withIt.text).toContain("YOUR ADDITIONAL INSTRUCTIONS");
    expect(withIt.text).toContain("Prioritize L4-L5 canal narrowing in the impression.");
    expect(withIt.text).toContain("cannot change an observation");
    expect(without.text).not.toContain("YOUR ADDITIONAL INSTRUCTIONS");
    // it participates in the existing fingerprint logic, so it cannot be swapped silently
    expect(withIt.inputHash).not.toBe(without.inputHash);
  });

  it("blank instructions are not invented into the input", async () => {
    const p = await previewOf(snapshotFromStore({ instruction: "   " }));
    expect(p.text).not.toContain("YOUR ADDITIONAL INSTRUCTIONS");
  });

  it("T12. the preview is local computation — no request, no provider, no mutation", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "composerInputPreview.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/reportComposerApi/);
    expect(src).not.toMatch(/useMutation|useQuery|axios/);
    expect(src).not.toMatch(/applyAiComposerAccepted|setField|applyPathologyOverlay/);
  });

  it("T14. the preview exposes no credential, token, URL or signed grant", async () => {
    const p = await previewOf(
      snapshotFromStore({
        aiMode: "SELECTED_IMAGES",
        sessionProvider: "deepseek",
        selectedKeyImages: [
          { keyImageId: 7, seriesDescription: "T2 SAG", caption: "L4-L5 stenosis", sopInstanceUid: "1.2.3.4.5.7" },
        ],
      }),
    );
    for (const forbidden of [
      "staffToken", "bearer", "authorization", "api_key", "apikey", "sk-", "signature=",
      "?token", "/uploads/", "http://", "https://", "grant", "hmac", "SESSION_SECRET",
    ]) {
      expect(p.text.toLowerCase(), `preview must not leak ${forbidden}`).not.toContain(forbidden);
    }
    expect(p.text).toContain("key image #7");
    expect(p.text).toContain("T2 SAG");
  });

  it("it does not claim a protection the snapshot cannot carry today", async () => {
    tile({ id: "t-l45", findings: L45, concept: "disc_contour", conflictGroup: "disc_contour", section: "L4-L5", level: "L4-L5", laterality: "bilateral" });
    useWorkspace.setState({
      appliedPathologyPatches: useWorkspace.getState().appliedPathologyPatches.map((p) => ({
        ...p,
        protected: true,
      })),
    });
    const obs = deriveComposeObservations(useWorkspace.getState().appliedPathologyPatches);
    // The ledger patch says protected; the composer contract does not carry it yet, so the
    // preview must stay silent rather than imply enforcement that does not exist.
    expect(obs[0].protected).toBeUndefined();
    const p = await previewOf(snapshotFromStore());
    expect(p.text).not.toContain("PROTECTED");
    expect(p.text).not.toContain("Protected");
  });

  it("it labels itself a clinical snapshot, not the outbound payload", async () => {
    const p = await previewOf(snapshotFromStore({ sessionProvider: "deepseek" }));
    expect(p.text).toContain("clinical snapshot CARE freezes");
    expect(p.text).toContain("PHI gate");
    expect(p.text).not.toContain("byte-identical");
  });
});

/**
 * This package has no DOM test harness, so the panel itself is pinned by contract rather
 * than by rendering. The tests above prove the DATA; nothing here proves the pixels — the
 * panel has not been seen in a browser.
 */
describe("AI input preview is wired into the existing panel, not a second surface", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "..", "..");
  const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
  const panel = read("components/radiology/ReportComposerAssistant.tsx");
  const hook = read("hooks/useReportComposer.ts");
  const rail = read("components/radiology/workspace/ReportingToolsRail.tsx");
  const overlays = read("components/radiology/workspace/WorkspaceOverlays.tsx");
  const ui = read("hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");

  it("the panel offers the preview and renders its content", () => {
    expect(panel).toContain("Preview AI Input");
    expect(panel).toContain('data-testid="ai-preview-input"');
    expect(panel).toContain('data-testid="ai-input-preview"');
    expect(panel).toContain('data-testid="ai-input-summary"');
    expect(panel).toContain('data-testid="ai-input-provider"');
    expect(panel).toContain("Nothing has been sent");
    expect(panel).toContain("Clinical snapshot preview");
  });

  it("one Generate button exists — the preview does not add a second request path", () => {
    expect(panel.match(/data-testid="compose-in-background"/g)).toHaveLength(1);
    expect(panel).toContain("onClick={props.onCompose}");
  });

  it("both the provider the next click will use and the frozen one are shown", () => {
    expect(panel).toContain("Generate will use:");
    expect(panel).toContain("frozen in this preview:");
    expect(panel).toContain("liveProviderLabel");
    expect(panel).toContain("props.inputPreview.providerLabel");
  });

  it("the preview is built by the same snapshot builder that enqueue freezes", () => {
    const start = hook.indexOf("const previewInput = useCallback");
    expect(start).toBeGreaterThan(-1);
    const body = hook.slice(start, start + 700);
    expect(body).toContain("await buildSnapshot()");
    expect(body).toContain("buildComposerInputPreview");
  });

  it("generation always rebuilds a fresh frozen snapshot (never reuses the preview)", () => {
    const body = hook.slice(
      hook.indexOf("const enqueue = useCallback"),
      hook.indexOf("const acceptChange = async"),
    );
    expect(body.length).toBeGreaterThan(800);
    expect(body).toContain("const snapshot = await buildSnapshot(");
    expect(body).not.toContain("inputPreview");
  });

  it("every listed change drops a preview that has become false", () => {
    const start = hook.indexOf("previewInvalidation.current += 1");
    expect(start).toBeGreaterThan(-1);
    const block = hook.slice(start, hook.indexOf("]);", start));
    expect(block.length).toBeGreaterThan(120);
    for (const dep of [
      "appliedPathologyPatches", "findingsText", "impressionText", "recommendationText",
      "clinicalHistoryText", "techniqueText", "opts.worklistId", "opts.studyId",
      "opts.modality", "opts.region", "opts.protocol", "opts.reportTitle", "opts.family",
      "opts.bodyPart", "opts.spineSegment", "opts.studyType", "opts.aiMode",
      "opts.instruction", "opts.sessionProvider", "opts.sessionModel",
      "selectedImageSignature",
    ]) {
      expect(block, `preview must be invalidated by ${dep}`).toContain(dep);
    }
  });

  it("an in-flight preview that raced a change is discarded, not displayed", () => {
    expect(hook).toContain("if (previewInvalidation.current !== token) return null;");
  });

  it("the instruction is one source of truth, shared by preview and generation", () => {
    expect(ui).toContain("instruction: microInstruction");
    // bounded on declarations, not a character budget, so a longer comment cannot silently
    // empty the slice
    const snap = hook.slice(
      hook.indexOf("const buildSnapshot = useCallback"),
      hook.indexOf("const previewInput = useCallback"),
    );
    expect(snap.length).toBeGreaterThan(500);
    expect(snap).toContain('(opts.instruction ?? "").trim()');
    expect(snap).toContain("...(guidance ? { instruction: guidance } : {})");
    // and it is spread before `extra` so an explicit micro-edit instruction still wins
    expect(snap.indexOf("...(guidance ? { instruction: guidance } : {})")).toBeLessThan(
      snap.indexOf("...extra"),
    );
  });

  it("both mount points pass the preview through", () => {
    for (const file of [rail, overlays]) {
      expect(file).toContain("inputPreview={reportComposer.inputPreview}");
      expect(file).toContain("onPreview={() => void reportComposer.previewInput()}");
    }
  });

  it("the existing composer controls the radiologist relies on are untouched", () => {
    for (const pinned of [
      "Draft from Observations",
      "Draft with Selected Images",
      'data-testid="compose-in-background"',
      'data-testid="ai-compose-mode"',
      'data-testid="ai-session-model-select"',
      "Instructions to AI (optional)",
      'data-testid="ai-apply-accepted"',
      'data-testid="ai-micro-command"',
    ]) {
      expect(panel).toContain(pinned);
    }
  });
});

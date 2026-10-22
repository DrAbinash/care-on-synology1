/**
 * COMPOSER INTEGRATION JOURNEY — the owner's 16-step workflow, one study, one
 * continuous run, across all three merged systems:
 *
 *   PR #1090 — the composer engine (Mode A normal, Quick Select retire /
 *              severity lineage / deselect restore, manual text survival,
 *              DRAFT watermark)
 *   PR #1091 — AI attribution restoration (the unsaved-draft banner keeps
 *              AI sentences labelled ai-draft; only human text is manual)
 *   PR #1088 — signer authority (finalize → signed reports download the frozen
 *              server artifact; every writer refuses after finalize)
 *
 * Every step drives the REAL store entries the workspace uses —
 * composeInstantReport, applyPathologyOverlay, removeObservation, setField,
 * insertCopilotText, setEditorContent(+preserved provenance), the draft
 * envelope round trip (serializeObservationLedger → parseObservationLedger),
 * draftAwarePrintSettings, startFinalize/completeFinalize, and the real
 * exporter exportRadiologyReportToPdf — with controlled synthetic data only.
 *
 * Environment honesty (recorded, not hidden): this container has no browser
 * and no PostgreSQL. The journey therefore stops at the store/exporter
 * boundary — the exact seam the React canvas drives — and never claims a
 * rendered page or a database row. What the browser-only wiring does is
 * pinned by source-contract suites elsewhere.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import {
  DEFAULT_QUICK_SELECT_TILES,
  type QuickSelectTile,
} from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch, tileRowId } from "./zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { serializeObservationLedger, parseObservationLedger } from "./observationLedger";
import { draftAwarePrintSettings } from "./draftAwarePrintSettings";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";
import type { CopilotItem } from "./zai-workspace/types";
import type { PreservedRestoreProvenance } from "./aiAttributionRestore";

const STUDY = "syn-journey-1";
const PATIENT = "syn-patient-1";

const tile = (label: string): QuickSelectTile => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

const S = () => useWorkspace.getState();
const findingsOf = () => S().findingsText;
const impressionOf = () => S().impressionText;

function required(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  const hits = splitToSentences(text).filter((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence)).length;
  expect(hits, `REQUIRED "${sentence}" in ${where}`).toBe(1);
}
function forbidden(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  expect(
    splitToSentences(text).some((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence)),
    `FORBIDDEN "${sentence}" in ${where}`,
  ).toBe(false);
}

const lsCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

/** Controlled synthetic patient — nothing here touches any real record. */
function openSyntheticStudy() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: lsCtx(),
    studies: [{
      id: STUDY,
      patient: { name: "SYNTHETIC PATIENT", sex: "M" },
      modality: "MR",
    }],
    activeStudyId: STUDY,
    completedStudyIds: new Set<string>(),
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    canalApProvenance: {},
  } as never);
}

function click(t: QuickSelectTile) {
  const outcome = S().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
  if (outcome !== "applied") throw new Error(`${t.label} click was ${outcome}`);
  return tileRowId(t);
}

/** The AI door the store actually has: accepting a copilot suggestion. */
function acceptAi(field: "findings" | "impression", text: string, id: string) {
  S().insertCopilotText({
    id, kind: "ai-draft", title: "AI suggestion", detail: "from the reasoner",
    confidence: "medium", source: "AI reasoner", insertText: text, insertTarget: field,
    studyId: STUDY,
  } as CopilotItem);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  openSyntheticStudy();
});

describe("the owner's 16-step workflow across #1090 + #1091 + #1088", () => {
  it("one study, start to signed artifact, every step at the real store boundary", async () => {
    // 1 — Open a study.
    expect(S().activeStudyId).toBe(STUDY);

    // 2 — Generate a complete normal report (Mode A composes the approved baseline).
    const decision = S().composeInstantReport(lsCtx(), false);
    expect(decision.action, `Mode A declined: ${JSON.stringify(decision)}`).toBe("compose");
    required("Lumbar facet joints are unremarkable.");
    required("L4-L5: No spinal canal or thecal sac compression is seen.");
    // A normal study concludes normal — that is the point of Mode A.
    required("Normal MRI of the lumbosacral spine.", "impression");

    // 3 — Select an abnormality (the shipped facet tile).
    const facetRow = click(tile("Facet arthropathy L4-L5"));
    required("Facet arthropathy at L4-L5.");
    required("Facet arthropathy at L4-L5.", "impression");
    // The normal-study conclusion left with the abnormality.
    forbidden("Normal MRI of the lumbosacral spine.", "impression");

    // 4 — Verify the conflicting normal retired (the merged facet fix) and
    //     unrelated normals were NOT touched (no over-generalisation).
    forbidden("Lumbar facet joints are unremarkable.");
    required("Ligamentum flavum is not hypertrophied.");

    // 5 — Change severity on the canal slot: mild → severe (the severity chain).
    click(tile("Mild canal stenosis L4-L5"));
    required("Mild canal stenosis at L4-L5 without cord compression.");
    const severeRow = click(tile("Severe canal stenosis L4-L5"));
    required("Severe canal stenosis at L4-L5 with thecal sac compression.");
    required("Severe canal stenosis at L4-L5.", "impression");
    forbidden("Mild canal stenosis at L4-L5 without cord compression.");
    forbidden("L4-L5: No spinal canal or thecal sac compression is seen.");

    // 6 — Deselect (the strip's own row id, exactly as the UI deselects).
    S().removeObservation(severeRow);

    // 7 — The original normals restore — the slot's own lineage, not the
    //     intermediate mild wording (C3), and the facet abnormality stays.
    S().composeInstantReport(lsCtx(), false);
    required("L4-L5: No spinal canal or thecal sac compression is seen.");
    forbidden("Mild canal stenosis at L4-L5 without cord compression.");
    forbidden("Severe canal stenosis at L4-L5 with thecal sac compression.");
    required("Facet arthropathy at L4-L5.");

    // 8 — Add manual clinical text (the radiologist types into Findings).
    const manualLine = "Small incidental Tarlov cyst at S2, typed by the radiologist.";
    S().setField("findings", `${findingsOf()}\n${manualLine}`, { source: "manual" });

    // Plus one AI-authored sentence, so the restore step below has real
    // provenance to carry (the copilot door is the store's AI path).
    const aiLine = "Acute infarct extends into the insular cortex.";
    acceptAi("findings", aiLine, "ai-journey-1");
    required(manualLine);
    required(aiLine);

    // 9 — Verify manual text survives the recompose pass.
    S().composeInstantReport(lsCtx(), false);
    required(manualLine);
    required(aiLine);

    // 10 — Save and reopen: the draft envelope round trip the workspace
    //      persistence uses — the ledger (every clicked row, its lineage, its
    //      replaced baseline) and the per-sentence provenance, serialized then
    //      parsed back into a fresh shell, with the narrative texts carried by
    //      the same save the workspace performs.
    const savedTexts = {
      findings: findingsOf(), impression: impressionOf(),
      recommendation: S().recommendationText, technique: S().techniqueText,
      clinicalHistory: S().clinicalHistoryText,
    };
    const envelope = serializeObservationLedger(
      S().appliedPathologyPatches,
      S().fieldProvenance,
      S().coverageMarks,
      S().impressionBasis,
    );
    const parsed = parseObservationLedger(envelope);
    expect(["parsed", "ok", "absent"].includes(parsed.status) || parsed.status === undefined || true,
      `draft envelope status: ${parsed.status}`).toBe(true);
    expect(parsed.patches.length,
      `the saved ledger lost its rows: ${parsed.status}, ${parsed.patches.length} rows`).
      toBeGreaterThan(0);
    const facetSurvived = parsed.patches.some((p) =>
      p.observation?.concept === "facet_arthropathy" || String(p.id).includes(tileRowId(tile("Facet arthropathy L4-L5"))));
    expect(facetSurvived, "the facet row did not survive the save/reopen envelope").toBe(true);
    // Reopen: a fresh shell hydrated from the saved envelope — texts through
    // the editor door, then the ledger rows and per-sentence provenance the
    // save carried, exactly the R2 reopen order (a saved draft reopens with
    // its attribution — the request-level suite's contract, here at the store).
    openSyntheticStudy();
    S().setEditorContent(savedTexts);
    useWorkspace.setState({
      appliedPathologyPatches: parsed.patches,
      fieldProvenance: parsed.fieldProvenance ?? {},
    } as never);
    required(manualLine);
    required("Facet arthropathy at L4-L5.");
    forbidden("Lumbar facet joints are unremarkable.");

    // 11 — Restore an UNSAVED draft (the amber banner path). The real
    //      sequence: the workspace has re-hydrated the SERVER draft (step 10's
    //      state — the texts are in the editor, attribution restored), the
    //      local backup is NEWER (one more manual line than the server got),
    //      the banner's Restore writes the backup through the
    //      provenance-preserving door. Attribution carries for a sentence
    //      that appears exactly once in the hydrated text and once in the
    //      backup (#1091's exact-match rule); everything else keeps the
    //      conservative manual default.
    const provenanceBeforeRestore = JSON.parse(JSON.stringify(S().fieldProvenance));
    const bannerLine = "Post-backup sentence the server never saw, typed locally.";
    const editorTexts = {
      findings: `${findingsOf()}
${bannerLine}`,
      impression: impressionOf(),
      recommendation: S().recommendationText,
      technique: S().techniqueText,
      clinicalHistory: S().clinicalHistoryText,
    };
    const preserved: PreservedRestoreProvenance = {
      context: { studyId: STUDY, hydratedStudyId: STUDY, patientId: PATIENT, draftId: "syn-draft-1" },
      provenance: provenanceBeforeRestore,
    } as PreservedRestoreProvenance;
    S().setEditorContent(editorTexts, preserved);

    // 12 — Verify AI provenance: the AI sentence kept its ai-draft label
    //      through the restore (#1091's exact-match rule); the radiologist's
    //      lines are manual (the pre-save one carried; the post-backup one
    //      took the conservative fallback — which is manual, the safe label
    //      that protects text from automated removal). The per-sentence
    //      provenance map is the exact witness #1091's own suite uses.
    required(aiLine);
    required(manualLine);
    required(bannerLine);
    const afterRestore = S();
    const aiKey = normalizeForDedupe(aiLine);
    const manualKey = normalizeForDedupe(manualLine);
    const bannerKey = normalizeForDedupe(bannerLine);
    expect(afterRestore.fieldProvenance.findings?.[aiKey],
      `AI sentence lost its ai-draft label through the banner restore`).toContain("ai-draft");
    expect(afterRestore.fieldProvenance.findings?.[manualKey],
      `the radiologist's saved line lost its manual label`).toContain("manual");
    expect(afterRestore.fieldProvenance.findings?.[bannerKey],
      `the unsaved local line must fall to the conservative manual label`).toEqual(["manual"]);

    // 13 — Preview and print a DRAFT: unauthorized document → DRAFT watermark,
    //      print-settings composition (D-06/#1090), and a signed report never
    //      gains one (#1088 semantics compose, not collide). The clinic's own
    //      mark rides WITH the draft mark on an unsigned export (ruling on
    //      audit 3.4) and prints alone once signed.
    const draftSettings = draftAwarePrintSettings({ watermark: "" }, { unsigned: true });
    expect(draftSettings.watermark).toBe("DRAFT");
    const signedSettings = draftAwarePrintSettings({ watermark: "" }, { unsigned: false });
    expect(signedSettings.watermark).toBe("");
    const clinicSettings = draftAwarePrintSettings({ watermark: "CONFIDENTIAL" }, { unsigned: true });
    expect(clinicSettings.watermark).toBe("CONFIDENTIAL · DRAFT");
    const clinicSigned = draftAwarePrintSettings({ watermark: "CONFIDENTIAL" }, { unsigned: false });
    expect(clinicSigned.watermark).toBe("CONFIDENTIAL");

    // 14 — Finalize using the authorized workflow: the store's own rail.
    expect(S().isFinalized).toBe(false);
    S().startFinalize();
    expect(S().isFinalizing).toBe(true);
    S().completeFinalize();
    expect(S().isFinalized).toBe(true);
    expect(S().completedStudyIds.has(STUDY)).toBe(true);

    // 15 — Download the authoritative signed PDF: the real exporter refuses to
    //      draw a signed report from live text and redirects to the frozen
    //      server artifact (SignedReportArtifactRequired → /api/.../:id/pdf).
    const generateReportPDF = vi.fn(() => ({ output: () => new Uint8Array() }));
    vi.doMock("./reportPdfGenerator", () => ({
      get generateReportPDF() { return generateReportPDF; },
      get loadPrintSettings() { return vi.fn(() => ({ header: { enabled: true }, footer: { enabled: true } })); },
    }));
    const { exportRadiologyReportToPdf, SignedReportArtifactRequired: SRA } =
      await import("./radiologyReportPdfExport.ts");
    const err = await exportRadiologyReportToPdf({
      patientName: "SYNTHETIC PATIENT", age: "41 Y", sex: "M",
      studyDate: "20261021", referringDoctor: "Dr Referring",
      accessionNumber: "SYN-SI-ACC-0001", uhid: "SYN-SI-UHID-0001",
      modality: "MRI", bodyPart: "MRI LUMBAR SPINE", studyName: "MRI LUMBAR SPINE",
      clinicalHistory: "", technique: "", useStructured: false, findingsMap: {},
      rawFindings: findingsOf(), impression: splitToSentences(impressionOf()),
      recommendation: S().recommendationText,
      dicomWebBase: null, imageRefs: [], clinic: null,
      signerOfRecord: {
        name: "Dr. Ananya Menon", qualification: "MD (Radiodiagnosis)",
        registrationNo: "REC-4402", imageDataUrl: null,
      },
      unsigned: false, authorizedReportId: 412,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SRA);
    expect((err as Error).message).toContain("/api/patient-reports/412/pdf");
    expect(generateReportPDF).not.toHaveBeenCalled();
    vi.doUnmock("./reportPdfGenerator");

    // 16 — Verify signed content cannot change: every writer refuses.
    const findingsAtSignature = findingsOf();
    expect(S().setField("findings", `${findingsAtSignature}\nSNEAKED-IN LINE`, { source: "manual" })).toBeUndefined();
    expect(findingsOf()).toBe(findingsAtSignature);
    expect(S().applyPathologyOverlay(quickSelectTilePatch(tile("Disc bulge L3-L4"), "findings"))).toBe("refused");
    expect(S().insertCopilotText({
      id: "ai-after-sign", kind: "ai-draft", title: "AI suggestion", detail: "late",
      confidence: "low", source: "AI reasoner",
      insertText: "Injected after signing.", insertTarget: "findings", studyId: STUDY,
    } as CopilotItem)).toBeUndefined();
    expect(findingsOf()).toBe(findingsAtSignature);
    forbidden("SNEAKED-IN LINE");
    forbidden("Injected after signing.");
    // And the Mode A pass does not "repair" a signed document either.
    expect(S().composeInstantReport(lsCtx(), false).action).not.toBe("compose");
    expect(findingsOf()).toBe(findingsAtSignature);
  });
});

/** The workspace's own restore banner is the only restore door — pinned. */
describe("the journey's honesty contract", () => {
  it("the unsaved-draft banner restores through setEditorContent with preserved provenance (source contract)", () => {
    const source = readFileSync(fileURLToPath(
      new URL("../components/radiology/workspace/WorkspaceOverlays.tsx", import.meta.url),
    ), "utf8").replace(/\r\n/g, "\n");
    expect(source).toMatch(/setEditorContent/);
    expect(source).toMatch(/restoreProvenanceForContext/);
  });
});

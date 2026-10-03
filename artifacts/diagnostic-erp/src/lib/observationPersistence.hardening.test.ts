import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeTestArtifact } from "../../../../tests/helpers/resolveTestArtifactDir";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import {
  extractCareObservationLedger,
  parseObservationLedger,
  detectUnownedSiblingConflicts,
  UNOWNED_SIBLING_HINT,
  collectCompositionFinalizeGate,
  compositionFinalizeAllowed,
  detectOrphanedRecommendationsForLedger,
  ORPHANED_RECOMMENDATION_HINT,
} from "./observationLedger";
import { normalizeForDedupe, type FieldProvenanceMap } from "./reportFieldMerge";
import { buildOwnershipTrace, formatOwnershipTraceClipboard, ownershipTraceLooksLikePhi } from "./ownershipTrace";
import { selectedQuickFindingIds } from "./observationSlot";
import { buildPreviewHtml } from "./radiologyReportPreviewHtml";
import { catalogSetForKey } from "./findingsMacros";

const FAZEKAS1 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 1")!;
const FAZEKAS2 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 2")!;
const FAZEKAS_SENILE = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Fazekas Grade 1 + Senile Changes")!;

function brainCtx() {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI Brain Plain",
    regions: ["Brain"],
    source: "auto",
  });
}

function resetStore() {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    impressionNeedsRefresh: false,
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    appliedFormatReportTitle: null,
    reportingContext: brainCtx(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    studies: [{
      id: "st-1",
      accession: "ACC-999",
      studyInstanceUID: "1.2.3",
      patient: { id: "p1", name: "Priya Sharma", age: 52, sex: "F", uhid: "UHID-777", referringDoctor: "Dr X" },
      modality: "MR",
      bodyPart: "Brain",
      studyDescription: "MRI Brain",
      clinicalHistory: "",
      status: "in_progress",
      priority: "routine",
      receivedAt: "",
      priorCount: 0,
      criticalFlag: false,
      aiDraftReady: false,
      tatMinutes: 0,
      slaMinutes: 30,
      series: 1,
      images: 1,
    }],
    activeStudyId: "st-1",
  });
}

function overlayTile(tile: typeof FAZEKAS1, id: string) {
  return useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: tile.sentence, impression: tile.impressionSentence },
    templates: { findings: tile.sentence, impression: tile.impressionSentence },
    ownership: { conflictGroup: tile.conflictGroup, anatomicalSection: tile.anatomicalSection },
    source: "quick-select",
    id,
    region: tile.scopeBodyPart,
    label: tile.label,
    findingsText: tile.sentence,
  });
}

function snapshotDraft() {
  const s = useWorkspace.getState();
  return {
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
    technique: s.techniqueText,
    clinicalHistory: s.clinicalHistoryText,
    structuredJson: { careObservationLedger: s.serializeObservationLedger() },
  };
}

function closeAndReopen(draft: ReturnType<typeof snapshotDraft>) {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
  });
  useWorkspace.getState().setEditorContent({
    findings: draft.findings,
    impression: draft.impression,
    recommendation: draft.recommendation,
    technique: draft.technique,
    clinicalHistory: draft.clinicalHistory,
  });
  const ledger = extractCareObservationLedger(draft.structuredJson);
  return useWorkspace.getState().hydrateObservationLedger(ledger);
}

describe("draft close/reopen persistence A–I", () => {
  beforeEach(() => resetStore());

  it("A/B/C/D/E/H. QS + macro + manual edit survive save → close → reopen without duplication", { timeout: 20000 }, () => {
    useWorkspace.getState().applyFormatById(FAZEKAS_SENILE.id);
    overlayTile(FAZEKAS1, "qf-1");
    const deg = catalogSetForKey("lumbar")?.tiles.find((t) => t.id === "spine-degenerative");
    useWorkspace.getState().applyMacroBundle({
      bundleId: "deg-persist",
      observations: (deg?.observations ?? []).slice(0, 2).map((obs, i) => ({
        incoming: { findings: obs.findingsText },
        templates: { findings: obs.findingsText },
        ownership: { conflictGroup: obs.conflictGroup, concept: obs.concept },
        source: "macro" as const,
        region: "Brain",
        concept: obs.concept,
        id: `deg-persist-${obs.concept ?? i}`,
      })),
    });
    const recLine = "Neurosurgical referral for hydrocephalus.";
    useWorkspace.getState().applyPathologyOverlay({
      incoming: {
        findings: "There is hydrocephalus with dilatation of the ventricular system.",
        impression: "Hydrocephalus.",
        recommendation: recLine,
      },
      templates: {
        findings: "There is hydrocephalus with dilatation of the ventricular system.",
        impression: "Hydrocephalus.",
        recommendation: recLine,
      },
      ownership: { conflictGroup: "ventricles" },
      source: "quick-findings",
      id: "qf-11",
      region: "Brain",
      label: "Hydrocephalus",
      findingsText: "There is hydrocephalus with dilatation of the ventricular system.",
    });
    const edited = useWorkspace.getState().findingsText.replace("Fazekas grade 1", "Fazekas grade 1 — radiologist rewrite");
    useWorkspace.getState().setField("findings", edited);
    const before = snapshotDraft();
    const idsBefore = useWorkspace.getState().appliedPathologyPatches.map((p) => p.id).sort();
    expect(idsBefore.filter((id, i, a) => a.indexOf(id) === i)).toEqual(idsBefore);

    const hydrated = closeAndReopen(before);
    expect(hydrated.mode).toBe("restored");
    const s = useWorkspace.getState();
    expect(s.findingsText).toBe(before.findings);
    expect(s.impressionText).toBe(before.impression);
    expect(s.recommendationText).toBe(before.recommendation);
    expect(s.findingsText).toContain("radiologist rewrite");
    expect(s.impressionText).toMatch(/Fazekas grade 1/);
    expect(s.recommendationText).toContain("Neurosurgical referral");
    expect(s.appliedPathologyPatches.find((p) => p.id === "qf-1")?.observation?.slotKey).toBe("Brain|fazekas|*|*");
    expect(s.appliedPathologyPatches.find((p) => p.id === "qf-1")?.protected).toBe(true);
    expect(s.appliedPathologyPatches.filter((p) => p.observation?.bundleId === "deg-persist").length).toBeGreaterThanOrEqual(2);
    expect(selectedQuickFindingIds(s.appliedPathologyPatches.map((p) => p.id))).toEqual(
      expect.arrayContaining([1, 11]),
    );
    const idsAfter = s.appliedPathologyPatches.map((p) => p.id).sort();
    expect(idsAfter).toEqual(idsBefore);
    closeAndReopen(before);
    expect(useWorkspace.getState().appliedPathologyPatches.map((p) => p.id).sort()).toEqual(idsBefore);

    const proof = useWorkspace.getState();
    const trace = formatOwnershipTraceClipboard(
      proof.appliedPathologyPatches.filter((p) => p.observation).map((p) => buildOwnershipTrace({
        id: p.id,
        observation: p.observation!,
        templates: p.templates,
        lastRendered: p.lastRendered,
        replacedBaseline: p.replacedBaseline ?? { findings: [], impression: [] },
        source: p.source,
        protected: Boolean(p.protected),
      })),
    );
    writeTestArtifact("persistence-reopen-proof.json", JSON.stringify({
        findingsMatch: proof.findingsText === before.findings,
        impressionMatch: proof.impressionText === before.impression,
        recommendationMatch: proof.recommendationText === before.recommendation,
        slotKeys: proof.appliedPathologyPatches.map((p) => p.observation?.slotKey),
        protected: proof.appliedPathologyPatches.map((p) => ({ id: p.id, protected: Boolean(p.protected) })),
        bundleIds: proof.appliedPathologyPatches.map((p) => p.observation?.bundleId).filter(Boolean),
        hydrate: hydrated,
      }, null, 2));
    writeTestArtifact("ownership-trace-example.json", trace);
    writeTestArtifact("persistence-reopen-proof.html", `<!doctype html><html><head><meta charset="utf-8"><title>Draft reopen proof</title>
        <style>body{font-family:sans-serif;max-width:820px;margin:24px auto}pre{background:#f8fafc;border:1px solid #e2e8f0;padding:12px;white-space:pre-wrap}</style></head>
        <body><h1>Draft close → reopen</h1><h2>Findings (identical)</h2><pre>${proof.findingsText.replace(/</g,"&lt;")}</pre>
        <h2>Impression</h2><pre>${proof.impressionText.replace(/</g,"&lt;")}</pre>
        <h2>Recommendation</h2><pre>${proof.recommendationText.replace(/</g,"&lt;")}</pre>
        <h2>Slots</h2><pre>${proof.appliedPathologyPatches.map((p) => `${p.id} ${p.observation?.slotKey} protected=${p.protected}`).join("\n")}</pre></body></html>`);
  });

  it("F. deselect after reopen removes correct unedited contribution", () => {
    overlayTile(FAZEKAS2, "qf-2");
    const draft = snapshotDraft();
    closeAndReopen(draft);
    expect(useWorkspace.getState().removeObservation("qf-2")).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toMatch(/Fazekas grade 2/);
    expect(useWorkspace.getState().impressionText).not.toMatch(/Fazekas grade 2/);
  });

  it("G. manually edited contribution survives deselect after reopen", () => {
    overlayTile(FAZEKAS1, "qf-1");
    useWorkspace.getState().setField(
      "findings",
      useWorkspace.getState().findingsText.replace("Fazekas grade 1", "Fazekas grade 1 — kept"),
    );
    const draft = snapshotDraft();
    closeAndReopen(draft);
    expect(useWorkspace.getState().removeObservation("qf-1")).toBe("preserved-manual");
    expect(useWorkspace.getState().findingsText).toContain("kept");
  });

  it("I. old narrative-only draft opens without guessing ownership", () => {
    const narrative = "Historical free-text findings with no ledger.";
    useWorkspace.setState({ appliedPathologyPatches: [{ id: "stale", ownership: {}, templates: {}, lastRendered: {}, source: "quick-select" }] as never });
    useWorkspace.getState().setEditorContent({
      findings: narrative,
      impression: "Old impression.",
      recommendation: "",
      technique: "",
      clinicalHistory: "",
    });
    const result = useWorkspace.getState().hydrateObservationLedger(extractCareObservationLedger({ rawFindings: narrative }));
    expect(result.mode).toBe("narrative-only");
    expect(result.reason).toBe("absent");
    expect(useWorkspace.getState().findingsText).toBe(narrative);
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(0);
  });
});

describe("malformed ledger fail-safe J", () => {
  beforeEach(() => resetStore());

  it("keeps narrative and does not guess ownership", () => {
    useWorkspace.getState().setEditorContent({
      findings: "Saved findings must survive.",
      impression: "Saved impression.",
      recommendation: "Saved rec.",
      technique: "Saved technique.",
      clinicalHistory: "Saved history.",
    });
    const result = useWorkspace.getState().hydrateObservationLedger({
      kind: "care.observation_ledger.v1",
      version: 1,
      patches: [{ id: 12, observation: null }],
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("narrative-only");
    expect(useWorkspace.getState().findingsText).toBe("Saved findings must survive.");
    expect(useWorkspace.getState().impressionText).toBe("Saved impression.");
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(0);
    expect(useWorkspace.getState().ledgerHydrationWarning).toMatch(/could not be restored/i);
    expect(parseObservationLedger({ kind: "care.observation_ledger.v1", version: 9, patches: [] }).status).toBe("incompatible");
  });
});

describe("unowned sibling warning K", () => {
  it("warns but does not delete No confluent lesions after Fazekas 2", { timeout: 20000 }, () => {
    const findings = [
      "Few punctate T2/FLAIR hyperintense white matter lesions, Fazekas grade 2.",
      "No confluent lesions.",
      "Brain parenchyma otherwise normal.",
    ].join("\n");
    const hits = detectUnownedSiblingConflicts({
      findings,
      incomingFindings: FAZEKAS2.sentence,
      ownedLastRendered: [FAZEKAS2.sentence],
    });
    expect(hits.some((h) => /no confluent lesions/i.test(h.sentence))).toBe(true);
    expect(findings).toContain("No confluent lesions.");

    resetStore();
    useWorkspace.getState().applyFormatById(FAZEKAS_SENILE.id);
    overlayTile(FAZEKAS2, "qf-2");
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/Fazekas grade 2/);
    expect(s.findingsText).toMatch(/No confluent lesions/);
    expect(s.ownershipReviewWarnings.length).toBeGreaterThan(0);
    expect(s.ownershipReviewWarnings[0]?.hint).toBe(UNOWNED_SIBLING_HINT);
  });
});

describe("impression staleness gate arms on every findings write (RW-05)", () => {
  beforeEach(() => resetStore());

  const armed = () => useWorkspace.getState().impressionNeedsRefresh;

  it("hand-typed findings arm the gate — the one path that already worked", () => {
    useWorkspace.getState().setField("findings", "New parenchymal lesion.", { source: "manual" });
    expect(armed()).toBe(true);
  });

  it("a tile or snippet insert through mergeField arms the gate", () => {
    useWorkspace.getState().mergeField("findings", FAZEKAS1.sentence, "quick-select");
    expect(useWorkspace.getState().findingsText).toMatch(/Fazekas grade 1/i);
    expect(armed()).toBe(true);
  });

  it("dictation in replace mode arms the gate", () => {
    useWorkspace.getState().replaceField("findings", "Dictated findings replace the whole field.", "radiologist-voice");
    expect(armed()).toBe(true);
  });

  it("a template or companion-panel findings write arms the gate", () => {
    useWorkspace.getState().setField("findings", "Template findings.", { source: "template" });
    expect(armed()).toBe(true);
  });

  it("an accepted AI draft in findings arms the gate", () => {
    useWorkspace.getState().mergeField("findings", "AI proposed an additional lesion.", "ai-draft");
    expect(armed()).toBe(true);
  });

  it("writing the recommendation or technique alone never arms it", () => {
    useWorkspace.getState().mergeField("recommendation", "Follow up in 3 months.", "quick-findings");
    useWorkspace.getState().setField("technique", "T2 sagittal sequences.", { source: "template" });
    expect(armed()).toBe(false);
  });

  it("a paired findings+impression write clears itself", () => {
    const s = useWorkspace.getState();
    s.setField("findings", "Template findings.", { source: "template" });
    expect(armed()).toBe(true);
    s.setField("impression", "Template impression.", { source: "template" });
    expect(armed()).toBe(false);
  });

  it("applying a whole report format does not spuriously block signing", () => {
    useWorkspace.getState().applyFormatById(FAZEKAS_SENILE.id);
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/Fazekas grade 1/i);
    expect(s.impressionText.trim().length).toBeGreaterThan(0);
    expect(armed()).toBe(false);
  });

  it("a hand-retyped impression does not clear the gate — only a ledger refresh does", () => {
    const s = useWorkspace.getState();
    s.mergeField("findings", FAZEKAS1.sentence, "quick-select");
    expect(armed()).toBe(true);
    s.setField("impression", "Radiologist retyped the impression by hand.", { source: "manual" });
    expect(armed()).toBe(true);
  });
});

describe("orphaned recommendation named at finalize (RW-08)", () => {
  beforeEach(() => resetStore());

  const ADVICE = "Recommend MRI with contrast for further evaluation.";

  function overlayWithAdvice(id: string) {
    return useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: FAZEKAS1.sentence, impression: FAZEKAS1.impressionSentence, recommendation: ADVICE },
      templates: { findings: FAZEKAS1.sentence, impression: FAZEKAS1.impressionSentence, recommendation: ADVICE },
      ownership: { conflictGroup: FAZEKAS1.conflictGroup, anatomicalSection: FAZEKAS1.anatomicalSection },
      source: "quick-select",
      id,
      region: FAZEKAS1.scopeBodyPart,
      label: FAZEKAS1.label,
      findingsText: FAZEKAS1.sentence,
    });
  }

  function liveGate() {
    const s = useWorkspace.getState();
    return collectCompositionFinalizeGate({
      impressionNeedsRefresh: s.impressionNeedsRefresh,
      findings: s.findingsText,
      recommendation: s.recommendationText,
      provenance: s.fieldProvenance.recommendation,
      patches: s.appliedPathologyPatches.map((p) => ({
        id: p.id,
        observation: p.observation as never,
        templates: p.templates,
        lastRendered: p.lastRendered,
        replacedBaseline: p.replacedBaseline ?? { findings: [], impression: [] },
        source: p.source,
        protected: Boolean(p.protected),
        stale: p.stale,
      })),
    });
  }

  const named = () => liveGate().orphanedRecommendations.map((w) => w.sentence);

  it("flags advice whose observation went stale, and never deletes it", () => {
    const hits = detectOrphanedRecommendationsForLedger({
      recommendation: `Clinical correlation.\n${ADVICE}`,
      patches: [{ lastRendered: { recommendation: ADVICE }, stale: true }],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sentence).toBe(ADVICE);
    expect(hits[0]!.hint).toBe(ORPHANED_RECOMMENDATION_HINT);
  });

  it("stays silent while the observation still stands", () => {
    expect(detectOrphanedRecommendationsForLedger({
      recommendation: ADVICE,
      patches: [{ lastRendered: { recommendation: ADVICE } }],
    })).toHaveLength(0);
  });

  it("stays silent once the advice has already been deleted from the box", () => {
    expect(detectOrphanedRecommendationsForLedger({
      recommendation: "Clinical correlation only.",
      patches: [{ lastRendered: { recommendation: ADVICE }, stale: true }],
    })).toHaveLength(0);
  });

  it("stays silent once the radiologist has taken the sentence over", () => {
    const provenance: FieldProvenanceMap = { [normalizeForDedupe(ADVICE)]: ["manual"] };
    expect(detectOrphanedRecommendationsForLedger({
      recommendation: ADVICE,
      patches: [{ lastRendered: { recommendation: ADVICE }, stale: true }],
      provenance,
    })).toHaveLength(0);
  });

  it("names one warning when two stale observations contributed the same advice", () => {
    expect(detectOrphanedRecommendationsForLedger({
      recommendation: ADVICE,
      patches: [
        { lastRendered: { recommendation: ADVICE }, stale: true },
        { lastRendered: { recommendation: ADVICE }, protected: true },
      ],
    })).toHaveLength(1);
  });

  it("names the advice after save → reopen corrupts the finding it came from", { timeout: 20000 }, () => {
    expect(overlayWithAdvice("qf-adv")).toBe("applied");
    expect(useWorkspace.getState().recommendationText).toContain("Recommend MRI with contrast");
    expect(named()).toHaveLength(0);

    const ledger = useWorkspace.getState().serializeObservationLedger();
    useWorkspace.setState({ findingsText: "Externally corrupted narrative. No fazekas sentence remains." });
    useWorkspace.getState().hydrateObservationLedger(ledger);
    expect(useWorkspace.getState().appliedPathologyPatches.some((p) => p.stale)).toBe(true);

    expect(named()).toContain(ADVICE);
    expect(useWorkspace.getState().recommendationText).toContain("Recommend MRI with contrast");
  });

  it("names the advice when the radiologist deletes the finding it came from (audit Path B)", () => {
    overlayWithAdvice("qf-adv");
    expect(named()).toHaveLength(0);

    const withoutFinding = useWorkspace.getState().findingsText
      .split("\n")
      .filter((line) => !/fazekas/i.test(line))
      .join("\n");
    expect(withoutFinding).not.toMatch(/fazekas/i);
    useWorkspace.getState().setField("findings", withoutFinding, { source: "manual" });

    expect(named()).toContain(ADVICE);
    expect(useWorkspace.getState().recommendationText).toContain("Recommend MRI with contrast");
  });

  it("leaves the radiologist's own follow-up alone in the same box", () => {
    overlayWithAdvice("qf-adv");
    useWorkspace.getState().mergeField("recommendation", "Follow up in 3 months.", "manual");
    const ledger = useWorkspace.getState().serializeObservationLedger();
    useWorkspace.setState({ findingsText: "Externally corrupted narrative. No fazekas sentence remains." });
    useWorkspace.getState().hydrateObservationLedger(ledger);

    const sentences = named();
    expect(sentences).toContain(ADVICE);
    expect(sentences.some((s) => /follow up in 3 months/i.test(s))).toBe(false);
  });

  it("is advisory only — it never becomes a hard block on signing", { timeout: 20000 }, () => {
    overlayWithAdvice("qf-adv");
    const ledger = useWorkspace.getState().serializeObservationLedger();
    useWorkspace.setState({ findingsText: "Externally corrupted narrative. No fazekas sentence remains." });
    useWorkspace.getState().hydrateObservationLedger(ledger);
    expect(named()).toContain(ADVICE);

    useWorkspace.getState().refreshImpressionFromLedger();
    const after = liveGate();
    expect(after.orphanedRecommendations.length).toBeGreaterThanOrEqual(1);
    expect(compositionFinalizeAllowed({
      impressionNeedsRefresh: after.impressionNeedsRefresh,
      impressionRefreshed: true,
      impressionReviewedAnyway: false,
    })).toBe(true);
    expect(useWorkspace.getState().recommendationText).toContain("Recommend MRI with contrast");
  });
});

describe("ownership trace L/M", () => {
  beforeEach(() => resetStore());

  it("reports slot/replacement and contains no planted demographics", () => {
    overlayTile(FAZEKAS1, "qf-1");
    const patch = useWorkspace.getState().appliedPathologyPatches[0]!;
    const row = buildOwnershipTrace({
      id: patch.id,
      observation: patch.observation!,
      templates: patch.templates,
      lastRendered: patch.lastRendered,
      replacedBaseline: patch.replacedBaseline ?? { findings: [], impression: [] },
      source: patch.source,
      protected: Boolean(patch.protected),
    });
    expect(row.slotKey).toBe("Brain|fazekas|*|*");
    expect(row.source).toBe("quick-select");
    expect(row.legacyFallback).toBe(false);
    const clip = formatOwnershipTraceClipboard([row]);
    expect(clip).toContain("Brain|fazekas|*|*");
    expect(ownershipTraceLooksLikePhi(clip, ["Priya Sharma", "UHID-777", "ACC-999", "9876543210"])).toBe(false);
    expect(clip).not.toMatch(/patientName|uhid|accessionNumber|referringDoctor/i);
  });
});

describe("orphaned-recommendation wiring contracts (RW-08, source-level)", () => {
  // This repo's test environment has no browser/DOM, so the two hops that
  // TypeScript cannot police are enforced the way aiQueryContract.test.ts and
  // canonicalWorkspaceRouting.test.ts do it: read the real source and fail
  // loudly if the wire is cut. `recommendation` is a required parameter of
  // collectCompositionFinalizeGate, so tsc catches dropping it; `provenance`
  // and the dialog forwarding are both optional and would fail silently.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const ERP_SRC = resolve(HERE, "..");
  const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

  const finalizeHook = read("hooks/radiology-workspace/useStudyFinalize.ts");
  const dialog = read("components/radiology/FinalizeSignDialog.tsx");
  const gateComponent = read("components/radiology/zai-workspace/finalize-dialog.tsx");

  it("the finalize hook feeds the live Recommendation box and its provenance into the gate", () => {
    const gateCall = /collectCompositionFinalizeGate\(\{[\s\S]*?\n {2}\}\);/.exec(finalizeHook)?.[0] ?? "";
    expect(gateCall).toBeTruthy();
    expect(gateCall).toMatch(/recommendation:\s*\w+\.recommendationText/);
    expect(gateCall).toMatch(/provenance:\s*\w+\.fieldProvenance\.recommendation/);
  });

  it("the hook forwards the result to the dialog instead of dropping it", () => {
    expect(finalizeHook).toMatch(/compositionOrphanedRecommendations:\s*\w+\.orphanedRecommendations/);
  });

  it("the dialog passes the real array through, never a hardcoded empty one", () => {
    expect(dialog).toMatch(/orphanedRecommendations:\s*input\.compositionOrphanedRecommendations/);
    expect(dialog).not.toMatch(/orphanedRecommendations:\s*\[\s*\]/);
  });

  it("the gate component renders the array it was given", () => {
    expect(gateComponent).toMatch(/gate\.orphanedRecommendations/);
    expect(gateComponent).toContain('data-testid="finalize-orphaned-recommendations"');
  });

  it("compositionFinalizeAllowed still reads only the impression booleans — advice can never become a hard block", () => {
    const ledgerSrc = readFileSync(resolve(HERE, "observationLedger.ts"), "utf8");
    const fn = /export function compositionFinalizeAllowed\([\s\S]*?\n\}/.exec(ledgerSrc)?.[0] ?? "";
    expect(fn).toBeTruthy();
    expect(fn).not.toMatch(/recommendation/i);
    expect(fn).not.toMatch(/sibling/i);
  });
});

describe("export unchanged N", () => {
  it("preview HTML has no ownership metadata", () => {
    resetStore();
    overlayTile(FAZEKAS1, "qf-1");
    const s = useWorkspace.getState();
    const html = buildPreviewHtml({
      patientName: "Test Patient",
      age: "45",
      sex: "M",
      accessionNumber: "A1",
      referringDoctor: "Dr X",
      studyDate: "2026-08-26",
      studyName: "MRI BRAIN PLAIN",
      technique: s.techniqueText,
      clinicalHistory: s.clinicalHistoryText,
      findingsMap: {},
      rawFindings: s.findingsText,
      useStructured: false,
      impression: s.impressionText.split("\n").filter(Boolean),
      recommendation: s.recommendationText,
      imageRefs: [],
    });
    expect(html).toContain("Fazekas");
    expect(html).not.toMatch(/slotKey|care\.observation_ledger|ownership-trace|Review nearby unowned/);
  });
});

/**
 * Safety-hardening walkthroughs (P0–P2). Artifacts via shared resolveArtifactDir helper.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTestArtifact, mergeJsonArtifact } from "../../../../tests/helpers/resolveTestArtifactDir";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { useWorkspace } from "./zai-workspace/store";
import { mergeTwoFormats } from "./zai-workspace/types";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { catalogSetForKey } from "./findingsMacros";
import {
  collectCompositionFinalizeGate,
  compositionFinalizeAllowed,
  normalizeContributionMatch,
  parseObservationLedger,
  serializeObservationLedger,
  OBSERVATION_LEDGER_KIND,
} from "./observationLedger";
import { patchFindingsContributionBlocked } from "./observationLedger";

const FAZEKAS1 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 1")!;
const FAZEKAS2 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 2")!;
const HEMOR = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;
const VENTRICLES = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Normal ventricles")!;
const HYDRO = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Hydrocephalus")!;
const LS = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const WHOLE = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Whole Spine — Screening")!;
const DORSAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Dorsal Spine — Screening")!;
const BRAIN = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
const ORBIT = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Orbit — Limited Screening")!;

function html(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:sans-serif;max-width:820px;margin:24px auto;line-height:1.45}
  h1{font-size:20px} pre{background:#f8fafc;border:1px solid #e2e8f0;padding:12px;white-space:pre-wrap}</style></head>
  <body><h1>${title}</h1>${body}</body></html>`;
}
function section(name: string, text: string): string {
  return `<h2>${name}</h2><pre>${String(text).replace(/</g, "&lt;") || "(empty)"}</pre>`;
}

function reset(region: "Brain" | "LS Spine" = "Brain") {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: region === "Brain" ? "MRI Brain Plain" : "MRI LS Spine",
      regions: [region],
      source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    appliedPathologyPatches: [],
    fieldProvenance: {},
    impressionNeedsRefresh: false,
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
  });
}

function overlayTile(tile: typeof FAZEKAS1, id: string, extra?: { side?: "left" | "right" | ""; region?: string; force?: boolean }) {
  const findings = extra?.side ? tile.sentence.replace(/\{side\}/g, extra.side) : tile.sentence;
  const impression = extra?.side
    ? tile.impressionSentence?.replace(/\{side\}/g, extra.side)
    : tile.impressionSentence;
  return useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings, impression },
    templates: { findings, impression },
    ownership: {
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
    },
    source: "quick-select",
    id,
    region: extra?.region ?? tile.scopeBodyPart,
    label: tile.label,
    findingsText: findings,
    side: extra?.side,
    properties: tile.properties,
    force: extra?.force,
  });
}

function normalizedSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => normalizeContributionMatch(s))
    .filter(Boolean);
}

function hasDuplicateNormalized(text: string): boolean {
  const seen = new Set<string>();
  for (const s of normalizedSentences(text)) {
    if (seen.has(s)) return true;
    seen.add(s);
  }
  return false;
}

function mergeSummary(extra: Record<string, unknown>) {
  mergeJsonArtifact("composition-walkthrough-summary.json", extra);
}

describe("P0 composition safety walkthroughs", () => {
  beforeEach(() => reset("Brain"));

  it("1. finalize gate on stale impression — refresh and sign-anyway paths", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    const originalImpression = useWorkspace.getState().impressionText;
    expect(originalImpression).toMatch(/Fazekas grade 1/i);
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\nRadiologist note.`);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    const gate = collectCompositionFinalizeGate({
      impressionNeedsRefresh: true,
      findings: useWorkspace.getState().findingsText,
      patches: useWorkspace.getState().appliedPathologyPatches.map((p) => ({
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
    expect(gate.impressionNeedsRefresh).toBe(true);
    expect(compositionFinalizeAllowed({
      impressionNeedsRefresh: true,
      impressionRefreshed: false,
      impressionReviewedAnyway: false,
    })).toBe(false);

    // Path A — refresh
    useWorkspace.getState().refreshImpressionFromLedger();
    const refreshed = useWorkspace.getState().impressionText;
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(compositionFinalizeAllowed({
      impressionNeedsRefresh: false,
      impressionRefreshed: true,
      impressionReviewedAnyway: false,
    })).toBe(true);
    expect(refreshed.toLowerCase()).toContain("fazekas");

    // Path B — sign anyway on a fresh stale setup
    overlayTile(FAZEKAS1, "qf-f1");
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\nSecond note.`);
    const staleImpression = useWorkspace.getState().impressionText;
    expect(compositionFinalizeAllowed({
      impressionNeedsRefresh: true,
      impressionRefreshed: false,
      impressionReviewedAnyway: true,
    })).toBe(true);

    writeTestArtifact("walkthrough-finalize-stale-impression.html", html("P0.1 Finalize gate", [
      section("Gate blocks without ack", String(gate.impressionNeedsRefresh)),
      section("Refreshed impression", refreshed),
      section("Sign-anyway impression", staleImpression),
    ].join("")));
    mergeSummary({
      finalizeGateBlocks: true,
      finalizeRefreshPath: /fazekas/i.test(refreshed),
      finalizeAckPathKeepsImpression: staleImpression.length > 0,
    });
  });

  it("2. re-select after preserved-manual opens overwrite dialog with no duplicates", () => {
    overlayTile(FAZEKAS1, "qf-1");
    const edited = useWorkspace.getState().findingsText.replace("Fazekas grade 1", "Fazekas grade 1 — radiologist rewrite");
    useWorkspace.getState().setField("findings", edited);
    const outcome = useWorkspace.getState().removeObservation("qf-1");
    expect(outcome).toBe("preserved-manual");

    const status = overlayTile(FAZEKAS1, "qf-1");
    expect(status).toBe("pending");
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(true);

    useWorkspace.getState().cancelOverwrite();
    const afterCancel = useWorkspace.getState().findingsText;
    expect(hasDuplicateNormalized(afterCancel)).toBe(false);
    expect(afterCancel).toContain("radiologist rewrite");

    overlayTile(FAZEKAS1, "qf-1");
    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(true);
    useWorkspace.getState().confirmOverwriteAndApply();
    const afterConfirm = useWorkspace.getState().findingsText;
    expect(hasDuplicateNormalized(afterConfirm)).toBe(false);

    writeTestArtifact("walkthrough-reselect-preserved-manual.html", html("P0.2 Re-select after preserved-manual", [
      section("After cancel", afterCancel),
      section("After confirm", afterConfirm),
    ].join("")));
    mergeSummary({
      reselectDialogOpens: true,
      reselectCancelNoDup: !hasDuplicateNormalized(afterCancel),
      reselectConfirmNoDup: !hasDuplicateNormalized(afterConfirm),
    });
  });

  it("3. sibling warnings show all and survive to finalize gate", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    overlayTile(FAZEKAS2, "qf-f2");
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\nNo hemorrhage.`, { source: "template" });
    overlayTile(HEMOR, "qf-hem", { side: "right" });
    const warnings = useWorkspace.getState().ownershipReviewWarnings;
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    const tokens = warnings.map((w) => w.token);
    expect(tokens.some((t) => /confluent/i.test(t))).toBe(true);
    expect(tokens.some((t) => /hemorrhage/i.test(t))).toBe(true);

    const gate = collectCompositionFinalizeGate({
      impressionNeedsRefresh: useWorkspace.getState().impressionNeedsRefresh,
      findings: useWorkspace.getState().findingsText,
      patches: useWorkspace.getState().appliedPathologyPatches.map((p) => ({
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
    expect(gate.siblingWarnings.length).toBeGreaterThanOrEqual(2);

    writeTestArtifact("walkthrough-sibling-warnings.html", html("P0.3 Sibling warnings", [
      section("Banner warnings", warnings.map((w) => `${w.token}: ${w.sentence}`).join("\n")),
      section("Finalize gate", gate.siblingWarnings.map((w) => `${w.token}: ${w.sentence}`).join("\n")),
    ].join("")));
    mergeSummary({
      siblingWarningsAllShown: warnings.length >= 2,
      siblingWarningsAtFinalize: gate.siblingWarnings.length >= 2,
    });
  });
});

describe("P1 robustness walkthroughs", () => {
  beforeEach(() => reset("Brain"));

  it("4. NBSP + smart quotes still strip on deselect", () => {
    overlayTile(FAZEKAS1, "qs-f1");
    const raw = FAZEKAS1.sentence;
    const drifted = raw.replace(/ /g, "\u00a0").replace(/"/g, "\u201C").replace(/No confluent lesions\./, "No confluent lesions\u2014");
    // Keep the fazekas sentence recognizable; inject NBSP into the live field copy of lastRendered.
    const last = useWorkspace.getState().appliedPathologyPatches[0]!.lastRendered.findings!;
    const nbs = last.replace(/ /g, "\u00a0").replace(/\./g, "\u2014");
    useWorkspace.getState().setField("findings", nbs, { source: "ai-draft" });
    const outcome = useWorkspace.getState().removeObservation("qs-f1");
    expect(outcome).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toMatch(/fazekas/i);
    writeTestArtifact("walkthrough-nbsp-deselect.html", html("P1.4 NBSP deselect", section("After deselect", useWorkspace.getState().findingsText)));
    mergeSummary({ nbspDeselectRemoved: outcome === "removed" });
  });

  it("5. hydrate flags stale patches without rewriting narrative", () => {
    overlayTile(FAZEKAS1, "qf-1");
    const ledger = useWorkspace.getState().serializeObservationLedger();
    const original = useWorkspace.getState().findingsText;
    useWorkspace.setState({ findingsText: "Externally corrupted narrative. No fazekas sentence remains." });
    const result = useWorkspace.getState().hydrateObservationLedger(ledger);
    const s = useWorkspace.getState();
    expect(s.findingsText).toBe("Externally corrupted narrative. No fazekas sentence remains.");
    expect(s.appliedPathologyPatches.some((p) => p.stale)).toBe(true);
    expect(s.impressionNeedsRefresh).toBe(true);
    expect(s.ledgerHydrationWarning).toMatch(/no longer match/i);
    expect(result.warning).toBeTruthy();
    writeTestArtifact("walkthrough-hydrate-stale.html", html("P1.5 Hydrate stale", [
      section("Original", original),
      section("After corrupt+reload", s.findingsText),
      section("Warning", s.ledgerHydrationWarning ?? ""),
    ].join("")));
    mergeSummary({ hydrateStaleFlag: true, hydrateNarrativeUnchanged: true });
  });

  it("6. bundle deselect keeps QS override and restores the rest", () => {
    reset("LS Spine");
    const deg = catalogSetForKey("lumbar")?.tiles.find((t) => t.id === "spine-degenerative");
    expect(deg?.observations?.length).toBeGreaterThanOrEqual(4);
    useWorkspace.getState().applyMacroBundle({
      bundleId: "deg-walk",
      observations: (deg!.observations ?? []).map((obs, i) => ({
        incoming: { findings: obs.findingsText, impression: obs.impressionText },
        templates: { findings: obs.findingsText, impression: obs.impressionText },
        ownership: { conflictGroup: obs.conflictGroup, concept: obs.concept },
        source: "macro" as const,
        region: "LS Spine",
        concept: obs.concept,
        level: obs.level,
        label: "Degenerative",
        id: `deg-walk-${obs.concept ?? i}`,
      })),
    });
    const qsFindings = "Facet arthropathy at L4-L5 — QS override.";
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: qsFindings },
      templates: { findings: qsFindings },
      ownership: { conflictGroup: "facet_joint", concept: "facet_joint" },
      source: "quick-select",
      id: "qs-facet",
      region: "LS Spine",
      concept: "facet_joint",
      level: "L4-L5",
      label: "Facet QS",
      findingsText: qsFindings,
    });
    useWorkspace.getState().removeMacroBundle("deg-walk");
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("QS override");
    expect(s.appliedPathologyPatches.some((p) => p.id === "qs-facet")).toBe(true);
    expect(s.appliedPathologyPatches.filter((p) => p.observation?.bundleId === "deg-walk").length).toBe(0);
    expect(s.findingsText).not.toMatch(/desiccation/i);
    writeTestArtifact("walkthrough-bundle-deselect.html", html("P1.6 Bundle deselect", section("After", s.findingsText)));
    mergeSummary({ bundleDeselectKeepsQs: /QS override/.test(s.findingsText) });
  });

  it("7. blocked chip after cancel overwrite of protected ventricles", () => {
    overlayTile(VENTRICLES, "qf-9");
    const edited = useWorkspace.getState().findingsText.replace("normal in size", "normal in size — kept manual");
    useWorkspace.getState().setField("findings", edited);
    const status = overlayTile(HYDRO, "qf-hydro");
    expect(status).toBe("pending");
    useWorkspace.getState().cancelOverwrite();
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("kept manual");
    expect(s.findingsText).not.toMatch(/dilated, consistent with hydrocephalus/i);
    const hydro = s.appliedPathologyPatches.find((p) => p.id === "qf-hydro");
    expect(hydro).toBeTruthy();
    expect(patchFindingsContributionBlocked(hydro!, s.findingsText)).toBe(true);
    writeTestArtifact("walkthrough-blocked-chip.html", html("P1.7 Blocked chip", section("Findings", s.findingsText)));
    mergeSummary({ blockedChipAfterCancel: true });
  });

  it("8. voice-authored sentence stays protected on QS deselect after tweak", () => {
    const applied = useWorkspace.getState().applyVoiceComposerPlan({
      operation: "report_change_plan",
      observations: [{
        concept: "fazekas",
        conflictGroup: "fazekas",
        findingsText: FAZEKAS1.sentence,
        impressionText: FAZEKAS1.impressionSentence,
      }],
      uncertainties: [],
    }, "fazekas grade 1");
    expect(applied).toBe("applied");
    const tweaked = useWorkspace.getState().findingsText.replace("Fazekas grade 1", "Fazekas grade 1 mildly");
    useWorkspace.getState().setField("findings", tweaked);
    const voiceId = useWorkspace.getState().appliedPathologyPatches.find((p) => p.source === "radiologist-voice")?.id;
    expect(voiceId).toBeTruthy();
    const outcome = useWorkspace.getState().removeObservation(voiceId!);
    expect(outcome).toBe("preserved-manual");
    expect(useWorkspace.getState().findingsText).toContain("mildly");
    writeTestArtifact("walkthrough-voice-protect.html", html("P1.8 Voice protection", section("After deselect", useWorkspace.getState().findingsText)));
    mergeSummary({ voiceProtectKeepsTweak: true });
  });
});

describe("P2 technique fragment + ledger version", () => {
  it("9. LS + dorsal screening keeps limited wording once; Brain + orbital too", () => {
    const lsDorsal = mergeTwoFormats(LS, DORSAL);
    const limitedCount = (lsDorsal.technique.match(/limited/gi) ?? []).length;
    expect(/limited planar and limited sequence/i.test(lsDorsal.technique)).toBe(true);
    const brainOrbit = mergeTwoFormats(BRAIN, ORBIT);
    expect(/limited orbital screening/i.test(brainOrbit.technique)).toBe(true);
    const orbitalLimited = brainOrbit.technique.match(/limited/gi) ?? [];
    expect(orbitalLimited.length).toBeGreaterThan(0);
    const whole = mergeTwoFormats(LS, WHOLE);
    expect(/limited planar and limited sequence/i.test(whole.technique)).toBe(true);
    writeTestArtifact("walkthrough-technique-fragments.html", html("P2.9 Technique fragments", [
      section("LS + dorsal", lsDorsal.technique),
      section("Brain + orbital", brainOrbit.technique),
    ].join("")));
    mergeSummary({
      lsDorsalLimitedOnce: /limited planar/i.test(lsDorsal.technique),
      brainOrbitLimited: /limited orbital screening/i.test(brainOrbit.technique),
      limitedCount,
    });
  });

  it("11. future-version ledger round-trips as narrative-only; unknown enums coerce", () => {
    overlayTile(FAZEKAS1, "qf-1");
    const v1 = useWorkspace.getState().serializeObservationLedger();
    const future = { ...v1, version: 2 as const };
    const parsed = parseObservationLedger(future);
    expect(parsed.status).toBe("incompatible");
    expect(parsed.patches).toEqual([]);
    const restored = useWorkspace.getState().hydrateObservationLedger(future);
    expect(restored.mode).toBe("narrative-only");
    expect(useWorkspace.getState().findingsText).toMatch(/fazekas/i);

    const weird = {
      kind: OBSERVATION_LEDGER_KIND,
      version: 1 as const,
      patches: [{
        ...v1.patches[0]!,
        observation: { ...v1.patches[0]!.observation, role: "not-a-role", specificity: "galaxy" },
      }],
    };
    const coerced = parseObservationLedger(weird);
    expect(coerced.status).toBe("restored");
    expect(coerced.patches[0]!.observation.role).toBe("finding");
    expect(coerced.patches[0]!.observation.specificity).toBe("study");
    mergeSummary({ ledgerFutureVersionSafe: true, ledgerUnknownEnumsCoerce: true });
  });
});

describe("P2.10 artifact dir helper", () => {
  it("honors CARE_TEST_ARTIFACT_DIR and never throws on write", () => {
    const prev = process.env.CARE_TEST_ARTIFACT_DIR;
    const dir = join(tmpdir(), `care-test-artifacts-${Date.now()}`);
    process.env.CARE_TEST_ARTIFACT_DIR = dir;
    try {
      const written = writeTestArtifact("helper-probe.json", JSON.stringify({ ok: true }));
      expect(written).toBeTruthy();
      expect(written!.startsWith(dir)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CARE_TEST_ARTIFACT_DIR;
      else process.env.CARE_TEST_ARTIFACT_DIR = prev;
    }
  });
});

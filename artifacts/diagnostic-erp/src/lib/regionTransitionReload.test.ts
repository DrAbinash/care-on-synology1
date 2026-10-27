/**
 * regionTransitionReload.test.ts — PR E PRIORITY 1: a re-regioned report must not be
 * regenerated as the examination it was booked as.
 *
 * The observed inconsistency, in the product's own words: after a confirmed Whole Spine →
 * Cervical Spine transition the Findings are cervical-only, the transition is recorded, and
 * save → reload preserves the content byte-for-byte — but the Region control reads
 * **Whole Spine** again, because `regionOverrides` is session React state
 * (`useReportingStudySetup.ts:164`) and the save payload carries no region
 * (`useDraftPersistence.ts:515` sends only the transition RECORD). ADR-004 §Persistence
 * documents that as the design.
 *
 * The design is only safe if nothing acts on the reloaded region. This file measures whether
 * that holds at the one action that writes the whole report without asking:
 * `generateProfessionalReport`, which resolves its normal format from the context it is
 * handed (`normalBootstrap.ts:216`, `resolveNormalBootstrapFormat` reads ctx regions and
 * nothing else) and merges that format's sentences into the text on the page. The
 * The mount-time auto-bootstrap cannot do this — `useWorkspaceClinicalUi.tsx` returns for any
 * study with a saved draft (`if (existingDraft) return;`) — so the press is the reachable path,
 * and it is the path the brief asks about.
 *
 * Everything below runs the real store against the real shipped format library, and reloads
 * through the real envelope: `serializeObservationLedger` + `regionTransitionPayload` out,
 * `setEditorContent` + `hydrateObservationLedger` + `extractCareRegionTransitions` +
 * `hydrateRegionTransitions` back in. What the simulation cannot do is prove the hook
 * rebuilds the same context after reload — it can only assert it, from the same lines the
 * hook reads — so the browser run in the PR body is what closes that gap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  extractCareRegionTransitions,
  planRegionTransition,
  regionTransitionPayload,
  type TransitionRow,
} from "@/lib/regionTransition";
import * as REGION_TRANSITION_MODULE from "@/lib/regionTransition";
import type { RegionTransitionRecord } from "@/lib/regionTransition";

/**
 * Read through the namespace so this file also runs BEFORE the rule exists: the red run then
 * fails on the missing predicate rather than failing to import, which would have hidden the
 * behavioural evidence below behind a collection error.
 */
const regionIdentityConflictsWithTransition = (
  REGION_TRANSITION_MODULE as Record<string, unknown>
).regionIdentityConflictsWithTransition as (input: {
  source: ReportingStudyContext["source"];
  regions: string[];
  records: readonly RegionTransitionRecord[];
}) => boolean;

const ACTOR = "abinashsingh@gmail.com";
const WHOLE = buildReportingStudyContext({
  modality: "MR",
  studyDescription: "MRI SCREENING WHOLE SPINE",
  regions: ["Whole Spine"],
  source: "billed",
});
const CERVICAL = buildReportingStudyContext({
  modality: "MR",
  studyDescription: "MRI SCREENING WHOLE SPINE",
  regions: ["Cervical Spine"],
  source: "override",
});

function lines(text: string) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Exactly the projection `useReportingStudySetup` feeds the planner. */
function ledgerRows(): TransitionRow[] {
  return useWorkspace.getState().appliedPathologyPatches
    .filter((p) => !p.stale && !p.protected)
    .map((p) => ({
      id: p.id,
      role: p.observation?.role ?? null,
      concept: p.observation?.concept ?? null,
      region: p.observation?.region ?? null,
      level: p.observation?.level ?? null,
      text: (p.lastRendered.findings ?? "").trim() || (p.lastRendered.impression ?? "").trim(),
    }))
    .filter((r) => r.text.length > 0);
}

/**
 * Steps 1–4 of the brief: open the booked whole-spine study, Generate its normal report,
 * change the region to Cervical Spine, confirm the transition.
 */
function generateThenTransitionToCervical() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    selectedFormatIds: [], pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, confirmOverwriteOpen: false, mergePreviewOpen: false,
    appliedFormatName: null, appliedFormatReportTitle: null, startingCanvasBaseline: null,
    patchUndoStack: [], isFinalized: false, isDirty: false, regionTransitions: [],
    reportingContext: WHOLE,
    reportFormats: DEFAULT_REPORT_FORMATS,
  });
  const generated = useWorkspace.getState().generateProfessionalReport(WHOLE);
  expect(generated.status).toBe("generated");

  const plan = planRegionTransition({
    fromRegion: "Whole Spine",
    toRegion: "Cervical Spine",
    rows: ledgerRows(),
    findingsText: useWorkspace.getState().findingsText,
  });
  expect(plan.requiresConfirmation).toBe(true);
  const record = useWorkspace.getState().commitRegionTransition(plan, ACTOR);
  expect(record).not.toBeNull();
  return { record: record!, generated };
}

/**
 * Steps 4–6: save, close, reopen. The store is emptied the way a study switch empties it,
 * then refilled from the draft envelope the save actually wrote — the same calls
 * `useDraftPersistence.ts:273-330` makes, in that order.
 */
function saveAndReopen() {
  const s = useWorkspace.getState();
  const saved = {
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
    technique: s.techniqueText,
    clinicalHistory: s.clinicalHistoryText,
    ledger: s.serializeObservationLedger(),
    structuredJson: { careRegionTransitions: regionTransitionPayload(s.regionTransitions) },
  };

  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    selectedFormatIds: [], pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, confirmOverwriteOpen: false, mergePreviewOpen: false,
    appliedFormatName: null, appliedFormatReportTitle: null, startingCanvasBaseline: null,
    patchUndoStack: [], isFinalized: false, isDirty: false, regionTransitions: [],
    // The hook's own projection with no override: `regionOverrides` is null after a reload,
    // so `studyRegions` falls back to the billed region (useReportingStudySetup.ts:241-247).
    reportingContext: WHOLE,
    reportFormats: DEFAULT_REPORT_FORMATS,
  });
  useWorkspace.getState().setEditorContent({
    findings: saved.findings,
    impression: saved.impression,
    recommendation: saved.recommendation,
    technique: saved.technique,
    clinicalHistory: saved.clinicalHistory,
  });
  useWorkspace.getState().hydrateObservationLedger(saved.ledger);
  useWorkspace.getState().hydrateRegionTransitions(
    extractCareRegionTransitions(saved.structuredJson),
  );
  return saved;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("the transition record survives save → reload", () => {
  it("comes back with the same decision and the same retired sentences", () => {
    const { record } = generateThenTransitionToCervical();
    saveAndReopen();
    const restored = useWorkspace.getState().regionTransitions;
    expect(restored).toHaveLength(1);
    expect(restored[0].kind).toBe("care.region_transition.v1");
    expect(restored[0].toRegion).toBe("Cervical Spine");
    expect(restored[0].retired.map((r) => r.text)).toEqual(record.retired.map((r) => r.text));
  });

  it("keeps the cervical-only text and the cervical ledger rows it saved", () => {
    const { record } = generateThenTransitionToCervical();
    const saved = saveAndReopen();
    expect(saved.findings).not.toContain("Dorsal spine:");
    expect(saved.findings).not.toContain("Lumbar spine:");
    for (const row of record.retired) {
      expect(useWorkspace.getState().findingsText).not.toContain(row.text.trim());
    }
    expect(lines(useWorkspace.getState().findingsText)).toEqual(lines(saved.findings));
  });
});

describe("Generate on a reloaded report that was moved to another region", () => {
  it("does not bring back a sentence the radiologist retired", () => {
    const { record } = generateThenTransitionToCervical();
    saveAndReopen();
    const outcome = useWorkspace.getState().generateProfessionalReport(WHOLE);
    const findings = useWorkspace.getState().findingsText;
    for (const row of record.retired) {
      expect(findings).not.toContain(row.text.trim());
    }
  });

  it("does not assert the whole-spine normal conclusion on a cervical report", () => {
    generateThenTransitionToCervical();
    saveAndReopen();
    useWorkspace.getState().generateProfessionalReport(WHOLE);
    expect(useWorkspace.getState().impressionText).not.toContain("Normal whole-spine screening MRI");
  });

  it("refuses, and names the region the report was moved to", () => {
    generateThenTransitionToCervical();
    saveAndReopen();
    const outcome = useWorkspace.getState().generateProfessionalReport(WHOLE);
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.reason).toContain("Cervical Spine");
    expect(outcome.reason).toContain("Whole Spine");
  });

  it("changes nothing when it refuses — text, ledger, undo, dirty flag and history", () => {
    const { record } = generateThenTransitionToCervical();
    saveAndReopen();
    const before = useWorkspace.getState();
    const snapshot = {
      findings: before.findingsText,
      impression: before.impressionText,
      recommendation: before.recommendationText,
      technique: before.techniqueText,
      patchIds: before.appliedPathologyPatches.map((p) => p.id).sort(),
      provenance: JSON.stringify(before.fieldProvenance),
      undo: before.patchUndoStack.length,
      isDirty: before.isDirty,
    };
    useWorkspace.getState().generateProfessionalReport(WHOLE);
    const after = useWorkspace.getState();
    expect(after.findingsText).toBe(snapshot.findings);
    expect(after.impressionText).toBe(snapshot.impression);
    expect(after.recommendationText).toBe(snapshot.recommendation);
    expect(after.techniqueText).toBe(snapshot.technique);
    expect(after.appliedPathologyPatches.map((p) => p.id).sort()).toEqual(snapshot.patchIds);
    expect(JSON.stringify(after.fieldProvenance)).toBe(snapshot.provenance);
    expect(after.patchUndoStack.length).toBe(snapshot.undo);
    expect(after.isDirty).toBe(snapshot.isDirty);
    // The original decision is never rewritten or appended to.
    expect(after.regionTransitions).toEqual([record]);
  });
});

describe("the guard is about the recorded decision, not about history existing", () => {
  it("generates normally for a whole-spine study that was never re-regioned", () => {
    useWorkspace.setState({
      findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
      clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
      regionTransitions: [], reportingContext: WHOLE, reportFormats: DEFAULT_REPORT_FORMATS,
      patchUndoStack: [], confirmOverwriteOpen: false, pendingPathologyPatch: null,
      mergePreviewOpen: false, isFinalized: false, isDirty: false,
    });
    expect(useWorkspace.getState().generateProfessionalReport(WHOLE).status).toBe("generated");
    expect(useWorkspace.getState().findingsText).toContain("Dorsal spine:");
  });

  it("generates once the radiologist selects the region the report was moved to", () => {
    generateThenTransitionToCervical();
    saveAndReopen();
    const outcome = useWorkspace.getState().generateProfessionalReport(CERVICAL);
    expect(outcome.status).not.toBe("refused");
    expect(useWorkspace.getState().findingsText).toContain("Cervical spine:");
    expect(useWorkspace.getState().findingsText).not.toContain("Dorsal spine:");
  });

  it("generates when the radiologist explicitly widens the study back", () => {
    generateThenTransitionToCervical();
    saveAndReopen();
    // Widening is an explicit region choice, so it carries `source: "override"` and writes
    // no new record (`commitRegionTransition` returns null when nothing retires).
    const widened = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI SCREENING WHOLE SPINE",
      regions: ["Whole Spine"],
      source: "override",
    });
    expect(useWorkspace.getState().generateProfessionalReport(widened).status).toBe("generated");
  });

  it("refuses for an auto- or dicom-resolved region the way it refuses for a billed one", () => {
    generateThenTransitionToCervical();
    saveAndReopen();
    for (const source of ["auto", "dicom"] as const) {
      const ctx = buildReportingStudyContext({
        modality: "MR",
        studyDescription: "MRI SCREENING WHOLE SPINE",
        regions: ["Whole Spine"],
        source,
      });
      expect(useWorkspace.getState().generateProfessionalReport(ctx).status).toBe("refused");
    }
  });
});

describe("the decision is one pure rule the callers share", () => {
  const records = (toRegion: string) => [{
    kind: "care.region_transition.v1" as const,
    fromRegion: "Whole Spine",
    toRegion,
    retired: [{ id: "x", concept: "normal", segment: "cervical" as const, text: "Cervical spine: normal." }],
    keptAbnormalities: [],
    manualLinesPreserved: 0,
    decidedBy: ACTOR,
    at: "2026-10-13T00:00:00.000Z",
  }];

  it("reads only the region identity and the record — never report prose", () => {
    // No text argument exists, so prose cannot be an input at all.
    expect(regionIdentityConflictsWithTransition.length).toBe(1);
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["Whole Spine"], records: records("Cervical Spine"),
    })).toBe(true);
    expect(regionIdentityConflictsWithTransition({
      source: "override", regions: ["Cervical Spine"], records: records("Cervical Spine"),
    })).toBe(false);
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["Whole Spine"], records: [],
    })).toBe(false);
  });

  it("treats the product's own region spellings as the same region", () => {
    // One case per side of the comparison: a synonym on the context side, and a synonym on
    // the recorded side. A rule that canonicalises only one of them passes the first and
    // fails the second, which is how the short form a radiologist actually sees
    // ("Dorsal", "C-Spine") would otherwise refuse its own long form.
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["C-Spine"], records: records("Cervical Spine"),
    })).toBe(false);
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["Dorsal Spine"], records: records("Dorsal"),
    })).toBe(false);
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["Whole Spine"], records: records("Dorsal"),
    })).toBe(true);
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["Dorsal Spine"], records: records("Cervical Spine"),
    })).toBe(true);
  });

  it("judges the LAST recorded decision, because that is what the text on the page is", () => {
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["Whole Spine"],
      records: [...records("Cervical Spine"), ...records("LS Spine")],
    })).toBe(true);
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["LS Spine"],
      records: [...records("Cervical Spine"), ...records("LS Spine")],
    })).toBe(false);
  });

  it("cannot be reached from a record the envelope rejected", () => {
    // `extractCareRegionTransitions` drops malformed rows structurally; a report whose
    // history did not parse is an ordinary study again, and must not be refused for it.
    expect(extractCareRegionTransitions({ careRegionTransitions: [{ kind: "other" }] })).toEqual([]);
    expect(regionIdentityConflictsWithTransition({
      source: "billed", regions: ["Whole Spine"],
      records: extractCareRegionTransitions({ careRegionTransitions: [{ kind: "other" }] }),
    })).toBe(false);
  });
});

describe("both writers of the report ask the same rule", () => {
  // Read the shipped source. These two are wiring assertions about WHERE the check sits; the
  // behaviour above is what it does, and a guard in the wrong order is not a guard.
  const srcDir = fileURLToPath(new URL(".", import.meta.url));
  const STORE = readFileSync(join(srcDir, "zai-workspace/store.ts"), "utf8");
  const CLINICAL_UI = readFileSync(
    join(srcDir, "../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"), "utf8",
  );

  function window(text: string, start: string, end: string, label: string) {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    expect(`${label} start ${from}`).not.toBe("-1");
    expect(`${label} end ${to}`).not.toBe("-1");
    return text.slice(from, to);
  }

  it("the generator refuses before it resolves a format, so nothing is picked let alone written", () => {
    // The window is over the generator's body; `opts` arrived with MODE A's
    // automatic pass and is the only thing the start marker had to track. Every
    // assertion below it is the ordering it was written for.
    const body = window(STORE, "generateProfessionalReport: (ctx, opts) => {", "const format = decision.format;", "generate");
    expect(body).toContain("regionIdentityConflictMessage({");
    expect(body).toContain('code: "region-transition"');
    expect(body.indexOf("regionIdentityConflictMessage({")).toBeLessThan(body.indexOf("resolveNormalBootstrapFormat("));
  });

  it("Start Report checks before its setup half runs, because setup writes Technique", () => {
    const body = window(
      CLINICAL_UI,
      "const handleStartReport = useCallback(",
      "const undoStartReport = useCallback(",
      "handleStartReport",
    );
    expect(body).toContain("regionIdentityConflictMessage({");
    expect(body.indexOf("regionIdentityConflictMessage({")).toBeLessThan(body.indexOf("startReportSetup()"));
    expect(body.indexOf("startReportSetup()")).toBeLessThan(body.indexOf("generateProfessionalReport("));
    // The refusal is said out loud, in the same voice as every other refusal here.
    expect(body).toContain('variant: "destructive"');
    expect(body).toContain("description: regionConflict");
  });

  it("reads the region from the context the action uses, not from a second source of truth", () => {
    const body = window(
      CLINICAL_UI,
      "const handleStartReport = useCallback(",
      "const undoStartReport = useCallback(",
      "handleStartReport",
    );
    // One context object, computed once and passed to both the check and the generator —
    // two computations could disagree about which examination this is.
    expect(body).toContain("const ctx = billedStudyContextForNormal(");
    expect(body).toContain("generateProfessionalReport(ctx)");
    expect(body.match(/billedStudyContextForNormal\(/g)?.length).toBe(1);
  });
});

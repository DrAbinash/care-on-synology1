/**
 * regionTransitionCommit.test.ts — PR E PRIORITY 3: what a CONFIRMED region change writes.
 *
 * `regionTransition.test.ts` decides what a transition means; a decision writes no report.
 * The product already has exactly one per-observation withdrawal — `removeObservation`, the
 * call a Quick Select deselection makes — which takes that row's own sentence out, brings
 * back the baseline the row had been covering, detaches its measurements and re-aligns the
 * Recommendation. `commitRegionTransition` runs that primitive over a confirmed plan in ONE
 * undo frame and records only the sentences that actually left.
 *
 * Everything here is measured against the report the whole-spine screening normal format
 * produces through the real store, because that is the report a re-booked study arrives with.
 * The state of this flow BEFORE the wiring is measured in a real browser (PR body, and ADR-004
 * §Verification): the region changed, all sixteen Findings lines stayed, ten of them naming
 * dorsal or lumbar anatomy, and nothing asked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace, type AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { CLINICAL_RESET_FIELDS, emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import {
  extractCareRegionTransitions,
  planRegionTransition,
  regionTransitionActor,
  regionTransitionPayload,
  type RegionTransitionRecord,
  type TransitionRow,
} from "@/lib/regionTransition";

const WHOLE_SPINE_FORMAT = "MRI Whole Spine — Screening Normal";
const ACTOR = "abinashsingh@gmail.com";
const LIMITATION_LINE = "SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.";

/** The same projection the hook builds its plan from, protected rows included. */
function ledgerRows(
  patches: AppliedPathologyPatch[],
  { skipProtected = true } = {},
): TransitionRow[] {
  return patches
    .filter((p) => !p.stale && (!skipProtected || !p.protected))
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

/** The report as the store holds it after the mount-time bootstrap of a whole-spine study. */
function openWholeSpineNormal() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    selectedFormatIds: [], pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, confirmOverwriteOpen: false, mergePreviewOpen: false,
    appliedFormatName: null, appliedFormatReportTitle: null, startingCanvasBaseline: null,
    isFinalized: false, isDirty: false, regionTransitions: [],
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI SCREENING WHOLE SPINE",
      regions: ["Whole Spine"],
      source: "billed",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
  });
  const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === WHOLE_SPINE_FORMAT)!;
  useWorkspace.getState().applyFormatById(format.id);
  const s = useWorkspace.getState();
  const rows = ledgerRows(s.appliedPathologyPatches);
  return {
    rows,
    findings: s.findingsText,
    impression: s.impressionText,
    patchIds: s.appliedPathologyPatches.map((p) => p.id),
    plan: planRegionTransition({
      fromRegion: "Whole Spine",
      toRegion: "Cervical Spine",
      rows,
      findingsText: s.findingsText,
    }),
  };
}

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

describe("committing a confirmed Whole Spine → Cervical Spine transition", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  it("writes the cervical-only report and records exactly what left", () => {
    const before = openWholeSpineNormal();
    expect(before.plan.requiresConfirmation).toBe(true);
    expect(lines(before.findings)).toHaveLength(16);
    // Eleven, not twelve: the screening-limitation row comes out of the format apply already
    // `protected`, the store refuses to withdraw it, and the hook therefore does not offer it.
    expect(before.plan.retire).toHaveLength(11);

    const record = useWorkspace.getState().commitRegionTransition(before.plan, ACTOR);
    expect(record).not.toBeNull();
    const after = useWorkspace.getState();

    // The clinical claim: no sentence about anatomy a cervical examination does not acquire.
    expect(after.findingsText).not.toContain("Dorsal spine:");
    expect(after.findingsText).not.toContain("Lumbar spine:");
    // The whole-spine conclusion goes with them — it concludes about segments the new
    // examination does not cover, and a transition invents a replacement for nothing.
    expect(after.impressionText).not.toContain("Normal whole-spine screening MRI");
    // What it keeps, byte-identical and in the same order — nothing re-rendered on the way.
    const afterLines = lines(after.findingsText);
    const beforeLines = lines(before.findings);
    expect(afterLines).toEqual(
      beforeLines.filter((l) => l.startsWith("Cervical spine:") || l === LIMITATION_LINE),
    );
    // The acquisition caveat stays because its row is protected from withdrawal, not because
    // the transition forgot it. It under-states the examination rather than over-claiming it.
    expect(after.findingsText).toContain(LIMITATION_LINE);

    // The audit claim: only rows whose sentence really left are recorded.
    expect(record!.kind).toBe("care.region_transition.v1");
    expect(record!.fromRegion).toBe("Whole Spine");
    expect(record!.toRegion).toBe("Cervical Spine");
    expect(record!.decidedBy).toBe(ACTOR);
    expect(record!.retired).toHaveLength(11);
    expect(record!.retired.every((r) => !after.findingsText.includes(r.text.trim()))).toBe(true);
    expect(record!.retired.some((r) => r.text === LIMITATION_LINE)).toBe(false);
    expect(after.regionTransitions).toEqual([record]);
    expect(after.isDirty).toBe(true);
  });

  it("removes the retired rows from the ledger and keeps the cervical ones", () => {
    const before = openWholeSpineNormal();
    useWorkspace.getState().commitRegionTransition(before.plan, ACTOR);
    const ids = useWorkspace.getState().appliedPathologyPatches.map((p) => p.id);
    for (const row of before.plan.retire) expect(ids).not.toContain(row.id);
    for (const row of before.plan.keep) expect(ids).toContain(row.id);
    // Exactly the retired rows went: the protected caveat row the plan never offered is still
    // in the ledger, so the count is the whole ledger minus what this transition removed.
    expect(ids).toHaveLength(before.patchIds.length - before.plan.retire.length);
  });

  it("is ONE undo action: a single Undo restores the report and forgets the record", () => {
    const before = openWholeSpineNormal();
    // The clinical Undo history is five frames deep, so "one frame" is not a style
    // preference: eleven per-row frames would push the newest one off the end of the stack
    // and evict actions the radiologist took before the transition.
    useWorkspace.setState({ patchUndoStack: [] });
    useWorkspace.getState().commitRegionTransition(before.plan, ACTOR);
    expect(useWorkspace.getState().findingsText).not.toBe(before.findings);
    expect(useWorkspace.getState().patchUndoStack).toHaveLength(1);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    const after = useWorkspace.getState();
    expect(after.findingsText).toBe(before.findings);
    expect(after.impressionText).toBe(before.impression);
    expect(after.appliedPathologyPatches.map((p) => p.id)).toEqual(before.patchIds);
    expect(after.regionTransitions).toEqual([]);
  });

  it("refuses on a signed report, because a confirmed dialog is not a licence to edit it", () => {
    const before = openWholeSpineNormal();
    useWorkspace.setState({ isFinalized: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(useWorkspace.getState().commitRegionTransition(before.plan, ACTOR)).toBeNull();
    const after = useWorkspace.getState();
    expect(after.findingsText).toBe(before.findings);
    expect(after.regionTransitions).toEqual([]);
    expect(warn.mock.calls
      .map((c) => String((c[1] as { action?: string } | undefined)?.action ?? "")))
      .toContain("commitRegionTransition");
    warn.mockRestore();
  });

  it("writes no record for a plan that retires nothing", () => {
    const { rows, findings } = openWholeSpineNormal();
    const widening = planRegionTransition({
      fromRegion: "Cervical Spine", toRegion: "Whole Spine", rows, findingsText: findings,
    });
    expect(widening.retire).toEqual([]);
    expect(useWorkspace.getState().commitRegionTransition(widening, ACTOR)).toBeNull();
    expect(useWorkspace.getState().regionTransitions).toEqual([]);
  });

  it("keeps a sentence the radiologist rewrote and does not claim it left", () => {
    const before = openWholeSpineNormal();
    const target = before.plan.retire.find((r) => r.text.includes("Dorsal spine:"))!;
    const handWritten = "Dorsal spine: Old healed D7 fracture, discussed with the referring surgeon.";
    // The way the editor writes: no source, so only the touched line becomes the
    // radiologist's and every other line keeps the ledger's ownership.
    useWorkspace.getState().setField(
      "findings",
      useWorkspace.getState().findingsText.replace(target.text, handWritten),
    );
    const plan = planRegionTransition({
      fromRegion: "Whole Spine",
      toRegion: "Cervical Spine",
      rows: ledgerRows(useWorkspace.getState().appliedPathologyPatches),
      findingsText: useWorkspace.getState().findingsText,
    });
    const record = useWorkspace.getState().commitRegionTransition(plan, ACTOR);
    const after = useWorkspace.getState();
    expect(after.findingsText).toContain(handWritten);
    expect(record!.retired.some((r) => r.text === target.text)).toBe(false);
    // The rows the radiologist never touched still retire — protection is per sentence, not
    // per field, or no edited report could ever be re-regioned.
    expect(after.findingsText).not.toContain("Lumbar spine:");
    expect(after.findingsText).not.toContain(target.text);
  });

  it("does not record a row the store declined to withdraw", () => {
    // The plan is built from the ledger's own `lastRendered`, so it can offer a row whose
    // sentence is no longer on the page at all — the store answers that with
    // "no-op-unproven" rather than a removal. The record is a statement about what left the
    // report, so a row that was never on it cannot appear in it.
    const before = openWholeSpineNormal();
    const vanished = before.plan.retire.find((r) => r.text.includes("Dorsal spine:"))!;
    useWorkspace.setState({
      findingsText: useWorkspace.getState().findingsText
        .split("\n")
        .filter((l) => l.trim() !== vanished.text.trim())
        .join("\n"),
    });
    expect(vanished.text).toBeTruthy();
    const record = useWorkspace.getState().commitRegionTransition(before.plan, ACTOR);
    expect(record).not.toBeNull();
    expect(record!.retired.some((r) => r.id === vanished.id)).toBe(false);
    expect(record!.retired.every((r) => !useWorkspace.getState().findingsText.includes(r.text.trim())))
      .toBe(true);
  });

  it("announces the same number of normals it then removes", () => {
    const before = openWholeSpineNormal();
    expect(before.plan.summary).toContain("11 normals");
    const record = useWorkspace.getState().commitRegionTransition(before.plan, ACTOR)!;
    expect(record.retired).toHaveLength(11);
  });
});

describe("the transition record survives save → reload", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  it("round-trips through the structured_json envelope key the server writes", () => {
    const before = openWholeSpineNormal();
    const record = useWorkspace.getState().commitRegionTransition(before.plan, ACTOR)!;
    const envelope = {
      kind: "care.structured_json_envelope",
      careRegionTransitions: regionTransitionPayload(useWorkspace.getState().regionTransitions),
    };
    const restored = extractCareRegionTransitions(envelope);
    expect(restored).toEqual([record]);
    expect(restored[0]!.retired.map((r) => r.text)).toEqual(record.retired.map((r) => r.text));
  });

  it("sends nothing for a report that has never been re-regioned", () => {
    openWholeSpineNormal();
    expect(regionTransitionPayload(useWorkspace.getState().regionTransitions)).toBeUndefined();
    expect(extractCareRegionTransitions({ kind: "care.structured_json_envelope" })).toEqual([]);
  });

  it("drops a stored row that does not carry the contract rather than coercing it", () => {
    const junk = {
      careRegionTransitions: [
        { kind: "care.region_transition.v1", toRegion: "Cervical Spine", retired: [{ id: "a", text: "kept" }] },
        { kind: "care.something_else", toRegion: "Cervical Spine", retired: [] },
        { kind: "care.region_transition.v1", retired: [] },
        null,
      ],
    };
    const restored = extractCareRegionTransitions(junk);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.retired).toEqual([{ id: "a", text: "kept" }]);
    expect(restored[0]!.manualLinesPreserved).toBe(0);
  });

  it("reads the request field too, so a draft written under either name comes back", () => {
    const one = {
      kind: "care.region_transition.v1",
      fromRegion: "Whole Spine",
      toRegion: "Cervical Spine",
      retired: [{ id: "x", concept: "alignment", segment: "dorsal", text: "Dorsal spine: Normal." }],
      keptAbnormalities: [],
      manualLinesPreserved: 0,
      decidedBy: ACTOR,
      at: "2026-10-12T09:00:00.000Z",
    } satisfies RegionTransitionRecord;
    expect(extractCareRegionTransitions({ regionTransitions: [one] })).toEqual([one]);
  });

  it("hydrates the history back into the store on reopen", () => {
    const record = useWorkspace.getState()
      .commitRegionTransition(openWholeSpineNormal().plan, ACTOR)!;
    useWorkspace.getState().hydrateRegionTransitions([]);
    expect(useWorkspace.getState().regionTransitions).toEqual([]);
    useWorkspace.getState().hydrateRegionTransitions([record]);
    expect(useWorkspace.getState().regionTransitions).toEqual([record]);
    useWorkspace.getState().hydrateRegionTransitions(null as unknown as RegionTransitionRecord[]);
    expect(useWorkspace.getState().regionTransitions).toEqual([]);
  });

  it("names the signed-in staff member the app actually holds in its session", () => {
    // The audit record says WHO decided. Reading it off a guessed localStorage key returns
    // "" in the live app, which is a record claiming nobody decided anything.
    const store = new Map<string, string>();
    store.set("erp_session", JSON.stringify({
      token: "t",
      user: { id: 1, name: "Dr Abinash Kumar", email: "abinashsingh@gmail.com", role: "super_admin", permissions: ["/"] },
    }));
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      },
    });
    expect(regionTransitionActor()).toBe("Dr Abinash Kumar");
    // No name, still somebody: the login identity, not a blank.
    store.set("erp_session", JSON.stringify({
      token: "t",
      user: { id: 2, name: "", email: "radiologist@care.local", role: "doctor", permissions: ["/"] },
    }));
    expect(regionTransitionActor()).toBe("radiologist@care.local");
    // No session at all answers "", and never invents a name.
    vi.unstubAllGlobals();
    expect(regionTransitionActor()).toBe("");
  });

  it("is study-scoped: the clinical reset bucket holds it", () => {
    // PR #834's rule — a key that joins the store but not the reset bucket is how one
    // patient's provenance arrives on the next patient's report.
    expect(CLINICAL_RESET_FIELDS).toContain("regionTransitions");
    expect(emptyClinicalState().regionTransitions).toEqual([]);
  });
});

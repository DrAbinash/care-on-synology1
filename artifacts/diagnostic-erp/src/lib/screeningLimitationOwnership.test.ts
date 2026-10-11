/**
 * screeningLimitationOwnership.test.ts — one sentence about the examination must
 * not delete the examination.
 *
 * The screening limitation ("SCREENING STUDIES ARE LIMITED PLANAR & LIMITED
 * SEQUENCE.") is written once per report as its own ledger bundle. It is not an
 * observation of any anatomy, so it must retire nothing — but until it declared
 * a baseline contract it fell through `sentenceOwnedBySlot`'s section fallback,
 * which asks whether the sentence already on the page contains the row's
 * `anatomicalSection`. That section is the literal word "screening", and CARE's
 * five screening manifests write every one of their normals as
 * "<Region> spine: … on screening sequences." / "… on screening images.". The
 * measured result on main: applying one limitation row deleted 29 of the 43
 * screening-manifest baseline findings sentences — 13 of the 16 in the
 * whole-spine manifest alone — while all of those ledger rows stayed live, so
 * the report and the ledger disagreed and nothing on screen said a sentence had
 * gone.
 *
 * The existing screening suite could not see this: every ledger test in
 * `mriSpineScreening.test.ts` starts from `resetLedger()` — an empty report — so
 * the limitation atom never met a sentence to overwrite.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { sentenceMatchesConcept, sentenceOwnedBySlot } from "@/lib/observationSlot";
import { resolveScreeningRoles } from "@/lib/mriSpineScreeningRoles";
import { SCREENING_SCHEMAS } from "@/lib/mriSpineScreeningSchemas";
import {
  SCREENING_BUNDLE_PREFIX,
  SCREENING_LIMITATION_BUNDLE_ID,
  defaultScreeningState,
  screeningLedgerBundles,
  screeningLimitationAtom,
  screeningRegionBundleId,
  type ScreeningState,
} from "@/lib/mriSpineScreening";
import type { SpineScreeningRegion } from "@/lib/mriSpineScreeningSchema";
import { SCREENING_LIMITATION_TEXT } from "@/lib/zai-workspace/baselines/screeningLimitation";

/** The ownership inputs the patch engine actually receives for the limitation row. */
const LIMITATION_OWNERSHIP = () => {
  const atom = screeningLimitationAtom();
  return {
    concept: atom.concept,
    level: atom.level ?? "",
    laterality: atom.laterality ?? "",
    anatomicalSection: atom.anatomicalSection ?? "",
    baselineReplaces: atom.baselineReplaces ?? "",
  };
};

const findingsRowsOfShippedManifests = () => {
  const rows: Array<{ format: string; text: string }> = [];
  for (const f of DEFAULT_REPORT_FORMATS) {
    for (const o of f.baselineManifest?.observations ?? []) {
      if (o.field === "findings") rows.push({ format: f.name ?? "?", text: o.renderedText.trim() });
    }
  }
  return rows;
};

const limitationCount = (text: string) =>
  (text.match(/SCREENING STUDIES ARE LIMITED/gi) ?? []).length;

/**
 * `SpineScreeningPanel.syncLedger` against the real store, with no React: the
 * exported `screeningLedgerBundles` plan is the seam the panel itself is built on.
 */
function applyScreeningPlan(state: ScreeningState, changed: SpineScreeningRegion, ledgerRegion: string) {
  const ws = useWorkspace.getState();
  const plan = screeningLedgerBundles({
    state,
    schemas: SCREENING_SCHEMAS,
    sequences: ws.sequencesAvailable,
    numbering: ws.lumbarNumbering,
    ledgerRegion,
  });
  const planned = new Map(plan.map((b) => [b.bundleId, b] as const));
  const liveBundles = () => {
    const ids = new Set<string>();
    useWorkspace.getState().appliedPathologyPatches.forEach((p) => {
      const b = p.observation?.bundleId;
      if (b && !p.stale) ids.add(b);
    });
    return ids;
  };
  const changedBundle = screeningRegionBundleId(changed);
  [...liveBundles()]
    .filter((id) => (id.startsWith(SCREENING_BUNDLE_PREFIX) && !planned.has(id)) || id === changedBundle)
    .forEach((id) => ws.removeMacroBundle(id));
  const afterRemoval = liveBundles();
  for (const id of [changedBundle, SCREENING_LIMITATION_BUNDLE_ID]) {
    const bundle = planned.get(id);
    if (!bundle || afterRemoval.has(id)) continue;
    expect(ws.applyMacroBundle({ bundleId: bundle.bundleId, observations: bundle.observations }),
      `applyMacroBundle(${id}) left a confirmation open`).toBe("applied");
  }
}

function openStudy(studyDescription: string, regions: string[]) {
  const ctx = buildReportingStudyContext({
    modality: "MR", studyDescription, regions, source: "auto",
  });
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    screening: defaultScreeningState(),
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [], confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false, isFinalized: false, isDirty: false,
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [],
  });
  const out = useWorkspace.getState().generateProfessionalReport(ctx);
  expect(out.status, `Generate Professional Report refused ${studyDescription}`).toBe("generated");
  return ctx;
}

/** Roles derived from the billed exam, exactly as the workspace effect does it. */
function bookRoles(billedName: string) {
  useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles({ name: billedName }).roles);
}

const stateWith = (
  region: SpineScreeningRegion,
  selections: ScreeningState[SpineScreeningRegion]["selections"],
): ScreeningState => {
  const next = { ...useWorkspace.getState().screening };
  next[region] = { ...next[region], selections };
  useWorkspace.getState().setScreeningRegion(region, { selections });
  return next;
};

describe("the report-level screening limitation", () => {
  beforeEach(() => {
    useWorkspace.setState({ appliedPathologyPatches: [] });
  });

  it("has a real manifest population to measure", () => {
    // Without this the census below is vacuously true if the manifests are deleted.
    const rows = findingsRowsOfShippedManifests();
    expect(rows.length).toBeGreaterThanOrEqual(100);
    expect(rows.filter((r) => /screening/i.test(r.text)).length).toBeGreaterThanOrEqual(20);
  });

  it("owns its own sentence and no other shipped sentence", () => {
    const ownership = LIMITATION_OWNERSHIP();
    const rows = findingsRowsOfShippedManifests();
    const claimed = rows.filter((r) => sentenceOwnedBySlot(r.text, ownership));
    // The five screening manifests each carry the limitation once, so the row may
    // claim that sentence in each of them and nothing else. What must be zero is
    // any claim on a sentence that says something about the anatomy.
    const collateral = claimed.filter((c) => c.text !== SCREENING_LIMITATION_TEXT);
    expect(claimed.length).toBeGreaterThanOrEqual(1);
    expect(collateral, `limitation row still retires: ${collateral.map((c) => c.text).join(" | ")}`)
      .toEqual([]);
  });

  it("is not an observation of any anatomy it could contradict", () => {
    const atom = screeningLimitationAtom();
    // The row speaks for the whole examination, so its section is the bare word
    // "screening" and its contract is its own sentence. A region-scoped section
    // would make a second report-level sentence reachable.
    expect(atom.anatomicalSection).toBe("screening");
    expect(atom.level).toBeUndefined();
    expect(atom.laterality).toBeUndefined();
    const ownership = LIMITATION_OWNERSHIP();
    expect(ownership.baselineReplaces).toBe(SCREENING_LIMITATION_TEXT);
    const normals = findingsRowsOfShippedManifests()
      .map((r) => r.text)
      .filter((t) => !t.includes(SCREENING_LIMITATION_TEXT));
    for (const text of normals) {
      expect(sentenceOwnedBySlot(text, ownership), `claimed ${text}`).toBe(false);
    }
  });

  it("still retires its own earlier sentence, so it cannot double up", () => {
    const ownership = LIMITATION_OWNERSHIP();
    expect(sentenceOwnedBySlot(SCREENING_LIMITATION_TEXT, ownership)).toBe(true);
    expect(sentenceMatchesConcept(SCREENING_LIMITATION_TEXT, "screening_limitation")).toBe(true);
  });

  it("holds a conflict group no region row can share", () => {
    // A conflict group is a mutex: two rows under one group replace each other.
    // The limitation is one row for the whole report, so borrowing a region's
    // group would make the region's alignment row and the limitation row fight,
    // and which sentence survives would be decided by click order.
    openStudy("MRI WHOLE SPINE SCREENING", ["Whole Spine"]);
    bookRoles("MRI WHOLE SPINE SCREENING");
    for (const region of ["cervical", "dorsal", "ls"] as SpineScreeningRegion[]) {
      const option = SCREENING_SCHEMAS[region].sections.find((s) => s.key === "alignment")?.options[0];
      useWorkspace.getState().setScreeningRegion(region, {
        role: "accompanying-screening",
        performed: true,
        selections: { alignment: [{ optionId: option!.id }] },
      });
    }
    const ws = useWorkspace.getState();
    const plan = screeningLedgerBundles({
      state: ws.screening,
      schemas: SCREENING_SCHEMAS,
      sequences: ws.sequencesAvailable,
      numbering: ws.lumbarNumbering,
      ledgerRegion: "Whole Spine",
    });
    const group = screeningLimitationAtom().conflictGroup;
    expect(group, "the limitation row must declare a conflict group").toBeTruthy();
    const carriers = plan.flatMap((b) => b.observations
      .filter((o) => (o.ownership?.conflictGroup ?? "") === group)
      .map((o) => `${o.bundleId}|${(o.findingsText ?? "").trim()}`));
    // Exactly the limitation row, from the limitation bundle, writing the
    // limitation sentence — and no region row alongside it.
    expect(carriers).toEqual([`${SCREENING_LIMITATION_BUNDLE_ID}|${SCREENING_LIMITATION_TEXT}`]);
  });

  it("writes the canonical sentence, not a near copy of it", () => {
    // The pin above only bounds what the row may overwrite. If the sentence the
    // row WRITES drifts from the one the manifests carry, the report ends up with
    // two limitation lines that a "how many of these are on the page" check still
    // counts as one. Both halves have to be the same string.
    expect(screeningLimitationAtom().findings).toBe(SCREENING_LIMITATION_TEXT);
    openStudy("MRI WHOLE SPINE SCREENING", ["Whole Spine"]);
    bookRoles("MRI WHOLE SPINE SCREENING");
    const state = stateWith("dorsal", { bodies_marrow: [{ optionId: "compression_deformity" }] });
    applyScreeningPlan(state, "dorsal", "Whole Spine");
    const lines = useWorkspace.getState().findingsText
      .split("\n")
      .filter((l) => /SCREENING STUDIES/i.test(l));
    expect(lines).toEqual([SCREENING_LIMITATION_TEXT]);
  });
});

describe("whole-spine screening through the deterministic report", () => {
  it("one dorsal screening abnormality keeps every other region's normal", () => {
    openStudy("MRI WHOLE SPINE SCREENING", ["Whole Spine"]);
    const before = useWorkspace.getState().findingsText;
    const beforeLines = before.split("\n").filter(Boolean);
    expect(beforeLines.length).toBeGreaterThanOrEqual(16);
    expect(limitationCount(before)).toBe(1);

    bookRoles("MRI WHOLE SPINE SCREENING");
    const state = stateWith("dorsal", { bodies_marrow: [{ optionId: "compression_deformity" }] });
    applyScreeningPlan(state, "dorsal", "Whole Spine");

    const after = useWorkspace.getState().findingsText;
    // The finding it contradicts is the dorsal vertebral-body normal; everything
    // else the examination supports must still be on the page.
    for (const line of beforeLines) {
      if (/^Dorsal spine: Vertebral bodies/i.test(line)) continue;
      expect(after, `lost "${line}"`).toContain(line);
    }
    expect(after).toContain("Vertebral Bodies / Marrow: Compression deformity");
    expect(limitationCount(after)).toBe(1);
  });

  it("keeps the dedicated region's own scaffold when a screening region is abnormal", () => {
    openStudy("MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING", ["Cervical Spine"]);
    const before = useWorkspace.getState().findingsText;
    const beforeLines = before.split("\n").filter(Boolean);

    bookRoles("MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING");
    const state = stateWith("dorsal", { bodies_marrow: [{ optionId: "compression_deformity" }] });
    applyScreeningPlan(state, "dorsal", "Cervical Spine");

    const after = useWorkspace.getState().findingsText;
    for (const line of beforeLines) {
      expect(after, `a dorsal screening finding deleted "${line}"`).toContain(line);
    }
    expect(limitationCount(after)).toBe(1);
  });

  it("leaves no ledger row claiming a sentence the report no longer says", () => {
    openStudy("MRI WHOLE SPINE SCREENING", ["Whole Spine"]);
    bookRoles("MRI WHOLE SPINE SCREENING");
    const state = stateWith("cervical", { canal: [{ optionId: "severe" }] });
    applyScreeningPlan(state, "cervical", "Whole Spine");
    const findings = useWorkspace.getState().findingsText;
    const orphans = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => !p.stale)
      .filter((p) => {
        const text = (p.lastRendered.findings ?? "").trim();
        return text.length > 0 && !findings.includes(text);
      })
      .map((p) => `${p.id}: ${p.lastRendered.findings}`);
    expect(orphans, `live rows whose sentence is not on the page: ${orphans.join(" | ")}`).toEqual([]);
  });

  it("cannot be removed by a pathology selection that says nothing about it", () => {
    openStudy("MRI WHOLE SPINE SCREENING", ["Whole Spine"]);
    bookRoles("MRI WHOLE SPINE SCREENING");
    for (const [region, selections] of [
      ["cervical", { discs: [{ optionId: "significant_bulge" }] }],
      ["dorsal", { cord: [{ optionId: "compression" }] }],
      ["ls", { canal: [{ optionId: "severe" }] }],
    ] as Array<[SpineScreeningRegion, ScreeningState[SpineScreeningRegion]["selections"]]>) {
      const state = stateWith(region, selections);
      applyScreeningPlan(state, region, "Whole Spine");
    }
    expect(limitationCount(useWorkspace.getState().findingsText)).toBe(1);
  });

  it("survives save → close → reopen exactly once", () => {
    openStudy("MRI WHOLE SPINE SCREENING", ["Whole Spine"]);
    bookRoles("MRI WHOLE SPINE SCREENING");
    const state = stateWith("dorsal", { bodies_marrow: [{ optionId: "compression_deformity" }] });
    applyScreeningPlan(state, "dorsal", "Whole Spine");
    const findings = useWorkspace.getState().findingsText;
    const ledger = useWorkspace.getState().serializeObservationLedger();

    openStudy("MRI WHOLE SPINE SCREENING", ["Whole Spine"]);
    useWorkspace.setState({ findingsText: findings });
    useWorkspace.getState().hydrateObservationLedger(ledger);
    expect(limitationCount(useWorkspace.getState().findingsText)).toBe(1);
    expect(useWorkspace.getState().findingsText).toContain("Vertebral Bodies / Marrow: Compression deformity");
  });
});

describe("screening pathology still retires what it contradicts", () => {
  it("a cervical screening stenosis retires the cervical canal normal and only it", () => {
    openStudy("MRI CERVICAL SPINE SCREENING", ["Cervical Spine"]);
    const before = useWorkspace.getState().findingsText.split("\n").filter(Boolean);
    bookRoles("MRI CERVICAL SPINE SCREENING");
    const state = stateWith("cervical", { canal: [{ optionId: "severe" }] });
    applyScreeningPlan(state, "cervical", "Cervical Spine");
    const after = useWorkspace.getState().findingsText;

    const contradicted = before.filter((l) => /canal stenosis/i.test(l));
    expect(contradicted.length).toBeGreaterThan(0);
    for (const line of contradicted) expect(after, `"${line}" still denies the finding`).not.toContain(line);
    for (const line of before) {
      if (/canal stenosis/i.test(line)) continue;
      if (line.includes(SCREENING_LIMITATION_TEXT)) continue;
      expect(after, `lost unrelated "${line}"`).toContain(line);
    }
  });
});

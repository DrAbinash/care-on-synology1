import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SPINE_REPORTING_DRAFT_KEY,
  extractSpineReportingState,
  spineReportingDraftPayload,
  type SpineReportingDraftState,
} from "./mriSpineDraftState";
import {
  DORSAL_COVERAGE_OPTIONS,
  DORSAL_NUMBERING_MODES,
  defaultDorsalNumbering,
  dorsalLevelKeyStrings,
  type DorsalNumberingState,
} from "./mriDorsalNumbering";
import {
  DORSOLUMBAR_NUMBERING_MODES,
  defaultDorsoLumbarState,
  dorsolumbarLevelKeyStrings,
  type DorsoLumbarState,
} from "./mriDorsoLumbarCoverage";
import { defaultLumbarNumbering, type LumbarNumberingState } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { billingRolesMayApply, resolveScreeningRoles, type BilledStudyInput } from "./mriSpineScreeningRoles";
import { SPINE_SCREENING_REGIONS, type RegionRole, type SpineScreeningRegion } from "./mriSpineScreeningSchema";
import { emptyClinicalState, studyTransitionReset } from "./zai-workspace/clinicalStateReset";
import { useWorkspace } from "./zai-workspace/store";

function draft(): SpineReportingDraftState {
  return {
    lumbarNumbering: defaultLumbarNumbering(),
    dorsalNumbering: defaultDorsalNumbering(),
    dorsoLumbarNumbering: defaultDorsoLumbarState(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    screeningRolesOverridden: false,
    impressionOrderFrozen: false,
  };
}

function reopen(state: SpineReportingDraftState) {
  return extractSpineReportingState(JSON.parse(JSON.stringify({
    [SPINE_REPORTING_DRAFT_KEY]: spineReportingDraftPayload(state),
  })))!;
}

describe("spine numbering draft roundtrip", () => {
  it("preserves complete independent numbering states, including designation whitespace", () => {
    const state = draft();
    state.dorsalNumbering = {
      mode: "manual", coverage: "upper", wholeSpineLocalizer: true,
      designationNote: "  Lowest rib-bearing vertebra designated T12.\n  ",
    };
    state.dorsoLumbarNumbering = defaultDorsoLumbarState({
      numbering: "manual", superior: "T10-T11", inferior: "L6-S1", wholeSpineLocalizer: true,
      designationNote: "  Counted from the junction.  ",
      lumbar: {
        mode: "lstv-lumbarization", castellvi: "IV", side: "bilateral",
        pseudoarthrosis: true, reactiveMarrowChange: true, wholeSpineLocalizer: true,
        designatedL5Label: "  Lowest mobile lumbar-type vertebra  ",
      },
    });
    const restored = reopen(state);
    expect(restored.dorsalNumbering).toEqual(state.dorsalNumbering);
    expect(restored.dorsoLumbarNumbering).toEqual(state.dorsoLumbarNumbering);
    expect(restored.lumbarNumbering.mode).toBe("standard");
    expect(dorsalLevelKeyStrings(restored.dorsalNumbering)).toEqual(dorsalLevelKeyStrings(state.dorsalNumbering));
    expect(dorsolumbarLevelKeyStrings(restored.dorsoLumbarNumbering)).toEqual(dorsolumbarLevelKeyStrings(state.dorsoLumbarNumbering));
  });

  it.each(DORSAL_NUMBERING_MODES)("keeps dorsal mode $id and every coverage extent", ({ id }) => {
    for (const { id: coverage } of DORSAL_COVERAGE_OPTIONS) {
      const state = draft();
      state.dorsalNumbering = { mode: id, coverage, wholeSpineLocalizer: false, designationNote: null };
      expect(reopen(state).dorsalNumbering).toEqual(state.dorsalNumbering);
    }
  });

  it.each(DORSOLUMBAR_NUMBERING_MODES)("keeps dorso-lumbar mode $id", ({ id }) => {
    const state = draft();
    state.dorsoLumbarNumbering.numbering = id;
    expect(reopen(state).dorsoLumbarNumbering.numbering).toBe(id);
  });

  it.each([
    ["standard", "T9", "L2"],
    ["standard", "D10-D11", "D12-L1"],
    ["standard", "t10-t11", "l2-l3"],
    ["standard", "L4-L5", "T8-T9"], // Inverted bounds remain empty, never silently widened.
    ["lstv-sacralization", "T11-T12", "L5-T"],
    ["lstv-lumbarization", "T11-T12", "L6-S1"],
  ] as const)("keeps resolver-supported bounds: %s, %s to %s", (mode, superior, inferior) => {
    const state = draft();
    state.dorsoLumbarNumbering = defaultDorsoLumbarState({
      superior, inferior, lumbar: { ...defaultLumbarNumbering(), mode },
    });
    const restored = reopen(state).dorsoLumbarNumbering;
    expect(restored.superior).toBe(superior);
    expect(restored.inferior).toBe(inferior);
    expect(dorsolumbarLevelKeyStrings(restored)).toEqual(dorsolumbarLevelKeyStrings(state.dorsoLumbarNumbering));
  });

  it.each(["", "   ", "  stated designation  ", null])("preserves designation %j exactly", (designationNote) => {
    const state = draft();
    state.dorsalNumbering.designationNote = designationNote;
    state.dorsoLumbarNumbering.designationNote = designationNote;
    const restored = reopen(state);
    expect(restored.dorsalNumbering.designationNote).toBe(designationNote);
    expect(restored.dorsoLumbarNumbering.designationNote).toBe(designationNote);
  });
});

describe("spine numbering defensive draft reader", () => {
  it("adds defaults to older envelopes without changing their existing state", () => {
    const restored = extractSpineReportingState({ spineReporting: {
      lumbarNumbering: { mode: "manual", designatedL5Label: "S1" },
      sequencesAvailable: { stir: true }, impressionOrderFrozen: true,
    } })!;
    expect(restored.dorsalNumbering).toEqual(defaultDorsalNumbering());
    expect(restored.dorsoLumbarNumbering).toEqual(defaultDorsoLumbarState());
    expect(restored.lumbarNumbering.designatedL5Label).toBe("S1");
    expect(restored.sequencesAvailable.stir).toBe(true);
    expect(restored.impressionOrderFrozen).toBe(true);
  });

  it.each([undefined, null, false, 17, "manual", []])("defaults malformed numbering bags: %j", (raw) => {
    const restored = extractSpineReportingState({ spineReporting: {
      dorsalNumbering: raw, dorsoLumbarNumbering: raw,
    } })!;
    expect(restored.dorsalNumbering).toEqual(defaultDorsalNumbering());
    expect(restored.dorsoLumbarNumbering).toEqual(defaultDorsoLumbarState());
  });

  it("defaults malformed fields and drops unknown properties", () => {
    const restored = extractSpineReportingState({ spineReporting: {
      dorsalNumbering: { mode: "invalid", coverage: "all", wholeSpineLocalizer: "yes", designationNote: {}, extra: true },
      dorsoLumbarNumbering: {
        numbering: "invalid", wholeSpineLocalizer: 1, designationNote: [],
        superior: "not-a-level", inferior: 42, lumbar: "invalid", extra: true,
      },
    } })!;
    expect(restored.dorsalNumbering).toEqual(defaultDorsalNumbering());
    expect(restored.dorsoLumbarNumbering).toEqual(defaultDorsoLumbarState());
    expect(restored.dorsalNumbering).not.toHaveProperty("extra");
    expect(restored.dorsoLumbarNumbering).not.toHaveProperty("extra");
  });

  it("parses nested lumbar fields defensively without trusting truthy booleans", () => {
    const restored = extractSpineReportingState({ spineReporting: {
      dorsoLumbarNumbering: { lumbar: {
        mode: "unknown", castellvi: {}, side: [], pseudoarthrosis: "true",
        reactiveMarrowChange: 1, wholeSpineLocalizer: {}, designatedL5Label: 12,
      } },
    } })!;
    expect(restored.dorsoLumbarNumbering.lumbar).toEqual({
      mode: "standard", castellvi: "I", side: "unilateral", pseudoarthrosis: false,
      reactiveMarrowChange: false, wholeSpineLocalizer: false, designatedL5Label: null,
    });
  });

  it.each([
    ["lstv-sacralization", "L5-T"], ["lstv-lumbarization", "L6-S1"],
  ] as const)("defaults invalid bounds using the current %s sequence", (mode, inferior) => {
    const restored = extractSpineReportingState({ spineReporting: {
      dorsoLumbarNumbering: { superior: {}, inferior: "L99-S1", lumbar: { mode } },
    } })!;
    expect(restored.dorsoLumbarNumbering.superior).toBe(defaultDorsoLumbarState().superior);
    expect(restored.dorsoLumbarNumbering.inferior).toBe(inferior);
  });

  it.each([null, {}, "invalid", { spineReporting: null }, { spineReporting: [] }])("does not invent an envelope from %j", (raw) => {
    expect(extractSpineReportingState(raw)).toBeNull();
  });
});

describe("real workspace numbering dirty state", () => {
  const initial = useWorkspace.getState();
  beforeEach(() => useWorkspace.setState({ ...draft(), isDirty: false, canalApProvenance: {} }));
  afterEach(() => useWorkspace.setState(initial, true));

  it.each<Partial<DorsalNumberingState>>([
    { mode: "manual" }, { coverage: "upper" }, { wholeSpineLocalizer: true },
    { designationNote: "  T12 designated  " },
  ])("dirties a changed dorsal field, but not the identical repeated patch: %j", (patch) => {
    useWorkspace.getState().setDorsalNumbering(patch);
    expect(useWorkspace.getState().isDirty).toBe(true);
    expect(useWorkspace.getState().dorsalNumbering).toMatchObject(patch);
    useWorkspace.setState({ isDirty: false });
    const before = useWorkspace.getState();
    useWorkspace.getState().setDorsalNumbering({ ...patch });
    expect(useWorkspace.getState()).toBe(before);
  });

  it.each<Partial<DorsoLumbarState>>([
    { numbering: "manual" }, { superior: "T10-T11" }, { inferior: "L2-L3" },
    { wholeSpineLocalizer: true }, { designationNote: "  T12 designated  " },
  ])("dirties a changed dorso-lumbar field, not the identical repeated patch: %j", (patch) => {
    useWorkspace.getState().setDorsoLumbarNumbering(patch);
    expect(useWorkspace.getState().isDirty).toBe(true);
    expect(useWorkspace.getState().dorsoLumbarNumbering).toMatchObject(patch);
    useWorkspace.setState({ isDirty: false });
    const before = useWorkspace.getState();
    useWorkspace.getState().setDorsoLumbarNumbering({ ...patch });
    expect(useWorkspace.getState()).toBe(before);
  });

  it.each<Partial<LumbarNumberingState>>([
    { mode: "lstv-sacralization" }, { castellvi: "IIa" }, { side: "bilateral" },
    { pseudoarthrosis: true }, { reactiveMarrowChange: true }, { wholeSpineLocalizer: true },
    { designatedL5Label: "  S1  " },
  ])("detects a changed nested lumbar value: %j", (patch) => {
    const lumbar = { ...useWorkspace.getState().dorsoLumbarNumbering.lumbar, ...patch };
    useWorkspace.getState().setDorsoLumbarNumbering({ lumbar });
    expect(useWorkspace.getState().isDirty).toBe(true);
    useWorkspace.setState({ isDirty: false });
    const before = useWorkspace.getState();
    // Same values, different reference and key order are still a no-op.
    const reordered = Object.fromEntries(Object.entries(lumbar).reverse()) as LumbarNumberingState;
    useWorkspace.getState().setDorsoLumbarNumbering({ lumbar: reordered });
    expect(useWorkspace.getState()).toBe(before);
  });

  it("keeps empty and equal-default patches clean, and never clears an already dirty draft", () => {
    const before = useWorkspace.getState();
    before.setDorsalNumbering({});
    before.setDorsoLumbarNumbering({});
    before.setDorsalNumbering(defaultDorsalNumbering());
    before.setDorsoLumbarNumbering(defaultDorsoLumbarState());
    expect(useWorkspace.getState()).toBe(before);
    useWorkspace.setState({ isDirty: true });
    useWorkspace.getState().setDorsalNumbering({});
    useWorkspace.getState().setDorsoLumbarNumbering({});
    expect(useWorkspace.getState().isDirty).toBe(true);
  });

  it("hydrates both states directly without dirtying or reconciling restored measurements", () => {
    useWorkspace.getState().setDorsalNumbering({ coverage: "upper", designationNote: "T12" });
    useWorkspace.getState().setDorsoLumbarNumbering({ superior: "T10-T11", inferior: "L2-L3" });
    const restored = reopen(useWorkspace.getState());
    useWorkspace.setState({ ...draft(), isDirty: false });
    const canalBefore = useWorkspace.getState().canalApProvenance;
    useWorkspace.setState({
      dorsalNumbering: restored.dorsalNumbering,
      dorsoLumbarNumbering: restored.dorsoLumbarNumbering,
    });
    expect(useWorkspace.getState().dorsalNumbering.coverage).toBe("upper");
    expect(useWorkspace.getState().dorsoLumbarNumbering.superior).toBe("T10-T11");
    expect(useWorkspace.getState().isDirty).toBe(false);
    expect(useWorkspace.getState().canalApProvenance).toBe(canalBefore);
  });
});

/**
 * P1-4 — an explicitly selected Whole Spine Screening role is a clinical decision, so
 * it has to come back unchanged after save → close → reopen.
 *
 * The billing-derived proposal is re-computed on study open (`useWorkspaceClinicalUi`
 * §23) from the booked exam name, protocol and description. It is documented as a
 * DEFAULT the radiologist may override, but nothing recorded that an override had
 * happened: the roles themselves were persisted while the fact that a human chose them
 * was not, so the reopen re-derived the catalog answer over the top of it. A dorsal
 * screening abandoned at the scanner came back as performed, and the report's screening
 * sections, limitation statement and Impression followed the role that billing guessed.
 *
 * The composition beside it already had exactly this protection
 * (`studyCompositionOverridden`); the roles did not.
 */
describe("explicit whole-spine screening roles survive save → reopen (P1-4)", () => {
  const initial = useWorkspace.getState();
  const BILLED = { code: "MRI062", name: "MRI WHOLE SPINE SCREENING" };

  beforeEach(() => useWorkspace.setState({ ...draft(), isDirty: false }));
  afterEach(() => useWorkspace.setState(initial, true));

  const roleSet = () => {
    const { screening } = useWorkspace.getState();
    return Object.fromEntries(
      SPINE_SCREENING_REGIONS.map((region) => [region, screening[region]?.role ?? "absent"]),
    ) as Record<SpineScreeningRegion, RegionRole>;
  };

  it("books three screening regions from the catalog without claiming the radiologist chose them", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    expect(roleSet()).toEqual({
      cervical: "primary-screening",
      dorsal: "primary-screening",
      ls: "primary-screening",
    });
    expect(useWorkspace.getState().screeningRolesOverridden).toBe(false);
  });

  it("records that a role the radiologist picked is his, and leaves an unchanged one alone", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    // A no-op patch and a selections-only patch are not a role decision.
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "primary-screening" });
    useWorkspace.getState().setScreeningRegion("dorsal", { performed: true });
    expect(useWorkspace.getState().screeningRolesOverridden).toBe(false);
    // The dorsal screening was abandoned at the scanner.
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "absent" });
    expect(useWorkspace.getState().screeningRolesOverridden).toBe(true);
  });

  it("hands control back to billing when the radiologist re-applies the billing roles", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "absent" });
    expect(useWorkspace.getState().screeningRolesOverridden).toBe(true);
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    expect(useWorkspace.getState().screeningRolesOverridden).toBe(false);
    expect(roleSet().dorsal).toBe("primary-screening");
  });

  it("carries the choice, and only the choice, through the draft envelope", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "absent" });
    const chosen = reopen(useWorkspace.getState());
    expect(chosen.screeningRolesOverridden).toBe(true);
    expect(chosen.screening.dorsal?.role).toBe("absent");

    useWorkspace.setState({ ...draft(), isDirty: false });
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    expect(reopen(useWorkspace.getState()).screeningRolesOverridden).toBe(false);
  });

  it("does not leak the choice into the next study", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "absent" });
    expect(emptyClinicalState().screeningRolesOverridden).toBe(false);
  });

  /**
   * The three steps the app really runs on reopen, in order: the route change clears
   * the previous study, draft hydration restores what was saved, then the §23 effect
   * derives the billing proposal again from the booked exam. Steps 1-2 call production
   * code directly; step 3 is the effect body, driven through the same predicate the
   * hook uses (`useWorkspaceClinicalUi` §23).
   */
  function reopenStudy(billed: BilledStudyInput, structuredJson: unknown) {
    useWorkspace.setState(studyTransitionReset(7), false);
    const restored = extractSpineReportingState(structuredJson);
    if (restored) useWorkspace.setState({ ...restored });
    const ws = useWorkspace.getState();
    if (billingRolesMayApply(ws.screeningRolesOverridden)) {
      ws.replaceScreeningRoles(resolveScreeningRoles(billed).roles);
    }
  }

  const saveDraft = () => ({
    [SPINE_REPORTING_DRAFT_KEY]: spineReportingDraftPayload(useWorkspace.getState()),
  });

  it("keeps a region abandoned at the scanner abandoned after save → close → reopen", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    expect(roleSet().dorsal).toBe("primary-screening");
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "absent" });

    reopenStudy(BILLED, saveDraft());

    expect(roleSet()).toEqual({
      cervical: "primary-screening",
      dorsal: "absent",
      ls: "primary-screening",
    });
    // The role carries the module's prose with it: an absent region is not performed,
    // so its screening sections and limitation statement stay out of the report.
    expect(useWorkspace.getState().screening.dorsal?.performed).toBe(false);
  });

  it("still follows billing when the radiologist never chose a role", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    // The booking is corrected to a dedicated LS study with screening while the draft
    // is open, and nothing in the header was touched.
    reopenStudy({ code: "MRI038", name: "MRI LS SPINE WITH SCREENING WHOLE SPINE" }, saveDraft());

    expect(roleSet()).toEqual({
      cervical: "accompanying-screening",
      dorsal: "accompanying-screening",
      ls: "primary-dedicated",
    });
    expect(useWorkspace.getState().screeningRolesOverridden).toBe(false);
  });

  it("lets billing decide again once the radiologist re-applies the billing roles", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "absent" });
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);

    reopenStudy(BILLED, saveDraft());

    expect(roleSet().dorsal).toBe("primary-screening");
    expect(useWorkspace.getState().screeningRolesOverridden).toBe(false);
  });

  it("refuses a proposal that arrives after the choice, not only one that arrives on open", () => {
    useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles(BILLED).roles);
    useWorkspace.getState().setScreeningRegion("dorsal", { role: "absent" });
    // The booked exam name resolves asynchronously, so the same effect re-fires on a
    // study that has already been reported on. Asserting all three regions matters:
    // a proposal that resolved to nothing would leave "absent" standing by accident.
    const ws = useWorkspace.getState();
    if (billingRolesMayApply(ws.screeningRolesOverridden)) {
      ws.replaceScreeningRoles(resolveScreeningRoles({ name: "MRI WHOLE SPINE SCREENING" }).roles);
    }
    expect(roleSet()).toEqual({
      cervical: "primary-screening",
      dorsal: "absent",
      ls: "primary-screening",
    });
  });
});

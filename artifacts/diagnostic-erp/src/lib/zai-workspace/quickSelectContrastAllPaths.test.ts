/**
 * Contrast-only prose is the study's restriction, not one strip's.
 *
 * `quickSelectContrastGate` was written to hide an enhancement box from the wall of a study that
 * declares no contrast, and the wall was the ONLY place it was asked. Census at `ba207aa62`:
 *
 *   the gate's only non-test consumer   — `quick-select-strip.tsx` (the wall), which calls
 *                                        `withholdContrastOnlyBoxes` itself
 *   `store.ts`                          — 0 lines mention contrast (`git show ba207aa62:…| grep -ci
 *                                        contrast` → 0), so no door that bypasses the wall was asked
 *   the panel, the voice path, the structured-details dialog and the section strips — all of them
 *                                        reach the boundary through `handleQuickToggle`, whose own
 *                                        comment names those four surfaces (wired at
 *                                        `ReportCanvas.tsx:1522` and the voice command at
 *                                        `useVoiceReporting.ts:294`)
 *   the chocolate-box macros            — `useReportingStudySetup.ts:866` with `source: "macro"`, and
 *                                        it sends no `properties`, so only the prose could decide
 *   a study-local rewording             — ungated AND destructive: `applyStudyLocalEdit` withdraws
 *                                        the row it replaces before re-applying, so a guard placed
 *                                        only at the boundary would delete the radiologist's own
 *                                        edited sentence
 *
 * So box #448 "Glioma recurrence" was one chip, one spoken term or one macro away from writing
 * "Heterogeneously enhancing area in the right frontal operculum…" into Findings and the signed
 * report of an "MRI Brain Plain" that never received gadolinium. This file pins the enforcement at
 * the boundary every one of those doors passes through, the exemptions that keep it from taking
 * report text away, and the controls that keep a radiologist's own typing first-class.
 *
 * Environment honesty: store boundary plus source-level wiring pins (no browser in this container),
 * `environment: "node"` repo-wide, so the toast is asserted through the same mock the signed-mutation
 * refusal notice uses. Nothing here is browser evidence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import { toast } from "@/hooks/use-toast";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { emptyClinicalState } from "./clinicalStateReset";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { quickFindingPatch, type ClinicalQuickFindingBox } from "./quickSelectTilePayload";
import { useWorkspace } from "./store";

const here = dirname(fileURLToPath(import.meta.url));
const storeSrc = readFileSync(join(here, "store.ts"), "utf8").replace(/\r\n/g, "\n");
const hookSrc = readFileSync(
  join(here, "../../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"), "utf8",
).replace(/\r\n/g, "\n");
const gateSrc = readFileSync(join(here, "quickSelectContrastGate.ts"), "utf8").replace(/\r\n/g, "\n");

/** Strip comments so a comment can neither satisfy a pin nor defeat one. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const S = () => useWorkspace.getState();
const toastMock = vi.mocked(toast);
const lastToastTitle = () =>
  String((toastMock.mock.calls.at(-1)?.[0] as { title?: string } | undefined)?.title ?? "");

/** #448 minus its unfilled measurement clause — which is exactly what the boundary receives, since
 *  `quickFindingPatch` runs `stripUnfilledMeasurements` before the guards do. Braces would have put
 *  the click in front of the placeholder guard instead, for the wrong reason. */
const GLIOMA_RECURRENCE: ClinicalQuickFindingBox = {
  id: 448,
  label: "Glioma recurrence",
  studyType: "Brain",
  field: "findings",
  findingText:
    "Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, "
    + "with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for "
    + "tumor recurrence.",
  impressionText:
    "Heterogeneously enhancing lesion in the right frontal operculum with surrounding edema. "
    + "Findings are concerning for tumor recurrence.",
  techniqueText: "",
  recommendationText: "Urgent oncology referral.",
};

/** #4 — contrast appears only as a RECOMMENDATION, so the box is not contrast-only. Withholding it
 *  would remove the only way to record a mass on the study that most needs it recorded. */
const TUMOR_ADVICE_ONLY: ClinicalQuickFindingBox = {
  ...GLIOMA_RECURRENCE,
  id: 4,
  label: "Tumor",
  findingText: "A well/ill-defined space-occupying lesion is noted with surrounding edema and mass effect.",
  impressionText: "Intracranial space-occupying lesion — suggest contrast-enhanced study.",
};

/** The author's own declaration, which outranks the prose in both directions. */
const NON_ENHANCING_DECLARED_PLAIN: ClinicalQuickFindingBox = {
  ...GLIOMA_RECURRENCE,
  id: 515,
  label: "Non-enhancing lesion",
  findingText: "A non-enhancing lesion is noted in the insula, without surrounding oedema.",
  impressionText: "Non-enhancing insular lesion.",
  properties: '{"requiresContrast":false}',
};

const ctx = (studyDescription: string) => buildReportingStudyContext({
  modality: "MR", studyDescription, regions: ["Brain"], source: "auto",
});

function openStudy(studyDescription: string, techniqueText = "") {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: ctx(studyDescription),
    techniqueText,
    studies: [{ id: "syn-contrast-paths-1", patient: { name: "SYNTHETIC PATIENT", sex: "F" }, modality: "MR" }],
    activeStudyId: "syn-contrast-paths-1",
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
  } as never);
}

const clickPlain = (text: string) => {
  useWorkspace.getState().mergeField("findings", text, "manual");
};

const PLAIN = "MRI Brain Plain";
const ENHANCING = "Heterogeneously enhancing area in the right frontal operculum";

const boxClick = (box: ClinicalQuickFindingBox, over: Record<string, unknown> = {}) =>
  S().applyPathologyOverlay({ ...quickFindingPatch(box, { region: "Brain", studyType: "Brain" }, {}), ...over } as never);

beforeEach(() => {
  vi.restoreAllMocks();
  toastMock.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  openStudy(PLAIN);
});

describe("the write boundary refuses a contrast-only box on a study reported without contrast", () => {
  it("refuses the click, and the refusal is the whole effect", () => {
    const before = S().findingsText;
    expect(boxClick(GLIOMA_RECURRENCE), "the sentence #448 writes is not supportable on a plain study").toBe("refused");
    expect(S().findingsText, "no prose").toBe(before);
    expect(S().impressionText).toBe("");
    expect(S().appliedPathologyPatches, "no ledger row").toEqual([]);
    expect(Object.keys(S().fieldProvenance), "no provenance").toEqual([]);
  });

  it("says so out loud, names what is safe, and points at the real correction", () => {
    boxClick(GLIOMA_RECURRENCE);
    expect(toastMock).toHaveBeenCalled();
    const { title, description, variant } = toastMock.mock.calls.at(-1)![0] as never as
      { title: string; description: string; variant?: string };
    expect(title).toContain("Glioma recurrence");
    expect(title).toMatch(/Nothing was applied/);
    expect(description).toMatch(/nothing was written to the report/i);
    expect(description).toMatch(/no part of the report was changed/i);
    expect(description).toMatch(/examination name|Technique field/);
    expect(variant).toBe("destructive");
  });

  it("is not a console-only refusal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    boxClick(GLIOMA_RECURRENCE);
    expect(warn.mock.calls.some((c) => /contrast/i.test(String(c[0])))).toBe(true);
  });

  it("gates the door the wall never covered: a box inserted as a macro, with no properties column", () => {
    // The chocolate-box tiles reach this boundary with `source: "macro"` and never carry
    // `properties`, so only the prose can decide — and it must.
    expect(boxClick(GLIOMA_RECURRENCE, { source: "macro", properties: undefined })).toBe("refused");
    expect(S().appliedPathologyPatches).toEqual([]);
  });
});

describe("the guard is the study's declaration, and nothing broader", () => {
  it("applies everything on a study that says contrast was given", () => {
    openStudy("MRI Brain With Contrast");
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("applied");
    expect(S().findingsText).toContain(ENHANCING);
  });

  it("applies when the study never declared its contrast status", () => {
    openStudy("MRI Brain", "Multiplanar multisequence MRI of the brain including T1, T2, FLAIR and DWI.");
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("applied");
  });

  it("applies when the Technique field declares contrast even though the name does not", () => {
    openStudy("MRI Brain", "Contrast administered. Post-contrast T1 sequences obtained.");
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("applied");
  });

  it("leaves every other modality alone — US enhancement is acoustic, not gadolinium", () => {
    useWorkspace.setState({
      reportingContext: buildReportingStudyContext({
        modality: "US", studyDescription: "USG Whole Abdomen", regions: ["Whole Abdomen"], source: "auto",
      }),
    } as never);
    expect(boxClick({
      ...GLIOMA_RECURRENCE, id: 155, label: "Simple Hepatic Cyst",
      findingText: "A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the liver.",
    })).toBe("applied");
  });

  it("does not refuse a box that only recommends a contrast study", () => {
    expect(boxClick(TUMOR_ADVICE_ONLY)).toBe("applied");
    expect(S().findingsText).toContain("space-occupying lesion");
  });

  it("honours the author's declaration over the prose", () => {
    expect(NON_ENHANCING_DECLARED_PLAIN.findingText).toMatch(/enhanc\w+/);
    expect(boxClick(NON_ENHANCING_DECLARED_PLAIN)).toBe("applied");
    // …and the other direction: a flag with no matching sentence still withholds.
    expect(boxClick({
      ...GLIOMA_RECURRENCE, id: 547, label: "Meningeal process",
      findingText: "A dural-based process is noted over the high convexity.",
      impressionText: "Dural-based process.", properties: '{"requiresContrast":true}',
    })).toBe("refused");
  });

  it("refuses on the examination name even when a technique line mentions a contrast media dose", () => {
    openStudy(PLAIN, "Multiplanar multisequence MRI of the brain was performed.");
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("refused");
  });
});

describe("the guard withdraws nothing: the exemptions that keep report text on the page", () => {
  it("lets a ledger replay through, whatever the study declares", () => {
    // `generateProfessionalReport` re-applies rows the ledger already holds. Refusing one would
    // delete a sentence the radiologist accepted, on a press that never asked for it.
    openStudy("MRI Brain With Contrast");
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("applied");
    const patch = quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {});
    openStudy(PLAIN);
    expect(S().appliedPathologyPatches, "the plain study starts with no rows").toEqual([]);
    expect(boxClick(GLIOMA_RECURRENCE, { replayLedgerRow: true, id: patch.id })).toBe("applied");
    expect(S().findingsText).toContain(ENHANCING);
  });

  it("lets a re-apply of a row the report already holds through", () => {
    openStudy("MRI Brain With Contrast");
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("applied");
    openStudy(PLAIN);
    useWorkspace.setState({
      appliedPathologyPatches: [{
        ...quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {}),
        lastRendered: { findings: ENHANCING, impression: "", technique: "", recommendation: "" },
      }],
    } as never);
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("applied");
  });

  it("does NOT treat a stale row as one the report holds", () => {
    // `stale` is a withdrawn clinical claim, and the write path itself filters stale rows out of the
    // live set; a box clicked again after withdrawal is a fresh claim on the study as it now reads.
    openStudy(PLAIN);
    useWorkspace.setState({
      appliedPathologyPatches: [{
        ...quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {}),
        stale: true,
        lastRendered: { findings: "", impression: "", technique: "", recommendation: "" },
      }],
    } as never);
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("refused");
  });

  it("never gates text the radiologist typed", () => {
    clickPlain(ENHANCING);
    expect(S().findingsText).toContain(ENHANCING);
    S().setField("impression", "Enhancing lesion.", "manual");
    expect(S().impressionText).toBe("Enhancing lesion.");
  });

  it("never gates a source the Quick Select contract does not own", () => {
    expect(boxClick(GLIOMA_RECURRENCE, { source: "structured-template" })).toBe("applied");
  });
});

describe("the preview answers the same question the click will be asked with", () => {
  it("refuses the prose a hover would otherwise promise", () => {
    const patch = quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {});
    expect(S().previewPathologyOverlay(patch).refusal).toMatch(/^contrast/);
  });

  it("still promises what the boundary will apply", () => {
    openStudy("MRI Brain With Contrast");
    const patch = quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {});
    expect(S().previewPathologyOverlay(patch).refusal).toBeUndefined();
    expect(S().applyPathologyOverlay(patch)).toBe("applied");
  });

  it("writes nothing and toasts nothing while previewing", () => {
    const patch = quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {});
    S().previewPathologyOverlay(patch);
    expect(S().appliedPathologyPatches).toEqual([]);
    expect(S().findingsText).toBe("");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("answers the held-row question the apply path exempts, because its caller needs the click's answer", () => {
    // `applyStudyLocalEdit` withdraws the row a rewording replaces and THEN re-applies it, so the
    // preview must say "refused" while the row is still live — that is the only way the hook can
    // learn not to start the withdrawal.
    openStudy("MRI Brain With Contrast");
    expect(boxClick(GLIOMA_RECURRENCE)).toBe("applied");
    openStudy(PLAIN);
    useWorkspace.setState({
      appliedPathologyPatches: [{
        ...quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {}),
        lastRendered: { findings: ENHANCING, impression: "", technique: "", recommendation: "" },
      }],
    } as never);
    const patch = quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {});
    expect(S().previewPathologyOverlay(patch).refusal).toMatch(/^contrast/);
    expect(S().applyPathologyOverlay(patch), "the live row itself is still exempt").toBe("applied");
  });
});

describe("the rule exists in one module, and every door reaches it", () => {
  it("keeps the contrast vocabulary in the gate, not copied into the store", () => {
    const store = code(storeSrc);
    // The store asks the gate; it does not own a second regex that could drift from the wall's.
    expect(store).toMatch(/from "\.\/quickSelectContrastGate"/);
    expect(store).not.toMatch(/enhanc\\w\+|\bgadolin/i);
    expect(gateSrc).toMatch(/export function contrastWithholdsWrite/);
  });

  it("scopes the boundary guard to the sources the Quick Select contract already owns", () => {
    const guard = code(storeSrc).match(/isQuickSelectSource\(opts\.source\)[\s\S]{0,400}contrastRefusesProse/) ;
    expect(guard, "the contrast guard must be source-scoped").not.toBeNull();
    expect(code(storeSrc)).toMatch(/!opts\.replayLedgerRow/);
  });

  it("is reached by the panel, the voice path, the structured-details dialog and the section strips through one handler", () => {
    const hook = code(hookSrc);
    // `handleQuickToggle` is the single writer for every surface that clicks a box, and it builds
    // through `quickFindingPatch`, so the boundary sees all three doors.
    expect(hook).toMatch(/const patch = quickFindingPatch\(finding,/);
    expect(hook).toMatch(/state\.applyPathologyOverlay\(patch\)/);
  });

  it("previews the rewording BEFORE the withdrawal, so an edited sentence cannot be lost", () => {
    const body = code(hookSrc).match(/const applyStudyLocalEdit = useCallback\([\s\S]{0,2600}?\n  \}, \[/);
    expect(body, "applyStudyLocalEdit not found").not.toBeNull();
    const text = body![0];
    const preview = text.indexOf("previewPathologyOverlay");
    const withdraw = text.indexOf("handleQuickToggle(f, false)");
    expect(preview).toBeGreaterThan(-1);
    expect(withdraw).toBeGreaterThan(-1);
    expect(preview, "the preview must run before the row is withdrawn").toBeLessThan(withdraw);
    expect(text).toMatch(/refusal\.startsWith\("contrast"\)/);
    expect(text).toMatch(/Rewording not applied/);
  });
});

/**
 * A study that describes itself both ways is not a study the wall gets to guess about.
 *
 * Item 6's measured defect was two readers of one question, each with the opposite
 * precedence, and each deciding silently:
 *
 *   `quickSelectContrastGate.studyContrastStatus` (before) — tested its own
 *       affirmation pattern first over one concatenated `${examName} ${protocolName}`,
 *       so "MRI Brain Plain" + a contrast protocol resolved **given**, and the
 *       enhancement box stayed on the wall for a study booked plain.
 *   `clinicalTerms.studyContrastState` (before) — tested its denial first, so the
 *       identical pair resolved **plain**, and Q112 told the radiologist the patient
 *       had received no contrast.
 *
 * Both now come from the shared vocabulary, and a disagreement answers `conflict`:
 * withheld at the wall, refused at the write boundary, and announced in both places
 * by naming the two fields that disagree. `unknown` deliberately keeps its old
 * exemption — a study nobody described must never lose a tile — which is why
 * withholding on a conflict needs its own tests below rather than riding on the
 * `not-given` ones in `quickSelectContrastGate.test.ts`.
 *
 * Environment honesty: store boundary + source pins, `environment: "node"` repo-wide,
 * the toast asserted through the same mock the signed-mutation refusal uses. Nothing
 * here is browser evidence.
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
import { studyContrastVerdict } from "@workspace/report-quality";
import { emptyClinicalState } from "./clinicalStateReset";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { quickFindingPatch, type ClinicalQuickFindingBox } from "./quickSelectTilePayload";
import { useWorkspace } from "./store";
import {
  boxNeedsContrast,
  contrastWithheldReason,
  studyContrastConflict,
  studyContrastStatus,
  withholdContrastOnlyBoxes,
} from "./quickSelectContrastGate";

const here = dirname(fileURLToPath(import.meta.url));
const code = (name: string, rel = ".") =>
  readFileSync(join(here, rel, name), "utf8")
    .replace(/\r\n/g, "\n")
    // Strip comments so a comment can neither satisfy a pin nor defeat one.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const gateSrc = code("quickSelectContrastGate.ts");
const stripSrc = code("quick-select-strip.tsx", "../../components/radiology/zai-workspace");

const S = () => useWorkspace.getState();
const toastMock = vi.mocked(toast);
const lastToast = () => toastMock.mock.calls.at(-1)?.[0] as { title?: string; description?: string } | undefined;

/** #448 — the sentence that started this: an enhancement claim, no braces, so the
 *  placeholder guard stays out of the way and the contrast guard is what answers. */
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

const TUMOR_ADVICE_ONLY: ClinicalQuickFindingBox = {
  ...GLIOMA_RECURRENCE,
  id: 4,
  label: "Tumor",
  findingText: "A well/ill-defined space-occupying lesion is noted with surrounding edema and mass effect.",
  impressionText: "Intracranial space-occupying lesion — suggest contrast-enhanced study.",
};

/** A real ultrasound sentence, kept for the modality-scope test below. Honest about
 *  what the prose fallback does: "posterior acoustic enhancement" is an enhancement
 *  WORD, so `boxNeedsContrast` does flag it — nothing smarter in the regex saves it,
 *  only the MR-only scope. That is why the scope is pinned separately rather than
 *  folded into the MR list, where its presence would look like a false positive the
 *  gate ships.
 */
const HEPATIC_CYST: ClinicalQuickFindingBox = {
  ...GLIOMA_RECURRENCE,
  id: 900,
  label: "Simple hepatic cyst",
  studyType: "Liver",
  findingText: "A 12 mm anechoic lesion in segment IVB of the liver, with posterior acoustic enhancement.",
  impressionText: "Simple hepatic cyst.",
  techniqueText: "",
  recommendationText: "",
};

function openStudy(study: {
  examName: string;
  protocolName?: string | null;
  techniqueText?: string;
  modality?: string;
}) {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: buildReportingStudyContext({
      modality: study.modality ?? "MR",
      studyDescription: study.examName,
      protocolName: study.protocolName ?? null,
      regions: ["Brain"],
      source: "auto",
    }),
    techniqueText: study.techniqueText ?? "",
    studies: [{ id: "syn-contrast-conflict-1", patient: { name: "SYNTHETIC PATIENT", sex: "F" }, modality: study.modality ?? "MR" }],
    activeStudyId: "syn-contrast-conflict-1",
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  toastMock.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("studyContrastStatus — one disagreement, one answer", () => {
  it("calls the audited pair a conflict instead of letting the affirmation win", () => {
    // Before: this returned "given" — the concatenation was tested against the
    // affirmation pattern first, so the contrast protocol spoke and the "Plain"
    // booking was never compared with it.
    expect(studyContrastStatus({ examName: "MRI Brain Plain", protocolName: "MRI Brain with contrast" }))
      .toBe("conflict");
  });

  it("calls it a conflict whichever of the three fields disagrees with the others", () => {
    expect(studyContrastStatus({ examName: "MRI Brain Plain", techniqueText: "Post-contrast T1 sequences." }))
      .toBe("conflict");
    expect(studyContrastStatus({ examName: "MRI Brain", protocolName: "Brain (Plain)", techniqueText: "Gadolinium administered." }))
      .toBe("conflict");
  });

  it("still answers a study that only speaks with one voice", () => {
    expect(studyContrastStatus({ examName: "MRI Brain With Contrast" })).toBe("given");
    expect(studyContrastStatus({ examName: "CE-MRI brain" })).toBe("given");
    expect(studyContrastStatus({ examName: "NCT Head" })).toBe("not-given");
    expect(studyContrastStatus({ examName: "MRI Brain Plain", techniqueText: "Multiplanar T1, T2, FLAIR." })).toBe("not-given");
    expect(studyContrastStatus({ examName: "MRI Brain", techniqueText: "Contrast administered. Post-contrast T1 sequences obtained." })).toBe("given");
    expect(studyContrastStatus({ examName: "MRI Brain", techniqueText: "MRI of the brain was performed without contrast." })).toBe("not-given");
    expect(studyContrastStatus({ examName: "MRI Brain", techniqueText: "Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, DWI, and GRE sequences." })).toBe("unknown");
    expect(studyContrastStatus({})).toBe("unknown");
  });

  it("lets a two-phase acquisition settle the question, because contrast was given", () => {
    expect(studyContrastStatus({ examName: "MRI Brain Plain", protocolName: "Brain, with and without contrast" }))
      .toBe("given");
    // The sequence-list form `parseBrainSequences` arms on. Not a conflict, and not
    // withheld: this is the everyday naming of an enhanced MRI, and a rule that
    // hid enhancement boxes from it would be worse than the defect it prevents.
    expect(studyContrastStatus({ examName: "MRI Brain", techniqueText: "Plain and post-contrast sequences." }))
      .toBe("given");
  });

  it("says which two fields disagree, and stays silent when they do not", () => {
    expect(studyContrastConflict({ examName: "MRI Brain Plain", protocolName: "MRI Brain with contrast" }))
      .toBe("the examination name says no contrast while the protocol says contrast was given");
    expect(studyContrastConflict({ examName: "MRI Brain Plain" })).toBeNull();
    expect(studyContrastConflict({ examName: "MRI Brain" })).toBeNull();
  });
});

describe("the wall withholds on a disagreement, and says the disagreement", () => {
  const boxes = [GLIOMA_RECURRENCE, TUMOR_ADVICE_ONLY];

  it("holds the enhancement box back from a conflicted MR study", () => {
    const r = withholdContrastOnlyBoxes(boxes, { modality: "MR", status: "conflict" });
    expect(r.withheld.map((b) => b.id)).toEqual([448]);
  });

  it("still offers it on an unknown study, and on every other modality", () => {
    // The exemption that keeps a tile from vanishing because metadata is missing.
    expect(withholdContrastOnlyBoxes(boxes, { modality: "MR", status: "unknown" }).withheld).toEqual([]);
    expect(withholdContrastOnlyBoxes(boxes, { modality: "CT", status: "conflict" }).withheld).toEqual([]);
    expect(withholdContrastOnlyBoxes(boxes, { modality: "US", status: "conflict" }).withheld).toEqual([]);
  });

  it("contains the prose fallback's one false positive by modality, not by regex", () => {
    // "posterior acoustic enhancement" is an enhancement word, so the fallback flags
    // the box. Removing that flag from MR would also remove "Heterogeneously
    // enhancing area", so the scope is the containment and it has to be proven:
    // flagged prose + a non-MR study = offered.
    expect(boxNeedsContrast(HEPATIC_CYST)).toBe(true);
    expect(withholdContrastOnlyBoxes([HEPATIC_CYST], { modality: "US", status: "not-given" }).withheld)
      .toEqual([]);
  });

  it("names the disagreement on the chip, in the module that decides it", () => {
    expect(contrastWithheldReason("conflict", "the examination name says no contrast while the protocol says contrast was given"))
      .toBe("this study's own record disagrees: the examination name says no contrast while the protocol says contrast was given");
    // A plain study still reads as a plain study — the wording radiologists know.
    expect(contrastWithheldReason("not-given", null)).toBe("this study is reported without contrast");
    // And the strip prints that clause rather than keeping its own sentence.
    expect(stripSrc).toMatch(/not offered —\{" "\}\n\s*\{contrastWithheldReason\(contrastStatus, contrastConflict\)\}/);
  });
});

describe("the write boundary refuses a conflicted study's contrast prose", () => {
  const click = (box: ClinicalQuickFindingBox) =>
    S().applyPathologyOverlay(quickFindingPatch(box, { region: "Brain", studyType: "Brain" }, {}) as never);

  const CONFLICTED = { examName: "MRI Brain Plain", protocolName: "MRI Brain with contrast" };

  it("refuses, and the refusal names both sides of the disagreement", () => {
    openStudy(CONFLICTED);
    expect(click(GLIOMA_RECURRENCE)).toBe("refused");
    expect(S().findingsText).not.toMatch(/Heterogeneously enhancing/);
    const t = lastToast();
    expect(t?.title).toContain("Glioma recurrence");
    expect(t?.description).toContain("record disagrees about contrast");
    expect(t?.description).toContain("the examination name says no contrast");
    expect(t?.description).toContain("the protocol says contrast was given");
    // Not the plain study's sentence: the boundary does not know this study was plain.
    expect(t?.description).not.toContain("This study is reported without contrast");
  });

  it("offers the same box on the same study once the record agrees again", () => {
    // The way out the notice promises has to exist. Correcting the booking to match
    // the protocol must apply the box, not require a second kind of permission.
    openStudy({ ...CONFLICTED, examName: "MRI Brain" });
    expect(studyContrastStatus({ examName: "MRI Brain", protocolName: "MRI Brain with contrast" })).toBe("given");
    expect(click(GLIOMA_RECURRENCE)).toBe("applied");
    expect(S().findingsText).toMatch(/Heterogeneously enhancing/);
  });

  it("refuses with the plain study's wording when the study is simply plain", () => {
    openStudy({ examName: "MRI Brain Plain" });
    expect(click(GLIOMA_RECURRENCE)).toBe("refused");
    expect(lastToast()?.description).toContain("This study is reported without contrast");
  });

  it("does not refuse the box that only recommends a contrast study", () => {
    openStudy(CONFLICTED);
    expect(click(TUMOR_ADVICE_ONLY)).toBe("applied");
  });

  it("does not gate a non-MR study at the boundary, whatever its prose says", () => {
    openStudy({ ...CONFLICTED, modality: "US" });
    expect(click(HEPATIC_CYST)).toBe("applied");
  });

  it("lets a ledger replay through, whatever the record says", () => {
    openStudy(CONFLICTED);
    const patch = quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {});
    expect(S().applyPathologyOverlay({ ...patch, replayLedgerRow: true } as never)).toBe("applied");
  });

  it("previews the refusal it will actually give, and says which kind it is", () => {
    openStudy(CONFLICTED);
    const patch = quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {});
    expect(S().previewPathologyOverlay(patch).refusal)
      .toBe("contrast-only box on a study whose own record disagrees about contrast");
    openStudy({ examName: "MRI Brain Plain" });
    expect(S().previewPathologyOverlay(patch).refusal)
      .toBe("contrast-only box on a study reported without contrast");
  });

  it("never gates what the radiologist types", () => {
    openStudy(CONFLICTED);
    S().mergeField("findings", "Heterogeneously enhancing area in the right frontal operculum.", "manual");
    expect(S().findingsText).toMatch(/Heterogeneously enhancing/);
    expect(toastMock).not.toHaveBeenCalled();
  });
});

describe("one question, one reader", () => {
  it("keeps the contrast vocabulary out of the gate", () => {
    // The gate used to own two regexes of its own, which is how the wall and the
    // server came to answer one study in two opposite ways. It asks now.
    expect(gateSrc).toMatch(/from "@workspace\/report-quality"/);
    expect(gateSrc).not.toMatch(/const CONTRAST_GIVEN|const CONTRAST_WITHHELD/);
  });

  it("agrees with the rule that checks the signed report, on every shape the wall meets", () => {
    // Q112's verdict and the wall's must not be able to disagree: the badge warns
    // about an enhancement claim on the same study whose wall refuses to insert it.
    const shapes: Array<[string, { examName: string; protocolName?: string | null; techniqueText?: string }, string]> = [
      ["plain booking, plain protocol", { examName: "MRI Brain Plain", protocolName: "Brain (Plain)" }, "plain"],
      ["contrast booking, contrast technique", { examName: "MRI Brain with contrast", techniqueText: "Post-contrast T1." }, "contrast"],
      ["silent booking, plain technique", { examName: "MRI Brain", techniqueText: "Performed without intravenous contrast." }, "plain"],
      ["booking plain, technique enhanced", { examName: "MRI Brain (PLAIN)", techniqueText: "Post-contrast T1 sequences." }, "conflict"],
      ["booking plain, protocol enhanced", { examName: "MRI Brain Plain", protocolName: "MRI Brain with contrast" }, "conflict"],
      ["two-phase protocol beside a plain booking", { examName: "MRI Brain Plain", protocolName: "Brain, with and without contrast" }, "contrast"],
      ["nothing described", { examName: "MRI Brain", techniqueText: "T1, T2, FLAIR." }, "unknown"],
    ];
    for (const [name, study, shared] of shapes) {
      const verdict = studyContrastVerdict([
        { label: "the examination name", text: study.examName },
        { label: "the protocol", text: study.protocolName ?? null },
        { label: "the Technique line", text: study.techniqueText ?? null },
      ]).state;
      const gate = studyContrastStatus(study);
      expect(gate, name).toBe(shared === "plain" ? "not-given" : shared === "contrast" ? "given" : shared);
      expect(verdict, name).toBe(shared);
    }
  });

  it("differs from the shared reader in exactly one way, and it is the sequence parser", () => {
    // "Plain and post-contrast sequences." is one field saying both. The shared
    // vocabulary settles a single field by its denial-first rule, so it reads plain;
    // the gate additionally asks `parseBrainSequences` what was acquired, and an
    // acquired post-contrast sequence means the patient had contrast. The gate can
    // only ever raise a reading, never lower one, so this cannot invent a conflict.
    const technique = "Plain and post-contrast sequences.";
    expect(studyContrastVerdict([{ label: "the Technique line", text: technique }]).state).toBe("plain");
    expect(studyContrastStatus({ examName: "MRI Brain", techniqueText: technique })).toBe("given");
  });
});

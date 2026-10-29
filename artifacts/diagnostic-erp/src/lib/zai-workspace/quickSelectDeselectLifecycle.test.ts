/**
 * #167 — the Quick Select lifecycle the clinical owner asked for, at the store's own
 * entry points: click a box, its Findings and Impression appear; click it off again,
 * ONLY what it owns leaves; when the last abnormality comes off, exactly the approved
 * normal returns.
 *
 * The case that broke in the real workspace (study 17, Playwright, 2026-10-18) is the
 * "Moderate canal stenosis L4-L5" box, whose Findings sentence and Impression sentence
 * are the SAME sentence ("Moderate canal stenosis at L4-L5."). Deselecting it took the
 * row out of the ledger and brought the approved normal back, but the sentence stayed
 * on the page in BOTH sections, so the printed Impression asserted a moderate canal
 * stenosis and, one line above it, that there was no canal abnormality — and the canvas
 * armed "Impression needs refresh / Refresh from Finding", pointing the radiologist at
 * the leftover text of the box he had just removed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import {
  MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION,
  MRI_LS_SPINE_STANDARD_NORMAL_NAME,
} from "./fullReportBaseline";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "./store";

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});
const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };

/** quick-select-tiles.data.ts:117 — t("findings","Disc herniation L4-L5", …). */
const HERNIATION: ClinicalQuickFindingBox = {
  id: 9101,
  label: "Disc herniation L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral "
    + "protrusion causing indentation on the thecal sac and mild narrowing of bilateral "
    + "neural foramina. No significant central canal stenosis.",
  impressionText: "Disc herniation at L4-L5 causing indentation on the thecal sac.",
  techniqueText: "",
  recommendationText: "Conservative management with NSAIDs and physiotherapy.",
  concept: "disc_contour",
  conflictGroup: "disc bulge",
};

/**
 * quick-select-tiles.data.ts:123 — findingText and impressionSentence are one and the
 * same string. That identity is the whole defect: the two fields are edited by
 * different removal passes, and this row's wording is present in both.
 */
const STENOSIS: ClinicalQuickFindingBox = {
  id: 9102,
  label: "Moderate canal stenosis L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Moderate canal stenosis at L4-L5.",
  impressionText: "Moderate canal stenosis at L4-L5.",
  techniqueText: "",
  recommendationText: "",
  concept: "canal_stenosis",
  conflictGroup: "canal stenosis",
};

const SHARED_SENTENCE = "Moderate canal stenosis at L4-L5.";
const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const findings = () => useWorkspace.getState().findingsText;
const impression = () => useWorkspace.getState().impressionText;

function resetWorkspace() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionDependencyReasons: [], impressionBasis: null,
    impressionOrderFrozen: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, startingCanvasBaseline: null, appliedFormatName: null,
    appliedFormatReportTitle: null, reportingContext: STUDY_CTX,
    reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [], isFinalized: false,
  });
}

function openNormalLsSpine() {
  const outcome = useWorkspace.getState()
    .generateProfessionalReport(STUDY_CTX, { automatic: true, requireOwnedApprovedNormal: true });
  expect(outcome.status, "the automatic pass must build the approved normal").toBe("generated");
}

function click(box: ClinicalQuickFindingBox) {
  const patch = quickFindingPatch(box, CLICK_CTX);
  expect(useWorkspace.getState().applyPathologyOverlay(patch)).toBe("applied");
  return patch.id!;
}

/** The strip's "Remove from report" control, one step later in the same store. */
function deselect(rowId: string) {
  useWorkspace.getState().removeObservation(rowId);
}

/** The radiologist opening his own normal template, which is what the strip is used on. */
const LS_NORMAL = DEFAULT_REPORT_FORMATS.find(
  (f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME,
)!;

function openNormalFormat() {
  useWorkspace.getState().applyFormatById(LS_NORMAL.id, { regionChoice: "radiologist" });
  if (useWorkspace.getState().confirmOverwriteOpen) {
    useWorkspace.getState().confirmOverwriteAndApply();
  }
  expect(lines(findings()).length, "the format's scaffold is on the page").toBeGreaterThan(10);
}

beforeEach(resetWorkspace);

describe("the Quick Select select/deselect lifecycle (#167)", () => {
  it("selecting a box shows its Findings and its Impression without a normal left behind", () => {
    openNormalLsSpine();
    const normalBefore = impression();
    click(STENOSIS);
    expect(lines(findings())).toContain(STENOSIS.findingText);
    expect(impression()).toBe(STENOSIS.impressionText);
    expect(normalBefore).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });

  it("deselecting the only box takes its sentence out of Findings AND Impression", () => {
    openNormalLsSpine();
    const id = click(STENOSIS);
    deselect(id);

    expect(lines(findings()), "the box's Findings sentence is its own contribution")
      .not.toContain(SHARED_SENTENCE);
    expect(impression(), "so is its Impression sentence")
      .toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });

  it("deselecting one of two boxes leaves the other untouched, then restores the normal", () => {
    openNormalLsSpine();
    const a = click(HERNIATION);
    const b = click(STENOSIS);
    expect(impression()).toContain(HERNIATION.impressionText);
    expect(impression()).toContain(STENOSIS.impressionText);

    deselect(a);
    expect(impression(), "only the herniation's own conclusion went").toBe(STENOSIS.impressionText);
    expect(lines(findings())).not.toContain(HERNIATION.impressionText);

    deselect(b);
    expect(lines(findings())).not.toContain(SHARED_SENTENCE);
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(lines(impression())).toHaveLength(1);
  });

  it("deselecting after a same-slot severity change restores the pre-click normal, not the milder abnormal", () => {
    openNormalLsSpine();
    // The radiologist upgrades his claim — mild first, then the harsher box on
    // the same slot — and then retracts it entirely.
    click({
      ...STENOSIS,
      id: 9103,
      label: "Mild canal stenosis L4-L5",
      findingText: "Mild canal stenosis at L4-L5 without cord compression.",
      impressionText: "Mild canal stenosis at L4-L5.",
    });
    const severe = click(STENOSIS);
    expect(lines(findings())).toContain(SHARED_SENTENCE);
    deselect(severe);

    // The pre-click state is the approved normal, NOT the milder abnormal:
    // the upgrade retired the mild row's wording with the row itself, and the
    // slot's lineage (the normal the FIRST click retired) is what deselect
    // restores. Restoring the intermediate abnormal wording would put a finding
    // back on the page that nobody selected anymore (C3, owner directive:
    // "The fix must not restore intermediate abnormal wording after
    // deselection" — the old pin here asserted exactly that old behaviour).
    expect(impression(), "the box's own conclusion is gone")
      .not.toContain(SHARED_SENTENCE);
    expect(lines(findings()), "and so is its Findings sentence")
      .not.toContain(SHARED_SENTENCE);
    expect(lines(findings()), "the intermediate abnormal never comes back")
      .not.toContain("Mild canal stenosis at L4-L5 without cord compression.");
    expect(lines(findings()), "the L4-L5 canal normal the first click retired returns")
      .toContain("L4-L5: No spinal canal or thecal sac compression is seen.");
  });

  it("never deletes wording the radiologist typed himself when a box comes off", () => {
    openNormalLsSpine();
    const id = click(STENOSIS);
    const his = "Findings are otherwise unremarkable at this level.";
    useWorkspace.getState().mergeField("findings", his, "manual");

    deselect(id);

    expect(findings()).toContain(his);
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });

  /**
   * The browser's step 7, one field over: a Conclusion he typed under a clicked box's
   * Conclusion, then the box comes off. His sentence must stay and the box's own must
   * go — the strip's manual-edit reconciliation must not promote the tile's wording to
   * "his" simply because the field was rewritten.
   */
  it("keeps a typed Conclusion and still removes the deselected box's own", () => {
    openNormalFormat();
    const a = click(HERNIATION);
    const his = "Clinical correlation with the restricted straight-leg raise.";
    // `setField`, not `mergeField`: that is the path the editor's onChange takes when
    // he types — the whole field arrives as new text and provenance is reconciled
    // against what survived.
    const before = impression();
    useWorkspace.getState().setField("impression", `${before}\n${his}`.trim());
    expect(impression()).toContain(HERNIATION.impressionText);
    expect(impression()).toContain(his);

    deselect(a);

    expect(impression(), "his sentence is his").toContain(his);
    expect(impression(), "the deselected box's sentence is not")
      .not.toContain(HERNIATION.impressionText);
    expect(findings(), "and so is its Findings paragraph")
      .not.toContain("Broad-based disc bulge at L4-L5");
  });

  it("survives save and reopen with the box still off the report", () => {
    openNormalLsSpine();
    const a = click(HERNIATION);
    const b = click(STENOSIS);
    deselect(a);
    deselect(b);
    const serialized = useWorkspace.getState().serializeObservationLedger();
    const prose = {
      findingsText: findings(), impressionText: impression(),
      recommendationText: useWorkspace.getState().recommendationText,
      techniqueText: useWorkspace.getState().techniqueText,
      clinicalHistoryText: useWorkspace.getState().clinicalHistoryText,
    };
    resetWorkspace();
    useWorkspace.setState(prose);
    expect(useWorkspace.getState().hydrateObservationLedger(serialized).ok).toBe(true);
    useWorkspace.getState().refreshImpressionFromLedger({
      automatic: true, excludeBaselineObservations: true,
    });
    expect(impression()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(lines(findings())).not.toContain(SHARED_SENTENCE);
  });
});

/**
 * The sequence the browser actually ran, which the store-only case above does not
 * cover: the normal report came from the FORMAT picker (so the ledger holds the
 * format's per-level baseline rows, not just the system normal), the two boxes were
 * clicked onto that scaffold, and they came off in the same order. This is what the
 * radiologist does — he opens his normal template, then clicks what he sees.
 */
describe("the same lifecycle on a report opened from the Normal format (#167)", () => {
  it("deselecting both boxes leaves no box sentence behind in either section", () => {
    openNormalFormat();
    const scaffold = lines(findings());
    const a = click(HERNIATION);
    const b = click(STENOSIS);
    expect(lines(findings())).toContain(SHARED_SENTENCE);
    expect(impression()).toContain(STENOSIS.impressionText);

    deselect(a);
    deselect(b);

    expect(lines(findings()), "a removed box owns its Findings sentence")
      .not.toContain(SHARED_SENTENCE);
    expect(impression(), "and the approved normal comes back alone")
      .toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
    expect(scaffold.length).toBeGreaterThan(0);
    void a; void b;
  });

  it("removes only the box that came off, keeping the other's two sentences", () => {
    openNormalFormat();
    const a = click(HERNIATION);
    const b = click(STENOSIS);
    deselect(a);

    expect(lines(findings())).not.toContain("Disc herniation at L4-L5 causing indentation on the thecal sac.");
    expect(impression()).toBe(STENOSIS.impressionText);
    deselect(b);
    expect(lines(findings())).not.toContain(SHARED_SENTENCE);
    void a; void b;
  });

  /**
   * The one thing the unit tests above omit and the running app does every time: the
   * 700 ms automatic Mode-A pass, which re-runs the generator after the click. That
   * pass records the report it just built as the canvas baseline — and the sentence it
   * is holding is the box's own. Removal then deletes the contribution and restores
   * "what the baseline says goes at this slot", which is the same sentence, so the
   * box comes off the ledger and stays on the page.
   */
  it("takes the sentence off the page even though the automatic pass ran first", () => {
    openNormalFormat();
    const b = click(STENOSIS);
    useWorkspace.getState().generateProfessionalReport(STUDY_CTX, { automatic: true });
    expect(lines(findings())).toContain(SHARED_SENTENCE);
    expect(lines(findings()), "the level's normal line is off the page while the box stands")
      .not.toContain("L4-L5: No spinal canal or thecal sac compression is seen.");

    deselect(b);

    expect(lines(findings()), "a deselected box owns its Findings sentence")
      .not.toContain(SHARED_SENTENCE);
    expect(lines(findings()), "and the level's normal line comes back with it")
      .toContain("L4-L5: No spinal canal or thecal sac compression is seen.");
    expect(impression(), "and its Impression sentence")
      .toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION);
  });
});

/**
 * The two Quick Select failures the deep audit measured on release candidate
 * `63b373b8` with real keystrokes, on the two modalities where an approved
 * normal is written as a SECTIONED DOCUMENT (`Heading:` then its prose).
 *
 * Both live in the same three lines of the store promise the header above
 * states — click a box, its Findings appear; click it off, exactly what it owns
 * leaves and exactly the approved normal comes back:
 *
 *  * USG Abdomen box "Fatty Liver Gr I" (`migrations/zz_add_usg_platform_content_pack.sql:87`,
 *    section "Liver" per `zzzzzzzzzzzzzzzzzzzzzz_usg_abdominal_ownership.sql:125-141`)
 *    printed its sentence as the LAST LINE OF THE REPORT, under "Free Fluid:",
 *    on every apply, and persisted it. Then clicking it off deleted the
 *    baseline's own "No focal lesion." from the Liver line and left a double
 *    space where it had been — a negative finding destroyed by a deselection,
 *    766 characters down to 750, and not restored by clicking the box back on
 *    (the surviving copy was the Spleen's).
 *
 *  * CT Brain box "Acute Infarct" (`migrations/zzzz_ct_gold_standard_content.sql:106`)
 *    applied correctly the first time, then stranded its own retired baseline
 *    sentence "No haemorrhage or infarct." at the END of the field when clicked
 *    off — under "Bone Windows:". Clicking the box on again replaced THAT
 *    sentence, so an acute right-MCA infarct printed under "Bone Windows:", and
 *    the reopened draft still said so.
 *
 * The baselines and box wordings below are the strings the app itself produced
 * and consumed in those journeys (`tmp/evidence/remove-j7-usg-abdomen.json`,
 * `remove-j5-ct-brain.json` on the audit rig), not a reconstruction.
 */
const joinLines = (...l: string[]) => l.join("\n");

/** The pristine USG Whole Abdomen normal the workspace bootstrapped (766 chars). */
const USG_ABDOMEN_NORMAL = joinLines(
  "Liver:",
  "Normal size (AP diameter < 15 cm). Homogeneous echotexture. No focal lesion. Intrahepatic biliary radicles not dilated.",
  "",
  "Gallbladder:",
  "Normal size and wall thickness (< 3 mm). No calculi or polyps. No pericholecystic fluid.",
  "",
  "Common Bile Duct:",
  "Not dilated (diameter < 6 mm).",
  "",
  "Spleen:",
  "Normal size (< 12 cm). Homogeneous echotexture. No focal lesion.",
  "",
  "Pancreas:",
  "Normal size and echotexture. Main pancreatic duct not dilated.",
  "",
  "Right Kidney:",
  "Normal size (9–12 cm), position and echotexture. PCS not dilated. No calculus.",
  "",
  "Left Kidney:",
  "Normal size (9–12 cm), position and echotexture. PCS not dilated. No calculus.",
  "",
  "Urinary Bladder:",
  "Adequate distension. Wall normal. No calculus or mass.",
  "",
  "Aorta & IVC:",
  "Normal calibre.",
  "",
  "Free Fluid:",
  "No free fluid in abdomen or pelvis.",
);

/** The pristine CT Brain Plain normal the workspace bootstrapped (291 chars). */
const CT_BRAIN_NORMAL = joinLines(
  "Grey-White Differentiation:",
  "Maintained.",
  "",
  "Parenchyma:",
  "No focal hypo- or hyperdensity. No haemorrhage or infarct.",
  "",
  "Ventricles:",
  "Normal in size and configuration.",
  "",
  "Sulci & Cisterns:",
  "Appropriate for age. Basal cisterns patent.",
  "",
  "Midline:",
  "No shift.",
  "",
  "Bone Windows:",
  "No fracture or destructive lesion.",
);

/**
 * The box at its declared parameter defaults (`territory` = "right MCA",
 * `aspects` = ""), which is the wording the audit journey put on the page. The
 * catalogue row the audit ran against carried no anatomical_section, no concept and
 * no conflict group — that is what made the finding fall to the end of the field —
 * so this fixture keeps those columns empty and proves the legacy inference path
 * still behaves. The row as the ownership migration leaves it is tested separately.
 */
const CT_ACUTE_INFARCT: ClinicalQuickFindingBox = {
  id: 9301,
  label: "Acute Infarct",
  studyType: "CT Brain Plain",
  field: "findings",
  findingText: "Loss of grey-white differentiation with hypodensity in the right MCA "
    + "vascular territory, in keeping with an acute infarct. ASPECTS.",
  impressionText: "Acute right MCA territory infarct.",
  techniqueText: "",
  recommendationText: "Urgent stroke-team correlation. MRI DWI for confirmation and extent.",
};

/**
 * The USG box, with the ownership its migration rows declare: section "Liver",
 * concept "fatty_liver", conflict group "fatty_liver_grade". `baseline_replaces`
 * is NOT seeded for any USG tile — no migration ever sets it — and no baseline
 * Liver sentence contains a `fatty_liver` alias, so this box replaces nothing in
 * place. Its sentence also ENDS with "No focal lesion.", verbatim the baseline
 * Liver sentence, which is what the dedupe then folds away.
 */
const USG_FATTY_LIVER: ClinicalQuickFindingBox = {
  id: 9302,
  label: "Fatty Liver Gr I",
  studyType: "Whole Abdomen",
  field: "findings",
  findingText: "Liver shows mildly increased echogenicity with normal size and contour, "
    + "in keeping with Grade I (mild) fatty infiltration. No focal lesion.",
  impressionText: "Grade I fatty liver.",
  techniqueText: "",
  recommendationText: "",
  anatomicalSection: "Liver",
  concept: "fatty_liver",
  conflictGroup: "fatty_liver_grade",
};

const USG_CTX = buildReportingStudyContext({
  modality: "US", studyDescription: "USG Whole Abdomen", regions: ["Whole Abdomen"], source: "auto",
});
const CT_CTX = buildReportingStudyContext({
  modality: "CT", studyDescription: "CT Brain Plain", regions: ["CT Brain Plain"], source: "auto",
});

/** `structured_report_templates.id 15` ("USG Abdomen"), the row the live USG journey
 *  resolved — its `default_impression` is what the Impression field opened with. */
const USG_ABDOMEN_NORMAL_IMPRESSION = "Normal ultrasound examination of the abdomen. "
  + "No significant intra-abdominal pathology.";

/**
 * The state the running app is in when a study opens on a structured template: the
 * sectioned normal in the editor, and the same text recorded as this report's
 * approved normal by the door that wrote it.
 *
 * This used to hand-build `startingCanvasBaseline`, a state the app never reaches —
 * only the Care-report-format door and an automatic pass have ever stamped it, so on
 * a template-opened study the field was null, `renderedInField` silently fell back to
 * its old presence inference, and a box whose wording ENDS with a sentence the
 * baseline also carries claimed that sentence as its own. Measured on the rig
 * (`tmp/evidence/verify-f2usg.json`, worklist 7): the deselection took the liver's
 * "No focal lesion." off the page with it, 766 characters down to 749.
 */
function openSectionedNormal(
  baseline: string,
  ctx: ReturnType<typeof buildReportingStudyContext>,
  normalImpression = "",
) {
  resetWorkspace();
  useWorkspace.setState({ reportingContext: ctx });
  // The template door, not a hand-set field: writing through `setFieldIfEmpty`
  // gives every sentence of the normal its provenance, and which sentences a later
  // click may delete is decided from that provenance.
  useWorkspace.getState().setFieldIfEmpty("findings", baseline, "template");
  if (normalImpression) {
    useWorkspace.getState().setFieldIfEmpty("impression", normalImpression, "template");
  }
  const stamped = useWorkspace.getState().stampTemplateApprovedNormal({
    name: ctx.regions[0] ?? "",
    findings: baseline,
    impression: normalImpression,
  });
  expect(stamped, "the door that writes the approved normal records it as this report's reference")
    .toBe(true);
  expect(findings()).toBe(baseline);
  expect(impression()).toBe(normalImpression);
}

/** `structured_report_templates` "CT Brain" `default_impression`
 *  (`api-server/src/routes/structuredReportTemplates.ts:425`) — the Conclusion the
 *  template door writes when a CT Brain Plain study opens on its normal. */
const CT_BRAIN_NORMAL_IMPRESSION = "Normal CT Brain. No acute intracranial pathology.";

function openUsgAbdomen() {
  openSectionedNormal(USG_ABDOMEN_NORMAL, USG_CTX, USG_ABDOMEN_NORMAL_IMPRESSION);
}

function openCtBrain() {
  openSectionedNormal(CT_BRAIN_NORMAL, CT_CTX, CT_BRAIN_NORMAL_IMPRESSION);
}

function clickIn(box: ClinicalQuickFindingBox, ctx: ReturnType<typeof buildReportingStudyContext>) {
  const patch = quickFindingPatch(box, { region: ctx.regions[0] ?? "", studyType: ctx.regions[0] });
  const outcome = useWorkspace.getState().applyPathologyOverlay(patch);
  expect(outcome, "the click must write, not ask").toBe("applied");
  return patch.id!;
}

/** The body of the named section — everything from its heading to the next one. */
function sectionBody(text: string, heading: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === `${heading}:`);
  if (at < 0) return "";
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^[^|:\n]{1,60}:$/.test(lines[i]!.trim())) { end = i; break; }
  }
  return lines.slice(at + 1, end).join("\n").trim();
}

describe("the sectioned-document lifecycle the audit measured on 63b373b8", () => {
  it("pins the fixtures to the exact text the journeys produced", () => {
    expect(USG_ABDOMEN_NORMAL.length, "the measured pristine USG Abdomen normal").toBe(766);
    expect(CT_BRAIN_NORMAL.length, "the measured pristine CT Brain Plain normal").toBe(291);
  });

  it("brings the template's own normal Impression back when the box comes off", () => {
    openUsgAbdomen();
    const id = clickIn(USG_FATTY_LIVER, USG_CTX);
    expect(impression(), "the normal conclusion retires whole — a denial with a hyphenated "
      + "modifier is still a denial, and half of it left above a grade is a report that "
      + "denies pathology while naming one")
      .toBe(USG_FATTY_LIVER.impressionText);
    deselect(id);
    expect(impression(), "and the deselection puts back exactly what the template wrote")
      .toBe(USG_ABDOMEN_NORMAL_IMPRESSION);
  });

  it("prints a liver finding in the liver section, not at the end of the report", () => {
    openUsgAbdomen();
    clickIn(USG_FATTY_LIVER, USG_CTX);

    expect(sectionBody(findings(), "Liver")).toContain("Grade I (mild) fatty infiltration");
    expect(sectionBody(findings(), "Free Fluid"),
      "text appended at the end of the field prints under whatever heading comes next")
      .not.toContain("fatty infiltration");
    expect(findings().split("\n").pop(), "and it is not the last line of the report")
      .not.toContain("fatty infiltration");
  });

  it("does not print the sentence the baseline already carries a second time", () => {
    openUsgAbdomen();
    clickIn(USG_FATTY_LIVER, USG_CTX);
    // The box's own wording ends with the baseline's Liver sentence. The dedupe
    // that keeps it off the page twice is correct; the ledger must then not
    // claim a copy it never wrote.
    expect(findings().split("No focal lesion.").length - 1).toBe(2);
  });

  it("restores the pristine USG normal byte-for-byte when the box comes off", () => {
    openUsgAbdomen();
    const id = clickIn(USG_FATTY_LIVER, USG_CTX);
    deselect(id);
    expect(findings(), "a deselection must not destroy a negative finding the box never owned")
      .toBe(USG_ABDOMEN_NORMAL);
  });

  it("restores the pristine CT normal byte-for-byte when the box comes off", () => {
    openCtBrain();
    const id = clickIn(CT_ACUTE_INFARCT, CT_CTX);
    deselect(id);
    expect(findings(), "the retired Parenchyma sentence comes back into the Parenchyma line")
      .toBe(CT_BRAIN_NORMAL);
  });

  it("prints a re-applied infarct in the Parenchyma section, not under Bone Windows", () => {
    openCtBrain();
    const first = clickIn(CT_ACUTE_INFARCT, CT_CTX);
    deselect(first);
    const again = clickIn(CT_ACUTE_INFARCT, CT_CTX);
    void again;

    expect(sectionBody(findings(), "Parenchyma")).toContain("acute infarct");
    expect(sectionBody(findings(), "Bone Windows"),
      "the finding followed where the deselection had stranded its own baseline sentence")
      .not.toContain("infarct");
  });
});

/**
 * Defect D3, measured on the release candidate at study 257 and in the exported
 * Word file of the signed report (`tmp/evidence/accept-t5-usg-abdomen.json`).
 *
 * `cholelithiasis` carries the alias "calculus", so the Gallbladder box's concept
 * test matched "…PCS not dilated. No calculus." in BOTH kidney lines and
 * "…No calculus or mass." in the bladder line, and the click retired all three.
 * The deselection then held one recorded claim for three retired lines: it put a
 * second copy back into the first kidney line and left the second short forever.
 * The signed report printed
 *   Right Kidney:
 *   Normal size (9–12 cm), position and echotexture. PCS not dilated. No calculus.
 *   Normal size (9–12 cm), position and echotexture. PCS not dilated. No calculus.
 * and that is what reached the clinic's Word export.
 */
const USG_CHOLELITHIASIS: ClinicalQuickFindingBox = {
  id: 9176, label: "Cholelithiasis", studyType: "Whole Abdomen", field: "findings",
  findingText: "Gallbladder shows a mobile echogenic focus with posterior acoustic shadowing, "
    + "consistent with a calculus.",
  impressionText: "Cholelithiasis.",
  techniqueText: "",
  recommendationText: "",
  anatomicalSection: "Gallbladder",
  concept: "cholelithiasis",
};

const RIGHT_KIDNEY_NORMAL = "Normal size (9–12 cm), position and echotexture. PCS not dilated. No calculus.";
const BLADDER_NORMAL = "Adequate distension. Wall normal. No calculus or mass.";

/** The liver box's own wording, minus the sentence the baseline Liver line already carries. */
const LIVER_FINDING = "Liver shows mildly increased echogenicity with normal size and contour, "
  + "in keeping with Grade I (mild) fatty infiltration.";

/** The approved normal with that finding printed inside the Liver section, where it belongs. */
const USG_WITH_FATTY_LIVER = USG_ABDOMEN_NORMAL.split("\n")
  .flatMap((l) => (l.startsWith("Normal size (AP diameter") ? [l, LIVER_FINDING] : [l]))
  .join("\n");

describe("D3 · a gallbladder box owns the gallbladder's normal and nobody else's", () => {
  it("retires the gallbladder sentence and leaves the kidneys and the bladder asserting their own", () => {
    openUsgAbdomen();
    clickIn(USG_CHOLELITHIASIS, USG_CTX);

    expect(sectionBody(findings(), "Gallbladder"), "the contradicted gallbladder normal goes")
      .not.toContain("No calculi or polyps.");
    expect(findings(), "the kidney negative survives a stone in the gallbladder")
      .toContain(RIGHT_KIDNEY_NORMAL);
    expect(findings(), "so does the bladder's")
      .toContain(BLADDER_NORMAL);
    expect(findings().split("PCS not dilated.").length - 1,
      "each kidney still states its own pelvicalyceal system once")
      .toBe(2);
  });

  it("puts its own normal back and touches no other organ when it is clicked off", () => {
    openUsgAbdomen();
    const gb = clickIn(USG_CHOLELITHIASIS, USG_CTX);
    const liver = clickIn(USG_FATTY_LIVER, USG_CTX);

    deselect(gb);
    expect(findings(), "byte for byte, in every section the box never touched")
      .toBe(USG_WITH_FATTY_LIVER);
    expect(findings().split(RIGHT_KIDNEY_NORMAL).length - 1,
      "no kidney line is printed twice")
      .toBe(2);

    deselect(liver);
    expect(findings(), "and the whole pristine normal returns when the last box comes off")
      .toBe(USG_ABDOMEN_NORMAL);
  });
});

/**
 * Defect D2, measured on the release candidate at study 255.
 *
 * The four CT Brain Plain boxes carried no `anatomical_section`, no `concept` and no
 * `baseline_replaces` (`zzzz_ct_gold_standard_content.sql` seeds prose only), so on a
 * study opened on the CT Brain Plain normal template: "Midline: No shift." printed six
 * lines above a documented 6 mm shift; the hemorrhage and shift sentences were appended
 * at the end of Findings, i.e. under "Bone Windows:"; and the Conclusion stated the
 * distance without the direction. The metadata is supplied by
 * `zzzzzzzzzzzzzzzzzzzzzzz_ct_brain_quickselect_ownership.sql` and these fixtures are
 * those rows as that migration leaves them.
 */
const CT_MIDLINE_SHIFT: ClinicalQuickFindingBox = {
  id: 9336, label: "Midline Shift", studyType: "CT Brain Plain", field: "findings",
  findingText: "There is midline shift of 6 mm to the left.",
  impressionText: "Midline shift of 6 mm to the left.",
  techniqueText: "",
  recommendationText: "Immediate neurosurgical correlation.",
  anatomicalSection: "Midline",
  concept: "midline",
  baselineReplaces: "No shift.",
};

const CT_HEMORRHAGE: ClinicalQuickFindingBox = {
  id: 9334, label: "Intracranial Hemorrhage", studyType: "CT Brain Plain", field: "findings",
  findingText: "An acute intraparenchymal hemorrhage is noted in the right basal ganglia, "
    + "measuring approximately 12 ml (ABC/2). No significant mass effect.",
  impressionText: "Acute right basal ganglia intracranial hemorrhage.",
  techniqueText: "",
  recommendationText: "Immediate neurosurgical correlation. Follow-up CT to assess for expansion.",
  anatomicalSection: "Parenchyma",
  concept: "hemorrhage",
  baselineReplaces: "No haemorrhage or infarct.",
};

/**
 * The fourth CT Brain Plain box the ownership migration curates, at its parameter
 * defaults (`ventricles` = "lateral and third ventricles", `type` = "obstructive").
 */
const CT_HYDROCEPHALUS: ClinicalQuickFindingBox = {
  id: 9337, label: "Hydrocephalus", studyType: "CT Brain Plain", field: "findings",
  findingText: "Dilatation of the lateral and third ventricles with features suggesting "
    + "obstructive hydrocephalus.",
  impressionText: "Obstructive hydrocephalus.",
  techniqueText: "",
  recommendationText: "Neurosurgical correlation.",
  anatomicalSection: "Ventricles",
  concept: "ventricles",
  baselineReplaces: "Normal in size and configuration.",
};

describe("D2 · a CT Brain abnormality retires, and is filed inside, its own section", () => {
  it("takes the midline normal off the page and prints the shift under Midline", () => {
    openCtBrain();
    clickIn(CT_MIDLINE_SHIFT, CT_CTX);

    expect(sectionBody(findings(), "Midline"), "the denial of the shift is gone")
      .not.toContain("No shift.");
    expect(sectionBody(findings(), "Midline")).toContain("midline shift of 6 mm to the left");
    expect(sectionBody(findings(), "Bone Windows"),
      "and the finding did not fall through to the last heading in the field")
      .not.toContain("shift");
    expect(impression(), "the Conclusion carries the direction, not only the distance")
      .toContain("Midline shift of 6 mm to the left.");
    expect(impression()).toContain("6 mm");
    expect(impression(), "and no normal conclusion is left standing above a documented shift")
      .not.toContain("No acute intracranial pathology.");
  });

  it("files the hemorrhage in the Parenchyma section and retires only its own denial", () => {
    openCtBrain();
    clickIn(CT_HEMORRHAGE, CT_CTX);

    expect(sectionBody(findings(), "Parenchyma")).toContain("intraparenchymal hemorrhage");
    expect(sectionBody(findings(), "Bone Windows")).not.toContain("hemorrhage");
    expect(sectionBody(findings(), "Parenchyma")).not.toContain("No haemorrhage or infarct.");
    expect(findings(), "a normal this box says nothing about is left alone")
      .toContain("Appropriate for age. Basal cisterns patent.");
  });

  it("brings the pristine CT normal back when both come off", () => {
    openCtBrain();
    const shift = clickIn(CT_MIDLINE_SHIFT, CT_CTX);
    const bleed = clickIn(CT_HEMORRHAGE, CT_CTX);
    deselect(bleed);
    deselect(shift);
    expect(findings(), "byte for byte, headings and all")
      .toBe(CT_BRAIN_NORMAL);
  });

  /**
   * The same box AS THE MIGRATION LEAVES IT, which is the row the clinic will click.
   *
   * `zzzzzzzzzzzzzzzzzzzzzzz_ct_brain_quickselect_ownership.sql` gives "Acute Infarct"
   * section `Parenchyma`, concept `infarct`, and a three-sentence `baseline_replaces`
   * — the focal-density denial, the hemorrhage denial that shares its line, and
   * "Grey-White Differentiation: Maintained.", which is a whole heading's body. The
   * fixture above declares nothing, so it proves the legacy path still works; this
   * proves the curated one. An unfilled token still refuses the click, so the
   * heading-qualified claim must reach that one line and no other "Maintained."
   * anywhere.
   */
  const CT_ACUTE_INFARCT_OWNED: ClinicalQuickFindingBox = {
    ...CT_ACUTE_INFARCT,
    anatomicalSection: "Parenchyma",
    concept: "infarct",
    baselineReplaces: "No focal hypo- or hyperdensity.\nNo haemorrhage or infarct.\n"
      + "Grey-White Differentiation: Maintained.",
  };

  it("takes every normal the infarct falsifies and no normal it does not", () => {
    openCtBrain();
    clickIn(CT_ACUTE_INFARCT_OWNED, CT_CTX);

    expect(sectionBody(findings(), "Grey-White Differentiation")).not.toContain("Maintained.");
    expect(sectionBody(findings(), "Parenchyma")).not.toContain("No focal hypo- or hyperdensity.");
    expect(sectionBody(findings(), "Parenchyma")).not.toContain("No haemorrhage or infarct.");
    expect(sectionBody(findings(), "Parenchyma")).toContain("acute infarct");
    for (const untouched of ["Normal in size and configuration.", "No shift.",
      "Appropriate for age. Basal cisterns patent.", "No fracture or destructive lesion."]) {
      expect(findings(), `a normal this box says nothing about: ${untouched}`).toContain(untouched);
    }
    // A document that lost its only body sentence keeps its heading; the heading is
    // the section's label, and dropping it would silently re-title the report.
    expect(lines(findings()).filter((l) => l.trim() === "Grey-White Differentiation:"),
      "the emptied section keeps its label")
      .toHaveLength(1);
  });

  it("restores all three sentences in their own sections, and files a re-click there too", () => {
    openCtBrain();
    const first = clickIn(CT_ACUTE_INFARCT_OWNED, CT_CTX);
    deselect(first);
    expect(findings(), "each sentence back on the line it was written on")
      .toBe(CT_BRAIN_NORMAL);

    const again = clickIn(CT_ACUTE_INFARCT_OWNED, CT_CTX);
    void again;
    expect(sectionBody(findings(), "Parenchyma")).toContain("acute infarct");
    expect(sectionBody(findings(), "Bone Windows"),
      "the audit's misfiling: the finding followed its own stranded baseline sentence")
      .not.toContain("infarct");
    expect(sectionBody(findings(), "Midline")).toContain("No shift.");
  });

  it("retires the ventricular normal and puts it back on its own line", () => {
    openCtBrain();
    const hydro = clickIn(CT_HYDROCEPHALUS, CT_CTX);

    expect(sectionBody(findings(), "Ventricles")).toContain("obstructive hydrocephalus");
    expect(sectionBody(findings(), "Ventricles")).not.toContain("Normal in size and configuration.");
    expect(sectionBody(findings(), "Midline"), "a normal about another structure")
      .toContain("No shift.");
    expect(sectionBody(findings(), "Bone Windows")).not.toContain("hydrocephalus");

    deselect(hydro);
    expect(findings(), "byte for byte").toBe(CT_BRAIN_NORMAL);
    expect(impression(), "and the Conclusion the template wrote, not the system's generic one")
      .toBe(CT_BRAIN_NORMAL_IMPRESSION);
  });
});


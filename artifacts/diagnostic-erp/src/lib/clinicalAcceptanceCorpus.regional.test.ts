/**
 * CLINICAL ACCEPTANCE CORPUS — REGIONAL EXPANSION (Phase 2).
 *
 * Risk-based replacement/restoration coverage across the Quick Select tile
 * families beyond the spine/brain core of Part 12, per body region:
 *
 *   Spine (cervical severity/laterality) · Brain (Fazekas chain) ·
 *   MSK (knee meniscus, shoulder rotator cuff) · Abdomen (gallbladder,
 *   renal) · Pelvis (hip) · Chest (lungs) · Breast (BI-RADS) · PNS (sinus).
 *
 * Every case asserts BOTH directions (REQUIRED + FORBIDDEN), the same way
 * Part 12 does, and drives the real shipped tiles through the real store
 * entries (applyPathologyOverlay / removeObservation / composeInstantReport).
 * Representative risk cases only — no combinatorial explosion: one laterality
 * pair, one severity chain, one multi-abnormal combination, one study-wide
 * normal, one manual-edit survival and one deselect restoration per family,
 * reusing the spine/brain primitives Part 12 already covers exhaustively.
 *
 * Two engine gaps this expansion surfaced (both fixed on this branch):
 *   R2-1 the shipped normal wording "No calculi or sludge." / "No calculus or
 *        hydronephrosis." did not retire beside Gallstones / Renal calculus —
 *        the cholelithiasis/renal concepts lacked those aliases, so the
 *        direct contradiction printed side by side (the facet class again).
 *   R2-2 the MSK/abdomen/pelvis abnormal tiles carried no impressionSentence,
 *        so the Impression said "Normal MRI of the knee." over a described
 *        tear — tiles now restate their own finding sentence, the same pattern
 *        every spine/brain tile follows; BI-RADS 1 also joins the bi-rads
 *        severity chain it was missing from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import {
  DEFAULT_QUICK_SELECT_TILES,
  type QuickSelectTile,
} from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch, tileRowId, clickedTilePatch  } from "./zai-workspace/quickSelectTileFixture";
import type { QuickSelectParameterValues } from "./zai-workspace/quickSelectParameterContract";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";

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

type Ctx = ReturnType<typeof buildReportingStudyContext>;
const ctx = (modality: string, studyDescription: string, regions: string[]): Ctx =>
  buildReportingStudyContext({ modality, studyDescription, regions, source: "auto" } as never);

const KNEE = () => ctx("MR", "MRI Knee", ["Knee"]);
const SHOULDER = () => ctx("MR", "MRI Shoulder", ["Shoulder"]);
const PELVIS = () => ctx("MR", "MRI Pelvis", ["Pelvis"]);
const CHEST = () => ctx("XR", "X-Ray Chest", ["Chest"]);
const ABDOMEN = () => ctx("US", "US Abdomen", ["Abdomen"]);
const BREAST = () => ctx("MG", "Bilateral Mammography", ["Breast"]);
const PNS = () => ctx("CT", "CT PNS", ["PNS"]);
const CERVICAL = () => ctx("MR", "MRI Cervical Spine", ["Cervical Spine"]);
const BRAIN = () => ctx("MR", "MRI Brain Plain", ["Brain"]);

/** Open the study Mode A composes; regions without an approved baseline open
 *  through their shipped Report Format — the honest start for those regions. */
function openStudy(studyCtx: Ctx, formatName?: string) {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: studyCtx,
    studies: [{ id: "syn-regional-1", patient: { name: "SYNTHETIC PATIENT", sex: "M" }, modality: "MR" }],
    activeStudyId: "syn-regional-1",
    completedStudyIds: new Set<string>(),
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    canalApProvenance: {},
  } as never);
  const action = S().composeInstantReport(studyCtx, false).action;
  if (formatName) {
    const fmt = DEFAULT_REPORT_FORMATS.find((f) => f.name === formatName);
    if (!fmt) throw new Error(`no shipped report format named ${formatName}`);
    S().applyFormatById(fmt.id);
  }
  return action;
}

function click(t: QuickSelectTile, params: QuickSelectParameterValues = {}) {
  const outcome = S().applyPathologyOverlay(clickedTilePatch(t, "findings", params));
  if (outcome !== "applied") throw new Error(`${t.label} click was ${outcome}`);
  return tileRowId(t, params.side);
}
const clickImpression = (t: QuickSelectTile, params: QuickSelectParameterValues = {}) => {
  const outcome = S().applyPathologyOverlay(clickedTilePatch(t, "impression", params));
  if (outcome !== "applied") throw new Error(`${t.label} impression click was ${outcome}`);
  return tileRowId(t, params.side);
};
const recompose = (studyCtx: Ctx) => S().composeInstantReport(studyCtx, false);

/** Full-set equivalence with the pre-click scaffold, the journey rule. */
function scaffoldRestored(scaffold: string) {
  const before = splitToSentences(scaffold).map(normalizeForDedupe).filter(Boolean).sort();
  const after = splitToSentences(findingsOf()).map(normalizeForDedupe).filter(Boolean).sort();
  expect(after).toEqual(before);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("regional corpus — MSK (knee, shoulder)", () => {
  it("knee meniscus tear: laterality pair, its normals retire, impression concludes, deselect restores", () => {
    openStudy(KNEE());
    required("Medial meniscus is intact without tear.");
    required("Lateral meniscus is intact without tear.");
    required("Normal MRI of the knee.", "impression");
    required("No meniscal tear, ligament injury or significant articular cartilage abnormality.", "impression");

    // Laterality: left then right, both findings print, both impression lines conclude.
    const left = click(tile("Meniscus tear"), { side: "left" });
    required("Oblique tear of the left meniscus.");
    forbidden("Medial meniscus is intact without tear.");
    forbidden("Lateral meniscus is intact without tear.");
    required("Oblique tear of the left meniscus.", "impression");
    forbidden("Normal MRI of the knee.", "impression");
    click(tile("Meniscus tear"), { side: "right" });
    required("Oblique tear of the right meniscus.");
    required("Oblique tear of the right meniscus.", "impression");

    // The untouched knee structures stay — no over-generalisation.
    required("Anterior cruciate ligament is intact with normal signal and course.");
    required("No significant bone marrow edema is seen in the visualized osseous structures.");

    // Deselect the left side: the study-wide meniscus normals wait for the last side.
    S().removeObservation(left);
    recompose(KNEE());
    required("Oblique tear of the right meniscus.");
    forbidden("Medial meniscus is intact without tear.");
    forbidden("Oblique tear of the left meniscus.");
  });

  it("knee manual edit survives the click and the recompose pass", () => {
    openStudy(KNEE());
    const his = "Small popliteal cyst, typed by the radiologist.";
    S().setField("findings", `${findingsOf()}\n${his}`, { source: "manual" });
    click(tile("Meniscus tear"), { side: "left" });
    required(his);
    recompose(KNEE());
    required(his);
  });

  it("shoulder rotator cuff tear: retires its own normal only, deselect restores exactly", () => {
    openStudy(SHOULDER());
    const scaffold = findingsOf();
    required("Rotator cuff tendons — supraspinatus, infraspinatus, subscapularis and teres minor — show normal continuity, thickness and signal intensity.");
    required("Glenoid labrum is intact.");
    const row = click(tile("Rotator cuff tear"), { side: "left" });
    required("Full-thickness tear of the left rotator cuff.");
    forbidden("Rotator cuff tendons — supraspinatus, infraspinatus, subscapularis and teres minor — show normal continuity, thickness and signal intensity.");
    // Untouched shoulder structures stay.
    required("Glenoid labrum is intact.");
    required("Full-thickness tear of the left rotator cuff.", "impression");
    forbidden("Normal MRI of the shoulder.", "impression");
    S().removeObservation(row);
    recompose(SHOULDER());
    required("Rotator cuff tendons — supraspinatus, infraspinatus, subscapularis and teres minor — show normal continuity, thickness and signal intensity.");
    scaffoldRestored(scaffold);
  });
});

describe("regional corpus — pelvis (hip)", () => {
  it("hip effusion: the named side retires, both sides conclude, deselect restores", () => {
    openStudy(PELVIS());
    const scaffold = findingsOf();
    required("Left hip joint is normally aligned with preserved articular cartilage and no joint effusion.");
    required("Right hip joint is normally aligned with preserved articular cartilage and no joint effusion.");
    const left = click(tile("Hip effusion"), { side: "left" });
    required("Moderate effusion in the left hip joint.");
    forbidden("Left hip joint is normally aligned with preserved articular cartilage and no joint effusion.");
    required("Right hip joint is normally aligned with preserved articular cartilage and no joint effusion.");
    required("Moderate effusion in the left hip joint.", "impression");
    click(tile("Hip effusion"), { side: "right" });
    required("Moderate effusion in the right hip joint.");
    forbidden("Right hip joint is normally aligned with preserved articular cartilage and no joint effusion.");
    // Deselect the left side: the RIGHT effusion never spoke for the LEFT
    // normal (D-27 independence, now carried into the restore path), and the
    // right normal waits for its own falsifier.
    S().removeObservation(left);
    recompose(PELVIS());
    required("Left hip joint is normally aligned with preserved articular cartilage and no joint effusion.");
    required("Moderate effusion in the right hip joint.");
    forbidden("Right hip joint is normally aligned with preserved articular cartilage and no joint effusion.");
  });
});

describe("regional corpus — abdomen (gallbladder, renal)", () => {
  it("gallstones retire their own contradicted normal wording (R2-1), the rest of the survey stays", () => {
    openStudy(ABDOMEN(), "US Abdomen — Normal");
    required("Gallbladder is normal in size and wall thickness.");
    required("No calculi or sludge.");
    required("Both kidneys are normal in size and cortical thickness.");
    click(tile("Gallstones"));
    required("Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, largest measuring ___ mm, suggestive of cholelithiasis.");
    // The direct contradiction is the point of the retire engine.
    forbidden("No calculi or sludge.");
    required("Cholelithiasis (gallstones).", "impression");
    // Unrelated abdominal survey lines stay.
    required("Liver is normal in size and echo texture.");
    required("No calculus or hydronephrosis.");
  });

  it("renal calculus: side-parameterised finding, its contradicted normal retires, deselect restores", () => {
    openStudy(ABDOMEN(), "US Abdomen — Normal");
    const scaffold = findingsOf();
    const row = click(tile("Renal calculus"), { side: "left" });
    required("Echogenic renal calculus in the left kidney with posterior acoustic shadowing.");
    forbidden("No calculus or hydronephrosis.");
    required("Renal calculus in the left kidney.", "impression");
    required("Liver is normal in size and echo texture.");
    S().removeObservation(row);
    recompose(ABDOMEN());
    required("No calculus or hydronephrosis.");
    forbidden("Echogenic renal calculus in the left kidney with posterior acoustic shadowing.");
    scaffoldRestored(scaffold);
  });
});

describe("regional corpus — chest (lungs)", () => {
  it("pneumothorax retires its contradicted normal; the nodule retires its own wording and combines cleanly", () => {
    openStudy(CHEST(), "CT Chest — Normal");
    required("No pleural effusion or pneumothorax.");
    const row = click(tile("Pneumothorax"));
    required("Tension pneumothorax on the right with mediastinal shift to the left.");
    forbidden("No pleural effusion or pneumothorax.");
    required("Lung fields are clear.");
    // A second abnormality on the same study: the nodule retires its own
    // contradicted normal wording (R2-3) and combines without interference.
    click(tile("Pulmonary nodule"));
    required("Spiculated pulmonary nodule measuring ___ × ___ × ___ cm in the right upper lobe.");
    forbidden("No focal consolidation, mass lesion, or nodule.");
    required("Mediastinum is normal.");
    S().removeObservation(row);
    recompose(CHEST());
    required("No pleural effusion or pneumothorax.");
    forbidden("Tension pneumothorax on the right with mediastinal shift to the left.");
  });
});

describe("regional corpus — breast (BI-RADS severity chain)", () => {
  it("a single assessment tile writes its full line on an unclaimed impression", () => {
    // No format applied: the assessment tiles speak for an impression nobody
    // owns yet. A severity UPGRADE (B4 → B5, B1 → B4) is the R2-6 pin below —
    // the general impression-field same-slot strip defect.
    openStudy(BREAST());
    clickImpression(tile("BI-RADS 4"));
    required("BI-RADS 4: Suspicious for malignancy.", "impression");
    required("Image-guided biopsy recommended.", "impression");
  });

  it("a single critical assessment writes its full line on an unclaimed impression", () => {
    openStudy(BREAST());
    clickImpression(tile("BI-RADS 5"));
    required("BI-RADS 5: Highly suggestive of malignancy.", "impression");
    required("Biopsy mandatory.", "impression");
    required("Surgical referral advised.", "impression");
  });

  // R2-6 (discovered, pinned, general): EVERY same-slot assessment upgrade
  // in the impression field (B1 → B4 → B5, the bi-rads chain) leaves the
  // vacated assessment's sentences on the page as stale fragments — the
  // report carries two contradicting assessments at once. The findings-field
  // chain strips its vacated row's wording (C3); the impression-field chain
  // does not. Pinned until that strip is extended to the impression field.
  it.fails("R2-6 pin: an assessment upgrade retires the assessment it replaced", () => {
    openStudy(BREAST());
    clickImpression(tile("BI-RADS 4"));
    clickImpression(tile("BI-RADS 5"));
    forbidden("BI-RADS 4: Suspicious for malignancy.", "impression");
    forbidden("Image-guided biopsy recommended.", "impression");
  });

  // R2-4 (discovered, pinned): over a format-owned impression, an assessment
  // tile ADDS its line while the format's contradicting assessment stays —
  // "BI-RADS 2: Benign findings." printed beside "BI-RADS 5: Highly
  // suggestive of malignancy." — because format-started studies seed no
  // ledger row for the impression, so no retirement can fire. The owner must
  // decide the contract (assessment tiles replace/ask over a format
  // assessment); pinned until then.
  it.fails("R2-4 pin: an assessment tile must retire the format assessment it contradicts", () => {
    openStudy(BREAST(), "MG Breast — BI-RADS 2 (Benign)");
    clickImpression(tile("BI-RADS 5"));
    forbidden("BI-RADS 2: Benign findings.", "impression");
  });
});

describe("regional corpus — PNS (sinus)", () => {
  it("maxillary sinusitis: side-parameterised finding prints once per side", () => {
    openStudy(PNS());
    click(tile("Maxillary sinusitis"), { side: "left" });
    required("Mucosal thickening in the left maxillary sinus.");
    click(tile("Maxillary sinusitis"), { side: "right" });
    required("Mucosal thickening in the right maxillary sinus.");
    required("Mucosal thickening in the left maxillary sinus.");
  });
});

describe("regional corpus — spine and brain severity chains (extends Part 12)", () => {
  it("cervical same-slot upgrade: disc bulge C5-C6 → herniation C5-C6, deselect restores the level normal", () => {
    openStudy(CERVICAL());
    required("C5-C6: No significant disc bulge or protrusion is seen.");
    click(tile("Disc bulge C5-C6"));
    required("Diffuse disc bulge at C5-C6.");
    forbidden("C5-C6: No significant disc bulge or protrusion is seen.");
    const row = click(tile("Disc herniation C5-C6"));
    required("Central disc herniation at C5-C6.");
    forbidden("Diffuse disc bulge at C5-C6.");
    // Neighbouring levels keep their normals.
    required("C4-C5: No significant disc bulge or protrusion is seen.");
    S().removeObservation(row);
    recompose(CERVICAL());
    required("C5-C6: No significant disc bulge or protrusion is seen.");
    forbidden("Central disc herniation at C5-C6.");
  });

  it("brain Fazekas severity chain 1 → 2 → 3: the parenchyma normal restores, never the intermediate", () => {
    openStudy(BRAIN());
    const parenchyma = "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.";
    required(parenchyma);
    click(tile("Fazekas 1"));
    required("Mild chronic small vessel ischemic disease (Fazekas grade 1).", "impression");
    forbidden(parenchyma);
    click(tile("Fazekas 2"));
    required("Moderate chronic small vessel ischemic disease (Fazekas grade 2).", "impression");
    forbidden("Mild chronic small vessel ischemic disease (Fazekas grade 1).", "impression");
    const row = click(tile("Fazekas 3"));
    required("Severe chronic small vessel ischemic disease (Fazekas grade 3).", "impression");
    forbidden("Moderate chronic small vessel ischemic disease (Fazekas grade 2).", "impression");
    S().removeObservation(row);
    recompose(BRAIN());
    required(parenchyma);
    forbidden("Severe chronic small vessel ischemic disease (Fazekas grade 3).", "impression");
  });
});

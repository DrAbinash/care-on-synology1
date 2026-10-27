/**
 * Clinical ruling #174 — "contradictory normal Findings must be withdrawn when an
 * authorized abnormal observation is applied", consistently across every door that opens
 * a whole report.
 *
 * Four doors write a whole Findings section: the automatic Mode A pass, the Quick Select
 * click, the Full Normal Format apply, and the two-format merge. Measured over the shipped
 * catalogue (tmp/census-before.txt vs tmp/census5.txt, `normals_present` counts the normal
 * sentences of the opened baseline that are still on the page after a clicked L4-L5
 * herniation):
 *
 *   door                                   before      after
 *   Quick Select click                     38/39 ✓     38/39 ✓
 *   automatic pass                         38/39 ✓     38/39 ✓
 *   Full Normal Format over the click      39/39 ✗     38/39 ✓
 *   two-format merge over the click        39/39 ✗     38/39 ✓
 *   … the same, after save and reload      39/39 ✗     38/39 ✓
 *   cervical (C5-C6) / brain (parenchyma)  44/44, 12/12 ✗   43/44, 11/12 ✓
 *
 * The two broken doors never consulted the observation ledger: the format door
 * re-materialised the slot the click had just retired (prose AND a live row), and the
 * merge door wrote the pair's Findings as prose owning no row at all, which is also why
 * the contradiction survived a reload. Both now read the report through
 * `normalClaimSupersededBy` — the click door's structured slot rule, extracted from
 * `applyPathologyPatch` rather than reimplemented — so no keyword list and no anatomical
 * section sweep is involved, and a withdrawal is a suspension the deselection undoes.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { useWorkspace, type AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { materializeFormatBaseline } from "@/lib/zai-workspace/fullReportBaseline";
import {
  abnormalSlotOwners, claimRetiredBaselines, mergedFindingsWithdrawal, retainedNormalReviewWarnings,
  withdrawSupersededNormals,
} from "@/lib/zai-workspace/withdrawSupersededNormals";
import { normalClaimSupersededBy } from "@/lib/pathologyPatch";
import { CONTRADICTED_NORMAL_RETAINED_HINT } from "@/lib/observationLedger";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { contributionPresent } from "@/lib/observationSlot";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import { levelIllustratedByTileLabel } from "@/lib/zai-workspace/quickSelectTileFixture";

const LS_STANDARD = formatNamed("MRI LS Spine — Standard Normal");
const LS_NORMAL = formatNamed("MRI LS Spine — Normal");
const WHOLE_SCREEN = formatNamed("MRI Whole Spine — Screening");
const CERVICAL_STANDARD = formatNamed("MRI Cervical Spine — Standard Normal");
const BRAIN_STANDARD = formatNamed("MRI Brain — Standard Normal");
const BRAIN_SCREENING = formatNamed("MRI Brain — Screening Normal");
const DISC_L45 = tileNamed("Disc herniation L4-L5");
const DISC_C56 = tileNamed("Disc herniation C5-C6");
const EDEMA = tileNamed("Cerebral edema");
const LACUNES = tileNamed("Lacunar infarcts");
const HIS_NORMAL = "The L4-L5 disc is unremarkable on the study." /* his own words, not the scaffold's */;
const HIS_LATER_NOTE = "The patient had a prior discectomy at this level."; /* written after the box */

function formatNamed(name: string) {
  const found = DEFAULT_REPORT_FORMATS.find((f) => f.name === name);
  if (!found) throw new Error(`the library no longer ships a format named ${name}`);
  return found;
}

function tileNamed(label: string) {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`the library no longer ships a Quick Select tile named ${label}`);
  return found;
}

/**
 * The normal sentence the shipped baseline carries for one structured slot, read out of
 * the catalogue rather than retyped here: a test that hard-codes clinic wording passes
 * when the wording changes and so proves nothing about the rule.
 */
function baselineSentence(format: typeof LS_STANDARD, region: string, concept: string, level: string): string {
  const row = materializeFormatBaseline(format, region)
    .find((r) => r.observation?.role === "baseline"
      && r.observation?.concept === concept
      && r.observation?.level === level);
  if (!row) throw new Error(`${format.name} ships no ${concept} baseline slot at ${level}`);
  return (row.templates.findings ?? "").trim();
}

function openStudy(format: typeof LS_STANDARD, description: string, region: string, modality: string) {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality, studyDescription: description, regions: [region], source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    activeStudyId: "study-174",
    activeStudyInstanceUID: "1.2.840.R174",
    clinicalHistoryText: "",
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    impressionNeedsRefresh: false,
    impressionDependencyReasons: [],
    impressionBasis: null,
    isDirty: false,
    isFinalized: false,
    confirmOverwriteOpen: false,
    pendingFormatIds: [],
    pendingFormatOverwrite: null,
    pendingFormatRegion: null,
    pendingPathologyPatch: null,
    abnormalPatternConfirm: null,
    mergePreviewOpen: false,
    lastMergeResult: null,
    lastMergeFormats: null,
    ownershipReviewWarnings: [],
    voiceComposerObservations: [],
    startingCanvasBaseline: {
      formatName: format.name,
      formatRevision: 1,
      findings: format.findings ?? "",
      impression: format.impression ?? "",
      appliedAt: "test",
    },
  } as never);
}

/** The strip's own write path: one tile, as the button dispatches it. */
function tileId(tile: typeof DISC_L45) {
  return `qs-${tile.label.replace(/\W+/g, "-").toLowerCase()}`;
}

function clickTile(tile: typeof DISC_L45, level?: string) {
  // The level the strip's chip carries for this click, stated rather than invented:
  // a parameterized cervical tile asks for its level and the contract refuses the
  // click when nobody answers, so a fixture that means the C5-C6 box must SELECT
  // C5-C6 — the level its label illustrates — exactly as the radiologist does.
  const chosen = level ?? levelIllustratedByTileLabel(tile);
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: tile.sentence, impression: tile.impressionSentence },
    templates: { findings: tile.sentence, impression: tile.impressionSentence },
    ownership: {
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
      concept: tile.concept,
      level: tile.level,
      laterality: tile.laterality,
    },
    source: "quick-select",
    id: tileId(tile),
    region: tile.scopeBodyPart,
    label: tile.label,
    findingsText: tile.sentence,
    ...(chosen ? { level: chosen } : {}),
  });
}

/**
 * The same write path as `clickTile`, for an observation shaped like a sided DB box:
 * the shipped tile list carries no laterality-bearing lumbar box, and inventing a
 * clinical rule here would test nothing that the catalogue does not already do.
 */
function click(obs: {
  findings: string; impression: string; id: string; label: string;
  ownership: { concept: string; level: string; laterality: string; anatomicalSection: string; conflictGroup: string; baselineReplaces: string };
}) {
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: obs.findings, impression: obs.impression },
    templates: { findings: obs.findings, impression: obs.impression },
    ownership: obs.ownership,
    source: "quick-select",
    id: obs.id,
    region: "LS Spine",
    label: obs.label,
    findingsText: obs.findings,
  });
}

/** The real single-format picker path, confirmation included. */
function applyFullNormalFormat(format: typeof LS_STANDARD) {
  useWorkspace.getState().toggleFormatSelection(format.id);
  useWorkspace.getState().applySelectedFormats();
  if (useWorkspace.getState().confirmOverwriteOpen) useWorkspace.getState().confirmOverwriteAndApply();
}

function mergeFormats(formats: Array<typeof LS_STANDARD>) {
  for (const f of formats) useWorkspace.getState().toggleFormatSelection(f.id);
  useWorkspace.getState().applySelectedFormats();
  if (useWorkspace.getState().confirmOverwriteOpen) useWorkspace.getState().confirmOverwriteAndApply();
  const preview = useWorkspace.getState().lastMergeResult;
  expect(preview, "the picker must have armed a merge preview").not.toBeNull();
  useWorkspace.getState().applyMergedResult();
  return preview!;
}

function findingsPage() {
  return useWorkspace.getState().findingsText;
}

function onPage(sentence: string) {
  return contributionPresent(findingsPage(), sentence);
}

function rows(): AppliedPathologyPatch[] {
  return useWorkspace.getState().appliedPathologyPatches;
}

function rowById(id: string) {
  const found = rows().find((p) => p.id === id);
  if (!found) throw new Error(`no ledger row ${id} — the door did not carry it`);
  return found;
}

/** The ledger row for one structured baseline slot, by concept and level. */
function baselineRow(concept: string, level: string) {
  const found = rows().find((p) => p.observation?.role === "baseline"
    && p.observation?.concept === concept
    && p.observation?.level === level);
  if (!found) throw new Error(`no baseline ledger row for ${concept} at ${level}`);
  return found;
}

describe("Ruling 3 · the Full Normal Format door answers to the live observations", () => {
  beforeEach(() => openStudy(LS_STANDARD, "MRI LS Spine", "LS Spine", "MR"));

  it("withdraws the normal for the slot the finding asserts, and only that slot", () => {
    applyFullNormalFormat(LS_STANDARD);
    clickTile(DISC_L45);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    const otherLevels = ["L1-L2", "L2-L3", "L3-L4", "L5-S1"]
      .map((l) => baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", l));
    expect(onPage(contradicted), "the click withdrew it first").toBe(false);

    // The doctor re-opens the report by applying the Full Normal Format over his finding.
    applyFullNormalFormat(LS_STANDARD);

    expect(contradicted, "the shipped baseline does carry a normal for this slot").not.toBe("");
    expect(onPage(contradicted), "…and it must not come back beside the herniation").toBe(false);
    for (const sentence of otherLevels) {
      expect(onPage(sentence), `collateral normal lost: ${sentence}`).toBe(true);
    }
    expect(onPage(baselineSentence(LS_STANDARD, "LS Spine", "facet_joint", "")),
      "a non-disc normal in the same section is untouched").toBe(true);
    expect(onPage(DISC_L45.sentence!), "and the finding itself is still on the page").toBe(true);
  });

  it("leaves a genuinely normal study completely normal", () => {
    applyFullNormalFormat(LS_STANDARD);
    const normals = materializeFormatBaseline(LS_STANDARD, "LS Spine")
      .filter((r) => r.observation?.role === "baseline")
      .map((r) => (r.templates.findings ?? "").trim());
    for (const sentence of normals) {
      expect(onPage(sentence), `a normal was withdrawn with nothing to justify it: ${sentence}`).toBe(true);
    }
    expect(rows().filter((p) => p.stale), "and no baseline row was suspended").toHaveLength(0);
  });

  it("suspends the ledger row instead of deleting it, and says so on the finding", () => {
    clickTile(DISC_L45);
    applyFullNormalFormat(LS_STANDARD);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    const row = baselineRow("disc_contour", "L4-L5");

    expect(row.stale, "the slot is suspended, not dropped").toBe(true);
    expect(row.lastRendered.findings, "and it claims no prose").toBe("");
    expect(row.templates.findings!.trim(), "…while still holding the wording to restore").toBe(contradicted);
    expect(
      rowById(tileId(DISC_L45)).replacedBaseline?.findings,
      "the finding records that this door withdrew the normal for its sake",
    ).toContain(contradicted);
  });

  it("brings the normal back when the finding is deselected", () => {
    clickTile(DISC_L45);
    applyFullNormalFormat(LS_STANDARD);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    expect(onPage(contradicted)).toBe(false);

    useWorkspace.getState().removeObservation(tileId(DISC_L45), {});

    expect(onPage(contradicted), "deselecting the herniation restores the L4-L5 normal").toBe(true);
    expect(onPage(DISC_L45.sentence!), "and the finding it replaced goes with it").toBe(false);
  });

  it("keeps the withdrawal after save and reload, with the normal still owned", () => {
    clickTile(DISC_L45);
    applyFullNormalFormat(LS_STANDARD);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    const s = useWorkspace.getState();
    const narrative = {
      findings: s.findingsText, impression: s.impressionText, recommendation: s.recommendationText,
      technique: s.techniqueText, clinicalHistory: s.clinicalHistoryText,
    };
    const saved = JSON.parse(JSON.stringify(s.serializeObservationLedger()));

    openStudy(LS_STANDARD, "MRI LS Spine", "LS Spine", "MR");
    useWorkspace.getState().setEditorContent(narrative);
    const hydrated = useWorkspace.getState().hydrateObservationLedger(saved);

    expect(hydrated.ok, `the ledger must reload: ${JSON.stringify(hydrated)}`).toBe(true);
    expect(onPage(contradicted), "the contradictory normal does not return on reload").toBe(false);
    expect(onPage(DISC_L45.sentence!)).toBe(true);
  });

  it("keeps his later wording when he writes after the finding", () => {
    // The order the ruling names: a normal report, a herniation box, then his own
    // sentence, then the Full Normal Format again. His text is the later fact about the
    // report, so the door keeps it AND keeps the withdrawn normal withdrawn — neither at
    // the cost of the other.
    applyFullNormalFormat(LS_STANDARD);
    clickTile(DISC_L45);
    useWorkspace.getState().mergeField("findings", HIS_LATER_NOTE, "manual");
    expect(onPage(HIS_LATER_NOTE), "the strip appended his note").toBe(true);

    applyFullNormalFormat(LS_STANDARD);

    expect(onPage(HIS_LATER_NOTE), "the format door does not overwrite it").toBe(true);
    expect(
      useWorkspace.getState().fieldProvenance.findings[normalizeForDedupe(HIS_LATER_NOTE)],
      "and it is still his",
    ).toContain("manual");
    expect(onPage(baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5")),
      "the contradicted normal is still not written back").toBe(false);
    expect(onPage(baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L5-S1")),
      "and the uncontested one still reads normal").toBe(true);
  });

  it("makes the same laterality decision the click door makes", () => {
    // A sided finding against a baseline that claims both sides. The shipped tile list
    // carries no laterality-bearing lumbar box, so this arrives the way a sided DB box
    // does: concept, level and side on the patch. The ruling does not re-argue which
    // sentences a left stenosis falsifies — it requires every door to answer with the one
    // rule — so this asserts agreement: what the click withdrew the format door must not
    // write back, and what the click left standing the format door must not take away.
    applyFullNormalFormat(LS_STANDARD);
    const baselineUnits = materializeFormatBaseline(LS_STANDARD, "LS Spine")
      .filter((r) => r.observation?.role === "baseline")
      .map((r) => (r.templates.findings ?? "").trim())
      .filter(Boolean);
    const onThePage = () => new Set(baselineUnits.filter((s) => onPage(s)));
    const before = onThePage();

    click({
      findings: "There is a left disc osteophyte complex at L4-L5 narrowing the left neural foramen.",
      impression: "Left L4-L5 foraminal stenosis.",
      id: "qs-left-foraminal-stenosis-l4-5",
      label: "Foraminal stenosis L4-L5 (left)",
      ownership: {
        concept: "foraminal_stenosis", level: "L4-L5", laterality: "left",
        anatomicalSection: "", conflictGroup: "", baselineReplaces: "",
      },
    });
    const afterClick = onThePage();
    const withdrawn = [...before].filter((s) => !afterClick.has(s));
    expect(withdrawn, "the sided finding must actually retire something for this to mean anything").not.toHaveLength(0);
    expect(withdrawn.some((s) => /L4-L5: Neural foramina are patent bilaterally/i.test(s)),
      `and the claim it falsifies is the bilateral one — got ${JSON.stringify(withdrawn)}`).toBe(true);

    applyFullNormalFormat(LS_STANDARD);
    const afterFormat = onThePage();

    for (const sentence of withdrawn) {
      expect(afterFormat.has(sentence), `the format door wrote back what the click withdrew: ${sentence}`).toBe(false);
    }
    for (const sentence of afterClick) {
      expect(afterFormat.has(sentence), `the format door removed a normal the click kept: ${sentence}`).toBe(true);
    }
  });

  it("does the same on the cervical and brain catalogues", () => {
    openStudy(CERVICAL_STANDARD, "MRI Cervical Spine", "Cervical Spine", "MR");
    clickTile(DISC_C56);
    applyFullNormalFormat(CERVICAL_STANDARD);
    const cervical = baselineSentence(CERVICAL_STANDARD, "Cervical Spine", "disc_contour", "C5-C6");
    expect(onPage(cervical), "C5-C6 contour normal must not stand under a C5-C6 herniation").toBe(false);
    expect(onPage(baselineSentence(CERVICAL_STANDARD, "Cervical Spine", "disc_contour", "C6-C7")),
      "…and the next level's normal stays").toBe(true);

    openStudy(BRAIN_STANDARD, "MRI Brain", "Brain", "MR");
    applyFullNormalFormat(BRAIN_STANDARD);
    clickTile(EDEMA);
    const parenchyma = baselineSentence(BRAIN_STANDARD, "Brain", "brain_parenchyma", "");
    expect(onPage(parenchyma), "the click retired the whole-exam parenchyma normal").toBe(false);
    applyFullNormalFormat(BRAIN_STANDARD);
    expect(onPage(parenchyma), "the format door must not write it back over the oedema").toBe(false);
  });

  it("never touches the radiologist's own wording, even where it contradicts", () => {
    useWorkspace.getState().setField("findings", HIS_NORMAL, { source: "manual" });
    clickTile(DISC_L45);
    applyFullNormalFormat(LS_STANDARD);

    expect(onPage(HIS_NORMAL), "his sentence stays exactly where he wrote it").toBe(true);
    expect(
      useWorkspace.getState().fieldProvenance.findings[normalizeForDedupe(HIS_NORMAL)],
      "and it is still attributed to him",
    ).toContain("manual");
  });
});

describe("Ruling 3 · the two-format merge door follows the same rule", () => {
  beforeEach(() => openStudy(LS_STANDARD, "MRI LS Spine", "LS Spine", "MR"));

  it("withholds the merged normal for a slot the report already states abnormal", () => {
    clickTile(DISC_L45);
    mergeFormats([LS_STANDARD, WHOLE_SCREEN]);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");

    expect(onPage(contradicted), "the merged pair may not state this disc normal").toBe(false);
    expect(onPage(baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L3-L4")),
      "the other levels still read normal").toBe(true);
    expect(onPage(DISC_L45.sentence!), "and the finding survives the merge").toBe(true);
  });

  it("carries the withheld slot as a suspended row so deselection restores it", () => {
    clickTile(DISC_L45);
    mergeFormats([LS_STANDARD, WHOLE_SCREEN]);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    const row = baselineRow("disc_contour", "L4-L5");
    expect(row.stale, "the merge door now owns the sentence it withheld").toBe(true);
    expect(row.templates.findings!.trim()).toBe(contradicted);

    useWorkspace.getState().removeObservation(tileId(DISC_L45), {});
    expect(onPage(contradicted), "and deselecting the finding puts it back").toBe(true);
  });

  it("shows the preview exactly what Apply withholds", () => {
    clickTile(DISC_L45);
    useWorkspace.getState().toggleFormatSelection(LS_STANDARD.id);
    useWorkspace.getState().toggleFormatSelection(WHOLE_SCREEN.id);
    useWorkspace.getState().applySelectedFormats();
    if (useWorkspace.getState().confirmOverwriteOpen) useWorkspace.getState().confirmOverwriteAndApply();
    const state = useWorkspace.getState();
    const preview = state.lastMergeResult!;

    // What the dialog reads: the same call, the same live state.
    const shown = mergedFindingsWithdrawal({
      merged: preview.findings,
      formats: [state.lastMergeFormats!.a, state.lastMergeFormats!.b],
      region: state.reportingContext.region || "",
      livePatches: state.appliedPathologyPatches,
      fields: { findings: state.findingsText, impression: state.impressionText },
    });
    expect(shown.withheld.map((w) => w.trim())).toContain(baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5"));

    useWorkspace.getState().applyMergedResult();
    for (const withheld of shown.withheld) {
      expect(onPage(withheld), `the preview promised ${withheld} would not be written`).toBe(false);
    }
  });

  it("attributes only the prose it actually wrote", () => {
    clickTile(DISC_L45);
    mergeFormats([LS_STANDARD, WHOLE_SCREEN]);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    const prov = useWorkspace.getState().fieldProvenance.findings;

    expect(prov[normalizeForDedupe(contradicted)],
      "a withheld sentence must not stay attributed, or a later re-select claims prose that is not there")
      .toBeUndefined();
    expect(Object.values(prov).flat(), "the surviving merged normals keep their format attribution")
      .toEqual(expect.arrayContaining(["template-a"]));
  });

  it("keeps the withdrawal after save and reload", () => {
    clickTile(DISC_L45);
    mergeFormats([LS_STANDARD, WHOLE_SCREEN]);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    const s = useWorkspace.getState();
    const saved = JSON.parse(JSON.stringify(s.serializeObservationLedger()));
    openStudy(LS_STANDARD, "MRI LS Spine", "LS Spine", "MR");
    useWorkspace.getState().setEditorContent({
      findings: s.findingsText, impression: s.impressionText, recommendation: s.recommendationText,
      technique: s.techniqueText, clinicalHistory: s.clinicalHistoryText,
    });
    useWorkspace.getState().hydrateObservationLedger(saved);

    expect(onPage(contradicted)).toBe(false);
    expect(onPage(DISC_L45.sentence!)).toBe(true);
  });
});

describe("Ruling 3 · the doors read the click door's rule, not a new one", () => {
  const owner = (concept: string, level = "") => ({
    concept, level, laterality: "", anatomicalSection: "", baselineReplaces: "", ownText: "",
  });

  it("refuses to withdraw anything without a structured concept", () => {
    const normal = "L4-L5: No significant disc bulge or protrusion is seen.";
    expect(normalClaimSupersededBy(normal, { concept: null, level: "L4-L5", laterality: "", anatomicalSection: "", baselineReplaces: "" }))
      .toBe(false);
    // A concept that does not name this sentence gets the same answer: no keyword reading.
    expect(normalClaimSupersededBy(normal, owner("sacroiliac_joint", "L4-L5"))).toBe(false);
  });

  it("keeps a level-scoped finding inside its own level", () => {
    const ownerL45 = owner("disc_contour", "L4-L5");
    expect(normalClaimSupersededBy("L4-L5: No significant disc bulge or protrusion is seen.", ownerL45)).toBe(true);
    expect(normalClaimSupersededBy("L5-S1: No significant disc bulge or protrusion is seen.", ownerL45))
      .toBe(false);
  });

  it("never lets a second abnormality delete the first", () => {
    // The incident this fence exists for: "Cerebral edema" shares its word with a mass
    // lesion's own sentence, and must not retire it.
    const mass = "Brain parenchyma contains a right mass lesion with surrounding edema and mass effect.";
    expect(normalClaimSupersededBy(mass, owner("edema"))).toBe(false);
  });

  it("does not let a finding that is no longer on the page keep suppressing", () => {
    // Safeguard 6 in its negative form: suppression is a fact about the set of
    // observations that is ACTIVE. A row the report carries as stale audit context no
    // longer speaks for the report, so it must not be the reason a normal stays away.
    clickTile(DISC_L45);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    const rowsOfFormat = materializeFormatBaseline(LS_STANDARD, "LS Spine").map((p) => ({
      id: p.id, observation: p.observation, templates: p.templates,
      lastRendered: p.lastRendered, protected: p.protected,
    }));
    const deselected = rows().map((p) => (p.id === tileId(DISC_L45)
      ? { ...p, stale: true as const, lastRendered: { ...p.lastRendered, findings: "", impression: "" } }
      : p));
    expect(abnormalSlotOwners(deselected), "the finding is no longer a judge").toHaveLength(0);

    const result = withdrawSupersededNormals({
      incoming: LS_STANDARD.findings ?? "",
      baselineRows: rowsOfFormat,
      livePatches: deselected,
      assertsAbnormality: true,
    });

    expect(result.withheld).toHaveLength(0);
    expect(result.suspended).toHaveLength(0);
    expect(result.incoming, "the normal is written back, not suppressed").toContain(contradicted);
  });

  it("reports a contradicted normal it may not delete, instead of deleting or hiding it", () => {
    clickTile(DISC_L45);
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    expect(abnormalSlotOwners(rows()).map((o) => o.id), "the clicked finding is a structured owner")
      .toContain(tileId(DISC_L45));
    const rowsOfFormat = materializeFormatBaseline(LS_STANDARD, "LS Spine").map((p) => ({
      id: p.id,
      observation: p.observation,
      templates: p.templates,
      lastRendered: p.lastRendered,
      protected: p.protected,
    }));
    const curated = rowsOfFormat.map((r) => (
      r.observation?.concept === "disc_contour" && r.observation?.level === "L4-L5"
        ? { ...r, protected: true }
        : r
    ));

    const result = withdrawSupersededNormals({
      incoming: LS_STANDARD.findings ?? "",
      baselineRows: curated,
      livePatches: useWorkspace.getState().appliedPathologyPatches,
      assertsAbnormality: true,
    });

    expect(result.incoming, "curated wording is kept — this system never deletes it").toContain(contradicted);
    // P1-a, 20-case audit 2026-10-26 — the click door's declared contract now
    // also claims the per-level canal and foraminal normals at L4-L5 (the tile's
    // prose indents the thecal sac and narrows the foramina), and this door reads
    // the click door's rule, so those two UNCURATED rows are suspended — the
    // correct outcome, not a regression. The assertion that carries this
    // ruling's intent is about the CURATED row: its sentence is still on the
    // page, so IT must never be suspended — only named in `retained`.
    const suspendedKeys = result.suspended.map((r) => `${r.observation?.concept ?? "?"}@${r.observation?.level ?? "?"}`);
    expect(suspendedKeys, "the two rows the tile's declared claim owns are withdrawn").toEqual(
      expect.arrayContaining(["canal_stenosis@L4-L5", "foraminal_stenosis@L4-L5"]),
    );
    expect(suspendedKeys, "the curated row itself is never suspended").not.toContain("disc_contour@L4-L5");
    expect(result.retained.map((r) => r.sentence), "…but the contradiction is named").toContain(contradicted);

    const warnings = retainedNormalReviewWarnings([], result.retained);
    expect(warnings[0]!.hint, "in the banner vocabulary the canvas already renders").toBe(CONTRADICTED_NORMAL_RETAINED_HINT);
    expect(warnings[0]!.sentence).toContain("curated or hand-written");
    expect(warnings[0]!.token, "the slot at issue is named, not a vocabulary token").toContain("L4-L5");
  });

  it("never withdraws a sentence another live observation is standing behind", () => {
    // The Phase 5 eviction fence, on the same terms the click door applies it: a whole
    // report door may retire the scaffold's own normal, but not wording a still-selected
    // observation put on the page — that prose belongs to the observation, not to format.
    openStudy(BRAIN_SCREENING, "MRI Brain", "Brain", "MR");
    clickTile(LACUNES);
    const unit = (materializeFormatBaseline(BRAIN_SCREENING, "Brain")
      .flatMap((r) => splitToSentences(r.templates.findings ?? ""))
      .find((s) => /gross signal abnormality/i.test(s)) ?? "").trim();
    expect(unit, "the screening baseline must still carry the sentence this fence guards").not.toBe("");
    const dictated: AppliedPathologyPatch = {
      ...rowById(tileId(LACUNES)),
      id: "voice-screening-sentence",
      source: "voice",
      templates: { findings: unit, impression: "" },
      lastRendered: { findings: unit, impression: "" },
    };
    const rowsOfFormat = materializeFormatBaseline(BRAIN_SCREENING, "Brain").map((p) => ({
      id: p.id, observation: p.observation, templates: p.templates,
      lastRendered: p.lastRendered, protected: p.protected,
    }));

    const result = withdrawSupersededNormals({
      incoming: BRAIN_SCREENING.findings ?? "",
      baselineRows: rowsOfFormat,
      livePatches: [...rows(), dictated],
      assertsAbnormality: true,
    });

    expect(result.incoming, "the dictated sentence stays on the page").toContain(unit);
    expect(result.withheld, "…and is not counted as withdrawn").not.toContain(unit);
    expect(result.retained.map((r) => r.sentence), "…but the clash is named for review").toContain(unit);
    const warnings = retainedNormalReviewWarnings([], result.retained);
    expect(warnings.some((w) => w.sentence.includes("another live finding wrote it")),
      "with the reason the radiologist needs to act on").toBe(true);
  });

  it("does not warn about a contradicted normal the prose it writes never carried", () => {
    // The banner is for a clash on his screen. A slot this door does not write cannot
    // clash on it, so reporting it would be noise that trains him to dismiss the warning.
    clickTile(DISC_L45);
    const rowsOfFormat = materializeFormatBaseline(LS_STANDARD, "LS Spine").map((p) => ({
      id: p.id,
      observation: p.observation,
      templates: p.templates,
      lastRendered: p.lastRendered,
      protected: p.protected,
    }));

    const result = withdrawSupersededNormals({
      incoming: CERVICAL_STANDARD.findings ?? "",
      baselineRows: rowsOfFormat,
      livePatches: useWorkspace.getState().appliedPathologyPatches,
      assertsAbnormality: true,
    });

    expect(result.incoming).toBe(CERVICAL_STANDARD.findings ?? "");
    expect(result.withheld).toHaveLength(0);
    expect(result.suspended).toHaveLength(0);
    expect(result.retained).toHaveLength(0);
    expect(retainedNormalReviewWarnings([], result.retained)).toHaveLength(0);
  });

  it("withholds nothing when the report states no abnormality", () => {
    applyFullNormalFormat(LS_STANDARD);
    const result = withdrawSupersededNormals({
      incoming: LS_STANDARD.findings ?? "",
      baselineRows: materializeFormatBaseline(LS_STANDARD, "LS Spine"),
      livePatches: useWorkspace.getState().appliedPathologyPatches,
      assertsAbnormality: false,
    });
    expect(result.incoming).toBe(LS_STANDARD.findings ?? "");
    expect(result.withheld).toHaveLength(0);
    expect(result.retained).toHaveLength(0);
  });

  it("claims a retirement only on the observation that caused it", () => {
    const contradicted = baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5");
    const rows = materializeFormatBaseline(LS_STANDARD, "LS Spine");
    const withheld = {
      withheld: [contradicted],
      suspended: [{
        id: "baseline-l45", withdrawnBy: ["qs-a"], templates: { findings: contradicted },
        observation: rows[0]!.observation, stale: true as const,
        lastRendered: { findings: "", impression: "" },
      }],
    };
    const patches = [
      { id: "qs-a", replacedBaseline: { findings: [], impression: [] } },
      { id: "qs-b", replacedBaseline: { findings: [], impression: [] } },
      { id: "qs-stale", stale: true, replacedBaseline: { findings: [], impression: [] } },
    ];
    const claimed = claimRetiredBaselines(patches, withheld.suspended);
    expect(claimed.find((p) => p.id === "qs-a")!.replacedBaseline!.findings).toEqual([contradicted]);
    expect(claimed.find((p) => p.id === "qs-b")!.replacedBaseline!.findings, "an unrelated finding claims nothing").toEqual([]);
    expect(withheld.suspended[0]!.withdrawnBy).toEqual(["qs-a"]);
  });
});

describe("Ruling 3 · the doors this ruling found already correct stay correct", () => {
  beforeEach(() => openStudy(LS_STANDARD, "MRI LS Spine", "LS Spine", "MR"));

  it("the Quick Select click still withdraws exactly one level's normal", () => {
    applyFullNormalFormat(LS_STANDARD);
    clickTile(DISC_L45);
    expect(onPage(baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5"))).toBe(false);
    expect(onPage(baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L3-L4"))).toBe(true);
  });

  it("the automatic pass still withdraws it too", () => {
    applyFullNormalFormat(LS_STANDARD);
    clickTile(DISC_L45);
    useWorkspace.getState().composeInstantReport(
      buildReportingStudyContext({ modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto" }),
      false,
    );
    expect(onPage(baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L4-L5"))).toBe(false);
    expect(onPage(baselineSentence(LS_STANDARD, "LS Spine", "disc_contour", "L5-S1"))).toBe(true);
  });

  it("a merged pair with nothing to contradict still writes both formats", () => {
    mergeFormats([LS_NORMAL, WHOLE_SCREEN]);
    expect(findingsPage(), "the merge still merges").not.toBe("");
    expect(normalizeForDedupe(findingsPage()), "and no normal was withheld for a phantom finding")
      .toContain(normalizeForDedupe((LS_NORMAL.findings ?? "").split(/\r?\n/)[0]!.trim()));
  });
});

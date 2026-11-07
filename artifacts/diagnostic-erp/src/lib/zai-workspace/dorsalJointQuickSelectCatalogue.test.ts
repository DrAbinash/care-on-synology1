/**
 * dorsalJointQuickSelectCatalogue.test.ts — the three Quick Select catalogue gaps the
 * MRI usability audit left open on this branch, measured through the shipped code.
 *
 * Item #6 (P1) — "The Quick Select strip is empty on MRI Dorsal Spine."
 *   Measured over `DEFAULT_QUICK_SELECT_TILES` with the shipped `lookupTilesForContext`:
 *   Brain 29, Cervical Spine 39, LS Spine 27, Whole Spine 66, Dorso-Lumbar 27,
 *   Dorsal Spine 0, Thoracic Spine 0 (it canonicalises to "Dorsal Spine",
 *   `lib/report-quality/src/reportingRegion.ts:87`). `spineTileRegions`
 *   (`quick-select-library.ts:27-32`) already widens Whole Spine and Dorso-Lumbar
 *   studies onto a Dorsal set that no tile populated, so those two strips were
 *   promising a region they could not fill.
 *
 * Item #9 (P2) — an MR box whose shipped text carries a placeholder nothing can fill.
 *   Generalised here over the whole catalogue rather than pinned to one tile: a
 *   `{token}` must be declared in `properties` (else the strip offers no chip for it),
 *   a declared property must exist as a token (else the chip answers a question the
 *   box never asked), and no MR findings box may ship an unfilled `___` blank while
 *   declaring no picker at all.
 *
 * Item #10 (P2) — Knee / Shoulder / Pelvis held one box each against owned Standard
 *   Normals of 11, 9 and 9 rows, so those reports were clicked into from a normal the
 *   strip could barely contradict.
 *
 * Oracles, in the order the audit asked for them:
 *   - the strip: `lookupTilesForContext` over the shipped catalogue;
 *   - retirement: the real store — `generateProfessionalReport` opens the region's
 *     OWNED Standard Normal, one click goes through
 *     `applyPathologyOverlay(quickSelectTilePatch(...))`, and the sentences are read
 *     back with the product's own `splitToSentences`, exactly as
 *     `dorsalStandardNormalOwnership.test.ts` and `brainQuickSelectCatalogue.test.ts`
 *     do it. Nothing here re-implements `sentenceOwnedBySlot`
 *     (`observationSlot.ts:636`): the tile declares `baselineReplaces` and `concept`,
 *     the engine decides what that claims.
 *   - the `retire` / `keep` columns are authored from the clinical claim each box
 *     makes, not read out of the engine — a box names an abnormality, so the normal of
 *     that abnormality goes and the normals of anatomy it says nothing about stay.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_QUICK_SELECT_TILES,
  lookupTilesForContext,
  spineTileRegions,
} from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { quickSelectTilePatch } from "./quickSelectTileFixture";
import { useWorkspace } from "./store";
import type { QuickSelectTile } from "./types";
import { buildReportingStudyContext, canonicalContentRegion, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { splitToSentences } from "@/lib/reportFieldMerge";
import { MRI_DORSAL_STANDARD_NORMAL_MANIFEST } from "./baselines/mriDorsalStandardNormal";
import { MRI_KNEE_STANDARD_NORMAL_MANIFEST } from "./baselines/mriKneeStandardNormal";
import { MRI_SHOULDER_STANDARD_NORMAL_MANIFEST } from "./baselines/mriShoulderStandardNormal";
import { MRI_PELVIS_STANDARD_NORMAL_MANIFEST } from "./baselines/mriPelvisStandardNormal";
import {
  DX_ALIGN,
  DX_BONE,
  DX_CANAL,
  DX_DISC,
  DX_POSTERIOR,
  DX_SOFT,
} from "@/lib/mriDorsalLibrary";

// ─────────────────────────────────────────────────────────────────────────────
// the four examinations under audit, as the strip and the store see them
// ─────────────────────────────────────────────────────────────────────────────

function mrCtx(study: string, region: string): ReportingStudyContext {
  return buildReportingStudyContext({
    modality: "MR", studyDescription: study, regions: [region], source: "billed",
  });
}
const DORSAL = () => mrCtx("MRI DORSAL SPINE", "Dorsal Spine");
/** The booked tab for this examination is "Dorsal Spine"; "Thoracic Spine" is the
 *  other name the same study arrives under, and `canonicalContentRegion` folds it
 *  onto the booked one (`lib/report-quality/src/reportingRegion.ts:87`). */
const THORACIC = () => mrCtx("MRI THORACIC SPINE", canonicalContentRegion("Thoracic Spine"));
const THORACIC_RAW = () => mrCtx("MRI THORACIC SPINE", "Thoracic Spine");
const WHOLE_SPINE = () => mrCtx("MRI WHOLE SPINE", "Whole Spine");
const DORSO_LUMBAR = () => mrCtx("MRI DORSO-SPINE", "Dorso-Lumbar Spine");
const KNEE = () => mrCtx("MRI KNEE", "Knee");
const SHOULDER = () => mrCtx("MRI SHOULDER", "Shoulder");
const PELVIS = () => mrCtx("MRI PELVIS", "Pelvis");

const findingsBoxes = (ctx: ReportingStudyContext) =>
  lookupTilesForContext(DEFAULT_QUICK_SELECT_TILES, "findings", "MR", ctx);

/** The catalogue entries this file owns, by region. */
const tilesFor = (region: string) =>
  DEFAULT_QUICK_SELECT_TILES.filter(
    (t) => t.field === "findings" && t.scopeModality === "MR" && t.scopeBodyPart === region,
  );

function tile(label: string): QuickSelectTile {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

const lines = (t: string) => (t || "").split("\n").map((l) => l.trim()).filter(Boolean);
const reportText = () => useWorkspace.getState().findingsText;
const sentenceCount = (sentence: string) =>
  splitToSentences(reportText()).filter((s) => s.trim() === sentence.trim()).length;

/**
 * Open the study and let the store pick its normal, the way the desk does. The
 * premise every retirement claim below rests on, asserted rather than assumed: the
 * region's OWNED Standard Normal is what lands on the page.
 */
function openAndGenerate(ctx: ReportingStudyContext) {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [],
    isFinalized: false, isDirty: false,
  } as never);
  const result = useWorkspace.getState().generateProfessionalReport(ctx);
  if (result.status !== "generated") {
    throw new Error(`generate refused for ${ctx.region}: ${JSON.stringify(result)}`);
  }
  return result;
}

/** One click on a shipped box, through the production payload builder. */
function click(label: string, params: { side?: "left" | "right" | "bilateral"; level?: string } = {}) {
  return useWorkspace
    .getState()
    .applyPathologyOverlay(quickSelectTilePatch(tile(label), "findings", params));
}

const findingsRows = (
  manifest: typeof MRI_DORSAL_STANDARD_NORMAL_MANIFEST,
) => (manifest.observations ?? []).filter((o) => o.field === "findings");

// ─────────────────────────────────────────────────────────────────────────────
// item #6 — the dorsal strip
// ─────────────────────────────────────────────────────────────────────────────

describe("item #6 — MRI Dorsal Spine has a Quick Select strip", () => {
  it("the strip is non-empty on Dorsal Spine, and on the Thoracic name that canonicalises to it", () => {
    // The clinic books this examination under the "Dorsal Spine" tab; "Thoracic
    // Spine" is the other name the same study arrives under, and
    // `canonicalContentRegion` folds it onto the booked one
    // (`lib/report-quality/src/reportingRegion.ts:87`) — which is why the audit
    // measured the two as one empty region rather than two.
    expect(canonicalContentRegion("Thoracic Spine")).toBe("Dorsal Spine");
    const dorsal = findingsBoxes(DORSAL());
    const thoracic = findingsBoxes(THORACIC());
    console.log(`  dorsal strip boxes: ${dorsal.length}, thoracic-named: ${thoracic.length}`);
    // A floor, not a pin: the audit's complaint was zero, and a count pinned here
    // would read as coverage while a deleted section still passes at the old number.
    expect(dorsal.length).toBeGreaterThanOrEqual(12);
    expect(thoracic.length).toBe(dorsal.length);
    expect(thoracic.map((t) => t.label).sort()).toEqual(dorsal.map((t) => t.label).sort());
    // Measured, reported, deliberately not pinned: a study whose region reaches the
    // strip as the RAW alias gets nothing, because `lookupTilesForContext`
    // canonicalises the box's `scopeBodyPart` and reads `ctx.region` verbatim
    // (`quick-select-library.ts:49-50`). That asymmetry is the same one "C Spine" and
    // "L Spine" already live with; the one-line fix is in a file this catalogue's
    // owner does not hold, so it is left to be measured rather than asserted.
    console.log(`  raw alias region "Thoracic Spine" boxes: ${findingsBoxes(THORACIC_RAW()).length}`);
    // Every one of them is an MR box scoped to the dorsal region, not a cross-region
    // box that scored 10 and drifted in.
    for (const t of dorsal) {
      expect(t.scopeModality, `${t.label} is modality-scoped`).toBe("MR");
      expect(t.scopeBodyPart, `${t.label} is region-scoped`).toBe("Dorsal Spine");
      expect(t.category ?? "", `${t.label} states something abnormal`).not.toBe("normal");
    }
  });

  it("the spine widening in spineTileRegions now lands on a populated dorsal set", () => {
    // `spineTileRegions` promised a Dorsal set to Whole Spine and Dorso-Lumbar
    // studies while no tile populated it. The widening is unchanged; the catalogue
    // is what had to catch up.
    expect(spineTileRegions(WHOLE_SPINE())).toContain("Dorsal Spine");
    expect(spineTileRegions(DORSO_LUMBAR())).toContain("Dorsal Spine");
    const whole = findingsBoxes(WHOLE_SPINE());
    const dorsoLumbar = findingsBoxes(DORSO_LUMBAR());
    const dorsalLabels = new Set(tilesFor("Dorsal Spine").map((t) => t.label));
    const inWhole = whole.filter((t) => dorsalLabels.has(t.label)).length;
    const inDorsoLumbar = dorsoLumbar.filter((t) => dorsalLabels.has(t.label)).length;
    console.log(`  dorsal boxes visible on a whole-spine study: ${inWhole}, dorso-lumbar: ${inDorsoLumbar}`);
    expect(inWhole).toBeGreaterThanOrEqual(12);
    expect(inDorsoLumbar).toBeGreaterThanOrEqual(12);
    // The other spine strips the audit measured are not this change's business and
    // must not have moved.
    expect(findingsBoxes(mrCtx("MRI C SPINE", "Cervical Spine")).length).toBeGreaterThanOrEqual(39);
    expect(findingsBoxes(mrCtx("MRI LS SPINE", "LS Spine")).length).toBeGreaterThanOrEqual(27);
    expect(findingsBoxes(mrCtx("MRI BRAIN", "Brain")).length).toBeGreaterThanOrEqual(29);
  });

  it("every dorsal box names a baseline sentence the owned dorsal normal actually renders", () => {
    // A `baselineReplaces` the baseline does not render is a box that prints its
    // lesion BESIDE the normal it contradicts — the P0 this branch already closed
    // for three other examinations.
    const rendered = new Set(findingsRows(MRI_DORSAL_STANDARD_NORMAL_MANIFEST).map((o) => o.renderedText));
    expect(rendered.size).toBeGreaterThanOrEqual(10);
    const offenders: string[] = [];
    let declared = 0;
    for (const t of tilesFor("Dorsal Spine")) {
      if (!t.baselineReplaces) continue;
      declared++;
      if (!rendered.has(t.baselineReplaces)) {
        offenders.push(`${t.label} :: not rendered by the owned dorsal normal: ${t.baselineReplaces}`);
      }
    }
    expect(offenders).toEqual([]);
    // Non-vacuity: the dorsal catalogue is a retirement catalogue, not a set of
    // boxes that only add prose.
    expect(declared).toBeGreaterThanOrEqual(10);
  });

  it("clicking a dorsal box retires exactly the dorsal normal it falsifies and keeps the rest", () => {
    // retire / keep are authored from the clinical claim, column by column.
    // Keys resolve to the owned dorsal normal statements in `DORSAL_NORMALS` below.
    // Two columns are worth reading twice, because both are judgement calls and
    // neither was read off the engine:
    //   * "Burst fracture T12" keeps the `boneNoLesion` row. That row denies an acute
    //     COMPRESSION fracture, a focal lytic/sclerotic lesion and a marrow
    //     infiltrative process; a burst fracture is the library's own second entity
    //     (`mriDorsalLibrary.ts:80-81`, beside `acuteCompressionFracture` at :78-79),
    //     and the shipped cervical burst box claims exactly one vertebral-body normal
    //     the same way. If the clinic decides a burst fracture denies "no acute
    //     compression fracture" too, the fix belongs in that baseline row — one
    //     `baselineReplaces` per box cannot name two rows, and a joined target is a
    //     string no observation renders (C3-R10).
    //   * "Multifocal thoracic marrow lesions" names the marrow-signal sentence in
    //     `baselineReplaces` and reaches the focal-lesion row through its `concept`,
    //     which is the concept that row was authored with
    //     (`baselines/mriDorsalStandardNormal.ts:56-61`) — diffuse marrow replacement
    //     denies both, and a box may only name one sentence, so the second one has to
    //     be claimed the way the ownership engine claims it.
    const cases: Array<{ label: string; retire: string[]; keep: string[] }> = [
      { label: "Thoracic hyperkyphosis", retire: ["alignment"], keep: ["bone", "boneNoLesion", "disc", "discNoHerniation", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Loss of thoracic kyphosis", retire: ["alignment"], keep: ["bone", "boneNoLesion", "disc", "discNoHerniation", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Grade 1 spondylolisthesis T12-L1", retire: ["alignment"], keep: ["bone", "boneNoLesion", "disc", "discNoHerniation", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Compression fracture T12", retire: ["bone", "boneNoLesion"], keep: ["alignment", "disc", "canal", "cord", "foramina", "paraspinal"] },
      { label: "Burst fracture T12", retire: ["bone"], keep: ["alignment", "boneNoLesion", "disc", "canal", "cord", "paraspinal"] },
      { label: "Modic type 1 endplate changes T11-T12", retire: ["bone"], keep: ["alignment", "disc", "discNoHerniation", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Lytic lesion T8", retire: ["boneNoLesion"], keep: ["alignment", "disc", "discNoHerniation", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Multifocal thoracic marrow lesions", retire: ["bone", "boneNoLesion"], keep: ["alignment", "disc", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Central disc protrusion T8-T9", retire: ["discNoHerniation"], keep: ["alignment", "bone", "disc", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Diffuse disc bulge T11-T12", retire: ["discNoHerniation"], keep: ["alignment", "bone", "disc", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Disc desiccation T11-T12", retire: ["disc"], keep: ["alignment", "bone", "boneNoLesion", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Reduced disc height T11-T12", retire: ["disc"], keep: ["alignment", "bone", "boneNoLesion", "canal", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Mild central canal stenosis T8-T9", retire: ["canal"], keep: ["alignment", "bone", "disc", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Moderate central canal stenosis T8-T9", retire: ["canal"], keep: ["alignment", "bone", "disc", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Severe central canal stenosis T8-T9", retire: ["canal"], keep: ["alignment", "bone", "disc", "cord", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Ligamentum flavum hypertrophy T10-T11", retire: [], keep: ["alignment", "bone", "disc", "canal", "cord", "foramina", "paraspinal"] },
      { label: "Thoracic cord compression T8-T9", retire: ["cord"], keep: ["alignment", "bone", "disc", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Thoracic cord signal change", retire: ["cord"], keep: ["alignment", "bone", "disc", "canal", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Thoracic syrinx", retire: ["cord"], keep: ["alignment", "bone", "disc", "canal", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Thoracic intradural extramedullary lesion", retire: ["cord"], keep: ["alignment", "bone", "disc", "canal", "foramina", "posteriorElements", "paraspinal"] },
      { label: "Neural foraminal stenosis T11-T12", retire: ["foramina"], keep: ["alignment", "bone", "disc", "canal", "cord", "posteriorElements", "paraspinal"] },
      { label: "Costovertebral arthropathy T9-T10", retire: ["foramina"], keep: ["alignment", "bone", "disc", "canal", "cord", "posteriorElements", "paraspinal"] },
      { label: "Facet arthropathy T10-T11", retire: ["foramina"], keep: ["alignment", "bone", "disc", "canal", "cord", "posteriorElements", "paraspinal"] },
      { label: "Posterior element fracture T8", retire: ["posteriorElements"], keep: ["alignment", "bone", "disc", "canal", "cord", "foramina", "paraspinal"] },
      { label: "Thoracic epidural collection", retire: ["paraspinal"], keep: ["alignment", "bone", "disc", "canal", "cord", "foramina", "posteriorElements"] },
    ];

    const offenders: string[] = [];
    let exercised = 0;
    // A typo in a key below must read as a named defect, not as a TypeError deep in
    // the product's sentence splitter.
    for (const c of cases) {
      for (const key of [...c.retire, ...c.keep]) {
        expect(DORSAL_NORMALS[key], `unknown dorsal normal key "${key}" in the ${c.label} case`)
          .toBeTypeOf("string");
      }
    }
    for (const c of cases) {
      const t = DEFAULT_QUICK_SELECT_TILES.find((x) => x.label === c.label);
      if (!t) { offenders.push(`${c.label} is missing from the catalogue`); continue; }
      expect(t.scopeBodyPart, `${c.label} is not a dorsal box`).toBe("Dorsal Spine");
      openAndGenerate(DORSAL());
      expect(click(c.label), `${c.label} was not applied`).toBe("applied");
      exercised++;
      for (const key of c.retire) {
        for (const sentence of splitToSentences(DORSAL_NORMALS[key])) {
          if (sentenceCount(sentence) !== 0) {
            offenders.push(`${c.label} leaves the ${key} normal standing: ${sentence}`);
          }
        }
      }
      for (const key of c.keep) {
        for (const sentence of splitToSentences(DORSAL_NORMALS[key])) {
          if (sentenceCount(sentence) !== 1) {
            offenders.push(`${c.label} does not keep the ${key} normal it says nothing about (${sentenceCount(sentence)}x): ${sentence}`);
          }
        }
      }
      // The lesion itself must be on the page, or the click only deleted a normal.
      const written = splitToSentences(reportText());
      expect(
        written.some((s) => s.includes(t.sentence.slice(0, 24))),
        `${c.label} printed nothing of its own`,
      ).toBe(true);
    }
    expect(exercised, "the table below has to be exercised").toBeGreaterThanOrEqual(20);
    expect(offenders).toEqual([]);
  });

  it("no dorsal box invents advice — every recommendation is verbatim a shipped dorsal Report Format", () => {
    const offenders: string[] = [];
    for (const t of tilesFor("Dorsal Spine")) {
      if (!t.recommendationSentence) continue;
      const wanted = t.recommendationSentence.trim();
      const match = DEFAULT_REPORT_FORMATS.find(
        (f) => f.modality === "MR" && f.bodyPart === "Dorsal Spine"
          && (f.recommendation ?? "").trim() === wanted,
      );
      if (!match) offenders.push(`${t.label} :: ${wanted.slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });
});

// The ten canonical dorsal normal statements, imported from the library the owned
// baseline renders them from — never retyped (the same rule
// `dorsalStandardNormalOwnership.test.ts` states in its header).
const DORSAL_NORMALS: Record<string, string> = {
  alignment: DX_ALIGN.normal,
  bone: DX_BONE.normal,
  boneNoLesion: DX_BONE.noFocalLesion,
  disc: DX_DISC.normal,
  discNoHerniation: DX_DISC.noHerniation,
  canal: DX_CANAL.normal,
  cord: DX_CANAL.cordNormal,
  foramina: DX_POSTERIOR.normal,
  posteriorElements: DX_POSTERIOR.posteriorElementsIntact,
  paraspinal: DX_SOFT.normal,
};

// ─────────────────────────────────────────────────────────────────────────────
// item #9 — no box ships a placeholder nothing can fill
// ─────────────────────────────────────────────────────────────────────────────

/** Identifier-shaped `{token}` placeholders — the shape the contract resolves. */
function tokensIn(text: string): string[] {
  return [...new Set(
    [...text.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}/g)].map((m) => m[1]!.toLowerCase()),
  )];
}
const declaredProperties = (t: QuickSelectTile) =>
  new Set((t.properties ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
/** The three sentences one click commits together — the set the boundary scans. */
const writtenText = (t: QuickSelectTile) =>
  [t.sentence, t.impressionSentence ?? "", t.recommendationSentence ?? ""].join(" ");

describe("item #9 — every placeholder a box ships, the strip can answer", () => {
  it("the catalogue is big enough for these scans to mean something", () => {
    expect(DEFAULT_QUICK_SELECT_TILES.length).toBeGreaterThanOrEqual(137);
    const declaring = DEFAULT_QUICK_SELECT_TILES.filter((t) => declaredProperties(t).size > 0);
    expect(declaring.length).toBeGreaterThanOrEqual(40);
    expect(
      DEFAULT_QUICK_SELECT_TILES.some((t) => /_{2,}/.test(writtenText(t))),
      "the '___' blank rule below is vacuous if no box ships a blank",
    ).toBe(true);
  });

  it("no tile ships a {token} it does not declare in properties", () => {
    // General, over every field and every section — the shape the audit measured on
    // one Brain box. A `{side}` the strip was never told about reaches the report as
    // braces, or as a clause the boundary had to delete.
    const offenders: string[] = [];
    for (const t of DEFAULT_QUICK_SELECT_TILES) {
      const props = declaredProperties(t);
      for (const tok of tokensIn(writtenText(t))) {
        if (!props.has(tok)) offenders.push(`${t.label} :: ships {${tok}} and declares properties "${t.properties ?? ""}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no tile declares a property it never asks for", () => {
    const offenders: string[] = [];
    for (const t of DEFAULT_QUICK_SELECT_TILES) {
      const asked = new Set(tokensIn(writtenText(t)));
      for (const prop of declaredProperties(t)) {
        if (!asked.has(prop)) offenders.push(`${t.label} :: declares "${prop}" but no section carries {${prop}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no MR findings box ships an unfilled blank while declaring no picker", () => {
    // The audit's measurement of the "Glioma recurrence" box, stated as a rule:
    // a shipped `___` with no `properties` at all is a blank no chip, dialog or
    // laterality control can ever fill.
    const offenders: string[] = [];
    for (const t of DEFAULT_QUICK_SELECT_TILES) {
      if (t.scopeModality !== "MR" || t.field !== "findings") continue;
      if (!/_{2,}/.test(writtenText(t))) continue;
      if (declaredProperties(t).size === 0) {
        offenders.push(`${t.label} :: ships an unfilled blank and offers no picker`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the brain box the audit named states no side it was never given", () => {
    // Item #9's clinical complaint: the recurrence box hard-coded "right frontal
    // operculum" into every patient's report. A box that was never told the side must
    // not assert one — the same rule `quickSelectParameterSafety.hardening.test.ts`
    // enforces at the write boundary for `{side}`.
    const gr = tile("Glioma recurrence");
    expect(/___/.test(gr.sentence), "the recurrence box ships no unfillable blank").toBe(false);
    expect(gr.sentence).not.toMatch(/\b(right|left|bilateral)\b/i);
    expect(/\{side\}/.test(gr.sentence) === (declaredProperties(gr).has("side")),
      "a {side} and a side picker arrive together or not at all").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item #10 — knee / shoulder / pelvis strips against their owned normals
// ─────────────────────────────────────────────────────────────────────────────

describe("item #10 — the joint strips can contradict their owned normal", () => {
  it("each joint region has a catalogue that reaches past its single box", () => {
    const knee = findingsBoxes(KNEE());
    const shoulder = findingsBoxes(SHOULDER());
    const pelvis = findingsBoxes(PELVIS());
    console.log(`  joint strips — knee ${knee.length}, shoulder ${shoulder.length}, pelvis ${pelvis.length}`);
    expect(knee.length).toBeGreaterThanOrEqual(6);
    expect(shoulder.length).toBeGreaterThanOrEqual(3);
    expect(pelvis.length).toBeGreaterThanOrEqual(2);
  });

  it("every joint box names a sentence its own owned baseline renders", () => {
    const perRegion: Array<[string, typeof MRI_KNEE_STANDARD_NORMAL_MANIFEST]> = [
      ["Knee", MRI_KNEE_STANDARD_NORMAL_MANIFEST],
      ["Shoulder", MRI_SHOULDER_STANDARD_NORMAL_MANIFEST],
      ["Pelvis", MRI_PELVIS_STANDARD_NORMAL_MANIFEST],
    ];
    const offenders: string[] = [];
    let declared = 0;
    for (const [region, manifest] of perRegion) {
      const rendered = new Set(findingsRows(manifest).map((o) => o.renderedText));
      expect(rendered.size, `${region} has an owned baseline to retire from`).toBeGreaterThanOrEqual(9);
      for (const t of tilesFor(region)) {
        if (!t.baselineReplaces) continue;
        declared++;
        if (!rendered.has(t.baselineReplaces)) {
          offenders.push(`${region} / ${t.label} :: not rendered by the owned ${region.toLowerCase()} normal`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(declared).toBeGreaterThanOrEqual(12);
  });

  const jointCases: Array<{
    ctx: () => ReportingStudyContext;
    region: string;
    manifest: typeof MRI_KNEE_STANDARD_NORMAL_MANIFEST;
    cases: Array<{ label: string; retire: string[]; keep: string[]; params?: { side?: "left" | "right" | "bilateral" } }>;
  }> = [
    {
      ctx: KNEE, region: "Knee", manifest: MRI_KNEE_STANDARD_NORMAL_MANIFEST,
      cases: [
        { label: "ACL tear", retire: ["acl"], keep: ["meniscus-medial", "meniscus-lateral", "pcl", "mcl", "lcl", "articular-cartilage", "extensor-mechanism", "bone-marrow", "effusion"] },
        { label: "PCL tear", retire: ["pcl"], keep: ["acl", "meniscus-medial", "lcl", "articular-cartilage", "bone-marrow", "effusion"] },
        { label: "MCL tear", retire: ["mcl"], keep: ["acl", "pcl", "lcl", "meniscus-medial", "articular-cartilage", "effusion"] },
        { label: "LCL tear", retire: ["lcl"], keep: ["acl", "pcl", "mcl", "meniscus-lateral", "articular-cartilage", "effusion"] },
        // No medial / lateral meniscus cases: the two boxes were not shipped, because
        // a sentence naming "meniscus" asserts the generic `meniscus` concept and
        // prose-derived retirement then takes BOTH meniscal normals
        // (`observationSlot.ts:650-657`) — the lateral normal would go under a medial
        // tear. The generic "Meniscus tear" box retires both and means it.
        { label: "Knee cartilage defect", retire: ["articular-cartilage"], keep: ["acl", "pcl", "meniscus-medial", "bone-marrow", "extensor-mechanism"] },
        { label: "Knee marrow edema", retire: ["bone-marrow"], keep: ["acl", "pcl", "meniscus-medial", "articular-cartilage", "extensor-mechanism", "patellofemoral"] },
        { label: "Knee effusion", retire: ["effusion"], keep: ["acl", "pcl", "meniscus-medial", "articular-cartilage", "bone-marrow", "extensor-mechanism"] },
        { label: "Quadriceps tendon tear", retire: ["extensor-mechanism"], keep: ["acl", "pcl", "meniscus-medial", "articular-cartilage", "bone-marrow"] },
      ],
    },
    {
      ctx: SHOULDER, region: "Shoulder", manifest: MRI_SHOULDER_STANDARD_NORMAL_MANIFEST,
      cases: [
        { label: "Partial thickness rotator cuff tear", retire: ["rotator-cuff"], keep: ["labrum", "biceps", "ac-joint", "marrow", "acromion", "muscles", "soft-tissues"] },
        { label: "Glenohumeral effusion", retire: ["gh-joint"], keep: ["rotator-cuff", "labrum", "biceps", "ac-joint", "marrow", "muscles"] },
        { label: "Humeral head marrow edema", retire: ["marrow"], keep: ["rotator-cuff", "labrum", "biceps", "ac-joint", "muscles", "soft-tissues"] },
      ],
    },
    {
      ctx: PELVIS, region: "Pelvis", manifest: MRI_PELVIS_STANDARD_NORMAL_MANIFEST,
      cases: [
        { label: "Sacroiliitis", retire: ["sacroiliac"], keep: ["hip-left", "hip-right", "pelvic-bones", "symphysis", "viscera", "soft-tissues", "muscles", "lymph-nodes"] },
        { label: "Pelvic lytic lesion", retire: ["pelvic-bones"], keep: ["sacroiliac", "hip-left", "hip-right", "symphysis", "viscera", "lymph-nodes"] },
      ],
    },
  ];

  for (const group of jointCases) {
    it(`${group.region}: a click retires the owned normal it falsifies and keeps the ones it does not`, () => {
      const offenders: string[] = [];
      let exercised = 0;
      for (const c of group.cases) {
        const t = DEFAULT_QUICK_SELECT_TILES.find((x) => x.label === c.label);
        if (!t) { offenders.push(`${c.label} is missing from the catalogue`); continue; }
        expect(t.scopeBodyPart, `${c.label} is not a ${group.region} box`).toBe(group.region);
        openAndGenerate(group.ctx());
        // Premise: the owned standard normal really is what opened.
        for (const row of findingsRows(group.manifest)) {
          expect(
            splitToSentences(reportText()).some((s) => s.includes(row.renderedText.slice(0, 30))),
            `${group.region} normal did not open: ${row.renderedText.slice(0, 40)}`,
          ).toBe(true);
        }
        expect(click(c.label, c.params ?? {}), `${c.label} was not applied`).toBe("applied");
        exercised++;
        const rowText = (id: string) => findingsRows(group.manifest).find((o) => o.id === id)!.renderedText;
        for (const id of c.retire) {
          for (const sentence of splitToSentences(rowText(id))) {
            if (sentenceCount(sentence) !== 0) offenders.push(`${c.label} leaves the ${id} normal standing: ${sentence}`);
          }
        }
        for (const id of c.keep) {
          for (const sentence of splitToSentences(rowText(id))) {
            if (sentenceCount(sentence) !== 1) {
              offenders.push(`${c.label} does not keep the ${id} normal (${sentenceCount(sentence)}x): ${sentence}`);
            }
          }
        }
      }
      expect(exercised, `${group.region} cases have to run`).toBeGreaterThanOrEqual(2);
      expect(offenders).toEqual([]);
    });
  }

  it("no joint box invents advice", () => {
    const offenders: string[] = [];
    for (const region of ["Knee", "Shoulder", "Pelvis"]) {
      for (const t of tilesFor(region)) {
        if (!t.recommendationSentence) continue;
        const wanted = t.recommendationSentence.trim();
        const match = DEFAULT_REPORT_FORMATS.find(
          (f) => f.modality === "MR" && f.bodyPart === region
            && (f.recommendation ?? "").trim() === wanted,
        );
        if (!match) offenders.push(`${region} / ${t.label} :: ${wanted.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the pre-existing sided joint boxes still resolve through the strip's own control", () => {
    // These three boxes already ship `{side}`; the new joint boxes deliberately
    // state no side at all, because the examined side is study-level context
    // (`baselines/mriKneeStandardNormal.ts:12-13`, `mriShoulderStandardNormal.ts:5-8`).
    openAndGenerate(KNEE());
    expect(click("Meniscus tear", { side: "left" })).toBe("applied");
    expect(lines(reportText()).some((l) => l.includes("Oblique tear of the left meniscus"))).toBe(true);
    openAndGenerate(SHOULDER());
    expect(click("Rotator cuff tear", { side: "right" })).toBe("applied");
    openAndGenerate(PELVIS());
    expect(click("Hip effusion", { side: "left" })).toBe("applied");
    expect(splitToSentences(reportText()).some((s) => s.includes("Left hip joint"))).toBe(false);
  });
});

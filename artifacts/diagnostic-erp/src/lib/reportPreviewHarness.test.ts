/**
 * Report preview harness — renders real reports with no server, no database and
 * no deploy, so report wording and layout can be READ BEFORE anything ships.
 *
 * Every artefact is produced by the same code the clinic uses: the pathology
 * overlay that a Quick Select click runs through, the print body builder, the
 * shared presentation template, and the letter-pad jsPDF generator. Nothing is
 * re-implemented here, which is the only way the output is worth trusting.
 *
 * Run: npx vitest run artifacts/diagnostic-erp/src/lib/reportPreviewHarness.test.ts
 * Output: tmp/report-preview/ (gitignored) — open index.html
 *
 * Cases are watermarked PREVIEW and stamped DRAFT: a preview must never be
 * mistakable for a report, including by whoever finds the printed page.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRINT_SETTINGS,
  generateReportPDF,
  type PrintClinic,
  type ReportData,
} from "./reportPdfGenerator";
import { buildLivePrintBodyHtml } from "./radiologyReportPrintLiveMerge";
import { buildPreviewHtml } from "./radiologyReportPreviewHtml";
import { applyPathologyPatch, type ReportNarrative } from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";
import { parseFindingsDocument } from "./findingsDocument";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { MRI_BRAIN_STANDARD_NORMAL_NAME } from "./zai-workspace/baselines/mriBrainStandardNormal";
import { MRI_LS_SPINE_STANDARD_NORMAL_NAME } from "./zai-workspace/fullReportBaseline";
import { MRI_CERVICAL_STANDARD_NORMAL_NAME } from "./zai-workspace/baselines/mriCervicalStandardNormal";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-tiles.data";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTileFixture";
import { useWorkspace } from "./zai-workspace/store";
import {
  mergeStructuredNormalFormats,
  type StructuredNormalRow,
} from "./zai-workspace/structuredNormalFormats";
import { billedStudyContextForNormal, resolveNormalBootstrapFormat } from "./zai-workspace/normalBootstrap";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  defaultScreeningState,
  screeningLedgerBundles,
} from "@/lib/mriSpineScreening";
import { SCREENING_SCHEMAS } from "@/lib/mriSpineScreeningSchemas";
import { resolveScreeningRoles } from "@/lib/mriSpineScreeningRoles";
import {
  renderReportDocument,
  resolvePresentationTemplate,
  type ReportDocumentModel,
  type ReportKeyImageModel,
} from "../../../api-server/src/lib/reportPresentation";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../../..");
const OUT = join(REPO_ROOT, "tmp/report-preview");

const CLINIC: PrintClinic = {
  name: "CARE DIAGNOSTICS",
  tagline: "PREVIEW HEADER — real values come from Settings",
  address: "PREVIEW",
  phone: "",
};

/** The sub-headed spine document shipped in PR #818, read from the preset that
 *  seeds the database. The route file imports the DB, so the text is taken from
 *  source rather than by importing it. CRLF in a source literal would put \r
 *  into the stored body, so it is stripped exactly as the sync now does. */
function presetDefaultFindings(templateName: string): string {
  const src = readFileSync(
    join(REPO_ROOT, "artifacts/api-server/src/routes/structuredReportTemplates.ts"),
    "utf8",
  );
  const from = src.slice(src.indexOf(`"${templateName}"`));
  const m = from.match(/defaultFindings:\s*`([\s\S]*?)`,/);
  if (!m) throw new Error(`${templateName} declares defaultFindings as a document`);
  return m[1].replace(/\r\n/g, "\n");
}

function formatByName(name: string): ReportNarrative & { reportTitle: string } {
  const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === name);
  if (!f) throw new Error(`Full Report Format "${name}" is missing from the library`);
  return {
    clinicalHistory: f.clinicalHistory ?? "",
    technique: f.technique ?? "",
    findings: f.findings ?? "",
    impression: f.impression ?? "",
    recommendation: f.recommendation ?? "",
    reportTitle: f.reportTitle ?? name,
  };
}

function tileByLabel(label: string) {
  const t = DEFAULT_QUICK_SELECT_TILES.find((x) => x.label === label);
  if (!t) throw new Error(`Quick Select tile "${label}" is missing from the catalog`);
  return t;
}

/** One Quick Select click, through the engine the button itself uses. */
function applyTile(base: ReportNarrative, label: string, side: "left" | "right" = "right") {
  const t = tileByLabel(label);
  const fill = (s?: string) => (s ?? "").replaceAll("{side}", side);
  const result = applyPathologyPatch({
    existing: base,
    incoming: {
      findings: fill(t.sentence),
      impression: fill(t.impressionSentence),
      recommendation: fill(t.recommendationSentence),
    },
    ownership: {
      anatomicalSection: t.anatomicalSection,
      conflictGroup: t.conflictGroup,
      baselineReplaces: t.baselineReplaces,
      concept: t.concept ?? null,
    },
    provenance: {
      findings: provenanceFromText(base.findings, "template"),
      impression: provenanceFromText(base.impression, "template"),
      recommendation: provenanceFromText(base.recommendation, "template"),
    },
    source: "quick-select",
  });
  return { narrative: result.narrative, replaced: result.replacedSentences };
}

type Case = {
  key: string;
  title: string;
  note: string;
  study: { modality: string; bodyPart: string; title: string };
  narrative: ReportNarrative;
  replaced?: string[];
  /**
   * Selected key images, in the shape the print route carries them. The harness
   * passed no images at all until now, which meant the one part of a radiology
   * report a referring doctor most wants — the pictures — had no paper test:
   * nothing here could notice a rail that reserved space for an image that never
   * arrived, or a 4:3 slice squeezed into a square cell.
   */
  images?: ReportKeyImageModel[];
};

/**
 * Flat-colour PNGs generated for this file (96×72 and 64×64 — a 4:3 acquisition
 * slice and a square one, so aspect handling is measurable rather than assumed).
 * No patient data: a coloured rectangle is the whole content.
 */
const PNG_4_3 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABICAIAAACGBWc0AAAAhUlEQVR4nO3QQQ0AIBDAsJODCJTgXwgO+LJHkwlYOmsfPZrvB/EAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIU7gItxwstLBsV7wAAAABJRU5ErkJggg==";
const PNG_SQUARE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PQQ0AIBDAsBOBHN74l4QIHg3JkgnoZp39dcMFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjx2AfFqYIiflPWrAAAAAElFTkSuQmCC";

/** Heading lines currently in the findings text — the structure a click must survive. */
function headingCount(findings: string): number {
  return parseFindingsDocument(findings).filter((b) => b.kind === "heading").length;
}

const BRAIN_NORMAL = formatByName(MRI_BRAIN_STANDARD_NORMAL_NAME);
const LS_NORMAL = formatByName(MRI_LS_SPINE_STANDARD_NORMAL_NAME);
const brainInfarct = applyTile(BRAIN_NORMAL, "Acute infarct (DWI)", "right");
const brainFazekas = applyTile(BRAIN_NORMAL, "Fazekas 1");
const spineDoc = {
  clinicalHistory: "Low back pain with right leg radiculopathy.",
  technique: "MRI lumbo-sacral spine on 3T. Sagittal T1W, T2W and STIR; axial T1W and T2W at disc levels.",
  findings: presetDefaultFindings("MRI LS Spine"),
  impression: "Normal MRI lumbo-sacral spine.",
  recommendation: "Clinical correlation.",
};
const CERVICAL_NORMAL = formatByName(MRI_CERVICAL_STANDARD_NORMAL_NAME);
/**
 * A click through the STORE rather than the sentence-level overlay, because the
 * observation ledger is what retires the scaffold's own Conclusion line.
 * `applyTile` above drives the pathology overlay only: faithful for the Findings
 * body, but on the cervical page it left "No significant disc, canal, foraminal
 * or cord compressive abnormality." printed standing above "Disc herniation at
 * C5-C6." — a report answering itself, which the editor never shows because the
 * ledger drops the normal's impression row. Measured 2026-10-11, so this case
 * renders what the radiologist actually gets.
 */
function seedStudy(region: string) {
  const ctx = buildReportingStudyContext({
    modality: "MR", studyDescription: `MRI ${region}`, regions: [region], source: "auto",
  });
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [], confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false, isFinalized: false, isDirty: false,
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [],
  });
  useWorkspace.getState().generateProfessionalReport(ctx);
  return ctx;
}

/** What the page says now, and every baseline sentence the ledger claims retired. */
function readStoreCase() {
  const st = useWorkspace.getState();
  return {
    narrative: {
      clinicalHistory: st.clinicalHistoryText,
      technique: st.techniqueText,
      findings: st.findingsText,
      impression: st.impressionText,
      recommendation: st.recommendationText,
    },
    replaced: [...new Set(st.appliedPathologyPatches.flatMap((patch) => patch.replacedBaseline?.findings ?? []))],
  };
}

function clickInStore(label: string) {
  const tile = tileByLabel(label);
  const side = /\{side\}/i.test(tile.sentence) ? ("right" as const) : undefined;
  const outcome = useWorkspace
    .getState()
    .applyPathologyOverlay(quickSelectTilePatch(tile, "findings", side ? { side } : {}));
  if (outcome !== "applied") throw new Error(`store click refused ${label}: ${outcome}`);
}

function storeClick(region: string, label: string) {
  seedStudy(region);
  clickInStore(label);
  return readStoreCase();
}

/**
 * The whole-report doors (#174). `storeClick` stops at the click; these continue through
 * the picker the radiologist actually uses, because it was the door — not the click —
 * that wrote the retired normal back onto the page and onto the paper.
 */
function applyFormatInStore(name: string) {
  const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === name);
  if (!format) throw new Error(`no report format named ${name}`);
  useWorkspace.getState().toggleFormatSelection(format.id);
  useWorkspace.getState().applySelectedFormats();
  if (useWorkspace.getState().confirmOverwriteOpen) useWorkspace.getState().confirmOverwriteAndApply();
}

function mergeFormatsInStore(names: string[]) {
  for (const name of names) {
    const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === name);
    if (!format) throw new Error(`no report format named ${name}`);
    useWorkspace.getState().toggleFormatSelection(format.id);
  }
  useWorkspace.getState().applySelectedFormats();
  if (useWorkspace.getState().confirmOverwriteOpen) useWorkspace.getState().confirmOverwriteAndApply();
  if (!useWorkspace.getState().lastMergeResult) throw new Error(`merging ${names.join(" + ")} armed no preview`);
  useWorkspace.getState().applyMergedResult();
}

const cervicalHerniation = storeClick("Cervical Spine", "Disc herniation C5-C6");
const cervicalCord = storeClick("Cervical Spine", "Cord compression C5-C6");

const brainHemorrhage = storeClick("Brain", "Basal ganglia hemorrhage");
const brainMass = storeClick("Brain", "Mass lesion");
const brainChronicInfarct = storeClick("Brain", "Chronic infarct");
const brainSmallVessel = (() => {
  const first = storeClick("Brain", "Fazekas 2");
  const tile = tileByLabel("Lacunar infarcts");
  const outcome = useWorkspace
    .getState()
    .applyPathologyOverlay(quickSelectTilePatch(tile, "findings", {}));
  if (outcome !== "applied") throw new Error(`store click refused Lacunar infarcts: ${outcome}`);
  const st = useWorkspace.getState();
  return {
    narrative: {
      clinicalHistory: st.clinicalHistoryText,
      technique: st.techniqueText,
      findings: st.findingsText,
      impression: st.impressionText,
      recommendation: st.recommendationText,
    },
    replaced: st.appliedPathologyPatches.flatMap((patch) => patch.replacedBaseline?.findings ?? []),
  };
})();

const spineHerniation = applyTile(spineDoc, "Disc herniation L4-L5");
const spineCanal = applyTile(spineDoc, "Mild canal stenosis L4-L5");

/**
 * A whole-spine SCREENING study with one dorsal abnormality recorded in the
 * screening panel — the workflow the panel exists for, read out of the real
 * store rather than written by hand.
 *
 * It is in this harness because of what the store used to produce: the panel
 * writes its one limitation sentence as its own ledger row, and until that row
 * declared what it owns, the sentence it deleted was every scaffold normal that
 * happened to contain the word "screening" — 13 of the 16 findings rows of this
 * very examination. The printed page is the only place that mistake was readable.
 */
const wholeSpineScreeningAbnormal = (() => {
  const ctx = buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI WHOLE SPINE SCREENING",
    regions: ["Whole Spine"],
    source: "auto",
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
  const generated = useWorkspace.getState().generateProfessionalReport(ctx);
  if (generated.status !== "generated") {
    throw new Error(`whole-spine screening refused: ${JSON.stringify(generated)}`);
  }
  useWorkspace.getState().replaceScreeningRoles(
    resolveScreeningRoles({ name: "MRI WHOLE SPINE SCREENING" }).roles,
  );
  useWorkspace.getState().setScreeningRegion("dorsal", {
    selections: { bodies_marrow: [{ optionId: "compression_deformity" }] },
  });
  // The panel's own ledger plan, applied through the panel's own two calls.
  const ws = useWorkspace.getState();
  const plan = screeningLedgerBundles({
    state: ws.screening,
    schemas: SCREENING_SCHEMAS,
    sequences: ws.sequencesAvailable,
    numbering: ws.lumbarNumbering,
    ledgerRegion: "Whole Spine",
  });
  for (const bundle of plan) {
    const outcome = useWorkspace.getState().applyMacroBundle({
      bundleId: bundle.bundleId, observations: bundle.observations,
    });
    if (outcome !== "applied") throw new Error(`screening bundle ${bundle.bundleId} -> ${outcome}`);
  }
  useWorkspace.getState().refreshImpressionFromLedger({ excludeBaselineObservations: true });
  const st = useWorkspace.getState();
  return {
    narrative: {
      clinicalHistory: st.clinicalHistoryText,
      technique: st.techniqueText,
      findings: st.findingsText,
      impression: st.impressionText,
      recommendation: st.recommendationText,
    },
    replaced: st.appliedPathologyPatches.flatMap((patch) => patch.replacedBaseline?.findings ?? []),
  };
})();

/** What the auto-open bootstrap actually chooses once the Templates row is in
 *  the library — the report the radiologist sees before touching anything. */
const autoOpenedLs = (() => {
  const rows: StructuredNormalRow[] = [{
    id: 71,
    templateName: "MRI LS Spine",
    modality: "MRI",
    bodyPart: "SPINE_LS",
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "MRI Lumbo-sacral Spine: T1W and T2W sagittal, T2W axial at disc levels.",
      recommendation: "Clinical correlation.",
      findingsItems: [],
    }),
    defaultFindings: presetDefaultFindings("MRI LS Spine"),
    defaultImpression: "Normal MRI lumbo-sacral spine.",
    isActive: true,
    isDefault: true,
  }];
  const formats = mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, rows);
  const decision = resolveNormalBootstrapFormat({
    ctx: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
    }),
    formats,
  });
  if (decision?.status !== "apply") throw new Error(`auto-open did not resolve: ${JSON.stringify(decision)}`);
  return decision.format;
})();

/**
 * A brain MRI the booking system describes as plain "MR BRAIN" and the desk bills
 * with contrast. The Technique section is a clinical claim about what was acquired,
 * so choosing the plain normal here would sign out sequences that never ran — the
 * defect #827 removes, rendered as the two pages it used to be able to produce.
 */
const BRAIN_DICOM_ONLY = buildReportingStudyContext({
  modality: "MR", studyDescription: "MR BRAIN", regions: ["Brain"], source: "auto",
});
const brainContrastAuto = (() => {
  const decision = resolveNormalBootstrapFormat({
    ctx: billedStudyContextForNormal(BRAIN_DICOM_ONLY, "MRI Brain with contrast"),
    formats: DEFAULT_REPORT_FORMATS,
  });
  if (decision?.status !== "apply") throw new Error(`contrast brain normal did not auto-open: ${JSON.stringify(decision)}`);
  return decision.format;
})();
const brainPlainAuto = (() => {
  const decision = resolveNormalBootstrapFormat({
    ctx: BRAIN_DICOM_ONLY,
    formats: DEFAULT_REPORT_FORMATS,
  });
  if (decision?.status !== "apply") throw new Error(`plain brain normal did not resolve: ${JSON.stringify(decision)}`);
  return decision.format;
})();

/**
 * Ruling #174 — the two whole-report doors opened over a finding that contradicts them.
 *
 * The click has always retired the level's own normal. Applying the Full Normal Format,
 * or merging a pair that carries it, re-materialised that normal as prose — and at the
 * merge door as prose with no ledger row, which is why it also survived save/reload. Both
 * cases are in this harness because the paper is where the contradiction was readable: a
 * Findings section that says the L4-L5 disc is normal three lines under a clicked L4-L5
 * herniation.
 */
const lsFormatDoorOverClick = (() => {
  seedStudy("LS Spine");
  clickInStore("Disc herniation L4-L5");
  applyFormatInStore(MRI_LS_SPINE_STANDARD_NORMAL_NAME);
  return readStoreCase();
})();

const lsMergeDoorOverClick = (() => {
  seedStudy("LS Spine");
  clickInStore("Disc herniation L4-L5");
  mergeFormatsInStore([MRI_LS_SPINE_STANDARD_NORMAL_NAME, "MRI Whole Spine — Screening"]);
  return readStoreCase();
})();

/**
 * A genuinely long dictation — twelve organ blocks, each a heading and three
 * sentences — built rather than typed so its length is a property of the case,
 * not of how much I felt like writing. Pagination is what this fixture is for.
 */
const LONG_ORGANS = [
  "Lungs", "Pleura", "Mediastinum", "Heart", "Liver", "Gallbladder", "Pancreas",
  "Spleen", "Kidneys", "Bowel", "Peritoneum", "Bones",
];
const LONG_REPORT_FINDINGS = LONG_ORGANS.map((organ) =>
  `${organ}: No new lesion is identified in this compartment on today's study. `
  + `The appearance is unchanged from the previous examination two months ago. `
  + `No additional abnormality is demonstrated within the ${organ.toLowerCase()}.`,
).join("\n");

const CASES: Case[] = [
  {
    key: "1-brain-normal", title: "MRI Brain — Normal (one click)",
    note: "Exactly what Quick Normal puts on the page today.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (PLAIN)" }, narrative: BRAIN_NORMAL,
  },
  {
    key: "2-brain-infarct", title: "…then the Acute infarct (DWI) box is clicked",
    note: "The normal sentence it contradicts must go; the infarct sentence must land.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (PLAIN)" },
    narrative: brainInfarct.narrative, replaced: brainInfarct.replaced,
  },
  {
    key: "3-brain-fazekas", title: "…then the Fazekas 1 box is clicked",
    note: "White-matter wording changes; Impression updates with it.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (PLAIN)" },
    narrative: brainFazekas.narrative, replaced: brainFazekas.replaced,
  },
  {
    key: "4-spine-normal-quicknormal", title: "MRI LS Spine — Normal (one click, today)",
    note: "What Quick Normal applies now: one line per structure, no sub-headings.",
    study: { modality: "MRI", bodyPart: "LS Spine", title: "MRI LUMBOSACRAL SPINE" }, narrative: LS_NORMAL,
  },
  {
    key: "5-spine-subheaded", title: "MRI LS Spine — the sub-headed format (merged last night)",
    note: "What the Report Templates screen holds after PR #818.",
    study: { modality: "MRI", bodyPart: "LS Spine", title: "MRI LUMBOSACRAL SPINE" }, narrative: spineDoc,
  },
  {
    key: "6-spine-subheaded-click", title: "…then the Disc herniation L4-L5 box is clicked",
    note: "The case to read carefully: does the structure survive a click?",
    study: { modality: "MRI", bodyPart: "LS Spine", title: "MRI LUMBOSACRAL SPINE" },
    narrative: spineHerniation.narrative, replaced: spineHerniation.replaced,
  },
  {
    key: "7-spine-canal-click", title: "…then the Mild canal stenosis L4-L5 box is clicked",
    note: "The normal document must not keep denying what the box just asserted.",
    study: { modality: "MRI", bodyPart: "LS Spine", title: "MRI LUMBOSACRAL SPINE" },
    narrative: spineCanal.narrative, replaced: spineCanal.replaced,
  },
  {
    key: "8-spine-auto-open", title: "MRI LS Spine — what auto-opens now",
    note: "The Normal Format the Templates screen holds, chosen by the bootstrap: sub-headings and the canal table, in one click.",
    study: { modality: "MRI", bodyPart: "LS Spine", title: "MRI LUMBOSACRAL SPINE" },
    narrative: {
      clinicalHistory: "Low back pain with right leg radiculopathy.",
      technique: autoOpenedLs.technique,
      findings: autoOpenedLs.findings,
      impression: autoOpenedLs.impression,
      recommendation: autoOpenedLs.recommendation,
    },
  },
  {
    key: "9-brain-contrast-billed", title: "MRI Brain — what auto-opens when the desk billed contrast",
    note: "Booked in DICOM as plain “MR BRAIN”, billed “MRI Brain with contrast”. The technique must name the contrast sequence and the agent.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (CONTRAST)" },
    narrative: {
      clinicalHistory: "Headache. Rule space-occupying lesion.",
      technique: brainContrastAuto.technique,
      findings: brainContrastAuto.findings,
      impression: brainContrastAuto.impression,
      recommendation: brainContrastAuto.recommendation,
    },
  },
  {
    key: "11-cervical-normal", title: "MRI Cervical Spine — Normal (one click)",
    note: "Six disc levels described, C2-C3 through C7-T1 — the same six the canvas draws and the canal table measures. Paired with the cord-compression click below, which is the case that used to be unwritable here: abnormalEmphasis.ts had no `compress` cue, so the one line that must shout on the page printed in plain type and the harness would have had to assert a presentation defect. It ships corrected, in the same PR as the tiles that needed it.",
    study: { modality: "MRI", bodyPart: "Cervical Spine", title: "MRI CERVICAL SPINE" }, narrative: CERVICAL_NORMAL,
  },
  {
    key: "12-cervical-herniation-click", title: "…then the Disc herniation C5-C6 box is clicked",
    note: "The level's own disc normal must go; the other five levels must keep theirs, and the canal/foraminal normals stay because nothing was clicked for them.",
    study: { modality: "MRI", bodyPart: "Cervical Spine", title: "MRI CERVICAL SPINE" },
    narrative: cervicalHerniation.narrative, replaced: cervicalHerniation.replaced,
  },
  {
    key: "13-cervical-cord-click", title: "…then the Cord compression C5-C6 box is clicked",
    note: "The critical case: the cord sentence has to reach the paper in bold, and the normals it contradicts have to be the ones it owns — the study-wide cord denial and the C5-C6 canal row it names — while the disc-contour row beside them stays.",
    study: { modality: "MRI", bodyPart: "Cervical Spine", title: "MRI CERVICAL SPINE" },
    narrative: cervicalCord.narrative, replaced: cervicalCord.replaced,
  },
  {
    key: "14-brain-hemorrhage", title: "MRI Brain — Basal ganglia hemorrhage (critical)",
    note: "A critical hemorrhage click: the normal hemorrhage denial must retire, the impression must name the hemorrhage, and the printed page must bold the finding.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (PLAIN)" },
    narrative: brainHemorrhage.narrative, replaced: brainHemorrhage.replaced,
  },
  {
    key: "15-brain-mass", title: "MRI Brain — Mass lesion with edema (critical)",
    note: "Mass effect carries its own concept and retires the parenchyma normal; the impression must name the mass without importing advice from another box.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (PLAIN)" },
    narrative: brainMass.narrative, replaced: brainMass.replaced,
  },
  {
    key: "16-brain-small-vessel", title: "MRI Brain — Fazekas 2 + Lacunar infarcts (two clicks)",
    note: "Two small-vessel disease boxes on one report: both findings must coexist in the findings text, both impressions must appear, and neither may retire the other.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (PLAIN)" },
    narrative: brainSmallVessel.narrative, replaced: brainSmallVessel.replaced,
  },
  {
    key: "17-brain-chronic-infarct", title: "MRI Brain — Chronic infarct (encephalomalacia)",
    note: "The staging case: an old infarct retires the acute-infarct denial and nothing else. The DWI/ADC negative is the fact that makes the case chronic, so it has to reach the paper — and the page must not carry the acute pathway's stroke-team advice.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (PLAIN)" },
    narrative: brainChronicInfarct.narrative, replaced: brainChronicInfarct.replaced,
  },
  {
    key: "10-brain-plain-by-dicom", title: "…and the page that study used to open as",
    note: "Read only to compare with the case above: same study, format chosen from the DICOM header alone. This is what #827 removed.",
    study: { modality: "MRI", bodyPart: "Brain", title: "MRI BRAIN (PLAIN)" },
    narrative: {
      clinicalHistory: "Headache. Rule space-occupying lesion.",
      technique: brainPlainAuto.technique,
      findings: brainPlainAuto.findings,
      impression: brainPlainAuto.impression,
      recommendation: brainPlainAuto.recommendation,
    },
  },
  {
    key: "18-whole-spine-screening", title: "MRI Whole Spine Screening — one dorsal abnormality",
    note: "The screening page: every region's screening normal must still be on the paper, the dorsal finding must be added, and the limitation line must appear once.",
    study: { modality: "MRI", bodyPart: "Whole Spine", title: "MRI WHOLE SPINE SCREENING" },
    narrative: wholeSpineScreeningAbnormal.narrative, replaced: wholeSpineScreeningAbnormal.replaced,
  },
  {
    key: "19-ls-format-door-over-click",
    title: "MRI LS Spine — the Full Normal Format applied over a clicked herniation",
    note: "Ruling #174 on paper. The box retired the L4-L5 disc normal; re-applying the format used to write it back both as prose and as a live ledger row, so the printed Findings declared that disc normal three lines under the herniation. The four levels nobody clicked must keep theirs.",
    study: { modality: "MRI", bodyPart: "LS Spine", title: "MRI LUMBOSACRAL SPINE" },
    narrative: lsFormatDoorOverClick.narrative, replaced: lsFormatDoorOverClick.replaced,
  },
  {
    key: "20-ls-merge-door-over-click",
    title: "MRI LS Spine — two formats merged over the same clicked herniation",
    note: "The second door, and the worse one: the merged pair's normal arrived as prose owning no ledger row, which is why it also survived save/reload. Same expectation — the contradicted level's normal never reaches the paper, the uncontested levels keep theirs, and the Impression says the herniation and not the normal.",
    study: { modality: "MRI", bodyPart: "LS Spine", title: "MRI LUMBOSACRAL SPINE" },
    narrative: lsMergeDoorOverClick.narrative, replaced: lsMergeDoorOverClick.replaced,
  },
  {
    key: "21-ct-abdomen-plain",
    title: "CT Abdomen — plain, organ-by-organ",
    note: "A non-MR modality on paper. Every case before this was MRI, so the print layout of a CT — "
      + "a longer examination title, no sequence list, and a parenchymal-organ Findings block — had never "
      + "been measured for clipping, page count or section order.",
    study: { modality: "CT", bodyPart: "Abdomen (CT)", title: "CT ABDOMEN (PLAIN)" },
    narrative: {
      clinicalHistory: "Epigastric pain with weight loss.",
      technique: "CT abdomen performed without intravenous contrast in axial acquisition.",
      findings: "Liver: Normal in size and contour. No focal hepatic lesion is seen.\n"
        + "Gallbladder and biliary tree: No radiopaque calculus. No intra- or extra-hepatic biliary dilatation.\n"
        + "Pancreas: Normal in bulk and attenuation. No peripancreatic collection.\n"
        + "Spleen: Normal in size. No splenic lesion.\n"
        + "Kidneys and ureters: Both kidneys are normal in size, shape and position. No calculus or hydronephrosis.\n"
        + "Bowel and mesentery: Bowel loops are normal in caliber. No obstructive pattern.\n"
        + "Retroperitoneum and pelvis: No enlarged lymph node. No free fluid.\n"
        + "Bones: Degenerative changes are seen at the lower lumbar spine.",
      impression: "CT abdomen study shows no acute abnormality.\nDegenerative changes at the lower lumbar spine.",
      recommendation: "Clinical correlation.",
    },
  },
  {
    key: "22-usg-whole-abdomen",
    title: "USG Whole Abdomen — the sonographer's paragraph form",
    note: "Ultrasound reports carry a different shape: one long paragraph per organ and a measured "
      + "dimension column. Nothing in this harness rendered a US report before, so a US-only layout "
      + "regression had no paper test at all.",
    study: { modality: "USG", bodyPart: "Abdomen (USG)", title: "USG WHOLE ABDOMEN" },
    narrative: {
      clinicalHistory: "Recurrent right upper quadrant discomfort after fatty meals.",
      technique: "Real-time B-mode abdominal ultrasonography.",
      findings: "Liver is normal in size (12.4 cm) with uniform echotexture. No focal lesion.\n"
        + "Gallbladder is normal in wall thickness. A 6 mm echogenic focus with posterior acoustic shadowing is "
        + "seen dependent in the lumen, mobile on change of position.\n"
        + "Common bile duct measures 4 mm. Intrahepatic biliary radicles are not dilatated.\n"
        + "Pancreas is visualised and normal. Spleen is normal in size (10.1 cm).\n"
        + "Both kidneys are normal in size, cortical thickness and echogenicity. No calculus or hydronephrosis.\n"
        + "Urinary bladder is adequately distended with a normal wall. Prostate/uterus unremarkable.\n"
        + "No free fluid in the cul-de-sac or gutter spaces.",
      impression: "Cholelithiasis. No sonographic evidence of cholecystitis.\nNo abdominal mass or ascites.",
      recommendation: "Surgical consultation for symptomatic gallstones.",
    },
  },
  {
    key: "23-doppler-lower-limbs",
    title: "Bilateral lower-limb venous Doppler — laterality must survive",
    note: "A bilateral study names the right limb and the left limb in the same report, so the printed "
      + "page must keep the two apart. The `{side}` tokens a Quick Select box carries are resolved before "
      + "this point; a leftover token would reach the paper as literal text.",
    study: { modality: "USG", bodyPart: "Lower Limbs (Bilateral)", title: "DOPPLER BILATERAL LOWER LIMB VENOUS SYSTEM" },
    narrative: {
      clinicalHistory: "Right leg swelling and pain after a long flight.",
      technique: "Bilateral lower-limb colour Doppler with compression sonography.",
      findings: "RIGHT LOWER LIMB: Common femoral, femoral and popliteal veins are compressible with "
        + "spontaneous flow. No intraluminal echogenic thrombus.\n"
        + "LEFT LOWER LIMB: The popliteal vein is non-compressible and shows no colour flow or spontaneous "
        + "signal. The remaining deep veins are compressible.\n"
        + "Superficial femoral and profunda veins are patent bilaterally.\n"
        + "Great and small saphenous veins are normal bilaterally with no reflux.\n"
        + "No calf muscle hematoma or Baker's cyst.",
      impression: "Deep vein thrombosis of the LEFT popliteal vein.\nNo DVT on the RIGHT.",
      recommendation: "Clinical and laboratory correlation; follow-up Doppler as advised.",
    },
  },
  {
    key: "24-mammography-bilateral",
    title: "Mammography — BI-RADS line and a bold abnormality",
    note: "Mammography reports end with a BI-RADS category line that the referring doctor reads first. "
      + "This modality has no rendering branch of its own at all, so whatever the shared template does is "
      + "what a mammography report becomes.",
    study: { modality: "X-RAY", bodyPart: "Bilateral Breast", title: "MAMMOGRAPHY BILATERAL (CC + MLO)" },
    narrative: {
      clinicalHistory: "Palpable lump in the upper outer quadrant of the left breast.",
      technique: "Digital mammography, craniocaudal and mediolateral oblique views, both breasts.",
      findings: "BREAST COMPOSITION: Scattered fibroglandular densities, both breasts.\n"
        + "RIGHT BREAST: No mass, no suspicious cluster of microcalcifications, no architectural distortion.\n"
        + "LEFT BREAST: A 14 mm spiculated isodense mass is seen in the upper outer quadrant. No skin thickening "
        + "or nipple retraction. No axillary lymphadenopathy on this projection.\n"
        + "NIPPLES AND SKIN: Unremarkable bilaterally.",
      impression: "Spiculated mass in the upper outer quadrant of the LEFT BREAST — suspicious.\n"
        + "RIGHT BREAST: No mammographic abnormality.",
      recommendation: "Ultrasound-guided core biopsy of the left breast lesion.\nBI-RADS 4B.",
    },
  },
  {
    key: "25-long-report-many-pages",
    title: "A long multi-organ report — pagination under real load",
    note: "A report a radiologist actually dictated for an abnormal whole-body study. The question this "
      + "case exists to answer is not what the text says but where the page breaks fall: an image, a "
      + "table or the signature must never be split across two pages, and no line may be lost.",
    study: { modality: "CT", bodyPart: "Abdomen (CT)", title: "CT THORAX ABDOMEN AND PELVIS (CONTRAST)" },
    narrative: {
      clinicalHistory: "Known malignancy, restaging after six cycles of chemotherapy.",
      technique: "Contrast-enhanced CT of the thorax, abdomen and pelvis with oral and intravenous contrast.",
      findings: LONG_REPORT_FINDINGS,
      impression: "Multiple hepatic metastases, progressed since the previous study.\n"
        + "Left pleural effusion with passive collapse of the adjacent lung.\n"
        + "No new bone lesion.",
      recommendation: "Oncology review for change of therapy.",
    },
  },
  {
    key: "26-with-selected-images",
    title: "A report carrying four selected images",
    note: "The pictures. Four cells with different shapes and different caption states: a 4:3 slice, a "
      + "square slice, a flagged KEY slice, and a caption holding an apostrophe, an ampersand and a "
      + "double quote so any escaping mistake in the attribute is visible rather than silent.",
    study: { modality: "USG", bodyPart: "Abdomen (USG)", title: "USG WHOLE ABDOMEN" },
    narrative: {
      clinicalHistory: "Right upper quadrant discomfort.",
      technique: "Real-time B-mode ultrasonography of the whole abdomen.",
      findings: "Liver is normal in size and echotexture.\n"
        + "Gallbladder shows a 6 mm mobile echogenic focus with posterior acoustic shadowing.\n"
        + "Common bile duct measures 4 mm. Kidneys, spleen and pancreas are normal.\n"
        + "No free fluid.",
      impression: "Cholelithiasis. No cholecystitis.",
      recommendation: "Surgical consultation.",
    },
    images: [
      { src: PNG_4_3, caption: "GB — stone with shadow", displayOrder: 1, isKeyImage: true },
      { src: PNG_SQUARE, caption: "", displayOrder: 2, isKeyImage: false },
      { src: PNG_4_3, caption: "Left lobe & duct \"measured\"", displayOrder: 3, isKeyImage: false,
        sopInstanceUid: "1.2.840.PREVIEW.IMG.3" },
      { src: PNG_SQUARE, caption: "Right kidney (longitudinal)", displayOrder: 4, isKeyImage: true },
    ],
  },
  {
    key: "27-images-selected-but-missing",
    title: "Images chosen that never arrived",
    note: "Chosen but not yet fetched — the shape the server emits when a PACS slice could not be pulled "
      + "and the browser is expected to hydrate the empty cell. What the patient must NOT get is a printed "
      + "page of empty navy boxes or an <img> with no source, so the fallback itself is the claim here.",
    study: { modality: "CT", bodyPart: "Abdomen (CT)", title: "CT ABDOMEN (PLAIN)" },
    narrative: {
      clinicalHistory: "Renal colic.",
      technique: "Plain CT of the abdomen.",
      findings: "Both kidneys are normal in position. A 5 mm calculus is seen at the left pelvi-ureteric junction.\n"
        + "No hydronephrosis. Liver, spleen and pancreas are normal.\n"
        + "No free fluid. Bowel loops are normal.",
      impression: "Non-obstructing 5 mm calculus at the LEFT pelvi-ureteric junction.",
      recommendation: "Urology review.",
    },
    images: [
      { src: "", caption: "Left PUJ calculus", displayOrder: 1, isKeyImage: true,
        sopInstanceUid: "1.2.840.PREVIEW.MISSING.1" },
      { src: "", caption: "", displayOrder: 2, isKeyImage: false,
        sopInstanceUid: "1.2.840.PREVIEW.MISSING.2" },
    ],
  },
];

function toReportData(c: Case, patient: ReportData): ReportData {
  return {
    ...patient,
    modality: c.study.modality,
    bodyPart: c.study.bodyPart,
    reportTitle: c.study.title,
    clinicalHistory: c.narrative.clinicalHistory,
    technique: c.narrative.technique,
    // Door 2 takes the rail in its own shape, so an image can be missing from
    // one door and present in the other — exactly the divergence a patient would
    // experience as "the PDF has no pictures".
    keyImages: (c.images ?? []).map((img) => ({
      src: img.src,
      caption: img.caption,
      displayOrder: img.displayOrder,
      isKeyImage: img.isKeyImage ?? false,
      sopInstanceUid: img.sopInstanceUid ?? null,
    })),
    findings: c.narrative.findings,
    impression: c.narrative.impression,
    recommendation: c.narrative.recommendation,
  };
}

function printPageHtml(c: Case, patient: ReportData): string {
  const bodyHtml = buildLivePrintBodyHtml({
    clinicalHistory: c.narrative.clinicalHistory,
    technique: c.narrative.technique,
    rawFindings: c.narrative.findings,
    findingsMap: {},
    useStructured: false,
    impression: c.narrative.impression.split(/\n+/).map((s) => s.trim()).filter(Boolean),
    recommendation: c.narrative.recommendation,
    headingCase: "all_caps",
    impressionStyle: "numbered",
  });
  const model: ReportDocumentModel = {
    reportNumber: `PREVIEW-${c.key}`,
    studyTitle: c.study.title,
    typeLabel: "RADIOLOGY",
    statusLabel: "DRAFT PREVIEW",
    clinic: { name: CLINIC.name ?? "", tagline: CLINIC.tagline, address: CLINIC.address, phone: CLINIC.phone },
    patientRows: [
      { label: "Patient", value: `${patient.patientName}` },
      { label: "Age / Sex", value: `${patient.age}y / ${patient.sex}` },
      { label: "Accession No.", value: patient.accessionNumber ?? "" },
      { label: "Referring", value: patient.referringDoctor ?? "" },
    ],
    // The signed radiology print leaves `impression` null and carries the sentence
    // inside bodyHtml (patient-reports.ts:3453); the boxed "Impression:" block is the
    // pathology shape. Setting it here as well printed the clinical bottom line twice
    // on every preview page — and 47px of extra sheet height that pagination was
    // measured against.
    bodyHtml,
    // The same cells the print route hands the renderer, in the same shape.
    keyImages: c.images ?? [],
    stamp: { kind: "draft", label: "PREVIEW — NOT A PATIENT REPORT" },
    signatures: [{ name: "Dr. Preview", qualification: "MD (Radiodiagnosis)", registrationNo: "", label: "Signed:", whenLabel: "" }],
    footerNote: "Layout preview only — no report was created or stored.",
    generatedAtLabel: "preview harness",
    draftWatermark: true,
  };
  // RenderDocumentOptions carries `customCss` and nothing else; the print page is the
  // same HTML the browser paginates under @media print, which is what makes this
  // artefact a stand-in for the paper. The `{ printMode: false }` this call used to
  // pass names an option that has never existed.
  return renderReportDocument(model, resolvePresentationTemplate("care-classic"));
}

function previewHtml(c: Case, patient: ReportData): string {
  return buildPreviewHtml({
    patientName: patient.patientName ?? "",
    age: patient.age ?? "",
    sex: patient.sex ?? "",
    accessionNumber: patient.accessionNumber ?? "",
    referringDoctor: patient.referringDoctor ?? "",
    studyDate: patient.studyDate ?? "",
    studyName: c.study.title,
    technique: c.narrative.technique,
    clinicalHistory: c.narrative.clinicalHistory,
    findingsMap: {},
    rawFindings: c.narrative.findings,
    useStructured: false,
    impression: c.narrative.impression.split(/\n+/).map((s) => s.trim()).filter(Boolean),
    recommendation: c.narrative.recommendation,
    imageRefs: (c.images ?? []).map((img) => ({
      displayOrder: img.displayOrder,
      description: img.caption,
      isKeyImage: img.isKeyImage ?? false,
    })),
    headingCase: "all_caps",
    impressionStyle: "numbered",
  });
}

const PATIENTS: Record<string, ReportData> = {  MRI_BRAIN: {
    patientName: "RAMESH KUMAR", age: "62", sex: "M", accessionNumber: "PREVIEW-BRN-001",
    studyDate: "04/10/2026", referringDoctor: "Dr. Preview Referral",
  },
  MRI_LS_SPINE: {
    patientName: "SITA DEVI", age: "45", sex: "F", accessionNumber: "PREVIEW-SPN-001",
    studyDate: "04/10/2026", referringDoctor: "Dr. Preview Referral",
  },
  MRI_CERVICAL_SPINE: {
    patientName: "ARJUN NAIR", age: "38", sex: "M", accessionNumber: "PREVIEW-CSP-001",
    studyDate: "04/10/2026", referringDoctor: "Dr. Preview Referral",
  },
  // Every patient below is a different synthetic name on purpose: the same name
  // on two cases would let a cross-study leak pass unnoticed, and "which patient
  // is on this page" is the one thing a report must never get wrong.
  CT_ABDOMEN: {
    patientName: "MEENA RAO", age: "54", sex: "F", accessionNumber: "PREVIEW-CTA-001",
    studyDate: "04/10/2026", referringDoctor: "Dr. Preview Referral",
  },
  USG_ABDOMEN: {
    patientName: "GOPAL MENON", age: "31", sex: "M", accessionNumber: "PREVIEW-USG-001",
    studyDate: "04/10/2026", referringDoctor: "Dr. Preview Referral",
  },
  DOPPLER_LOWER_LIMBS: {
    patientName: "FATIMA SHEIKH", age: "47", sex: "F", accessionNumber: "PREVIEW-DPL-001",
    studyDate: "04/10/2026", referringDoctor: "Dr. Preview Referral",
  },
  MAMMOGRAPHY: {
    patientName: "LAKSHMI IYER", age: "52", sex: "F", accessionNumber: "PREVIEW-MMG-001",
    studyDate: "04/10/2026", referringDoctor: "Dr. Preview Referral",
  },
};

/**
 * What must be bold on the printed page, in the radiologist's terms rather than
 * as a copy of the output: a normal report carries no bold findings at all — the
 * one-click page is scanned, not read — and a report where a box added an
 * abnormality carries that sentence and nothing else from its section.
 */
const PRINT_EMPHASIS: Record<string, { count: number; contains?: string }> = {
  "1-brain-normal": { count: 0 },
  "2-brain-infarct": { count: 1, contains: "Restricted diffusion" },
  "3-brain-fazekas": { count: 1, contains: "Fazekas grade 1" },
  "4-spine-normal-quicknormal": { count: 0 },
  "5-spine-subheaded": { count: 0 },
  "6-spine-subheaded-click": { count: 1, contains: "Broad-based disc bulge at L4-L5" },
  "7-spine-canal-click": { count: 1, contains: "Mild canal stenosis at L4-L5" },
  "8-spine-auto-open": { count: 0 },
  // Both brain pages below are complete normals, so neither may carry a bold
  // findings line — the only difference between them is which sequences were run.
  "9-brain-contrast-billed": { count: 0 },
  "10-brain-plain-by-dicom": { count: 0 },
  "11-cervical-normal": { count: 0 },
  "12-cervical-herniation-click": { count: 1, contains: "Central disc herniation at C5-C6" },
  "13-cervical-cord-click": { count: 1, contains: "Cervical cord compression at C5-C6" },
  "14-brain-hemorrhage": { count: 2, contains: "hemorrhage" },
  "15-brain-mass": { count: 1, contains: "mass lesion" },
  "16-brain-small-vessel": { count: 2, contains: "Fazekas grade 2" },
  "17-brain-chronic-infarct": { count: 1, contains: "consistent with chronic infarct" },
  // The screening abnormality is the only thing on that page a reader must find
  // first: every other line is a screening statement about a region that was not
  // the reason for the examination.
  "18-whole-spine-screening": { count: 1, contains: "Compression deformity" },
  // The five modalities that had never been rendered on paper, the long study and
  // the two image studies. Their Findings are typed rather than clicked, and the
  // bold-abnormal rule reads the observation ledger — a typed line owns no ledger
  // row, so nothing on these pages may be bolded. Recorded as measured, and the
  // point of recording it is that a future change to that rule must show up here
  // rather than silently restyle every CT and ultrasound report in the clinic.
  "21-ct-abdomen-plain": { count: 1, contains: "Bones: Degenerative changes" },
  "22-usg-whole-abdomen": { count: 1, contains: "posterior acoustic shadowing" },
  // The bilateral Doppler is the page the emphasis rule currently gets wrong in both
  // directions: `compress` fires inside "compressible" — the NORMAL venous statement —
  // so the uninvolved right limb is bolded, and the denial `no` fires inside the word
  // "non-compressible", so the DVT sign itself is cancelled and prints plain. One
  // abnormal line is the correct printed page: the left limb.
  "23-doppler-lower-limbs": { count: 1, contains: "non-compressible" },
  "24-mammography-bilateral": { count: 1, contains: "spiculated" },
  // Twelve organ blocks of pure denial. Any bold here is the one-click-normal failure
  // mode this ratchet exists to catch, at the length a restaging study actually runs to.
  "25-long-report-many-pages": { count: 0 },
  "26-with-selected-images": { count: 1, contains: "posterior acoustic shadowing" },
  "27-images-selected-but-missing": { count: 1, contains: "calculus" },
  // The two #174 doors: the finding is the only abnormal line either page may carry,
  // and the withheld normal is not a line at all.
  "19-ls-format-door-over-click": { count: 1, contains: "Broad-based disc bulge at L4-L5" },
  "20-ls-merge-door-over-click": { count: 1, contains: "Broad-based disc bulge at L4-L5" },
};

/**
 * The advice half of one Quick Select click, read off the printed page rather
 * than from the store: a box that adds an abnormality must also add what to do
 * about it, and a box that carries no advice of its own must invent none and
 * must not borrow another box's. Every string here is copied from the Report
 * Format the tile cites, so the table cannot quietly agree with a tile that has
 * since drifted.
 */
const PRINT_ADVICE: Record<string, { must: string[]; mustNot?: string[] }> = {
  "1-brain-normal": { must: [] },
  "2-brain-infarct": { must: ["Immediate stroke team notification", "MRA head and neck recommended"] },
  "3-brain-fazekas": { must: ["Control of vascular risk factors"] },
  "4-spine-normal-quicknormal": { must: [] },
  "5-spine-subheaded": { must: [] },
  "6-spine-subheaded-click": {
    must: ["Conservative management with NSAIDs and physiotherapy", "Surgical referral if neurological deficits develop"],
  },
  "7-spine-canal-click": {
    must: [],
    mustNot: ["Conservative management with NSAIDs", "Immediate stroke team notification"],
  },
  "8-spine-auto-open": { must: [] },
  "9-brain-contrast-billed": { must: [] },
  "10-brain-plain-by-dicom": { must: [] },
  "11-cervical-normal": { must: [] },
  "12-cervical-herniation-click": {
    must: ["Conservative management with physiotherapy"],
    mustNot: ["Urgent neurosurgical consultation", "Immediate stroke team notification"],
  },
  "13-cervical-cord-click": {
    must: ["Urgent neurosurgical consultation"],
    mustNot: ["Conservative management with physiotherapy", "Immediate stroke team notification"],
  },
  "14-brain-hemorrhage": {
    must: ["Immediate neurosurgical consultation"],
    mustNot: ["Immediate stroke team notification", "Conservative management with NSAIDs"],
  },
  "15-brain-mass": {
    must: [],
    mustNot: ["Immediate stroke team notification", "Immediate neurosurgical consultation"],
  },
  "16-brain-small-vessel": {
    must: ["Aggressive vascular risk factor management"],
    mustNot: ["Immediate stroke team notification", "Immediate neurosurgical consultation"],
  },
  "17-brain-chronic-infarct": {
    must: [],
    mustNot: ["Immediate stroke team notification", "Immediate neurosurgical consultation"],
  },
};

/** Bold spans inside the printed findings body, headings and the impression
 *  label excluded — the sentence the paper actually shows in bold. */
function printedBoldFindingsLines(page: string): string[] {
  return (page.match(/<strong>([^<]{20,})<\/strong>/g) ?? [])
    .map((s) => s.replace(/^<strong>|<\/strong>$/g, ""))
    .filter((t) => !t.startsWith("Impression:"));
}

describe("report preview harness", () => {
  it("renders every case through the real print, PDF and preview paths", () => {
    mkdirSync(OUT, { recursive: true });
    const audit: Array<Record<string, unknown>> = [];
    const door2ImageObjects: Record<string, number> = {};

    for (const c of CASES) {
      const patient =
        c.study.bodyPart === "Brain" ? PATIENTS.MRI_BRAIN
        : c.study.bodyPart === "Cervical Spine" ? PATIENTS.MRI_CERVICAL_SPINE
        : c.study.bodyPart === "Abdomen (CT)" ? PATIENTS.CT_ABDOMEN
        : c.study.bodyPart === "Abdomen (USG)" ? PATIENTS.USG_ABDOMEN
        : c.study.bodyPart === "Lower Limbs (Bilateral)" ? PATIENTS.DOPPLER_LOWER_LIMBS
        : c.study.bodyPart === "Bilateral Breast" ? PATIENTS.MAMMOGRAPHY
        : PATIENTS.MRI_LS_SPINE;
      if (!patient) throw new Error(`case ${c.key} maps to no patient — add it to PATIENTS`);
      const report = toReportData(c, patient);

      // `show.keyImages` ships false, and the real export turns it on for any report
      // that actually has pictures (radiologyReportPdfExport.ts:379). Mirroring that
      // here is what lets this harness say anything at all about pictures on the
      // letter-pad PDF — with the shipped default the four-image case embedded none.
      const printSettings = {
        ...DEFAULT_PRINT_SETTINGS,
        watermark: "PREVIEW",
        show: {
          ...DEFAULT_PRINT_SETTINGS.show,
          keyImages: (c.images?.length ?? 0) > 0 || DEFAULT_PRINT_SETTINGS.show.keyImages,
        },
      };
      const doc = generateReportPDF(report, printSettings, CLINIC, { save: false });
      const buf = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
      expect(buf.length, `${c.key} produced no PDF bytes`).toBeGreaterThan(2000);
      door2ImageObjects[c.key] = (buf.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;
      writeFileSync(join(OUT, `${c.key}.pdf`), buf);

      const page = printPageHtml(c, report);
      // Written before anything is asserted about it. The harness used to assert
      // first and write after, so the case that failed left no artefact — which
      // is precisely the page whoever is debugging needs to open.
      writeFileSync(join(OUT, `${c.key}.print.html`), page);
      writeFileSync(join(OUT, `${c.key}.screen.html`), previewHtml(c, report));
      expect(page).toContain("PREVIEW — NOT A PATIENT REPORT");
      // The clinical bottom line reaches the paper exactly once. The boxed
      // `<strong>Impression: …</strong>` is the pathology shape; a radiology print
      // carries its impression as a section in the body. This harness used to set both
      // fields at once, so every preview page showed the same conclusion twice while
      // the assertion checked only the copy production never prints.
      const impressionCopies = (page.match(/class="impression"/g) ?? []).length
        + (page.match(/class="section-heading">Impression</g) ?? []).length;
      expect(impressionCopies, `${c.key} prints the impression ${impressionCopies} time(s)`).toBe(1);
      const firstImpressionLine = c.narrative.impression.split(/\n+/)[0].trim();
      expect(page, `${c.key} lost "${firstImpressionLine}"`).toContain(firstImpressionLine);

      // The other half of the editor's colour: on paper, only what is abnormal.
      const bolded = printedBoldFindingsLines(page);
      const want = PRINT_EMPHASIS[c.key] ?? { count: 0 };
      expect(bolded, `${c.key} bolds ${want.count} findings line(s)`).toHaveLength(want.count);
      if (want.contains) expect(bolded.join(" ")).toContain(want.contains);

      const advice = PRINT_ADVICE[c.key] ?? { must: [] };
      for (const line of advice.must) {
        expect(page, `${c.key} lost the advice "${line}" on paper`).toContain(line);
      }
      for (const line of advice.mustNot ?? []) {
        expect(page, `${c.key} printed advice from a box nobody clicked`).not.toContain(line);
      }

      // What the printed page actually carries, counted in the rendered HTML —
      // not what the text was meant to look like.
      const blocks = parseFindingsDocument(c.narrative.findings);
      audit.push({
        key: c.key,
        title: c.title,
        note: c.note,
        headingsBefore: c.replaced ? undefined : headingCount(c.narrative.findings),
        headingsAfter: c.replaced ? headingCount(c.narrative.findings) : undefined,
        headingLabels: blocks.filter((b) => b.kind === "heading").map((b) => (b as { text: string }).text),
        paragraphBlocks: blocks.filter((b) => b.kind === "para").length,
        tableBlocks: blocks.filter((b) => b.kind === "table").length,
        findingsLineCount: c.narrative.findings.split("\n").filter(Boolean).length,
        printedHeadingBlocks: (page.match(/class="section-heading"/g) ?? []).length,
        printedTables: (page.match(/class="findings-table"/g) ?? []).length,
        printedTableRows: (page.match(/class="findings-table"[\s\S]*?<\/table>/g) ?? [])
          .join("").match(/<tr/g)?.length ?? 0,
        replacedNormalSentences: c.replaced ?? [],
        printedBoldFindings: bolded,
        findingsText: c.narrative.findings,
        recommendationText: c.narrative.recommendation,
      });
    }

    // Both doors must carry the pictures. The letter-pad PDF is jsPDF drawing its own
    // rail, so "the print page has them" does not prove "the download has them" — and
    // `show.keyImages` ships false, which is how a report with four selected images
    // downloads as a report with none. The baseline is measured in the same run from
    // the cases given no images, so the comparison cannot go vacuous if the renderer
    // starts embedding something else.
    const pictureless = Object.entries(door2ImageObjects)
      .filter(([key]) => !(CASES.find((c) => c.key === key)?.images?.length ?? 0))
      .map(([, n]) => n);
    expect(pictureless.length, "no pictureless case left to measure against").toBeGreaterThan(0);
    const door2Baseline = Math.min(...pictureless);
    for (const c of CASES.filter((x) => x.images?.length)) {
      expect(door2ImageObjects[c.key],
        `${c.key} embedded ${door2ImageObjects[c.key]} image object(s) in the letter-pad PDF, pictureless baseline ${door2Baseline}`)
        .toBeGreaterThan(door2Baseline);
    }

    writeFileSync(join(OUT, "audit.json"), JSON.stringify(audit, null, 2));
    const index = `<!doctype html><meta charset="utf-8"><title>Report previews</title>
<style>body{font:14px system-ui;margin:24px;max-width:1100px}h1{font-size:18px}
section{border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin:0 0 16px}
h2{font-size:15px;margin:0 0 4px}p{margin:0 0 10px;color:#555;font-size:13px}
iframe{width:100%;height:520px;border:1px solid #eee}</style>
<h1>Report previews — generated by the real renderers, nothing stored, clinic untouched</h1>
${CASES.map((c) => `<section><h2>${c.title}</h2><p>${c.note}</p>
<iframe src="${c.key}.print.html"></iframe>
<p><a href="${c.key}.print.html">print page</a> · <a href="${c.key}.screen.html">screen/Word</a> · <a href="${c.key}.pdf">PDF (${c.key}.pdf)</a></p>
</section>`).join("\n")}`;
    writeFileSync(join(OUT, "index.html"), index);

    // The invariants that must hold for a normal report to be trustworthy.
    expect(brainInfarct.narrative.findings).toContain("Restricted diffusion");
    expect(brainFazekas.narrative.findings).toContain("Fazekas grade 1");
    expect(spineHerniation.narrative.findings).toContain("L4-L5");

    // The two brain pages above are the same study. Only the billed name tells
    // them apart, and the printed technique must carry that difference — a report
    // that signed out plain sequences for a contrast exam is a false clinical claim.
    expect(brainContrastAuto.name).toBe("MRI Brain — Normal (Contrast)");
    expect(brainPlainAuto.name).toBe("MRI Brain — Standard Normal");
    // Three of these eighteen are the cervical examination (the one-click normal,
    // a disc click and a cord click) — added with the cervical catalogue so its
    // wording can be read on paper before anything ships. Four more are the brain
    // catalogue additions (hemorrhage, mass, small-vessel multi-click, chronic
    // infarct). The eighteenth is the whole-spine screening page. The nineteenth and
    // twentieth are the two whole-report doors opened over a clicked finding (#174),
    // which is the only place that contradiction was ever readable.
    // Seven more since: CT, USG, bilateral Doppler, mammography, a deliberately
    // long multi-page dictation, a study carrying four selected images, and the
    // same images chosen but never fetched. They are here because every case
    // before them was an MRI — the print layout of the other modalities, and of
    // pictures on the page, had never been read.
    expect(CASES.length).toBe(27);

    // Staging an infarct as chronic retires the acute-infarct denial and the
    // whole-examination parenchyma normal — encephalomalacia is lost parenchyma —
    // while the DWI/ADC negative is the fact that makes the case chronic and has
    // to still be on the page. Measured off the rendered narrative, because the
    // alias that used to own it (infarct → "restricted diffusion") deleted the
    // sequence negative on exactly this click and kept the parenchyma one.
    expect(brainChronicInfarct.replaced).toEqual([
      "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
      "No acute infarct is seen.",
    ]);
    expect(brainChronicInfarct.narrative.findings).not.toContain("No acute infarct is seen.");
    expect(brainChronicInfarct.narrative.findings).not.toContain("Brain parenchyma shows normal signal intensity");
    expect(brainChronicInfarct.narrative.findings).toContain("No restricted diffusion is seen on DWI/ADC.");
    expect(brainChronicInfarct.narrative.impression).toMatch(/chronic right cerebral infarct/i);

    // The screening page, on paper. One dorsal abnormality was recorded on a
    // whole-spine screening study, so the page must still carry every other
    // region's screening statement — 15 of them. Until the limitation row declared
    // what it owns, writing its one line deleted 13 of the 16 findings lines this
    // examination's normal report carries. The limitation is a claim about the
    // examination, so it must appear exactly once, and nothing may be added.
    const screeningFindings = wholeSpineScreeningAbnormal.narrative.findings;
    expect(screeningFindings.match(/SCREENING STUDIES ARE LIMITED/gi)).toHaveLength(1);
    expect(screeningFindings).toContain("Vertebral Bodies / Marrow: Compression deformity");
    for (const region of ["Cervical spine", "Dorsal spine", "Lumbar spine"]) {
      expect(screeningFindings).toContain(`${region}: Alignment is within normal limits on screening sequences.`);
      expect(screeningFindings).toContain(`${region}: No significant disc herniation is identified on screening sequences.`);
    }
    expect(screeningFindings).toContain("Cervical spine: Cord morphology and signal are within normal limits on screening sequences.");
    expect(screeningFindings).toContain("Lumbar spine: Conus medullaris appears normal on screening images.");
    expect(wholeSpineScreeningAbnormal.narrative.impression)
      .toMatch(/Dorsal Spine Screening:.*Compression deformity/);

    // Every case must carry a printed-emphasis expectation. `?? { count: 0 }` made
    // a missing entry mean "this page must bold nothing", so deleting an entry —
    // or renaming a case key — silently turned the check into its opposite.
    for (const c of CASES) {
      expect(PRINT_EMPHASIS[c.key], `case ${c.key} has no printed-emphasis expectation`).toBeTruthy();
    }
    for (const key of Object.keys(PRINT_EMPHASIS)) {
      expect(CASES.some((c) => c.key === key), `PRINT_EMPHASIS names ${key}, no such case`).toBe(true);
    }

    // A canal box speaks about the canal, so it owns the document's study-wide
    // canal denial and must land in the canal section — not beside the disc
    // levels, and not alongside the sentence that still denies it.
    expect(spineCanal.replaced).toEqual([
      "Thecal sac of adequate calibre with no significant central canal stenosis.",
    ]);
    const section = (name: string, until: string) =>
      spineCanal.narrative.findings.split(`${name}:`)[1]?.split(`${until}:`)[0] ?? "";
    expect(section("Thecal Sac & Neural Structures", "Posterior Structures"))
      .toContain("Mild canal stenosis at L4-L5");
    expect(section("Thecal Sac & Neural Structures", "Posterior Structures"))
      .toContain("No nerve root compression.");
    expect(section("Thecal Sac & Neural Structures", "Posterior Structures"))
      .not.toMatch(/adequate calibre|central canal stenosis/i);
    expect(section("Disc Level Analysis", "Facets & Ligaments"))
      .not.toContain("canal stenosis");
    // The bottom line is the line a referring surgeon reads first: it must not
    // keep calling a stenotic spine normal.
    expect(spineCanal.narrative.impression).not.toContain("Normal MRI lumbo-sacral spine");
    expect(spineCanal.narrative.impression).toContain("Mild canal stenosis at L4-L5");

    // A box that changes the plan of care must not leave the report still
    // advising a normal spine; a box that says nothing about treatment must not
    // invent advice. Both halves were broken together while Recommendation was
    // dropped by the button whatever the box carried.
    expect(spineHerniation.narrative.recommendation).toContain(
      "Conservative management with NSAIDs and physiotherapy",
    );
    expect(brainInfarct.narrative.recommendation).toContain("Immediate stroke team notification");
    expect(brainFazekas.narrative.recommendation).toContain("Control of vascular risk factors");
    expect(spineCanal.narrative.recommendation).not.toContain("Conservative management");
    expect(spineCanal.narrative.recommendation).toContain("Clinical correlation");
    for (const level of ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]) {
      expect(spineCanal.narrative.findings, `${level} canal row`)
        .toContain(`| ${level} | — |`);
    }

    // The cervical clicks, pinned to the rows they actually retire. The disc box
    // owns exactly its own level's disc-contour normal. The cord box owns two: the
    // study-wide "No cord compression is seen." because it is the same concept, and
    // the C5-C6 canal row because the tile names that sentence in `baselineReplaces`
    // — ownership matches on concept or on one named sentence, never on adjacency,
    // so the disc-contour row beside it survives untouched.
    expect(cervicalHerniation.replaced).toEqual([
      "C5-C6: No significant disc bulge or protrusion is seen.",
    ]);
    expect(cervicalCord.replaced).toEqual([
      "No cord compression is seen.",
      "C5-C6: No spinal canal or thecal sac compression is seen.",
    ]);
    expect(cervicalCord.narrative.findings).toContain(
      "C5-C6: No significant disc bulge or protrusion is seen.");
    expect(cervicalCord.narrative.findings).not.toContain("No cord compression is seen.");
    for (const level of ["C2-C3", "C3-C4", "C4-C5", "C6-C7", "C7-T1"]) {
      expect(cervicalCord.narrative.findings, `${level} canal row stays`)
        .toContain(`${level}: No spinal canal or thecal sac compression is seen.`);
    }

    // Ruling #174, read off the rendered paper and not from the store: a whole-report door
    // may not print the normal the clicked finding contradicts, and may not print over the
    // levels nobody clicked. `printPageHtml` is the same call the preview loop makes, so
    // what fails here is a page the clinic would have received, not a string in memory.
    for (const [key, made] of [
      ["19-ls-format-door-over-click", lsFormatDoorOverClick],
      ["20-ls-merge-door-over-click", lsMergeDoorOverClick],
    ] as const) {
      const c = CASES.find((x) => x.key === key);
      if (!c) throw new Error(`case ${key} is not in CASES`);
      const page = printPageHtml(c, toReportData(c, PATIENTS.MRI_LS_SPINE));
      const contradicted = "L4-L5: No significant disc bulge or protrusion is seen.";

      expect(made.replaced, `${key} does not record the retirement on the finding`)
        .toContain(contradicted);
      expect(page, `${key} printed the normal the herniation contradicts`)
        .not.toContain(contradicted);
      expect(page, `${key} lost the herniation itself`).toContain("Broad-based disc bulge at L4-L5");
      for (const level of ["L1-L2", "L2-L3", "L3-L4", "L5-S1"]) {
        expect(page, `${key} lost the ${level} normal nobody contradicted`)
          .toContain(`${level}: No significant disc bulge or protrusion is seen.`);
      }
      expect(made.narrative.impression, `${key} still calls this spine normal`)
        .not.toContain("Normal MRI lumbo-sacral spine");
      expect(made.narrative.impression, `${key} names the level in the Impression`)
        .toContain("L4-L5");
    }
    // 27 cases x three renderers + a jsPDF build: 2.2 s alone, 6.99 s inside the
    // 848-file run, which the 5 s default reads as a print regression.
  }, 120_000);

  it("prints the contrast study as a contrast study", () => {
    const contrastCase = CASES.find((c) => c.key === "9-brain-contrast-billed");
    const plainCase = CASES.find((c) => c.key === "10-brain-plain-by-dicom");
    if (!contrastCase || !plainCase) throw new Error("the billed-contrast pair is missing from the pack");
    const patient = PATIENTS.MRI_BRAIN;
    const contrastPage = printPageHtml(contrastCase, toReportData(contrastCase, patient));
    const plainPage = printPageHtml(plainCase, toReportData(plainCase, patient));

    // Read the pages rather than the intent: Technique is what a referring surgeon
    // relies on to know whether an enhancing study exists at all.
    expect(contrastPage).toContain("Post-contrast");
    expect(contrastPage).toContain("Gadobutrol");
    expect(plainPage).not.toMatch(/post-contrast|gadobutrol|gadolinium/i);
    // The study title follows the exam, so the two pages are not interchangeable.
    expect(contrastPage).toContain("MRI BRAIN (CONTRAST)");
    expect(plainPage).not.toContain("MRI BRAIN (CONTRAST)");
  });
});

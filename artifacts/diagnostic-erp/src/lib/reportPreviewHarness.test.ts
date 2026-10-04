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
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-tiles.data";
import {
  mergeStructuredNormalFormats,
  type StructuredNormalRow,
} from "./zai-workspace/structuredNormalFormats";
import { resolveNormalBootstrapFormat } from "./zai-workspace/normalBootstrap";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  renderReportDocument,
  resolvePresentationTemplate,
  type ReportDocumentModel,
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
    incoming: { findings: fill(t.sentence), impression: fill(t.impressionSentence) },
    ownership: {
      anatomicalSection: t.anatomicalSection,
      conflictGroup: t.conflictGroup,
      baselineReplaces: t.baselineReplaces,
      concept: t.concept ?? null,
    },
    provenance: {
      findings: provenanceFromText(base.findings, "template"),
      impression: provenanceFromText(base.impression, "template"),
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
};

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
const spineHerniation = applyTile(spineDoc, "Disc herniation L4-L5");
const spineCanal = applyTile(spineDoc, "Mild canal stenosis L4-L5");

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
];

function toReportData(c: Case, patient: ReportData): ReportData {
  return {
    ...patient,
    modality: c.study.modality,
    bodyPart: c.study.bodyPart,
    reportTitle: c.study.title,
    clinicalHistory: c.narrative.clinicalHistory,
    technique: c.narrative.technique,
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
    impression: c.narrative.impression,
    bodyHtml,
    stamp: { kind: "draft", label: "PREVIEW — NOT A PATIENT REPORT" },
    signatures: [{ name: "Dr. Preview", qualification: "MD (Radiodiagnosis)", registrationNo: "", label: "Signed:", whenLabel: "" }],
    footerNote: "Layout preview only — no report was created or stored.",
    generatedAtLabel: "preview harness",
    draftWatermark: true,
  };
  return renderReportDocument(model, resolvePresentationTemplate("care-classic"), { printMode: false });
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
    imageRefs: [],
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

    for (const c of CASES) {
      const patient = c.study.bodyPart === "Brain" ? PATIENTS.MRI_BRAIN : PATIENTS.MRI_LS_SPINE;
      const report = toReportData(c, patient);

      const doc = generateReportPDF(report, { ...DEFAULT_PRINT_SETTINGS, watermark: "PREVIEW" }, CLINIC, { save: false });
      const buf = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
      expect(buf.length, `${c.key} produced no PDF bytes`).toBeGreaterThan(2000);
      writeFileSync(join(OUT, `${c.key}.pdf`), buf);

      const page = printPageHtml(c, report);
      expect(page).toContain("PREVIEW — NOT A PATIENT REPORT");
      // The impression is the clinical bottom line: the sentence itself must be
      // bold on the printed page, not only the "Impression:" label.
      expect(page).toContain("<strong>Impression: ");

      // The other half of the editor's colour: on paper, only what is abnormal.
      const bolded = printedBoldFindingsLines(page);
      const want = PRINT_EMPHASIS[c.key] ?? { count: 0 };
      expect(bolded, `${c.key} bolds ${want.count} findings line(s)`).toHaveLength(want.count);
      if (want.contains) expect(bolded.join(" ")).toContain(want.contains);
      writeFileSync(join(OUT, `${c.key}.print.html`), page);
      writeFileSync(join(OUT, `${c.key}.screen.html`), previewHtml(c, report));

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
      });
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
    for (const level of ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]) {
      expect(spineCanal.narrative.findings, `${level} canal row`)
        .toContain(`| ${level} | — |`);
    }
  });
});

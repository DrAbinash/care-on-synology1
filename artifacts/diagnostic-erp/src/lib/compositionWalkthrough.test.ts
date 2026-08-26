/**
 * Synthetic walkthroughs for canonical observation composition (Phase 22).
 * Writes HTML under /opt/cursor/artifacts when that dir exists.
 *
 * Run: pnpm exec vitest run artifacts/diagnostic-erp/src/lib/compositionWalkthrough.test.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { useWorkspace } from "./zai-workspace/store";
import { mergeTwoFormats } from "./zai-workspace/types";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { catalogSetForKey } from "./findingsMacros";

const outDir = "/opt/cursor/artifacts";
try { mkdirSync(outDir, { recursive: true }); } catch { /* ignore */ }

function html(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:sans-serif;max-width:820px;margin:24px auto;line-height:1.45}
  h1{font-size:20px} h2{font-size:14px;margin-top:20px;color:#334155}
  .ok{color:#047857;font-weight:600} pre{background:#f8fafc;border:1px solid #e2e8f0;padding:12px;white-space:pre-wrap}</style></head>
  <body><h1>${title}</h1>${body}</body></html>`;
}

function section(name: string, text: string): string {
  return `<h2>${name}</h2><pre>${String(text).replace(/</g, "&lt;") || "(empty)"}</pre>`;
}

function reset(region: "Brain" | "LS Spine") {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: region === "Brain" ? "MRI Brain Plain" : "MRI LS Spine",
      regions: [region],
      source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    appliedPathologyPatches: [],
    fieldProvenance: {},
    impressionNeedsRefresh: false,
    appliedFormatReportTitle: null,
  });
}

const fazekasSenile = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Fazekas Grade 1 + Senile Changes")!;
const fazekas2 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 2")!;
const hemor = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;
const ls = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const whole = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Whole Spine — Screening")!;

function overlay(opts: {
  id: string;
  region: string;
  label: string;
  findings: string;
  impression?: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  side?: "left" | "right" | "";
  source?: "quick-select" | "quick-findings" | "macro";
}) {
  return useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: opts.findings, impression: opts.impression },
    templates: { findings: opts.findings, impression: opts.impression },
    ownership: {
      anatomicalSection: opts.anatomicalSection,
      conflictGroup: opts.conflictGroup,
    },
    source: opts.source ?? "quick-findings",
    id: opts.id,
    region: opts.region,
    label: opts.label,
    findingsText: opts.findings,
    side: opts.side,
  });
}

export function runWalkthroughs() {
  // 1. Brain Fazekas 1 + senile → QS hemorrhage → Fazekas 2
  reset("Brain");
  useWorkspace.getState().applyFormatById(fazekasSenile.id);
  const afterFormat = { ...useWorkspace.getState() };
  overlay({
    id: "qs-hem",
    region: "Brain",
    label: hemor.label,
    findings: hemor.sentence.replace("{side}", "right"),
    impression: hemor.impressionSentence?.replace("{side}", "right"),
    anatomicalSection: hemor.anatomicalSection,
    conflictGroup: hemor.conflictGroup,
    side: "right",
    source: "quick-select",
  });
  const afterHem = { ...useWorkspace.getState() };
  overlay({
    id: "qs-f2",
    region: "Brain",
    label: fazekas2.label,
    findings: fazekas2.sentence,
    impression: fazekas2.impressionSentence,
    conflictGroup: fazekas2.conflictGroup,
    source: "quick-select",
  });
  const brain = useWorkspace.getState();
  const brainHtml = html("1. MRI Brain — Fazekas 1 + Senile Changes → hemorrhage → Fazekas 2", [
    section("After one-click Full Report Format", afterFormat.findingsText),
    section("After basal ganglia hemorrhage QS", afterHem.findingsText),
    section("After Fazekas 2 (mutex)", brain.findingsText),
    section("Impression", brain.impressionText),
    section("Title", brain.appliedFormatReportTitle || ""),
  ].join(""));

  // 2. LS normal → L3-L4 bulge → L4-L5 bulge → change L4-L5 only
  reset("LS Spine");
  useWorkspace.getState().applyFormatById(ls.id);
  overlay({
    id: "qf-l34",
    region: "LS Spine",
    label: "L3-L4 bulge",
    findings: "Disc bulge at L3-L4 without nerve root compression.",
    conflictGroup: "disc_contour",
  });
  overlay({
    id: "qf-l45",
    region: "LS Spine",
    label: "L4-L5 bulge",
    findings: "Disc bulge at L4-L5 indenting the thecal sac.",
    conflictGroup: "disc_contour",
  });
  const bothLevels = useWorkspace.getState().findingsText;
  overlay({
    id: "qf-l45b",
    region: "LS Spine",
    label: "L4-L5 protrusion",
    findings: "Posterocentral disc protrusion at L4-L5.",
    conflictGroup: "disc_contour",
  });
  const lsLevels = useWorkspace.getState();
  const lsHtml = html("2. MRI LS Spine — L3-L4 + L4-L5 isolation", [
    section("Both levels", bothLevels),
    section("After L4-L5 changed to protrusion", lsLevels.findingsText),
  ].join(""));

  // 3. Degenerative macro → QS overrides disc_contour only
  reset("LS Spine");
  const deg = catalogSetForKey("lumbar")?.tiles.find((t) => t.id === "spine-degenerative");
  useWorkspace.getState().applyMacroBundle({
    bundleId: "deg-walk",
    observations: (deg?.observations ?? []).map((obs, i) => ({
      incoming: { findings: obs.findingsText, impression: obs.impressionText },
      templates: { findings: obs.findingsText, impression: obs.impressionText },
      ownership: { conflictGroup: obs.conflictGroup, concept: obs.concept },
      source: "macro" as const,
      region: "LS Spine",
      concept: obs.concept,
      level: obs.level,
      label: "Degenerative",
      id: `deg-walk-${obs.concept ?? i}`,
    })),
  });
  const afterMacro = useWorkspace.getState().findingsText;
  overlay({
    id: "qf-l45-qs",
    region: "LS Spine",
    label: "L4-L5 diffuse bulge",
    findings: "Diffuse disc bulge at L4-L5 indenting the anterior thecal sac.",
    conflictGroup: "disc_contour",
  });
  const afterQs = useWorkspace.getState();
  const degHtml = html("3. Degenerative macro → QS overrides one slot", [
    section("Macro observations", (deg?.observations ?? []).map((o) => `${o.concept}: ${o.findingsText}`).join("\n")),
    section("After macro", afterMacro),
    section("After L4-L5 QS override", afterQs.findingsText),
  ].join(""));

  // 4. LS + Whole Spine Screening
  const merged = mergeTwoFormats(ls, whole);
  reset("LS Spine");
  useWorkspace.setState({
    findingsText: merged.findings,
    impressionText: merged.impression,
    techniqueText: merged.technique,
    recommendationText: merged.recommendation,
    appliedFormatReportTitle: merged.combinedReportTitle ?? null,
  });
  overlay({
    id: "qf-l45-screen",
    region: "LS Spine",
    label: "L4-L5 diffuse bulge",
    findings: "Diffuse disc bulge at L4-L5 indenting the anterior thecal sac.",
    conflictGroup: "disc_contour",
  });
  const spine = useWorkspace.getState();
  const spineHtml = html("4. MRI LS Spine + Whole Spine Screening", [
    section("Title", merged.combinedReportTitle || ""),
    section("Technique", spine.techniqueText),
    section("Findings after L4-L5 QS", spine.findingsText),
    section("Impression", spine.impressionText),
  ].join(""));

  // 5. Manual-edit protection
  reset("Brain");
  overlay({
    id: "qf-1",
    region: "Brain",
    label: "Fazekas 1",
    findings: DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 1")!.sentence,
    impression: DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 1")!.impressionSentence,
    conflictGroup: "fazekas",
    source: "quick-select",
  });
  const beforeEdit = useWorkspace.getState().findingsText;
  const edited = beforeEdit.replace("Fazekas grade 1", "Fazekas grade 1 — radiologist rewrite");
  useWorkspace.getState().setField("findings", edited);
  const outcome = useWorkspace.getState().removeObservation("qf-1");
  const afterDeselect = useWorkspace.getState();
  const protectHtml = html("5. Manual-edit protection on deselect", [
    section("After QS insert", beforeEdit),
    section("After manual edit", edited),
    section("Deselect outcome", outcome),
    section("Findings after deselect", afterDeselect.findingsText),
  ].join(""));

  writeFileSync(`${outDir}/walkthrough-brain-fazekas.html`, brainHtml);
  writeFileSync(`${outDir}/walkthrough-ls-levels.html`, lsHtml);
  writeFileSync(`${outDir}/walkthrough-degenerative-macro.html`, degHtml);
  writeFileSync(`${outDir}/walkthrough-ls-whole-spine.html`, spineHtml);
  writeFileSync(`${outDir}/walkthrough-manual-protect.html`, protectHtml);

  const summary = {
    brainHasFazekas2: /Fazekas grade 2/i.test(brain.findingsText),
    brainDropsFazekas1: !/Fazekas grade 1/i.test(brain.findingsText),
    brainKeepsHemorrhage: /hemorrhage/i.test(brain.findingsText),
    brainKeepsSenile: /senile|involutional|volume loss/i.test(brain.findingsText),
    l34Preserved: /L3-L4/.test(lsLevels.findingsText),
    l45Updated: /Posterocentral disc protrusion at L4-L5/.test(lsLevels.findingsText),
    l45OldGone: !/Disc bulge at L4-L5 indenting/.test(lsLevels.findingsText),
    macroKeepsDesiccation: /desiccation/i.test(afterQs.findingsText),
    macroKeepsFacet: /Facet arthropathy/i.test(afterQs.findingsText),
    qsReplacedNoBulge: !/No disc bulge at L4-L5/i.test(afterQs.findingsText),
    spineTitle: merged.combinedReportTitle,
    spineHasCervical: /CERVICAL SPINE SCREENING/.test(spine.findingsText),
    spineHasDorsal: /DORSAL SPINE SCREENING/.test(spine.findingsText),
    limitedWording: /limited planar and limited sequence/i.test(spine.techniqueText),
    protectOutcome: outcome,
    protectKeepsEdit: afterDeselect.findingsText.includes("radiologist rewrite"),
  };
  writeFileSync(`${outDir}/composition-walkthrough-summary.json`, JSON.stringify(summary, null, 2));
  return summary;
}

describe("composition walkthroughs (Phase 22)", () => {
  it("produces the five golden composed reports", () => {
    const s = runWalkthroughs();
    expect(s.brainHasFazekas2).toBe(true);
    expect(s.brainDropsFazekas1).toBe(true);
    expect(s.brainKeepsHemorrhage).toBe(true);
    expect(s.brainKeepsSenile).toBe(true);
    expect(s.l34Preserved).toBe(true);
    expect(s.l45Updated).toBe(true);
    expect(s.l45OldGone).toBe(true);
    expect(s.macroKeepsDesiccation).toBe(true);
    expect(s.macroKeepsFacet).toBe(true);
    expect(s.spineTitle).toBe("MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING");
    expect(s.spineHasCervical).toBe(true);
    expect(s.spineHasDorsal).toBe(true);
    expect(s.limitedWording).toBe(true);
    expect(s.protectOutcome).toBe("preserved-manual");
    expect(s.protectKeepsEdit).toBe(true);
  });
});

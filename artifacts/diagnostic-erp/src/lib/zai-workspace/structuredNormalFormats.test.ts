/**
 * The Templates screen's row IS the Normal Format.
 *
 * Before this, the auto-open bootstrap read a hard-coded format library while
 * the Templates screen edited `structured_report_templates`, and the two never
 * met — so editing a normal report on screen could not change what printed, and
 * a sub-headed spine document written there was replaced by plain-paragraph
 * wording on open. These tests pin the consolidation, including the two ways it
 * could go wrong: shadowing a format that is not a normal baseline, and leaving
 * the resolver with more than one survivor for the same exam.
 */
import { describe, expect, it } from "vitest";
import {
  mergeStructuredNormalFormats,
  regionNameForBodyPart,
  structuredTemplateToNormalFormat,
  type StructuredNormalRow,
} from "./structuredNormalFormats";
import { isNormalBootstrapCandidate, resolveNormalBootstrapFormat } from "./normalBootstrap";
import { studyRegionToBodyPart } from "@/lib/pickStructuredTemplate";
import { DEFAULT_REPORT_FORMATS, saveFormats } from "./report-formats-library";
import { useWorkspace } from "./store";
import type { ReportFormat } from "./types";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const NOW = "2026-10-04T00:00:00.000Z";

const SPINE_BODY = `Alignment:
Normal lumbar lordosis maintained. No scoliosis or listhesis.

Disc Level Analysis:
L1-L2: Normal disc height and signal, no disc herniation and a patent neural foramen.
L4-L5: Normal disc height and signal, no disc herniation and a patent neural foramen.

Canal Diameter:
| Level | AP Canal (mm) |
| L1-L2 | — |
| L4-L5 | — |`;

function row(over: Partial<StructuredNormalRow> = {}): StructuredNormalRow {
  return {
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
    defaultFindings: SPINE_BODY,
    defaultImpression: "Normal MRI lumbo-sacral spine.",
    isActive: true,
    isDefault: true,
    ...over,
  };
}

describe("a Templates row as a Normal Format", () => {
  it("maps every template body part to a region name that maps back", () => {
    for (const code of ["SPINE_WHOLE", "SPINE_CERVICAL", "SPINE_DORSAL", "SPINE_LS", "BRAIN", "CHEST", "ABDOMEN"]) {
      const region = regionNameForBodyPart(code);
      expect(region, code).not.toBe("");
      expect(studyRegionToBodyPart(region), `${code} -> ${region}`).toBe(code);
    }
  });

  it("carries the row's own sub-headed findings, technique and recommendation", () => {
    const f = structuredTemplateToNormalFormat(row(), NOW)!;
    expect(f.findings).toBe(SPINE_BODY);
    expect(f.technique).toBe("MRI Lumbo-sacral Spine: T1W and T2W sagittal, T2W axial at disc levels.");
    expect(f.recommendation).toBe("Clinical correlation.");
    expect(f.bodyPart).toBe("LS Spine");
    expect(f.modality).toBe("MR");
    expect(f.structuredTemplateId).toBe(71);
    // An exam row is not named "…Normal", and must still qualify.
    expect(isNormalBootstrapCandidate(f)).toBe(true);
  });

  it("refuses a row that is not a complete normal report", () => {
    expect(structuredTemplateToNormalFormat(row({ defaultFindings: "  " }), NOW)).toBeNull();
    expect(structuredTemplateToNormalFormat(row({ defaultImpression: null }), NOW)).toBeNull();
    expect(structuredTemplateToNormalFormat(row({ isActive: false }), NOW)).toBeNull();
    // An ultrasound row must not become a bootstrap format: only MR/CT/XR scope.
    expect(structuredTemplateToNormalFormat(row({ modality: "USG", bodyPart: "ABDOMEN" }), NOW)).toBeNull();
  });

  it("never auto-applies a row whose body asserts pathology", () => {
    const pathological = row({
      defaultFindings: "Multiple acute infarcts with restricted diffusion in both territories.",
      defaultImpression: "Acute multifocal infarction.",
    });
    const f = structuredTemplateToNormalFormat(pathological, NOW)!;
    expect(isNormalBootstrapCandidate(f)).toBe(false);
  });
});

describe("merging rows into the format library", () => {
  it("adds the row without removing any built-in format", () => {
    const merged = mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, [row()]);
    const names = merged.map((f) => f.name);
    expect(names).toContain("MRI LS Spine");
    // The built-in baselines stay reachable: if this row is deleted or edited
    // into something incomplete, the exam must still have a normal.
    expect(names).toContain("MRI LS Spine — Normal");
    expect(names).toContain("MRI LS Spine — Disc herniation L4-L5");
    expect(merged.filter((f) => f.structuredTemplateId == null)).toHaveLength(DEFAULT_REPORT_FORMATS.length);
  });

  it("is idempotent — a refresh cannot accumulate duplicate normal formats", () => {
    const rows = [row()];
    const once = mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, rows);
    const twice = mergeStructuredNormalFormats(once, rows);
    expect(twice.filter((f) => f.structuredTemplateId != null)).toHaveLength(1);
    expect(twice.map((f) => f.id).sort()).toEqual(once.map((f) => f.id).sort());
  });

  it("clearing the rows restores the library exactly", () => {
    const cleared = mergeStructuredNormalFormats(
      mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, [row()]),
      [],
    );
    expect(cleared.map((f) => f.id).sort()).toEqual(DEFAULT_REPORT_FORMATS.map((f) => f.id).sort());
  });
});

describe("auto-open resolves the row the radiologist edits", () => {
  const lsCtx = buildReportingStudyContext({
    modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
  });

  it("applies the row's wording, not the hard-coded baseline", () => {
    const formats = mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, [row()]);
    const decision = resolveNormalBootstrapFormat({ ctx: lsCtx, formats });
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    expect(decision.format.structuredTemplateId).toBe(71);
    expect(decision.format.findings).toContain("Disc Level Analysis:");
    expect(decision.format.findings).toContain("| L4-L5 | — |");
  });

  it("follows the edit: renamed sections reach the auto-opened report", () => {
    const edited = row({
      defaultFindings: SPINE_BODY.replace("Disc Level Analysis:", "Disc Levels:"),
    });
    const formats = mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, [edited]);
    const decision = resolveNormalBootstrapFormat({ ctx: lsCtx, formats });
    if (decision?.status !== "apply") throw new Error("expected the edited row to resolve");
    expect(decision.format.findings).toContain("Disc Levels:");
    expect(decision.format.findings).not.toContain("Disc Level Analysis:");
  });

  it("falls back to the built-in baseline when the screen holds no normal for the exam", () => {
    const decision = resolveNormalBootstrapFormat({ ctx: lsCtx, formats: DEFAULT_REPORT_FORMATS });
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    expect(decision.format.name).toBe("MRI LS Spine — Standard Normal");
  });

  it("a plain brain study still resolves one format when a stroke row exists too", () => {
    const brainCtx = buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
    });
    const rows = [
      row({ id: 80, templateName: "MRI Brain", bodyPart: "BRAIN", studyType: "PLAIN", defaultFindings: "Brain parenchyma is normal in signal. No restricted diffusion.", defaultImpression: "Normal MRI brain." }),
      row({ id: 81, templateName: "MRI Brain Stroke Protocol", bodyPart: "BRAIN", studyType: "STROKE_PROTOCOL", defaultFindings: "No acute infarct on DWI/ADC.", defaultImpression: "No acute infarct." }),
    ];
    const formats = mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, rows);
    const decision = resolveNormalBootstrapFormat({ ctx: brainCtx, formats });
    if (decision?.status !== "apply") throw new Error(`expected apply, got ${JSON.stringify(decision)}`);
    expect(decision.format.name).toBe("MRI Brain");
  });

  it("a stroke study takes the stroke row, not the plain brain normal", () => {
    const strokeCtx = buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain Stroke Protocol", regions: ["Brain"], source: "auto",
    });
    const formats = mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, [
      row({ id: 80, templateName: "MRI Brain", bodyPart: "BRAIN", studyType: "PLAIN", defaultFindings: "Brain parenchyma is normal in signal.", defaultImpression: "Normal MRI brain." }),
      row({ id: 81, templateName: "MRI Brain Stroke Protocol", bodyPart: "BRAIN", studyType: "STROKE_PROTOCOL", defaultFindings: "No acute infarct on DWI/ADC.", defaultImpression: "No acute infarct." }),
    ]);
    const decision = resolveNormalBootstrapFormat({ ctx: strokeCtx, formats });
    if (decision?.status !== "apply") throw new Error(`expected apply, got ${JSON.stringify(decision)}`);
    expect(decision.format.name).toBe("MRI Brain Stroke Protocol");
  });
});

describe("the store holds the Templates rows as formats, and only in memory", () => {
  it("ingest puts the row in the library and repeated ingest does not duplicate it", () => {
    useWorkspace.setState({ reportFormats: DEFAULT_REPORT_FORMATS, structuredNormalRows: [] });
    useWorkspace.getState().ingestStructuredNormalFormats([row()]);
    const once = useWorkspace.getState().reportFormats;
    expect(once.filter((f) => f.structuredTemplateId === 71)).toHaveLength(1);

    useWorkspace.getState().ingestStructuredNormalFormats([row()]);
    expect(useWorkspace.getState().reportFormats.filter((f) => f.structuredTemplateId === 71)).toHaveLength(1);

    // Removing the row from the screen leaves the built-in baseline in place.
    useWorkspace.getState().ingestStructuredNormalFormats([]);
    const after = useWorkspace.getState().reportFormats;
    expect(after.filter((f) => f.structuredTemplateId != null)).toHaveLength(0);
    expect(after.map((f) => f.id).sort()).toEqual(DEFAULT_REPORT_FORMATS.map((f) => f.id).sort());
  });

  it("a Templates-derived format is never written to the local library", () => {
    const store: Record<string, string> = {};
    const actual = globalThis.localStorage;
    // @ts-expect-error test stub — localStorage is not defined under node.
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    try {
      saveFormats(mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, [row()]));
      const cached = JSON.parse(store["zai-rad-reportformats-v1"] ?? "[]") as ReportFormat[];
      expect(cached.some((f) => f.structuredTemplateId != null)).toBe(false);
      expect(cached).toHaveLength(DEFAULT_REPORT_FORMATS.length);
    } finally {
      globalThis.localStorage = actual;
    }
  });
});

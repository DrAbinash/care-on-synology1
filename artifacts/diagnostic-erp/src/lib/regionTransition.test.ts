/**
 * regionTransition.test.ts — PR E PRIORITY 3, Whole Spine ⇄ Cervical Spine and back.
 *
 * The rows come out of the real product: the whole-spine screening normal is applied
 * through the same store path a study uses at mount time, and its ledger rows are read
 * back. Hand-written fixtures would prove the module agrees with itself; these prove it
 * agrees with what CARE actually puts in the ledger today (measured: one
 * `screening_limitation` row scoped to "Whole Spine", then five cervical, five dorsal and
 * five lumbar `baseline` rows carrying `level: "cervical" | "dorsal" | "lumbar"`, and one
 * `normal_study` impression — seventeen rows in total).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import {
  applyPlanToFindingsText,
  coverageOfRegion,
  planRegionTransition,
  rowSegment,
  unownedLines,
  type TransitionRow,
} from "./regionTransition";

function ledgerRows(patches: AppliedPathologyPatch[]): TransitionRow[] {
  return patches.map((p) => ({
    id: p.id,
    role: p.observation?.role ?? null,
    concept: p.observation?.concept ?? null,
    region: p.observation?.region ?? null,
    level: p.observation?.level ?? null,
    // A row's contribution is whichever field it writes: the normals and the screening
    // limitation go to Findings, the normal-study Impression to Conclusion.
    text: (p.lastRendered.findings ?? "").trim() || (p.lastRendered.impression ?? "").trim(),
  })).filter((r) => r.text.length > 0);
}

function wholeSpineScreeningNormal() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    selectedFormatIds: [], pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, confirmOverwriteOpen: false, mergePreviewOpen: false,
    appliedFormatName: null, appliedFormatReportTitle: null, startingCanvasBaseline: null,
    isFinalized: false, isDirty: false, reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI SCREENING WHOLE SPINE",
      regions: ["Whole Spine"], source: "billed",
    }),
  });
  const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Whole Spine — Screening Normal")!;
  // Deliberately the plain one-argument call: this suite must not depend on #947's
  // `regionChoice` parameter, and the report the apply writes is the same either way.
  useWorkspace.getState().applyFormatById(format.id);
  const s = useWorkspace.getState();
  return { rows: ledgerRows(s.appliedPathologyPatches), findings: s.findingsText };
}

describe("the ledger a whole-spine screening normal actually produces", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  it("is seventeen rows spread over three segments plus a whole-spine scope", () => {
    const { rows } = wholeSpineScreeningNormal();
    const segments = rows.map((r) => rowSegment(r));
    expect(rows.length).toBe(17);
    expect(segments.filter((x) => x === "cervical")).toHaveLength(5);
    expect(segments.filter((x) => x === "dorsal")).toHaveLength(5);
    expect(segments.filter((x) => x === "lumbar")).toHaveLength(5);
    expect(segments.filter((x) => x === "whole")).toHaveLength(2);
    expect(segments.filter((x) => x === null)).toHaveLength(0);
  });
});

describe("Whole Spine → Cervical Spine", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  const transition = () => {
    const { rows, findings } = wholeSpineScreeningNormal();
    return { rows, findings, plan: planRegionTransition({ fromRegion: "Whole Spine", toRegion: "Cervical Spine", rows, findingsText: findings }) };
  };

  it("retires every normal that names anatomy the cervical exam does not cover", () => {
    const { plan } = transition();
    expect(plan.actionable).toBe(true);
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.retire).toHaveLength(12);
    const segments = plan.retire.map((r) => rowSegment(r));
    expect(new Set(segments)).toEqual(new Set(["dorsal", "lumbar", "whole"]));
    expect(segments.filter((x) => x === "cervical")).toHaveLength(0);
    // Positive control: the retired set really holds sentences a cervical report must not
    // print, so this cannot pass by classifying nothing.
    const retired = plan.retire.map((r) => r.text).join("\n");
    expect(retired).toContain("Dorsal spine:");
    expect(retired).toContain("Lumbar spine:");
    expect(retired).toContain("SCREENING STUDIES ARE LIMITED");
  });

  it("keeps the five cervical normals byte-identical", () => {
    const { plan, findings } = transition();
    const cervical = plan.keep.filter((r) => rowSegment(r) === "cervical");
    expect(cervical).toHaveLength(5);
    expect(cervical.every((r) => findings.includes(r.text))).toBe(true);
    expect(cervical.map((r) => r.concept).sort()).toEqual(
      ["alignment", "canal_stenosis", "compression_fracture", "cord_signal", "disc_contour"],
    );
  });

  it("takes only the retired sentences out of the findings text and changes nothing else", () => {
    const { plan, findings } = transition();
    const next = applyPlanToFindingsText(findings, plan);
    const before = findings.split("\n").map((l) => l.trim()).filter(Boolean);
    const after = next.split("\n").map((l) => l.trim()).filter(Boolean);
    // The findings field holds the limitation plus fifteen segment normals = sixteen
    // lines; twelve rows retire and one of them (the normal-study Impression) writes to
    // Conclusion, so eleven lines leave Findings and the fifth line of the report is
    // still the first cervical normal.
    expect(before).toHaveLength(16);
    expect(plan.retire.filter((r) => before.includes(r.text.trim()))).toHaveLength(11);
    expect(after).toHaveLength(5);
    expect(after).toEqual(before.filter((l) => l.startsWith("Cervical spine:")));
    expect(after.every((l) => plan.keep.some((r) => r.text.trim() === l))).toBe(true);
  });

  it("preserves what the radiologist typed themselves", () => {
    const { rows, findings } = wholeSpineScreeningNormal();
    const manual = "Prior C5-C6 discectomy with residual anterior fusion hardware.";
    const withManual = `${findings}\n${manual}\n`;
    const plan = planRegionTransition({ fromRegion: "Whole Spine", toRegion: "Cervical Spine", rows, findingsText: withManual });
    expect(plan.manualLines).toEqual([manual]);
    const next = applyPlanToFindingsText(withManual, plan);
    expect(next).toContain(manual);
    expect(unownedLines(next, rows)).toEqual([manual]);
  });

  it("keeps an out-of-region abnormality and says so instead of deleting it", () => {
    const { rows, findings } = wholeSpineScreeningNormal();
    const abnormal: TransitionRow = {
      id: "injected-d8-fracture", role: "abnormal", concept: "compression_fracture",
      region: "Dorsal Spine", level: "dorsal",
      text: "Dorsal spine: Wedge compression deformity of D8 with marrow oedema.",
    };
    const plan = planRegionTransition({
      fromRegion: "Whole Spine", toRegion: "Cervical Spine",
      rows: [...rows, abnormal], findingsText: `${findings}\n${abnormal.text}`,
    });
    expect(plan.outOfRegionAbnormalities.map((r) => r.id)).toEqual(["injected-d8-fracture"]);
    expect(plan.retire.some((r) => r.id === "injected-d8-fracture")).toBe(false);
    expect(plan.keep.some((r) => r.id === "injected-d8-fracture")).toBe(true);
    expect(applyPlanToFindingsText(`${findings}\n${abnormal.text}`, plan)).toContain("Wedge compression deformity of D8");
    expect(plan.summary).toContain("a finding does not disappear with the label");
  });

  it("records the transition with the reason each row went", () => {
    const { plan } = transition();
    const record = plan.record({ decidedBy: "abinashsingh@gmail.com", at: "2026-10-12T09:00:00.000Z" });
    expect(record.kind).toBe("care.region_transition.v1");
    expect(record.fromRegion).toBe("Whole Spine");
    expect(record.toRegion).toBe("Cervical Spine");
    expect(record.retired).toHaveLength(12);
    expect(record.retired[0]).toMatchObject({ id: expect.any(String), text: expect.any(String) });
    expect(record.retired.every((r) => r.text.length > 0)).toBe(true);
    expect(record.keptAbnormalities).toEqual([]);
    expect(record.decidedBy).toBe("abinashsingh@gmail.com");
    expect(record.at).toBe("2026-10-12T09:00:00.000Z");
  });

  it("never removes a row from the ledger — retirement is a flag, not a deletion", () => {
    const { plan, rows } = transition();
    // Every row the product holds is still accounted for: kept, or retired WITH its text.
    expect(plan.keep.length + plan.retire.length).toBe(rows.length);
    expect(plan.retire.every((r) => r.text.trim().length > 0)).toBe(true);
  });
});

describe("Cervical Spine → Whole Spine, and the transitions that must ask for nothing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  it("widening retires nothing and needs no confirmation", () => {
    const { rows, findings } = wholeSpineScreeningNormal();
    const cervicalOnly = planRegionTransition({ fromRegion: "Cervical Spine", toRegion: "Whole Spine", rows, findingsText: findings });
    expect(cervicalOnly.actionable).toBe(true);
    expect(cervicalOnly.requiresConfirmation).toBe(false);
    expect(cervicalOnly.retire).toEqual([]);
    expect(cervicalOnly.keep).toEqual(rows);
    expect(applyPlanToFindingsText(findings, cervicalOnly)).toBe(findings);
  });

  it("treats the same coverage under a different spelling as no transition at all", () => {
    const { rows, findings } = wholeSpineScreeningNormal();
    const same = planRegionTransition({ fromRegion: "Whole Spine", toRegion: "whole spine", rows, findingsText: findings });
    expect(same.actionable).toBe(false);
    expect(same.requiresConfirmation).toBe(false);
  });

  it("narrows Dorso-Lumbar to Cervical, and widens Dorso-Lumbar to Whole Spine", () => {
    const { rows, findings } = wholeSpineScreeningNormal();
    const toCervical = planRegionTransition({ fromRegion: "Dorso-Lumbar Spine", toRegion: "Cervical Spine", rows, findingsText: findings });
    expect(toCervical.requiresConfirmation).toBe(true);
    expect(new Set(toCervical.retire.map((r) => rowSegment(r)))).toEqual(new Set(["dorsal", "lumbar", "whole"]));
    const toWhole = planRegionTransition({ fromRegion: "Dorso-Lumbar Spine", toRegion: "Whole Spine", rows, findingsText: findings });
    expect(toWhole.retire).toEqual([]);
  });

  it("has no opinion outside the spine, or into the bare Spine tab", () => {
    const { rows, findings } = wholeSpineScreeningNormal();
    expect(planRegionTransition({ fromRegion: "Brain", toRegion: "Knee", rows, findingsText: findings }).actionable).toBe(false);
    expect(planRegionTransition({ fromRegion: "Whole Spine", toRegion: "Spine", rows, findingsText: findings }).actionable).toBe(false);
    expect(coverageOfRegion("Brain")).toBeNull();
    expect(coverageOfRegion("Spine")).toBeNull();
    expect([...coverageOfRegion("Cervical Spine")!]).toEqual(["cervical"]);
    expect([...coverageOfRegion("LS Spine")!]).toEqual(["lumbar"]);
    expect(coverageOfRegion("Whole Spine")!.size).toBe(3);
  });

  it("keeps a row it cannot place instead of guessing at anatomy", () => {
    const unplaceable: TransitionRow = {
      id: "no-segment", role: "baseline", concept: "alignment", region: null, level: "",
      text: "Alignment is within normal limits.",
    };
    const plan = planRegionTransition({
      fromRegion: "Whole Spine", toRegion: "Cervical Spine",
      rows: [unplaceable], findingsText: unplaceable.text,
    });
    expect(plan.unplaced.map((r) => r.id)).toEqual(["no-segment"]);
    expect(plan.retire).toEqual([]);
    expect(plan.requiresConfirmation).toBe(false);
    expect(applyPlanToFindingsText(unplaceable.text, plan)).toBe(unplaceable.text);
  });

  it("does not invent a segment from a level it was never given", () => {
    expect(rowSegment({ region: "Whole Spine", level: "", text: "" })).toBe("whole");
    expect(rowSegment({ region: null, level: null, text: "Thoracic spine: Normal kyphosis." })).toBe("dorsal");
    expect(rowSegment({ region: null, level: null, text: "No significant disc herniation." })).toBeNull();
    expect(rowSegment({ region: "Dorso-Lumbar Spine", level: "", text: "" })).toBeNull();
  });
});

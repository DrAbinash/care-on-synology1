import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statedLateralityConflict } from "@workspace/report-quality";
import {
  detectNegationConflict, detectLateralityConflict, isGrounded, detectContradictions, applyTrustGauntlet,
  type GauntletFinding,
} from "./findingValidation";

const snap = [{ seriesUid: "S1", sopUid: "I1" }, { seriesUid: "S2", sopUid: "I2" }];
const grounded = (key: string, text: string, extra: Partial<GauntletFinding> = {}): GauntletFinding => ({
  key, text, evidence: [{ findingKey: key, evidenceType: "image", seriesInstanceUid: "S1", sopInstanceUid: "I1" }], ...extra,
});

describe("finding validation gauntlet (G9)", () => {
  it("flags a negated statement asserted as a positive finding", () => {
    expect(detectNegationConflict(grounded("f", "no acute infarct"))).toMatch(/negation/);
    expect(detectNegationConflict(grounded("f", "acute infarct"))).toBeNull();
    expect(detectNegationConflict(grounded("f", "no acute infarct", { negated: true }))).toBeNull();
  });

  it("flags a stated laterality that conflicts with the text", () => {
    expect(detectLateralityConflict(grounded("f", "mass in the right kidney", { laterality: "left" }))).toMatch(/laterality/);
    expect(detectLateralityConflict(grounded("f", "mass in the right kidney", { laterality: "right" }))).toBeNull();
    expect(detectLateralityConflict(grounded("f", "midline mass", { laterality: "left" }))).toBeNull(); // text silent
  });

  it("judges laterality with the shared rule rather than a local copy", () => {
    // The workspace's observation ledger reads the same function for a side the
    // radiologist has typed over. A second spelling here would be a second rule to
    // keep honest, and the two would drift on the first report where it mattered —
    // which is the fault reportValidator.ts's header was rewritten to describe.
    const src = readFileSync(resolve(__dirname, "findingValidation.ts"), "utf8");
    expect(src).toContain('import { statedLateralityConflict } from "@workspace/report-quality";');
    expect(src).toContain("return statedLateralityConflict(f.laterality, f.text);");
    expect(src).not.toContain("lateralitiesInText");
    expect(src).not.toContain("\\bleft\\b");
    for (const [text, laterality] of [
      ["mass in the right kidney", "left"],
      ["mass in the right kidney", "right"],
      ["midline mass", "left"],
      ["bilateral masses", "left"],
      ["no mass", "none"],
    ] as const) {
      expect(detectLateralityConflict(grounded("f", text, { laterality }))).toBe(
        statedLateralityConflict(laterality, text),
      );
    }
  });

  it("grounds a finding only when an evidence anchor is in the snapshot", () => {
    expect(isGrounded(grounded("f", "nodule"), snap)).toBe(true);
    const ungrounded: GauntletFinding = { key: "f", text: "nodule", evidence: [{ findingKey: "f", evidenceType: "image", seriesInstanceUid: "S9", sopInstanceUid: "I9" }] };
    expect(isGrounded(ungrounded, snap)).toBe(false);
    expect(isGrounded({ key: "f", text: "nodule", evidence: [] }, snap)).toBe(false);
  });

  it("detects contradictions between two findings for the same entity", () => {
    const findings = [grounded("a", "left renal calculus", { laterality: "left" }), grounded("b", "right renal calculus", { laterality: "right" })];
    const flagged = detectContradictions(findings, []);
    expect(flagged.size).toBe(2);
  });

  it("detects a finding negated in the impression", () => {
    const findings = [grounded("a", "pulmonary nodule")];
    const flagged = detectContradictions(findings, ["no pulmonary nodule"]);
    expect(flagged.has("a")).toBe(true);
  });

  it("quarantines ungrounded findings and keeps grounded ones", () => {
    const ai: GauntletFinding[] = [
      grounded("keep", "liver lesion"),
      { key: "drop", text: "spleen lesion", evidence: [] }, // ungrounded
    ];
    const res = applyTrustGauntlet(ai, snap, []);
    expect(res.valid.map((f) => f.key)).toContain("keep");
    expect(res.quarantined.map((q) => q.finding.key)).toContain("drop");
  });

  it("lets a deterministic finding override an AI finding for the same entity", () => {
    const ai = [grounded("ai", "renal calculus")];
    const deterministic = [grounded("det", "renal calculus", { deterministic: true })];
    const res = applyTrustGauntlet(ai, snap, [], deterministic);
    expect(res.valid.some((f) => f.deterministic)).toBe(true);
    expect(res.quarantined.map((q) => q.finding.key)).toContain("ai"); // overridden
  });
});

import { describe, it, expect } from "vitest";
import {
  evaluateUsgReadiness, canEnableFlag, sugandhaModeProfile, USG_PHASE_PLAN,
  type UsgPhaseStatus,
} from "./usgProductionReadiness";

describe("P9 usgProductionReadiness — honest default state", () => {
  it("reports NOT production-ready by default (no phase clinic-validated)", () => {
    const r = evaluateUsgReadiness();
    expect(r.productionReady).toBe(false);
    expect(r.enableableNow).toEqual([]);
    expect(r.summary).toMatch(/not production-ready/i);
  });

  it("no default phase is marked clinic_validated (truthful)", () => {
    expect(USG_PHASE_PLAN.every((p) => p.validation !== "clinic_validated")).toBe(true);
  });
});

describe("P9 usgProductionReadiness — canEnableFlag safe-rollout rule", () => {
  const plan: UsgPhaseStatus[] = [
    { phase: "P0/P1", flag: "ff_radiology_usg_workspace", dependsOnFlags: [], validation: "clinic_validated" },
    { phase: "P2", flag: "ff_radiology_usg_companion_p2", dependsOnFlags: ["ff_radiology_usg_workspace"], validation: "clinic_validated" },
    { phase: "P3a", flag: "ff_radiology_usg_dicom_extraction", dependsOnFlags: [], validation: "code_complete" },
  ];

  it("allows a clinic-validated flag whose deps are enabled", () => {
    const d = canEnableFlag("ff_radiology_usg_companion_p2", plan, ["ff_radiology_usg_workspace"]);
    expect(d.canEnable).toBe(true);
  });

  it("blocks when a dependency is not yet enabled", () => {
    const d = canEnableFlag("ff_radiology_usg_companion_p2", plan, []);
    expect(d.canEnable).toBe(false);
    expect(d.blockers.join(" ")).toMatch(/must be enabled first/);
  });

  it("blocks a phase that is not clinic-validated regardless of deps", () => {
    const d = canEnableFlag("ff_radiology_usg_dicom_extraction", plan, []);
    expect(d.canEnable).toBe(false);
    expect(d.blockers.join(" ")).toMatch(/not clinic-validated/);
  });

  it("blocks an unknown flag", () => {
    expect(canEnableFlag("ff_radiology_nope", plan, []).canEnable).toBe(false);
  });
});

describe("P9 usgProductionReadiness — readiness aggregation", () => {
  it("surfaces enableable-now once a phase is validated and deps are on", () => {
    const plan: UsgPhaseStatus[] = [
      { phase: "P0/P1", flag: "ff_radiology_usg_workspace", dependsOnFlags: [], validation: "clinic_validated" },
    ];
    const r = evaluateUsgReadiness(plan, []);
    expect(r.enableableNow).toEqual(["ff_radiology_usg_workspace"]);
    expect(r.productionReady).toBe(true);
  });

  it("skips flags that are already enabled", () => {
    const plan: UsgPhaseStatus[] = [
      { phase: "P0/P1", flag: "ff_radiology_usg_workspace", dependsOnFlags: [], validation: "clinic_validated" },
    ];
    const r = evaluateUsgReadiness(plan, ["ff_radiology_usg_workspace"]);
    expect(r.enableableNow).toEqual([]);
    expect(r.blocked).toEqual([]);
  });
});

describe("P9 usgProductionReadiness — Sugandha mode profile", () => {
  it("is the curated P0–P2 baseline only and enables nothing on its own", () => {
    const p = sugandhaModeProfile();
    expect(p.flags).toEqual(["ff_radiology_usg_workspace", "ff_radiology_usg_companion_p2"]);
    expect(p.flags).not.toContain("ff_radiology_usg_ai_assistant");
    expect(p.note).toMatch(/only after a real staging\/clinic smoke/i);
  });
});

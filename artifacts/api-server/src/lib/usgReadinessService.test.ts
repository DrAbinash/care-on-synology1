import { describe, it, expect } from "vitest";
import {
  buildReadinessMatrix, decideEnable, killSwitchTargets, usgPhaseFlags,
} from "./usgReadinessService";

describe("Slice1 usgReadinessService — matrix", () => {
  it("reports every USG phase flag with code available and honest not-enabled default", () => {
    const matrix = buildReadinessMatrix({}); // nothing enabled
    expect(matrix.flags.length).toBe(usgPhaseFlags().length);
    expect(matrix.flags.every((f) => f.codeAvailable)).toBe(true);
    expect(matrix.enabledFlags).toEqual([]);
    expect(matrix.productionReady).toBe(false);
  });

  it("marks a flag enabled and surfaces its enabled dependents", () => {
    const live = {
      ff_radiology_usg_prior_intelligence: true,
      ff_radiology_usg_pregnancy_timeline: true,
    };
    const matrix = buildReadinessMatrix(live);
    const prior = matrix.flags.find((f) => f.flag === "ff_radiology_usg_prior_intelligence")!;
    expect(prior.enabled).toBe(true);
    expect(prior.enabledDependents).toContain("ff_radiology_usg_pregnancy_timeline");
    const timeline = matrix.flags.find((f) => f.flag === "ff_radiology_usg_pregnancy_timeline")!;
    expect(timeline.unmetDependencies).toEqual([]);
  });

  it("shows an unmet dependency when a dependent is checked but its parent is off", () => {
    const matrix = buildReadinessMatrix({ ff_radiology_usg_pregnancy_timeline: true });
    const timeline = matrix.flags.find((f) => f.flag === "ff_radiology_usg_pregnancy_timeline")!;
    expect(timeline.unmetDependencies).toContain("ff_radiology_usg_prior_intelligence");
  });
});

describe("Slice1 usgReadinessService — decideEnable (server-enforced gates)", () => {
  it("refuses a flag whose dependency is OFF (hard block, no force)", () => {
    const d = decideEnable("ff_radiology_usg_pregnancy_timeline", {}, { force: true, reason: "testing" });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("unmet_dependencies");
  });

  it("refuses a not-clinic-validated flag without force", () => {
    const d = decideEnable("ff_radiology_usg_prior_intelligence", {});
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("validation_pending");
  });

  it("allows a not-validated flag WITH force + reason (audited acknowledgement)", () => {
    const d = decideEnable("ff_radiology_usg_prior_intelligence", {}, { force: true, reason: "pilot staging test" });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.requiresForce).toBe(true);
  });

  it("rejects force with a too-short reason", () => {
    const d = decideEnable("ff_radiology_usg_prior_intelligence", {}, { force: true, reason: "x" });
    expect(d.ok).toBe(false);
  });

  it("rejects an unknown flag", () => {
    const d = decideEnable("ff_radiology_not_a_usg_flag", {}, { force: true, reason: "whatever" });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("unknown_flag");
  });

  it("is a no-op-OK for an already-enabled flag", () => {
    const d = decideEnable("ff_radiology_usg_prior_intelligence", { ff_radiology_usg_prior_intelligence: true });
    expect(d.ok).toBe(true);
  });
});

describe("Slice1 usgReadinessService — kill switch", () => {
  it("targets only enabled USG flags", () => {
    const { disabled } = killSwitchTargets({
      ff_radiology_usg_prior_intelligence: true,
      ff_radiology_usg_ob_canonical: false,
      ff_radiology_ai: true, // non-USG — must be ignored
    });
    expect(disabled).toEqual(["ff_radiology_usg_prior_intelligence"]);
  });
});

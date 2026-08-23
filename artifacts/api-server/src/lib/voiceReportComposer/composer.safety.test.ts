import { describe, expect, it } from "vitest";
import { deterministicCompose } from "./composer";
import { validateChangePlan } from "./validator";
import { normalizeComposerTranscript, extractLevels } from "./transcriptNormalize";

describe("voiceReportComposer safety", () => {
  const normalLs =
    "Lumbar vertebrae show normal alignment. Disc spaces are maintained. No significant disc bulge.";

  it("multi-level desiccation produces distinct observations per level", () => {
    const plan = deterministicCompose({
      transcript: "Disc desiccation at L3-4 and L4-5.",
      region: "LS Spine",
      findingsText: normalLs,
    });
    expect(plan?.observations.length).toBeGreaterThanOrEqual(2);
    const levels = plan!.observations.map((o) => o.level).filter(Boolean);
    expect(levels).toContain("L3-L4");
    expect(levels).toContain("L4-L5");
    expect(new Set(levels).size).toBe(levels.length);
  });

  it("multi-level bulges produce level-scoped conflict groups", () => {
    const plan = deterministicCompose({
      transcript: "Diffuse bulges at L3-4 and L4-5.",
      region: "LS Spine",
      findingsText: normalLs,
    });
    const groups = plan?.observations.map((o) => o.conflictGroup) ?? [];
    expect(groups.some((g) => g?.includes("L3-L4"))).toBe(true);
    expect(groups.some((g) => g?.includes("L4-L5"))).toBe(true);
  });

  it("modic changes at L4 and L5 are separate observations", () => {
    const plan = deterministicCompose({
      transcript: "Modic type II changes at L4 and L5.",
      region: "LS Spine",
      findingsText: normalLs,
    });
    expect(plan?.observations.length).toBeGreaterThanOrEqual(2);
  });

  it("correction with ambiguous levels requires clarification", () => {
    const norm = normalizeComposerTranscript(
      "Diffuse disc bulge at L4-5 correction L3-4 and L4-5",
      [
        { id: "a", concept: "disc_bulge", level: "L3-L4", findingsText: "bulge L3-4" },
        { id: "b", concept: "disc_bulge", level: "L4-L5", findingsText: "bulge L4-5" },
      ],
    );
    expect(norm.clarificationRequired).toBeTruthy();
  });

  it("negation removes last observation", () => {
    const plan = deterministicCompose({
      transcript: "No hemorrhage.",
      region: "Brain",
      priorObservations: [{
        id: "h1",
        concept: "hemorrhage",
        findingsText: "Acute hemorrhage in basal ganglia.",
      }],
    });
    expect(plan?.observations[0]?.operation).toBe("remove");
  });

  it("normal findings cannot generate abnormal impression", () => {
    const v = validateChangePlan({
      plan: {
        operation: "report_change_plan",
        observations: [],
        impressionUpdate: "Diffuse disc bulge at L4-L5 with stenosis.",
        uncertainties: [],
      },
      findingsText: normalLs,
      impressionText: "",
      generateImpressionOnly: true,
    });
    expect(v.ok).toBe(false);
  });

  it("impression laterality must match findings", () => {
    const v = validateChangePlan({
      plan: {
        operation: "report_change_plan",
        observations: [],
        impressionUpdate: "Left MCA territory infarct.",
        uncertainties: [],
      },
      findingsText: "Right MCA territory restricted diffusion.",
      impressionText: "",
      generateImpressionOnly: true,
    });
    expect(v.ok).toBe(false);
  });

  it("extractLevels finds all spinal levels in transcript", () => {
    const levels = extractLevels("Disc desiccation at L3-4 and L4-5.");
    expect(levels).toEqual(["L3-L4", "L4-L5"]);
  });
});

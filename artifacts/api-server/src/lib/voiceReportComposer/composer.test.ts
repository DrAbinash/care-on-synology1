import { describe, expect, it } from "vitest";
import { deterministicCompose } from "./composer";
import { validateChangePlan } from "./validator";
import { parseChangePlanJson } from "./schema";

describe("voiceReportComposer", () => {
  const normalLsFindings =
    "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No significant disc bulge.";

  it("dictated abnormality replaces conflicting normal baseline (deterministic)", () => {
    const plan = deterministicCompose({
      transcript: "Diffuse disc bulge at L4-5 with anterior thecal sac compression.",
      region: "LS Spine",
      findingsText: normalLsFindings,
    });
    expect(plan).not.toBeNull();
    expect(plan!.observations.some((o) => /bulge/i.test(o.findingsText))).toBe(true);
    const v = validateChangePlan({
      plan: plan!,
      findingsText: normalLsFindings,
      impressionText: "",
    });
    expect(v.ok).toBe(true);
  });

  it("malformed model JSON causes zero mutation path (parse fails)", () => {
    expect(parseChangePlanJson("not json at all")).toBeNull();
    expect(parseChangePlanJson("{ broken")).toBeNull();
  });

  it("ambiguous level blocks via clarificationRequired", () => {
    const plan = parseChangePlanJson(
      JSON.stringify({
        operation: "report_change_plan",
        observations: [],
        uncertainties: [],
        clarificationRequired: "Which level — L3-L4 or L4-L5?",
      }),
    );
    expect(plan).not.toBeNull();
    const v = validateChangePlan({
      plan: plan!,
      findingsText: normalLsFindings,
      impressionText: "",
    });
    expect(v.ok).toBe(false);
  });

  it("generate impression only from findings", () => {
    const plan = deterministicCompose({
      transcript: "generate impression",
      region: "LS Spine",
      findingsText: "Disc desiccation at L3-L4. Diffuse disc bulge at L4-L5.",
      generateImpressionOnly: true,
    });
    expect(plan?.impressionUpdate).toBeTruthy();
    const v = validateChangePlan({
      plan: plan!,
      findingsText: "Disc desiccation at L3-L4. Diffuse disc bulge at L4-L5.",
      impressionText: "",
      generateImpressionOnly: true,
    });
    expect(v.ok).toBe(true);
  });

  it("impression cannot introduce unsupported abnormality", () => {
    const plan = parseChangePlanJson(
      JSON.stringify({
        operation: "report_change_plan",
        observations: [],
        impressionUpdate: "Acute intraparenchymal hemorrhage in the basal ganglia.",
        uncertainties: [],
      }),
    )!;
    const v = validateChangePlan({
      plan,
      findingsText: normalLsFindings,
      impressionText: "",
      generateImpressionOnly: true,
    });
    expect(v.ok).toBe(false);
  });
});

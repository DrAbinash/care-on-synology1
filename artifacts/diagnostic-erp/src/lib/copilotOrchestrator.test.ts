import { describe, it, expect } from "vitest";
import { analyzeCopilot, type CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "MR", studyDescription: "MRI Brain", clinicalHistory: "Headache",
  findings: "", impression: [], recommendation: "", technique: "MRI performed.",
  selectedFindingLabels: [],
};
const ctx = (over: Partial<CopilotContext>): CopilotContext => ({ ...base, ...over });
const ids = (r: ReturnType<typeof analyzeCopilot>) => r.items.map((i) => i.id);
const byCat = (r: ReturnType<typeof analyzeCopilot>, c: string) => r.items.filter((i) => i.category === c);

describe("analyzeCopilot — missing observations", () => {
  it("prompts canal / foramina / nerve root for an LS disc bulge", () => {
    const r = analyzeCopilot(ctx({ studyDescription: "MRI LS Spine", findings: "Diffuse posterior disc bulge at L4-L5." }));
    expect(ids(r)).toEqual(expect.arrayContaining(["missing:ls-canal", "missing:ls-foramina", "missing:ls-nerve"]));
  });
  it("does NOT prompt for an observation already covered", () => {
    const r = analyzeCopilot(ctx({ studyDescription: "MRI LS Spine", findings: "Disc bulge at L4-L5 with mild central canal stenosis and bilateral neural foraminal narrowing." }));
    expect(ids(r)).not.toContain("missing:ls-canal");
    expect(ids(r)).not.toContain("missing:ls-foramina");
  });
  it("prompts SWI for a brain acute infarct", () => {
    const r = analyzeCopilot(ctx({ studyDescription: "MRI Brain", findings: "Acute infarct in the right MCA territory." }));
    expect(ids(r)).toContain("missing:brain-swi");
  });
  it("uses selected structured finding labels as context", () => {
    const r = analyzeCopilot(ctx({ studyDescription: "MRI LS Spine", findings: "", selectedFindingLabels: ["Disc Bulge"] }));
    expect(byCat(r, "missing").length).toBeGreaterThan(0);
  });
});

describe("analyzeCopilot — contradictions (Part 4)", () => {
  it("flags a normal-study phrase alongside an acute infarct", () => {
    const r = analyzeCopilot(ctx({ findings: "Normal study.", impression: ["Acute infarct right MCA territory."] }));
    const c = byCat(r, "contradiction");
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].severity).toBe("critical");
    expect(c[0].matchText).toBeTruthy();
  });
  it("flags “no disc bulge” with a described disc bulge", () => {
    const r = analyzeCopilot(ctx({ studyDescription: "MRI LS Spine", findings: "No disc bulge. Diffuse posterior disc bulge at L4-L5." }));
    expect(ids(r)).toContain("contradiction:con-nobulge");
  });
  it("stays silent when there is no contradiction", () => {
    const r = analyzeCopilot(ctx({ findings: "Age-appropriate appearances." }));
    expect(byCat(r, "contradiction")).toEqual([]);
  });
});

describe("analyzeCopilot — impression validator (Part 5)", () => {
  it("warns when an important finding is missing from a non-empty impression", () => {
    const r = analyzeCopilot(ctx({
      studyDescription: "MRI LS Spine",
      findings: "Moderate central canal stenosis at L4-L5.",
      impression: ["Degenerative lumbar spondylosis."],
    }));
    expect(ids(r)).toContain("impression:canal-stenosis");
  });
  it("warns when the impression claims something not in findings", () => {
    const r = analyzeCopilot(ctx({
      findings: "Age-appropriate appearances of the brain.",
      impression: ["Acute infarct in the left MCA territory."],
    }));
    expect(ids(r)).toContain("impression-basis:acute-infarct");
  });
});

describe("analyzeCopilot — recommendations & differentials", () => {
  it("suggests MRA for an acute infarct, insertable into recommendation", () => {
    const r = analyzeCopilot(ctx({ findings: "Acute infarct right MCA territory." }));
    const rec = r.items.find((i) => i.id === "recommendation:rec-mra");
    expect(rec).toBeTruthy();
    expect(rec!.insertTarget).toBe("recommendation");
    expect(rec!.insertText).toMatch(/angiography/i);
  });
  it("offers a differential for a ring-enhancing lesion", () => {
    const r = analyzeCopilot(ctx({ findings: "Ring-enhancing lesion in the left parietal lobe." }));
    const ddx = r.items.find((i) => i.id === "differential:ddx-ring");
    expect(ddx).toBeTruthy();
    expect(ddx!.detail).toMatch(/Neurocysticercosis/);
  });
  it("does not repeat a recommendation already written", () => {
    const r = analyzeCopilot(ctx({ findings: "Acute infarct.", recommendation: "MR angiography of the intracranial vessels is advised." }));
    expect(ids(r)).not.toContain("recommendation:rec-mra");
  });
});

describe("analyzeCopilot — measurement reminder (Part 10)", () => {
  it("reminds to measure a lesion with no size", () => {
    const r = analyzeCopilot(ctx({ findings: "A lesion is seen in the right frontal lobe." }));
    expect(ids(r)).toContain("measurement:lesion-size");
  });
  it("stays silent once a size is stated", () => {
    const r = analyzeCopilot(ctx({ findings: "A lesion measuring 12 mm is seen in the right frontal lobe." }));
    expect(ids(r)).not.toContain("measurement:lesion-size");
  });
});

describe("analyzeCopilot — quality score band (Part 8)", () => {
  it("Needs Review when findings and impression are empty", () => {
    expect(analyzeCopilot(ctx({})).quality.band).toBe("Needs Review");
  });
  it("scores higher with a complete report", () => {
    const r = analyzeCopilot(ctx({
      findings: "No disc bulge, herniation or canal stenosis at any level. Neural foramina are patent.",
      impression: ["No significant degenerative change."],
      recommendation: "Clinical correlation advised.",
    }));
    expect(r.quality.score).toBeGreaterThanOrEqual(65);
    expect(["Good", "Excellent"]).toContain(r.quality.band);
  });
});

describe("analyzeCopilot — safety & shape", () => {
  it("every item carries a why and a confidence, and nothing mutates input", () => {
    const input = ctx({ studyDescription: "MRI LS Spine", findings: "Disc bulge at L4-L5." });
    const snapshot = JSON.stringify(input);
    const r = analyzeCopilot(input);
    expect(JSON.stringify(input)).toBe(snapshot); // pure — no mutation
    for (const it of r.items) {
      expect(it.why).toBeTruthy();
      expect(["high", "medium", "low"]).toContain(it.confidence);
    }
  });
  it("orders critical items before info", () => {
    const r = analyzeCopilot(ctx({ studyDescription: "MRI LS Spine", findings: "No disc bulge. Disc bulge at L4-L5." }));
    const firstCritical = r.items.findIndex((i) => i.severity === "critical");
    const firstInfo = r.items.findIndex((i) => i.severity === "info");
    if (firstCritical >= 0 && firstInfo >= 0) expect(firstCritical).toBeLessThan(firstInfo);
  });
});

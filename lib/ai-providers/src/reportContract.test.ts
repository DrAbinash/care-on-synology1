import { describe, it, expect } from "vitest";
import { validateProvisionalReport, emptyProvisionalReport, projectSchemaForProvider } from "./reportContract";

describe("provisional-report contract validation + repair (G7)", () => {
  const good = {
    studyContext: { studyInstanceUid: "ST1", modality: "CT", imageCount: 3 },
    findings: [{ key: "f1", text: "nodule", evidence: [{ findingKey: "f1", evidenceType: "image", seriesInstanceUid: "S1", sopInstanceUid: "I1" }] }],
    measurements: [{ id: "SIZE", value: 5, unit: "mm" }],
    impression: ["small nodule"],
  };

  it("accepts a conforming object", () => {
    const r = validateProvisionalReport(good, "ST1");
    expect(r.ok).toBe(true);
    expect(r.data?.findings).toHaveLength(1);
  });

  it("parses a JSON string wrapped in prose/fences (repair)", () => {
    const raw = "Here is the report:\n```json\n" + JSON.stringify(good) + "\n```";
    const r = validateProvisionalReport(raw, "ST1");
    expect(r.ok).toBe(true);
    expect(r.repaired).toBe(true);
  });

  it("drops malformed findings but keeps the valid envelope (repair)", () => {
    const dirty = { studyContext: { studyInstanceUid: "ST1" }, findings: [{ nope: true }, good.findings[0]], measurements: [], impression: [] };
    const r = validateProvisionalReport(dirty, "ST1");
    expect(r.ok).toBe(true);
    expect(r.data?.findings).toHaveLength(1);
    expect(r.repaired).toBe(true);
  });

  it("rejects non-JSON garbage", () => {
    const r = validateProvisionalReport("not json at all", "ST1");
    expect(r.ok).toBe(false);
  });

  it("emptyProvisionalReport conforms to the contract", () => {
    const r = validateProvisionalReport(emptyProvisionalReport("ST1", "MR", 0), "ST1");
    expect(r.ok).toBe(true);
    expect(r.data?.findings).toEqual([]);
  });

  it("projects a provider-appropriate schema mode", () => {
    expect(projectSchemaForProvider("openai").mode).toBe("openai-json-schema");
    expect(projectSchemaForProvider("gemini").mode).toBe("gemini-response-schema");
    expect(projectSchemaForProvider("ollama").mode).toBe("ollama-format");
    expect(projectSchemaForProvider("something").mode).toBe("none");
  });
});

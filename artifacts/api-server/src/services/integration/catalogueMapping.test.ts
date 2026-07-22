// Catalogue-mapping resolver tests. resolveTest takes its executor as a
// parameter; we inject a thenable fake that yields queued result sets so we can
// prove the deterministic resolution ORDER (code → name → synonym → unmapped)
// without a database.
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test_integration";

let resolveTest: typeof import("./catalogueMapping").resolveTest;
let classifyModality: typeof import("./catalogueMapping").classifyModality;

beforeAll(async () => {
  const mod = await import("./catalogueMapping");
  resolveTest = mod.resolveTest;
  classifyModality = mod.classifyModality;
});

// Thenable fake: awaiting `.where(...)` OR `.limit()` yields the next queued set.
function execWith(queue: unknown[][]) {
  let i = 0;
  const take = () => queue[i++] ?? [];
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(take()),
    then: (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(take()).then(res, rej),
  };
  return chain as never;
}

const mapping = (over: Record<string, unknown> = {}) => ({
  id: 100, careTestId: 55, carePackageId: null, careDisplayName: "Complete Blood Count",
  department: "Pathology", modality: "Pathology", mappingType: "one_to_one", ...over,
});

describe("classifyModality", () => {
  it("routes imaging to radiology", () => {
    expect(classifyModality("USG", "Ultrasound")).toBe("radiology");
    expect(classifyModality("X-Ray", null)).toBe("radiology");
    expect(classifyModality("CT", "CT")).toBe("radiology");
    expect(classifyModality(null, "MRI")).toBe("radiology");
  });
  it("routes lab work to pathology", () => {
    expect(classifyModality("Pathology", null)).toBe("pathology");
    expect(classifyModality("Biochemistry", "chemistry")).toBe("pathology");
    expect(classifyModality(null, null)).toBe("pathology");
  });
});

describe("resolveTest deterministic order", () => {
  it("matches by source code first", async () => {
    const exec = execWith([[mapping()]]);
    const r = await resolveTest(exec, { sourceSystem: "HOPE", sourceCode: "CBC", sourceName: "Complete Blood Count" });
    expect(r.status).toBe("mapped");
    expect(r.matchedBy).toBe("code");
    expect(r.targets[0].careTestId).toBe(55);
  });

  it("falls back to exact normalized name when code misses", async () => {
    // code query empty, name query hits.
    const exec = execWith([[], [mapping()]]);
    const r = await resolveTest(exec, { sourceSystem: "HOPE", sourceCode: "UNKNOWN", sourceName: "Complete Blood Count" });
    expect(r.status).toBe("mapped");
    expect(r.matchedBy).toBe("name");
  });

  it("falls back to synonym when code and name miss", async () => {
    // code empty, name empty, synonym returns mappingIds, then mappings-by-ids.
    const exec = execWith([[], [], [{ mappingId: 100 }], [mapping()]]);
    const r = await resolveTest(exec, { sourceSystem: "HOPE", sourceCode: "X", sourceName: "Haemogram" });
    expect(r.status).toBe("mapped");
    expect(r.matchedBy).toBe("synonym");
  });

  it("returns unmapped (never a free-text guess) when nothing resolves", async () => {
    const exec = execWith([[], [], []]);
    const r = await resolveTest(exec, { sourceSystem: "HOPE", sourceCode: "ZZZ", sourceName: "Some Unknown Panel" });
    expect(r.status).toBe("unmapped");
    expect(r.matchedBy).toBe("none");
    expect(r.targets).toHaveLength(0);
  });

  it("supports one-HOPE-panel → many-CARE-tests (1:many)", async () => {
    const exec = execWith([[mapping({ id: 1, careTestId: 55 }), mapping({ id: 2, careTestId: 56, careDisplayName: "ESR" })]]);
    const r = await resolveTest(exec, { sourceSystem: "HOPE", sourceCode: "PANEL1", sourceName: "Custom Panel" });
    expect(r.status).toBe("mapped");
    expect(r.targets).toHaveLength(2);
    expect(r.targets.map((t) => t.careTestId)).toEqual([55, 56]);
  });
});

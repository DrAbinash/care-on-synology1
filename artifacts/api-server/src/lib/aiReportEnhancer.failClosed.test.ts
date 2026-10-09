/**
 * The legacy AI report enhancer must not invent clinical values (P0-8).
 *
 * On unparsable model output it used to write a placeholder row containing
 * `lesion_size 2.4 cm` and `density 45 HU` — numbers that were never measured
 * on any patient — plus an impression reading "AI impression — correlate
 * clinically." Because its prompt carried only a modality and an accession
 * number, every measurement it ever stored was invented. It now fails closed
 * and stores no measurement at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  study: null as Record<string, unknown> | null,
  modelText: "",
  modelSuccess: true,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/db", () => {
  // Drizzle is queryable both as `await q.where(...)` and `await q.where(...).limit(1)`,
  // so the fake has to be a promise that also carries `limit`.
  const rows = (data: unknown[]) => {
    const p = Promise.resolve(data) as Promise<unknown[]> & {
      limit: () => Promise<unknown[]>;
    };
    p.limit = async () => data;
    return p;
  };
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => rows(h.study ? [h.study] : []),
        }),
      }),
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          h.inserts.push(row);
          return [{ id: 1 }];
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
  };
});

const generateSpy = vi.hoisted(() => vi.fn());

vi.mock("@workspace/ai-providers", () => ({
  generateAiForTask: generateSpy,
}));

import { generateAiEnhancement } from "./aiReportEnhancer";

beforeEach(() => {
  h.study = { id: 7, modality: "CT", accessionNumber: "ACC-2610-0448" };
  h.inserts = [];
  h.modelSuccess = true;
  h.modelText = "";
  generateSpy.mockReset();
  generateSpy.mockImplementation(async () => ({
    success: h.modelSuccess,
    text: h.modelText,
  }));
});

describe("generateAiEnhancement — fail closed, never fabricate", () => {
  it("stores nothing when the model answer cannot be parsed", async () => {
    h.modelText = "I could not produce structured output today.";
    const result = await generateAiEnhancement(7);
    expect(result).toBeNull();
    expect(h.inserts).toHaveLength(0);
  });

  it("stores nothing when the answer parses but has no findings/impression", async () => {
    h.modelText = JSON.stringify({ findings: "", impression: "" });
    expect(await generateAiEnhancement(7)).toBeNull();
    expect(h.inserts).toHaveLength(0);
  });

  it("stores nothing when the provider itself failed", async () => {
    h.modelSuccess = false;
    h.modelText = "";
    expect(await generateAiEnhancement(7)).toBeNull();
    expect(h.inserts).toHaveLength(0);
  });

  it("never writes the old invented measurements, even on a good answer", async () => {
    h.modelText = JSON.stringify({
      findings: "Normal-aligned answer with invented numbers.",
      impression: "Invented impression.",
      measurements: [
        { type: "lesion_size", value: "2.4", unit: "cm" },
        { type: "density", value: "45", unit: "HU" },
      ],
    });
    const result = await generateAiEnhancement(7);
    expect(result).not.toBeNull();
    expect(result?.measurements).toEqual([]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].measurementExtractsJson).toBe("[]");
    const serialized = JSON.stringify(h.inserts[0]);
    expect(serialized).not.toContain("2.4");
    expect(serialized).not.toContain("45");
  });

  it("does not ask the model for example measurements any more", async () => {
    h.modelText = JSON.stringify({ findings: "f", impression: "i" });
    await generateAiEnhancement(7);
    const prompt = String((generateSpy.mock.calls[0] as unknown as Array<string>)[1]);
    expect(prompt).not.toMatch(/example measurement/i);
    expect(prompt).not.toMatch(/measurement/i);
    // The accession identifies the study and helps the model not at all.
    expect(prompt).not.toContain("ACC-2610-0448");
  });

  it("returns null for an unknown study instead of throwing", async () => {
    h.study = null;
    expect(await generateAiEnhancement(999)).toBeNull();
    expect(h.inserts).toHaveLength(0);
  });
});

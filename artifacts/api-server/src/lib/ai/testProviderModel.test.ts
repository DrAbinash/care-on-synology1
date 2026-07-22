import { describe, it, expect, vi } from "vitest";

// validateProviderModel is proven in lib/ai-providers; stub it to the real rules
// we depend on here (gemini family accept, cross-provider reject).
vi.mock("@workspace/ai-providers", () => ({
  validateProviderModel: (provider: string, model: string) => {
    if (provider === "gemini") return /^gemini[-.]/i.test(model) ? { ok: true } : { ok: false, message: `"${model}" is not a recognized gemini model.` };
    return { ok: true };
  },
}));

import { resolveTestModel } from "./testProviderModel";

describe("resolveTestModel — submitted model is honoured, stored default only when omitted", () => {
  it("uses the submitted model verbatim (regression: gemini-2.0-flash is not replaced)", () => {
    const r = resolveTestModel({ provider: "gemini", hasModelField: true, submitted: "gemini-2.0-flash", storedDefault: "gemini-1.5-flash" });
    expect(r).toEqual({ model: "gemini-2.0-flash" });
  });

  it("rejects an empty submitted model", () => {
    expect(resolveTestModel({ provider: "gemini", hasModelField: true, submitted: "", storedDefault: "gemini-1.5-pro" })).toEqual({ error: "Model cannot be empty." });
    expect(resolveTestModel({ provider: "gemini", hasModelField: true, submitted: "   ", storedDefault: null })).toEqual({ error: "Model cannot be empty." });
  });

  it("rejects an invalid provider/model combination cleanly", () => {
    const r = resolveTestModel({ provider: "gemini", hasModelField: true, submitted: "gpt-4o", storedDefault: null });
    expect(r).toMatchObject({ error: expect.stringContaining("not a recognized gemini model") });
  });

  it("uses the STORED default only when the model field is omitted", () => {
    expect(resolveTestModel({ provider: "gemini", hasModelField: false, storedDefault: "gemini-1.5-pro" })).toEqual({ model: "gemini-1.5-pro" });
  });

  it("returns undefined model (→ provider built-in probe) when omitted and no stored default", () => {
    expect(resolveTestModel({ provider: "gemini", hasModelField: false, storedDefault: null })).toEqual({ model: undefined });
  });
});

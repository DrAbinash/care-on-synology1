import { describe, expect, test, vi, beforeEach } from "vitest";

// P8 usg-ai router: flag gate (404 OFF) + the accept boundary maps a forged
// non-draft target to 403 (AI can never reach a signed report through the API).

let flags: Record<string, boolean>;
vi.mock("../lib/featureFlags", () => ({ isFeatureEnabledServer: async (k: string) => flags[k] ?? false }));
const generateUsgSuggestions = vi.fn();
vi.mock("../lib/usgAiService", async (orig) => {
  const actual = await orig<typeof import("../lib/usgAiService")>();
  return { ...actual, generateUsgSuggestions: (...a: unknown[]) => generateUsgSuggestions(...a) };
});
vi.mock("../lib/logger", () => ({ logger: { warn: () => {} } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runChain(router: any, method: string, path: string, req: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method} ${path} not found`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mws = router.stack.filter((l: any) => !l.route && typeof l.handle === "function").map((l: any) => l.handle);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = [...mws, ...layer.route.stack.map((s: any) => s.handle)];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  let idx = 0;
  const next = async () => { if (idx < handlers.length) await handlers[idx++](req, res, next); };
  await next();
  return res;
}

beforeEach(() => { flags = { ff_radiology_usg_ai_assistant: true }; generateUsgSuggestions.mockReset(); });

describe("P8 usg-ai router", () => {
  test("404s when ff_radiology_usg_ai_assistant is OFF", async () => {
    flags = {};
    const { default: router } = await import("./usgAi");
    const res = await runChain(router, "post", "/studies/:studyId/suggest", { params: { studyId: "1" }, body: {} });
    expect(res.statusCode).toBe(404);
  });

  test("accept appends to a draft for a valid accept-only suggestion", async () => {
    const { buildUsgAiSuggestion } = await import("../lib/usgAiAssistant");
    const suggestion = buildUsgAiSuggestion({ kind: "finding", text: "Hepatomegaly.", rationale: "r", confidence: 0.8 });
    const { default: router } = await import("./usgAi");
    const res = await runChain(router, "post", "/accept", { body: { currentText: "Liver enlarged.", suggestion, accepted: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body.text).toContain("Hepatomegaly.");
  });

  test("accept REFUSES (403) a forged suggestion targeting a signed report", async () => {
    const { buildUsgAiSuggestion } = await import("../lib/usgAiAssistant");
    const forged = { ...buildUsgAiSuggestion({ kind: "finding", text: "x", rationale: "r", confidence: 0.5 }), writeTarget: "patient_reports" };
    const { default: router } = await import("./usgAi");
    const res = await runChain(router, "post", "/accept", { body: { currentText: "", suggestion: forged, accepted: true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("ai_write_violation");
  });

  test("400 when no suggestion is provided to /accept", async () => {
    const { default: router } = await import("./usgAi");
    const res = await runChain(router, "post", "/accept", { body: {} });
    expect(res.statusCode).toBe(400);
  });
});

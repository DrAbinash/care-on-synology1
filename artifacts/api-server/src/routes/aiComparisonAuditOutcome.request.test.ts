import { describe, expect, test, vi, beforeEach } from "vitest";

// POST /api/ai-comparison/run and /save-winner — the two comparison writers in the
// same audit table the interactive routes write.
//
// The arm row filed `success: result.success`, which is "the HTTP call finished".
// An arm that answered 200 with an empty body, or answered under a provider other
// than the arm's own, was therefore recorded as a generation the clinic can point
// at. `/save-winner` is the other half of the ambiguity the owner named: it files
// `success: true` for an event where nobody asked a model anything — a clinician
// picking a winner. Both rows now say which writer made them, and only the
// generation rows may claim a generation.

let auditInserts: Record<string, unknown>[];

vi.mock("@workspace/db", () => {
  const aiProviderSettingsTable = {};
  const aiReportingAuditLogsTable = { marker: "ai_reporting_audit_logs" };
  const radiologyStudiesTable = { marker: "radiology_studies" };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            (table as { marker?: string })?.marker === "radiology_studies" ? [{ id: 5 }] : [],
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if ((table as { marker?: string })?.marker === "ai_reporting_audit_logs") auditInserts.push(vals);
        return Promise.resolve([{ id: 1 }]);
      },
    }),
  };
  return { db, aiProviderSettingsTable, aiReportingAuditLogsTable, radiologyStudiesTable };
});

vi.mock("../middleware/requireStaffAuth", () => ({
  FULL_ACCESS_ROLES: new Set(["admin", "super_admin", "radiologist"]),
}));

// The egress gate and the capability probe have their own tests; this file is about
// what the writer records, so both are pinned to "allowed / known" and stay out of
// the way.
vi.mock("../lib/ai/aiSecurityPolicy", () => ({
  resolveInteractiveImageEgress: async () => ({ options: {}, allowed: true }),
  resolveAiSecurityPolicy: async () => ({ mode: "development", cloudVisionAllowed: true }),
}));
vi.mock("../lib/ai/localModelCapabilities", () => ({
  cachedOllamaModelCapability: async () => ({ supportsVision: true, source: "api_show" }),
  declaredCapability: () => ({ supportsVision: true, source: "registry" }),
}));

interface Identity {
  provider: string;
  model: string | null;
  locality: "local" | "cloud";
  timeoutMs: number;
  attempted: boolean;
}

const generateAiResponse = vi.fn();

vi.mock("@workspace/ai-providers", () => ({
  BUILTIN_PROVIDER_NAMES: ["gemini", "openai", "ollama", "deepseek"],
  BUILTIN_PROVIDER_CONFIGS: {},
  generateAiResponse: (p: string, prompt: string, images: string[], opts?: { model?: string }) =>
    generateAiResponse(p, prompt, images, opts),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { aiComparisonRouter as router } from "./aiComparison";

function getHandler(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router as any).stack.find((l: any) => l.route && l.route.path === path);
  if (!layer) throw new Error(`POST ${path} handler not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function makeReq(body: Record<string, unknown>) {
  return {
    body,
    staffSession: { subjectId: 7, subjectName: "Dr. Sugandha", role: "radiologist", permissions: [] },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
}

const runHandler = getHandler("/run");
const saveWinnerHandler = getHandler("/save-winner");

function armAnswer(
  provider: string,
  text: string,
  over: { success?: boolean; error?: string; model?: string | null } = {},
) {
  return {
    success: over.success ?? true,
    text,
    error: over.error,
    execution: {
      provider,
      model: over.model ?? null,
      locality: provider === "ollama" ? "local" : "cloud",
      timeoutMs: 60_000,
      attempted: true,
    } as Identity,
  };
}

beforeEach(() => {
  auditInserts = [];
  generateAiResponse.mockReset();
});

describe("POST /api/ai-comparison/run — one row per arm, honest about what it records", () => {
  test("an arm that answers 200 with no text is not filed as a successful generation", async () => {
    generateAiResponse.mockImplementation(async (p: string) => armAnswer(p, "   "));
    const res = makeRes();
    await runHandler(
      makeReq({ prompt: "Compare these two frames.", arms: [{ provider: "ollama", model: "gemma3:12b" }] }),
      res,
    );

    expect(auditInserts).toHaveLength(1);
    const row = auditInserts[0];
    expect(row.success).toBe(false);
    expect(String(row.errorMessage)).not.toBe("");
    expect(row.jobReference).toBe("ai_comparison_run:0");
    expect(String(row.correlationId).length).toBeGreaterThan(8);
    // The screen gets the same id, so a clinician can quote the row they are looking at.
    expect(res.body.requestId).toBe(row.correlationId);
  });

  test("an arm that answered under a different provider than the arm named is not a success", async () => {
    // The arm asks for ollama; the execution layer reports gemini. Nothing here can
    // say which model the clinician is comparing, so nothing may claim the record.
    generateAiResponse.mockImplementation(async () => armAnswer("gemini", "A disc protrusion is seen."));
    const res = makeRes();
    await runHandler(makeReq({ prompt: "Compare.", arms: [{ provider: "ollama" }] }), res);

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].success).toBe(false);
    expect(String(auditInserts[0].errorMessage).toLowerCase()).toMatch(/attribut|confirm|provider/);
  });

  test("an arm that produced text under the provider it was asked for is still a success", async () => {
    generateAiResponse.mockImplementation(async (p: string) => armAnswer(p, "No acute abnormality."));
    const res = makeRes();
    await runHandler(makeReq({ prompt: "Compare.", arms: [{ provider: "ollama" }] }), res);

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].success).toBe(true);
    expect(auditInserts[0].errorMessage).toBeNull();
    expect(auditInserts[0].endpointLocality).toBe("local");
  });

  test("the arms of one run share one correlation id and differ by arm reference", async () => {
    generateAiResponse.mockImplementation(async (p: string) => armAnswer(p, "Text from " + p));
    const res = makeRes();
    await runHandler(
      makeReq({ prompt: "Compare.", arms: [{ provider: "ollama" }, { provider: "gemini" }] }),
      res,
    );

    expect(auditInserts).toHaveLength(2);
    expect(auditInserts[0].correlationId).toBe(auditInserts[1].correlationId);
    expect(auditInserts.map((r) => r.jobReference)).toEqual(["ai_comparison_run:0", "ai_comparison_run:1"]);
  });
});

describe("POST /api/ai-comparison/save-winner — a human choice, not a generation", () => {
  test("names its writer so the shared table cannot read it as a clinical generation", async () => {
    const res = makeRes();
    await saveWinnerHandler(
      makeReq({
        prompt: "Compare.",
        provider: "ollama",
        model: "gemma3:12b",
        response: "No acute abnormality.",
      }),
      res,
    );

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].jobReference).toBe("ai_comparison_winner");
    expect(String(auditInserts[0].correlationId).length).toBeGreaterThan(8);
    // Unchanged on purpose: nothing was generated here, and the row is not allowed
    // to imply it was — which is why it must be recognisable as a selection.
    expect(auditInserts[0].success).toBe(true);
  });
});

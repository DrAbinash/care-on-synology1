import { describe, expect, test, vi, beforeEach } from "vitest";

// PR1-A coverage: POST /api/ai-reporting/query request contract.
//
// Root cause under test: the workstation surfaces send `promptText`, but the
// handler used to destructure only `prompt`, silently dropping the
// radiologist's findings and falling back to a generic hardcoded prompt with
// zero images. These tests prove:
//   - promptText (canonical) reaches the provider adapter verbatim
//   - legacy `prompt` alias still works; promptText wins when both are sent
//   - an empty effective prompt is a 400, never a silent generic draft
//   - provider/model passthrough is unchanged
//   - maxImages: 0 is a text-only query (no image fetch, numImages 0)
//   - malformed bodies are rejected with a clear validation error
//
// Follows the same no-HTTP-server technique as featureFlags.test.ts /
// clinicSettings.test.ts: reach into the Express Router's internal stack and
// invoke the real handler with fake req/res (no supertest in this repo).

let settingsJson: string;
let templateRows: Array<{ promptContent: string }>;
let auditInserts: Record<string, unknown>[];
let pacsSettingsQueries: number;
const { masterAiFlagState } = vi.hoisted(() => ({
  masterAiFlagState: { enabled: true },
}));

vi.mock("../lib/featureFlags", () => ({
  isFeatureEnabledServer: async (key: string) =>
    key === "ff_radiology_ai" ? masterAiFlagState.enabled : false,
}));

vi.mock("@workspace/db", () => {
  const aiProviderSettingsTable = { provider: "provider", settingsJson: "settings_json" };
  const aiPromptTemplatesTable = { name: "name", isActive: "is_active", promptContent: "prompt_content", id: "id" };
  const pacsSettingsTable = { key: "key", category: "category", value: "value" };
  const patientsTable = { id: "id", firstName: "first_name", lastName: "last_name", ageValue: "age_value", gender: "gender" };
  const aiReportingAuditLogsTable = { marker: "ai_reporting_audit_logs" };

  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === pacsSettingsTable) pacsSettingsQueries += 1;
        const resolve = () => {
          if (table === aiProviderSettingsTable) return [{ settingsJson }];
          if (table === aiPromptTemplatesTable) return templateRows;
          if (table === pacsSettingsTable) return [];
          return [];
        };
        const limitChain = { limit: async () => resolve() };
        return {
          where: () => ({
            ...limitChain,
            orderBy: () => limitChain,
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if ((table as { marker?: string })?.marker === "ai_reporting_audit_logs") auditInserts.push(vals);
        return Promise.resolve([]);
      },
    }),
  };

  return {
    db,
    aiProviderSettingsTable,
    aiReportingAuditLogsTable,
    aiReportingDraftsTable: {},
    aiPromptTemplatesTable,
    pacsSettingsTable,
    patientsTable,
    aiDicomFindingsTable: {},
    ragDocumentEmbeddingsTable: {},
    ragSearchQueriesTable: {},
    anomalyAlertsTable: {},
    reportTemplateVersionsTable: {},
    aiBillingSuggestionsTable: {},
    peerReviewAssignmentsTable: {},
    turnaroundTimesTable: {},
    aiTrainingDataExportsTable: {},
    reportQualityGatesTable: {},
    criticalFindingsTable: {},
    aiProviderHealthLogsTable: {},
    aiVoiceTranscriptionsTable: {},
    aiPatientCommunicationsTable: {},
    aiNormalReportTemplatesTable: {},
    patientReportsTable: {},
    radiologyStudiesTable: {},
  };
});

vi.mock("@workspace/db/schema", () => ({
  radiologyWorklistTable: {},
}));

vi.mock("../middleware/requireStaffAuth", () => ({
  FULL_ACCESS_ROLES: new Set(["admin", "super_admin"]),
}));

vi.mock("../lib/cryptoUtils", () => ({ encryptSecret: vi.fn() }));
vi.mock("../lib/ai/testProviderModel", () => ({ resolveTestModel: vi.fn() }));
vi.mock("../lib/ai/embeddings", () => ({
  embedText: vi.fn(),
  parseEmbedding: vi.fn(),
  serializeEmbedding: vi.fn(),
  cosineSimilarity: vi.fn(),
  isEmbeddingAvailable: () => false,
}));

const generateAiResponse = vi.fn(async (_provider: string, _prompt: string, _images: string[], _opts: { model?: string }) => ({
  success: true,
  text: "AI DRAFT RESPONSE",
  error: undefined as string | undefined,
}));

vi.mock("@workspace/ai-providers", () => ({
  BUILTIN_PROVIDER_NAMES: ["gemini", "openai"],
  BUILTIN_PROVIDER_CONFIGS: {},
  loadProviderConfigs: vi.fn(async () => ({})),
  loadProviderConfig: vi.fn(async () => ({ isEnabled: true, defaultModel: "gemini-default" })),
  createAiProvider: vi.fn(),
  getProviderApiKey: vi.fn(),
  getProviderEndpointUrl: vi.fn(),
  generateAiResponse: (provider: string, prompt: string, images: string[], opts: { model?: string }) =>
    generateAiResponse(provider, prompt, images, opts),
  resolveTaskRoute: vi.fn(async () => null),
  generateAiForTask: vi.fn(),
  getDefaultProviderName: vi.fn(() => "gemini"),
}));

import { aiReportingRouter as router } from "./aiReporting";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(method: "get" | "post", path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router as any).stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function makeReq(body: Record<string, unknown>) {
  return {
    body,
    staffSession: {
      subjectId: 7,
      subjectName: "Dr. Sugandha",
      role: "radiologist",
      permissions: ["ai_reporting.use"],
    },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
}

const queryHandler = getRouteHandler("post", "/query");

beforeEach(() => {
  masterAiFlagState.enabled = true;
  settingsJson = JSON.stringify({
    enabled: true,
    defaultProvider: "gemini",
    defaultPrompt: "",
    includeDemographics: false,
    anonymize: false,
    allowedRoles: [],
  });
  templateRows = [];
  auditInserts = [];
  pacsSettingsQueries = 0;
  generateAiResponse.mockClear();
});

describe("POST /api/ai-reporting/query — canonical prompt contract", () => {
  test("promptText (the workstation's findings) reaches the provider adapter verbatim", async () => {
    const res = makeRes();
    const findings = "FINDINGS: 6 mm posterior disc protrusion at L4-L5 indenting the thecal sac.";
    await queryHandler(makeReq({ promptText: findings, provider: "gemini", maxImages: 0 }), res);

    expect(res.statusCode).toBe(200);
    expect(generateAiResponse).toHaveBeenCalledTimes(1);
    const [provider, prompt] = generateAiResponse.mock.calls[0];
    expect(provider).toBe("gemini");
    expect(prompt).toContain(findings);
    expect(res.body.aiResponse).toBe("AI DRAFT RESPONSE");
    expect(res.body.promptSource).toBe("request");
    expect(res.body.promptChars).toBeGreaterThanOrEqual(findings.length);
    // Audit log records the real prompt, not a generic fallback.
    expect(auditInserts).toHaveLength(1);
    expect(String(auditInserts[0]["promptText"])).toContain("disc protrusion");
  });

  test("legacy `prompt` alias still works (backward compatibility)", async () => {
    const res = makeRes();
    await queryHandler(makeReq({ prompt: "Legacy caller prompt", provider: "gemini", maxImages: 0 }), res);
    expect(res.statusCode).toBe(200);
    expect(generateAiResponse.mock.calls[0][1]).toContain("Legacy caller prompt");
    expect(res.body.promptSource).toBe("request");
  });

  test("promptText wins when both promptText and prompt are sent", async () => {
    const res = makeRes();
    await queryHandler(makeReq({ promptText: "CANONICAL", prompt: "LEGACY", provider: "gemini", maxImages: 0 }), res);
    const prompt = generateAiResponse.mock.calls[0][1];
    expect(prompt).toContain("CANONICAL");
    expect(prompt).not.toContain("LEGACY");
  });

  test("REGRESSION: empty effective prompt is a 400 validation error — the provider is never called with a generic draft prompt", async () => {
    const res = makeRes();
    await queryHandler(makeReq({ provider: "gemini", maxImages: 0 }), res);
    expect(res.statusCode).toBe(400);
    expect(String(res.body.error)).toMatch(/prompt/i);
    expect(generateAiResponse).not.toHaveBeenCalled();
    expect(auditInserts).toHaveLength(0);
  });

  test("whitespace-only promptText is treated as empty (400)", async () => {
    const res = makeRes();
    await queryHandler(makeReq({ promptText: "   \n  ", provider: "gemini", maxImages: 0 }), res);
    expect(res.statusCode).toBe(400);
    expect(generateAiResponse).not.toHaveBeenCalled();
  });

  test("template still resolves when no prompt is sent (promptSource: template)", async () => {
    templateRows = [{ promptContent: "DB TEMPLATE CONTENT" }];
    const res = makeRes();
    await queryHandler(makeReq({ templateName: "MRI Spine Report", provider: "gemini", maxImages: 0 }), res);
    expect(res.statusCode).toBe(200);
    expect(generateAiResponse.mock.calls[0][1]).toContain("DB TEMPLATE CONTENT");
    expect(res.body.promptSource).toBe("template");
  });

  test("admin-configured default prompt is preserved (promptSource: settings-default)", async () => {
    settingsJson = JSON.stringify({ enabled: true, defaultPrompt: "Clinic default prompt", allowedRoles: [] });
    const res = makeRes();
    await queryHandler(makeReq({ provider: "gemini", maxImages: 0 }), res);
    expect(res.statusCode).toBe(200);
    expect(generateAiResponse.mock.calls[0][1]).toContain("Clinic default prompt");
    expect(res.body.promptSource).toBe("settings-default");
  });

  test("clinical history is appended to the effective prompt", async () => {
    const res = makeRes();
    await queryHandler(makeReq({ promptText: "Findings here", clinicalHistory: "Post-op day 3", provider: "gemini", maxImages: 0 }), res);
    expect(generateAiResponse.mock.calls[0][1]).toContain("Clinical History: Post-op day 3");
  });

  test("provider and model pass through unchanged to the adapter and response", async () => {
    const res = makeRes();
    await queryHandler(makeReq({ promptText: "x", provider: "openai", model: "gpt-x", maxImages: 0 }), res);
    expect(res.statusCode).toBe(200);
    const [provider, , , opts] = generateAiResponse.mock.calls[0];
    expect(provider).toBe("openai");
    expect(opts).toMatchObject({ model: "gpt-x" });
    expect(res.body.provider).toBe("openai");
    expect(res.body.model).toBe("gpt-x");
  });

  test("maxImages: 0 is a text-only query — no image fetch (Orthanc never consulted), numImages 0", async () => {
    const res = makeRes();
    await queryHandler(
      makeReq({ promptText: "x", provider: "gemini", studyInstanceUID: "1.2.840.113619.2.55.3", maxImages: 0 }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.numImages).toBe(0);
    expect(generateAiResponse.mock.calls[0][2]).toEqual([]);
    expect(pacsSettingsQueries).toBe(0); // fetchStudyImages short-circuited
  });

  test("malformed body is rejected with a clear validation error", async () => {
    for (const bad of [
      { promptText: "x", maxImages: -1 },
      { promptText: 42 },
      { promptText: "x", studyInstanceUID: "../../etc/passwd" },
      { promptText: "x", patientId: "abc" },
    ]) {
      const res = makeRes();
      await queryHandler(makeReq(bad as Record<string, unknown>), res);
      expect(res.statusCode).toBe(400);
      expect(String(res.body.error)).toContain("Invalid AI query request");
    }
    expect(generateAiResponse).not.toHaveBeenCalled();
  });

  test("AI Reporting disabled → 403 (ff_radiology_ai master flag off)", async () => {
    masterAiFlagState.enabled = false;
    settingsJson = JSON.stringify({ enabled: false });
    const res = makeRes();
    await queryHandler(makeReq({ promptText: "x" }), res);
    expect(res.statusCode).toBe(403);
    expect(generateAiResponse).not.toHaveBeenCalled();
  });
});

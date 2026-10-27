import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";

// AI audit correctness — what one row's `success` column is allowed to mean.
//
// `ai_reporting_audit_logs.success` is read by the audit page and by anyone
// answering "did the AI produce a report the radiologist could use?". The
// gateway's own contract says a null `failure` is the only state in which a call
// "may be recorded and returned as a success" (interactiveAiGateway.ts:161), and
// `normalizeAiFailure` returns EMPTY_RESPONSE for a provider that answered 200
// with no text (aiFailureContract.ts:163). `/draft` obeys both; `/query`,
// `/polish`, `/image-review` and `/compare` computed `success` from transport
// and identity alone, so an empty answer was filed as a successful clinical
// generation — `/query` even wrote a non-null `error_message` on the same row,
// making the row assert and deny the same thing at once.
//
// These tests drive the real handlers (same no-HTTP-server technique as
// aiReporting.query.test.ts) and read the audit insert each route makes.
//
// Every fixture is synthetic. No patient, no real study, no real pixels.

let settingsJson: string;
let auditInserts: Record<string, unknown>[];
let patientReportRows: Array<Record<string, unknown>>;
/** Non-empty only if a route asks Orthanc for frames; empty means text-only. */
let pacsRows: Array<{ value: string }> = [];

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
  const aiReportingAuditLogsTable = { marker: "ai_reporting_audit_logs" };
  const aiReportingDraftsTable = { marker: "ai_reporting_drafts" };
  const patientReportsTable = { marker: "patient_reports" };

  const db = {
    select: () => ({
      from: (table: unknown) => {
        const resolve = () => {
          if (table === aiProviderSettingsTable) return [{ settingsJson }];
          if (table === aiPromptTemplatesTable) return [];
          if (table === pacsSettingsTable) return pacsRows;
          if (table === patientReportsTable) return patientReportRows;
          return [];
        };
        const limitChain = { limit: async () => resolve() };
        return {
          where: () => ({ ...limitChain, orderBy: () => limitChain }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const marker = (table as { marker?: string })?.marker;
        if (marker === "ai_reporting_audit_logs") auditInserts.push(vals);
        const thenable = Promise.resolve([{ id: 4242 }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (thenable as any).returning = async () => [{ id: 4242 }];
        return thenable;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: (vals: Record<string, unknown>) => {
        auditInserts.push({ __update: vals });
        return { where: async () => [] };
      },
    }),
  };

  return {
    db,
    aiProviderSettingsTable,
    aiReportingAuditLogsTable,
    aiReportingDraftsTable,
    aiPromptTemplatesTable,
    pacsSettingsTable,
    patientReportsTable,
    patientsTable: {},
    radiologyWorklistTable: {},
    radiologyStudiesTable: {},
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
  };
});

vi.mock("@workspace/db/schema", () => ({
  radiologyWorklistTable: {},
  radiologyReportDraftsTable: {},
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

vi.mock("../lib/aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: async () => ({ ollamaBaseUrl: "http://127.0.0.1:11434", ollamaNumCtx: 8192 }),
}));

// `/image-review` binds the request to a study through the identity layer. The
// binding itself is pinned in radiologyIdentity's own tests; here the question is
// what the route FILES once it has a study, so the UID is handed over. Built in
// `vi.hoisted` because the factory below is lifted above these bindings.
const { FakeRadiologyIdentityError } = vi.hoisted(() => {
  class E extends Error {
    httpStatus = 403;
    code = "FAKE";
  }
  return { FakeRadiologyIdentityError: E };
});
vi.mock("../lib/radiologyIdentity", () => ({
  RadiologyIdentityError: FakeRadiologyIdentityError,
  resolveAuthorizedStudyUid: async () => "1.2.826.0.1 synthetic-study",
}));

interface AdapterIdentity {
  provider: string;
  model: string | null;
  locality: "local" | "cloud";
  timeoutMs: number;
  attempted: boolean;
}

function identityFor(provider: string, model?: string | null): AdapterIdentity {
  return {
    provider,
    model: model ?? null,
    locality: provider === "ollama" || provider === "local_openai_compatible" ? "local" : "cloud",
    timeoutMs: 300_000,
    attempted: true,
  };
}

const generateAiResponse = vi.fn(
  async (
    provider: string,
    _prompt: string,
    _images: string[],
    opts: { model?: string } = {},
  ) => ({
    success: true,
    text: "AI DRAFT RESPONSE",
    error: undefined as string | undefined,
    execution: identityFor(provider, opts?.model),
  }),
);

const generateAiForTask = vi.fn(
  async (
    _task: string,
    _prompt: string,
    _images: string[],
    _opts?: { model?: string },
  ) => ({
    success: true,
    text: "COMPARISON: two new findings, none resolved.",
    error: undefined as string | undefined,
    execution: identityFor("gemini", _opts?.model),
  }),
);

/**
 * Queue one answer. The identity is derived from the provider the route actually
 * asked for, so a fixture can never claim an attribution the handler did not get.
 */
function nextAnswer(
  mock: typeof generateAiResponse | typeof generateAiForTask,
  text: string,
  over: {
    success?: boolean;
    error?: string;
    execution?: Partial<AdapterIdentity>;
  } = {},
) {
  mock.mockImplementationOnce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (provider: any, _prompt: string, _images: string[], opts: any = {}) => ({
      success: over.success ?? true,
      text,
      error: over.error,
      execution: { ...identityFor(String(provider), opts?.model), ...(over.execution ?? {}) },
    }),
  );
}

vi.mock("@workspace/ai-providers", () => ({
  BUILTIN_PROVIDER_NAMES: ["gemini", "openai", "ollama"],
  BUILTIN_PROVIDER_CONFIGS: {},
  loadProviderConfigs: vi.fn(async () => ({})),
  loadProviderConfig: vi.fn(async () => ({ isEnabled: true, defaultModel: "gemini-default" })),
  createAiProvider: vi.fn(),
  getProviderApiKey: vi.fn(),
  getProviderEndpointUrl: vi.fn(),
  generateAiResponse: (provider: string, prompt: string, images: string[], opts: { model?: string }) =>
    generateAiResponse(provider, prompt, images, opts),
  resolveTaskRoute: vi.fn(async () => null),
  generateAiForTask: (task: string, prompt: string, images: string[], opts?: { model?: string }) =>
    generateAiForTask(task, prompt, images, opts),
  getDefaultProviderName: vi.fn(() => "gemini"),
  isLocalExecutionProvider: (p: string) => p === "ollama" || p === "local_openai_compatible",
  classifyEffectiveLocality: (providerName: string, resolvedUrl: string | null) => {
    let host: string | null;
    try {
      host = resolvedUrl ? new URL(resolvedUrl).hostname : "";
    } catch {
      host = null;
    }
    if (["openai", "deepseek", "qwen", "gemini", "anthropic"].includes(providerName)) {
      return { locality: "cloud", validatedHost: host || null, reason: `${providerName} is cloud by registry` };
    }
    if (!resolvedUrl) return { locality: "local", validatedHost: null, reason: "no endpoint resolved" };
    if (host === null) return { locality: "cloud", validatedHost: null, reason: "unparseable URL fails closed" };
    const isPrivate =
      /^localhost$/i.test(host) ||
      /^127\.\d+\.\d+\.\d+$/.test(host) ||
      /^10\.\d+\.\d+\.\d+$/.test(host) ||
      /^192\.168\.\d+\.\d+$/.test(host);
    if (isPrivate) return { locality: "local", validatedHost: host, reason: "private/LAN address" };
    return { locality: "cloud", validatedHost: host, reason: "public internet address" };
  },
  cloudTextPhiAllowed: async () => false,
  detectPhiCategories: (t: string) => (/\bPatient\s*:/i.test(t) ? ["name"] : []),
  scrubPhiText: (t: string) => ({
    text: t.replace(/\bPatient\s*:.*$/im, "Patient: [REDACTED]"),
    removedCategories: ["name"],
    removedCount: 1,
  }),
  // Mirrors lib/ai-providers/src/aiFailureContract.ts: a 200 whose text is blank
  // IS a failure (EMPTY_RESPONSE). That is the verdict the routes must obey.
  normalizeAiFailure: (
    result: {
      success?: boolean;
      text?: string;
      error?: string;
      execution?: AdapterIdentity | null;
    },
    override?: { code: string; message?: string; detailCode?: string | null },
  ) => {
    if (!override && result?.success && String(result.text ?? "").trim()) return null;
    return {
      code: override?.code ?? (result?.success ? "EMPTY_RESPONSE" : "UNKNOWN"),
      message:
        override?.message ??
        result?.error ??
        "The AI provider answered but produced no usable text.",
      provider: result?.execution?.provider ?? "unknown",
      model: result?.execution?.model ?? null,
      locality: result?.execution?.locality ?? "cloud",
      attempted: result?.execution?.attempted ?? true,
      timeoutMs: result?.execution?.timeoutMs ?? 0,
      detailCode: override?.detailCode ?? null,
    };
  },
  redactAiSecrets: (t: string) => String(t ?? "").replace(/\bsk-[A-Za-z0-9_-]{10,}/g, "sk-[REDACTED]"),
}));

import { aiReportingRouter as router } from "./aiReporting";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(method: "get" | "post", path: string): any {
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
const polishHandler = getRouteHandler("post", "/polish");
const imageReviewHandler = getRouteHandler("post", "/image-review");
const compareHandler = getRouteHandler("post", "/compare");

/** The one route-level shape each handler needs to get as far as the audit row. */
const ROUTES = [
  {
    name: "/query",
    handler: () => queryHandler,
    body: { promptText: "FINDINGS: 6 mm disc protrusion at L4-L5.", provider: "gemini", maxImages: 0 },
    answer: generateAiResponse,
    prepare: () => {},
  },
  {
    name: "/polish",
    handler: () => polishHandler,
    body: { text: "there is a 6mm protrusion at l4-l5 indenting the thecal sac" },
    answer: generateAiResponse,
    prepare: () => {},
  },
  {
    // `/image-review` refuses a study with no frames (aiReporting.ts:1921), so the
    // pixel path has to be served or the handler never reaches the model. Ollama is
    // the provider because a cloud image send in Clinical mode is stopped at the
    // egress gate before inference — a correct refusal, but not the one under test.
    name: "/image-review",
    handler: () => imageReviewHandler,
    body: { studyInstanceUID: "1.2.826.0.1 synthetic-study", reportBody: "FINDINGS: as above." },
    answer: generateAiResponse,
    prepare: () => {
      settingsJson = JSON.stringify({
        enabled: true,
        defaultProvider: "ollama",
        defaultPrompt: "",
        includeDemographics: false,
        anonymize: false,
        allowedRoles: [],
      });
      pacsRows = [{ value: "http://orthanc.internal:9000" }];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown) => {
          const url = String(input);
          const json = (data: unknown) =>
            new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
          if (url.endsWith("/rendered")) {
            return new Response(new Uint8Array(JPEG_BYTES), { headers: { "content-type": "image/jpeg" } });
          }
          if (url.endsWith("/instances")) {
            return json([{ "00080018": { Value: ["1.2.826.0.1.instance.1"] } }]);
          }
          if (url.endsWith("/series")) {
            return json([{ "0020000E": { Value: ["1.2.826.0.1.series.1"] } }]);
          }
          return json([]);
        }),
      );
    },
  },
  {
    // `/compare` resolved its provider twice: `getDefaultProviderName()` for the
    // audit row and `generateAiForTask("report_enhancement")` for the call. C1
    // fixed that for `/polish` (aiReporting.ts:1814) and left this one; after the
    // fix it reaches the model through the gateway like every other route.
    name: "/compare",
    handler: () => compareHandler,
    body: { worklistId: 11, previousReportId: 22 },
    answer: generateAiResponse,
    prepare: () => {},
  },
] as const;

/** Synthetic JPEG bytes — no patient data, ever. */
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, ...Array.from({ length: 900 }, (_, i) => (i * 7) % 251), 0xff, 0xd9,
]);

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
  auditInserts = [];
  pacsRows = [];
  patientReportRows = [
    { id: 22, title: "MRI LS Spine", body: "FINDINGS: previous study.", impression: "IMPRESSION: previous." },
  ];
  // `mockReset`, not `mockClear`: a queued `mockImplementationOnce` the previous
  // case never consumed (a route that returned early) would otherwise answer the
  // NEXT case, and the failure would be the harness's, not the route's.
  generateAiResponse.mockReset();
  generateAiForTask.mockReset();
  generateAiResponse.mockImplementation(
    async (provider: string, _p: string, _i: string[], opts: { model?: string } = {}) => ({
      success: true,
      text: "AI DRAFT RESPONSE",
      error: undefined,
      execution: identityFor(provider, opts?.model),
    }),
  );
  generateAiForTask.mockImplementation(async (_t: string, _p: string, _i: string[], opts: { model?: string } = {}) => ({
    success: true,
    text: "COMPARISON: two new findings, none resolved.",
    error: undefined,
    execution: identityFor("gemini", opts?.model),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI audit `success` — an answer with no usable content is not a successful generation", () => {
  test.each(ROUTES.map((r) => [r.name, r] as const))(
    "%s files an empty-but-successful provider answer as success = false with a named cause",
    async (_name, route) => {
      // The provider answers 200 with whitespace only — the exact shape that today
      // reaches the audit table as a successful clinical generation.
      nextAnswer(route.answer as typeof generateAiResponse, "   \n  ");
      route.prepare();
      const res = makeRes();
      await route.handler()(makeReq(route.body as unknown as Record<string, unknown>), res);

      expect(auditInserts, "the route must still file its audit row").toHaveLength(1);
      const row = auditInserts[0];
      expect(row.success, "no usable content must not be recorded as a successful generation").toBe(false);
      expect(typeof row.errorMessage).toBe("string");
      expect(String(row.errorMessage).trim(), "the row must name why it failed").not.toBe("");
    },
  );

  test.each(ROUTES.map((r) => [r.name, r] as const))(
    "%s still files success = true when the provider answers with real text",
    async (_name, route) => {
      route.prepare();
      const res = makeRes();
      await route.handler()(makeReq(route.body as unknown as Record<string, unknown>), res);

      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].success).toBe(true);
      expect(auditInserts[0].errorMessage).toBeNull();
    },
  );

  test.each(ROUTES.map((r) => [r.name, r] as const))(
    "%s files a transport failure as success = false (unchanged behaviour, pinned so the fix cannot widen it)",
    async (_name, route) => {
      nextAnswer(
        route.answer as typeof generateAiResponse,
        "",
        { success: false, error: "Provider timed out after 300000 ms" },
      );
      route.prepare();
      const res = makeRes();
      await route.handler()(makeReq(route.body as unknown as Record<string, unknown>), res);

      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].success).toBe(false);
      expect(String(auditInserts[0].errorMessage)).toContain("timed out");
    },
  );

  test.each(ROUTES.map((r) => [r.name, r] as const))(
    "%s files an unattributable answer as success = false",
    async (_name, route) => {
      nextAnswer(route.answer as typeof generateAiResponse, "LOOKS PERFECT", {
        execution: identityFor("deepseek", null),
      });
      route.prepare();
      const res = makeRes();
      await route.handler()(makeReq(route.body as unknown as Record<string, unknown>), res);

      expect(auditInserts).toHaveLength(1);
      expect(auditInserts[0].success).toBe(false);
      expect(String(auditInserts[0].errorMessage).toLowerCase()).toMatch(/attribut|confirm|identity|provider/);
    },
  );
});

describe("AI audit traceability — every generation row can be traced to its writer and its request", () => {
  test.each(ROUTES.map((r) => [r.name, r] as const))(
    "%s records which writer made the row and a correlation id the clinician can quote",
    async (_name, route) => {
      route.prepare();
      const res = makeRes();
      await route.handler()(makeReq(route.body as unknown as Record<string, unknown>), res);

      expect(auditInserts).toHaveLength(1);
      const row = auditInserts[0];
      expect(typeof row.jobReference).toBe("string");
      expect(String(row.jobReference)).toMatch(/^ai_(query|polish|image_review|compare)(:|$)/);
      expect(typeof row.correlationId).toBe("string");
      expect(String(row.correlationId).trim().length).toBeGreaterThan(8);
      // The id has to reach the caller too, or a radiologist reporting a bad
      // answer cannot point at the row that recorded it.
      expect(String(res.body?.requestId ?? "")).toBe(String(row.correlationId));
    },
  );
});

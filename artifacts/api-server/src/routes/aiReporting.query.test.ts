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
let draftInserts: Record<string, unknown>[];
let pacsSettingsQueries: number;
const { masterAiFlagState } = vi.hoisted(() => ({
  masterAiFlagState: { enabled: true },
}));

// The one draft row the canonical canal read resolves for a numeric `worklistId`.
// Shared object identity because the module under test imports the table from
// `@workspace/db/schema` while the fake query dispatcher lives in the `@workspace/db`
// mock — two different objects would silently mean "no draft", i.e. no canal data.
const { canalDraftState } = vi.hoisted(() => ({
  canalDraftState: {
    table: {
      id: "id",
      studyId: "study_id",
      worklistId: "worklist_id",
      patientId: "patient_id",
      updatedAt: "updated_at",
      structuredJson: "structured_json",
    } as Record<string, string>,
    rows: [] as Record<string, unknown>[],
    fails: false,
  },
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
  const aiReportingDraftsTable = { marker: "ai_reporting_drafts" };

  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === pacsSettingsTable) pacsSettingsQueries += 1;
        const resolve = () => {
          if (table === aiProviderSettingsTable) return [{ settingsJson }];
          if (table === aiPromptTemplatesTable) return templateRows;
          if (table === pacsSettingsTable) return [];
          if (table === canalDraftState.table) {
            if (canalDraftState.fails) throw new Error("vitest: radiology_report_drafts is unavailable");
            return canalDraftState.rows;
          }
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
        const marker = (table as { marker?: string })?.marker;
        if (marker === "ai_reporting_audit_logs") auditInserts.push(vals);
        if (marker === "ai_reporting_drafts") draftInserts.push(vals);
        const thenable = Promise.resolve([{ id: 4242 }]);
        // POST /draft persists the draft with .returning({ id }) before it audits.
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
  radiologyReportDraftsTable: canalDraftState.table,
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

// POST /draft resolves the local runtime before it sizes the context window.
vi.mock("../lib/aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: async () => ({ ollamaBaseUrl: "http://127.0.0.1:11434", ollamaNumCtx: 8192 }),
}));

/**
 * C1 — the identity a real provider arm reports back after it answers.
 *
 * Every arm of `generateAiResponse` now returns which provider and model opened
 * the socket, whether the call left the clinic, and which deadline governed it.
 * The routes refuse to record an answer that cannot be attributed, so a fixture
 * returning bare `{success, text}` would describe an execution layer that had
 * lost track of its own calls — and the handler under test would (correctly)
 * refuse every one of them.
 *
 * Built when a call happens, never at factory time: the mock factory below is
 * hoisted above these bindings.
 */
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

// POST /draft used to go out through generateAiForTask, which resolved a provider
// of its own. C1 routes it through the gateway, which calls the one function that
// talks to a model with the provider already chosen — so `/draft` is now asserted
// against `generateAiResponse`, exactly like `/query`.
const generateAiForTask = vi.fn(
  async (
    _task: string,
    _prompt: string,
    _images: string[],
    _opts?: { model?: string; numCtx?: number; endpointUrl?: string; think?: boolean },
  ) => ({
    success: true,
    text: "FINDINGS: unremarkable.\nIMPRESSION: No acute intracranial abnormality.",
    error: undefined as string | undefined,
    execution: identityFor("gemini", _opts?.model),
  }),
);

/**
 * Queue one model answer on the adapter, tagged with the identity of whatever is
 * answering. The provider is taken from the call itself — the same rule the real
 * arms follow — so a fixture can never claim an identity the route did not ask for.
 */
function nextAnswer(
  mock: typeof generateAiResponse,
  text: string,
  over: { success?: boolean; error?: string; execution?: Partial<ReturnType<typeof identityFor>> } = {},
) {
  mock.mockImplementationOnce(
    async (provider: string, _prompt: string, _images: string[], opts: { model?: string } = {}) => ({
      success: over.success ?? true,
      text,
      error: over.error,
      execution: { ...identityFor(provider, opts?.model), ...(over.execution ?? {}) },
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
  generateAiForTask: (
    task: string,
    prompt: string,
    images: string[],
    opts?: { model?: string; numCtx?: number; endpointUrl?: string; think?: boolean },
  ) => generateAiForTask(task, prompt, images, opts),
  getDefaultProviderName: vi.fn(() => "gemini"),
  // The egress preview composes these. Detection/scrubbing themselves have
  // dedicated tests in lib/ai-providers/src/phiText.test.ts — what is pinned
  // here is that the route wires them into its verdict.
  isLocalExecutionProvider: (p: string) => p === "ollama" || p === "local_openai_compatible",
  cloudTextPhiAllowed: async () => false,
  detectPhiCategories: (t: string) => (/\bPatient\s*:/i.test(t) ? ["name"] : []),
  scrubPhiText: (t: string) => ({
    text: t.replace(/\bPatient\s*:.*$/im, "Patient: [REDACTED]"),
    removedCategories: ["name"],
    removedCount: 1,
  }),
  // C1 — the failure normalizer and the secret redactor the gateway and the
  // routes call. Both are pure functions of the result object, and their real
  // behaviour (nine codes, PHI-vs-image precedence, bounded secret-free messages)
  // is pinned in lib/ai-providers/src/aiFailureContract.test.ts. They are mirrored
  // here at the same depth as `detectPhiCategories` above, because this file mocks
  // the whole module: every fixture in this file succeeds, so what the route needs
  // from the normalizer is "no failure" — and the identity of what answered.
  normalizeAiFailure: (result: {
    success?: boolean;
    text?: string;
    error?: string;
    execution?: { provider: string; model: string | null; locality: "local" | "cloud"; timeoutMs: number; attempted: boolean };
    diagnostics?: { httpStatus?: number | null; errorCode?: string | null; errorMessage?: string | null; provider?: string };
  }, override?: { code: string; message?: string; detailCode?: string | null }) => {
    // The caller's override is what only the caller can know — the provider
    // answered correctly and the answer cannot be read as the section asked for.
    if (!override && result?.success && String(result.text ?? "").trim()) return null;
    const httpStatus = result?.diagnostics?.httpStatus ?? 0;
    return {
      code: override?.code
        ?? (result?.success ? "EMPTY_RESPONSE" : httpStatus >= 400 ? "PROVIDER_HTTP_ERROR" : "UNKNOWN"),
      message:
        override?.message
        ?? result?.diagnostics?.errorMessage
        ?? result?.error
        ?? "The AI request failed for an unclassified reason.",
      provider: result?.execution?.provider ?? result?.diagnostics?.provider ?? "unknown",
      model: result?.execution?.model ?? null,
      locality: result?.execution?.locality ?? "cloud",
      attempted: result?.execution?.attempted ?? true,
      timeoutMs: result?.execution?.timeoutMs ?? 0,
      detailCode: override ? (override.detailCode ?? null) : (result?.diagnostics?.errorCode ?? null),
    };
  },
  redactAiSecrets: (t: string) => String(t ?? "").replace(/\bsk-[A-Za-z0-9_-]{10,}/g, "sk-[REDACTED]"),
}));

import { aiReportingRouter as router } from "./aiReporting";
import { STRUCTURED_JSON_ENVELOPE_KIND } from "../lib/structuredJsonColumn";

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
const draftHandler = getRouteHandler("post", "/draft");
const previewHandler = getRouteHandler("post", "/egress-preview");

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
  draftInserts = [];
  pacsSettingsQueries = 0;
  canalDraftState.rows = [];
  canalDraftState.fails = false;
  generateAiResponse.mockClear();
  generateAiForTask.mockClear();
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

describe("POST /api/ai-reporting/query — the privacy record must describe what happened", () => {
  // The audit log is a compliance artefact. It used to copy the "Anonymize
  // Patient Data" setting, so switching it on filed a positive record of a
  // control that does not exist: no DICOM tag is stripped and no burned-in
  // overlay is masked anywhere in this codebase.

  const withAnonymizeOn = () => {
    settingsJson = JSON.stringify({
      enabled: true,
      defaultProvider: "gemini",
      defaultPrompt: "",
      includeDemographics: true,
      anonymize: true,
      allowedRoles: [],
    });
  };

  test("anonymize ON does not make the audit row claim identifiers were removed", async () => {
    withAnonymizeOn();
    const res = makeRes();
    await queryHandler(makeReq({ promptText: "Findings", provider: "gemini", maxImages: 0 }), res);

    expect(res.statusCode).toBe(200);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]["anonymized"]).toBe(false);
    expect(res.body.anonymized).toBe(false);
  });

  test("anonymize ON no longer tells the model identifiers were removed", async () => {
    withAnonymizeOn();
    const res = makeRes();
    await queryHandler(makeReq({ promptText: "Findings", provider: "gemini", maxImages: 0 }), res);

    const prompt = String(generateAiResponse.mock.calls[0][1]);
    expect(prompt).not.toMatch(/identifiers have been removed/i);
    expect(prompt).toMatch(/NOT de-identified/);
    expect(prompt).toMatch(/[Dd]o not transcribe any identifier/);
  });

  test("the setting still governs behaviour it can actually govern: demographics stay out", async () => {
    withAnonymizeOn();
    const res = makeRes();
    await queryHandler(
      makeReq({ promptText: "Findings", provider: "gemini", maxImages: 0, patientId: 11 }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(auditInserts[0]["includedDemographics"]).toBe(false);
    expect(String(generateAiResponse.mock.calls[0][1])).not.toMatch(/Patient:|DOB/i);
  });
});

describe("POST /api/ai-reporting/draft — the report body must reach the model", () => {
  // Ctrl+I in the reporting workspace calls this route. It used to post the
  // typed findings under `findings` while the handler destructured `reportBody`,
  // so the model was asked for an impression without ever being given the
  // findings it was supposed to summarise — and the mismatch was invisible
  // because the caller only console.warns.

  const body = "Extra-axial CSF space prominent frontally. No midline shift.";

  test("reportBody is appended to the prompt as the current findings", async () => {
    settingsJson = JSON.stringify({
      enabled: true, defaultProvider: "gemini", defaultPrompt: "Draft an impression.",
      includeDemographics: false, anonymize: false, allowedRoles: [],
    });
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: body, modality: "CT", provider: "gemini" }), res);

    expect(res.statusCode).toBe(200);
    expect(generateAiResponse).toHaveBeenCalledTimes(1);
    const prompt = String(generateAiResponse.mock.calls[0][1]);
    expect(prompt).toContain("Current Findings:");
    expect(prompt).toContain(body);
  });

  test("REGRESSION: the `findings` key older bundles send is not silently dropped", async () => {
    settingsJson = JSON.stringify({
      enabled: true, defaultProvider: "gemini", defaultPrompt: "Draft an impression.",
      includeDemographics: false, anonymize: false, allowedRoles: [],
    });
    const res = makeRes();
    await draftHandler(makeReq({ findings: body, modality: "CT", provider: "gemini" }), res);

    expect(res.statusCode).toBe(200);
    const prompt = String(generateAiResponse.mock.calls[0][1]);
    expect(prompt).toContain("Current Findings:");
    expect(prompt).toContain(body);
  });

  test("reportBody wins when a caller sends both keys with different text", async () => {
    settingsJson = JSON.stringify({
      enabled: true, defaultProvider: "gemini", defaultPrompt: "Draft an impression.",
      includeDemographics: false, anonymize: false, allowedRoles: [],
    });
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: "CANONICAL BODY", findings: "LEGACY BODY", provider: "gemini" }), res);

    const prompt = String(generateAiResponse.mock.calls[0][1]);
    expect(prompt).toContain("CANONICAL BODY");
    expect(prompt).not.toContain("LEGACY BODY");
  });
});

describe("POST /api/ai-reporting/draft — the `field` the workstation sends is honoured", () => {
  // RW-02. Ctrl+I has always posted `field: "impression"` and read only
  // `res.impression`, but the handler never destructured the key. It asked the
  // model for a whole report every time, so each Ctrl+I also produced a set of
  // Findings nobody requested — invented from the same prompt — and returned
  // them under `findings`/`draft` for any surface to offer as a replacement of
  // text the radiologist had already typed.

  const aiText = (text: string) => nextAnswer(generateAiResponse, text);

  test("field:impression asks for an impression only and returns no findings", async () => {
    aiText("IMPRESSION: Mild disc bulge at L4-L5.");
    const res = makeRes();
    await draftHandler(
      makeReq({ reportBody: "L4-L5 mild disc bulge indenting the thecal sac.", field: "impression", provider: "gemini" }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.impression).toBe("Mild disc bulge at L4-L5.");
    expect(res.body.findings).toBe("");
    expect(res.body.draft).toBe("");
    const prompt = String(generateAiResponse.mock.calls[0][1]);
    expect(prompt).toMatch(/Write ONLY the IMPRESSION/);
    expect(prompt).not.toContain("FINDINGS: (structured findings)");
  });

  test("REGRESSION: an answer with no IMPRESSION marker becomes nothing, not an impression", async () => {
    // One line of code carried two defects. The impression branch was
    // `match(/IMPRESSION:/)?.[1] ?? aiResponse`, so unmarked prose came back as
    // THE IMPRESSION with `parserSuccess: true`, and the `full` branch's
    // `?? aiResponse.trim()` could hand prose back as findings — the silent
    // substitution the `field` branch exists to prevent. Until C1 this test
    // asserted the first of those as expected behaviour.
    //
    // The contract is now the requested section, or nothing, with a visible
    // reason: `draftOutputContract.test.ts` pins the parser, this proves the
    // route refuses to pass the blob through and refuses to store it.
    aiText("Mild disc bulge at L4-L5.");
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 mild disc bulge.", field: "impression", provider: "gemini" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.impression).toBe("");
    expect(res.body.findings).toBe("");
    expect(res.body.draft).toBe("");
    expect(res.body.failure).toMatchObject({ code: "MALFORMED_RESPONSE", provider: "gemini", attempted: true });
    expect(String(res.body.failure.message)).toContain("IMPRESSION:");
    // A refused answer is not a draft: nothing may land in ai_reporting_drafts for
    // whoever opens this study next.
    expect(draftInserts).toHaveLength(0);
  });

  test("without `field` the two-section parse is unchanged", async () => {
    aiText("FINDINGS: Alpha.\nIMPRESSION: Beta.");
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 mild disc bulge.", provider: "gemini" }), res);

    expect(res.body.findings).toBe("Alpha.");
    expect(res.body.draft).toBe("Alpha.");
    expect(res.body.impression).toBe("Beta.");
  });

  test("the grounding and preservation clauses reach the model on both branches", async () => {
    aiText("FINDINGS: x\nIMPRESSION: y");
    const full = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 mild disc bulge.", provider: "gemini" }), full);
    aiText("IMPRESSION: y");
    const impOnly = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 mild disc bulge.", field: "impression", provider: "gemini" }), impOnly);

    for (const call of [0, 1]) {
      const prompt = String(generateAiResponse.mock.calls[call][1]);
      // RW-03: /draft carried no anti-hallucination, measurement-preservation or
      // laterality-preservation clause at all, while the background composer's
      // prompt carried all three.
      expect(prompt).toContain("8.7 mm stays 8.7 mm");
      expect(prompt).toContain("Never move a finding to a different side or to a different spinal level");
      expect(prompt).toContain("Never escalate a supplied severity");
      expect(prompt).toContain("Do NOT invent an abnormality, diagnosis, measurement, spinal level or side");
    }
  });

  test("a malformed body is a 400 naming the field, and the model is never called", async () => {
    const res = makeRes();
    await draftHandler(makeReq({ worklistId: "not-a-number", provider: "gemini" }), res);

    expect(res.statusCode).toBe(400);
    expect(String(res.body.error)).toMatch(/worklistId/);
    expect(generateAiResponse).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai-reporting/draft — output is grounded by the composer's own validator", () => {
  // RW-03. The background composer gated its draft through
  // `validateComposerOutput`; the interactive path returned model prose with no
  // grounding check whatsoever, so an invented "severe canal stenosis" was
  // byte-identical on the wire to one the radiologist's own findings supported.
  // The fix calls that same validator — it does not reimplement it.

  const aiText = (text: string) => nextAnswer(generateAiResponse, text);

  test("a draft that stays inside the supplied findings is reported ok", async () => {
    aiText("FINDINGS: L4-L5 mild disc bulge indenting the thecal sac.\nIMPRESSION: Mild disc bulge at L4-L5.");
    const res = makeRes();
    await draftHandler(
      makeReq({ reportBody: "L4-L5 mild disc bulge indenting the thecal sac.", provider: "gemini" }),
      res,
    );

    expect(res.body.validation.ok).toBe(true);
    expect(res.body.validation.errors).toEqual([]);
    expect(res.body.aiSafetyLabel).toBe("AI Draft – Requires Radiologist Review");
  });

  test("an invented abnormality is flagged and the safety label changes", async () => {
    aiText("FINDINGS: L4-L5 mild disc bulge.\nIMPRESSION: Severe canal stenosis with cord compression.");
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 mild disc bulge.", provider: "gemini" }), res);

    expect(res.body.validation.ok).toBe(false);
    expect(res.body.validation.errors).toContain("unsupported_abnormality");
    expect(res.body.validation.unsupportedMentions).toContain("stenosis");
    expect(res.body.aiSafetyLabel).toMatch(/[Uu]ngrounded/);
  });

  test("§17: 8.7 mm rewritten as 8 mm is a named measurement mutation", async () => {
    aiText("FINDINGS: 8 mm posterior disc protrusion at L4-L5.\nIMPRESSION: Disc protrusion.");
    const res = makeRes();
    await draftHandler(
      makeReq({ reportBody: "8.7 mm posterior disc protrusion at L4-L5.", provider: "gemini" }),
      res,
    );

    expect(res.body.validation.errors).toContain("measurement_mutation");
    expect(res.body.validation.ok).toBe(false);
  });

  test("§18: a spinal level the findings never mentioned is a named level change", async () => {
    aiText("FINDINGS: L3-L4 disc bulge.\nIMPRESSION: Disc bulge.");
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 disc bulge.", provider: "gemini" }), res);

    expect(res.body.validation.errors).toContain("level_change");
    expect(res.body.validation.levelChanges).toContain("L3-L4");
  });

  test("flagging is advisory: the draft is still returned, blocking is still false", async () => {
    // §14: "Do not blindly make every warning blocking. Preserve usability."
    // Whether any of this should hard-block is the open product-owner decision
    // in ARCHITECTURE.md §8.1, so the route labels the draft and hands it over.
    aiText("FINDINGS: L4-L5 mild disc bulge.\nIMPRESSION: Severe canal stenosis.");
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 mild disc bulge.", provider: "gemini" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.validation.blocking).toBe(false);
    expect(res.body.impression).toContain("stenosis");
    expect(res.body.draftId).toBe(4242);
  });

  test("the verdict names its validator and states what it could not check", async () => {
    // §39: a green label that quietly could not see half the report is worse
    // than no label, so the gaps travel with the verdict.
    aiText("FINDINGS: L4-L5 mild disc bulge.\nIMPRESSION: Mild disc bulge.");
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 mild disc bulge.", provider: "gemini" }), res);

    expect(res.body.validation.validator).toBe("reportComposer.validateComposerOutput");
    expect(res.body.validation.imagesSentToModel).toBe(0);
    expect(res.body.validation.notChecked.length).toBeGreaterThan(0);
    expect(res.body.validation.notChecked.join(" ")).toMatch(/key-image registry/);
  });
});

describe("POST /api/ai-reporting/draft — a provider warm-up leaves no clinical draft behind", () => {
  // RW-23. The reporting workspace's next-study preload used to fire this route
  // with nothing but { studyInstanceUID, modality } — no findings, no impression,
  // no clinical history — for a study the radiologist had not opened, then throw
  // the answer away client-side. Server-side it still fetched Orthanc images, ran
  // a full inference from a template-only prompt, and stored the result.
  // GET /drafts/:studyId returns every row for that UID with no provenance filter,
  // so an invented, image-only draft became retrievable by whoever opened that
  // study next and looked like an ordinary AI draft.

  const aiText = (text: string) => nextAnswer(generateAiResponse, text);

  test("warmUpOnly still loads and exercises the model — that is the point of the call", async () => {
    aiText("FINDINGS: unremarkable.\nIMPRESSION: No acute abnormality.");
    const res = makeRes();
    await draftHandler(
      makeReq({ studyInstanceUID: "1.2.840.113619.2.55.3.1", modality: "MRI", warmUpOnly: true }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(generateAiResponse).toHaveBeenCalledTimes(1);
  });

  test("warmUpOnly persists no ai_reporting_drafts row and returns draftId: null", async () => {
    aiText("FINDINGS: severe canal stenosis.\nIMPRESSION: Severe canal stenosis.");
    const res = makeRes();
    await draftHandler(
      makeReq({ studyInstanceUID: "1.2.840.113619.2.55.3.2", modality: "MRI", warmUpOnly: true }),
      res,
    );

    expect(draftInserts).toHaveLength(0);
    expect(res.body.draftId).toBeNull();
  });

  test("the audit row is still written, so the AI call is not invisible", async () => {
    // Discarding the draft must not discard the record that a model call
    // happened for this study — the audit log is the accountability trail.
    aiText("FINDINGS: unremarkable.\nIMPRESSION: No acute abnormality.");
    const res = makeRes();
    await draftHandler(
      makeReq({ studyInstanceUID: "1.2.840.113619.2.55.3.3", modality: "MRI", warmUpOnly: true }),
      res,
    );

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]["studyInstanceUID"]).toBe("1.2.840.113619.2.55.3.3");
    expect(auditInserts[0]["draftId"]).toBeNull();
  });

  test("control: the same request without warmUpOnly still persists its draft", async () => {
    aiText("FINDINGS: L4-L5 mild disc bulge.\nIMPRESSION: Mild disc bulge.");
    const res = makeRes();
    await draftHandler(
      makeReq({ studyInstanceUID: "1.2.840.113619.2.55.3.4", modality: "MRI", reportBody: "L4-L5 mild disc bulge." }),
      res,
    );

    expect(draftInserts).toHaveLength(1);
    expect(draftInserts[0]["studyInstanceUID"]).toBe("1.2.840.113619.2.55.3.4");
    expect(res.body.draftId).toBe(4242);
  });
});

describe("POST /api/ai-reporting/egress-preview — say what would actually leave", () => {
  // A privacy setting is otherwise unverifiable: the screen asserts something
  // and staff have no artefact to check it against. This route must apply the
  // same gates as the send path and report the verdict honestly.

  const settingsWith = (over: Record<string, unknown>) => {
    settingsJson = JSON.stringify({
      enabled: true,
      defaultProvider: "gemini",
      defaultPrompt: "",
      includeDemographics: false,
      anonymize: true,
      cloudTextPhiAllowed: false,
      allowedRoles: [],
      ...over,
    });
  };

  test("cloud + a prompt that names a patient is reported as blocked", async () => {
    settingsWith({});
    const res = makeRes();
    await previewHandler(makeReq({ promptText: "Patient: Ananya Sharma\nNo abnormality." }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.destination.execution).toBe("CLOUD");
    expect(res.body.prompt.identifierCategories).toEqual(["name"]);
    expect(res.body.verdict.allowed).toBe(false);
    expect(res.body.verdict.code).toBe("PHI_TEXT_CLOUD_BLOCKED");
  });

  test("an on-prem provider is allowed and labelled LOCAL, because nothing leaves", async () => {
    settingsWith({ defaultProvider: "ollama" });
    const res = makeRes();
    await previewHandler(makeReq({ promptText: "Patient: Ananya Sharma" }), res);

    expect(res.body.destination.execution).toBe("LOCAL");
    expect(res.body.verdict.allowed).toBe(true);
    expect(res.body.verdict.reason).toMatch(/does not leave the clinic/);
  });

  test("the opt-in flips the verdict and shows the redacted text it would send", async () => {
    settingsWith({ cloudTextPhiAllowed: true });
    const res = makeRes();
    await previewHandler(makeReq({ promptText: "Patient: Ananya Sharma\nNo abnormality." }), res);

    expect(res.body.verdict.allowed).toBe(true);
    expect(res.body.prompt.wouldBeRedacted).toBe(true);
    expect(res.body.prompt.scrubbed).toContain("Patient: [REDACTED]");
    expect(res.body.prompt.scrubbed).not.toContain("Ananya");
  });

  test("a clean prompt is not flagged, so the screen does not cry wolf", async () => {
    settingsWith({});
    const res = makeRes();
    await previewHandler(makeReq({ promptText: "No midline shift. Ventricles normal." }), res);

    expect(res.body.prompt.identifierCategories).toEqual([]);
    expect(res.body.verdict.allowed).toBe(true);
  });

  test("the image request is capped at what a real draft would pull", async () => {
    settingsWith({});
    const res = makeRes();
    await previewHandler(makeReq({ studyInstanceUID: "1.2.3.4", maxImages: 9999 }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.images.requested).toBe(6);
  });

  test("a malformed study UID is rejected before Orthanc is touched", async () => {
    settingsWith({});
    const res = makeRes();
    await previewHandler(makeReq({ studyInstanceUID: "../../etc/passwd", maxImages: 6 }), res);

    expect(res.statusCode).toBe(400);
    expect(pacsSettingsQueries).toBe(0);
  });
});

describe("execution identity — the record follows the provider that answered (C1)", () => {
  // Audit C / C1: the artefacts that outlive the request are the HTTP body, the
  // `ai_reporting_drafts` row and the `ai_reporting_audit_logs` row. Before C1 all
  // three repeated whatever the handler had resolved, so a request that ran on a
  // different provider — or that no provider could be attributed to — still filed a
  // clean record naming the provider nobody asked for. An audit trail that cannot
  // answer "which model wrote this sentence?" is the failure this PR exists to close,
  // and it is only visible at the point where the route writes.
  //
  // The identity below comes from the adapter, exactly as in production: the
  // execution layer states who ran. These tests change WHO THE ADAPTER REPORTS, not
  // what the route asked for, which is the only way to prove the route listens.

  const draftReq = () => makeReq({
    reportBody: "L4-L5 mild disc bulge indenting the thecal sac.",
    field: "impression",
    provider: "gemini",
  });

  test("a provider that cannot be attributed is refused, and the audit row names the one that answered", async () => {
    // The caller asked for Gemini. Something else answered. The draft must not be
    // handed over, nothing may be stored for the next radiologist, and the audit
    // row must say what actually ran rather than preserve the request's label.
    nextAnswer(generateAiResponse, "IMPRESSION: No acute abnormality.", {
      execution: { provider: "ollama", model: "qwen3-vl:8b", locality: "local" },
    });
    const res = makeRes();
    await draftHandler(draftReq(), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.failure).toMatchObject({
      detailCode: "PROVIDER_IDENTITY_MISMATCH",
      provider: "ollama",
    });
    expect(res.body.impression ?? "").toBe("");
    expect(draftInserts).toHaveLength(0);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]["provider"]).toBe("ollama");
    expect(auditInserts[0]["model"]).toBe("qwen3-vl:8b");
    expect(auditInserts[0]["success"]).toBe(false);
  });

  test("the response, the draft row and the audit row all name the executed model", async () => {
    // No model was requested, so the route resolved one; the adapter then reports
    // the model it actually sent. Every artefact must carry that one value.
    nextAnswer(generateAiResponse, "IMPRESSION: No acute abnormality.", {
      execution: { model: "gemini-2.5-pro", timeoutMs: 120_000 },
    });
    const res = makeRes();
    await draftHandler(draftReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.failure).toBeNull();
    expect(res.body.provider).toBe("gemini");
    expect(res.body.model).toBe("gemini-2.5-pro");
    expect(res.body.executed).toMatchObject({
      provider: "gemini", model: "gemini-2.5-pro", locality: "cloud", attempted: true, timeoutMs: 120_000,
    });
    expect(res.body.resolution).toMatchObject({ provider: "gemini", providerSource: "request" });

    expect(draftInserts).toHaveLength(1);
    expect(draftInserts[0]["provider"]).toBe("gemini");
    expect(draftInserts[0]["model"]).toBe("gemini-2.5-pro");
    expect(auditInserts[0]["provider"]).toBe("gemini");
    expect(auditInserts[0]["model"]).toBe("gemini-2.5-pro");
    expect(auditInserts[0]["success"]).toBe(true);
  });

  test("control: when the adapter confirms the provider that was asked for, nothing is refused", async () => {
    // Without this, the two tests above could pass on a route that refuses
    // everything. The same request with a matching identity succeeds and stores.
    nextAnswer(generateAiResponse, "IMPRESSION: No acute abnormality.");
    const res = makeRes();
    await draftHandler(draftReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.impression).toBe("No acute abnormality.");
    expect(res.body.failure).toBeNull();
    expect(draftInserts).toHaveLength(1);
    expect(auditInserts[0]["success"]).toBe(true);
  });

  test("/query reports the executor too — one answer for both interactive surfaces", async () => {
    // `/query` never had the double-resolution bug: it passed its resolved provider
    // straight to the execution layer. What it lacked was the reported identity, so
    // its body and audit row described the request rather than the answer.
    nextAnswer(generateAiResponse, "AI ANSWER", {
      execution: { provider: "ollama", model: "qwen3-vl:8b", locality: "local" },
    });
    const res = makeRes();
    await queryHandler(makeReq({ promptText: "Summarise the findings", provider: "gemini", maxImages: 0 }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.aiResponse ?? "").toBe("");
    expect(res.body.failure).toMatchObject({ provider: "ollama" });
    expect(auditInserts[0]["provider"]).toBe("ollama");
    expect(auditInserts[0]["success"]).toBe(false);
  });
});

describe("POST /api/ai-reporting/draft — the canonical canal record is checked as data, not as prose", () => {
  // RIS-013 gap 3, interactive path. The measurement grid's numbers are what the
  // signed report's canal table prints, and this draft lands in that same report —
  // so a rewrite of 6.4 mm into 9.4 mm is the identical hazard the composer job is
  // refused for. Until the record reached this route the validator could only ever
  // see a diameter a sentence happened to repeat, and a number that appeared in
  // neither place was invisible.

  const COLUMN = {
    kind: STRUCTURED_JSON_ENVELOPE_KIND,
    careCanalApProvenance: {
      // Radiologist overrode the caliper: the authority for this level is 6.4.
      "L4-L5": { viewerValue: 8.9, reportValue: 6.4, manualOverride: true },
      "L1-L2": { viewerValue: 12.6 },
    },
  };

  // One row serving both reads the route makes: the worklist→draft resolution (so
  // it needs the identity columns) and the draft→structured_json read (so it needs
  // the record). The fake ignores WHERE clauses, so one fixture is the one draft,
  // and it ignores the select's aliases too — which is why the resolution row
  // carries `draftId` next to `id`: the real query projects `id AS draftId`.
  const draftRow = (structuredJson: unknown) => [
    { id: 555, draftId: 555, studyId: 12, worklistId: 77, patientId: 9, structuredJson },
  ];

  async function postDraft(draftText: string) {
    nextAnswer(generateAiResponse, draftText);
    const res = makeRes();
    await draftHandler(
      makeReq({
        worklistId: 77,
        reportBody: "L4-L5 mild disc bulge indenting the thecal sac.",
        provider: "gemini",
      }),
      res,
    );
    return res;
  }

  test("a draft that restates a canonical diameter with a different number is named", async () => {
    canalDraftState.rows = draftRow(COLUMN);
    const res = await postDraft(
      "FINDINGS: L4-L5 mild disc bulge. The canal AP diameter at L4-L5 measures 9.4 mm.\nIMPRESSION: Degenerative change at L4-L5.",
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.validation.errors).toContain("canal_measurement_mutation");
  });

  test("a draft that keeps the recorded value passes, and the record is still what was read", async () => {
    canalDraftState.rows = draftRow(COLUMN);
    const res = await postDraft(
      "FINDINGS: L4-L5 mild disc bulge indenting the thecal sac. The canal AP diameter at L4-L5 measures 6.4 mm.\nIMPRESSION: Degenerative change at L4-L5.",
    );

    expect(res.body.validation.errors).not.toContain("canal_measurement_mutation");
    expect(res.body.validation.errors).not.toContain("canal_measurement_invented");
    // Positive control, and not a vacuous one: L1-L2 is in this study's record and
    // in no sentence of this draft, so the advisory can only name it if the route
    // really validated against the grid. A dead canal path passes the two lines
    // above for every draft.
    expect(res.body.validation.warnings.join(" ")).toContain("L1-L2");
  });

  test("a study with no canal record is validated exactly as it was", async () => {
    // The whole non-spine clinic must not acquire a new failure mode. No draft row
    // at all — the same request must behave as it did before the record existed.
    const res = await postDraft(
      "FINDINGS: No acute intracranial abnormality.\nIMPRESSION: Normal study.",
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.validation.errors).toEqual([]);
  });

  test("an unreachable measurement record costs the canal data, never the draft", async () => {
    canalDraftState.fails = true;
    const res = await postDraft(
      "FINDINGS: L4-L5 mild disc bulge indenting the thecal sac.\nIMPRESSION: Degenerative change at L4-L5.",
    );

    expect(res.statusCode).toBe(200);
    expect(String(res.body.draft)).toContain("L4-L5");
    expect(res.body.validation.errors).not.toContain("canal_measurement_mutation");
    expect(generateAiResponse).toHaveBeenCalledTimes(1);
  });
});

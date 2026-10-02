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

const generateAiResponse = vi.fn(async (_provider: string, _prompt: string, _images: string[], _opts: { model?: string }) => ({
  success: true,
  text: "AI DRAFT RESPONSE",
  error: undefined as string | undefined,
}));

// POST /draft goes out through generateAiForTask, not generateAiResponse.
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
  }),
);

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
    expect(generateAiForTask).toHaveBeenCalledTimes(1);
    const prompt = String(generateAiForTask.mock.calls[0][1]);
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
    const prompt = String(generateAiForTask.mock.calls[0][1]);
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

    const prompt = String(generateAiForTask.mock.calls[0][1]);
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

  const aiText = (text: string) =>
    generateAiForTask.mockImplementationOnce(async () => ({ success: true, text, error: undefined }));

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
    const prompt = String(generateAiForTask.mock.calls[0][1]);
    expect(prompt).toMatch(/Write ONLY the IMPRESSION/);
    expect(prompt).not.toContain("FINDINGS: (structured findings)");
  });

  test("REGRESSION: a response with no IMPRESSION marker cannot leak into findings", async () => {
    // The two-section parser falls back to `aiResponse.trim()` for findings when
    // it finds no `FINDINGS:` marker. On the impression-only branch that
    // fallback would hand the impression back AS the findings — the exact silent
    // substitution the branch exists to prevent.
    aiText("Mild disc bulge at L4-L5.");
    const res = makeRes();
    await draftHandler(makeReq({ reportBody: "L4-L5 mild disc bulge.", field: "impression", provider: "gemini" }), res);

    expect(res.body.impression).toBe("Mild disc bulge at L4-L5.");
    expect(res.body.findings).toBe("");
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
      const prompt = String(generateAiForTask.mock.calls[call][1]);
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
    expect(generateAiForTask).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai-reporting/draft — output is grounded by the composer's own validator", () => {
  // RW-03. The background composer gated its draft through
  // `validateComposerOutput`; the interactive path returned model prose with no
  // grounding check whatsoever, so an invented "severe canal stenosis" was
  // byte-identical on the wire to one the radiologist's own findings supported.
  // The fix calls that same validator — it does not reimplement it.

  const aiText = (text: string) =>
    generateAiForTask.mockImplementationOnce(async () => ({ success: true, text, error: undefined }));

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

  const aiText = (text: string) =>
    generateAiForTask.mockImplementationOnce(async () => ({ success: true, text, error: undefined }));

  test("warmUpOnly still loads and exercises the model — that is the point of the call", async () => {
    aiText("FINDINGS: unremarkable.\nIMPRESSION: No acute abnormality.");
    const res = makeRes();
    await draftHandler(
      makeReq({ studyInstanceUID: "1.2.840.113619.2.55.3.1", modality: "MRI", warmUpOnly: true }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(generateAiForTask).toHaveBeenCalledTimes(1);
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

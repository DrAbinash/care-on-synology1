/**
 * Smart Dictation provider transport — the request body and the failure voice.
 *
 * Measured cause of the clinic-wide "Local composer unavailable": qwen3 runs in
 * reasoning mode by default, and under `format:"json"` it spends the whole 45 s
 * budget producing chain-of-thought before any JSON appears (79 s wall, aborted;
 * the same prompt with reasoning off returns valid JSON in 22 s). The fix is one
 * field — `think:false` — and nothing else in the repo exercises this request
 * body, so a silent removal would take the clinic down again with green tests.
 *
 * The second half of the contract is diagnostic: every failure names WHY in
 * PHI-safe codes only (timing, missing model, refused connection). The prompt,
 * the transcript and the model response are clinical text and must never reach
 * diagnostics or logs.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { logCalls } = vi.hoisted(() => ({
  logCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../logger", () => ({
  logger: {
    warn: (payload: Record<string, unknown>) => logCalls.push(payload),
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Production uses the DNS-pinned hardened transport; delegate to fetch so the
// suite can read the exact body the composer sends. The package is replaced
// wholesale rather than spread from importOriginal because it pulls in
// @workspace/db, and this suite must run without a database.
vi.mock("@workspace/ai-providers", () => ({
  hardenedLocalRequest: async (url: string, init?: RequestInit) => {
    const response = await globalThis.fetch(url, init);
    return { response, boundIp: "127.0.0.1", originalHost: new URL(url).host };
  },
}));

type Runtime = {
  enabled: boolean;
  endpoint: string;
  endpointSource: string;
  model: string;
  fallbackModel: string | null;
  numCtx: number;
  temperature: number;
  timeoutMs: number;
  localOnly: boolean;
  visionModel: string;
};

let runtime: Runtime;
vi.mock("./runtimeConfig", () => ({
  resolveComposerRuntime: async () => runtime,
  invalidateComposerRuntimeCache: () => {},
}));

const { composeVoiceChangePlan } = await import("./composer");
const { VOICE_COMPOSER_JSON_SCHEMA } = await import("./schema");

const ENDPOINT = "http://127.0.0.1:11434";

function makeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    enabled: true,
    endpoint: ENDPOINT,
    endpointSource: "clinic_settings",
    model: "qwen3:14b",
    fallbackModel: null,
    numCtx: 4096,
    temperature: 0.1,
    timeoutMs: 45_000,
    localOnly: true,
    visionModel: "qwen3-vl:8b",
    ...overrides,
  };
}

const TRANSCRIPT = "Disc desiccation at L3-4.";
const NORMAL_LS =
  "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained.";

const PLAN_JSON = JSON.stringify({
  operation: "report_change_plan",
  observations: [
    {
      concept: "disc_desiccation",
      level: "L3-L4",
      severity: "mild",
      findingsText: "Disc desiccation is seen at L3-L4.",
    },
  ],
  uncertainties: [],
});

function okBody(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  logCalls.length = 0;
  runtime = makeRuntime();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function compose() {
  return composeVoiceChangePlan(
    { transcript: TRANSCRIPT, region: "LS Spine", modality: "MR", findingsText: NORMAL_LS },
    { requestId: "req-test" },
  );
}

/** The exact JSON the composer POSTs to /api/generate. */
function sentBody(call = 0): Record<string, any> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("Smart Dictation provider request shape", () => {
  it("turns reasoning off — the measured cause of the 45-second failure", async () => {
    fetchMock.mockResolvedValue(okBody({ response: PLAN_JSON }));

    const res = await compose();

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${ENDPOINT}/api/generate`);
    const body = sentBody();
    expect(body.think).toBe(false);
    // Structured-output enforcement: the previously-defined-but-never-sent
    // zod-mirroring JSON schema now goes to Ollama as the `format`, so the
    // model cannot emit wrong-typed fields in the first place (the benchmark
    // measured 68% of the primary's correct plans carrying nulls).
    expect(body.format).toEqual(VOICE_COMPOSER_JSON_SCHEMA);
    expect(body.stream).toBe(false);
    expect(body.model).toBe("qwen3:14b");
    expect(body.options.num_ctx).toBe(4096);
    expect(body.options.temperature).toBe(0.1);
  });

  it("falls back to plain format:json when the server rejects structured output (Ollama < v0.5)", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}), text: async () => "unknown format type" })
      .mockResolvedValueOnce(okBody({ response: PLAN_JSON }));

    const res = await compose();

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).format).toEqual(VOICE_COMPOSER_JSON_SCHEMA);
    expect(sentBody(1).format).toBe("json");
  });

  it("does NOT format-retry a missing model — the failure is the model, not the request shape", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => "model not found" });

    const res = await compose();

    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.diagnostics?.failureReason).toBe("model_not_found");
  });

  it("sends no num_predict cap — the lever that truncated the JSON instead of speeding it up", async () => {
    fetchMock.mockResolvedValue(okBody({ response: PLAN_JSON }));

    await compose();

    const body = sentBody();
    expect(body.options.num_predict).toBeUndefined();
    expect(body.options.num_keep).toBeUndefined();
  });

  it("carries the dictation and the phrase catalog in the prompt, and nowhere else", async () => {
    fetchMock.mockResolvedValue(okBody({ response: PLAN_JSON }));

    await compose();

    const body = sentBody();
    expect(typeof body.prompt).toBe("string");
    expect(body.prompt).toContain("Disc desiccation");
    // Nothing beyond prompt/model/options may leak the clinical text.
    expect(Object.keys(body).sort()).toEqual(
      ["format", "model", "options", "prompt", "stream", "think"].sort(),
    );
  });
});

describe("Smart Dictation failure diagnosis (PHI-safe reason codes)", () => {
  it("names a timeout when the model does not answer inside the budget", async () => {
    runtime = makeRuntime({ timeoutMs: 25 });
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
          );
        }),
    );

    const res = await compose();

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Local composer unavailable — dictation preserved");
    expect(res.diagnostics?.failureReason).toBe("timeout");
  });

  it("names a missing fallback model instead of an unreachable endpoint", async () => {
    runtime = makeRuntime({ fallbackModel: "qwen3:12b" });
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => "model not found" });

    const res = await compose();

    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(1).model).toBe("qwen3:12b");
    expect(res.diagnostics?.failureReason).toBe("model_not_found,model_not_found");
    // `fallbackUsed` means "the fallback SERVED the request". Both models 404'd,
    // so the answer came from neither — the second code in failureReason is the
    // evidence that the fallback was attempted.
    expect(res.diagnostics?.fallbackUsed).toBe(false);
    expect(res.diagnostics?.model).toBe("qwen3:14b");
  });

  it("keeps the dictation when the fallback answers", async () => {
    runtime = makeRuntime({ fallbackModel: "qwen3:8b" });
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}), text: async () => "gpu oom" })
      .mockResolvedValueOnce(okBody({ response: PLAN_JSON }));

    const res = await compose();

    expect(res.ok).toBe(true);
    expect(res.diagnostics?.fallbackUsed).toBe(true);
    expect(res.diagnostics?.model).toBe("qwen3:8b");
  });

  it("calls a truncated response a schema failure, not a provider outage", async () => {
    fetchMock.mockResolvedValue(
      okBody({ response: '{"operation":"report_change_plan","observations":[{"concept":"disc_desiccation"' }),
    );

    const res = await compose();

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Invalid structured response — dictation preserved");
    expect(res.diagnostics?.failureReason).toBe("schema_invalid");
    expect(res.diagnostics?.schemaOk).toBe(false);
  });

  it("refuses a private endpoint without Local/LAN mode before any request leaves", async () => {
    runtime = makeRuntime({ endpoint: "http://192.168.1.250:11434", localOnly: false });

    const res = await compose();

    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.diagnostics?.failureReason).toBe("endpoint_refused");
  });

  it("puts no clinical text in diagnostics or logs — only codes and counters", async () => {
    runtime = makeRuntime({ fallbackModel: "qwen3:12b" });
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => "model not found" });

    const res = await compose();

    const clinicalTexts = [TRANSCRIPT, "Disc desiccation", "Lumbar vertebrae", "L3-4", "L3-L4", PLAN_JSON];
    const hay = JSON.stringify(res.diagnostics) + JSON.stringify(logCalls);
    for (const text of clinicalTexts) expect(hay).not.toContain(text);
    expect(res.diagnostics?.failureReason).toMatch(/^[a-z0-9_,]+$/);
    expect(res.diagnostics?.transcriptLength).toBe(TRANSCRIPT.length);
    expect(logCalls[0]?.failureReasons).toBe("model_not_found,model_not_found");
    expect(logCalls[0]?.requestId).toBe("req-test");
  });
});

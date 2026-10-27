/**
 * One-shot JSON repair for Smart Dictation.
 *
 * The schema-first request path makes invalid JSON rare — but when it happens
 * today the dictation fails over to the error band and the radiologist waits
 * for a full Retry round-trip (~35 s) to get the same words re-composed. The
 * model that just produced malformed output is warm and holds the transcript
 * in its context; asking it ONCE to re-emit strict JSON costs one call and
 * usually saves the retry. Exactly one attempt — never a loop — and the
 * repaired plan flows through the SAME validation + dictated-detail fidelity
 * gates as a first-pass plan: a repair is a second chance for the model, not
 * a second chance for the rules.
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

/** Truncated mid-key — the classic schema-invalid shape (budget cut the JSON). */
const BROKEN_JSON = '{"operation":"report_change_plan","observations":[{"concept":"disc_dess';

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

function compose(transcript = TRANSCRIPT) {
  return composeVoiceChangePlan(
    { transcript, region: "LS Spine", modality: "MR", findingsText: NORMAL_LS },
    { requestId: "req-test" },
  );
}

/** The exact JSON the composer POSTs to /api/generate. */
function sentBody(call = 0): Record<string, any> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("Smart Dictation one-shot JSON repair", () => {
  it("repairs a malformed response in ONE extra call — the dictation succeeds without Retry", async () => {
    fetchMock
      .mockResolvedValueOnce(okBody({ response: BROKEN_JSON }))
      .mockResolvedValueOnce(okBody({ response: PLAN_JSON }));

    const res = await compose();

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.diagnostics?.repairUsed).toBe(true);
    // The repaired plan is a real plan — same shape as a first-pass success.
    if (res.ok) {
      expect(res.plan?.observations[0]?.concept).toBe("disc_desiccation");
    }
  });

  it("asks the warm model to re-emit strict JSON, showing it the invalid output", async () => {
    fetchMock
      .mockResolvedValueOnce(okBody({ response: BROKEN_JSON }))
      .mockResolvedValueOnce(okBody({ response: PLAN_JSON }));

    await compose();

    const repairPrompt = String(sentBody(1).prompt);
    expect(repairPrompt).toContain(BROKEN_JSON);
    expect(repairPrompt).toMatch(/valid JSON/i);
    expect(repairPrompt).toContain("Disc desiccation at L3-4.");
    // Same schema enforcement on the repair attempt.
    expect(sentBody(1).format).toEqual(sentBody(0).format);
    expect(sentBody(1).model).toBe("qwen3:14b");
    expect(sentBody(1).think).toBe(false);
  });

  it("NEVER loops — a second malformed response fails with schema_invalid, exactly 2 calls", async () => {
    fetchMock.mockResolvedValue(okBody({ response: BROKEN_JSON }));

    const res = await compose();

    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.diagnostics?.failureReason).toBe("schema_invalid");
    expect(res.error).toBe("Invalid structured response — dictation preserved");
  });

  it("a repair transport failure surfaces as schema_invalid, not as a provider crash", async () => {
    fetchMock
      .mockResolvedValueOnce(okBody({ response: BROKEN_JSON }))
      .mockRejectedValueOnce(new Error("fetch failed"));

    const res = await compose();

    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.diagnostics?.failureReason).toBe("schema_invalid");
  });

  it("a repaired plan still faces the dictated-detail fidelity gate", async () => {
    // The transcript dictates a measurement; the repair returns a plan that
    // silently drops it. The repair is NOT exempt from the preservation rules.
    const MEASURED = "Canal stenosis measuring 9.2 mm at L3-L4.";
    const PLAN_WITHOUT_NUMBER = JSON.stringify({
      operation: "report_change_plan",
      observations: [
        {
          concept: "canal_stenosis",
          level: "L3-L4",
          severity: "mild",
          findingsText: "Mild canal stenosis is seen at L3-L4.",
        },
      ],
      uncertainties: [],
    });
    fetchMock
      .mockResolvedValueOnce(okBody({ response: BROKEN_JSON }))
      .mockResolvedValueOnce(okBody({ response: PLAN_WITHOUT_NUMBER }));

    const res = await compose(MEASURED);

    expect(res.ok).toBe(false);
    expect(res.diagnostics?.failureReason).toBe("dictated_detail_dropped");
  });

  it("no repair call when the first response is valid — one fetch, no repairUsed flag", async () => {
    fetchMock.mockResolvedValue(okBody({ response: PLAN_JSON }));

    const res = await compose();

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.diagnostics?.repairUsed).toBeFalsy();
  });
});

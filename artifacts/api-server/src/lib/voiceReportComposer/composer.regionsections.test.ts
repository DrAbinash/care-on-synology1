/**
 * Region sections on the live LLM path.
 *
 * The prompt now carries the region's canonical anatomicalSection vocabulary,
 * and every parsed plan — first-pass OR repaired — is normalized against it
 * before validation. Whatever the model invents collapses to "" (the report's
 * "Additional Observations" catch-all), so a dictated finding can never
 * materialize as a literally-named fake section. The radiologist's findings
 * text is never touched by normalization — only the section grouping key.
 *
 * Section keys are PHI-safe diagnostics-adjacent data: the normalized keys are
 * asserted directly, no transcript content rides in these assertions beyond
 * the synthetic fixtures below.
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
    timeoutMs: 90_000,
    localOnly: true,
    visionModel: "qwen3-vl:8b",
    ...overrides,
  };
}

const TRANSCRIPT = "Disc desiccation with canal stenosis and an incidental note.";
const NORMAL_LS =
  "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained.";

/** A model answer mixing a canonical key, a case variant, an invented section,
 *  and an observation that omits the field entirely. */
const LS_PLAN_JSON = JSON.stringify({
  operation: "report_change_plan",
  observations: [
    {
      concept: "disc_desiccation",
      findingsText: "Disc desiccation is seen.",
      anatomicalSection: "disc",
    },
    {
      concept: "canal_stenosis",
      findingsText: "Canal stenosis is seen.",
      anatomicalSection: "Spinal Canal",
    },
    {
      concept: "incidental_note",
      findingsText: "Incidental note is seen.",
      anatomicalSection: "Sellar Region",
    },
    {
      concept: "spondylosis",
      findingsText: "Lumbar spondylosis.",
    },
  ],
  uncertainties: [],
});

/** The model answering a BRAIN dictation, with one spine key leaking in. */
const BRAIN_PLAN_JSON = JSON.stringify({
  operation: "report_change_plan",
  observations: [
    {
      concept: "white_matter_changes",
      findingsText: "White matter changes are seen.",
      anatomicalSection: "white matter",
    },
    {
      concept: "chronic_small_vessel",
      findingsText: "Chronic small vessel ischemia.",
      anatomicalSection: "disc",
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

function composeLs(transcript = TRANSCRIPT) {
  return composeVoiceChangePlan(
    { transcript, region: "LS Spine", modality: "MR", findingsText: NORMAL_LS },
    { requestId: "req-regionsections" },
  );
}

function composeBrain() {
  return composeVoiceChangePlan(
    {
      transcript: "White matter changes with chronic small vessel ischemia.",
      region: "Brain",
      modality: "MR",
      findingsText: "Normal brain study.",
    },
    { requestId: "req-regionsections-brain" },
  );
}

function sentBody(call = 0): Record<string, any> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("region sections on the LLM compose path", () => {
  it("normalizes the emitted plan: canonical kept, variant canonicalized, invented collapsed", async () => {
    fetchMock.mockResolvedValue(okBody({ response: LS_PLAN_JSON }));

    const res = await composeLs();

    expect(res.ok).toBe(true);
    const sections = (res.plan?.observations ?? []).map((o) => o.anatomicalSection);
    expect(sections).toEqual(["disc", "spinal canal", "", undefined]);
    // Findings text untouched — normalization never rewrites the radiologist's words.
    expect(res.plan?.observations[2]?.findingsText).toBe("Incidental note is seen.");
  });

  it("a repaired plan is normalized too — the repair path has no separate rules", async () => {
    fetchMock
      .mockResolvedValueOnce(okBody({ response: '{"operation":"report_change_plan","obs' }))
      .mockResolvedValueOnce(okBody({ response: LS_PLAN_JSON }));

    const res = await composeLs();

    expect(res.ok).toBe(true);
    expect(res.diagnostics?.repairUsed).toBe(true);
    const sections = (res.plan?.observations ?? []).map((o) => o.anatomicalSection);
    expect(sections).toEqual(["disc", "spinal canal", "", undefined]);
  });

  it("cross-family leakage collapses: a disc section has no place in a brain plan", async () => {
    fetchMock.mockResolvedValue(okBody({ response: BRAIN_PLAN_JSON }));

    const res = await composeBrain();

    expect(res.ok).toBe(true);
    const sections = (res.plan?.observations ?? []).map((o) => o.anatomicalSection);
    expect(sections).toEqual(["white matter", ""]);
  });

  it("the prompt teaches the region's section vocabulary", async () => {
    fetchMock.mockResolvedValue(okBody({ response: LS_PLAN_JSON }));

    await composeLs();

    const prompt = String(sentBody(0).prompt);
    expect(prompt).toContain("Region sections");
    expect(prompt).toContain("spinal canal");
    expect(prompt).toContain("posterior elements");
    expect(prompt).toContain("alignment");
  });

  it("the brain prompt teaches the brain vocabulary, not the spine one", async () => {
    fetchMock.mockResolvedValue(okBody({ response: BRAIN_PLAN_JSON }));

    await composeBrain();

    const prompt = String(sentBody(0).prompt);
    expect(prompt).toContain("Region sections");
    expect(prompt).toContain("white matter");
    expect(prompt).toContain("ventricles");
    expect(prompt).not.toContain("posterior elements");
  });
});

/**
 * Contradiction-check wiring through the real composer funnel.
 *
 * contradictionCheck.test.ts pins the pure checker; this suite pins that a
 * warning actually SURVIVES the compose pipeline: parse → region-section
 * normalization → validation → fidelity → SUCCESS — the plan still ships,
 * and the warnings ride the ComposeResult next to it. The reverse also
 * matters: a clean plan must not grow a `warnings` key at all, so the client
 * treats absence as clean.
 *
 * PHI lane: warnings are clinical advisories for the radiologist (they ride
 * the response the plan already rides), but they must never reach
 * diagnostics or logs — same discipline as the transcript.
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

const CONTRADICTING_PLAN = JSON.stringify({
  operation: "report_change_plan",
  observations: [
    {
      concept: "disc_herniation",
      level: "L4-L5",
      laterality: "left",
      findingsText: "Large left paracentral disc herniation at L4-L5.",
    },
  ],
  impressionUpdate: "No disc herniation.",
  uncertainties: [],
});

const CLEAN_PLAN = JSON.stringify({
  operation: "report_change_plan",
  observations: [
    {
      concept: "disc_desiccation",
      level: "L3-L4",
      severity: "mild",
      findingsText: "Mild disc desiccation at L3-L4.",
    },
  ],
  impressionUpdate: "Mild disc desiccation at L3-L4.",
  uncertainties: [],
});

describe("contradiction warnings ride the compose result", () => {
  it("a plan whose Impression denies its own Findings still succeeds — with the warning attached", async () => {
    fetchMock.mockResolvedValue(okBody({ response: CONTRADICTING_PLAN }));

    const res = await composeVoiceChangePlan(
      { transcript: "Large left paracentral disc herniation at L4-L5.", region: "LS Spine", modality: "MR" },
      { requestId: "req-contradiction" },
    );

    expect(res.ok).toBe(true);
    expect(res.plan?.observations).toHaveLength(1);
    const w = res.warnings?.find((x) => x.code === "impression_negates_finding");
    expect(w, JSON.stringify(res.warnings ?? [])).toBeTruthy();
    expect(w!.message.toLowerCase()).toContain("herniation");
  });

  it("a clean plan carries no warnings key at all — absence means clean", async () => {
    fetchMock.mockResolvedValue(okBody({ response: CLEAN_PLAN }));

    const res = await composeVoiceChangePlan(
      { transcript: "Mild disc desiccation at L3-L4.", region: "LS Spine", modality: "MR" },
      { requestId: "req-clean" },
    );

    expect(res.ok).toBe(true);
    expect(res.warnings).toBeUndefined();
  });

  it("warnings never reach diagnostics or logs — PHI lane discipline", async () => {
    fetchMock.mockResolvedValue(okBody({ response: CONTRADICTING_PLAN }));

    const res = await composeVoiceChangePlan(
      { transcript: "Large left paracentral disc herniation at L4-L5.", region: "LS Spine", modality: "MR" },
      { requestId: "req-phi" },
    );

    expect(res.ok).toBe(true);
    const clinicalTexts = ["No disc herniation", "herniation", "L4-L5", "left paracentral"];
    const hay = JSON.stringify(res.diagnostics) + JSON.stringify(logCalls);
    for (const text of clinicalTexts) expect(hay).not.toContain(text);
  });

  it("the phrase-catalog fallback path checks contradictions too", async () => {
    // Deterministic phrase fallback: dictate a stenosis phrase twice with
    // conflicting severities by seeding the prior observation the same
    // deterministic engine produced — then compose the correction turn.
    const { deterministicCompose } = await import("./composer");
    const transcript = "Mild canal stenosis at L4-L5.";
    const ctx = {
      transcript,
      region: "LS Spine",
      modality: "MR",
      findingsText: "",
    };
    const det = deterministicCompose(ctx);
    expect(det, "fixture transcript must map onto the catalog for this test to be meaningful").toBeTruthy();
    const prior = det!.observations.map((o) => ({ ...o, severity: "severe" }));

    const res = await composeVoiceChangePlan(
      { ...ctx, priorObservations: prior },
      { requestId: "req-fallback", usePhraseFallback: true },
    );

    expect(res.ok).toBe(true);
    expect(
      res.warnings?.some((x) => x.code === "severity_conflict"),
      JSON.stringify(res.warnings ?? []),
    ).toBe(true);
  });
});

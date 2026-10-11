/**
 * The three assistant operations, at the engine seam.
 *
 * Covers the two things this brief exists to change: what the model is actually
 * shown (Phase 5 — the whole report, not its first 1,200 characters), and which
 * model is chosen when someone names one (Phase 4 — an unknown or unavailable
 * provider is refused, not quietly replaced by the local Ollama).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { resolveComposerRuntime, resolveComposerProvider, composeMock, resolveTaskRoute } =
  vi.hoisted(() => ({
    resolveComposerRuntime: vi.fn(),
    resolveComposerProvider: vi.fn(),
    composeMock: vi.fn(),
    resolveTaskRoute: vi.fn(),
  }));

vi.mock("../voiceReportComposer/runtimeConfig", () => ({ resolveComposerRuntime }));
vi.mock("../ssrf/ollamaUrlGuard", () => ({
  validateOllamaUrl: vi.fn(() => ({ ok: true as const })),
}));
vi.mock("./resolveSelectedKeyImages", () => ({
  resolveSelectedKeyImagesForCompose: vi.fn(async () => ({ ok: false, safeError: "unused" })),
}));
vi.mock("./visionCapability", () => ({
  assertVisionCapableModel: vi.fn(async () => ({ ok: true as const })),
  __resetVisionCapabilityCacheForTests: vi.fn(),
}));
vi.mock("@workspace/ai-providers", async () => {
  const actual = await vi.importActual<typeof import("@workspace/ai-providers")>(
    "@workspace/ai-providers",
  );
  return { ...actual, resolveTaskRoute };
});
vi.mock("./providers", async () => {
  const actual = await vi.importActual<typeof import("./providers")>("./providers");
  return { ...actual, resolveComposerProvider, assertComposerProviderPolicy: vi.fn(() => ({ ok: true as const })) };
});

import {
  buildUserPrompt,
  runReportComposer,
  selectionAnswerLosesField,
} from "./composeEngine";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

const LONG_MARKER = "MARKER-PAST-THE-OLD-1200-CHARACTER-CUT";
const IMPRESSION_MARKER = "MARKER-PAST-THE-OLD-600-CHARACTER-CUT";

function longText(marker: string, chars: number): string {
  const filler = "Loss of normal lumbar lordosis with facet arthropathy. ".repeat(
    Math.ceil(chars / 56),
  );
  return `${filler.slice(0, chars)} ${marker}`;
}

function snap(over: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    spineSegment: "lumbar",
    bodyPart: "LUMBAR_SPINE",
    family: "spine",
    protocol: "MRI lumbar spine, non-contrast",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    clinicalHistory: "Low back pain with bilateral radiculopathy.",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine.",
    findings: longText(LONG_MARKER, 2400),
    impression: longText(IMPRESSION_MARKER, 900),
    recommendation: "",
    observations: Array.from({ length: 20 }, (_, i) => ({
      concept: `concept_${i + 1}`,
      findingsText: `Observation number ${i + 1} at L4-L5.`,
    })),
    ...over,
  });
}

function runtime(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    endpoint: "http://192.168.1.250:11434",
    endpointSource: "canonical" as const,
    model: "gemma3:12b",
    visionModel: "gemma3:12b",
    localChatVisionModel: "gemma3:12b",
    fallbackModel: null,
    numCtx: 4096,
    temperature: 0.1,
    timeoutMs: 45_000,
    localOnly: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveComposerRuntime.mockResolvedValue(runtime() as never);
  resolveTaskRoute.mockResolvedValue(null as never);
  composeMock.mockResolvedValue({
    ok: true,
    text: JSON.stringify({ findings: "Rewritten.", impression: "Impression.", warnings: [] }),
    provider: "ollama",
    model: "gemma3:12b",
    latencyMs: 12,
    execution: "LOCAL",
  } as never);
  resolveComposerProvider.mockReturnValue({ name: "ollama", compose: composeMock } as never);
});

describe("the model is shown the whole report (Phase 5)", () => {
  for (const kind of ["PROFESSIONALIZE", "COMBINE", "REPHRASE", "SHORTEN", "EXPAND"] as const) {
    it(`${kind} carries every section and every observation, uncut`, () => {
      const prompt = buildUserPrompt(kind, snap({ instruction: "Make it more professional." }));
      const parsed = JSON.parse(prompt) as {
        groundingFindings: string;
        groundingImpression: string;
        observations: unknown[];
      };
      // Decisive rather than incidental: the bytes the model is offered are the
      // bytes the radiologist wrote, at full length, every observation included.
      expect(parsed.groundingFindings).toBe(longText(LONG_MARKER, 2400));
      expect(parsed.groundingImpression).toBe(longText(IMPRESSION_MARKER, 900));
      expect(parsed.observations).toHaveLength(20);
      expect(prompt).toContain("conservationRule");
      expect(prompt).toContain("Multiplanar multisequence non-contrast MRI");
      expect(prompt).toContain("MRI LUMBOSACRAL SPINE");
    });
  }

  it("COMBINE carries the supplied second report", () => {
    const prompt = buildUserPrompt(
      "COMBINE",
      snap({
        instruction: "Combine the cervical and lumbar findings.",
        additionalReports: [
          {
            label: "MRI CERVICAL SPINE",
            findings: "C5-C6 diffuse disc bulge with left foraminal narrowing.",
            impression: "C5-C6 bulge.",
          },
        ],
      }),
    );
    expect(prompt).toContain("MRI CERVICAL SPINE");
    expect(prompt).toContain("left foraminal narrowing");
  });

  it("a selection edit is told to answer with the whole section", () => {
    const prompt = buildUserPrompt(
      "REPHRASE",
      snap({ selectionText: "Observation number 3 at L4-L5.", selectionField: "FINDINGS" }),
    );
    expect(prompt).toContain("answerScope");
    expect(prompt).toContain("COMPLETE FINDINGS section");
  });
});

describe("OBSERVATIONS: dictation in, structured rows out", () => {
  it("asks for rows, not a report", () => {
    const prompt = buildUserPrompt(
      "OBSERVATIONS",
      snap({
        findings: "L4-5 diffuse bulge, bilateral recess narrowing, LF hypertrophy, canal 8.2 mm.",
        observations: [],
      }),
    );
    expect(prompt).toContain('"jobKind":"OBSERVATIONS"');
    expect(prompt).toContain("L4-5 diffuse bulge");
    expect(prompt).toContain("observationContract");
    expect(prompt).toContain("Findings and Impression stay empty");
    expect(prompt).not.toContain("Compose a COMPLETE radiologist-quality");
  });

  it("returns the rows through the same draft the job view already exposes", async () => {
    composeMock.mockResolvedValueOnce({
      ok: true,
      provider: "ollama",
      model: "gemma3:12b",
      execution: "LOCAL",
      latencyMs: 10,
      text: JSON.stringify({
        findings: "",
        impression: "",
        observations: [
          {
            concept: "disc bulge",
            level: "L4-5",
            findingsText: "Diffuse disc bulge at L4-5.",
            laterality: null,
            severity: null,
            measurement: null,
          },
        ],
        unresolvedQuestions: [],
        warnings: [],
      }),
    } as never);

    const run = await runReportComposer({
      kind: "OBSERVATIONS",
      snapshot: snap({ findings: "L4-5 diffuse bulge.", observations: [] }),
      allowDeterministicFallback: false,
    });
    expect(run.ok).toBe(true);
    expect(run.draft?.observations).toHaveLength(1);
    expect(run.draft?.observations?.[0]?.level).toBe("L4-5");
    expect(run.provider).toBe("ollama");
  });
});

describe("a named provider is never silently replaced (Phase 4)", () => {
  it("refuses an unsupported session provider and sends nothing", async () => {
    const run = await runReportComposer({
      kind: "PROFESSIONALIZE",
      snapshot: snap({ sessionProvider: "gemini" }),
      allowDeterministicFallback: false,
    });
    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("composer_provider_not_supported");
    expect(composeMock).not.toHaveBeenCalled();
    expect(run.provenance?.degradedReason).toContain("gemini");
  });

  it("refuses a Model Routing row that names an unsupported provider", async () => {
    resolveTaskRoute.mockResolvedValueOnce({ provider: "anthropic", model: "claude" } as never);
    const run = await runReportComposer({
      kind: "PROFESSIONALIZE",
      snapshot: snap(),
      allowDeterministicFallback: false,
    });
    expect(run.safeError).toBe("composer_provider_not_supported");
    expect(composeMock).not.toHaveBeenCalled();
  });

  it("still defaults to the local model when nobody named a provider", async () => {
    const run = await runReportComposer({
      kind: "PROFESSIONALIZE",
      snapshot: snap(),
      allowDeterministicFallback: false,
    });
    expect(run.ok).toBe(true);
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(run.provider).toBe("ollama");
  });

  it("reports the provider and token usage that actually answered", async () => {
    composeMock.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({ findings: "F", impression: "I" }),
      provider: "openai",
      model: "gpt-4o",
      execution: "CLOUD",
      latencyMs: 900,
      usage: { promptTokens: 1200, completionTokens: 700, totalTokens: 1900, approximateCostUsd: 0.02 },
    } as never);
    const run = await runReportComposer({
      kind: "PROFESSIONALIZE",
      snapshot: snap({ sessionProvider: "openai" }),
      allowDeterministicFallback: false,
    });
    expect(run.provider).toBe("openai");
    expect(run.usage?.promptTokens).toBe(1200);
    expect(run.usage?.completionTokens).toBe(700);
  });
});

describe("an oversized text request fails loudly instead of sending half a report", () => {
  it("refuses before the provider is called", async () => {
    const giant = longText("X", 90_000);
    const run = await runReportComposer({
      kind: "PROFESSIONALIZE",
      snapshot: snap({ findings: giant, impression: giant }),
      allowDeterministicFallback: false,
    });
    expect(run.safeError).toBe("composer_context_budget_exceeded");
    expect(composeMock).not.toHaveBeenCalled();
    expect(run.provenance?.degradedReason).toMatch(/ceiling/);
  });

  it("sizes num_ctx for the request instead of trusting the admin default", async () => {
    await runReportComposer({
      kind: "PROFESSIONALIZE",
      snapshot: snap({ findings: longText("Y", 6000), impression: "" }),
      allowDeterministicFallback: false,
    });
    const sent = composeMock.mock.calls[0]?.[0] as { numCtx: number; maxTokens: number };
    expect(sent.numCtx).toBeGreaterThan(4096);
    expect(sent.maxTokens).toBeGreaterThan(0);
  });
});

describe("a selection answer that is only the sentence is not offered", () => {
  it("measures the answer against the section it would replace", () => {
    const field = `${"Findings sentence that carries real clinical content. ".repeat(6)}`;
    expect(
      selectionAnswerLosesField({
        field,
        selectionText: "Findings sentence that carries real clinical content.",
        answer: "Reworded single sentence.",
      }),
    ).toBe(true);
    // Whole-field answer: fine.
    expect(
      selectionAnswerLosesField({ field, selectionText: "Findings sentence", answer: field }),
    ).toBe(false);
    // The selection WAS the field: nothing outside it to lose.
    expect(selectionAnswerLosesField({ field, selectionText: field, answer: "Short rewrite." })).toBe(
      false,
    );
  });

  it("refuses the job rather than preparing a destructive tracked change", async () => {
    composeMock.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({ findings: "Reworded one sentence.", impression: "" }),
      provider: "ollama",
      model: "gemma3:12b",
      execution: "LOCAL",
      latencyMs: 10,
    } as never);
    const run = await runReportComposer({
      kind: "REPHRASE",
      snapshot: snap({
        selectionText: "Observation number 3 at L4-L5.",
        selectionField: "FINDINGS",
        instruction: "rephrase",
      }),
      allowDeterministicFallback: false,
    });
    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("selection_edit_answer_truncated");
  });
});

describe("the deterministic engine keeps working with no AI at all", () => {
  it("professionalize with no model returns the radiologist's own text unchanged", () => {
    const snapshot = snap({ findings: "Disc bulge at L4-L5.", impression: "L4-L5 bulge." });
    const out = deterministicComposeFromSnapshot(snapshot, "PROFESSIONALIZE");
    expect(out.findings).toBe("Disc bulge at L4-L5.");
    expect(out.impression).toBe("L4-L5 bulge.");
    expect(out.warnings).toContain("deterministic_fallback");
    expect(out.warnings).toContain("deterministic_no_model_so_report_unchanged");
  });

  it("combine with no model merges nothing rather than pretending", () => {
    const out = deterministicComposeFromSnapshot(
      snap({
        findings: "Lumbar findings.",
        impression: "Lumbar impression.",
        additionalReports: [{ findings: "Cervical findings.", impression: "" }],
      }),
      "COMBINE",
    );
    expect(out.findings).toBe("Lumbar findings.");
    expect(out.findings).not.toContain("Cervical");
    expect(out.warnings).toContain("deterministic_no_model_so_nothing_was_merged");
  });

  it("observations have no mechanical equivalent", () => {
    const out = deterministicComposeFromSnapshot(snap({ findings: "L4-5 bulge." }), "OBSERVATIONS");
    expect(out.observations).toBeUndefined();
    expect(out.warnings).toContain("deterministic_cannot_structure_dictation");
  });
});

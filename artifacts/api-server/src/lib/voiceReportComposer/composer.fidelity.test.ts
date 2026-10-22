/**
 * Mandatory preservation of dictated clinical detail + parser tolerance for
 * LLM null optionals — the two AI-PC benchmark-confirmed Smart Dictation
 * defects, pinned as regression tests before any live model re-run.
 *
 * Defect 1 (parser): qwen3:14b emits `"baselineReplaces": null` and
 * `"clarificationRequired": false` on 21 of its 31 clinically-correct plans
 * (68%); schema.ts declared those fields .optional() without .nullable(), so
 * composer.ts refused every one with "Invalid structured response". The
 * normalization must accept null ≡ absent and false ≡ "no clarification"
 * while STILL rejecting wrong-typed and genuinely invalid payloads.
 *
 * Defect 2 (fidelity): "AP spinal canal diameter at L4-L5 is 9.2 mm" produced
 * plans with the right concept, level and update target — and no "9.2"
 * anywhere (8/8 repetitions across 14b and 8b). A dictated measurement, level,
 * laterality or severity word must survive into the applied findingsText, or
 * the plan is refused with the dictation preserved — never dropped silently.
 *
 * All clinical text below is SYNTHETIC (non-PHI).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../logger", () => ({
  logger: {
    warn: () => {},
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Production uses the DNS-pinned hardened transport; delegate to fetch so the
// LLM-path suites can read the exact body the composer sends. Replaced
// wholesale (not spread from importOriginal) because the real package pulls in
// @workspace/db and this suite must run without a database.
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

const { parseChangePlanJson, changePlan, observation, VOICE_COMPOSER_JSON_SCHEMA } = await import("./schema");
const {
  extractDictatedDetails,
  verifyDictatedDetailPreserved,
  dictationFidelityError,
} = await import("./dictationFidelity");
const { composeVoiceChangePlan } = await import("./composer");

const normalLsFindings =
  "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No significant disc bulge. Spinal canal and neural foramina are patent.";

const MEASURED_TRANSCRIPT = "AP spinal canal diameter at L4-L5 is 9.2 mm.";

/** One add/update observation carrying the given findings sentence. */
const measuredPlan = (findingsText: string) =>
  changePlan({
    observations: [
      observation({
        id: "obs-cs-45",
        concept: "canal_stenosis",
        level: "L4-L5",
        findingsText,
        operation: "update",
        targetObservationId: "obs-cs-45",
      }),
    ],
  });

/** The benchmark's qwen3:14b response shape: every optional field a literal null. */
const NULLY_PLAN_JSON = JSON.stringify({
  operation: "report_change_plan",
  observations: [
    {
      id: null,
      concept: "canal_stenosis",
      level: "L4-L5",
      severity: null,
      laterality: null,
      modifiers: null,
      findingsText: "AP spinal canal diameter at L4-L5 is 9.2 mm.",
      impressionText: null,
      anatomicalSection: null,
      conflictGroup: null,
      baselineReplaces: null,
      operation: "update",
      targetObservationId: "obs-cs-45",
    },
  ],
  removeConflictingBaselineConcepts: null,
  impressionCandidates: null,
  impressionUpdate: null,
  uncertainties: null,
  clarificationRequired: false,
});

// ── Defect 1: parser tolerance for LLM null optionals ───────────────────────

describe("parseChangePlanJson — null optionals (the 68% rejection defect)", () => {
  it("accepts the benchmark's qwen3:14b pattern: null for every optional, false for clarificationRequired", () => {
    const plan = parseChangePlanJson(NULLY_PLAN_JSON);
    expect(plan).not.toBeNull();
    expect(plan!.observations).toHaveLength(1);
    const obs = plan!.observations[0];
    expect(obs.concept).toBe("canal_stenosis");
    expect(obs.operation).toBe("update");
    expect(obs.baselineReplaces).toBeUndefined();
    expect(obs.severity).toBeUndefined();
    expect(obs.laterality).toBeUndefined();
    expect(obs.modifiers).toEqual([]);
    expect(plan!.clarificationRequired).toBeUndefined();
    expect(plan!.removeConflictingBaselineConcepts).toEqual([]);
    expect(plan!.uncertainties).toEqual([]);
  });

  it("accepts an all-null observation plan wrapped in markdown fences", () => {
    const fenced = "```json\n" + NULLY_PLAN_JSON + "\n```";
    expect(parseChangePlanJson(fenced)).not.toBeNull();
  });

  it("normalizes observations:null to the default empty array (validator then refuses it as a no-op)", () => {
    const plan = parseChangePlanJson(
      '{"operation":"report_change_plan","observations":null,"uncertainties":null}',
    );
    expect(plan).not.toBeNull();
    expect(plan!.observations).toEqual([]);
    expect(plan!.uncertainties).toEqual([]);
  });

  it("still rejects genuinely invalid payloads — acceptance is widened only for semantic no-ops", () => {
    const rejects: string[] = [
      // Required fields set to null are invalid, not absent.
      '{"operation":"report_change_plan","observations":[{"concept":null,"findingsText":"x."}]}',
      '{"operation":"report_change_plan","observations":[{"concept":"x","findingsText":null}]}',
      // Wrong types are never coerced to strings/arrays.
      '{"operation":"report_change_plan","observations":[{"concept":"x","findingsText":"x.","baselineReplaces":123}]}',
      '{"operation":"report_change_plan","observations":[{"concept":"x","findingsText":"x.","severity":true}]}',
      '{"operation":"report_change_plan","observations":"text"}',
      '{"operation":"report_change_plan","observations":[null]}',
      // Bad enum / bad literal.
      '{"operation":"report_change_plan","observations":[{"concept":"x","findingsText":"x.","operation":"replace"}]}',
      '{"operation":"not_a_plan","observations":[]}',
      // Null inside arrays is not normalized away.
      '{"operation":"report_change_plan","observations":[{"concept":"x","findingsText":"x."}],"uncertainties":["fine",null]}',
      // A boolean clarificationRequired:true carries no question text we could
      // surface — the dictation stays preserved rather than an invented prompt.
      '{"operation":"report_change_plan","observations":[],"clarificationRequired":true}',
      "no braces here at all",
    ];
    for (const raw of rejects) {
      expect(parseChangePlanJson(raw), `should reject: ${raw.slice(0, 60)}`).toBeNull();
    }
  });
});

// ── Defect 2: mandatory preservation of dictated clinical detail ────────────

describe("verifyDictatedDetailPreserved — the dictated-measurement drop defect", () => {
  it("flags the benchmark's COR-4 plan: right concept, right level, right target — and no 9.2", () => {
    const fidelity = verifyDictatedDetailPreserved(MEASURED_TRANSCRIPT, measuredPlan("Canal stenosis at L4-L5."));
    expect(fidelity.ok).toBe(false);
    const measurement = fidelity.dropped.find((d) => d.kind === "measurement");
    expect(measurement).toBeDefined();
    expect(measurement!.raw).toBe("9.2 mm");
  });

  it("accepts the same dictation when the measurement survives verbatim", () => {
    const fidelity = verifyDictatedDetailPreserved(
      MEASURED_TRANSCRIPT,
      measuredPlan("AP spinal canal diameter at L4-L5 is 9.2 mm."),
    );
    expect(fidelity.ok).toBe(true);
    expect(fidelity.dropped).toEqual([]);
  });

  it("accepts the long-form unit synonym — 9.2 millimeters is the same value", () => {
    const fidelity = verifyDictatedDetailPreserved(
      MEASURED_TRANSCRIPT,
      measuredPlan("AP spinal canal diameter at L4-L5 is 9.2 millimeters."),
    );
    expect(fidelity.ok).toBe(true);
  });

  it("never lets a neighbouring number satisfy the dictated one", () => {
    expect(verifyDictatedDetailPreserved(MEASURED_TRANSCRIPT, measuredPlan("AP canal diameter at L4-L5 is 19.2 mm.")).ok).toBe(false);
    expect(verifyDictatedDetailPreserved(MEASURED_TRANSCRIPT, measuredPlan("AP canal diameter at L4-L5 is 9.25 mm.")).ok).toBe(false);
    expect(verifyDictatedDetailPreserved(MEASURED_TRANSCRIPT, measuredPlan("AP canal diameter at L4-L5 is 9 mm.")).ok).toBe(false);
  });

  it("requires the unit too — a bare 9.2 without mm is a unit drop", () => {
    const fidelity = verifyDictatedDetailPreserved(MEASURED_TRANSCRIPT, measuredPlan("AP canal diameter at L4-L5 is 9.2."));
    expect(fidelity.ok).toBe(false);
    expect(fidelity.dropped.some((d) => d.kind === "measurement" && d.raw === "9.2 mm")).toBe(true);
  });
});

describe("verifyDictatedDetailPreserved — level, laterality and severity", () => {
  const multiFindingPlan = (findingsText: string) =>
    changePlan({
      observations: [
        observation({ concept: "disc_bulge", level: "L4-L5", findingsText, operation: "add" }),
      ],
    });

  it("treats L4-5 versus L4-L5 as the same segment — a formatting variation, not a clinical error", () => {
    const t = "Disc desiccation at L3-4 and L4-5.";
    expect(verifyDictatedDetailPreserved(t, multiFindingPlan("Disc desiccation is seen at L3-L4 and L4-L5.")).ok).toBe(true);
    expect(verifyDictatedDetailPreserved(t, multiFindingPlan("Disc desiccation is seen at L3-L4 and L4-5.")).ok).toBe(true);
    // A genuinely different segment IS a clinical error.
    expect(verifyDictatedDetailPreserved(t, multiFindingPlan("Disc desiccation is seen at L2-L3.")).ok).toBe(false);
  });

  it("flags a dropped severity or laterality modifier (the LS-1 benchmark defect)", () => {
    const t = "Mild diffuse disc bulge at L4-5. Bilateral facet arthropathy at L4-L5.";
    const ok = changePlan({
      observations: [
        observation({ concept: "disc_bulge", level: "L4-L5", severity: "mild", findingsText: "Mild diffuse disc bulge at L4-L5.", operation: "add" }),
        observation({ concept: "facet_arthropathy", level: "L4-L5", laterality: "bilateral", findingsText: "Bilateral facet arthropathy at L4-L5.", operation: "add" }),
      ],
    });
    expect(verifyDictatedDetailPreserved(t, ok).ok).toBe(true);

    const lostSeverity = changePlan({
      observations: [
        observation({ concept: "disc_bulge", level: "L4-L5", findingsText: "Diffuse disc bulge at L4-L5.", operation: "add" }),
        observation({ concept: "facet_arthropathy", level: "L4-L5", laterality: "bilateral", findingsText: "Bilateral facet arthropathy at L4-L5.", operation: "add" }),
      ],
    });
    const severityFidelity = verifyDictatedDetailPreserved(t, lostSeverity);
    expect(severityFidelity.ok).toBe(false);
    expect(severityFidelity.dropped.some((d) => d.kind === "severity" && d.raw === "mild")).toBe(true);

    const lostLaterality = changePlan({
      observations: [
        observation({ concept: "disc_bulge", level: "L4-L5", severity: "mild", findingsText: "Mild diffuse disc bulge at L4-L5.", operation: "add" }),
        observation({ concept: "facet_arthropathy", level: "L4-L5", findingsText: "Facet arthropathy at L4-L5.", operation: "add" }),
      ],
    });
    const lateralityFidelity = verifyDictatedDetailPreserved(t, lostLaterality);
    expect(lateralityFidelity.ok).toBe(false);
    expect(lateralityFidelity.dropped.some((d) => d.kind === "laterality" && d.raw === "bilateral")).toBe(true);
  });

  it("maps dictated synonyms onto the tile vocabulary (minimal→mild, marked→severe, both→bilateral)", () => {
    expect(verifyDictatedDetailPreserved(
      "Minimal canal stenosis at L4-L5.",
      multiFindingPlan("Mild canal stenosis at L4-L5."),
    ).ok).toBe(true);
    expect(verifyDictatedDetailPreserved(
      "Marked canal stenosis at L4-L5.",
      multiFindingPlan("Severe canal stenosis at L4-L5."),
    ).ok).toBe(true);
    expect(verifyDictatedDetailPreserved(
      "Facet arthropathy on both sides at L4-L5.",
      multiFindingPlan("Bilateral facet arthropathy at L4-L5."),
    ).ok).toBe(true);
  });

  it("ignores numbers without a clinical unit — age and dates are not measurements", () => {
    const details = extractDictatedDetails("45 year old male, study of 2026, two weeks of pain.");
    expect(details.filter((d) => d.kind === "measurement")).toEqual([]);
    expect(details.filter((d) => d.kind === "level")).toEqual([]);
  });

  it("keeps vertebral-body dictation intact (L1 stays L1, not the disc expansion)", () => {
    expect(verifyDictatedDetailPreserved(
      "Compression fracture of L1.",
      multiFindingPlan("Compression fracture of L1."),
    ).ok).toBe(true);
  });

  it("does not demand preservation from removal-only plans or surfaced clarifications", () => {
    const removalOnly = changePlan({
      observations: [
        observation({
          id: "obs-cs-45",
          concept: "canal_stenosis",
          level: "L4-L5",
          findingsText: "AP spinal canal diameter at L4-L5 is 9.2 mm.",
          operation: "remove",
          targetObservationId: "obs-cs-45",
        }),
      ],
    });
    expect(verifyDictatedDetailPreserved(MEASURED_TRANSCRIPT, removalOnly).ok).toBe(true);

    const clarification = changePlan({ clarificationRequired: "Which level should carry the measurement?" });
    expect(verifyDictatedDetailPreserved(MEASURED_TRANSCRIPT, clarification).ok).toBe(true);
  });

  it("reports the refusal in radiologist-readable words, echoing only what was dictated", () => {
    const fidelity = verifyDictatedDetailPreserved(MEASURED_TRANSCRIPT, measuredPlan("Canal stenosis at L4-L5."));
    expect(dictationFidelityError(fidelity.dropped)).toBe(
      'Dictated measurement "9.2 mm" not preserved in the plan — dictation preserved',
    );
  });
});

// ── End to end: the gate inside composeVoiceChangePlan ─────────────────────

describe("composeVoiceChangePlan — mandatory preservation wiring", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    runtime = {
      enabled: true,
      endpoint: "http://127.0.0.1:11434",
      endpointSource: "clinic_settings",
      model: "qwen3:14b",
      fallbackModel: null,
      numCtx: 4096,
      temperature: 0.1,
      timeoutMs: 45_000,
      localOnly: true,
      visionModel: "qwen3-vl:8b",
    };
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function compose(opts?: { transcript?: string }) {
    return composeVoiceChangePlan(
      {
        transcript: opts?.transcript ?? MEASURED_TRANSCRIPT,
        region: "LS Spine",
        modality: "MR",
        reportTitle: "MRI Lumbar Spine Screening",
        findingsText: normalLsFindings,
        priorObservations: [
          observation({
            id: "obs-cs-45",
            concept: "canal_stenosis",
            level: "L4-L5",
            severity: "mild",
            laterality: null,
            findingsText: "Mild canal stenosis at L4-L5.",
          }),
        ],
      },
      { requestId: "req-fidelity" },
    );
  }

  it("accepts the null-optional plan the production parser used to refuse (defect 1, end to end)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ response: NULLY_PLAN_JSON }),
      text: async () => NULLY_PLAN_JSON,
    });

    const res = await compose();

    expect(res.ok).toBe(true);
    expect(res.plan?.observations[0].findingsText).toContain("9.2 mm");
    expect(res.diagnostics?.schemaOk).toBe(true);
    expect(res.diagnostics?.validationOk).toBe(true);
  });

  it("refuses a plan that drops the dictated measurement — dictation preserved for review (defect 2)", async () => {
    const droppingPlan = JSON.stringify({
      operation: "report_change_plan",
      observations: [
        {
          id: "obs-cs-45",
          concept: "canal_stenosis",
          level: "L4-L5",
          findingsText: "Canal stenosis at L4-L5.",
          operation: "update",
          targetObservationId: "obs-cs-45",
        },
      ],
      uncertainties: [],
      clarificationRequired: null,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ response: droppingPlan }),
      text: async () => droppingPlan,
    });

    const res = await compose();

    expect(res.ok).toBe(false);
    expect(res.error).toContain("9.2 mm");
    expect(res.error).toContain("dictation preserved");
    expect(res.diagnostics?.failureReason).toBe("dictated_detail_dropped");
    expect(res.diagnostics?.schemaOk).toBe(true);
    // PHI-safe diagnostics: the dictated value and transcript never leak there.
    const hay = JSON.stringify(res.diagnostics);
    expect(hay).not.toContain("9.2");
    expect(hay).not.toContain("AP spinal");
    expect(res.diagnostics?.failureReason).toMatch(/^[a-z_]+$/);
  });

  it("carries the verbatim-carry prompt instruction to the model", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ response: NULLY_PLAN_JSON }),
      text: async () => NULLY_PLAN_JSON,
    });

    await compose();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { prompt: string };
    expect(body.prompt).toContain("CARRY DICTATED VALUES VERBATIM");
    expect(body.prompt).toContain("9.2 mm");
  });

  it("sends the real JSON schema as Ollama's structured output format", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ response: NULLY_PLAN_JSON }),
      text: async () => NULLY_PLAN_JSON,
    });

    await compose();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { format: unknown };
    expect(body.format).toEqual(VOICE_COMPOSER_JSON_SCHEMA);
  });

  it("phrase fallback refuses a measured dictation it cannot word, instead of losing the number", async () => {
    const res = await composeVoiceChangePlan(
      {
        transcript: "Canal stenosis at L4-5 with AP diameter 9.2 mm.",
        region: "LS Spine",
        modality: "MR",
        findingsText: normalLsFindings,
      },
      { requestId: "req-fallback", usePhraseFallback: true },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain("9.2 mm");
    expect(res.error).toContain("dictation preserved");
    expect(res.diagnostics?.failureReason).toBe("dictated_detail_dropped");
    expect(res.diagnostics?.phraseFallback).toBe(true);
  });

  it("phrase fallback still passes a dictation it words completely (no false gate)", async () => {
    const res = await composeVoiceChangePlan(
      {
        transcript: "Mild canal stenosis at L4-5.",
        region: "LS Spine",
        modality: "MR",
        findingsText: normalLsFindings,
      },
      { requestId: "req-fallback-ok", usePhraseFallback: true },
    );

    expect(res.ok).toBe(true);
    expect(res.plan?.observations[0].findingsText).toBe("Mild canal stenosis at L4-L5.");
  });

  it("phrase fallback refuses a severity it has no wording for, instead of silently dropping it", async () => {
    // The catalog's disc_bulge sentence has no [severity] slot (never-invent-wording
    // means no new wording may be created to hold it), so "mild" has nowhere
    // honest to go. Before the fidelity gate this dictation applied
    // "Diffuse disc bulge at L4-L5." and the severity vanished silently.
    const res = await composeVoiceChangePlan(
      {
        transcript: "Mild diffuse disc bulge at L4-5.",
        region: "LS Spine",
        modality: "MR",
        findingsText: normalLsFindings,
      },
      { requestId: "req-fallback-severity", usePhraseFallback: true },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain('"mild"');
    expect(res.error).toContain("dictation preserved");
    expect(res.diagnostics?.failureReason).toBe("dictated_detail_dropped");
    expect(res.diagnostics?.phraseFallback).toBe(true);
  });
});

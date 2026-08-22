/**
 * Pure helpers for AI Pipeline Self-Test outcome classification.
 * No DB / network — unit-tested directly.
 */

export type StageStatus = "pass" | "fail" | "skip" | "not_reached";

export interface PipelineStageResult {
  id:
    | "image_fetch"
    | "provider_request"
    | "provider_response_received"
    | "json_parse"
    | "candidate_extract"
    | "trust_grounding"
    | "final_shape";
  status: StageStatus;
  elapsedMs?: number | null;
  detail: string;
}

export interface PathProbeTiming {
  probeStartedAt: string;
  providerRequestStartedAt: string | null;
  providerCompletedAt: string | null;
  probeCompletedAt: string;
}

export interface PathProbeResult {
  label: string;
  pass: boolean;
  model: string | null;
  endpoint: string | null;
  imageCount: number;
  totalImageBytes: number;
  requestBodyBytes: number | null;
  elapsedMs: number;
  httpStatus: number | null;
  responseLength: number;
  parserSuccess: boolean | null;
  candidateCount: number | null;
  safeError: string | null;
  stages: PipelineStageResult[];
  thinkSent?: boolean | null;
  thinkValue?: boolean | null;
  thinkingLength?: number | null;
  finishReason?: string | null;
  ollamaTotalDurationNs?: number | null;
  ollamaLoadDurationNs?: number | null;
  ollamaPromptEvalCount?: number | null;
  ollamaEvalCount?: number | null;
  /** num_predict sent on the Ollama request (infra probes). */
  requestNumPredict?: number | null;
  configuredNumCtx?: number | null;
  requestedNumCtx?: number | null;
  ollamaAvailableContext?: number | null;
  ollamaRequestTokens?: number | null;
  errorCode?: string | null;
  /** Compact infra probes: usable JSON sighting vs full clinical draft. */
  usableOutput?: boolean | null;
  estimatedRequestTokens?: number | null;
  timing?: PathProbeTiming;
  runnersBefore?: unknown;
  runnersAfter?: unknown;
  /** After unload+wait: true when /api/ps confirms model absent before request. */
  runnerClearedBeforeRequest?: boolean | null;
  unloadWaitDetail?: string | null;
}

export type SelfTestFinal = "PASS" | "FAIL" | "PARTIAL" | "RUNNING" | "NO_MRI";

/** Classify FINDINGS/IMPRESSION draft text into parser + candidate counts (interactive draft). */
export function parseDraftSections(aiResponse: string): {
  parserSuccess: boolean;
  findingsLength: number;
  impressionLength: number;
  candidateCount: number;
  looksLikeJson: boolean;
  jsonParseOk: boolean | null;
} {
  const text = (aiResponse ?? "").trim();
  const looksLikeJson = text.startsWith("{") || text.startsWith("[");
  let jsonParseOk: boolean | null = null;
  if (looksLikeJson) {
    try {
      JSON.parse(text);
      jsonParseOk = true;
    } catch {
      jsonParseOk = false;
    }
  }
  const findingsMatch = text.match(/FINDINGS:?\s*([\s\S]*?)(?=IMPRESSION:|$)/i);
  const impressionMatch = text.match(/IMPRESSION:?\s*([\s\S]*?)$/i);
  const findings = findingsMatch?.[1]?.trim() ?? (looksLikeJson ? "" : text);
  const impression = impressionMatch?.[1]?.trim() ?? "";
  const parserSuccess = findings.length > 0 || impression.length > 0;
  // Interactive draft candidates ≈ non-empty bullet/line findings (+ impression as 1).
  const findingLines = findings
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 8);
  const candidateCount =
    (findingLines.length > 0 ? findingLines.length : findings.length > 0 ? 1 : 0) +
    (impression.length > 0 ? 1 : 0);
  return {
    parserSuccess,
    findingsLength: findings.length,
    impressionLength: impression.length,
    candidateCount,
    looksLikeJson,
    jsonParseOk,
  };
}

/** Build staged results for a provider-only probe (stops before parser/trust). */
export function buildProviderOnlyStages(input: {
  imageFetchOk: boolean;
  imageFetchMs: number;
  providerReturned: boolean;
  providerElapsedMs: number;
  httpStatus: number | null;
  safeError: string | null;
}): PipelineStageResult[] {
  const stages: PipelineStageResult[] = [
    {
      id: "image_fetch",
      status: input.imageFetchOk ? "pass" : "fail",
      elapsedMs: input.imageFetchMs,
      detail: input.imageFetchOk ? "images ready" : "image fetch failed",
    },
  ];
  if (!input.imageFetchOk) {
    return [
      ...stages,
      stage("provider_request", "not_reached", null, "not reached"),
      stage("provider_response_received", "not_reached", null, "not reached"),
      stage("json_parse", "not_reached", null, "not reached (provider-only)"),
      stage("candidate_extract", "not_reached", null, "not reached (provider-only)"),
      stage("trust_grounding", "not_reached", null, "not reached (provider-only)"),
      stage("final_shape", "not_reached", null, "not reached (provider-only)"),
    ];
  }
  if (!input.providerReturned) {
    return [
      ...stages,
      stage(
        "provider_request",
        "fail",
        input.providerElapsedMs,
        input.safeError
          ? `FAIL ${input.httpStatus ?? "?"} at ${(input.providerElapsedMs / 1000).toFixed(1)}s — ${input.safeError}`
          : `FAIL at ${(input.providerElapsedMs / 1000).toFixed(1)}s`,
      ),
      stage("provider_response_received", "fail", null, "NO"),
      stage("json_parse", "not_reached", null, "not reached"),
      stage("candidate_extract", "not_reached", null, "not reached"),
      stage("trust_grounding", "not_reached", null, "not reached"),
      stage("final_shape", "not_reached", null, "not reached"),
    ];
  }
  return [
    ...stages,
    stage(
      "provider_request",
      "pass",
      input.providerElapsedMs,
      `PASS ${(input.providerElapsedMs / 1000).toFixed(1)}s`,
    ),
    stage("provider_response_received", "pass", null, "YES"),
    stage("json_parse", "skip", null, "skipped (provider-only stop)"),
    stage("candidate_extract", "skip", null, "skipped (provider-only stop)"),
    stage("trust_grounding", "skip", null, "skipped (provider-only stop)"),
    stage("final_shape", "skip", null, "skipped (provider-only stop)"),
  ];
}

/** Build staged results for full CARE interactive draft path. */
export function buildFullCareStages(input: {
  imageFetchOk: boolean;
  imageFetchMs: number;
  providerReturned: boolean;
  providerElapsedMs: number;
  httpStatus: number | null;
  safeError: string | null;
  parserSuccess: boolean | null;
  candidateCount: number | null;
  jsonParseOk: boolean | null;
}): PipelineStageResult[] {
  const base = buildProviderOnlyStages({
    imageFetchOk: input.imageFetchOk,
    imageFetchMs: input.imageFetchMs,
    providerReturned: input.providerReturned,
    providerElapsedMs: input.providerElapsedMs,
    httpStatus: input.httpStatus,
    safeError: input.safeError,
  });
  if (!input.imageFetchOk || !input.providerReturned) {
    // Replace skip/not_reached parser stages with not_reached for full path wording
    return base.map((s) => {
      if (
        s.id === "json_parse" ||
        s.id === "candidate_extract" ||
        s.id === "trust_grounding" ||
        s.id === "final_shape"
      ) {
        return { ...s, status: "not_reached" as const, detail: "not reached" };
      }
      return s;
    });
  }

  const jsonStatus: StageStatus =
    input.jsonParseOk === true
      ? "pass"
      : input.jsonParseOk === false
        ? "fail"
        : input.parserSuccess
          ? "pass"
          : "fail";
  const jsonDetail =
    input.jsonParseOk === true
      ? "structured JSON OK"
      : input.jsonParseOk === false
        ? "FAIL — response looked like JSON but failed to parse"
        : input.parserSuccess
          ? "FINDINGS/IMPRESSION sections parsed"
          : "FAIL — no usable FINDINGS/IMPRESSION";

  const candStatus: StageStatus =
    input.parserSuccess === false
      ? "not_reached"
      : (input.candidateCount ?? 0) > 0
        ? "pass"
        : "fail";
  const candDetail =
    input.parserSuccess === false
      ? "not reached"
      : `candidates=${input.candidateCount ?? 0}`;

  const finalOk = Boolean(input.parserSuccess && (input.candidateCount ?? 0) > 0);

  return [
    ...base.filter(
      (s) =>
        s.id === "image_fetch" ||
        s.id === "provider_request" ||
        s.id === "provider_response_received",
    ),
    stage("json_parse", jsonStatus, null, jsonDetail),
    stage("candidate_extract", candStatus, null, candDetail),
    stage(
      "trust_grounding",
      "skip",
      null,
      "N/A on interactive /api/ai-reporting/draft (overnight shadow only)",
    ),
    stage(
      "final_shape",
      finalOk ? "pass" : "fail",
      null,
      finalOk ? "usable draft sections present" : "empty / unusable draft shape",
    ),
  ];
}

function stage(
  id: PipelineStageResult["id"],
  status: StageStatus,
  elapsedMs: number | null,
  detail: string,
): PipelineStageResult {
  return { id, status, elapsedMs, detail };
}

/**
 * Derive overall self-test final from key probes.
 * Direct OK + CARE/provider fail → PARTIAL.
 * Empty full-pipeline output is never PASS.
 * Context-budget failures are called out explicitly (not generic 502).
 */
export function deriveSelfTestFinal(input: {
  noMri: boolean;
  directGeneratePass: boolean | null;
  directChatPass: boolean | null;
  providerOnly1Pass: boolean | null;
  providerOnly6Pass: boolean | null;
  fullCare1Pass: boolean | null;
  fullCare6Pass: boolean | null;
  contextProbe8192Pass?: boolean | null;
  contextProbe16384Pass?: boolean | null;
  contextBudgetExceeded?: boolean;
}): { final: SelfTestFinal; summary: string } {
  if (input.noMri) {
    return {
      final: "NO_MRI",
      summary: "Could not run image test — no eligible MRI found.",
    };
  }

  const directOk = Boolean(input.directGeneratePass || input.directChatPass);
  const provider1 = input.providerOnly1Pass;
  const provider6 = input.providerOnly6Pass;
  const full1 = input.fullCare1Pass;
  const full6 = input.fullCare6Pass;

  const allFullPass = full1 === true && (full6 === true || full6 === null);
  const anyProviderFail = provider1 === false || provider6 === false;
  const anyFullFail = full1 === false || full6 === false;
  const providerOkFullFail =
    (provider1 === true || provider6 === true) && anyFullFail;

  if (allFullPass && directOk) {
    return { final: "PASS", summary: "PASS — end-to-end AI pipeline healthy (1 and multi-image)." };
  }
  if (allFullPass && !directOk) {
    return {
      final: "PASS",
      summary: "PASS — CARE pipeline healthy (direct probe had issues; review Direct steps).",
    };
  }

  if (input.contextBudgetExceeded && provider1 === true && provider6 === false) {
    const ctxHint =
      input.contextProbe8192Pass === true
        ? "6 images PASS at num_ctx=8192"
        : input.contextProbe16384Pass === true
          ? "6 images PASS at num_ctx=16384"
          : "raise/send options.num_ctx (do not omit)";
    return {
      final: "PARTIAL",
      summary: `PARTIAL / FAIL — CONTEXT_BUDGET_EXCEEDED on multi-image without adequate num_ctx. ${ctxHint}.`,
    };
  }

  // Prefer the most specific multi-image regression signal.
  if (provider1 === true && provider6 === false) {
    return {
      final: "PARTIAL",
      summary:
        "PARTIAL / FAIL — Provider OK with 1 image; fails with normal draft image count (up to 6).",
    };
  }

  if (directOk && anyProviderFail && !providerOkFullFail) {
    const which =
      provider1 === false && provider6 === false
        ? "1-image and 6-image provider"
        : provider1 === false
          ? "1-image provider"
          : "6-image provider";
    return {
      final: "PARTIAL",
      summary: `PARTIAL / FAIL — Direct vision healthy; CARE provider-only failed (${which}).`,
    };
  }

  if (directOk && providerOkFullFail) {
    return {
      final: "PARTIAL",
      summary:
        "PARTIAL / FAIL — Direct vision + provider OK; Full CARE pipeline failed at parser/final_shape.",
    };
  }

  if (!directOk && anyProviderFail) {
    return { final: "FAIL", summary: "FAIL — direct Ollama and CARE provider path both failed." };
  }

  return {
    final: "FAIL",
    summary: "FAIL — AI pipeline self-test did not pass all CARE stages.",
  };
}

/** Assert a diagnostic report string contains no base64/PHI-like blobs. */
export function assertDiagnosticReportPhiSafe(report: string): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (/data:image\//i.test(report)) reasons.push("contains data:image URL");
  if (/base64,[A-Za-z0-9+/]{80,}/i.test(report)) reasons.push("contains long base64 payload");
  // Extremely long unbroken alphanumeric runs likely raw base64
  if (/[A-Za-z0-9+/]{400,}={0,2}/.test(report)) reasons.push("contains long opaque blob");
  return { ok: reasons.length === 0, reasons };
}

/** Self-test must never claim clinical write side-effects. */
export function selfTestSafetyContract(): {
  writesClinicalReport: false;
  finalizesReport: false;
  bulkEnqueuesOvernight: false;
  diagnosticOnly: true;
} {
  return {
    writesClinicalReport: false,
    finalizesReport: false,
    bulkEnqueuesOvernight: false,
    diagnosticOnly: true,
  };
}

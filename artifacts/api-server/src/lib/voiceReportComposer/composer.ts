/**
 * Voice Report Composer — Ollama structured change-plan generation.
 */
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import { buildComposerPrompt, type ComposerContextInput } from "./contextBuilder";
import { catalogForPrompt, fillLevelInPhrase, matchCatalogPhrases } from "./phraseCatalog";
import {
  changePlan,
  observation,
  parseChangePlanJson,
  type VoiceChangePlan,
  type VoiceObservation,
} from "./schema";
import { validateChangePlan } from "./validator";
import { buildDiagnostics, type ComposerDiagnostics } from "./diagnostics";
import { extractLevels, normalizeComposerTranscript } from "./transcriptNormalize";

export type ComposeResult = {
  ok: boolean;
  plan?: VoiceChangePlan;
  error?: string;
  diagnostics?: ComposerDiagnostics;
};

const V1_REGIONS = /brain|ls spine|lumbo|lumbar spine/i;

const SYNTHETIC_TEST_TRANSCRIPT =
  "Disc desiccation at L3-4 and L4-5 with mild diffuse disc bulge at L4-5.";

/** Deterministic phrase catalog — tests/demo/explicit radiologist phrase fallback only. */
export function deterministicCompose(ctx: ComposerContextInput): VoiceChangePlan | null {
  const normalized = normalizeComposerTranscript(ctx.transcript, ctx.priorObservations);
  if (normalized.clarificationRequired) {
    return changePlan({ clarificationRequired: normalized.clarificationRequired });
  }

  const transcript = normalized.text.trim();
  if (!transcript) return null;

  if (normalized.isNegation) {
    const last = ctx.priorObservations?.slice(-1)[0];
    if (!last) {
      return changePlan({
        clarificationRequired: "Nothing to negate — no prior observation",
      });
    }
    return changePlan({
      observations: [observation({
        concept: last.concept,
        operation: "remove",
        targetObservationId: last.id,
        findingsText: last.findingsText,
      })],
    });
  }

  if (ctx.generateImpressionOnly) {
    const lines = (ctx.findingsText ?? "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s && !/\b(normal|unremarkable|maintained|no acute)\b/i.test(s));
    if (!lines.length) return null;
    return changePlan({
      impressionUpdate: lines.slice(0, 4).join(" "),
      clarificationRequired: null,
    });
  }

  if (normalized.correctionLevel && ctx.priorObservations?.length) {
    const target = ctx.priorObservations.find((o) =>
      o.concept.includes("disc") || o.concept.includes("bulge"),
    );
    if (target) {
      const catalogHits = matchCatalogPhrases(transcript);
      const hit = catalogHits[0];
      const findingsText = hit
        ? fillLevelInPhrase(hit.findingsText, normalized.correctionLevel)
        : transcript;
      return changePlan({
        observations: [observation({
          id: target.id,
          concept: target.concept,
          level: normalized.correctionLevel,
          findingsText,
          operation: "update",
          targetObservationId: target.id,
          anatomicalSection: hit?.anatomicalSection ?? target.anatomicalSection,
          conflictGroup: hit?.conflictGroup ?? target.conflictGroup,
        })],
      });
    }
  }

  const catalogHits = matchCatalogPhrases(transcript);
  const observations: VoiceObservation[] = [];
  const levels = extractLevels(transcript);

  for (const hit of catalogHits) {
    if (levels.length > 1 && /disc|bulge|desiccation/i.test(hit.concept)) {
      for (const lv of levels) {
        observations.push(observation({
          id: `obs_${hit.concept}_${lv}`,
          concept: hit.concept,
          level: lv,
          findingsText: fillLevelInPhrase(hit.findingsText, lv),
          impressionText: hit.impressionText ? fillLevelInPhrase(hit.impressionText, lv) : undefined,
          anatomicalSection: hit.anatomicalSection,
          conflictGroup: `${hit.conflictGroup ?? hit.anatomicalSection}_${lv}`,
          baselineReplaces: hit.baselineReplaces,
          operation: "add",
        }));
      }
    } else {
      const level = levels[0] ?? null;
      observations.push(observation({
        id: `obs_${hit.concept}`,
        concept: hit.concept,
        level,
        findingsText: fillLevelInPhrase(hit.findingsText, level),
        impressionText: hit.impressionText ? fillLevelInPhrase(hit.impressionText, level) : undefined,
        anatomicalSection: hit.anatomicalSection,
        conflictGroup: level
          ? `${hit.conflictGroup ?? hit.anatomicalSection}_${level}`
          : hit.conflictGroup,
        baselineReplaces: hit.baselineReplaces,
        operation: "add",
      }));
    }
  }

  if (/desiccation/i.test(transcript) && levels.length) {
    for (const lv of levels) {
      if (!observations.some((o) => o.level === lv && o.concept === "disc_desiccation")) {
        observations.push(observation({
          id: `obs_desiccation_${lv}`,
          concept: "disc_desiccation",
          level: lv,
          findingsText: `Disc desiccation at ${lv} with reduced T2 signal.`,
          anatomicalSection: "disc",
          conflictGroup: `disc_${lv}`,
          operation: "add",
        }));
      }
    }
  }

  if (/modic/i.test(transcript) && levels.length) {
    const grade = transcript.match(/type\s*(I{1,3}|\d)/i)?.[1] ?? "II";
    for (const lv of levels) {
      observations.push(observation({
        id: `obs_modic_${lv}`,
        concept: "modic_changes",
        level: lv,
        findingsText: `Modic type ${grade} endplate changes at ${lv}.`,
        anatomicalSection: "disc",
        conflictGroup: `modic_${lv}`,
        operation: "add",
      }));
    }
  }

  if (!observations.length) return null;

  return changePlan({
    observations,
    removeConflictingBaselineConcepts: observations
      .map((o) => o.baselineReplaces)
      .filter(Boolean) as string[],
    impressionCandidates: observations.map((o) => o.impressionText).filter(Boolean) as string[],
    clarificationRequired: null,
  });
}

async function ollamaGenerateJson(
  endpoint: string,
  model: string,
  prompt: string,
  opts: { numCtx: number; temperature: number; timeoutMs: number },
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: {
          num_ctx: opts.numCtx,
          temperature: opts.temperature,
        },
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = (await res.json()) as { response?: string };
    return (data.response ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function composeVoiceChangePlan(
  ctx: ComposerContextInput,
  opts?: {
    requestId?: string;
    usePhraseFallback?: boolean;
  },
): Promise<ComposeResult> {
  const t0 = Date.now();
  const requestId = opts?.requestId ?? "local";
  const { resolveComposerRuntime } = await import("./runtimeConfig");
  const runtime = await resolveComposerRuntime();

  const region = ctx.region ?? "";
  const transcriptLength = ctx.transcript.trim().length;

  if (!V1_REGIONS.test(region)) {
    return {
      ok: false,
      error: "Voice composer not yet supported for this study region (V1: MRI Brain and LS Spine only)",
      diagnostics: buildDiagnostics({
        requestId,
        model: runtime.model || "none",
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: false,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  const normalized = normalizeComposerTranscript(ctx.transcript, ctx.priorObservations);
  if (normalized.clarificationRequired) {
    return {
      ok: false,
      error: normalized.clarificationRequired,
      diagnostics: buildDiagnostics({
        requestId,
        model: runtime.model || "none",
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: false,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  const effectiveCtx = { ...ctx, transcript: normalized.text };

  const validationInput = {
    findingsText: ctx.findingsText ?? "",
    impressionText: ctx.impressionText ?? "",
    generateImpressionOnly: ctx.generateImpressionOnly,
  };

  if (opts?.usePhraseFallback) {
    const det = deterministicCompose(effectiveCtx);
    if (!det || det.clarificationRequired) {
      return {
        ok: false,
        error: det?.clarificationRequired ?? "Phrase fallback could not map dictation",
        diagnostics: buildDiagnostics({
          requestId,
          model: "phrase_catalog",
          region,
          transcriptLength,
          latencyMs: Date.now() - t0,
          validationOk: false,
          phraseFallback: true,
          endpointSource: runtime.endpointSource,
        }),
      };
    }
    const v = validateChangePlan({ plan: det, ...validationInput });
    if (!v.ok) {
      return {
        ok: false,
        error: v.reason ?? "Validation failed",
        diagnostics: buildDiagnostics({
          requestId,
          model: "phrase_catalog",
          region,
          transcriptLength,
          latencyMs: Date.now() - t0,
          validationOk: false,
          phraseFallback: true,
          endpointSource: runtime.endpointSource,
        }),
      };
    }
    return {
      ok: true,
      plan: det,
      diagnostics: buildDiagnostics({
        requestId,
        model: "phrase_catalog",
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: true,
        schemaOk: true,
        phraseFallback: true,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  if (!runtime.enabled || !runtime.model) {
    return {
      ok: false,
      error: "Report Composer model not configured — dictation preserved",
      diagnostics: buildDiagnostics({
        requestId,
        model: "none",
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: false,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  const guard = validateOllamaUrl(runtime.endpoint, runtime.localOnly);
  if (!guard.ok) {
    return {
      ok: false,
      error: "Local composer unavailable — dictation preserved",
      diagnostics: buildDiagnostics({
        requestId,
        model: runtime.model,
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: false,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  const catalogBlock = catalogForPrompt(region);
  const prompt = buildComposerPrompt(effectiveCtx, catalogBlock);
  const endpoint = guard.url.origin;

  let raw = "";
  let modelUsed = runtime.model;
  let fallbackUsed = false;

  try {
    raw = await ollamaGenerateJson(endpoint, runtime.model, prompt, runtime);
  } catch {
    if (runtime.fallbackModel) {
      try {
        raw = await ollamaGenerateJson(endpoint, runtime.fallbackModel, prompt, runtime);
        modelUsed = runtime.fallbackModel;
        fallbackUsed = true;
      } catch {
        return {
          ok: false,
          error: "Local composer unavailable — dictation preserved",
          diagnostics: buildDiagnostics({
            requestId,
            model: modelUsed,
            region,
            transcriptLength,
            latencyMs: Date.now() - t0,
            validationOk: false,
            fallbackUsed,
            endpointSource: runtime.endpointSource,
          }),
        };
      }
    } else {
      return {
        ok: false,
        error: "Local composer unavailable — dictation preserved",
        diagnostics: buildDiagnostics({
          requestId,
          model: modelUsed,
          region,
          transcriptLength,
          latencyMs: Date.now() - t0,
          validationOk: false,
          endpointSource: runtime.endpointSource,
        }),
      };
    }
  }

  const tParse = Date.now();
  const plan = parseChangePlanJson(raw);
  if (!plan) {
    return {
      ok: false,
      error: "Invalid structured response — dictation preserved",
      diagnostics: buildDiagnostics({
        requestId,
        model: modelUsed,
        region,
        transcriptLength,
        latencyMs: tParse - t0,
        validationMs: 0,
        validationOk: false,
        schemaOk: false,
        fallbackUsed,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  const v = validateChangePlan({ plan, ...validationInput });
  const validationMs = Date.now() - tParse;
  if (!v.ok) {
    return {
      ok: false,
      error: v.reason ?? "Validation failed",
      diagnostics: buildDiagnostics({
        requestId,
        model: modelUsed,
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationMs,
        validationOk: false,
        schemaOk: true,
        fallbackUsed,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  return {
    ok: true,
    plan,
    diagnostics: buildDiagnostics({
      requestId,
      model: modelUsed,
      region,
      transcriptLength,
      latencyMs: Date.now() - t0,
      validationMs,
      validationOk: true,
      schemaOk: true,
      fallbackUsed,
      endpointSource: runtime.endpointSource,
    }),
  };
}

export { SYNTHETIC_TEST_TRANSCRIPT };

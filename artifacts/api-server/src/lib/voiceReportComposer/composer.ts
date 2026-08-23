/**
 * Voice Report Composer — Ollama structured change-plan generation.
 */
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import { buildComposerPrompt, type ComposerContextInput } from "./contextBuilder";
import { catalogForPrompt, fillLevelInPhrase, matchCatalogPhrases } from "./phraseCatalog";
import { parseChangePlanJson, type VoiceChangePlan, type VoiceObservation } from "./schema";
import { validateChangePlan } from "./validator";

export type ComposeResult = {
  ok: boolean;
  plan?: VoiceChangePlan;
  error?: string;
  diagnostics?: {
    provider: "ollama";
    model: string;
    fallbackUsed?: boolean;
    latencyMs: number;
    validationMs: number;
    transcript: string;
  };
};

const V1_REGIONS = /brain|ls spine|lumbo|lumbar spine/i;

function levelFromTranscript(transcript: string): string | null {
  const m = transcript.match(/\bL(\d)\s*[-–]\s*L(\d)\b/i) ?? transcript.match(/\bL(\d)-(\d)\b/i);
  if (m) return `L${m[1]}-L${m[2]}`;
  const single = transcript.match(/\bL(\d)\s*[-–]\s*(\d)\b/i);
  if (single) return `L${single[1]}-L${single[2]}`;
  return null;
}

/** Deterministic fallback when Ollama unavailable — spine/brain phrase patterns only. */
export function deterministicCompose(ctx: ComposerContextInput): VoiceChangePlan | null {
  const transcript = ctx.transcript.trim();
  if (!transcript) return null;

  if (ctx.generateImpressionOnly) {
    const lines = (ctx.findingsText ?? "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s && !/\b(normal|unremarkable|maintained|no acute)\b/i.test(s));
    if (!lines.length) return null;
    return {
      operation: "report_change_plan",
      observations: [],
      impressionUpdate: lines.slice(0, 4).join(" "),
      uncertainties: [],
      clarificationRequired: null,
    };
  }

  const catalogHits = matchCatalogPhrases(transcript);
  const observations: VoiceObservation[] = [];
  const level = levelFromTranscript(transcript);

  for (const hit of catalogHits) {
    observations.push({
      id: `obs_${hit.concept}`,
      concept: hit.concept,
      level,
      findingsText: fillLevelInPhrase(hit.findingsText, level),
      impressionText: hit.impressionText ? fillLevelInPhrase(hit.impressionText, level) : undefined,
      anatomicalSection: hit.anatomicalSection,
      conflictGroup: hit.conflictGroup,
      baselineReplaces: hit.baselineReplaces,
      operation: "add",
    });
  }

  // Parse explicit levels in transcript for desiccation etc.
  const levelMatches = [...transcript.matchAll(/\bL(\d)\s*[-–]\s*L(\d)\b/gi)];
  if (/desiccation/i.test(transcript) && levelMatches.length) {
    for (const m of levelMatches) {
      const lv = `L${m[1]}-L${m[2]}`;
      if (!observations.some((o) => o.level === lv && o.concept === "disc_desiccation")) {
        observations.push({
          id: `obs_desiccation_${lv}`,
          concept: "disc_desiccation",
          level: lv,
          findingsText: `Disc desiccation at ${lv} with reduced T2 signal.`,
          anatomicalSection: "disc",
          conflictGroup: "disc",
          operation: "add",
        });
      }
    }
  }

  if (!observations.length) return null;

  return {
    operation: "report_change_plan",
    observations,
    removeConflictingBaselineConcepts: observations
      .map((o) => o.baselineReplaces)
      .filter(Boolean) as string[],
    impressionCandidates: observations.map((o) => o.impressionText).filter(Boolean) as string[],
    uncertainties: [],
    clarificationRequired: null,
  };
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
  opts?: { allowDeterministicFallback?: boolean },
): Promise<ComposeResult> {
  const t0 = Date.now();
  const { resolveComposerRuntime } = await import("./runtimeConfig");
  const runtime = await resolveComposerRuntime();

  if (!V1_REGIONS.test(ctx.region ?? "")) {
    return { ok: false, error: "Voice composer V1 supports MRI Brain and LS Spine only" };
  }

  const validationInput = {
    findingsText: ctx.findingsText ?? "",
    impressionText: ctx.impressionText ?? "",
    generateImpressionOnly: ctx.generateImpressionOnly,
  };

  if (!runtime.enabled || !runtime.model) {
    if (opts?.allowDeterministicFallback) {
      const det = deterministicCompose(ctx);
      if (!det) return { ok: false, error: "Local composer unavailable — dictation preserved" };
      const v = validateChangePlan({ plan: det, ...validationInput });
      if (!v.ok) return { ok: false, error: v.reason ?? "Validation failed" };
      return {
        ok: true,
        plan: det,
        diagnostics: {
          provider: "ollama",
          model: "deterministic",
          latencyMs: Date.now() - t0,
          validationMs: 0,
          transcript: ctx.transcript,
        },
      };
    }
    return { ok: false, error: "Report Composer model not configured" };
  }

  const guard = validateOllamaUrl(runtime.endpoint, runtime.localOnly);
  if (!guard.ok) return { ok: false, error: guard.reason };

  const catalogBlock = catalogForPrompt(ctx.region ?? "");
  const prompt = buildComposerPrompt(ctx, catalogBlock);
  const endpoint = guard.url.origin;

  let raw = "";
  let modelUsed = runtime.model;
  let fallbackUsed = false;

  try {
    raw = await ollamaGenerateJson(endpoint, runtime.model, prompt, runtime);
  } catch (primaryErr) {
    if (runtime.fallbackModel) {
      try {
        raw = await ollamaGenerateJson(endpoint, runtime.fallbackModel, prompt, runtime);
        modelUsed = runtime.fallbackModel;
        fallbackUsed = true;
      } catch {
        if (opts?.allowDeterministicFallback) {
          const det = deterministicCompose(ctx);
          if (det) {
            const v = validateChangePlan({ plan: det, ...validationInput });
            if (v.ok) {
              return {
                ok: true,
                plan: det,
                diagnostics: {
                  provider: "ollama",
                  model: "deterministic",
                  latencyMs: Date.now() - t0,
                  validationMs: 0,
                  transcript: ctx.transcript,
                },
              };
            }
          }
        }
        return {
          ok: false,
          error: "Local composer unavailable — dictation preserved",
          diagnostics: {
            provider: "ollama",
            model: modelUsed,
            fallbackUsed,
            latencyMs: Date.now() - t0,
            validationMs: 0,
            transcript: ctx.transcript,
          },
        };
      }
    } else {
      if (opts?.allowDeterministicFallback) {
        const det = deterministicCompose(ctx);
        if (det) {
          const v = validateChangePlan({ plan: det, ...validationInput });
          if (v.ok) {
            return {
              ok: true,
              plan: det,
              diagnostics: {
                provider: "ollama",
                model: "deterministic",
                latencyMs: Date.now() - t0,
                validationMs: 0,
                transcript: ctx.transcript,
              },
            };
          }
        }
      }
      return {
        ok: false,
        error: "Local composer unavailable — dictation preserved",
        diagnostics: {
          provider: "ollama",
          model: modelUsed,
          latencyMs: Date.now() - t0,
          validationMs: 0,
          transcript: ctx.transcript,
        },
      };
    }
  }

  const tParse = Date.now();
  const plan = parseChangePlanJson(raw);
  if (!plan) {
    return {
      ok: false,
      error: "Invalid structured response — dictation preserved",
      diagnostics: {
        provider: "ollama",
        model: modelUsed,
        fallbackUsed,
        latencyMs: tParse - t0,
        validationMs: 0,
        transcript: ctx.transcript,
      },
    };
  }

  const v = validateChangePlan({ plan, ...validationInput });
  const validationMs = Date.now() - tParse;
  if (!v.ok) {
    return {
      ok: false,
      error: v.reason ?? "Validation failed",
      diagnostics: {
        provider: "ollama",
        model: modelUsed,
        fallbackUsed,
        latencyMs: validationMs,
        validationMs,
        transcript: ctx.transcript,
      },
    };
  }

  return {
    ok: true,
    plan,
    diagnostics: {
      provider: "ollama",
      model: modelUsed,
      fallbackUsed,
      latencyMs: Date.now() - t0,
      validationMs,
      transcript: ctx.transcript,
    },
  };
}

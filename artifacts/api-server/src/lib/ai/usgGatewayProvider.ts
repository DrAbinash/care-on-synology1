/**
 * usgGatewayProvider — the real USG AI provider, backed by the CANONICAL
 * DB-driven provider layer (@workspace/ai-providers), not a bespoke gateway.
 *
 * This replaces the old `POST {USG_AI_GATEWAY_URL}/usg/suggest` stub. It routes
 * the USG advisory suggestion task through `generateAiForTask("usg_ai_assistant")`,
 * which resolves provider + model from the AI Provider Settings / Model Routing
 * admin config (ai_provider_settings / ai_model_routes). That means a clinic that
 * has configured Ollama (OpenAI-compatible, on-prem) — or any other provider —
 * gets real USG suggestions with NO extra service and NO custom contract.
 *
 * Safety is unchanged: every raw suggestion this returns is still funnelled
 * through buildUsgAiSuggestion in usgAiService (fetal-sex refused, accept-only,
 * draft-only). This module only produces RAW model output; it never writes.
 *
 * Honesty: `available()` reflects real config — a routed task or an enabled
 * provider — so the panel says "unavailable" truthfully when nothing is
 * configured, and generates the moment a provider (e.g. Ollama) is enabled.
 */

import { generateAiForTask, resolveTaskRoute, loadProviderConfigs } from "@workspace/ai-providers";
import type { UsgAiProvider, RawAiSuggestion } from "../usgAiService";
import type { UsgAiSuggestionKind } from "../usgAiAssistant";
import { logger } from "../logger";

/** Registered in AI_TASK_CATALOG so admins can pin it to a provider/model. */
export const USG_AI_TASK_KEY = "usg_ai_assistant";

const VALID_KINDS: UsgAiSuggestionKind[] = ["finding", "impression", "measurement_flag", "growth_note"];

/**
 * Build the model prompt from the suggest context. The context is opaque
 * (measurements, prior comparison, section text the workspace chooses to send);
 * we serialise it and ask for a strict JSON array of advisory suggestions.
 */
export function buildUsgPrompt(context: Record<string, unknown>): string {
  return [
    "You are an ultrasound (USG) reporting assistant. Given the structured study",
    "context below, propose a SHORT list of ADVISORY suggestions to help a",
    "radiologist draft their report. You never finalize or sign anything.",
    "",
    "HARD RULES:",
    "- Never state or imply fetal sex/gender (PCPNDT). Never include the words",
    "  male, female, boy, girl, gender, or sex.",
    "- Only suggest what the context supports. Do not invent measurements.",
    "- Each suggestion is advisory text the radiologist may accept or reject.",
    "",
    'Return ONLY a JSON array, no prose, no markdown. Each element:',
    '{ "kind": "finding"|"impression"|"measurement_flag", "section": string|null,',
    '  "text": string, "rationale": string, "confidence": number (0..1) }',
    "",
    "STUDY CONTEXT:",
    JSON.stringify(context ?? {}),
  ].join("\n");
}

/** Strip reasoning/markdown wrappers and extract the first JSON array/object. */
export function extractJson(text: string): unknown {
  if (!text) return null;
  // Remove <think>…</think> blocks some models (e.g. qwen3) emit.
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Strip ``` fences.
  t = t.replace(/```(?:json)?/gi, "").trim();
  // Prefer an array; fall back to an object.
  const start = t.indexOf("[");
  const objStart = t.indexOf("{");
  const useArray = start >= 0 && (objStart < 0 || start < objStart);
  const open = useArray ? "[" : "{";
  const close = useArray ? "]" : "}";
  const from = t.indexOf(open);
  const to = t.lastIndexOf(close);
  if (from < 0 || to <= from) return null;
  try { return JSON.parse(t.slice(from, to + 1)); } catch { return null; }
}

/** Coerce arbitrary model JSON into typed RawAiSuggestion[] (defensive). */
export function coerceSuggestions(parsed: unknown): RawAiSuggestion[] {
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { suggestions?: unknown }).suggestions)
      ? (parsed as { suggestions: unknown[] }).suggestions
      : [];
  const out: RawAiSuggestion[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const kind = VALID_KINDS.includes(r.kind as UsgAiSuggestionKind) ? (r.kind as UsgAiSuggestionKind) : "finding";
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) continue;
    const confRaw = typeof r.confidence === "number" ? r.confidence : parseFloat(String(r.confidence ?? ""));
    out.push({
      kind,
      section: typeof r.section === "string" ? r.section : null,
      text,
      rationale: typeof r.rationale === "string" ? r.rationale : "",
      confidence: Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.5,
    });
  }
  return out;
}

export const usgGatewayProvider: UsgAiProvider = {
  async available() {
    try {
      // A routed task is definitive. Otherwise, any enabled provider means the
      // default-provider fallback in generateAiForTask can serve this task.
      const route = await resolveTaskRoute(USG_AI_TASK_KEY);
      if (route) return true;
      const configs = await loadProviderConfigs();
      return configs.some((c) => c.isEnabled);
    } catch (err) {
      logger.warn({ err }, "usg ai availability check failed");
      return false;
    }
  },
  async generate(context) {
    try {
      const res = await generateAiForTask(USG_AI_TASK_KEY, buildUsgPrompt(context), [], { maxTokens: 1200 });
      if (!res.success) { logger.warn({ err: res.error }, "usg ai generation failed"); return []; }
      return coerceSuggestions(extractJson(res.text));
    } catch (err) {
      logger.warn({ err }, "usg ai generation threw");
      return [];
    }
  },
};

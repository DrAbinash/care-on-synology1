/**
 * Positive vision-capability confirmation for SELECTED_IMAGES compose mode.
 * `unknown` name classification is NOT treated as vision-capable.
 */
import {
  classifyOllamaModelVisionByName,
  probeOllamaModelVision,
  probeOllamaReachable,
} from "@workspace/ai-providers";
import { getCached, invalidateCachedPrefix, setCached } from "../ttlCache";

const VISION_PROBE_TTL_MS = 60_000;
const VISION_CACHE_PREFIX = "composer:vision:";

/** Test-only: clear successful/failed vision probe cache entries. */
export function __resetVisionCapabilityCacheForTests(): void {
  invalidateCachedPrefix(VISION_CACHE_PREFIX);
}

export type VisionCapabilityResult =
  | { ok: true; model: string; source: "api_show" | "known_name" }
  | { ok: false; safeError: "vision_model_required" | "vision_capability_unverified"; detail: string };

/**
 * Confirm the exact configured model supports vision before sending images.
 * Prefer Ollama /api/show; fall back to name only for explicitly known vision models.
 */
export async function assertVisionCapableModel(opts: {
  endpoint: string;
  model: string;
}): Promise<VisionCapabilityResult> {
  const model = (opts.model || "").trim();
  if (!model) {
    return {
      ok: false,
      safeError: "vision_model_required",
      detail: "Selected-image drafting requires a configured vision-capable local model.",
    };
  }

  const cacheKey = `${VISION_CACHE_PREFIX}${opts.endpoint}:${model}`;
  const cached = getCached<VisionCapabilityResult>(cacheKey);
  if (cached) return cached;

  const nameClass = classifyOllamaModelVisionByName(model);
  if (nameClass === "text-only") {
    const result: VisionCapabilityResult = {
      ok: false,
      safeError: "vision_model_required",
      detail: "Selected-image drafting requires a vision-capable local model.",
    };
    setCached(cacheKey, result, VISION_PROBE_TTL_MS);
    return result;
  }

  // Confirm model exists locally (/api/tags).
  const reach = await probeOllamaReachable(opts.endpoint, 4000);
  if (!reach.reachable) {
    return {
      ok: false,
      safeError: "vision_capability_unverified",
      detail: reach.error?.includes("Timed out")
        ? "Vision capability probe timed out."
        : "Local Ollama is unreachable for vision capability probe.",
    };
  }
  const models = reach.models ?? [];
  const present = models.some(
    (m) => m === model || m.startsWith(`${model}:`) || model.startsWith(`${m}:`) || m.split(":")[0] === model.split(":")[0],
  );
  // Strict: exact or tag-family match against pulled models.
  const exactOrTagged = models.some((m) => {
    const a = m.toLowerCase();
    const b = model.toLowerCase();
    return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);
  });
  if (models.length > 0 && !exactOrTagged && !present) {
    const result: VisionCapabilityResult = {
      ok: false,
      safeError: "vision_model_required",
      detail: `Configured model '${model}' is not present on the local Ollama instance.`,
    };
    setCached(cacheKey, result, VISION_PROBE_TTL_MS);
    return result;
  }

  const show = await probeOllamaModelVision(opts.endpoint, model, 4000);
  if (show === true) {
    const result: VisionCapabilityResult = { ok: true, model, source: "api_show" };
    setCached(cacheKey, result, VISION_PROBE_TTL_MS);
    return result;
  }
  if (show === false) {
    const result: VisionCapabilityResult = {
      ok: false,
      safeError: "vision_model_required",
      detail: "Ollama /api/show reports this model is not vision-capable.",
    };
    setCached(cacheKey, result, VISION_PROBE_TTL_MS);
    return result;
  }

  // show === null (timeout / no capabilities array): only allow known vision names.
  if (nameClass === "vision") {
    const result: VisionCapabilityResult = { ok: true, model, source: "known_name" };
    setCached(cacheKey, result, VISION_PROBE_TTL_MS);
    return result;
  }

  // unknown → fail closed
  return {
    ok: false,
    safeError: "vision_capability_unverified",
    detail: "Could not positively confirm vision capability for the configured model.",
  };
}

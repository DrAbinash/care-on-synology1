import {
  loadProviderConfig,
  getProviderApiKey,
  resolveTaskRoute,
  classifyOllamaModelVisionByName,
  probeOllamaReachable,
  probeOllamaModelVision,
} from "@workspace/ai-providers";

/**
 * Resolves which OCR provider a Form F ID-card scan should use, and why.
 * This is the piece that DIDN'T exist before this fix — @workspace/ai-providers'
 * generateAiForTask() resolves to exactly one named provider (explicit route,
 * else the admin's single global default) with no retry-on-failure, which is
 * correct for most AI tasks but wrong for OCR: an OCR feature that hard-fails
 * whenever the primary provider is briefly unreachable would block Form F
 * completion, which the ID-scan step must never do (manual entry always
 * remains available — see FormF.tsx).
 *
 * Policy (see task spec item 5):
 *   1. If an admin has explicitly routed the "id_card_ocr" task (Model
 *      Routing UI), honor that choice exactly — no silent fallback. An
 *      explicit route is a deliberate override; second-guessing it would
 *      surprise the admin who set it.
 *   2. Otherwise (the default state for every install until an admin visits
 *      that screen): prefer Ollama if it's enabled, has an endpoint
 *      configured, and its configured model appears vision-capable; verify
 *      it's actually reachable right now. Fall back to Gemini if Ollama
 *      isn't usable for any reason. Fall back to "none" (manual entry) if
 *      neither is usable.
 */

export type OcrProviderChoice =
  | { provider: "ollama"; endpointUrl: string; model: string }
  | { provider: "gemini"; apiKey: string }
  | { provider: "none"; reason: OcrUnavailableReason };

export type OcrUnavailableReason =
  | "no_provider_configured"
  | "ollama_unreachable"
  | "ollama_model_not_vision_capable"
  | "ollama_model_not_configured";

export interface OcrProviderDiagnostics {
  explicitRoute: { provider: string; model?: string } | null;
  ollama: {
    configured: boolean;
    enabled: boolean;
    endpointUrl: string | null; // caller masks before returning to the frontend
    model: string | null;
    visionClassification: "vision" | "text-only" | "unknown" | "server-confirmed-vision" | "server-confirmed-text-only";
    reachable: boolean | null; // null = not probed (skipped because model already disqualified)
    reachabilityError?: string;
  };
  gemini: {
    configured: boolean;
  };
  chosen: OcrProviderChoice;
}

async function checkOllama(model: string | null | undefined, endpointUrl: string): Promise<{
  usable: boolean;
  visionClassification: OcrProviderDiagnostics["ollama"]["visionClassification"];
  reachable: boolean | null;
  reachabilityError?: string;
  disqualifyReason?: "ollama_unreachable" | "ollama_model_not_vision_capable" | "ollama_model_not_configured";
}> {
  if (!model) {
    return { usable: false, visionClassification: "unknown", reachable: null, disqualifyReason: "ollama_model_not_configured" };
  }

  // Prefer the server's own capability report; fall back to the name
  // heuristic when the Ollama version doesn't expose one. A confirmed
  // text-only model is rejected before even attempting a reachability
  // probe — no point spending a network round trip on a model that can't
  // do the job regardless of whether the server is up.
  const serverVision = await probeOllamaModelVision(endpointUrl, model);
  if (serverVision === false) {
    return { usable: false, visionClassification: "server-confirmed-text-only", reachable: null, disqualifyReason: "ollama_model_not_vision_capable" };
  }
  const nameHeuristic = classifyOllamaModelVisionByName(model);
  if (serverVision === null && nameHeuristic === "text-only") {
    return { usable: false, visionClassification: "text-only", reachable: null, disqualifyReason: "ollama_model_not_vision_capable" };
  }
  const visionClassification: OcrProviderDiagnostics["ollama"]["visionClassification"] =
    serverVision === true ? "server-confirmed-vision" : nameHeuristic;

  const reach = await probeOllamaReachable(endpointUrl);
  if (!reach.reachable) {
    return { usable: false, visionClassification, reachable: false, reachabilityError: reach.error, disqualifyReason: "ollama_unreachable" };
  }

  return { usable: true, visionClassification, reachable: true };
}

export async function resolveOcrProvider(): Promise<OcrProviderDiagnostics> {
  const route = await resolveTaskRoute("id_card_ocr");

  const ollamaConfig = await loadProviderConfig("ollama");
  const geminiKey = (await getProviderApiKey("gemini").catch(() => null)) ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? null;

  const ollamaDiag: OcrProviderDiagnostics["ollama"] = {
    configured: !!ollamaConfig?.hasEndpointUrl,
    enabled: !!ollamaConfig?.isEnabled,
    endpointUrl: ollamaConfig?.endpointUrl ?? null,
    model: ollamaConfig?.defaultModel ?? null,
    visionClassification: "unknown",
    reachable: null,
  };
  const geminiDiag = { configured: !!geminiKey };

  // ── Explicit admin-configured route: honor it exactly, no fallback ──
  if (route) {
    if (route.provider === "ollama") {
      if (!ollamaConfig?.endpointUrl) {
        return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: "ollama_model_not_configured" } };
      }
      const model = route.model || ollamaConfig.defaultModel || "";
      const check = await checkOllama(model, ollamaConfig.endpointUrl);
      ollamaDiag.visionClassification = check.visionClassification;
      ollamaDiag.reachable = check.reachable;
      ollamaDiag.reachabilityError = check.reachabilityError;
      if (!check.usable) {
        return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: check.disqualifyReason ?? "ollama_unreachable" } };
      }
      return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "ollama", endpointUrl: ollamaConfig.endpointUrl, model } };
    }
    if (route.provider === "gemini") {
      if (!geminiKey) {
        return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: "no_provider_configured" } };
      }
      return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "gemini", apiKey: geminiKey } };
    }
    // Route points at a provider this feature doesn't support (openai/anthropic
    // have no OCR implementation here yet) — fall through to auto policy
    // rather than hard-failing on an admin misconfiguration.
  }

  // ── Auto policy: Ollama-first, Gemini-fallback ──
  if (ollamaConfig?.isEnabled && ollamaConfig.endpointUrl) {
    const check = await checkOllama(ollamaConfig.defaultModel, ollamaConfig.endpointUrl);
    ollamaDiag.visionClassification = check.visionClassification;
    ollamaDiag.reachable = check.reachable;
    ollamaDiag.reachabilityError = check.reachabilityError;
    if (check.usable) {
      return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "ollama", endpointUrl: ollamaConfig.endpointUrl, model: ollamaConfig.defaultModel! } };
    }
    if (geminiKey) {
      return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "gemini", apiKey: geminiKey } };
    }
    return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: check.disqualifyReason ?? "ollama_unreachable" } };
  }

  if (geminiKey) {
    return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "gemini", apiKey: geminiKey } };
  }

  return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: "no_provider_configured" } };
}

/** Masks everything but the host's TLD-adjacent segment, for admin-diagnostics display. */
export function maskEndpointUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const hostParts = u.hostname.split(".");
    const maskedHost = hostParts.length > 1
      ? `${"•".repeat(Math.max(1, hostParts[0].length - 2))}${hostParts[0].slice(-2)}.${hostParts.slice(1).join(".")}`
      : u.hostname.replace(/^(.{2}).*(.{2})$/, (_m, a, b) => `${a}${"•".repeat(Math.max(1, u.hostname.length - 4))}${b}`);
    return `${u.protocol}//${maskedHost}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return "•••";
  }
}

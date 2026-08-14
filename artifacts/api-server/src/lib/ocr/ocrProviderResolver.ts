import {
  getProviderApiKey,
  resolveTaskRoute,
  classifyOllamaModelVisionByName,
  probeOllamaReachable,
  probeOllamaModelVision,
} from "@workspace/ai-providers";
import { resolveLocalAiRuntime } from "../aiPipeline/runtimeConfig";

/**
 * Resolves which OCR provider the *first* pass should use.
 * Chain: Ollama → client Tesseract → Gemini (useGeminiFallback, if a key exists).
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
  const runtime = await resolveLocalAiRuntime();
  const geminiKey = (await getProviderApiKey("gemini").catch(() => null)) ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? null;

  // Canonical Ollama endpoint + vision model (not a separate ai_provider_settings read).
  const ollamaEndpoint = runtime.ollamaEnabled ? runtime.ollamaBaseUrl : null;
  const ollamaModel = runtime.modelVision || runtime.modelStandard;
  const ollamaConfigured = !!ollamaEndpoint;

  const ollamaDiag: OcrProviderDiagnostics["ollama"] = {
    configured: ollamaConfigured,
    enabled: runtime.ollamaEnabled && ollamaConfigured,
    endpointUrl: ollamaEndpoint,
    model: ollamaModel,
    visionClassification: "unknown",
    reachable: null,
  };
  const geminiDiag = { configured: !!geminiKey };

  // ── Explicit admin-configured route: honor it exactly, no fallback ──
  if (route) {
    if (route.provider === "ollama") {
      if (!ollamaEndpoint) {
        return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: "ollama_model_not_configured" } };
      }
      const model = route.model || ollamaModel || "";
      const check = await checkOllama(model, ollamaEndpoint);
      ollamaDiag.visionClassification = check.visionClassification;
      ollamaDiag.reachable = check.reachable;
      ollamaDiag.reachabilityError = check.reachabilityError;
      if (!check.usable) {
        return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: check.disqualifyReason ?? "ollama_unreachable" } };
      }
      return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "ollama", endpointUrl: ollamaEndpoint, model } };
    }
    if (route.provider === "gemini") {
      if (!geminiKey) {
        return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: "no_provider_configured" } };
      }
      return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "gemini", apiKey: geminiKey } };
    }
  }

  // ── Auto policy: Ollama-first (canonical runtime), Gemini-fallback ──
  if (runtime.ollamaEnabled && ollamaEndpoint) {
    const check = await checkOllama(ollamaModel, ollamaEndpoint);
    ollamaDiag.visionClassification = check.visionClassification;
    ollamaDiag.reachable = check.reachable;
    ollamaDiag.reachabilityError = check.reachabilityError;
    if (check.usable) {
      return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "ollama", endpointUrl: ollamaEndpoint, model: ollamaModel } };
    }
    // Tesseract is the second stage (client). Gemini is only the third
    // stage, requested explicitly via useGeminiFallback — never auto-picked here.
    return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: check.disqualifyReason ?? "ollama_unreachable" } };
  }

  return { explicitRoute: route, ollama: ollamaDiag, gemini: geminiDiag, chosen: { provider: "none", reason: "no_provider_configured" } };
}

/** Ollama vision only — Gemini is the optional third OCR pass. */
export async function resolveOllamaVisionForOcr(): Promise<{ endpointUrl: string; model: string } | null> {
  const runtime = await resolveLocalAiRuntime();
  if (!runtime.ollamaEnabled || !runtime.ollamaBaseUrl) return null;
  const model = runtime.modelVision || runtime.modelStandard;
  const check = await checkOllama(model, runtime.ollamaBaseUrl);
  if (!check.usable) return null;
  return { endpointUrl: runtime.ollamaBaseUrl, model };
}

export async function getGeminiOcrApiKey(): Promise<string | null> {
  return (await getProviderApiKey("gemini").catch(() => null)) ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? null;
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

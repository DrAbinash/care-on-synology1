/**
 * AI Gateway — Phase P2 / Gate G7.
 *
 * The single structured-report entry point and the hardened evolution of the
 * provider layer (index.ts): it REUSES generateAiResponse + provider routing and
 * adds capability routing, local-first PHI policy, timeout + retry + circuit
 * breaker + provider fallback, schema projection, and contract validation/repair.
 * The ERP calls a task, never a model; on total failure it returns a degraded
 * (empty, conforming) draft — it never throws into the caller's clinical path.
 *
 * Top-level imports are DB-free (type-only + pure) so the orchestration is unit-
 * testable with injected deps; the real DB/provider calls are lazy in defaultDeps.
 */
import type { RequiredCapabilities, ProviderChoice } from "./capabilityLogic";
import { withTimeout } from "./circuitLogic";
import {
  validateProvisionalReport, emptyProvisionalReport, projectSchemaForProvider,
  type ProvisionalReport,
} from "./reportContract";

export interface GatewayRequest {
  taskKey: string;
  studyInstanceUid: string;
  modality?: string;
  prompt: string;
  promptVersion: string;
  images?: string[]; // base64 (PHI)
  required?: RequiredCapabilities;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface GatewayResult {
  report: ProvisionalReport;
  degraded: boolean;
  provider: string | null;
  model: string | null;
  modelDigest: string | null;
  attempts: number;
  detail: string;
}

/** Injectable provider call so the gateway is testable without real providers. */
export type ProviderCall = (args: {
  provider: string;
  model: string;
  prompt: string;
  images: string[];
}) => Promise<{ success: boolean; text: string; error?: string }>;

export interface GatewayDeps {
  selectChain: (taskKey: string, required: RequiredCapabilities, phiPresent: boolean) => Promise<ProviderChoice[]>;
  circuitState: (provider: string) => Promise<"open" | "closed">;
  recordHealth: (e: { provider: string; model?: string; isSuccess: boolean; latencyMs?: number; errorMessage?: string }) => Promise<void>;
  resolveDigest: (provider: string, model: string) => Promise<string | null>;
  call: ProviderCall;
  now: () => number;
}

// Defaults use LAZY dynamic imports so this module carries no DB import at load.
const defaultDeps: GatewayDeps = {
  selectChain: async (taskKey, required, phi) => (await import("./capabilityRegistry")).selectProviderChain(taskKey, required, phi),
  circuitState: async (provider) => (await import("./circuitBreaker")).getProviderCircuitState(provider),
  recordHealth: async (e) => (await import("./circuitBreaker")).recordProviderHealth(e),
  resolveDigest: async (p, m) => (await import("./capabilityRegistry")).resolveModelPin(p, m),
  call: async ({ provider, model, prompt, images }) => {
    const { generateAiResponse } = await import("./index");
    const r = await generateAiResponse(provider, prompt, images, { model });
    return { success: r.success, text: r.text, error: r.error };
  },
  now: () => Date.now(),
};

/**
 * Request a structured provisional report. Tries the local-first provider chain,
 * skipping providers whose breaker is open, with per-attempt timeout and bounded
 * retry, validating each response against the contract. Degrades to an empty
 * conforming draft if every provider fails — never throws.
 */
export async function requestStructuredReport(
  req: GatewayRequest,
  deps: Partial<GatewayDeps> = {},
): Promise<GatewayResult> {
  const d: GatewayDeps = { ...defaultDeps, ...deps };
  const phiPresent = (req.images?.length ?? 0) > 0;
  const timeoutMs = req.timeoutMs ?? 60_000;
  const maxAttempts = req.maxAttempts ?? 2;
  const images = req.images ?? [];

  const chain = await d.selectChain(req.taskKey, req.required ?? {}, phiPresent);
  if (chain.length === 0) {
    return degraded(req, null, null, null, 0, "no eligible provider (capability/PHI policy) — deterministic-only");
  }

  let attempts = 0;
  for (const choice of chain) {
    if ((await d.circuitState(choice.provider)) === "open") continue; // breaker open — skip

    // schema projection per provider (passed to the SDK layer in a later phase;
    // server-side validation below is the authoritative gate).
    projectSchemaForProvider(choice.provider);

    for (let retry = 0; retry < maxAttempts; retry++) {
      attempts++;
      const started = d.now();
      try {
        const resp = await withTimeout(
          d.call({ provider: choice.provider, model: choice.model, prompt: req.prompt, images }),
          timeoutMs,
          `${choice.provider}/${choice.model}`,
        );
        const latencyMs = d.now() - started;
        if (!resp.success) {
          await d.recordHealth({ provider: choice.provider, model: choice.model, isSuccess: false, latencyMs, errorMessage: resp.error });
          continue;
        }
        const validation = validateProvisionalReport(resp.text, req.studyInstanceUid);
        if (!validation.ok || !validation.data) {
          await d.recordHealth({ provider: choice.provider, model: choice.model, isSuccess: false, latencyMs, errorMessage: `contract: ${(validation.errors ?? []).join("; ")}` });
          continue; // invalid contract — try next attempt/provider
        }
        await d.recordHealth({ provider: choice.provider, model: choice.model, isSuccess: true, latencyMs });
        const digest = choice.modelDigest ?? (await d.resolveDigest(choice.provider, choice.model));
        return {
          report: validation.data,
          degraded: false,
          provider: choice.provider,
          model: choice.model,
          modelDigest: digest,
          attempts,
          detail: `ok via ${choice.provider}/${choice.model}${validation.repaired ? " (repaired)" : ""}`,
        };
      } catch (err) {
        await d.recordHealth({ provider: choice.provider, model: choice.model, isSuccess: false, latencyMs: d.now() - started, errorMessage: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return degraded(req, null, null, null, attempts, "all providers failed/invalid — deterministic-only");
}

function degraded(
  req: GatewayRequest,
  provider: string | null,
  model: string | null,
  modelDigest: string | null,
  attempts: number,
  detail: string,
): GatewayResult {
  return {
    report: emptyProvisionalReport(req.studyInstanceUid, req.modality, req.images?.length ?? 0),
    degraded: true,
    provider,
    model,
    modelDigest,
    attempts,
    detail,
  };
}

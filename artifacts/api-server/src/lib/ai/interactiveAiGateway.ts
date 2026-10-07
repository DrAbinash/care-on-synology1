/**
 * interactiveAiGateway.ts — one owner for "which provider runs this radiology
 * AI request", and one place that refuses to record an answer it cannot
 * attribute (Audit C / C1).
 *
 * THE PROBLEM THIS CLOSES
 * `POST /api/ai-reporting/draft` resolved a provider from the request, the task
 * route and the global default, checked that provider's enablement, and then
 * called `generateAiForTask(taskKey, prompt, images, { model })` — without the
 * provider. `generateAiForTask` resolved the provider AGAIN, from the task route
 * or the global default. So:
 *
 *   validate provider A → execute provider B → audit provider A
 *
 * which C1 forbids. The reproductions in
 * `lib/ai-providers/src/interactiveExecutionContract.test.ts` show a task route
 * answering for a provider the caller checked, and a provider whose Settings row
 * says `isEnabled: false` opening the socket anyway.
 *
 * THE SPLIT OF OWNERSHIP
 *   - This module resolves INTENT into exactly one target (provider + model + how
 *     each was chosen) and refuses targets that are unknown, unconfigured or
 *     disabled. It reproduces the precedence and the 400 wording the routes
 *     already return, so no client-visible string changes.
 *   - `@workspace/ai-providers` owns EXECUTION, the PHI text/image egress policy
 *     and the deadline, and reports back `result.execution` — the identity of
 *     what actually ran.
 *   - The route records what the execution layer reported, never what it hoped
 *     for, and fails closed if the two disagree.
 *
 * Deliberately NOT a provider framework: no client, no model list, no retry, no
 * fallback, no locality rule of its own. `generateAiResponse` stays the only code
 * that talks to a model, and locality comes from the layer that opened the
 * socket.
 */
import {
  BUILTIN_PROVIDER_NAMES,
  getDefaultProviderName,
  generateAiResponse,
  loadProviderConfig,
  normalizeAiFailure,
  resolveTaskRoute,
  redactAiSecrets,
  type AiFailure,
  type AiFailureCode,
  type AiQueryResult,
} from "@workspace/ai-providers";

export type ProviderSource = "request" | "task-route" | "global-default";
export type ModelSource = "request" | "task-route" | "provider-default" | "unresolved";

export type InteractiveTarget =
  | {
      ok: true;
      provider: string;
      /** Null when neither the caller, the task route nor the provider row named
       *  a model. The execution layer still resolves one and reports it. */
      model: string | null;
      providerSource: ProviderSource;
      modelSource: ModelSource;
    }
  | {
      ok: false;
      /** A misconfigured provider is the operator's problem to fix, so it stays
       *  a 400 exactly as the routes return today — not a 502. */
      httpStatus: 400;
      error: string;
      failureCode: AiFailureCode;
    };

/**
 * Resolve the interactive target exactly as the routes have always done —
 * requested provider wins, else the task route, else the global default — and
 * validate the winner against its own configuration. Returning the sources is
 * the point: "who chose this model?" now has an answer that travelled with the
 * request instead of one reconstructed from a config table afterwards.
 */
export async function resolveInteractiveTarget(opts: {
  taskKey: string;
  requestedProvider?: string | null;
  requestedModel?: string | null;
  /**
   * The AI Reporting settings default, which is what `/draft` has always used as
   * its last resort. Passed in rather than looked up here so this module cannot
   * silently change a route's existing precedence.
   */
  defaultProvider?: string | null;
}): Promise<InteractiveTarget> {
  const requested = opts.requestedProvider?.trim() || null;
  if (requested && !BUILTIN_PROVIDER_NAMES.includes(requested)) {
    // Wording preserved from `/draft` ("Invalid provider.") so a client that
    // matches on it keeps matching.
    return { ok: false, httpStatus: 400, error: "Invalid provider.", failureCode: "UNKNOWN" };
  }

  // Once the caller has named a provider, the task route is inert. That is the
  // whole fix: nothing downstream gets a second chance to pick a provider.
  const taskRoute = requested ? null : await resolveTaskRoute(opts.taskKey);
  const provider =
    requested
    ?? taskRoute?.provider
    ?? opts.defaultProvider?.trim()
    ?? (await getDefaultProviderName());

  if (!BUILTIN_PROVIDER_NAMES.includes(provider)) {
    return { ok: false, httpStatus: 400, error: "Invalid provider.", failureCode: "UNKNOWN" };
  }

  const config = await loadProviderConfig(provider);
  if (!config || !config.isEnabled) {
    return {
      ok: false,
      httpStatus: 400,
      error: `${provider} provider is disabled or not configured.`,
      failureCode: "DISABLED",
    };
  }

  const requestedModel = opts.requestedModel?.trim() || null;
  const model = requestedModel || taskRoute?.model?.trim() || config.defaultModel || null;
  return {
    ok: true,
    provider,
    model,
    providerSource: requested ? "request" : taskRoute ? "task-route" : "global-default",
    modelSource: requestedModel
      ? "request"
      : taskRoute?.model
        ? "task-route"
        : config.defaultModel
          ? "provider-default"
          : "unresolved",
  };
}

/** Execution extras the Ollama arm accepts and no other provider does. */
export interface InteractiveCallOptions {
  numCtx?: number | null;
  think?: boolean;
  endpointUrl?: string | null;
  maxTokens?: number;
}

/**
 * One failure shape for the whole interactive path: the same `AiFailure` the
 * execution layer produces, carrying the identity of whatever answered (or of the
 * call that never started). A client must never see two shapes in one field —
 * `{code, message}` here and the full record there — because the half-shape is the
 * one that cannot be attributed, which is the defect class C1 closes.
 */
export interface InteractiveCallOutcome {
  result: AiQueryResult;
  target: InteractiveTarget;
  /** Identity taken from the execution layer — the record the route must write. */
  executedProvider: string | null;
  executedModel: string | null;
  locality: "local" | "cloud" | null;
  timeoutMs: number | null;
  attempted: boolean;
  /** Null means this call may be recorded and returned as a success. */
  failure: AiFailure | null;
  identityVerified: boolean;
}

/**
 * Execute one already-resolved interactive call.
 *
 * `generateAiResponse` receives the target's provider NAME, so the task route
 * cannot be consulted a second time. The identity it reports back is then
 * checked against the target: a disagreement fails the call even if the model
 * produced perfect-looking text, because an unattributable draft cannot be
 * audited, labelled or trusted.
 */
export async function executeInteractiveAiCall(args: {
  target: InteractiveTarget;
  prompt: string;
  images?: string[];
  options?: InteractiveCallOptions;
}): Promise<InteractiveCallOutcome> {
  const { target } = args;
  if (!target.ok) {
    // Nothing ran, so nothing can be attributed: the identity fields say so
    // rather than borrowing the provider the route had hoped for.
    return {
      result: { text: "", success: false, error: target.error },
      target,
      executedProvider: null,
      executedModel: null,
      locality: null,
      timeoutMs: null,
      attempted: false,
      failure: normalizeAiFailure(
        { text: "", success: false, error: redactAiSecrets(target.error) },
        { code: target.failureCode, message: redactAiSecrets(target.error) },
      ),
      identityVerified: false,
    };
  }

  const opts = args.options ?? {};
  const isOllama = target.provider === "ollama";
  const result = await generateAiResponse(target.provider, args.prompt, args.images ?? [], {
    model: target.model ?? undefined,
    maxTokens: opts.maxTokens,
    // Only the local arm takes the context-budget and endpoint knobs; handing
    // them to a cloud client changes nothing but the shape of the request.
    ...(isOllama
      ? {
          numCtx: opts.numCtx ?? undefined,
          think: opts.think,
          endpointUrl: opts.endpointUrl ?? undefined,
        }
      : {}),
  });

  const execution = result.execution ?? null;
  const identityVerified = !!execution && execution.provider === target.provider;

  // The route parses the answer AFTER it returns, so a caller that finds the text
  // unusable adds its own MALFORMED_RESPONSE with `normalizeAiFailure` — this
  // layer only reports what it can see: policy, configuration, deadline, HTTP and
  // an answer it cannot attribute.
  const normalized: AiFailure | null = identityVerified
    ? normalizeAiFailure(result)
    : normalizeAiFailure(result, {
        code: "UNKNOWN",
        detailCode: "PROVIDER_IDENTITY_MISMATCH",
        message:
          `The AI execution layer reported ${execution?.provider ?? "no provider"} for a request resolved to `
          + `${target.provider}; the answer was discarded rather than recorded under a provider that cannot be `
          + "confirmed to have produced it.",
      });

  return {
    result,
    target,
    executedProvider: execution?.provider ?? null,
    executedModel: execution?.model ?? null,
    locality: execution?.locality ?? null,
    timeoutMs: execution?.timeoutMs ?? null,
    attempted: execution?.attempted ?? false,
    // A provider that answered perfectly but cannot be attributed is still a
    // failure: there is no honest way to record it.
    failure: normalized,
    identityVerified,
  };
}

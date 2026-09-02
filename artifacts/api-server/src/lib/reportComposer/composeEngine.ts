/**
 * Text Ollama call for background report composition (no DICOM pixels).
 */
import { resolveComposerRuntime } from "../voiceReportComposer/runtimeConfig";
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import {
  ComposerInputSnapshot,
  ComposerDraftOutput,
  parseComposerDraftJson,
} from "./types";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { buildCareSystemPrompt } from "./persona";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import type { AiComposeJobKind } from "@workspace/db/schema";

export type ComposeRunResult = {
  ok: boolean;
  draft?: ComposerDraftOutput;
  model?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
  safeError?: string;
  rawLength?: number;
};

// ─── CARE Radiology Persona ─────────────────────────────────────────────
// PR P0-3 (#657): the system prompt is now assembled from persona modules
// (MASTER + STYLE + SAFETY + modality/family-specific) based on the frozen
// snapshot's canonical study context. Persona selection happens BEFORE the
// worker call and uses the frozen snapshot — no live reread of frontend
// state. See persona/index.ts and persona/router.ts.
//
// The old buildSystemPrompt(kind) function is replaced by
// buildCareSystemPrompt(kind, snapshot) which is imported above.

/** @deprecated Use buildCareSystemPrompt(kind, snapshot) from persona/index.ts. Kept for backward compat with external callers. */
function buildSystemPrompt(kind: AiComposeJobKind): string {
  // Legacy fallback: if a caller passes no snapshot context, assemble the
  // base persona (MASTER + STYLE + SAFETY) without modality routing.
  // This path is NOT used by runReportComposer (which always has a snapshot).
  return buildCareSystemPrompt(kind, {} as ComposerInputSnapshot);
}

export function buildUserPrompt(kind: AiComposeJobKind, snapshot: ComposerInputSnapshot): string {
  if (kind === "SELECTION_EDIT" || kind === "REPHRASE" || kind === "SHORTEN" || kind === "EXPAND" || kind === "TRANSLATE" || kind === "SECTION_EDIT") {
    return JSON.stringify(
      {
        jobKind: kind,
        instruction: snapshot.instruction ?? kind,
        targetLanguage: snapshot.targetLanguage,
        selectionField: snapshot.selectionField,
        selectionText: snapshot.selectionText,
        groundingFindings: (snapshot.findings ?? "").slice(0, 1200),
        groundingImpression: (snapshot.impression ?? "").slice(0, 600),
        observations: (snapshot.observations ?? []).slice(0, 12),
      },
      null,
      0,
    );
  }

  // Primary radiologist draft input — deterministic clinical truth block.
  const draftCtx = buildRadiologistDraftContext(snapshot);
  return renderRadiologistDraftContextPrompt(draftCtx, kind);
}

async function callOllama(opts: {
  endpoint: string;
  model: string;
  system: string;
  user: string;
  numCtx: number;
  temperature: number;
  timeoutMs: number;
}): Promise<{ ok: boolean; text?: string; safeError?: string }> {
  try {
    const res = await fetch(`${opts.endpoint.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs),
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        format: "json",
        options: { temperature: opts.temperature, num_ctx: opts.numCtx },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) {
      return { ok: false, safeError: `ollama_http_${res.status}` };
    }
    const json = (await res.json()) as { message?: { content?: string }; response?: string };
    const text = json.message?.content ?? json.response ?? "";
    if (!text.trim()) return { ok: false, safeError: "empty_model_response" };
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ollama_error";
    if (/abort|timeout/i.test(msg)) return { ok: false, safeError: "ollama_timeout" };
    return { ok: false, safeError: "ollama_unreachable" };
  }
}

/** Deterministic fallback when model unavailable — organizes supplied observations only. */
export { deterministicComposeFromSnapshot } from "./deterministicCompose";

export async function runReportComposer(opts: {
  kind: AiComposeJobKind;
  snapshot: ComposerInputSnapshot;
  allowDeterministicFallback?: boolean;
}): Promise<ComposeRunResult> {
  const started = Date.now();
  const runtime = await resolveComposerRuntime(true);
  if (!runtime.enabled || !runtime.model) {
    if (opts.allowDeterministicFallback !== false) {
      const draft = deterministicComposeFromSnapshot(opts.snapshot, opts.kind);
      return {
        ok: true,
        draft,
        model: "deterministic",
        fallbackUsed: true,
        latencyMs: Date.now() - started,
      };
    }
    return { ok: false, safeError: "composer_model_not_configured", latencyMs: Date.now() - started };
  }

  const guard = validateOllamaUrl(runtime.endpoint, runtime.localOnly);
  if (!guard.ok) {
    return { ok: false, safeError: "composer_endpoint_blocked", latencyMs: Date.now() - started };
  }

  // PR P0-3 (#657): build CARE persona system prompt from the frozen
  // snapshot's canonical study context. Persona selection happens here
  // (before the worker call) and uses the frozen snapshot — no live
  // reread of frontend state.
  const system = buildCareSystemPrompt(opts.kind, opts.snapshot);
  const user = buildUserPrompt(opts.kind, opts.snapshot);
  const primary = await callOllama({
    endpoint: runtime.endpoint,
    model: runtime.model,
    system,
    user,
    numCtx: runtime.numCtx,
    temperature: runtime.temperature,
    timeoutMs: runtime.timeoutMs,
  });

  let text = primary.text;
  let model = runtime.model;
  let fallbackUsed = false;
  if (!primary.ok && runtime.fallbackModel) {
    const fb = await callOllama({
      endpoint: runtime.endpoint,
      model: runtime.fallbackModel,
      system,
      user,
      numCtx: runtime.numCtx,
      temperature: runtime.temperature,
      timeoutMs: runtime.timeoutMs,
    });
    if (fb.ok) {
      text = fb.text;
      model = runtime.fallbackModel;
      fallbackUsed = true;
    } else {
      return {
        ok: false,
        safeError: primary.safeError ?? fb.safeError ?? "compose_failed",
        latencyMs: Date.now() - started,
        model: runtime.model,
        fallbackUsed: true,
      };
    }
  } else if (!primary.ok) {
    if (opts.allowDeterministicFallback !== false) {
      const draft = deterministicComposeFromSnapshot(opts.snapshot, opts.kind);
      return {
        ok: true,
        draft,
        model: "deterministic",
        fallbackUsed: true,
        latencyMs: Date.now() - started,
        safeError: primary.safeError,
      };
    }
    return {
      ok: false,
      safeError: primary.safeError ?? "compose_failed",
      latencyMs: Date.now() - started,
      model: runtime.model,
    };
  }

  const draft = parseComposerDraftJson(text ?? "");
  if (!draft) {
    return {
      ok: false,
      safeError: "malformed_json",
      latencyMs: Date.now() - started,
      model,
      fallbackUsed,
      rawLength: text?.length ?? 0,
    };
  }

  // Micro-edit: ensure proposed findings/impression only change selection field when possible
  if (opts.kind !== "FULL_REPORT" && opts.kind !== "IMPRESSION" && opts.snapshot.selectionText) {
    if (opts.snapshot.selectionField === "FINDINGS") {
      draft.findings = draft.findings || opts.snapshot.selectionText;
      draft.impression = opts.snapshot.impression;
      draft.recommendation = opts.snapshot.recommendation;
    } else if (opts.snapshot.selectionField === "IMPRESSION") {
      draft.impression = draft.impression || opts.snapshot.selectionText;
      draft.findings = opts.snapshot.findings;
      draft.recommendation = opts.snapshot.recommendation;
    } else if (opts.snapshot.selectionField === "RECOMMENDATION") {
      draft.recommendation = draft.recommendation || opts.snapshot.selectionText;
      draft.findings = opts.snapshot.findings;
      draft.impression = opts.snapshot.impression;
    }
  }
  if (opts.kind === "IMPRESSION") {
    draft.findings = opts.snapshot.findings;
    if (!draft.recommendation) draft.recommendation = opts.snapshot.recommendation;
  }

  return {
    ok: true,
    draft,
    model,
    fallbackUsed,
    latencyMs: Date.now() - started,
    rawLength: text?.length ?? 0,
  };
}

/**
 * Report composition engine — text-only by default; SELECTED_IMAGES mode
 * attaches radiologist-selected frozen key images to a vision-capable
 * local Ollama model via the canonical provider payload shape.
 *
 * Never fetches Orthanc middle slices. Never stores base64 in snapshots.
 */
import { resolveComposerRuntime } from "../voiceReportComposer/runtimeConfig";
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import {
  ComposerInputSnapshot,
  ComposerDraftOutput,
  ComposerEvidenceProvenance,
  parseComposerDraftJson,
} from "./types";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { buildCareSystemPrompt, CARE_PERSONA_VERSION } from "./persona";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import { resolveSelectedKeyImagesForCompose } from "./resolveSelectedKeyImages";
import { assertVisionCapableModel } from "./visionCapability";
import type { KeyImageOwnershipContext } from "./keyImageOwnership";
import type { AiComposeJobKind } from "@workspace/db/schema";

export type ComposeRunResult = {
  ok: boolean;
  draft?: ComposerDraftOutput;
  model?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
  safeError?: string;
  rawLength?: number;
  provenance?: ComposerEvidenceProvenance;
};

/** @deprecated Use buildCareSystemPrompt(kind, snapshot). */
function buildSystemPrompt(kind: AiComposeJobKind): string {
  return buildCareSystemPrompt(kind, {} as ComposerInputSnapshot);
}
void buildSystemPrompt;

export function buildUserPrompt(kind: AiComposeJobKind, snapshot: ComposerInputSnapshot): string {
  if (
    kind === "SELECTION_EDIT" ||
    kind === "REPHRASE" ||
    kind === "SHORTEN" ||
    kind === "EXPAND" ||
    kind === "TRANSLATE" ||
    kind === "SECTION_EDIT"
  ) {
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

  const draftCtx = buildRadiologistDraftContext(snapshot);
  let prompt = renderRadiologistDraftContextPrompt(draftCtx, kind);

  if ((snapshot.aiMode ?? "TEXT_ONLY") === "SELECTED_IMAGES") {
    const caps = (snapshot.selectedKeyImages ?? [])
      .map((img, i) => {
        const bits = [
          `#${i + 1}`,
          `keyImageId=${img.keyImageId}`,
          img.observationId ? `linkedObservation=${img.observationId}` : null,
          img.seriesDescription ? `series=${img.seriesDescription}` : null,
          img.caption ? `caption=${img.caption}` : null,
        ].filter(Boolean);
        return `- ${bits.join(" | ")}`;
      })
      .join("\n");
    prompt +=
      `\n\nSELECTED KEY IMAGE METADATA (supporting evidence only; observations remain authoritative):\n` +
      (caps || "- (none)") +
      `\nDo NOT claim complete MRI review. Absence on these frames is not proof of normality.`;
  }

  return prompt;
}

async function callOllama(opts: {
  endpoint: string;
  model: string;
  system: string;
  user: string;
  numCtx: number;
  temperature: number;
  timeoutMs: number;
  /** Raw base64 without data: prefix (Ollama chat message.images). */
  images?: string[];
}): Promise<{ ok: boolean; text?: string; safeError?: string }> {
  try {
    const userMessage: Record<string, unknown> = {
      role: "user",
      content: opts.user,
    };
    if (opts.images && opts.images.length > 0) {
      userMessage.images = opts.images;
    }
    const res = await fetch(`${opts.endpoint.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs),
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        format: "json",
        think: false,
        options: { temperature: opts.temperature, num_ctx: opts.numCtx },
        messages: [{ role: "system", content: opts.system }, userMessage],
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

export { deterministicComposeFromSnapshot } from "./deterministicCompose";

function effectiveAiMode(
  kind: AiComposeJobKind,
  snapshot: ComposerInputSnapshot,
): "TEXT_ONLY" | "SELECTED_IMAGES" {
  // Impression + micro-edits remain text-only even if snapshot carries images.
  if (kind !== "FULL_REPORT") return "TEXT_ONLY";
  return snapshot.aiMode === "SELECTED_IMAGES" ? "SELECTED_IMAGES" : "TEXT_ONLY";
}

export async function runReportComposer(opts: {
  kind: AiComposeJobKind;
  snapshot: ComposerInputSnapshot;
  allowDeterministicFallback?: boolean;
  /** Authoritative ownership context for SELECTED_IMAGES (resolved server-side). */
  ownership?: KeyImageOwnershipContext | null;
}): Promise<ComposeRunResult> {
  const started = Date.now();
  const aiMode = effectiveAiMode(opts.kind, opts.snapshot);
  const baseProvenance: ComposerEvidenceProvenance = {
    aiMode,
    personaVersion: CARE_PERSONA_VERSION,
    selectedKeyImageIds: (opts.snapshot.selectedKeyImages ?? []).map((r) => r.keyImageId),
    imagesLoaded: 0,
    linkedObservationIds: [],
    degradedReason: null,
  };

  const runtime = await resolveComposerRuntime(true);
  if (!runtime.enabled || !runtime.model) {
    if (aiMode === "SELECTED_IMAGES") {
      // Never silently claim image review via deterministic text fallback.
      return {
        ok: false,
        safeError: "composer_model_not_configured",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          degradedReason: "Selected-image drafting requires a configured local model.",
        },
      };
    }
    if (opts.allowDeterministicFallback !== false) {
      const draft = deterministicComposeFromSnapshot(opts.snapshot, opts.kind);
      return {
        ok: true,
        draft,
        model: "deterministic",
        fallbackUsed: true,
        latencyMs: Date.now() - started,
        provenance: baseProvenance,
      };
    }
    return {
      ok: false,
      safeError: "composer_model_not_configured",
      latencyMs: Date.now() - started,
      provenance: baseProvenance,
    };
  }

  const guard = validateOllamaUrl(runtime.endpoint, runtime.localOnly);
  if (!guard.ok) {
    return {
      ok: false,
      safeError: "composer_endpoint_blocked",
      latencyMs: Date.now() - started,
      provenance: baseProvenance,
    };
  }

  let imagesBase64: string[] = [];
  let provenance: ComposerEvidenceProvenance = { ...baseProvenance, model: runtime.model };

  if (aiMode === "SELECTED_IMAGES") {
    const ownership = opts.ownership ?? null;
    if (!ownership || (ownership.draftId == null && ownership.studyId == null)) {
      return {
        ok: false,
        safeError: "selected_images_ownership_unverified",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: runtime.model,
          degradedReason: "Cannot verify key-image ownership without an authoritative draft or study.",
        },
      };
    }

    const resolved = await resolveSelectedKeyImagesForCompose({
      snapshot: opts.snapshot,
      ownership,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        safeError: resolved.safeError,
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: runtime.model,
          degradedReason: resolved.detail ?? resolved.safeError,
        },
      };
    }

    // Prefer configured vision model; only use composer model if positively vision-capable.
    const preferredVision = (runtime.visionModel || "").trim() || runtime.model;
    let visionModel = preferredVision;
    let visionOk = await assertVisionCapableModel({
      endpoint: runtime.endpoint,
      model: visionModel,
    });
    if (!visionOk.ok && preferredVision !== runtime.model && runtime.model) {
      const alt = await assertVisionCapableModel({
        endpoint: runtime.endpoint,
        model: runtime.model,
      });
      if (alt.ok) {
        visionModel = runtime.model;
        visionOk = alt;
      }
    }
    if (!visionOk.ok) {
      return {
        ok: false,
        safeError: visionOk.safeError,
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: preferredVision,
          degradedReason: visionOk.detail,
        },
      };
    }

    // Respect canonical runtime settings — never silently inflate numCtx/timeout.
    // If the configured context window is below the clinic minimum for vision
    // drafts, fail with an actionable error instead of mutating admin settings.
    const MIN_VISION_NUM_CTX = 2048;
    if (runtime.numCtx < MIN_VISION_NUM_CTX) {
      return {
        ok: false,
        safeError: "composer_num_ctx_insufficient",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: visionModel,
          degradedReason: `Composer num_ctx (${runtime.numCtx}) is below the minimum required for selected-image drafting (${MIN_VISION_NUM_CTX}). Increase ollama_composer_num_ctx in clinic settings.`,
        },
      };
    }

    imagesBase64 = resolved.images.map((img) => img.base64);
    provenance = {
      ...baseProvenance,
      model: visionModel,
      imagesLoaded: resolved.images.length,
      linkedObservationIds: resolved.linkedObservationIds,
      selectedKeyImageIds: resolved.selectedKeyImageIds,
    };

    const system = buildCareSystemPrompt(opts.kind, opts.snapshot);
    const user = buildUserPrompt(opts.kind, opts.snapshot);
    const primary = await callOllama({
      endpoint: runtime.endpoint,
      model: visionModel,
      system,
      user,
      numCtx: runtime.numCtx,
      temperature: runtime.temperature,
      timeoutMs: runtime.timeoutMs,
      images: imagesBase64,
    });

    if (!primary.ok) {
      return {
        ok: false,
        safeError: primary.safeError ?? "compose_failed",
        latencyMs: Date.now() - started,
        model: visionModel,
        provenance: {
          ...provenance,
          degradedReason: primary.safeError ?? "compose_failed",
        },
      };
    }

    const draft = parseComposerDraftJson(primary.text ?? "");
    if (!draft) {
      return {
        ok: false,
        safeError: "malformed_json",
        latencyMs: Date.now() - started,
        model: visionModel,
        rawLength: primary.text?.length ?? 0,
        provenance,
      };
    }

    return {
      ok: true,
      draft,
      model: visionModel,
      fallbackUsed: false,
      latencyMs: Date.now() - started,
      rawLength: primary.text?.length ?? 0,
      provenance,
    };
  }

  // ── TEXT_ONLY path (existing behaviour) ──────────────────────────────
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
        provenance: { ...baseProvenance, model: runtime.model },
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
        provenance: { ...baseProvenance, model: "deterministic" },
      };
    }
    return {
      ok: false,
      safeError: primary.safeError ?? "compose_failed",
      latencyMs: Date.now() - started,
      model: runtime.model,
      provenance: { ...baseProvenance, model: runtime.model },
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
      provenance: { ...baseProvenance, model },
    };
  }

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
    provenance: { ...baseProvenance, model },
  };
}

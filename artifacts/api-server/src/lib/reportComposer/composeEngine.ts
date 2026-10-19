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
  isPreservingComposeKind,
  parseComposerDraftJson,
} from "./types";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { buildCareSystemPrompt, CARE_PERSONA_VERSION } from "./persona";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import { canalApPromptFields } from "./canonicalCanalAp";
import { resolveSelectedKeyImagesForCompose } from "./resolveSelectedKeyImages";
import { assertVisionCapableModel } from "./visionCapability";
import {
  planComposerTextContext,
  planComposerVisionContext,
  composerOutputReserveTokens,
  composerPromptTextTokens,
} from "./composerContextBudget";
import type { KeyImageOwnershipContext } from "./keyImageOwnership";
import type { CanalApComposerRecord } from "@workspace/measurements";
import {
  resolveComposerProvider,
  assertComposerProviderPolicy,
  defaultModelFor,
  assertModelSupportsCapability,
  parseComposerProviderName,
  unsupportedComposerProviderMessage,
  resolveCloudComposerConfig,
  asCloudComposerProvider,
  type ComposerProviderName,
  type ComposerProviderUsage,
} from "./providers";
import {
  getLocalOpenAiBaseUrl,
  getLocalOpenAiDefaultModel,
} from "./providers/localOpenAiCompatibleConfig";
import type { AiComposeJobKind } from "@workspace/db/schema";
import { resolveTaskRoute } from "@workspace/ai-providers";

export type ComposeRunResult = {
  ok: boolean;
  draft?: ComposerDraftOutput;
  model?: string;
  /** The provider that ANSWERED, not the one that was hoped for. */
  provider?: ComposerProviderName | "deterministic";
  fallbackUsed?: boolean;
  latencyMs?: number;
  safeError?: string;
  rawLength?: number;
  provenance?: ComposerEvidenceProvenance;
  /**
   * Token counts the provider reported. Previously read from the vendor response
   * and thrown away, which is why nobody in CARE can say what a draft cost or
   * how long a prompt was. Persisted with the job inside `validation_json` —
   * there is no usage column and this PR does not add one.
   */
  usage?: ComposerProviderUsage | null;
};

/** @deprecated Use buildCareSystemPrompt(kind, snapshot). */
function buildSystemPrompt(kind: AiComposeJobKind): string {
  return buildCareSystemPrompt(kind, {} as ComposerInputSnapshot);
}
void buildSystemPrompt;

/**
 * Refinement / professionalize / combine prompt: the WHOLE report, always.
 *
 * This function used to send `findings.slice(0, 1200)`, `impression.slice(0, 600)`
 * and the first 12 observations. A radiologist asking "make this more professional,
 * preserve all measurements" was therefore answered by a model that had never seen
 * the second half of their report, and CARE then validated the result against text
 * it had also withheld — so the omission was invisible at both ends. Long MRI
 * spine reports in this clinic run past 2,000 characters, which made silent loss
 * the normal case rather than the edge case.
 *
 * Nothing is truncated here any more. Whether the request FITS is answered by
 * `planComposerTextContext` at send time, which sizes the local window or refuses
 * with a named error. Truncating clinical input and reporting success is the one
 * outcome this path must never have.
 */
function buildPreserveContextPrompt(
  kind: AiComposeJobKind,
  snapshot: ComposerInputSnapshot,
  canalAp?: CanalApComposerRecord | null,
): string {
  const id = buildRadiologistDraftContext(snapshot).studyIdentity;
  const reports = (snapshot.additionalReports ?? []).map((r) => ({
    label: r.label ?? "supplied report",
    modality: r.modality,
    region: r.region,
    findings: r.findings ?? "",
    impression: r.impression ?? "",
  }));
  return JSON.stringify(
    {
      jobKind: kind,
      instruction: snapshot.instruction ?? kind,
      targetLanguage: snapshot.targetLanguage,
      selectionField: snapshot.selectionField,
      selectionText: snapshot.selectionText,
      examination: {
        modality: id.modality,
        region: id.region,
        regions: id.regions,
        spineSegment: id.spineSegment,
        bodyPart: id.bodyPart,
        protocol: id.protocol,
        reportTitle: id.reportTitle,
        contrast: id.contrastHint,
      },
      technique: snapshot.technique ?? "",
      // Key names are kept as they were, so a model trained on CARE's existing
      // wording sees the same request; only the VALUES stopped being cut.
      groundingFindings: snapshot.findings ?? "",
      groundingImpression: snapshot.impression ?? "",
      groundingRecommendation: snapshot.recommendation ?? "",
      observations: snapshot.observations ?? [],
      observationCount: (snapshot.observations ?? []).length,
      // The canonical canal record, as DATA. A refine job's contract is the text it
      // was handed, and a grid measurement is not in that text — so without this the
      // rewrite would have no way to know the numbers the table is going to print.
      ...canalApPromptFields(canalAp),
      ...(reports.length ? { additionalReports: reports } : {}),
      conservationRule:
        "Every measurement, vertebral level, laterality and abnormality present in the supplied "
        + "text must be present in your answer. Remove nothing except duplicated wording. "
        + "If you cannot keep a fact, say so in unresolvedQuestions instead of dropping it.",
      ...(snapshot.selectionText?.trim() && snapshot.selectionField
        ? {
            answerScope:
              `Your answer for ${snapshot.selectionField} must be the COMPLETE ${snapshot.selectionField} `
              + "section with the instruction applied to the selected text. Every other sentence of that "
              + "section must still be there, reworded if need be. Returning only the selected sentence "
              + "would replace the whole section with it and delete the rest of the report.",
          }
        : {}),
    },
    null,
    0,
  );
}

/**
 * Does a selection-edit answer look like a whole section, or just the sentence
 * that was selected? See the call site for why this is a length test.
 */
export function selectionAnswerLosesField(opts: {
  field: string;
  selectionText: string;
  answer: string;
}): boolean {
  const fieldLen = (opts.field ?? "").trim().length;
  const selLen = (opts.selectionText ?? "").trim().length;
  const ansLen = (opts.answer ?? "").trim().length;
  if (!fieldLen || !selLen) return false;
  // The selection was most of the section already: there is barely anything
  // outside it to lose, so a short answer is not evidence of a destructive draft.
  if (selLen >= fieldLen * 0.6) return false;
  return ansLen < fieldLen * 0.5;
}

/**
 * Dictation → structured observations (Operation 1).
 *
 * The radiologist's words are the only clinical source here. This prompt does not
 * ask for a report and does not ask the model to complete one: a row exists only
 * if the dictation contains it. "LF hypertrophy" at L4-5 must not arrive with a
 * canal diameter, a severity, or an "no other level involved" companion row.
 */
function buildObservationExtractionPrompt(snapshot: ComposerInputSnapshot): string {
  const id = buildRadiologistDraftContext(snapshot).studyIdentity;
  return JSON.stringify(
    {
      jobKind: "OBSERVATIONS",
      task:
        "Convert the dictation into discrete structured observations. Do NOT write a report. "
        + "Return ONLY what the dictation actually states.",
      examination: {
        modality: id.modality,
        region: id.region,
        regions: id.regions,
        spineSegment: id.spineSegment,
        bodyPart: id.bodyPart,
        protocol: id.protocol,
        reportTitle: id.reportTitle,
      },
      dictation: snapshot.findings ?? "",
      instruction: snapshot.instruction ?? "",
      observationContract: {
        oneRowPer: "each distinct finding, at each distinct level and side",
        fields: [
          "concept",
          "region",
          "level",
          "severity",
          "laterality",
          "measurement",
          "findingsText",
          "impressionText",
          "sourceText",
        ],
        rules: [
          "Use the radiologist's own wording in findingsText; only add punctuation and a verb.",
          "Preserve every level, side and number exactly as dictated. L4-5 stays L4-5.",
          "Never add a level, laterality, severity or measurement the dictation does not contain — leave the field empty instead.",
          "Never add a normal or negative statement the radiologist did not make.",
          "Record a measurement twice: as measurement (number + unit only) and inside findingsText.",
          "A relevant negative is its own row (concept = the negated finding, findingsText = the negation).",
          "If shorthand is ambiguous, leave the field empty and describe the ambiguity in unresolvedQuestions.",
          "impressionText: only the conclusion the dictation itself states for that row.",
        ],
      },
      outputFormat:
        'JSON only: {"observations":[{"concept":"","region":"","level":"","severity":"","laterality":"","measurement":"","findingsText":"","impressionText":"","sourceText":""}],"unresolvedQuestions":[],"warnings":[]}. '
        + 'Findings and Impression stay empty: {"findings":"","impression":""}.',
    },
    null,
    0,
  );
}

/**
 * The user prompt for one compose run.
 *
 * `canalAp` is the server-resolved read of the draft's canonical canal AP record
 * (see `canonicalCanalAp.ts`). It is an argument, not a snapshot field, so the
 * frozen client snapshot and its freshness hashes are unchanged, and a
 * workstation cannot send its own version of a patient's measurements. Omitted or
 * empty renders exactly the prompt this function produced before.
 */
export function buildUserPrompt(
  kind: AiComposeJobKind,
  snapshot: ComposerInputSnapshot,
  canalAp?: CanalApComposerRecord | null,
): string {
  if (kind === "OBSERVATIONS") {
    return buildObservationExtractionPrompt(snapshot);
  }
  if (isPreservingComposeKind(kind)) {
    return buildPreserveContextPrompt(kind, snapshot, canalAp);
  }

  const draftCtx = buildRadiologistDraftContext(snapshot, canalAp);
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


export { deterministicComposeFromSnapshot } from "./deterministicCompose";

function effectiveAiMode(
  kind: AiComposeJobKind,
  snapshot: ComposerInputSnapshot,
): "TEXT_ONLY" | "SELECTED_IMAGES" {
  // Impression + micro-edits remain text-only even if snapshot carries images.
  if (kind !== "FULL_REPORT") return "TEXT_ONLY";
  return snapshot.aiMode === "SELECTED_IMAGES" ? "SELECTED_IMAGES" : "TEXT_ONLY";
}

/**
 * Which Model Routing tasks may answer for one composer call, most specific
 * first. CARE already has `ai_model_routes` (one active route per task key) and
 * `AI_TASK_CATALOG`, whose comment makes the contract explicit: adding a task
 * there is what makes it configurable in the Model Routing UI. So the measured
 * per-operation model boundary — text transformation on every installed local
 * model, structured extraction only on the larger one — is an administrator's
 * setting, not a constant in this file.
 *
 * A task with no route of its own falls through to the generic `report_composer`
 * route, and only if NEITHER exists does the clinic default apply. Falling
 * through is not substituting: nothing here picks a different provider behind the
 * caller's back, and an unavailable provider is reported as its own refusal.
 */
export function composerTaskKeys(
  kind: AiComposeJobKind,
  aiMode: "TEXT_ONLY" | "SELECTED_IMAGES",
): string[] {
  if (aiMode === "SELECTED_IMAGES") return ["selected_image_vision", "report_composer"];
  const perOperation: Partial<Record<AiComposeJobKind, string>> = {
    PROFESSIONALIZE: "report_composer_professionalize",
    COMBINE: "report_composer_combine",
    OBSERVATIONS: "report_composer_observations",
  };
  const specific = perOperation[kind];
  return specific ? [specific, "report_composer"] : ["report_composer"];
}

export async function runReportComposer(opts: {
  kind: AiComposeJobKind;
  snapshot: ComposerInputSnapshot;
  allowDeterministicFallback?: boolean;
  /** Authoritative ownership context for SELECTED_IMAGES (resolved server-side). */
  ownership?: KeyImageOwnershipContext | null;
  /** Optional provider override (test lab / workspace session). */
  providerOverride?: ComposerProviderName | null;
  /** Explicit opt-in to send images to cloud vision. */
  cloudVisionAllowed?: boolean;
  /**
   * A clinician confirmed THIS request after seeing THESE images. Required, in
   * addition to `cloudVisionAllowed`, for any patient-derived image to leave the
   * clinic. No caller sets it today, which is Stage 1's point: the durable job
   * path and the workspace are local-only by construction, not by convention
   * (PR-A).
   */
  consentAttestedPerRequest?: boolean;
  /**
   * PR-A2: the resolved AI security policy's attestation term. Omitted means
   * REQUIRED, so a caller that does not resolve the mode stays on PR-A's behaviour.
   */
  requireAttestation?: boolean;
  /** Optional model override (test lab / workspace session / task route). */
  modelOverride?: string | null;
  /**
   * The draft's canonical canal AP record, resolved server-side from the draft row.
   * Read-only: this run can quote the numbers, never write them (owner DECISION 4).
   */
  canalAp?: CanalApComposerRecord | null;
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

  // Provider resolution (session snapshot → explicit opts → task route → ollama):
  // Settings / Model Routing remain the clinic default source of truth.
  // snapshot.sessionProvider / sessionModel are draft-scoped only.
  //
  // A provider that was NAMED but has no composer adapter is REFUSED, never
  // quietly run as Ollama. It used to be coerced to "ollama", which means the
  // radiologist who chose a cloud model in the workspace selector and the clinic
  // that intends a local-only run both saw a draft labelled with a provider that
  // never produced it — and the two cases differ by whether this report's text
  // left the hospital. Ollama stays the default only when nobody named anything.
  const explicitProviderRaw =
    opts.snapshot.sessionProvider?.trim() ? opts.snapshot.sessionProvider : opts.providerOverride;
  const hasExplicitProvider = Boolean(
    (opts.providerOverride ?? "").trim() || opts.snapshot.sessionProvider?.trim(),
  );

  let providerName: ComposerProviderName;
  let routeModel: string | null = null;
  if (hasExplicitProvider) {
    const parsed = parseComposerProviderName(explicitProviderRaw);
    if (!parsed) {
      return {
        ok: false,
        safeError: "composer_provider_not_supported",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          degradedReason: unsupportedComposerProviderMessage(explicitProviderRaw),
        },
      };
    }
    providerName = parsed;
  } else {
    const taskKeys = composerTaskKeys(opts.kind, aiMode);
    let routeProvider: string | null = null;
    try {
      for (const taskKey of taskKeys) {
        const route = await resolveTaskRoute(taskKey);
        if (!route?.provider?.trim()) continue;
        routeProvider = route.provider.trim();
        routeModel = (route.model ?? "").trim() || null;
        break;
      }
    } catch {
      // Model Routing unreadable (no database, early boot): the clinic default,
      // which is a stated policy, not a guessed provider name.
      routeProvider = null;
    }
    if (routeProvider) {
      const parsed = parseComposerProviderName(routeProvider);
      if (!parsed) {
        return {
          ok: false,
          safeError: "composer_provider_not_supported",
          latencyMs: Date.now() - started,
          provenance: {
            ...baseProvenance,
            degradedReason: unsupportedComposerProviderMessage(routeProvider),
          },
        };
      }
      providerName = parsed;
    } else {
      providerName = "ollama";
    }
  }

  const isCloud =
    providerName === "deepseek" || providerName === "qwen" || providerName === "openai";
  const isLocalOpenAi = providerName === "local_openai_compatible";
  const isOllama = providerName === "ollama";

  // Ollama path still requires Local AI composer runtime. Other providers do not.
  if (isOllama && (!runtime.enabled || !runtime.model)) {
    if (aiMode === "SELECTED_IMAGES") {
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
        provenance: {
          ...baseProvenance,
          personaVersion: null,
          provider: "deterministic",
          fallbackUsed: true,
        },
      };
    }
    return {
      ok: false,
      safeError: "composer_model_not_configured",
      latencyMs: Date.now() - started,
      provenance: baseProvenance,
    };
  }

  const localEndpoint = isLocalOpenAi ? await getLocalOpenAiBaseUrl(null) : null;
  const providerAdapter = resolveComposerProvider(providerName);
  const cloudVisionAllowed = opts.cloudVisionAllowed === true && isCloud;
  // Key presence is resolved the same way the send itself resolves it
  // (ai_provider_settings first, then env), so the gate can no longer say
  // "not configured" about a provider the admin genuinely configured.
  const cloudProviderKey = asCloudComposerProvider(providerName);
  const cloudCfg = cloudProviderKey
    ? await resolveCloudComposerConfig(cloudProviderKey)
    : null;
  const policy = assertComposerProviderPolicy({
    provider: providerName,
    aiMode,
    cloudVisionAllowed,
    imageCount: (opts.snapshot.selectedKeyImages ?? []).length,
    images: undefined,
    // The count-only pass carries the same two policy terms as the authoritative
    // one below. It cannot know provenance yet, so without these it would refuse a
    // request whose attestation is fine and reason about the wrong thing.
    consentAttestedPerRequest: opts.consentAttestedPerRequest === true,
    requireAttestation: opts.requireAttestation !== false,
    localEndpointConfigured: isLocalOpenAi ? Boolean(localEndpoint?.trim()) : undefined,
    cloudApiKeyConfigured: cloudCfg?.keyConfigured,
    resolvedUrl: isLocalOpenAi ? localEndpoint ?? null : undefined,
  });
  if (!policy.ok) {
    return {
      ok: false,
      safeError: policy.safeError,
      latencyMs: Date.now() - started,
      provenance: {
        ...baseProvenance,
        provider: providerName,
        fallbackUsed: false,
        degradedReason: policy.safeError,
      },
    };
  }

  if (isOllama) {
    const guard = validateOllamaUrl(runtime.endpoint, runtime.localOnly);
    if (!guard.ok) {
      return {
        ok: false,
        safeError: "composer_endpoint_blocked",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          provider: providerName,
          fallbackUsed: false,
          // The guard's own reason names the setting to change, and it was
          // being discarded here. `composer_endpoint_blocked` on its own reads
          // like a firewall problem and sends an operator looking in the wrong
          // place; the sentence below is the fix, already written for a clinician.
          degradedReason: guard.reason,
        },
      };
    }
  }

  const sessionModel =
    (opts.modelOverride ?? "").trim() ||
    (opts.snapshot.sessionModel ?? "").trim() ||
    "";
  const localDefaultModel = isLocalOpenAi ? await getLocalOpenAiDefaultModel() : null;
  const textModel =
    sessionModel ||
    routeModel ||
    (isCloud
      ? defaultModelFor(providerName, "text") || runtime.model
      : isLocalOpenAi
        ? localDefaultModel || defaultModelFor(providerName, "text") || "bonsai"
        : runtime.model);

  let provenance: ComposerEvidenceProvenance = {
    ...baseProvenance,
    model: textModel,
    provider: providerName,
    fallbackUsed: false,
  };

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

    // The pre-adapter gate above can only count images, because their bytes have
    // not been read yet. Now they have, and provenance is known per image, so the
    // same gate is asked again with the real answer. This is the authoritative
    // check for an image send: a cloud provider that was permitted to exist by an
    // admin setting is still refused when the images belong to a patient and no
    // clinician attested this request. Reusing `assertComposerProviderPolicy`
    // rather than writing a second rule keeps one vocabulary for "why was this
    // refused", which is the question the audit row has to answer.
    const imageSourceTypes = resolved.images.map((img) => img.sourceType);
    const imagePolicy = assertComposerProviderPolicy({
      provider: providerName,
      aiMode,
      cloudVisionAllowed,
      imageCount: resolved.images.length,
      imageSourceTypes,
      consentAttestedPerRequest: opts.consentAttestedPerRequest === true,
      requireAttestation: opts.requireAttestation !== false,
      localEndpointConfigured: isLocalOpenAi ? Boolean(localEndpoint?.trim()) : undefined,
      cloudApiKeyConfigured: cloudCfg?.keyConfigured,
      resolvedUrl: isLocalOpenAi ? localEndpoint ?? null : undefined,
    });
    if (!imagePolicy.ok) {
      return {
        ok: false,
        safeError: imagePolicy.safeError,
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: runtime.model,
          provider: providerName,
          fallbackUsed: false,
          degradedReason:
            `Selected images are ${imageSourceTypes.join(", ") || "unattributed"}; ` +
            `cloud egress refused (${imagePolicy.safeError}).`,
          imagesLoaded: resolved.images.length,
          imageSourceTypes,
        },
      };
    }

    // Prefer configured vision model; cloud/local-openai use registry + settings.
    let visionModel =
      isCloud || isLocalOpenAi
        ? (sessionModel ||
            routeModel ||
            defaultModelFor(providerName, "vision") ||
            textModel)
        : (runtime.visionModel || "").trim() || runtime.model;

    if (isOllama) {
      let visionOk = await assertVisionCapableModel({
        endpoint: runtime.endpoint,
        model: visionModel,
      });
      if (!visionOk.ok && visionModel !== runtime.model && runtime.model) {
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
            model: visionModel,
            provider: providerName,
            degradedReason: visionOk.detail,
          },
        };
      }
    } else if (isCloud) {
      const visCap = assertModelSupportsCapability(providerName, visionModel, "vision");
      if (!visCap.ok) {
        return {
          ok: false,
          safeError: visCap.safeError,
          latencyMs: Date.now() - started,
          provenance: {
            ...baseProvenance,
            model: visionModel,
            provider: providerName,
            degradedReason: "Cloud vision requires a vision-capable registered model",
          },
        };
      }
    }
    // local_openai_compatible: adapter enforces Settings.supportsVision fail-closed.

    // Floor guard: a context window below the clinic minimum cannot hold even a
    // single image plus the clinical truth, so fail with an actionable error.
    const MIN_VISION_NUM_CTX = 2048;
    if (isOllama && runtime.numCtx < MIN_VISION_NUM_CTX) {
      return {
        ok: false,
        safeError: "composer_num_ctx_insufficient",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: visionModel,
          provider: providerName,
          degradedReason: `Composer num_ctx (${runtime.numCtx}) is below the minimum required for selected-image drafting (${MIN_VISION_NUM_CTX}). Increase ollama_composer_num_ctx in clinic settings.`,
        },
      };
    }

    provenance = {
      ...baseProvenance,
      model: visionModel,
      provider: providerName,
      fallbackUsed: false,
      imagesLoaded: resolved.images.length,
      imageSourceTypes,
      linkedObservationIds: resolved.linkedObservationIds,
      selectedKeyImageIds: resolved.selectedKeyImageIds,
    };

    const system = buildCareSystemPrompt(opts.kind, opts.snapshot);
    const user = buildUserPrompt(opts.kind, opts.snapshot, opts.canalAp);

    // Images cost context on top of the clinical truth. Size num_ctx for THIS
    // request from CARE's existing empirical estimator rather than trusting the
    // admin default (4096), which cannot hold 4 key images. Bounded by the
    // ceiling the composer clamp already enforces, never lowered below the
    // configured value, and a request that cannot fit even then FAILS instead of
    // letting Ollama truncate the radiologist's own observations.
    let composeNumCtx = runtime.numCtx;
    if (isOllama) {
      const plan = planComposerVisionContext({
        imageCount: resolved.images.length,
        systemPrompt: system,
        userPrompt: user,
        configuredNumCtx: runtime.numCtx,
      });
      if (!plan.fits) {
        return {
          ok: false,
          safeError: "composer_context_budget_exceeded",
          latencyMs: Date.now() - started,
          model: visionModel,
          provenance: {
            ...provenance,
            degradedReason: plan.reason,
          },
        };
      }
      composeNumCtx = plan.numCtx;
    }

    const primary = await providerAdapter.compose({
      systemPrompt: system,
      userPrompt: user,
      model: visionModel,
      temperature: runtime.temperature,
      timeoutMs: runtime.timeoutMs,
      numCtx: composeNumCtx,
      endpoint: isLocalOpenAi ? (localEndpoint ?? undefined) : runtime.endpoint,
      localOnly: runtime.localOnly,
      // Re-checked inside the cloud transport, so opening cloud vision would
      // need two deliberate changes rather than one. Passes through only what
      // the policy above already required — production jobs never set it.
      cloudVisionAllowed,
      maxTokens: composerOutputReserveTokens(composerPromptTextTokens(system, user)),
      // Preserve each resolved image's actual MIME (jpeg/png/webp) — do not coerce to JPEG.
      images: resolved.images.map((img) => ({
        mimeType: img.mimeType,
        base64: img.base64,
      })),
    });

    // The adapter answers for where the bytes went. Recorded here rather than
    // inferred downstream, so an audit row can never describe a request as local
    // because the settings said it should be.
    provenance = {
      ...provenance,
      executedLocality:
        primary.execution === "CLOUD" ? "cloud"
          : primary.execution === "LOCAL" ? "local"
            : null,
      resolvedEndpoint: (isLocalOpenAi ? localEndpoint : runtime.endpoint) ?? null,
    };

    if (!primary.ok) {
      const detail = primary.detail ?? primary.safeError ?? "compose_failed";
      return {
        ok: false,
        safeError: primary.safeError ?? "compose_failed",
        latencyMs: Date.now() - started,
        model: visionModel,
        provider: providerName,
        usage: primary.usage ?? null,
        provenance: {
          ...provenance,
          degradedReason: detail,
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
        provider: providerName,
        usage: primary.usage ?? null,
        rawLength: primary.text?.length ?? 0,
        provenance: {
          ...provenance,
          degradedReason:
            `The model replied in prose rather than the structured form the Composer requires, so nothing `
            + `was written to your report. Your observations are unchanged.`,
        },
      };
    }

    return {
      ok: true,
      draft,
      model: visionModel,
      provider: providerName,
      usage: primary.usage ?? null,
      fallbackUsed: false,
      latencyMs: Date.now() - started,
      rawLength: primary.text?.length ?? 0,
      provenance,
    };
  }

  // ── TEXT_ONLY path (existing behaviour) ──────────────────────────────
  const system = buildCareSystemPrompt(opts.kind, opts.snapshot);
  const user = buildUserPrompt(opts.kind, opts.snapshot, opts.canalAp);

  // Same rule the selected-image path already follows, now applied to text: the
  // request is sized for the window it will actually get, and a request that
  // cannot fit is REFUSED rather than sent. Before this, TEXT_ONLY handed Ollama
  // the admin's fixed `num_ctx` no matter how big the report had become, and
  // Ollama's answer to that is to drop the end of the prompt silently — which for
  // a professionalize/refine job means the model never saw the second half of the
  // radiologist's report and could not preserve it.
  const textPlan = planComposerTextContext({
    systemPrompt: system,
    userPrompt: user,
    transport: isOllama ? "ollama" : "cloud",
    configuredNumCtx: runtime.numCtx,
  });
  if (!textPlan.fits) {
    return {
      ok: false,
      safeError: "composer_context_budget_exceeded",
      latencyMs: Date.now() - started,
      model: textModel,
      provider: providerName,
      provenance: {
        ...baseProvenance,
        model: textModel,
        provider: providerName,
        degradedReason: textPlan.reason,
      },
    };
  }

  const sendOpts = {
    temperature: runtime.temperature,
    timeoutMs: runtime.timeoutMs,
    // Only the local arm has a window to size. Cloud adapters and the
    // local OpenAI-compatible arm keep exactly the value they were handed before.
    numCtx: isOllama ? textPlan.numCtx : runtime.numCtx,
    maxTokens: textPlan.maxTokens,
    endpoint: isLocalOpenAi ? (localEndpoint ?? undefined) : runtime.endpoint,
    localOnly: runtime.localOnly,
  } as const;

  const primary = await providerAdapter.compose({
      systemPrompt: system,
      userPrompt: user,
      model: textModel,
      ...sendOpts,
    });

  let text = primary.ok ? primary.text : undefined;
  let usage = primary.usage ?? null;
  let model = textModel;
  let fallbackUsed = false;
  if (!primary.ok && isOllama && runtime.fallbackModel) {
    const fb = await providerAdapter.compose({
      systemPrompt: system,
      userPrompt: user,
      model: runtime.fallbackModel,
      ...sendOpts,
    });
    if (fb.ok) {
      text = fb.text;
      usage = fb.usage ?? usage;
      model = runtime.fallbackModel;
      fallbackUsed = true;
    } else {
      return {
        ok: false,
        safeError: primary.safeError ?? fb.safeError ?? "compose_failed",
        latencyMs: Date.now() - started,
        model: runtime.model,
        provider: providerName,
        usage: fb.usage ?? usage,
        fallbackUsed: true,
        provenance: { ...baseProvenance, model: runtime.model, provider: providerName, fallbackUsed: true },
      };
    }
  } else if (!primary.ok) {
    if (opts.allowDeterministicFallback !== false && isOllama) {
      const draft = deterministicComposeFromSnapshot(opts.snapshot, opts.kind);
      return {
        ok: true,
        draft,
        model: "deterministic",
        fallbackUsed: true,
        latencyMs: Date.now() - started,
        safeError: primary.safeError,
        provenance: {
          ...baseProvenance,
          model: "deterministic",
          provider: "deterministic",
          fallbackUsed: true,
          personaVersion: null,
          // The draft is mechanical, so the reason the model did not answer is
          // the only thing that tells the radiologist this is not an AI report
          // and what to change. Losing it left "six months of bad drafts" with
          // no trace of why.
          degradedReason:
            primary.detail ?? primary.safeError ?? "The local model did not answer; this draft was assembled without AI.",
        },
      };
    }
    return {
      ok: false,
      safeError: primary.safeError ?? "compose_failed",
      latencyMs: Date.now() - started,
      model: textModel,
      provider: providerName,
      usage: primary.usage ?? null,
      fallbackUsed: false,
      provenance: { ...baseProvenance, model: textModel, provider: providerName, fallbackUsed: false },
    };
  }

  const draft = parseComposerDraftJson(text ?? "");
  if (!draft) {
    return {
      ok: false,
      safeError: "malformed_json",
      latencyMs: Date.now() - started,
      model,
      provider: providerName,
      usage,
      fallbackUsed,
      rawLength: text?.length ?? 0,
      provenance: {
        ...baseProvenance,
        model,
        provider: providerName,
        fallbackUsed,
        // The model did answer — this is a format disagreement, not an outage,
        // and the two need different fixes. Saying only `malformed_json` sent
        // the reader to check whether Ollama was running.
        degradedReason:
          `The model replied in prose rather than the structured form the Composer requires, so nothing `
          + `was written to your report. Your observations are unchanged. Try again, or pick a different `
          + `model in AI Reporting Settings → Local AI → Report Composer model.`,
      },
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

  // A selection edit comes back as the WHOLE section, because Accept replaces the
  // whole section with whatever this draft holds (`trackedChanges.ts` emits one
  // REPLACE per field, and `materializeAcceptedText` assigns it). Returning only
  // the reworded sentence therefore deletes everything around it. The prompt now
  // says so explicitly; this is the net underneath that instruction.
  //
  // It is a LENGTH test on purpose. A faithful answer may reword every sentence,
  // so checking that the untouched text still appears verbatim would reject good
  // drafts — and content preservation is already `detectConservationLosses`' job.
  // What is always wrong is an answer far shorter than the section it replaces.
  if (
    isPreservingComposeKind(opts.kind) &&
    opts.snapshot.selectionText?.trim() &&
    opts.snapshot.selectionField
  ) {
    const fieldKey = opts.snapshot.selectionField;
    const answerKey =
      fieldKey === "FINDINGS" ? "findings" : fieldKey === "IMPRESSION" ? "impression" : "recommendation";
    if (
      selectionAnswerLosesField({
        field: (opts.snapshot[answerKey] ?? "") as string,
        selectionText: opts.snapshot.selectionText ?? "",
        answer: draft[answerKey] ?? "",
      })
    ) {
      return {
        ok: false,
        safeError: "selection_edit_answer_truncated",
        latencyMs: Date.now() - started,
        model,
        provider: providerName,
        usage,
        rawLength: text?.length ?? 0,
        provenance: {
          ...baseProvenance,
          model,
          provider: providerName,
          degradedReason:
            `The model answered with only the selected text instead of the whole ${fieldKey} section, `
            + "so nothing was offered for review — accepting it would have replaced the rest of that "
            + "section with the single sentence. Your report is unchanged. Try again, or ask for the "
            + "whole section to be rewritten instead of a selection.",
        },
      };
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
    provider: providerName,
    usage,
    fallbackUsed,
    latencyMs: Date.now() - started,
    rawLength: text?.length ?? 0,
    provenance: { ...baseProvenance, model, provider: providerName, fallbackUsed },
  };
}

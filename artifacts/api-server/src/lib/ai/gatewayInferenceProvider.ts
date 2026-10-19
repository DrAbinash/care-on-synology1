/**
 * Gateway inference provider — Phase P2 / Gate G7 + overnight MRI hardening.
 *
 * Implements the P1 shadow-inference seam by calling the AI Gateway
 * (@workspace/ai-providers requestStructuredReport + generateAiResponse).
 *
 * Cloud overnight (Qwen/DeepSeek/OpenAI) is EXPERIMENTAL and opt-in only.
 * DEFAULT remains local Ollama / qwen3-vl:8b. No DeepSeek side-door imports.
 */
import { requestStructuredReport, defaultModelForProvider } from "@workspace/ai-providers";
import type { ShadowInferenceProvider, ShadowInferenceInput, ShadowInferenceOutput } from "./shadowInference";
import { getOvernightVisionInferenceOptions } from "./overnightVisionConfig";
import { classifyOvernightProviderFailure } from "./productionVisionPolicy";
import { recordImageSendAudit } from "./imageSendAudit";

const RADIOLOGY_TASK_KEY = "overnight_vision";
const P2_PROMPT_VERSION = "radiology-draft-mri-grounded-v2";

/** Exported for unit tests — overnight MRI grounding rules. */
export function buildRadiologyDraftPrompt(input: ShadowInferenceInput & { safeMode?: boolean }): string {
  const imageCount = input.images?.length ?? 0;
  const safeNote = input.safeMode
    ? [
        "",
        "SAFE MODE: Only ONE representative image is supplied.",
        "State clearly that this is a LIMITED REVIEW and does not represent review of the complete MRI examination.",
      ].join("\n")
    : "";
  return [
    "You are a radiology reporting assistant producing a STRUCTURED PROVISIONAL AI DRAFT only.",
    "This is NEVER a final report. A radiologist must review/edit/finalize separately.",
    "",
    "HARD GROUNDING RULES:",
    "1. Use ONLY the supplied study images and any clinical/history text included in this prompt.",
    "2. Do NOT invent patient demographics (age, sex), Study IDs, physician names, institution names, report numbers, or acquisition dates for the report body — even if OCR-like text appears in images.",
    "3. Do NOT invent measurements. If a measurement is not clearly readable on the supplied images, omit it or mark indeterminate.",
    "4. Do NOT claim contrast enhancement unless a supplied series/anchor is explicitly identified as post-contrast. Bright T1 alone is NOT proof of contrast.",
    "5. Do NOT state diffusion restriction unless both DWI and ADC evidence is available among the supplied images/anchors (or an evidence policy explicitly supports it). DWI hyperintensity alone without ADC → indeterminate, not definite restriction.",
    "6. Do NOT invent sequence names solely from appearance if metadata/anchors do not identify them.",
    "7. Do NOT manufacture normal findings for anatomy not adequately demonstrated on the supplied images.",
    "8. Limited screenshots/key images → wording appropriate to a LIMITED REVIEW (state limitations).",
    "9. Unsupported certainty → use 'indeterminate/not assessable on supplied images' rather than fabricating detail.",
    "10. Do NOT add generic recommendations (CSF analysis, oncology referral, neuropsychology, etc.) unless an explicit clinical rule or radiologist input in the prompt requires it.",
    "11. Do NOT claim institutional standards (AIIMS/Apollo/etc.).",
    "12. Do NOT expose chain-of-thought or reasoning. Output JSON only.",
    safeNote,
    "",
    `Study modality: ${input.modality ?? "unknown"}. ${imageCount} representative image(s) are provided.`,
    "Return ONLY JSON conforming to the provisional-report contract: { studyContext, findings[], measurements[], impression[] }.",
    "Every abnormal finding MUST include an evidence anchor referencing one of the provided image series/SOP UIDs.",
    "Do not invent series/SOP UIDs. If unsure, omit the finding or mark it indeterminate.",
    "Distinguish OBSERVATION (findings[]) from IMPRESSION (impression[]).",
    "If the supplied images show no significant abnormality (or only a limited review is possible), still return a non-empty impression[] with a concise reviewable statement such as 'No significant abnormality identified on the supplied images — radiologist review required.' Do NOT invent anatomy-specific normal findings for sequences that were not demonstrated.",
    `Available image anchors: ${JSON.stringify(input.imageAnchors.slice(0, 20))}`,
  ].filter(Boolean).join("\n");
}

type NightMode = "local" | "deepseek" | "qwen" | "openai" | "ab";

function resolveNightCloudProvider(mode: NightMode): "deepseek" | "qwen" | "openai" | null {
  if (mode === "deepseek" || mode === "qwen" || mode === "openai") return mode;
  if (mode === "ab") return "deepseek"; // A/B telemetry arm defaults to DeepSeek when opted in
  return null;
}

export const gatewayInferenceProvider: ShadowInferenceProvider = {
  name: "ai-gateway-v1",
  async infer(input: ShadowInferenceInput): Promise<ShadowInferenceOutput> {
    const images = (input.images ?? []).map((i) => i.imageData);
    const vision = await getOvernightVisionInferenceOptions();
    let lastError: string | undefined;
    let lastDiag: {
      errorCode?: string | null;
      httpStatus?: number | null;
      elapsedMs?: number | null;
      responseLength?: number | null;
      thinkingLength?: number | null;
      evalCount?: number | null;
      finishReason?: string | null;
    } | null = null;

    const { generateAiResponse } = await import("@workspace/ai-providers");
    const prompt = buildRadiologyDraftPrompt({ ...input, safeMode: vision.policy.safeMode });

    let nightVisionProvider: NightMode = "local";
    let cloudVisionAllowed = false;
    try {
      const { getOvernightOpsControls } = await import("./clinicalConfigService");
      const ops = await getOvernightOpsControls();
      nightVisionProvider = (ops.nightVisionProvider ?? "local") as NightMode;
      cloudVisionAllowed =
        ops.deepseekCloudVisionAllowed === true ||
        (ops as { cloudVisionAllowed?: boolean }).cloudVisionAllowed === true;
    } catch {
      nightVisionProvider = "local";
    }

    // ALWAYS run local first — overnight default path unchanged.
    let authoritativeProvider = "ollama";
    let authoritativeModel = vision.model;
    let direct = await generateAiResponse("ollama", prompt, images, {
      model: vision.model,
      numCtx: vision.numCtx,
      think: vision.think,
      temperature: vision.temperature,
      maxTokens: vision.policy.maxTokens,
      endpointUrl: vision.endpointUrl,
      timeoutMs: vision.policy.timeoutMs,
    });

    const cloudProvider = resolveNightCloudProvider(nightVisionProvider);
    // STAGE 1 PR-A — the admin flag is necessary, not sufficient.
    //
    // This arm used to open on `ops.deepseekCloudVisionAllowed` alone and send the
    // SAME patient pixels a second time to a named cloud provider — including in
    // "ab" mode, where the cloud answer was only telemetry and the local answer
    // stayed authoritative. Nothing recorded it and nobody had to be in the room
    // when it happened: the two callers are a cron tick and an admin self-test.
    //
    // Patient-derived frames now require a per-request attestation
    // (`input.imageConsent`) that an unattended job cannot produce, so this path
    // is local-only in Stage 1. A refusal is still filed, because "we did not send
    // it, and here is why" is the answer an auditor needs; silence looks like an
    // absent feature.
    const attested = input.imageConsent != null
      && String(input.imageConsent.attestedBy ?? "").trim() !== ""
      && String(input.imageConsent.attestedAt ?? "").trim() !== "";
    const mayCallCloud =
      cloudVisionAllowed &&
      attested &&
      images.length > 0 &&
      cloudProvider != null &&
      (nightVisionProvider === "ab" ||
        nightVisionProvider === "deepseek" ||
        nightVisionProvider === "qwen" ||
        nightVisionProvider === "openai");

    // Every image reaching this provider is a frame rendered from the study in
    // Orthanc, so its provenance is stated rather than guessed.
    const imageSourceTypes = images.map(() => "DICOM");

    // A row per IMAGE send, which is the same rule `jobService` applies: a
    // text-only shadow run is not an image egress, and filing it as one would
    // make the census "how many patient frames left the clinic" unreadable.
    if (images.length > 0) {
      await recordImageSendAudit(
        {
          studyInstanceUID: input.studyInstanceUid,
          provider: authoritativeProvider,
          model: authoritativeModel ?? null,
          resolvedUrl: vision.endpointUrl ?? null,
          executedLocality: direct.execution?.locality ?? null,
          numImages: images.length,
          imageSourceTypes,
          jobReference: input.jobReference ?? null,
          success: direct.success,
          safeFailureReason: direct.success ? null : (direct.error ?? "provider_error"),
        },
      );
    }

    if (cloudVisionAllowed && images.length > 0 && cloudProvider && !attested) {
      await recordImageSendAudit(
        {
          studyInstanceUID: input.studyInstanceUid,
          provider: cloudProvider,
          model: defaultModelForProvider(cloudProvider, true) ?? null,
          resolvedUrl: null,
          executedLocality: "cloud",
          numImages: images.length,
          imageSourceTypes,
          jobReference: input.jobReference ?? null,
          success: false,
          safeFailureReason:
            "PHI_IMAGE_CLOUD_UNATTESTED — cloud vision is permitted for the clinic, but no clinician attested these patient-derived frames for this request.",
        },
      );
    }

    if (mayCallCloud && cloudProvider) {
      const cloudModel =
        defaultModelForProvider(cloudProvider, true) ||
        (cloudProvider === "deepseek" ? "deepseek-v4-flash-vision-exp" : "qwen3.7-plus");
      const cloud = await generateAiResponse(cloudProvider, prompt, images, {
        model: cloudModel,
        temperature: vision.temperature,
        maxTokens: vision.policy.maxTokens,
        timeoutMs: vision.policy.timeoutMs,
        cloudVisionAllowed: true,
        imageSourceTypes,
        consentAttestedPerRequest: true,
      });
      await recordImageSendAudit(
        {
          studyInstanceUID: input.studyInstanceUid,
          provider: cloudProvider,
          model: cloudModel,
          resolvedUrl: null,
          executedLocality: cloud.execution?.locality ?? "cloud",
          numImages: images.length,
          imageSourceTypes,
          jobReference: input.jobReference ?? null,
          // The attested human is named in the row that proves consent. The
          // identity itself is not stored: `attestedBy` is a user reference, and
          // an audit table is not where a name belongs when `user_id` exists.
          userId: null,
          success: cloud.success,
          safeFailureReason: cloud.success ? null : (cloud.error ?? "provider_error"),
        },
      );
      // ab = telemetry only; local stays authoritative.
      if (nightVisionProvider !== "ab" && cloud.success) {
        direct = cloud;
        authoritativeProvider = cloudProvider;
        authoritativeModel = cloudModel;
      } else if (nightVisionProvider !== "ab" && !cloud.success && !direct.success) {
        // A failed cloud answer replacing a failed local answer is still an
        // honest attribution: `authoritativeProvider` records who is being
        // reported, and nothing here turns a refusal into a success.
        direct = cloud;
        authoritativeProvider = cloudProvider;
        authoritativeModel = cloudModel;
      }
    }

    lastError = direct.error;
    lastDiag = direct.diagnostics
      ? {
          errorCode: direct.diagnostics.errorCode,
          httpStatus: direct.diagnostics.httpStatus,
          elapsedMs: direct.diagnostics.elapsedMs,
          responseLength: direct.diagnostics.responseLength,
          thinkingLength: direct.diagnostics.thinkingLength,
          evalCount: direct.diagnostics.ollamaEvalCount,
          finishReason: direct.diagnostics.finishReason,
        }
      : null;

    if (!direct.success) {
      const fail = classifyOvernightProviderFailure({
        success: false,
        httpStatus: lastDiag?.httpStatus,
        errorCode: lastDiag?.errorCode,
        errorMessage: lastError,
        responseLength: lastDiag?.responseLength,
        thinkingLength: lastDiag?.thinkingLength,
        evalCount: lastDiag?.evalCount,
        numPredict: vision.policy.maxTokens,
        finishReason: lastDiag?.finishReason,
      });
      return {
        draft: {
          studyContext: {
            studyInstanceUid: input.studyInstanceUid,
            modality: input.modality,
            imageCount: images.length,
          },
          findings: [],
          measurements: [],
          impression: [],
        },
        provenance: {
          modelVersion: authoritativeModel,
          modelDigest: null,
          provider: authoritativeProvider,
          degraded: true,
          detail: fail.detail,
          failureCode: fail.code,
          failureDetail: fail.detail,
          resourceFailureCode:
            fail.code === "GPU_OUT_OF_MEMORY" || fail.code === "CONTEXT_BUDGET_EXCEEDED"
              ? fail.code
              : fail.code === "PROVIDER_TIMEOUT"
                ? "PROVIDER_TIMEOUT"
                : fail.code === "PROVIDER_HTTP_ERROR"
                  ? "PROVIDER_HTTP_ERROR"
                  : null,
          httpStatus: lastDiag?.httpStatus ?? null,
          elapsedMs: lastDiag?.elapsedMs ?? null,
          requestedImages: images.length,
          selectedImages: images.length,
          numCtx: vision.numCtx,
          recoveredOnce: false,
        },
      };
    }

    // Successful provider text → validate via gateway contract (no second inference).
    // Provenance uses the ACTUAL authoritative provider — never force "ollama".
    const result = await requestStructuredReport(
      {
        taskKey: RADIOLOGY_TASK_KEY,
        studyInstanceUid: input.studyInstanceUid,
        modality: input.modality,
        prompt,
        promptVersion: P2_PROMPT_VERSION,
        images,
        required: { vision: images.length > 0, groundedJson: true },
        timeoutMs: vision.policy.timeoutMs,
        maxAttempts: 1,
      },
      {
        call: async () => ({ success: true, text: direct.text }),
        selectChain: async () => [
          {
            provider: authoritativeProvider,
            model: authoritativeModel,
            modelDigest: null,
            isLocal: authoritativeProvider === "ollama",
            phiEligible: authoritativeProvider === "ollama",
          },
        ],
      },
    );

    // A degraded-but-successful call is the case the clinic actually sees: HTTP 200,
    // an empty draft, and no record of why. Classify while the diagnostics are still
    // in scope so "budget exhausted" is not reported as "provider/parse failure".
    let failureCode: string | null = null;
    let failureDetail: string | null = null;
    if (result.degraded) {
      const emptied = classifyOvernightProviderFailure({
        success: true,
        httpStatus: lastDiag?.httpStatus ?? 200,
        errorCode: lastDiag?.errorCode ?? null,
        errorMessage: lastError ?? null,
        responseLength: (direct.text ?? "").length,
        thinkingLength: lastDiag?.thinkingLength ?? null,
        evalCount: lastDiag?.evalCount ?? null,
        numPredict: vision.policy.maxTokens,
        finishReason: lastDiag?.finishReason ?? null,
        // The gateway reached us with text that produced no draft; that is what
        // parserSuccess=false means here.
        parserSuccess: false,
      });
      failureCode = emptied.code;
      failureDetail = emptied.detail;
    }

    return {
      draft: {
        studyContext: result.report.studyContext,
        findings: result.report.findings.map((f) => ({
          key: f.key,
          text: f.text,
          laterality: f.laterality,
          negated: f.negated,
          evidence: f.evidence,
        })),
        measurements: result.report.measurements,
        impression: result.report.impression,
      },
      provenance: {
        modelVersion: result.model ? `${result.model}` : authoritativeModel,
        modelDigest: result.modelDigest,
        provider: result.provider || authoritativeProvider,
        degraded: result.degraded,
        detail: `${result.detail}; endpoint=${vision.endpointUrl}; num_ctx=${vision.numCtx}; think=${vision.think}; safeMode=${vision.policy.safeMode}; nightVisionProvider=${nightVisionProvider}; authoritative=${authoritativeProvider}${
          failureCode ? `; cause=${failureCode} (${failureDetail})` : ""
        }`,
        resourceFailureCode: null,
        failureCode,
        failureDetail,
        httpStatus: lastDiag?.httpStatus ?? (direct.success ? 200 : null),
        elapsedMs: lastDiag?.elapsedMs ?? null,
        requestedImages: images.length,
        selectedImages: images.length,
        numCtx: vision.numCtx,
        recoveredOnce: false,
      },
    };
  },
};

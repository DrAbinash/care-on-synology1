/**
 * Cloud privacy gate for the Report Composer — the one seam every cloud-bound
 * composer request must pass before a byte leaves the clinic.
 *
 * Why this file exists in its current form: it was written, exported from
 * `providers/index.ts`, and never called. Meanwhile the composer's cloud
 * adapters went straight to the raw OpenAI-compatible transport, so the PHI
 * machinery CARE already built guarded every `generateAiResponse()` caller and
 * nothing at all on the report-drafting path. A radiologist's clinical history
 * is free text in the frozen snapshot ("Ramesh, UHID 45812, pain since
 * 12/03/19"), and it reached Qwen / OpenAI / DeepSeek unchecked. A gate that
 * reads as coverage but is not called is worse than no gate at all.
 *
 * Policy is REUSED, not reinvented. Same detector, same scrubber, same clinic
 * setting, same rejection token as `generateAiResponse`
 * (lib/ai-providers/src/index.ts:1265-1299). `composerCloudPrivacy.agreement.test.ts`
 * pins the two paths against a shared corpus so they cannot drift apart.
 *
 * Deliberate choices:
 *  - Detection runs on BOTH prompts, because micro-kind jobs put radiologist
 *    text into the system prompt (composeEngine buildCareSystemPrompt).
 *  - The arm fails CLOSED rather than sending half-cleaned clinical prose:
 *    identifiers that survive the scrubber stay in the clinic, they do not get
 *    shipped with a caveat.
 *  - The scrubber only rewrites values it can name with confidence, so
 *    laterality, spinal levels, measurements and clinically stated age/sex are
 *    untouched. Blocking is preferred over rewriting for anything unresolved.
 *  - LOCAL providers (Ollama, local OpenAI-compatible) are passed through
 *    byte-for-byte and never rewritten: their text does not leave the clinic,
 *    and silently editing a radiologist's prompt would be a clinical change
 *    justified by nothing.
 */
import {
  cloudTextPhiAllowed,
  detectPhiCategories,
  scrubPhiText,
  type PhiCategory,
} from "@workspace/ai-providers";
import { assertNoRawDicomPayload, flagPossibleBurnedInPhi } from "./cloudPayloadPrivacy";
import {
  isCloudComposerProvider,
  isLocalComposerProvider,
  type ComposerProviderImage,
  type ComposerProviderName,
} from "./types";

export type GatewayPrivacyInput = {
  provider: ComposerProviderName;
  systemPrompt?: string;
  userPrompt?: string;
  images?: ComposerProviderImage[];
  filenames?: Array<string | null | undefined>;
  cloudAllowed?: boolean;
  cloudVisionAllowed?: boolean;
};

/**
 * What the gate actually established about the text it just inspected.
 * `identifiersExcluded` used to be a hard-coded `true` on every return path,
 * including the ones that looked at nothing. Truthful postures only:
 *  - `not_applicable`       — local arm, nothing left the clinic.
 *  - `clean_undetected`     — the detector ran and named no identifier. Heuristic,
 *                             so this means "not detected", never "verified absent".
 *  - `identifiers_redacted` — identifiers were found, the clinic opted into
 *                             redaction, and a re-scan of the replacement came back clean.
 */
export type CloudTextPosture = "not_applicable" | "clean_undetected" | "identifiers_redacted";

/**
 * There is no pixel inspection anywhere in CARE. An image that passed the MIME
 * and raw-DICOM checks may still carry a name burned into the raster by the
 * modality, and nothing here can say otherwise.
 */
export type PixelPhiPosture = "not_verified";

export type GatewayPrivacyResult =
  | {
      ok: true;
      cloud: boolean;
      /** The exact text to send — redacted when `identifiers_redacted`. */
      systemPrompt: string;
      userPrompt: string;
      phiCategories: PhiCategory[];
      textPosture: CloudTextPosture;
      pixelPosture: PixelPhiPosture;
      burnedInPhiFlags: string[];
      /**
       * Cloud arm: earned only when `assertNoRawDicomPayload` ran on this
       * payload. Local arm: trivially true because nothing is egressed at all —
       * it is not the result of inspecting the bytes.
       */
      rawDicomExcluded: boolean;
    }
  | { ok: false; safeError: string; detail?: string };

export async function assertGatewayPrivacy(
  input: GatewayPrivacyInput,
): Promise<GatewayPrivacyResult> {
  const systemPrompt = input.systemPrompt ?? "";
  const userPrompt = input.userPrompt ?? "";
  const images = input.images ?? [];
  const hasImages = images.length > 0;

  if (!isCloudComposerProvider(input.provider)) {
    if (!isLocalComposerProvider(input.provider)) {
      // Never default an unrecognised name to "local". That is how a provider
      // added to the registry could ship clinical text off-prem while every
      // gate believed it was on-prem.
      return {
        ok: false,
        safeError: "composer_provider_not_supported",
        detail: `Provider "${String(input.provider)}" has no Report Composer adapter, so nothing was sent.`,
      };
    }
    return {
      ok: true,
      cloud: false,
      systemPrompt,
      userPrompt,
      phiCategories: [],
      textPosture: "not_applicable",
      pixelPosture: "not_verified",
      burnedInPhiFlags: [],
      rawDicomExcluded: true,
    };
  }

  if (input.cloudAllowed === false) {
    return { ok: false, safeError: "cloud_provider_not_allowed" };
  }

  // DEFAULT DENY for pixels. Unchanged by this gate, and asserted by
  // composerCloudEgress.regression.test.ts — preparing cloud text support must
  // not open the image door.
  if (hasImages && input.cloudVisionAllowed !== true) {
    return { ok: false, safeError: "cloud_vision_not_allowed" };
  }

  const dicom = assertNoRawDicomPayload({
    mimeTypes: images.map((i) => i.mimeType),
    filenames: input.filenames,
  });
  if (!dicom.ok) return dicom;

  for (const img of images) {
    if (
      img.mimeType !== "image/jpeg" &&
      img.mimeType !== "image/png" &&
      img.mimeType !== "image/webp"
    ) {
      return { ok: false, safeError: "cloud_image_mime_not_allowed" };
    }
  }

  const categories = [...new Set([...detectPhiCategories(systemPrompt), ...detectPhiCategories(userPrompt)])];

  let outSystem = systemPrompt;
  let outUser = userPrompt;
  let textPosture: CloudTextPosture = "clean_undetected";

  if (categories.length > 0) {
    if (!(await cloudTextPhiAllowed())) {
      return {
        ok: false,
        safeError: "PHI_TEXT_CLOUD_BLOCKED",
        detail:
          `Patient identifiers are present in the composer request (${categories.join(", ")}). `
          + "Nothing was sent. Keep this report on the local model, or enable "
          + "\"Allow identifiers in cloud text requests\" in AI Reporting Settings to send "
          + "it with those fields redacted.",
      };
    }
    outSystem = scrubPhiText(systemPrompt).text;
    outUser = scrubPhiText(userPrompt).text;
    // Re-scan what is about to be sent. A name the scrubber could not name is
    // not a name we are willing to mail.
    const residual = [
      ...new Set([...detectPhiCategories(outSystem), ...detectPhiCategories(outUser)]),
    ];
    if (residual.length > 0) {
      return {
        ok: false,
        safeError: "PHI_TEXT_CLOUD_UNRESOLVABLE",
        detail:
          `Identifiers remain after redaction (${residual.join(", ")}), so nothing was sent. `
          + "Remove them from the clinical history / findings text, or keep this study local.",
      };
    }
    textPosture = "identifiers_redacted";
  }

  const burnedInPhiFlags = flagPossibleBurnedInPhi([
    outUser,
    outSystem,
    ...(input.filenames ?? []).filter((f): f is string => typeof f === "string"),
  ]);

  return {
    ok: true,
    cloud: true,
    systemPrompt: outSystem,
    userPrompt: outUser,
    phiCategories: categories,
    textPosture,
    pixelPosture: "not_verified",
    burnedInPhiFlags,
    rawDicomExcluded: true,
  };
}

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
  classifyEffectiveLocality,
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
  /**
   * Resolved base URL for local providers. When provided, locality is derived
   * from the actual network destination. A "local" provider with a public URL
   * is reclassified as cloud and subject to full PHI gating.
   */
  resolvedUrl?: string | null;
  /**
   * Cloud arm with pixels: the outcome of the de-identification gate. Absent, or
   * not `clean`, or covering a different number of images than are being sent,
   * means the pixels are refused. A caller cannot opt out by omitting it — the
   * default is deny, and the local arm never needs it because nothing egresses.
   */
  pixelProof?: PixelEgressProof | null;
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
 * Pixel postures this gate can honestly claim.
 *
 * `not_verified` — nothing inspected the raster. This is the ONLY posture a local
 * arm can report (correctly: nothing egressed, so there was nothing to verify),
 * and it now also means "may not go to a cloud provider", because the cloud arm
 * refuses on it.
 *
 * `verified_clean` — the de-identification gate re-encoded the image, proved no
 * container metadata survived, and the clinic's own on-premises model read the
 * picture and found none of this patient's identifiers in it. A call to a cloud
 * provider is allowed only on this posture, and only for the exact bytes that
 * gate produced.
 */
export type PixelPhiPosture = "not_verified" | "verified_clean";

/**
 * What the de-identification gate must hand this seam before any pixel moves.
 * Carrying the verified images through here, rather than letting the caller pass
 * whatever bytes it likes afterwards, is what makes the proof non-forgeable:
 * the gate sends what was verified, not what was asked for.
 */
export type PixelEgressProof = {
  posture: "clean";
  images: Array<{ base64: string; mimeType: string }>;
};

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
      /**
       * The exact bytes cleared for egress. When pixels were verified this is the
       * metadata-stripped re-encoded set the gate checked — NOT the set the caller
       * asked with, which may carry a burned-in name or surviving EXIF. Callers
       * must send these and nothing else.
       */
      images: ComposerProviderImage[];
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

    // Endpoint-derived locality: a "local" provider whose resolved URL points
    // to a public internet address is reclassified as cloud. The URL is the
    // ground truth, not the adapter name. When reclassified, the local bypass
    // is skipped and the request falls through to the full cloud PHI gate below.
    const effectivelyCloud =
      input.resolvedUrl != null &&
      input.resolvedUrl !== "" &&
      classifyEffectiveLocality(input.provider, input.resolvedUrl).locality === "cloud";

    if (!effectivelyCloud) {
      // Genuinely local (private/LAN URL, or no URL resolved) — bypass cloud PHI.
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
        // Nothing egresses on the local arm, so the caller's images pass through
        // unchanged — and `cloud: false` is what says so.
        images,
      };
    }
    // Reclassified as cloud — fall through to the cloud gate below.
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

  // PIXELS REQUIRE PROOF. An opt-in and a MIME check are permissions, not
  // inspections: neither looked at the raster, so neither can say the patient's
  // name is not burned into it. The de-identification gate is the only thing
  // that has, and its result is demanded here rather than trusted downstream.
  //
  // Three separate ways this could be quietly defeated, all closed:
  //  - omitted entirely               → the default is deny, not "unverified ok";
  //  - a clean proof for other bytes  → the sent images are the proof's images;
  //  - a proof covering fewer images  → the count must match exactly.
  if (hasImages) {
    const proof = input.pixelProof ?? null;
    if (!proof || proof.posture !== "clean") {
      return {
        ok: false,
        safeError: "cloud_image_not_verified",
        detail:
          "No on-premises verification that these images are free of patient identifiers, so nothing was sent. "
          + "Configure the local vision model, or keep this task on a local provider.",
      };
    }
    if (proof.images.length !== images.length) {
      return {
        ok: false,
        safeError: "cloud_image_verification_incomplete",
        detail: `Verification covered ${proof.images.length} of ${images.length} images; the whole set must be checked before any of it is sent.`,
      };
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

  // The image set that actually leaves is the set that was checked. Substituting
  // the caller's original bytes here would verify one thing and send another.
  const approvedProof = hasImages ? input.pixelProof ?? null : null;
  const egressImages: ComposerProviderImage[] = approvedProof
    ? approvedProof.images.map((i) => ({
        base64: i.base64,
        mimeType: (i.mimeType === "image/png" || i.mimeType === "image/webp"
          ? i.mimeType
          : "image/jpeg") as ComposerProviderImage["mimeType"],
      }))
    : images;

  return {
    ok: true,
    cloud: true,
    systemPrompt: outSystem,
    userPrompt: outUser,
    phiCategories: categories,
    textPosture,
    // Honest only now that something looked. Without pixels there is nothing to
    // claim, and an absent proof could not have reached this line.
    pixelPosture: approvedProof ? "verified_clean" : "not_verified",
    burnedInPhiFlags,
    rawDicomExcluded: true,
    images: egressImages,
  };
}

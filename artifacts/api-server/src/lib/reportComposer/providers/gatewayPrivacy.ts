/**
 * Cloud privacy gate for composer/test-lab facades.
 * Applies equally to Qwen / DeepSeek / OpenAI before any cloud call.
 */
import { assertNoRawDicomPayload, flagPossibleBurnedInPhi, scrubPhiObject } from "./cloudPayloadPrivacy";
import type { ComposerProviderImage, ComposerProviderName } from "./types";

export type GatewayPrivacyInput = {
  provider: ComposerProviderName;
  images?: ComposerProviderImage[];
  filenames?: Array<string | null | undefined>;
  textContext?: string;
  cloudAllowed?: boolean;
  cloudVisionAllowed?: boolean;
};

export type GatewayPrivacyResult =
  | {
      ok: true;
      scrubbedTextContext: string | null;
      burnedInPhiFlags: string[];
      rawDicomExcluded: true;
      identifiersExcluded: true;
    }
  | { ok: false; safeError: string };

function isCloud(provider: ComposerProviderName): boolean {
  return provider === "qwen" || provider === "deepseek" || provider === "openai";
}

export function assertGatewayPrivacy(input: GatewayPrivacyInput): GatewayPrivacyResult {
  const images = input.images ?? [];
  const hasImages = images.length > 0;

  if (!isCloud(input.provider)) {
    return {
      ok: true,
      scrubbedTextContext: input.textContext ?? null,
      burnedInPhiFlags: [],
      rawDicomExcluded: true,
      identifiersExcluded: true,
    };
  }

  if (input.cloudAllowed === false) {
    return { ok: false, safeError: "cloud_provider_not_allowed" };
  }

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

  const scrubbed = scrubPhiObject({ text: input.textContext ?? "" });
  const scrubbedText = typeof scrubbed.text === "string" ? scrubbed.text : "";
  const burnedInPhiFlags = flagPossibleBurnedInPhi([
    scrubbedText,
    ...(input.filenames ?? []).filter((f): f is string => typeof f === "string"),
  ]);

  return {
    ok: true,
    scrubbedTextContext: scrubbedText || null,
    burnedInPhiFlags,
    rawDicomExcluded: true,
    identifiersExcluded: true,
  };
}

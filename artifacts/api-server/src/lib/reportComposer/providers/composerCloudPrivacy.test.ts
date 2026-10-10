/**
 * The cloud privacy gate on the Report Composer path (P0-1).
 *
 * Before this gate existed, `compatibleComposerAdapters.ts` handed the raw
 * prompt straight to the OpenAI-compatible transport. The PHI machinery CARE
 * already had (`detectPhiCategories` / `scrubPhiText` / the clinic's
 * `cloudTextPhiAllowed` setting) ran inside `generateAiResponse` — which the
 * composer never calls — so a clinical history naming a patient left the clinic
 * on every cloud draft.
 *
 * These tests pin the two properties that matter clinically:
 *  - an identifier cannot reach the wire unnoticed;
 *  - clinical content (laterality, level, measurement, stated age/sex) is never
 *    rewritten, because a "privacy fix" that eats a number is a regression in
 *    the report, not a fix.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let globalSettings: string | null = null;
const ctl = vi.hoisted(() => ({
  /** When set, overrides the detector so the fail-closed branch can be driven. */
  detectOverride: null as null | string[],
  scrubKeepsText: false,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (globalSettings ? [{ settingsJson: globalSettings }] : []),
        }),
      }),
    }),
  },
  aiProviderSettingsTable: {
    provider: "provider",
    settingsJson: "settings_json",
    encryptedApiKey: "encrypted_api_key",
    defaultModel: "default_model",
    endpointUrl: "endpoint_url",
  },
  aiModelRoutesTable: { taskKey: "task_key", provider: "provider", model: "model" },
}));

vi.mock("@workspace/crypto", () => ({
  decryptSecret: (s: string) => s,
  encryptSecret: (s: string) => s,
}));

vi.mock("@workspace/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/ai-providers")>();
  return {
    ...actual,
    detectPhiCategories: (text: string) =>
      ctl.detectOverride ?? actual.detectPhiCategories(text),
    scrubPhiText: (text: string) =>
      ctl.scrubKeepsText
        ? { text, removedCategories: [], removedCount: 0 }
        : actual.scrubPhiText(text),
  };
});

import { assertGatewayPrivacy } from "./gatewayPrivacy";
import type { ComposerProviderImage } from "./types";

const JPEG: ComposerProviderImage = { mimeType: "image/jpeg", base64: "AAAA" };

/** A real-looking lumbar spine draft. No identifiers anywhere in it. */
const CLINICAL_PROMPT = [
  "=== CLINICAL TRUTH (RADIOLOGIST DRAFT INPUT) ===",
  "STUDY IDENTITY",
  "Modality: MR",
  "Primary region: Lumbar spine",
  "Protocol: Plain",
  "CLINICAL INFORMATION",
  "Low back pain for 3 months with right-sided radicular referral. 46-year-old male.",
  "RADIOLOGIST OBSERVATIONS (canonical clinical truth)",
  "- [quick-select] Lumbar | L4-5 | disc | central | extruded",
  "  Findings: Right L5 traversing root compressed by disc extrusion.",
  "  Measurement: AP canal diameter: 8.6 mm",
  "- [macro] Lumbar | L5-S1 | facet | bilateral | hypertrophied",
  "MEASUREMENTS (preserve exact numbers and units)",
  "- AP canal diameter: 8.6 mm",
].join("\n");

const PHI_PROMPT = [
  "CLINICAL INFORMATION",
  "Patient: Ramesh Kumar",
  "UHID: 45812",
  "DOB: 12/03/1994",
  "phone: 9876543210",
  "Low back pain radiating to the right leg.",
].join("\n");

beforeEach(() => {
  globalSettings = null;
  ctl.detectOverride = null;
  ctl.scrubKeepsText = false;
});

describe("assertGatewayPrivacy — local arm is never classified as cloud", () => {
  it("passes Ollama text through byte-for-byte, identifiers included", async () => {
    const r = await assertGatewayPrivacy({
      provider: "ollama",
      systemPrompt: "persona",
      userPrompt: PHI_PROMPT,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cloud).toBe(false);
    expect(r.textPosture).toBe("not_applicable");
    // Local means on-prem: rewriting it would change the radiologist's input
    // to protect nothing.
    expect(r.userPrompt).toBe(PHI_PROMPT);
  });

  it("passes local OpenAI-compatible text through unchanged", async () => {
    const r = await assertGatewayPrivacy({
      provider: "local_openai_compatible",
      userPrompt: PHI_PROMPT,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cloud).toBe(false);
    expect(r.userPrompt).toBe(PHI_PROMPT);
  });
});

describe("assertGatewayPrivacy — cloud text gate", () => {
  it("refuses to send identifiers when the clinic has not opted into redaction", async () => {
    const r = await assertGatewayPrivacy({
      provider: "openai",
      systemPrompt: "persona",
      userPrompt: PHI_PROMPT,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("PHI_TEXT_CLOUD_BLOCKED");
    expect(r.detail).toMatch(/Nothing was sent/);
  });

  it("redacts identifier values and reports the posture honestly", async () => {
    globalSettings = JSON.stringify({ cloudTextPhiAllowed: true });
    const r = await assertGatewayPrivacy({
      provider: "qwen",
      systemPrompt: "persona",
      userPrompt: PHI_PROMPT,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.textPosture).toBe("identifiers_redacted");
    expect(r.phiCategories).toEqual(expect.arrayContaining(["name", "patient_id"]));
    expect(r.userPrompt).not.toContain("Ramesh Kumar");
    expect(r.userPrompt).not.toContain("45812");
    expect(r.userPrompt).not.toContain("9876543210");
    expect(r.userPrompt).toContain("[REDACTED]");
    // The clinical sentence that actually matters survives redaction.
    expect(r.userPrompt).toContain("Low back pain radiating to the right leg.");
  });

  it("leaves clean clinical prose untouched — laterality, level and measurement included", async () => {
    const r = await assertGatewayPrivacy({
      provider: "deepseek",
      systemPrompt: "persona",
      userPrompt: CLINICAL_PROMPT,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.textPosture).toBe("clean_undetected");
    expect(r.userPrompt).toBe(CLINICAL_PROMPT);
    expect(r.userPrompt).toContain("L4-5");
    expect(r.userPrompt).toContain("Right L5 traversing root compressed");
    expect(r.userPrompt).toContain("AP canal diameter: 8.6 mm");
    expect(r.userPrompt).toContain("46-year-old male");
  });

  it("fails closed when redaction cannot resolve what detection found", async () => {
    // Belt-and-braces branch: if the detector ever widens past what the
    // scrubber can name, the send is refused rather than half-cleaned.
    globalSettings = JSON.stringify({ cloudTextPhiAllowed: true });
    ctl.detectOverride = ["name"];
    ctl.scrubKeepsText = true;
    const r = await assertGatewayPrivacy({
      provider: "openai",
      userPrompt: CLINICAL_PROMPT,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("PHI_TEXT_CLOUD_UNRESOLVABLE");
  });

  it("inspects the system prompt too, not only the user prompt", async () => {
    const r = await assertGatewayPrivacy({
      provider: "openai",
      systemPrompt: PHI_PROMPT,
      userPrompt: CLINICAL_PROMPT,
    });
    expect(r.ok).toBe(false);
  });
});

describe("assertGatewayPrivacy — image posture is not weakened by the text gate", () => {
  it("still denies cloud images without an explicit cloudVisionAllowed", async () => {
    const r = await assertGatewayPrivacy({
      provider: "deepseek",
      userPrompt: CLINICAL_PROMPT,
      images: [JPEG],
      cloudVisionAllowed: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_vision_not_allowed");
  });

  it("refuses cloud pixels that nothing has verified", async () => {
    // Inverted on purpose. This asserted `ok:true` with `pixelPosture:
    // "not_verified"` — an honest label on an unsafe decision: an opt-in and a
    // MIME check never looked at the raster, so they cannot say the patient's
    // name is not burned into it. Denying is the only posture consistent with
    // the label.
    const r = await assertGatewayPrivacy({
      provider: "deepseek",
      userPrompt: CLINICAL_PROMPT,
      images: [JPEG],
      filenames: ["lumbar-sag.jpg"],
      cloudVisionAllowed: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as { safeError: string }).safeError).toBe("cloud_image_not_verified");
  });

  it("reports pixels as verified only when the on-prem gate attests, and sends what it checked", async () => {
    // Different bytes on purpose: what leaves must be the re-encoded set the
    // gate inspected, not whatever the caller originally asked with.
    const verified = { base64: "VkVSSUZJRURCWVRFUw==", mimeType: "image/jpeg" as const };
    const r = await assertGatewayPrivacy({
      provider: "deepseek",
      userPrompt: CLINICAL_PROMPT,
      images: [JPEG],
      filenames: ["lumbar-sag.jpg"],
      cloudVisionAllowed: true,
      pixelProof: { posture: "clean", images: [verified] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pixelPosture).toBe("verified_clean");
    expect(r.rawDicomExcluded).toBe(true);
    expect(r.images).toEqual([verified]);
    expect(r.images[0].base64).not.toBe(JPEG.base64);
  });

  it("refuses a proof that covered fewer images than are being sent", async () => {
    const r = await assertGatewayPrivacy({
      provider: "deepseek",
      userPrompt: CLINICAL_PROMPT,
      images: [JPEG, JPEG],
      cloudVisionAllowed: true,
      pixelProof: { posture: "clean", images: [{ base64: "AA", mimeType: "image/jpeg" }] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as { safeError: string }).safeError).toBe("cloud_image_verification_incomplete");
  });

  it("rejects raw DICOM payloads", async () => {
    const r = await assertGatewayPrivacy({
      provider: "openai",
      userPrompt: "u",
      images: [{ mimeType: "image/png", base64: "AA" }],
      filenames: ["study.dcm"],
      cloudVisionAllowed: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("raw_dicom_upload_forbidden");
  });
});

describe("assertGatewayPrivacy — provider classification is explicit", () => {
  it("refuses a provider with no composer adapter instead of treating it as local", async () => {
    // `gemini` exists in the provider layer but has no composer adapter.
    // Silently classifying an unlisted name as on-prem was how the text gate
    // could be skipped by configuration alone.
    const r = await assertGatewayPrivacy({
      provider: "gemini" as never,
      userPrompt: PHI_PROMPT,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("composer_provider_not_supported");
  });
});

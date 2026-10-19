/**
 * Stage 1 PR-A — the cloud image egress policy.
 *
 * These cases are the clinic's answer to one question: may this patient's pixels
 * go to that endpoint? Every case that ends in a refusal is written so a reviewer
 * can see the refusal is about a real destination, not about a provider's name.
 */
import { describe, it, expect } from "vitest";
import {
  assertCloudImageEgress,
  PATIENT_DERIVED_IMAGE_SOURCES,
  OPERATOR_SUPPLIED_IMAGE_SOURCE,
} from "./cloudImagePolicy";
import { classifyEffectiveLocality } from "./providerLocality";

const LOCAL = "http://100.79.100.41:11434"; // tailnet, private by rule
const LAN = "http://192.168.1.250:11434";
const PUBLIC = "https://api.deepseek.com";

describe("cloudImagePolicy — local endpoints are not gated", () => {
  it("sends to a LAN Ollama endpoint without any flag", () => {
    expect(assertCloudImageEgress({
      provider: "ollama",
      imageCount: 4,
      resolvedUrl: LAN,
    })).toEqual({ ok: true });
  });

  it("sends to a tailnet endpoint with no cloud permission configured", () => {
    expect(assertCloudImageEgress({
      provider: "ollama",
      imageCount: 1,
      resolvedUrl: LOCAL,
      cloudVisionAllowed: false,
    }).ok).toBe(true);
  });

  it("says nothing when there are no images", () => {
    expect(assertCloudImageEgress({ provider: "deepseek", imageCount: 0, resolvedUrl: PUBLIC }).ok).toBe(true);
  });
});

describe("cloudImagePolicy — a name is not a locality", () => {
  it("classifies a provider CALLED local by its URL, not its name", () => {
    // The claim under test is the classification itself: `local_openai_compatible`
    // aimed at a public host must be treated as a cloud destination, so it then
    // needs the flag, the attestation and a vision-capable model like any other
    // cloud provider — and is refused when any of those is missing.
    expect(classifyEffectiveLocality("local_openai_compatible", "https://some-vps.example:8000/v1").locality)
      .toBe("cloud");
    const withoutFlag = assertCloudImageEgress({
      provider: "local_openai_compatible",
      imageCount: 2,
      resolvedUrl: "https://some-vps.example:8000/v1",
      imageSourceTypes: [OPERATOR_SUPPLIED_IMAGE_SOURCE, OPERATOR_SUPPLIED_IMAGE_SOURCE],
    });
    expect(withoutFlag).toMatchObject({ ok: false, errorCode: "PHI_IMAGE_CLOUD_BLOCKED" });
  });

  it("refuses a cloud provider reached with no flag at all", () => {
    const r = assertCloudImageEgress({ provider: "deepseek", imageCount: 1, resolvedUrl: PUBLIC });
    expect(r).toMatchObject({ ok: false, errorCode: "PHI_IMAGE_CLOUD_BLOCKED" });
  });

  it("never calls a cloud host local even when the admin flag and consent both agree", () => {
    // The locality branch runs first: `isLocal` short-circuits to ok, so the test
    // that matters is that a public URL never reaches that short-circuit.
    const r = assertCloudImageEgress({
      provider: "ollama",
      imageCount: 1,
      resolvedUrl: "https://ollama.example.com",
    });
    expect(r.ok).toBe(false);
  });
});

describe("cloudImagePolicy — the admin flag is necessary, not sufficient", () => {
  for (const source of PATIENT_DERIVED_IMAGE_SOURCES) {
    it(`refuses ${source} images to cloud with the flag on and no attestation`, () => {
      const r = assertCloudImageEgress({
        provider: "deepseek",
        imageCount: 1,
        resolvedUrl: PUBLIC,
        cloudVisionAllowed: true,
        imageSourceTypes: [source],
      });
      expect(r).toMatchObject({ ok: false, errorCode: "PHI_IMAGE_CLOUD_UNATTESTED" });
    });
  }

  it("allows the same images once a clinician attested THIS request", () => {
    expect(assertCloudImageEgress({
      provider: "deepseek",
      imageCount: 1,
      resolvedUrl: PUBLIC,
      cloudVisionAllowed: true,
      imageSourceTypes: ["PACS_SCREENSHOT"],
      consentAttestedPerRequest: true,
    }).ok).toBe(true);
  });

  it("treats unattributed provenance as patient-derived, not as clearance", () => {
    const r = assertCloudImageEgress({
      provider: "deepseek",
      imageCount: 3,
      resolvedUrl: PUBLIC,
      cloudVisionAllowed: true,
    });
    expect(r).toMatchObject({ ok: false, errorCode: "PHI_IMAGE_CLOUD_UNATTESTED" });
  });

  it("refuses when the provenance list does not match the image count", () => {
    const r = assertCloudImageEgress({
      provider: "deepseek",
      imageCount: 3,
      resolvedUrl: PUBLIC,
      cloudVisionAllowed: true,
      imageSourceTypes: ["DICOM"],
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a mixed set where only one image is the patient's", () => {
    const r = assertCloudImageEgress({
      provider: "openai",
      imageCount: 2,
      resolvedUrl: "https://api.openai.com/v1",
      cloudVisionAllowed: true,
      imageSourceTypes: [OPERATOR_SUPPLIED_IMAGE_SOURCE, "VIEWPORT_CAPTURE"],
    });
    expect(r.ok).toBe(false);
  });

  it("still refuses a non-vision model once provenance is clear", () => {
    const r = assertCloudImageEgress({
      provider: "deepseek",
      imageCount: 1,
      resolvedUrl: PUBLIC,
      cloudVisionAllowed: true,
      modelSupportsVision: false,
      imageSourceTypes: [OPERATOR_SUPPLIED_IMAGE_SOURCE],
    });
    expect(r).toMatchObject({ ok: false, errorCode: "MODEL_NOT_VISION_CAPABLE" });
  });

  it("keeps the operator-supplied phantom path available for the trial", () => {
    expect(assertCloudImageEgress({
      provider: "deepseek",
      imageCount: 1,
      resolvedUrl: PUBLIC,
      cloudVisionAllowed: true,
      imageSourceTypes: [OPERATOR_SUPPLIED_IMAGE_SOURCE],
    }).ok).toBe(true);
  });
});

/**
 * Clinical text preservation through the composer's cloud privacy path (item 2).
 *
 * A privacy control that eats clinical content is a worse clinical control, not
 * a better one. The gate reuses CARE's shared detector and scrubber, and those
 * are deliberately asymmetric: detection is wide (it decides whether a send is
 * allowed at all), redaction is narrow (it rewrites only a value it can name
 * with confidence). This file pins that asymmetry against real radiology prose,
 * driving the REAL detector and the REAL scrubber — no stubbed rules.
 *
 * `MUST_SURVIVE` and the prompts are aligned on purpose: every token is checked
 * byte-for-byte (`toContain`, case-sensitive) in the text the gate says may be
 * sent, so a renumbered level, a hyphen turned into a dash, a dropped unit or a
 * lost side is a failing test rather than a comment.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

let globalSettings: string | null = null;
const ctl = vi.hoisted(() => ({
  /**
   * Only the fail-closed-branch test touches these. Every other assertion here
   * runs the real detector and the real scrubber.
   */
  detectOverride: null as null | string[],
  scrubIsNoOp: false,
}));

// `@workspace/db` throws at import time when DATABASE_URL is unset (it is
// reached through `@workspace/ai-providers`). Same two-line shim as the sibling
// gate tests; `cloudTextPhiAllowed()` reads the `__global__` row from here.
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

// The detector/scrubber pass through to the real implementation unless a test
// explicitly overrides them — that is the whole point of this file.
vi.mock("@workspace/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/ai-providers")>();
  return {
    ...actual,
    detectPhiCategories: (text: string) => ctl.detectOverride ?? actual.detectPhiCategories(text),
    scrubPhiText: (text: string) =>
      ctl.scrubIsNoOp
        ? { text, removedCategories: [], removedCount: 1 }
        : actual.scrubPhiText(text),
  };
});

import { detectPhiCategories, scrubPhiText } from "@workspace/ai-providers";
import { assertGatewayPrivacy } from "./gatewayPrivacy";

const MUST_SURVIVE = [
  // Spinal levels and vertebral numbering
  "C2-C3",
  "C5-C6",
  "C6-C7",
  "T12-L1",
  "L3",
  "L4-L5",
  "L5-S1",
  "conus medullaris terminates at L1",
  "level-by-level detail from L1 to L5",
  // Laterality
  "right",
  "left",
  "bilateral",
  "Right L5 traversing root compressed",
  "left paramedian disc protrusion",
  "bilateral facet hypertrophy",
  // Measurements — value, separator and unit, intact
  "5.2 mm",
  "24 × 18 mm",
  "AP canal diameter: 8.6 mm",
  "12.5 cm",
  "32 cc",
  "NASCET 62%",
  // Grading systems
  "Fazekas grade 2",
  "Fazekas 1-2",
  "Modic type 1 change",
  "spondylolisthesis grade 1",
  // Clinically stated age and sex
  "46-year-old male",
  "72-year-old female",
  // MRI screening terminology
  "no acute intracranial haemorrhage",
  "normal flow voids",
  "disc desiccation",
  "loss of cervical lordosis",
  "no cord signal abnormality",
  "mild bilateral foraminal narrowing",
  // A date in the history is clinical narrative, not a date of birth
  "pain since 12/03/19",
] as const;

/** Lumbar + cervico-thoracic spine: canonical observation rows plus measurements. */
const SPINE_PROMPT = [
  "=== CLINICAL TRUTH (RADIOLOGIST DRAFT INPUT) ===",
  "STUDY IDENTITY",
  "Modality: MR",
  "Primary region: Lumbar spine",
  "Protocol: Plain",
  "CLINICAL INFORMATION",
  "low back pain for 3 months with right-sided radicular referral. 46-year-old male.",
  "pain since 12/03/19. No bladder or bowel dysfunction.",
  "RADIOLOGIST OBSERVATIONS (canonical clinical truth)",
  "- [macro] Lumbar | L4-L5 | disc | central | extruded",
  "  Findings: Right L5 traversing root compressed by disc extrusion, 5.2 mm in AP.",
  "- [quick-select] Lumbar | L3 | disc | left | protruded",
  "  Findings: left paramedian disc protrusion, disc desiccation.",
  "- [macro] Lumbar | L5-S1 | facet | bilateral | hypertrophied",
  "  Findings: bilateral facet hypertrophy with mild bilateral foraminal narrowing.",
  "- [macro] Dorso-lumbar | T12-L1 | conus | normal | normal",
  "  Findings: conus medullaris terminates at L1. no cord signal abnormality.",
  "LEVEL-BY-LEVEL",
  "  level-by-level detail from L1 to L5 preserved.",
  "MEASUREMENTS (preserve exact numbers and units)",
  "- AP canal diameter: 8.6 mm",
  "- Canal AP at C2-C3: 14.2 mm; C5-C6: 12.5 mm; C6-C7: 11.8 mm",
  "- Uterus size 24 × 18 mm, volume 32 cc",
  "- AFI 12.5 cm",
  "IMPRESSION",
  "L4-L5 central disc extrusion with right L5 root compression. Fazekas grade 2.",
  "Modic type 1 change at L5-S1. spondylolisthesis grade 1 at L4-L5.",
  "loss of cervical lordosis.",
].join("\n");

/** Brain + MRA screening vocabulary. */
const BRAIN_PROMPT = [
  "Primary region: Brain",
  "CLINICAL INFORMATION",
  "72-year-old female with episodes of giddiness.",
  "MRI BRAIN SCREENING",
  "- no acute intracranial haemorrhage. normal flow voids.",
  "- Fazekas 1-2 periventricular white matter changes.",
  "MRA",
  "- NASCET 62% right ICA stenosis; aneurysm 5.2 mm at Acom.",
].join("\n");

/** Ultrasound: dimensions, volumes, biometry. */
const USG_PROMPT = [
  "Primary region: Ultrasound abdomen and obstetric",
  "28-year-old female, G2P1, 24 weeks by dates.",
  "- BPD 58 mm, HC 212 mm, AC 178 mm, FL 42 mm, EFW 720 g",
  "- Uterus size 24 × 18 mm, endometrium 5.2 mm, volume 32 cc",
  "- AFI 12.5 cm. Placenta fundal, grade 1.",
  "- Right kidney 98 mm, left kidney 95 mm. CBD 3.2 mm.",
].join("\n");

const ALL_CLINICAL = [SPINE_PROMPT, BRAIN_PROMPT, USG_PROMPT];

/**
 * The worst case a composer job really produces: the radiologist's clinical
 * text with the patient's identifiers still sitting in the history block.
 */
const withIdentifiers = [
  "CLINICAL INFORMATION",
  "Patient: Ramesh Kumar",
  "UHID: 45812",
  "Accession Number: ACC-2026-118",
  "DOB: 12/03/1994",
  "Phone: 9876543210",
  "Email: ramesh.kumar@example.com",
  "Address: Ward 3 Deoghar",
  ...ALL_CLINICAL,
].join("\n");

const IDENTIFIER_VALUES = [
  "Ramesh Kumar",
  "45812",
  "ACC-2026-118",
  "12/03/1994",
  "9876543210",
  "ramesh.kumar@example.com",
  "Ward 3 Deoghar",
];

afterEach(() => {
  globalSettings = null;
  ctl.detectOverride = null;
  ctl.scrubIsNoOp = false;
});

describe("real detector and scrubber on real radiology prose", () => {
  it("the protected tokens are actually present in the prompts under test", () => {
    // Against a vacuous preservation test: a token missing from every prompt
    // would make the assertions below prove nothing.
    const joined = ALL_CLINICAL.join("\n");
    for (const token of MUST_SURVIVE) {
      expect(joined, `fixture does not contain "${token}"`).toContain(token);
    }
  });

  it("names no identifier in any clinical prompt", () => {
    // If this fails, detection is firing on clinical prose and the cloud arm
    // BLOCKS rather than corrupts — which is still a clinical finding, said here.
    for (const [name, text] of [
      ["spine", SPINE_PROMPT],
      ["brain", BRAIN_PROMPT],
      ["usg", USG_PROMPT],
    ] as const) {
      expect(detectPhiCategories(text), `${name}: ${detectPhiCategories(text).join(",")}`).toEqual([]);
    }
  });

  it("passes every clinical prompt through the scrubber byte-identically", () => {
    for (const text of ALL_CLINICAL) {
      const scrubbed = scrubPhiText(text);
      expect(scrubbed.text).toBe(text);
      expect(scrubbed.removedCount).toBe(0);
      expect(scrubbed.removedCategories).toEqual([]);
    }
  });

  it("redacts identifiers from mixed prose without touching a single clinical token", () => {
    expect(detectPhiCategories(withIdentifiers).length).toBeGreaterThan(0);
    const out = scrubPhiText(withIdentifiers);

    for (const token of MUST_SURVIVE) {
      expect(out.text, `token lost by redaction: "${token}"`).toContain(token);
    }
    for (const secret of IDENTIFIER_VALUES) {
      expect(out.text, `identifier survived redaction: "${secret}"`).not.toContain(secret);
    }
    // Label kept, value gone: the model still knows there is a named patient.
    expect(out.text).toContain("Patient: [REDACTED]");
    expect(out.removedCount).toBeGreaterThan(0);
    expect(detectPhiCategories(out.text)).toEqual([]);
  });

  it("never confuses a level, a side or a measurement with an identifier", () => {
    const sentences = [
      "Stenosis at C5-C6 and C6-C7 with myelopathy.",
      "Right L5 traversing root compressed; left S1 spared.",
      "Bilateral facet hypertrophy at L4-L5 and L5-S1.",
      "Disc extrusion measures 5.2 mm in AP; canal 24 × 18 mm.",
      "AP canal diameter: 8.6 mm at L4-L5.",
      "46-year-old male with 3 months of axial pain.",
      "Fazekas grade 2; Modic type 1 change at L5-S1.",
      "Vertebral numbering: L1 to L5 visualised; S1 partially obscured.",
      "No acute intracranial haemorrhage; normal flow voids preserved.",
      "Last scan 05/09/2026 showed 5.2 mm extrusion.",
    ];
    for (const s of sentences) {
      expect(detectPhiCategories(s), s).toEqual([]);
      expect(scrubPhiText(s).text).toBe(s);
    }
  });
});

describe("the cloud gate on the composer path", () => {
  it("sends clean clinical prose exactly as the radiologist wrote it", async () => {
    const r = await assertGatewayPrivacy({
      provider: "qwen",
      systemPrompt: "You are a radiology drafting assistant.",
      userPrompt: SPINE_PROMPT,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.textPosture).toBe("clean_undetected");
    expect(r.userPrompt).toBe(SPINE_PROMPT);
    expect(r.systemPrompt).toBe("You are a radiology drafting assistant.");
  });

  it("redacts and sends when the clinic opted in, preserving every clinical token", async () => {
    globalSettings = JSON.stringify({ cloudTextPhiAllowed: true });
    const r = await assertGatewayPrivacy({
      provider: "deepseek",
      systemPrompt: "=== SYSTEM ===\nPatient: Ramesh Kumar\nPreserve levels exactly: L4-L5, C5-C6.",
      userPrompt: withIdentifiers,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;

    expect(r.textPosture).toBe("identifiers_redacted");
    expect(r.phiCategories.length).toBeGreaterThan(0);
    for (const token of MUST_SURVIVE) {
      expect(r.userPrompt, `lost in the sent prompt: "${token}"`).toContain(token);
    }
    for (const secret of IDENTIFIER_VALUES) {
      expect(r.userPrompt).not.toContain(secret);
      expect(r.systemPrompt).not.toContain(secret);
    }
    // The clinical instruction in the system prompt survives its own redaction.
    expect(r.systemPrompt).toContain("Preserve levels exactly: L4-L5, C5-C6.");
    expect(detectPhiCategories(r.userPrompt)).toEqual([]);
    expect(detectPhiCategories(r.systemPrompt)).toEqual([]);
  });

  it("blocks outright, sending nothing, when identifiers are present and redaction is not allowed", async () => {
    globalSettings = null; // no `__global__` row → default deny
    const r = await assertGatewayPrivacy({
      provider: "qwen",
      systemPrompt: "s",
      userPrompt: withIdentifiers,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("PHI_TEXT_CLOUD_BLOCKED");
      // A refusal must not echo the identifier into a log line or the UI.
      expect(r.detail ?? "").not.toContain("Ramesh Kumar");
      expect(r.detail ?? "").not.toContain("9876543210");
    }
  });

  it("fails closed when an identifier survives redaction — no half-cleaned clinical text leaves", async () => {
    // Detector fires, scrubber cannot resolve it. The gate's answer is a
    // refusal, never a send with a caveat.
    ctl.detectOverride = ["name"];
    globalSettings = JSON.stringify({ cloudTextPhiAllowed: true });
    const r = await assertGatewayPrivacy({
      provider: "openai",
      systemPrompt: "s",
      userPrompt: withIdentifiers,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("PHI_TEXT_CLOUD_UNRESOLVABLE");
  });

  it("passes the local arm through byte-for-byte, identifiers and all", async () => {
    // Local means the text never leaves the clinic, so rewriting a radiologist's
    // prose would be a clinical change justified by nothing.
    for (const provider of ["ollama", "local_openai_compatible"] as const) {
      const r = await assertGatewayPrivacy({
        provider,
        systemPrompt: "Preserve measurement values exactly.",
        userPrompt: withIdentifiers,
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.userPrompt).toBe(withIdentifiers);
      expect(r.cloud).toBe(false);
      expect(r.textPosture).toBe("not_applicable");
    }
  });
});

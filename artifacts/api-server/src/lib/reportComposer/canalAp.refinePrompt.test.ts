/**
 * Item 4 of the Composer canal brief: the structured record reaches REFINE as
 * well as Generate.
 *
 * Refine (`PROFESSIONALIZE` / `COMBINE`) answers with the report rewritten, and
 * its prompt is a JSON object rather than the Generate context block. A canal
 * diameter that lives only in the measurement grid is therefore invisible to it
 * twice over — never in the prose the instruction says to keep, and never in the
 * prompt. These cases pin the three things that have to hold: the numbers arrive
 * as data, the levels the record refuses to answer for are named so the model
 * stays off them, and a study with no canal record gets the byte-identical prompt
 * it got before.
 *
 * The mocks are the ones every `composeEngine` test needs: that module pulls in
 * the provider layer, which imports `@workspace/db` and throws at import time
 * without a DATABASE_URL.
 */
import { describe, it, expect, vi } from "vitest";

const { resolveComposerRuntime, resolveComposerProvider } = vi.hoisted(() => ({
  resolveComposerRuntime: vi.fn(),
  resolveComposerProvider: vi.fn(),
}));

vi.mock("../voiceReportComposer/runtimeConfig", () => ({ resolveComposerRuntime }));
vi.mock("../ssrf/ollamaUrlGuard", () => ({
  validateOllamaUrl: vi.fn(() => ({ ok: true as const })),
}));
vi.mock("./resolveSelectedKeyImages", () => ({
  resolveSelectedKeyImagesForCompose: vi.fn(async () => ({ ok: false, safeError: "unused" })),
}));
vi.mock("./visionCapability", () => ({
  assertVisionCapableModel: vi.fn(async () => ({ ok: true as const })),
  __resetVisionCapabilityCacheForTests: vi.fn(),
}));
vi.mock("@workspace/ai-providers", async () => {
  const actual = await vi.importActual<typeof import("@workspace/ai-providers")>(
    "@workspace/ai-providers",
  );
  return { ...actual, resolveTaskRoute: vi.fn(async () => null) };
});
vi.mock("./providers", async () => {
  const actual = await vi.importActual<typeof import("./providers")>("./providers");
  return {
    ...actual,
    resolveComposerProvider,
    assertComposerProviderPolicy: vi.fn(() => ({ ok: true as const })),
  };
});
// `@workspace/db` throws at import time without DATABASE_URL, and the provider
// layer imports it. Stubbed here so this file runs DB-less like the rest of the
// suite; nothing in `buildUserPrompt` queries.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
  aiProviderSettingsTable: {},
  aiModelRoutesTable: {},
  radiologyWorklistTable: {},
  radiologyReportDraftsTable: {},
  patientReportsTable: {},
}));
vi.mock("@workspace/crypto", () => ({
  decryptSecret: (s: string) => s,
  encryptSecret: (s: string) => s,
}));

import { STRUCTURED_JSON_ENVELOPE_KIND } from "../structuredJsonColumn";
import { canalApFromStructuredJson } from "./canonicalCanalAp";
import { buildUserPrompt } from "./composeEngine";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

const LS_SPINE = {
  kind: STRUCTURED_JSON_ENVELOPE_KIND,
  careCanalApProvenance: {
    "L1-L2": { viewerValue: 12.6 },
    "L3-L4": { viewerValue: 11.6 },
    "L4-L5": { viewerValue: 9.4, reportValue: 6.4, manualOverride: true },
  },
};

const WITH_DECLINED = {
  kind: STRUCTURED_JSON_ENVELOPE_KIND,
  careCanalApProvenance: {
    "D6-D7": { viewerValue: 11.1 },
    "D8-D9": {
      viewerValue: 10.1,
      aliasConflict: { aliasKeys: ["D8-D9", "T8-T9"], values: [10.1, 9.6] },
    },
    "L5-S1": { viewerValue: 8, staleReason: "level_renumbered" },
  },
};

function snap(findings: string): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    spineSegment: "lumbar",
    reportTitle: "MRI LS SPINE",
    technique: "Multiplanar MRI lumbar spine.",
    findings,
    impression: "",
    recommendation: "",
    observations: [],
    jobKindHint: "PROFESSIONALIZE",
  });
}

function refinePrompt(provenance: unknown, findings = "Loss of lordosis."): Record<string, unknown> {
  const prompt = buildUserPrompt(
    "PROFESSIONALIZE",
    snap(findings),
    canalApFromStructuredJson(provenance),
  );
  return JSON.parse(prompt) as Record<string, unknown>;
}

describe("Refine is handed the canonical record as data, not as prose", () => {
  it("carries level + millimetres + unit for every measured disc", () => {
    const parsed = refinePrompt(LS_SPINE);
    expect(parsed.canalApDiametersMm).toMatchObject([
      { level: "L1-L2", mm: "12.6", unit: "mm" },
      { level: "L3-L4", mm: "11.6", unit: "mm" },
      { level: "L4-L5", mm: "6.4", unit: "mm" },
    ]);
  });

  it("labels whose number it is, so an override is not re-derived", () => {
    const parsed = refinePrompt(LS_SPINE);
    const readings = parsed.canalApDiametersMm as Array<Record<string, unknown>>;
    expect(readings.map((r) => r.source)).toEqual([
      "viewer-caliper",
      "viewer-caliper",
      "radiologist-entered",
    ]);
    expect(readings[2]?.manualOverride).toBe(true);
  });

  it("names the declined levels so the rewrite stays off them", () => {
    const parsed = refinePrompt(WITH_DECLINED, "Canal assessment is limited.");
    const readings = parsed.canalApDiametersMm as Array<{ level: string }>;
    expect(parsed.canalApDeclinedLevels).toEqual(["D8-D9", "L5-S1"]);
    expect(readings.map((r) => r.level)).toEqual(["D6-D7"]);
  });

  it("adds no canal keys at all for a study with no canal record", () => {
    const withEmpty = refinePrompt(null);
    const without = JSON.parse(
      buildUserPrompt("PROFESSIONALIZE", snap("Loss of lordosis.")),
    ) as Record<string, unknown>;
    expect(withEmpty).toEqual(without);
    expect(JSON.stringify(withEmpty)).not.toContain("canalAp");
  });

  it("keeps the conservation rule that was already there", () => {
    expect(refinePrompt(LS_SPINE).conservationRule).toContain("Every measurement");
  });

  it("states that the record is read-only and must not be restated as a table", () => {
    const rule = String(refinePrompt(LS_SPINE).canalApRule ?? "");
    expect(rule).toMatch(/read-only|do not modify/i);
    expect(rule.toLowerCase()).toContain("table");
  });
});

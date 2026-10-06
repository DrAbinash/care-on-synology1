/**
 * AP canal diameters are the single most consequential numbers in a lumbar MRI,
 * and until now the composer only saw them if the rendered sentence happened to
 * repeat them. These tests pin the level→value association, the decimals, the
 * multi-level case, and the two things that must NOT change: slot identity and
 * the radiologist's protected prose.
 */
import { describe, it, expect } from "vitest";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
  measurementAlreadyInText,
} from "./buildRadiologistDraftContext";
import {
  canonicalObservationKey,
  computeSnapshotHashes,
} from "./snapshot";
import {
  parseComposerSnapshot,
  type ComposeObservation,
  type ComposerInputSnapshot,
} from "./types";

const AP_CANAL: Array<[string, string]> = [
  ["L1-L2", "12.6"],
  ["L2-L3", "13.3"],
  ["L3-L4", "11.6"],
  ["L4-L5", "7.1"],
  ["L5-S1", "8.1"],
];

function canalObservations(withProse = false): ComposeObservation[] {
  return AP_CANAL.map(([level, mm]) => ({
    concept: "canal_ap",
    source: "structured" as const,
    region: "LS Spine",
    level,
    measurement: mm,
    findingsText: withProse
      ? `At ${level}, AP canal diameter measures ${mm} mm.`
      : "Spinal canal anteroposterior diameter recorded at this level.",
  }));
}

function snap(observations: ComposeObservation[], findings = ""): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    spineSegment: "lumbar",
    reportTitle: "MRI LS SPINE",
    clinicalHistory: "Low back pain.",
    technique: "Multiplanar MRI lumbar spine.",
    findings,
    impression: "",
    recommendation: "",
    observations,
    jobKindHint: "FULL_REPORT",
  });
}

function promptFor(observations: ComposeObservation[], findings = ""): string {
  return renderRadiologistDraftContextPrompt(
    buildRadiologistDraftContext(snap(observations, findings)),
    "FULL_REPORT",
  );
}

/** The rendered block for one observation: header line + its detail lines. */
function blockFor(prompt: string, level: string): string {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l.includes(`| ${level} | canal_ap`));
  if (start < 0) return "";
  const out: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i += 1) out.push(lines[i]);
  return out.join("\n");
}

describe("AP canal measurements reach the model", () => {
  it("carries every level's value with its own level attached", () => {
    const prompt = promptFor(canalObservations());
    for (const [level, mm] of AP_CANAL) {
      const block = blockFor(prompt, level);
      expect(block).toContain(`Measurement: ${mm}`);
      expect(block).toContain(level);
    }
  });

  it("preserves decimal precision (7.1, not 7)", () => {
    const prompt = promptFor(canalObservations());
    expect(prompt).toContain("Measurement: 7.1");
    expect(prompt).not.toMatch(/Measurement: 7(?!\.)/);
    expect(prompt).toContain("Measurement: 12.6");
  });

  it("keeps all five levels distinct instead of collapsing them", () => {
    const prompt = promptFor(canalObservations());
    const measured = prompt.match(/Measurement: \d+\.\d/g) ?? [];
    expect(measured).toHaveLength(5);
    expect(new Set(measured).size).toBe(5);
  });

  it("surfaces the value even when the sentence never states it", () => {
    const obs: ComposeObservation[] = [{
      concept: "canal_stenosis",
      source: "structured",
      region: "LS Spine",
      level: "L4-L5",
      severity: "severe",
      measurement: "6.4",
      findingsText: "Severe spinal canal narrowing at this level.",
    }];
    const prompt = promptFor(obs);
    expect(prompt).toContain("Measurement: 6.4");
    expect(prompt).toContain("severe");
  });
});

describe("no duplicate prompt content", () => {
  it("does not repeat a measurement the sentence already states", () => {
    const prompt = promptFor(canalObservations(true));
    // No metadata line at all — the value is already in the prose, and the
    // existing MEASUREMENTS section still picks it up from there.
    expect(prompt).not.toContain("Measurement:");
    for (const [level, mm] of AP_CANAL) {
      const block = blockFor(prompt, level);
      expect(block).toContain(`AP canal diameter measures ${mm} mm`);
      expect(block).not.toContain("Measurement:");
    }
  });

  it("still lists prose measurements in MEASUREMENTS", () => {
    const prompt = promptFor(canalObservations(true));
    expect(prompt).toMatch(/MEASUREMENTS[\s\S]*7\.1 mm/);
  });

  it("measurementAlreadyInText matches decimals and rejects partial hits", () => {
    expect(measurementAlreadyInText("7.1", "AP canal 7.1 mm.")).toBe(true);
    expect(measurementAlreadyInText("7.1", "AP canal 7 mm.")).toBe(false);
    expect(measurementAlreadyInText("12.6", "L1-L2 12.6 mm, L2-L3 13.3 mm")).toBe(true);
    expect(measurementAlreadyInText("3/5", "no number here")).toBe(false);
    expect(measurementAlreadyInText("modic type 2", "Modic type 2 changes")).toBe(true);
  });

  it("a number buried inside a longer number does not count as stated", () => {
    // "112.6 mm" is a different measurement than "12.6" — suppressing the
    // metadata here would quietly drop the radiologist's value.
    expect(measurementAlreadyInText("12.6", "AP canal 112.6 mm.")).toBe(false);
    expect(measurementAlreadyInText("7", "canal 17 mm.")).toBe(false);
    expect(measurementAlreadyInText("7.1", "canal 7.15 mm.")).toBe(false);
  });

  it("renders the metadata anyway when only a longer number is in the prose", () => {
    const obs: ComposeObservation[] = [{
      concept: "canal_ap",
      source: "structured",
      region: "LS Spine",
      level: "L4-L5",
      measurement: "12.6",
      findingsText: "AP canal diameter 112.6 mm is impossible; re-measure.",
    }];
    const prompt = promptFor(obs);
    expect(blockFor(prompt, "L4-L5")).toContain("Measurement: 12.6");
  });

  it("attaches each level's own value when prose is missing one of them", () => {
    const mixed: ComposeObservation[] = AP_CANAL.map(([level, mm], i) => ({
      concept: "canal_ap",
      source: "structured" as const,
      region: "LS Spine",
      level,
      measurement: mm,
      findingsText: i % 2 === 0
        ? `At ${level}, AP canal diameter measures ${mm} mm.`
        : "Canal diameter recorded at this level.",
    }));
    const prompt = promptFor(mixed);
    for (const [level, mm] of AP_CANAL) {
      expect(blockFor(prompt, level)).toContain(mm);
    }
    // Only the three prose-less rows get the metadata line.
    expect((prompt.match(/Measurement:/g) ?? [])).toHaveLength(2);
  });
});

describe("measurement must not disturb what already works", () => {
  it("is NOT part of observation slot identity", () => {
    const withM = canalObservations()[3];
    const withoutM = { ...withM, measurement: undefined };
    const otherM = { ...withM, measurement: "9.9" };
    expect(canonicalObservationKey(withM)).toBe(canonicalObservationKey(withoutM));
    expect(canonicalObservationKey(withM)).toBe(canonicalObservationKey(otherM));
    expect(canonicalObservationKey(withM)).toBe("slot::ls spine|canal_ap|l4-l5|");
  });

  it("IS part of the frozen snapshot hash, so editing a value marks a draft stale", async () => {
    const before = await computeSnapshotHashes(snap(canalObservations()));
    const edited = await computeSnapshotHashes(
      snap(canalObservations().map((o) => (o.level === "L4-L5" ? { ...o, measurement: "5.8" } : o))),
    );
    expect(edited.inputHash).not.toBe(before.inputHash);
    expect(edited.reportRevision).not.toBe(before.reportRevision);
  });

  it("leaves the radiologist's protected prose byte-identical", () => {
    const findings = "There is no spondylolisthesis. Conus ends at L1-L2.";
    const ctx = buildRadiologistDraftContext(snap(canalObservations(), findings));
    expect(ctx.protectedManualText.findings).toBe(findings);
  });

  it("renders nothing extra for observations without a measurement", () => {
    const obs: ComposeObservation[] = [{
      concept: "disc_signal",
      source: "quick-select",
      region: "LS Spine",
      level: "L4-L5",
      findingsText: "Disc desiccation at L4-L5.",
    }];
    expect(promptFor(obs)).not.toContain("Measurement:");
  });
});

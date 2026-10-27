/**
 * Clinical contradiction checking — the deterministic review-time adviser.
 *
 * The owner's pick #2 for safe daily reporting (after Undo-after-Apply, PR
 * #1148): the validator BLOCKS plans that would overwrite clinician-owned
 * text, but nothing looks at what the plan SAYS. A model plan can be
 * schema-perfect, provenance-clean and fidelity-clean while its Impression
 * denies the very finding its own Findings document — the classic dangerous
 * contradiction that reaches print unless a tired radiologist catches it.
 *
 * This module's contract: WARN, never BLOCK. Every warning is advisory —
 * the radiologist reads it in the dictation thread and decides; corrections
 * are legitimate ("actually, no herniation") and must never be refused.
 * Deterministic only (word lists + concept stems): no inference, no network,
 * microseconds, testable.
 */
import { describe, expect, it } from "vitest";
import { changePlan, observation, type VoiceObservation } from "./schema";
import { checkContradictions } from "./contradictionCheck";

const FINDINGS_HERNIATION =
  "Large left paracentral disc herniation at L4-L5 contacting the traversing nerve root.";

function planWith(observations: VoiceObservation[], extra?: Parameters<typeof changePlan>[0]) {
  return changePlan({ observations, ...extra });
}

describe("impression vs findings — the classic flips", () => {
  it("warns when the Impression denies a finding the Findings document", () => {
    const plan = planWith(
      [observation({ concept: "disc_herniation", findingsText: FINDINGS_HERNIATION })],
      { impressionUpdate: "No disc herniation." },
    );
    const warnings = checkContradictions({ plan });
    const w = warnings.find((x) => x.code === "impression_negates_finding");
    expect(w, JSON.stringify(warnings)).toBeTruthy();
    expect(w!.message.toLowerCase()).toContain("herniation");
  });

  it("warns when the Impression asserts what the Findings explicitly deny", () => {
    const plan = planWith(
      [observation({ concept: "disc_herniation", findingsText: "No disc herniation at any level." })],
      { impressionUpdate: "Disc herniation present at L4-L5." },
    );
    const warnings = checkContradictions({ plan });
    expect(warnings.some((x) => x.code === "impression_affirms_negated_finding")).toBe(true);
  });

  it("does not warn when Impression and Findings agree on the negative", () => {
    const plan = planWith(
      [observation({ concept: "disc_herniation", findingsText: "No disc herniation at any level." })],
      { impressionUpdate: "No disc herniation." },
    );
    expect(checkContradictions({ plan })).toEqual([]);
  });

  it("does not warn when the Impression negative names a term the Findings never mention", () => {
    // Findings never mention infarct at all — "no acute infarct" is a
    // consistent normal negative, not a contradiction.
    const plan = planWith(
      [observation({ concept: "disc_desiccation", findingsText: "Disc desiccation at L3-L4." })],
      { impressionUpdate: "No acute infarct. No hemorrhage." },
    );
    expect(checkContradictions({ plan })).toEqual([]);
  });

  it("checks the page findings too, not only the plan's own observations", () => {
    const plan = planWith([], { impressionUpdate: "No disc herniation." });
    const warnings = checkContradictions({
      plan,
      findingsText: FINDINGS_HERNIATION,
    });
    expect(warnings.some((x) => x.code === "impression_negates_finding")).toBe(true);
  });

  it("reads the first impression candidate when no impressionUpdate is present", () => {
    const plan = planWith(
      [observation({ concept: "canal_stenosis", findingsText: "Moderate canal stenosis at L4-L5." })],
      { impressionCandidates: ["No canal stenosis."] },
    );
    expect(
      checkContradictions({ plan }).some((x) => x.code === "impression_negates_finding"),
    ).toBe(true);
  });

  it("warns when the Impression names a side the Findings never do", () => {
    const plan = planWith(
      [observation({ concept: "foraminal_stenosis", laterality: "right", findingsText: "Right neural foraminal stenosis at L4-L5." })],
      { impressionUpdate: "Left neural foraminal stenosis at L4-L5." },
    );
    const warnings = checkContradictions({ plan });
    const w = warnings.find((x) => x.code === "impression_laterality_mismatch");
    expect(w, JSON.stringify(warnings)).toBeTruthy();
  });

  it("does not warn on laterality when the Findings mention both sides", () => {
    const plan = planWith(
      [observation({ concept: "foraminal_stenosis", findingsText: "Left and right neural foraminal stenosis at L4-L5." })],
      { impressionUpdate: "Bilateral neural foraminal stenosis at L4-L5." },
    );
    expect(
      checkContradictions({ plan }).filter((x) => x.code === "impression_laterality_mismatch"),
    ).toEqual([]);
  });
});

describe("same-concept conflicts — silent supersession made visible", () => {
  const mildPrior: VoiceObservation = observation({
    concept: "canal_stenosis",
    level: "L4-L5",
    severity: "mild",
    findingsText: "Mild canal stenosis at L4-L5.",
  });

  it("warns when a new severity contradicts the prior observation for the same concept and level", () => {
    const plan = planWith([
      observation({
        concept: "canal_stenosis",
        level: "L4-L5",
        severity: "severe",
        findingsText: "Severe canal stenosis at L4-L5.",
      }),
    ]);
    const warnings = checkContradictions({ plan, priorObservations: [mildPrior] });
    const w = warnings.find((x) => x.code === "severity_conflict");
    expect(w, JSON.stringify(warnings)).toBeTruthy();
    expect(w!.message.toLowerCase()).toContain("mild");
    expect(w!.message.toLowerCase()).toContain("severe");
  });

  it("resolves synonyms before comparing — minimal and mild are the same severity", () => {
    const plan = planWith([
      observation({
        concept: "canal_stenosis",
        level: "L4-L5",
        severity: "minimal",
        findingsText: "Minimal canal stenosis at L4-L5.",
      }),
    ]);
    expect(
      checkContradictions({ plan, priorObservations: [mildPrior] }).some((x) => x.code === "severity_conflict"),
    ).toBe(false);
  });

  it("does not warn for the same severity restated, or when a severity is absent", () => {
    const plan = planWith([
      observation({
        concept: "canal_stenosis",
        level: "L4-L5",
        severity: "mild",
        findingsText: "Mild canal stenosis at L4-L5.",
      }),
    ]);
    expect(checkContradictions({ plan, priorObservations: [mildPrior] })).toEqual([]);

    const noSeverity = planWith([
      observation({ concept: "canal_stenosis", level: "L4-L5", findingsText: "Canal stenosis at L4-L5." }),
    ]);
    expect(checkContradictions({ plan: noSeverity, priorObservations: [mildPrior] })).toEqual([]);
  });

  it("compares only the same level — L3-L4 mild vs L4-L5 severe is two findings, not a conflict", () => {
    const plan = planWith([
      observation({
        concept: "canal_stenosis",
        level: "L3-L4",
        severity: "severe",
        findingsText: "Severe canal stenosis at L3-L4.",
      }),
    ]);
    expect(
      checkContradictions({ plan, priorObservations: [mildPrior] }).some((x) => x.code === "severity_conflict"),
    ).toBe(false);
  });

  it("matches concept families across spellings — lumbar_canal_stenosis vs canal_stenosis", () => {
    const plan = planWith([
      observation({
        concept: "lumbar_canal_stenosis",
        level: "L4-L5",
        severity: "severe",
        findingsText: "Severe canal stenosis at L4-L5.",
      }),
    ]);
    expect(
      checkContradictions({ plan, priorObservations: [mildPrior] }).some((x) => x.code === "severity_conflict"),
    ).toBe(true);
  });

  it("warns on a laterality flip for the same concept and level", () => {
    const prior: VoiceObservation = observation({
      concept: "foraminal_stenosis",
      level: "L4-L5",
      laterality: "left",
      findingsText: "Left foraminal stenosis at L4-L5.",
    });
    const plan = planWith([
      observation({
        concept: "foraminal_stenosis",
        level: "L4-L5",
        laterality: "right",
        findingsText: "Right foraminal stenosis at L4-L5.",
      }),
    ]);
    expect(
      checkContradictions({ plan, priorObservations: [prior] }).some((x) => x.code === "laterality_conflict"),
    ).toBe(true);
  });

  it("catches conflicts between two observations inside the same plan", () => {
    const plan = planWith([
      observation({ concept: "canal_stenosis", level: "L4-L5", severity: "mild", findingsText: "Mild canal stenosis at L4-L5." }),
      observation({ concept: "canal_stenosis", level: "L4-L5", severity: "severe", findingsText: "Severe canal stenosis at L4-L5." }),
    ]);
    expect(
      checkContradictions({ plan }).some((x) => x.code === "severity_conflict"),
    ).toBe(true);
  });
});

describe("observation field vs its own findings text", () => {
  it("warns when the laterality field disagrees with the wording", () => {
    const plan = planWith([
      observation({
        concept: "foraminal_stenosis",
        laterality: "right",
        findingsText: "Left neural foraminal stenosis at L4-L5.",
      }),
    ]);
    const warnings = checkContradictions({ plan });
    const w = warnings.find((x) => x.code === "observation_laterality_mismatch");
    expect(w, JSON.stringify(warnings)).toBeTruthy();
    expect(w!.concept).toBe("foraminal_stenosis");
  });

  it("treats a bilateral field with one-sided wording as consistent", () => {
    const plan = planWith([
      observation({
        concept: "foraminal_stenosis",
        laterality: "bilateral",
        findingsText: "Left and right neural foraminal stenosis at L4-L5.",
      }),
    ]);
    expect(
      checkContradictions({ plan }).some((x) => x.code === "observation_laterality_mismatch"),
    ).toBe(false);
  });

  it("warns when the severity field disagrees with the wording", () => {
    const plan = planWith([
      observation({
        concept: "canal_stenosis",
        severity: "mild",
        findingsText: "Severe canal stenosis at L4-L5.",
      }),
    ]);
    expect(
      checkContradictions({ plan }).some((x) => x.code === "observation_severity_mismatch"),
    ).toBe(true);
  });

  it("does not warn when the wording merely elaborates the field's severity", () => {
    const plan = planWith([
      observation({
        concept: "canal_stenosis",
        severity: "mild",
        findingsText: "Mild to moderate canal stenosis at L4-L5.",
      }),
    ]);
    expect(
      checkContradictions({ plan }).some((x) => x.code === "observation_severity_mismatch"),
    ).toBe(false);
  });
});

describe("scope and precision guards", () => {
  it("never inspects removals — a removal contradicts nothing", () => {
    const plan = planWith([
      observation({
        concept: "canal_stenosis",
        level: "L4-L5",
        severity: "severe",
        findingsText: "Severe canal stenosis at L4-L5.",
        operation: "remove",
        targetObservationId: "obs_1",
      }),
    ]);
    expect(checkContradictions({ plan, priorObservations: [] })).toEqual([]);
  });

  it("a clean plan yields no warnings", () => {
    const plan = planWith(
      [
        observation({
          concept: "disc_desiccation",
          level: "L3-L4",
          severity: "mild",
          laterality: null,
          findingsText: "Mild disc desiccation at L3-L4.",
        }),
      ],
      { impressionUpdate: "Mild disc desiccation at L3-L4." },
    );
    expect(checkContradictions({ plan, findingsText: "Normal alignment.", impressionText: "Mild disc desiccation." })).toEqual([]);
  });
});

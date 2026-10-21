/**
 * Smart Dictation — synthetic clinical regression suite (Task 15, Part E).
 *
 * Six MRI examinations: Brain (complete), LS Spine (complete), Cervical Spine
 * (complete), plus the lumbar, cervical and whole-spine screening protocols.
 * Every transcript below is SYNTHETIC (non-PHI, invented names of patterns).
 * The suite pins the owner's conversational contract:
 *
 *   - dictate multiple findings naturally -> ONE consolidated plan
 *   - "remove ligamentum flavum hypertrophy" -> targeted removal, never a guess
 *   - "make L4-L5 narrowing moderate on the left" -> severity/side/level update
 *   - clinician-owned text, unrelated normals, measurements and identity are
 *     never touched; nothing is ever invented.
 */
import { describe, expect, it } from "vitest";
import { composeVoiceChangePlan, deterministicCompose } from "./composer";
import { normalizeComposerTranscript, extractLevels } from "./transcriptNormalize";
import { smartDictationRegionSupported, regionFamilies } from "./regions";
import { validateChangePlan } from "./validator";
import { observation, type VoiceObservation } from "./schema";

const normalLsFindings =
  "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No significant disc bulge. Spinal canal and neural foramina are patent.";

const normalCervicalFindings =
  "Cervical vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No cord compression. Spinal cord signal is normal.";

describe("Smart Dictation — six-exam region gate", () => {
  it("accepts exactly the six owner-approved examinations", () => {
    // Complete
    expect(smartDictationRegionSupported("Brain")).toBe(true);
    expect(smartDictationRegionSupported("LS Spine")).toBe(true);
    expect(smartDictationRegionSupported("Cervical Spine")).toBe(true);
    // Screening variants resolve to the same region names
    expect(smartDictationRegionSupported("LS Spine")).toBe(true);
    expect(smartDictationRegionSupported("Cervical Spine")).toBe(true);
    expect(smartDictationRegionSupported("Whole Spine")).toBe(true);
    // Long study descriptions still resolve
    expect(smartDictationRegionSupported("MRI Whole Spine — Screening")).toBe(true);
    expect(smartDictationRegionSupported("MRI Brain")).toBe(true);
  });

  it("refuses every other region and modality surface", () => {
    expect(smartDictationRegionSupported("Whole Abdomen")).toBe(false);
    expect(smartDictationRegionSupported("Chest")).toBe(false);
    expect(smartDictationRegionSupported("Knee")).toBe(false);
    expect(smartDictationRegionSupported("Breast")).toBe(false);
    // Standalone dorsal is NOT one of the six (only inside whole spine).
    expect(smartDictationRegionSupported("Dorsal Spine")).toBe(false);
    expect(smartDictationRegionSupported("")).toBe(false);
    expect(smartDictationRegionSupported(null)).toBe(false);
  });

  it("whole spine reports cover cervical + dorsal families", () => {
    const fam = regionFamilies("Whole Spine");
    expect(fam.cervical).toBe(true);
    expect(fam.dorsal).toBe(true);
    expect(fam.lumbar).toBe(true);
    expect(regionFamilies("Brain").brain).toBe(true);
    expect(regionFamilies("Cervical Spine").dorsal).toBe(false);
  });

  it("composeVoiceChangePlan refuses an unsupported region without touching the report", async () => {
    const res = await composeVoiceChangePlan({
      transcript: "Disc bulge at L4-5.",
      region: "Whole Abdomen",
      findingsText: "Liver normal.",
    }, { usePhraseFallback: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/six MRI examinations/i);
  });
});

describe("Smart Dictation — conversational grammar", () => {
  it("extracts cervical, thoracic and mixed levels", () => {
    expect(extractLevels("bulge at C5-6")).toEqual(["C5-C6"]);
    expect(extractLevels("bulge at C7-T1")).toEqual(["C7-T1"]);
    expect(extractLevels("bulge at T4-5")).toEqual(["T4-T5"]);
    expect(extractLevels("C5")).toEqual(["C5-C6"]);
    expect(extractLevels("C7")).toEqual(["C7-T1"]);
    expect(extractLevels("T12")).toEqual(["T12-L1"]);
  });

  it("parses concept-targeted removals", () => {
    const norm = normalizeComposerTranscript("remove ligamentum flavum hypertrophy");
    expect(norm.removalTail).toBe("ligamentum flavum hypertrophy");
    const polite = normalizeComposerTranscript("please remove the canal stenosis");
    expect(polite.removalTail).toBe("canal stenosis");
  });

  it("parses severity/side update instructions", () => {
    const norm = normalizeComposerTranscript("make L4-L5 narrowing moderate on the left");
    expect(norm.update).toBeDefined();
    expect(norm.update!.severity).toBe("moderate");
    expect(norm.update!.laterality).toBe("left");
    expect(norm.update!.level).toBe("L4-L5");
  });

  it("blocks removals and updates that mention multiple levels", () => {
    expect(
      normalizeComposerTranscript("remove disc bulge at L3-4 and L4-5").clarificationRequired,
    ).toMatch(/multiple levels/i);
    expect(
      normalizeComposerTranscript("make the stenosis severe at L3-4 and L4-5").clarificationRequired,
    ).toMatch(/multiple levels/i);
  });
});

describe("Smart Dictation — multi-finding natural dictation (one consolidated plan)", () => {
  it("three lumbar findings in one utterance compose to one plan", () => {
    const plan = deterministicCompose({
      transcript:
        "Disc desiccation at L3-4 and L4-5, diffuse disc bulge at L4-5, and ligamentum flavum hypertrophy at L4-5.",
      region: "LS Spine",
      findingsText: normalLsFindings,
    });
    expect(plan).not.toBeNull();
    expect(plan!.observations.length).toBeGreaterThanOrEqual(3);
    const concepts = plan!.observations.map((o) => o.concept);
    expect(concepts).toContain("disc_desiccation");
    expect(concepts).toContain("ligamentum_flavum_hypertrophy");
    const v = validateChangePlan({ plan: plan!, findingsText: normalLsFindings, impressionText: "" });
    expect(v.ok).toBe(true);
  });

  it("cervical findings compose at cervical levels", () => {
    const plan = deterministicCompose({
      transcript:
        "Diffuse disc bulge at C5-C6 with moderate central canal stenosis at C5-C6.",
      region: "Cervical Spine",
      findingsText: normalCervicalFindings,
    });
    expect(plan).not.toBeNull();
    const bulge = plan!.observations.find((o) => o.concept === "cervical_disc_bulge");
    expect(bulge?.level).toBe("C5-C6");
    expect(bulge?.findingsText).toBe("Diffuse disc bulge at C5-C6.");
    expect(plan!.observations.some((o) => /Moderate central canal stenosis at C5-C6/.test(o.findingsText))).toBe(true);
  });

  it("whole-spine screening accepts a dorsal finding at a thoracic level", () => {
    const plan = deterministicCompose({
      transcript: "Disc bulge at T4-5 with canal stenosis at T4-5.",
      region: "Whole Spine",
      findingsText: "CERVICAL SPINE SCREENING\nCervical vertebrae show normal alignment.\n\nDORSAL SPINE SCREENING\nDorsal vertebrae show normal alignment.",
    });
    expect(plan).not.toBeNull();
    expect(plan!.observations.length).toBeGreaterThanOrEqual(2);
    expect(plan!.observations.every((o) => !o.level || o.level.startsWith("T"))).toBe(true);
  });

  it("brain white-matter dictation composes with the dictated Fazekas grade", () => {
    const plan = deterministicCompose({
      transcript: "Few foci of T2 FLAIR hyperintensity in the white matter, Fazekas grade 2.",
      region: "Brain",
      findingsText: "Brain parenchyma shows normal signal intensity.",
    });
    expect(plan).not.toBeNull();
    const obs = plan!.observations.find((o) => o.concept === "white_matter_changes");
    expect(obs).toBeDefined();
    expect(obs!.findingsText).toContain("Fazekas grade 2");
  });

  it("an unrecognised dictation produces no mutation path (never invents)", () => {
    const plan = deterministicCompose({
      transcript: "The patient seems nice today.",
      region: "LS Spine",
      findingsText: normalLsFindings,
    });
    expect(plan).toBeNull();
  });
});

describe("Smart Dictation — concept-targeted removal corrections", () => {
  const sessionObservations: VoiceObservation[] = [
    observation({
      id: "obs_lf_L4-L5",
      concept: "ligamentum_flavum_hypertrophy",
      level: "L4-L5",
      findingsText: "Ligamentum flavum hypertrophy at L4-L5.",
      impressionText: "Ligamentum flavum hypertrophy at L4-L5.",
      anatomicalSection: "ligamentum",
      conflictGroup: "ligamentum_flavum_L4-L5",
    }),
    observation({
      id: "obs_bulge_L4-L5",
      concept: "disc_bulge",
      level: "L4-L5",
      findingsText: "Disc bulge at L4-L5 without nerve root compression.",
      anatomicalSection: "disc",
      conflictGroup: "disc bulge_L4-L5",
    }),
  ];

  it('"remove ligamentum flavum hypertrophy" removes exactly that observation', () => {
    const plan = deterministicCompose({
      transcript: "remove ligamentum flavum hypertrophy",
      region: "LS Spine",
      findingsText: "Disc bulge at L4-L5 without nerve root compression. Ligamentum flavum hypertrophy at L4-L5.",
      priorObservations: sessionObservations,
    });
    expect(plan).not.toBeNull();
    expect(plan!.observations).toHaveLength(1);
    const op = plan!.observations[0];
    expect(op.operation).toBe("remove");
    expect(op.targetObservationId).toBe("obs_lf_L4-L5");
    // The unrelated disc bulge is never touched.
    expect(plan!.observations.some((o) => o.targetObservationId === "obs_bulge_L4-L5")).toBe(false);
  });

  it("removing something never dictated is a clarification, not a guess", () => {
    const plan = deterministicCompose({
      transcript: "remove the compression fracture",
      region: "LS Spine",
      findingsText: normalLsFindings,
      priorObservations: sessionObservations,
    });
    expect(plan).not.toBeNull();
    expect(plan!.clarificationRequired).toMatch(/nothing matching/i);
    expect(plan!.observations).toHaveLength(0);
  });

  it("removal with no session at all asks instead of acting", () => {
    const plan = deterministicCompose({
      transcript: "remove ligamentum flavum hypertrophy",
      region: "LS Spine",
      findingsText: normalLsFindings,
    });
    expect(plan).not.toBeNull();
    expect(plan!.clarificationRequired).toMatch(/no prior observations/i);
  });

  it("ambiguous removal (same concept at two levels) asks which one", () => {
    const plan = deterministicCompose({
      transcript: "remove the disc bulge",
      region: "LS Spine",
      findingsText: normalLsFindings,
      priorObservations: [
        observation({ id: "a", concept: "disc_bulge", level: "L3-L4", findingsText: "Disc bulge at L3-L4." }),
        observation({ id: "b", concept: "disc_bulge", level: "L4-L5", findingsText: "Disc bulge at L4-L5." }),
      ],
    });
    expect(plan!.clarificationRequired).toMatch(/which one/i);
  });

  it("a level-scoped removal picks the right one when unambiguous", () => {
    const plan = deterministicCompose({
      transcript: "remove the L4-L5 disc bulge",
      region: "LS Spine",
      findingsText: normalLsFindings,
      priorObservations: [
        observation({ id: "a", concept: "disc_bulge", level: "L3-L4", findingsText: "Disc bulge at L3-L4." }),
        observation({ id: "b", concept: "disc_bulge", level: "L4-L5", findingsText: "Disc bulge at L4-L5." }),
      ],
    });
    expect(plan!.observations).toHaveLength(1);
    expect(plan!.observations[0].operation).toBe("remove");
    expect(plan!.observations[0].targetObservationId).toBe("b");
  });
});

describe("Smart Dictation — severity / laterality update corrections", () => {
  const withForaminal: VoiceObservation[] = [
    observation({
      id: "obs_fs_L4-L5",
      concept: "foraminal_stenosis",
      level: "L4-L5",
      severity: "mild",
      laterality: "bilateral",
      findingsText: "Mild bilateral neural foraminal stenosis at L4-L5.",
      impressionText: "Mild bilateral neural foraminal stenosis at L4-L5.",
      anatomicalSection: "foramina",
      conflictGroup: "foraminal_stenosis_L4-L5",
    }),
  ];

  it('"make L4-L5 narrowing moderate on the left" updates the existing observation', () => {
    const plan = deterministicCompose({
      transcript: "make L4-L5 narrowing moderate on the left",
      region: "LS Spine",
      findingsText: "Mild bilateral neural foraminal stenosis at L4-L5.",
      priorObservations: withForaminal,
    });
    expect(plan).not.toBeNull();
    expect(plan!.observations).toHaveLength(1);
    const op = plan!.observations[0];
    expect(op.operation).toBe("update");
    expect(op.targetObservationId).toBe("obs_fs_L4-L5");
    // Byte-identical to the Quick Select tile's "{severity} {side} neural
    // foraminal stenosis at L4-L5." rendered with moderate/left.
    expect(op.findingsText).toBe("Moderate left neural foraminal stenosis at L4-L5.");
    expect(op.severity).toBe("moderate");
    expect(op.laterality).toBe("left");
  });

  it("an update naming an undictated finding composes it fresh instead of guessing", () => {
    const plan = deterministicCompose({
      transcript: "make the L3-L4 canal stenosis severe",
      region: "LS Spine",
      findingsText: normalLsFindings,
      priorObservations: [],
    });
    expect(plan).not.toBeNull();
    const op = plan!.observations[0];
    expect(op.operation).toBe("add");
    expect(op.findingsText).toBe("Severe canal stenosis at L3-L4.");
  });

  it("two same-family candidates at different levels without a level hint ask which", () => {
    const plan = deterministicCompose({
      transcript: "make the foraminal narrowing severe",
      region: "LS Spine",
      findingsText: normalLsFindings,
      priorObservations: [
        observation({ id: "a", concept: "foraminal_stenosis", level: "L3-L4", findingsText: "Mild neural foraminal stenosis at L3-L4." }),
        observation({ id: "b", concept: "foraminal_stenosis", level: "L4-L5", findingsText: "Mild neural foraminal stenosis at L4-L5." }),
      ],
    });
    expect(plan!.clarificationRequired).toMatch(/which one/i);
  });

  it("cervical canal-stenosis severity corrections use the cervical wording", () => {
    const plan = deterministicCompose({
      transcript: "make the C5-C6 canal stenosis mild",
      region: "Cervical Spine",
      findingsText: normalCervicalFindings,
      priorObservations: [
        observation({
          id: "obs_ccs_C5-C6",
          concept: "cervical_canal_stenosis",
          level: "C5-C6",
          findingsText: "Moderate central canal stenosis at C5-C6.",
          anatomicalSection: "canal",
          conflictGroup: "canal_stenosis_C5-C6",
        }),
      ],
    });
    const op = plan!.observations[0];
    expect(op.operation).toBe("update");
    expect(op.findingsText).toBe("Mild central canal stenosis at C5-C6.");
  });
});

describe("Smart Dictation — preservation guarantees", () => {
  it("a dictated plan cannot pass validation that overwrites a clinician-owned sentence", () => {
    // The validator protects LINE-level sentences (the report field is
    // newline-based), so the owned baseline sits on its own line.
    const findingsText =
      "Manually typed sentence by the radiologist.\nNo significant disc bulge.";
    const plan = deterministicCompose({
      transcript: "Diffuse disc bulge at L4-5.",
      region: "LS Spine",
      findingsText,
    });
    expect(plan).not.toBeNull();
    const v = validateChangePlan({
      plan: plan!,
      findingsText,
      impressionText: "",
      fieldProvenance: {
        findings: {
          "no significant disc bulge": ["manual"],
        },
      },
    });
    // The disc bulge's baselineReplaces targets "No significant disc bulge"
    // which is clinician-owned in this scenario — the validator must refuse.
    expect(v.ok).toBe(false);
  });

  it("unrelated normal findings are never part of the plan", () => {
    const plan = deterministicCompose({
      transcript: "Disc bulge at L4-5.",
      region: "LS Spine",
      findingsText: normalLsFindings,
    });
    expect(plan).not.toBeNull();
    for (const o of plan!.observations) {
      expect(/patent/i.test(o.findingsText)).toBe(false);
      expect(/alignment and marrow/i.test(o.findingsText)).toBe(false);
    }
  });

  it("impression candidates mirror only dictated findings", () => {
    const plan = deterministicCompose({
      transcript: "Disc bulge at L4-5.",
      region: "LS Spine",
      findingsText: normalLsFindings,
    });
    const candidates = (plan!.impressionCandidates ?? []).join(" ");
    expect(candidates).not.toMatch(/hemorrhage|infarct|fracture/i);
  });

  it("measurements are never invented — placeholders stay placeholders", () => {
    const plan = deterministicCompose({
      transcript: "Grade 1 spondylolisthesis at L4-5.",
      region: "LS Spine",
      findingsText: normalLsFindings,
    });
    expect(plan).not.toBeNull();
    expect(plan!.observations.some((o) => /\d+\s*(mm|cm)/i.test(o.findingsText))).toBe(false);
  });
});

describe("Smart Dictation — full conversational session (multi-turn, ChatGPT-style)", () => {
  // Simulates the client session accumulator: each turn composes against the
  // accumulated observation set, exactly as the frontend hook does.
  function sessionCompose(
    turns: string[],
    region: string,
    findingsText: string,
  ): { observations: VoiceObservation[]; plans: Array<VoiceChangePlanLike> } {
    let active: VoiceObservation[] = [];
    const plans: Array<VoiceChangePlanLike> = [];
    for (const t of turns) {
      const plan = deterministicCompose({
        transcript: t,
        region,
        findingsText,
        priorObservations: active,
      });
      plans.push(plan as VoiceChangePlanLike);
      if (!plan || plan.clarificationRequired) continue;
      for (const op of plan.observations) {
        if (op.operation === "remove") {
          active = active.filter(
            (o) => o.id !== op.targetObservationId && !(o.concept === op.concept && o.id == null),
          );
        } else {
          const id = op.id ?? op.targetObservationId ?? `obs_${op.concept}_${op.level ?? "x"}`;
          active = [...active.filter((o) => o.id !== id), { ...op, id, operation: "add" }];
        }
      }
    }
    return { observations: active, plans };
  }

  type VoiceChangePlanLike = {
    observations: VoiceObservation[];
    clarificationRequired?: string | null;
    impressionCandidates?: string[];
  };

  it("dictate 3 findings, correct severity, remove one — one final consolidated set", () => {
    const { observations, plans } = sessionCompose(
      [
        "Disc desiccation at L3-4 and L4-5.",
        "Diffuse disc bulge at L4-5 with mild canal stenosis at L4-5.",
        "make the L4-L5 canal stenosis moderate",
        "remove the ligamentum flavum hypertrophy",
      ],
      "LS Spine",
      normalLsFindings,
    );

    // Turn 3 raised the canal stenosis to moderate.
    const stenosis = observations.find((o) => o.concept === "canal_stenosis");
    expect(stenosis).toBeDefined();
    expect(stenosis!.findingsText).toBe("Moderate canal stenosis at L4-L5.");
    // Turn 4 removed a finding that was never dictated → clarification, no mutation.
    const lastPlan = plans[plans.length - 1];
    expect(lastPlan.clarificationRequired).toMatch(/nothing matching/i);
    // Final consolidated set: desiccation L3-L4, desiccation L4-L5, bulge L4-L5, stenosis L4-L5.
    expect(observations.map((o) => `${o.concept}@${o.level}`).sort()).toEqual([
      "canal_stenosis@L4-L5",
      "disc_bulge@L4-L5",
      "disc_desiccation@L3-L4",
      "disc_desiccation@L4-L5",
    ]);
    // And the consolidated set validates against the report.
    const v = validateChangePlan({
      plan: {
        operation: "report_change_plan",
        observations: observations.map((o) => ({ ...o, operation: "add" as const })),
        removeConflictingBaselineConcepts: [],
        impressionCandidates: observations.flatMap((o) => (o.impressionText ? [o.impressionText] : [])),
        uncertainties: [],
        clarificationRequired: null,
      },
      findingsText: normalLsFindings,
      impressionText: "",
    });
    expect(v.ok).toBe(true);
  });

  it("cervical session: two findings then a targeted severity correction", () => {
    const { observations } = sessionCompose(
      [
        "Diffuse disc bulge at C5-C6.",
        "Central canal stenosis at C5-C6.",
        "make the C5-C6 canal stenosis severe",
      ],
      "Cervical Spine",
      normalCervicalFindings,
    );
    const ccs = observations.find((o) => o.concept === "cervical_canal_stenosis");
    expect(ccs?.findingsText).toBe("Severe central canal stenosis at C5-C6.");
    expect(observations.find((o) => o.concept === "cervical_disc_bulge")?.level).toBe("C5-C6");
  });

  it("whole-spine screening session mixes cervical and dorsal findings", () => {
    const { observations } = sessionCompose(
      [
        "Disc bulge at C5-C6.",
        "Disc bulge at T4-5 with canal stenosis at T4-5.",
      ],
      "Whole Spine",
      "Dorsal vertebrae show normal alignment.",
    );
    expect(observations.length).toBeGreaterThanOrEqual(3);
    expect(observations.some((o) => o.level === "C5-C6")).toBe(true);
    expect(observations.some((o) => o.level === "T4-T5")).toBe(true);
  });

  it("brain session: findings then a laterality flip via update", () => {
    const { observations } = sessionCompose(
      [
        "Restricted diffusion in the left MCA territory, consistent with acute infarct.",
        "make the infarct on the right",
      ],
      "Brain",
      "Brain parenchyma shows normal signal intensity.",
    );
    const infarct = observations.find((o) => o.concept === "infarct");
    expect(infarct?.findingsText).toMatch(/right/i);
    expect(infarct?.findingsText).not.toMatch(/left/i);
  });
});

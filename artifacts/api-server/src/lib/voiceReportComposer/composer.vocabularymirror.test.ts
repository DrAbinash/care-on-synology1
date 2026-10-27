/**
 * Dream 2 — vocabulary mirror acceptance suite (Brain / LS / Cervical).
 *
 * The mirror makes every Quick Select findings tile of the owner's five
 * day-to-day examinations dictatable. Every REQUIRED case dictates a finding
 * and pins the EXACT tile sentence (the verbatim contract — what the rail
 * prints is what dictation prints). Every FORBIDDEN case pins what must
 * never happen: invented laterality ([side?] never guesses "bilateral"),
 * invented grades, duplicated findings from overlapping concepts, and
 * segment-expansion of vertebral BODY levels. All transcripts are SYNTHETIC.
 */
import { describe, expect, it } from "vitest";
import {
  composeVoiceChangePlan,
  deterministicCompose,
} from "./composer";
import { extractBodyLevels, extractLevels } from "./transcriptNormalize";
import { smartDictationRegionSupported, regionFamilies } from "./regions";
import { validateChangePlan } from "./validator";
import {
  builtInConcepts,
  catalogForPrompt,
  fillModifiersInPhrase,
} from "./phraseCatalog";
import { phraseFromRow, type SmartDictationPhraseRow } from "./customPhrases";
import type { VoiceChangePlan } from "./schema";
import type { VoiceObservation } from "./schema";

const normalBrainFindings =
  "Grey-white matter differentiation is preserved. No focal cortical or subcortical signal abnormality, mass lesion, or acute infarct identified. Ventricular system and cisternal spaces are normal in size and configuration. No midline shift.";

const normalLsFindings =
  "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No significant disc bulge. Spinal canal and neural foramina are patent.";

const normalCervicalFindings =
  "Cervical vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No cord compression. Spinal cord signal is normal.";

function composeBrain(transcript: string, prior?: VoiceObservation[]) {
  return deterministicCompose({
    transcript,
    region: "Brain",
    findingsText: normalBrainFindings,
    priorObservations: prior ?? [],
  });
}

function composeLs(transcript: string, prior?: VoiceObservation[]) {
  return deterministicCompose({
    transcript,
    region: "LS Spine",
    findingsText: normalLsFindings,
    priorObservations: prior ?? [],
  });
}

function composeCervical(transcript: string, prior?: VoiceObservation[]) {
  return deterministicCompose({
    transcript,
    region: "Cervical Spine",
    findingsText: normalCervicalFindings,
    priorObservations: prior ?? [],
  });
}

function obsByConcept(plan: VoiceChangePlan | null, concept: string): VoiceObservation | undefined {
  return plan?.observations.find((o) => o.concept === concept);
}

function assertNoTemplateLeak(plan: VoiceChangePlan | null) {
  for (const o of plan?.observations ?? []) {
    const all = `${o.findingsText} ${o.impressionText ?? ""}`;
    expect(all).not.toMatch(/\[(side\?|side|Level|severity|grade)\]/);
  }
}

describe("Dream 2 mirror — Brain tiles are dictatable (REQUIRED exact wording)", () => {
  it("left subdural hematoma prints the tile sentence verbatim", () => {
    const plan = composeBrain("There is a small left subdural hematoma.");
    expect(plan).not.toBeNull();
    const o = obsByConcept(plan, "subdural_hematoma");
    expect(o?.findingsText).toBe(
      "Crescentic extra-axial collection over the left cerebral convexity, maximum thickness ___ mm, consistent with subdural hematoma.",
    );
    expect(o?.impressionText).toBe("Left subdural hematoma.");
    expect(o?.laterality).toBe("left");
    assertNoTemplateLeak(plan);
  });

  it("subarachnoid hemorrhage prints the tile sentence verbatim", () => {
    const plan = composeBrain("Acute subarachnoid hemorrhage in the basal cisterns.");
    expect(obsByConcept(plan, "subarachnoid_hemorrhage")?.findingsText).toBe(
      "Acute subarachnoid hemorrhage — blood in the basal cisterns and sulci.",
    );
    expect(obsByConcept(plan, "subarachnoid_hemorrhage")?.impressionText).toBe(
      "Acute subarachnoid hemorrhage.",
    );
  });

  it("acute intraparenchymal hemorrhage picks up the dictated side", () => {
    const plan = composeBrain("Acute intraparenchymal hemorrhage on the right.");
    expect(obsByConcept(plan, "acute_hemorrhage")?.findingsText).toBe(
      "Acute intraparenchymal hemorrhage in the right basal ganglia with intraventricular extension. Mass effect with midline shift of ___ mm to the contralateral side.",
    );
    expect(obsByConcept(plan, "acute_hemorrhage")?.impressionText).toBe(
      "Acute right basal ganglia hemorrhage.",
    );
  });

  it("microbleeds and lacunar infarcts print their tile sentences", () => {
    const plan = composeBrain("Multiple punctate foci of susceptibility consistent with cerebral microbleeds.");
    expect(obsByConcept(plan, "microbleeds")?.impressionText).toBe("Cerebral microbleeds.");
    const plan2 = composeBrain("Lacunar infarcts in the deep white matter.");
    expect(obsByConcept(plan2, "lacunar_infarcts")?.findingsText).toBe(
      "Brain parenchyma shows multiple small lacunar cavities in the deep white matter.",
    );
    expect(obsByConcept(plan2, "lacunar_infarcts")?.impressionText).toBe("Lacunes.");
  });

  it("graded fazekas routes to the matching grade tile, never the generic template", () => {
    const plan = composeBrain("Few punctate white matter lesions, Fazekas grade 1.");
    expect(obsByConcept(plan, "fazekas_1")?.findingsText).toBe(
      "Brain parenchyma shows few punctate T2/FLAIR hyperintense lesions in the bilateral periventricular and deep white matter, Fazekas grade 1. No confluent lesions.",
    );
    expect(obsByConcept(plan, "fazekas_1")?.impressionText).toBe(
      "Mild chronic small vessel ischemic disease (Fazekas grade 1).",
    );
    // The generic [grade] template must not fire alongside the specific tile.
    expect(obsByConcept(plan, "white_matter_changes")).toBeUndefined();
    assertNoTemplateLeak(plan);

    const plan3 = composeBrain("Confluent lesions extending into the deep white matter, fazekas 3.");
    expect(obsByConcept(plan3, "fazekas_3")?.impressionText).toBe(
      "Severe chronic small vessel ischemic disease (Fazekas grade 3).",
    );
  });

  it("mass lesion, edema and aneurysm print their tile sentences with the dictated side", () => {
    const plan = composeBrain("Right frontal mass lesion.");
    expect(obsByConcept(plan, "mass_lesion")?.findingsText).toBe(
      "Brain parenchyma contains a right mass lesion with surrounding edema and mass effect.",
    );
    expect(obsByConcept(plan, "mass_lesion")?.impressionText).toBe("Right mass lesion.");

    const plan2 = composeBrain("Diffuse cerebral edema.");
    const o2 = obsByConcept(plan2, "cerebral_edema");
    expect(o2?.findingsText).toBe(
      "Brain parenchyma shows diffuse edema with effacement of the cortical sulci and basal cisterns.",
    );
    expect(o2?.impressionText).toBeFalsy(); // the tile carries no impression

    const plan3 = composeBrain("Saccular aneurysm at the left posterior communicating artery.");
    expect(obsByConcept(plan3, "aneurysm")?.impressionText).toBe(
      "Left posterior communicating artery aneurysm.",
    );
  });

  it("midline shift requires a dictated side and fills it", () => {
    const plan = composeBrain("Midline shift of 7 mm toward the left.");
    expect(obsByConcept(plan, "midline_shift")?.findingsText).toBe(
      "Midline shift of ___ mm toward the left.",
    );
    expect(obsByConcept(plan, "midline_shift")?.impressionText).toBe("Midline shift toward left.");
    // Its baseline retirement is wired, mirroring the tile.
    expect(plan?.removeConflictingBaselineConcepts).toContain("No midline shift is seen.");
  });

  it("cavernoma, AVM, contusion and DAI print their tile sentences", () => {
    expect(obsByConcept(composeBrain("Right cavernoma."), "cavernoma")?.findingsText).toBe(
      "Right cavernoma — cavernous malformation with hemosiderin rim.",
    );
    expect(obsByConcept(composeBrain("Left AVM with a nidus."), "avm")?.findingsText).toBe(
      "Left arteriovenous malformation (AVM) with nidus measuring approximately ___ cm.",
    );
    expect(obsByConcept(composeBrain("Left temporal contusion."), "contusion")?.findingsText).toBe(
      "Left cerebral contusion with an intraparenchymal hemorrhage component.",
    );
    expect(obsByConcept(composeBrain("Multiple foci of diffuse axonal injury."), "diffuse_axonal_injury")?.findingsText).toBe(
      "Multiple foci of diffuse axonal injury.",
    );
  });

  it("demyelinating lesions, hippocampal sclerosis, extra-axial collection and orbital cellulitis", () => {
    expect(obsByConcept(composeBrain("Multiple ovoid demyelinating lesions."), "demyelinating_lesion")?.impressionText).toBe(
      "Demyelinating lesions.",
    );
    expect(obsByConcept(composeBrain("Left hippocampal sclerosis."), "hippocampal_sclerosis")?.findingsText).toBe(
      "Left hippocampal sclerosis with volume loss and T2/FLAIR hyperintensity.",
    );
    const plan = composeBrain("Left extra-axial collection.");
    expect(obsByConcept(plan, "extra_axial_collection")?.findingsText).toBe(
      "Left extra-axial fluid collection with mass effect.",
    );
    expect(plan?.removeConflictingBaselineConcepts).toContain("No extra-axial collection is identified.");
    expect(obsByConcept(composeBrain("Left orbital cellulitis."), "orbital_cellulitis")?.findingsText).toBe(
      "Preseptal and postseptal inflammatory change in the left orbit, consistent with orbital cellulitis.",
    );
  });

  it("glioma recurrence prints the follow-up tile sentence verbatim", () => {
    const plan = composeBrain("Glioma recurrence on follow-up.");
    const o = obsByConcept(plan, "glioma_recurrence");
    expect(o?.findingsText).toBe(
      "Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, measuring approximately ___ × ___ × ___ cm, with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for tumor recurrence.",
    );
    expect(o?.impressionText).toBeFalsy();
  });

  it("a multi-finding brain dictation composes to one plan and validates", () => {
    const plan = composeBrain(
      "Acute infarct in the left MCA territory, few lacunar infarcts, and microbleeds.",
    );
    expect(plan).not.toBeNull();
    expect(plan!.observations.length).toBeGreaterThanOrEqual(3);
    const v = validateChangePlan({ plan: plan!, findingsText: normalBrainFindings, impressionText: "" });
    expect(v.ok).toBe(true);
  });

  it("composeVoiceChangePlan resolves a brain dictation locally (phrase fallback)", async () => {
    const res = await composeVoiceChangePlan(
      {
        transcript: "There is a right subdural hematoma.",
        region: "Brain",
        findingsText: normalBrainFindings,
      },
      { usePhraseFallback: true },
    );
    expect(res.ok).toBe(true);
    expect(res.plan?.observations.some((o) => o.concept === "subdural_hematoma")).toBe(true);
  });
});

describe("Dream 2 mirror — Brain FORBIDDEN (never-invent pins)", () => {
  it("a side-less dictation never invents bilaterality", () => {
    const plan = composeBrain("Subdural hematoma.");
    const o = obsByConcept(plan, "subdural_hematoma");
    expect(o?.findingsText).toBe(
      "Crescentic extra-axial collection over the cerebral convexity, maximum thickness ___ mm, consistent with subdural hematoma.",
    );
    expect(o?.impressionText).toBe("Subdural hematoma.");
    expect(o?.findingsText ?? "").not.toContain("bilateral");

    const plan2 = composeBrain("Cavernoma.");
    expect(obsByConcept(plan2, "cavernoma")?.findingsText).toBe(
      "Cavernoma — cavernous malformation with hemosiderin rim.",
    );
  });

  it("the V1 infarct entry no longer prints 'bilateral' for a side-less dictation", () => {
    const plan = composeBrain("Acute infarct.");
    const o = obsByConcept(plan, "infarct");
    expect(o?.findingsText).toBe(
      "Restricted diffusion in the MCA territory on DWI/ADC, consistent with acute infarct. No hemorrhagic transformation.",
    );
    expect(o?.impressionText).toBe("Acute MCA territory infarct.");
    expect(`${o?.findingsText} ${o?.impressionText}`).not.toContain("ilateral");
  });

  it("midline shift without a side asks for clarification instead of dangling wording", () => {
    expect(composeBrain("Midline shift.")).toBeNull();
    expect(composeBrain("Midline shift of 6 mm.")).toBeNull();
  });

  it("an un-graded fazekas dictation never auto-prints a grade", () => {
    expect(composeBrain("Fazekas.")).toBeNull();
    expect(composeBrain("Fazekas changes.")).toBeNull();
  });

  it("no template token ever leaks into a composed sentence", () => {
    const plan = composeBrain("Left subdural hematoma with right cavernoma and midline shift toward the left.");
    assertNoTemplateLeak(plan);
    for (const o of plan?.observations ?? []) {
      expect(o.findingsText).not.toMatch(/\{|\}/);
    }
  });
});

describe("Dream 2 mirror — LS Spine tiles (REQUIRED + body levels)", () => {
  it("reduced disc height prints the tile sentence at the dictated level", () => {
    const plan = composeLs("Disc height is reduced at L3-L4.");
    expect(obsByConcept(plan, "reduced_disc_height")?.findingsText).toBe("Disc height is reduced at L3-L4.");
    expect(obsByConcept(plan, "reduced_disc_height")?.impressionText).toBe("Reduced disc height at L3-L4.");
  });

  it("reduced disc height expands over multiple dictated levels (disc family)", () => {
    const plan = composeLs("Reduced disc height at L3-4 and L4-5.");
    const obs = plan?.observations.filter((o) => o.concept === "reduced_disc_height") ?? [];
    expect(obs.length).toBe(2);
    expect(obs.map((o) => o.level)).toEqual(["L3-L4", "L4-L5"]);
    expect(obs[1]?.findingsText).toBe("Disc height is reduced at L4-L5.");
  });

  it("schmorl node is a VERTEBRAL BODY finding — 'at L2' stays L2", () => {
    const plan = composeLs("Schmorl node at L2.");
    const o = obsByConcept(plan, "schmorl_node");
    expect(o?.level).toBe("L2");
    expect(o?.findingsText).toBe("Schmorl node at L2 vertebral endplate.");
    expect(o?.impressionText).toBe("Schmorl node at the L2 endplate.");
  });

  it("vertebral hemangioma prints the tile sentence at the dictated body", () => {
    const plan = composeLs("Vertebral hemangioma at L1.");
    expect(obsByConcept(plan, "vertebral_hemangioma")?.findingsText).toBe(
      "Vertebral hemangioma at L1 — typical T1/T2 hyperintense signal.",
    );
    expect(obsByConcept(plan, "vertebral_hemangioma")?.impressionText).toBe(
      "Typical vertebral hemangioma at L1.",
    );
  });

  it("the V1 compression fracture keeps the dictated BODY level (segment-expansion fix)", () => {
    const plan = composeLs("Compression fracture at L1.");
    const o = obsByConcept(plan, "compression_fracture");
    expect(o?.level).toBe("L1");
    expect(o?.findingsText).toBe(
      "Acute compression fracture at L1 with marrow edema on T2/STIR. Posterior wall intact.",
    );
    expect(o?.impressionText).toBe(
      "Acute compression fracture of the L1 vertebral body with marrow edema; posterior wall intact.",
    );
  });

  it("a dictated fracture PAIR keeps its pair (no shrink either way)", () => {
    const plan = composeLs("Compression fracture at L1-L2.");
    expect(obsByConcept(plan, "compression_fracture")?.level).toBe("L1-L2");
  });

  it("grade 2 spondylolisthesis prints EXACTLY ONE Grade 2 sentence", () => {
    const plan = composeLs("Grade 2 spondylolisthesis at L4-L5.");
    const listhesis = plan?.observations.filter((o) => o.concept.includes("listhesis")) ?? [];
    expect(listhesis.length).toBe(1);
    expect(listhesis[0]?.concept).toBe("lumbar_anterolisthesis");
    expect(listhesis[0]?.findingsText).toBe("Grade 2 spondylolisthesis at L4-L5.");
    expect(listhesis[0]?.impressionText).toBe("Grade 2 spondylolisthesis at L4-L5.");
  });

  it("roman 'grade II' dictation also resolves to the Grade 2 tile", () => {
    const plan = composeLs("Listhesis grade II at L4-L5.");
    const o = plan?.observations.find((x) => x.concept === "lumbar_anterolisthesis");
    expect(o?.findingsText).toBe("Grade 2 spondylolisthesis at L4-L5.");
  });

  it("spondylolisthesis without a grade keeps the Grade 1 wording (unchanged V1)", () => {
    const plan = composeLs("Spondylolisthesis at L4-L5.");
    const listhesis = plan?.observations.filter((o) => o.concept.includes("listhesis")) ?? [];
    expect(listhesis.length).toBe(1);
    expect(listhesis[0]?.findingsText).toBe("Grade 1 spondylolisthesis at L4-L5.");
  });

  it("a body finding is removable by its raw level", () => {
    const added = composeLs("Schmorl node at L2.");
    const prior = added!.observations;
    const plan = composeLs("Remove the schmorl node at L2.", prior);
    expect(plan?.observations.length).toBe(1);
    expect(plan?.observations[0]?.operation).toBe("remove");
    expect(plan?.observations[0]?.targetObservationId).toBe(prior[0]?.id);
  });
});

describe("Dream 2 mirror — Cervical Spine tiles (REQUIRED exact wording)", () => {
  it("disc extrusion prints the tile sentence at the dictated level", () => {
    const plan = composeCervical("Disc extrusion at C5-C6.");
    expect(obsByConcept(plan, "cervical_disc_extrusion")?.findingsText).toBe("Disc extrusion at C5-C6.");
    expect(obsByConcept(plan, "cervical_disc_extrusion")?.impressionText).toBe("Disc extrusion at C5-C6.");
  });

  it("burst fracture is a body finding — 'of C5' stays C5", () => {
    const plan = composeCervical("Burst fracture of C5.");
    const o = obsByConcept(plan, "cervical_burst_fracture");
    expect(o?.level).toBe("C5");
    expect(o?.findingsText).toBe(
      "Burst fracture of the C5 vertebral body with loss of posterior vertebral body height.",
    );
    expect(o?.impressionText).toBe("C5 burst fracture.");
    expect(plan?.removeConflictingBaselineConcepts).toContain(
      "Cervical vertebral bodies demonstrate normal height and marrow signal.",
    );
  });

  it("posterior element fracture and lytic lesion print their tile sentences", () => {
    const plan = composeCervical("Posterior element fracture of C6.");
    expect(obsByConcept(plan, "cervical_posterior_element_fracture")?.findingsText).toBe(
      "Fracture through the posterior elements of C6 — lamina and lateral mass.",
    );
    const plan2 = composeCervical("Lytic lesion of C2.");
    const o2 = obsByConcept(plan2, "cervical_lytic_lesion");
    expect(o2?.findingsText).toBe(
      "Focal lytic lesion of the C2 vertebral body without cortical breach.",
    );
    expect(o2?.impressionText).toBe("Lytic lesion at C2.");
  });

  it("multiple osseous lesions, OPLL, intramedullary and intradural lesions", () => {
    expect(obsByConcept(composeCervical("Multiple osseous lesions."), "cervical_multiple_osseous_lesions")?.impressionText).toBe(
      "Multiple cervical osseous lesions.",
    );
    expect(obsByConcept(composeCervical("OPLL at C5-C6."), "cervical_opll")?.findingsText).toBe(
      "Thick ossification of the posterior longitudinal ligament at C5-C6.",
    );
    const plan = composeCervical("Expansile intramedullary cervical cord lesion.");
    expect(obsByConcept(plan, "cervical_intramedullary_lesion")?.findingsText).toBe(
      "An expansile intramedullary cervical cord lesion with surrounding oedema.",
    );
    expect(plan?.removeConflictingBaselineConcepts).toContain("Cervical spinal cord signal intensity is normal.");
    expect(obsByConcept(composeCervical("Intradural extramedullary lesion."), "cervical_intradural_lesion")?.findingsText).toBe(
      "An enhancing intradural extramedullary cervical lesion with a dural tail.",
    );
  });

  it("cervical dictations validate against the normal cervical findings", () => {
    const plan = composeCervical("Disc extrusion at C5-C6 with canal stenosis at C5-C6.");
    expect(plan).not.toBeNull();
    const v = validateChangePlan({ plan: plan!, findingsText: normalCervicalFindings, impressionText: "" });
    expect(v.ok).toBe(true);
  });
});

describe("Dream 2 mirror — level extractors (disc vs body)", () => {
  it("extractLevels keeps the disc-segment expansion for disc findings", () => {
    expect(extractLevels("bulge at C5")).toEqual(["C5-C6"]);
    expect(extractLevels("bulge at L1")).toEqual(["L1-L2"]);
  });

  it("extractBodyLevels keeps the RAW vertebra for body findings", () => {
    expect(extractBodyLevels("compression fracture of L1")).toEqual(["L1"]);
    expect(extractBodyLevels("schmorl nodes at L2 and L3")).toEqual(["L2", "L3"]);
  });

  it("an explicitly dictated pair survives in both extractors", () => {
    expect(extractBodyLevels("fracture at L1-L2")).toEqual(["L1-L2"]);
    expect(extractLevels("bulge at L1-L2")).toEqual(["L1-L2"]);
  });
});

describe("Dream 2 mirror — fillModifiersInPhrase [side?] semantics", () => {
  it("fills the dictated side", () => {
    expect(fillModifiersInPhrase("[side?] subdural hematoma.", { laterality: "left" })).toBe(
      "Left subdural hematoma.",
    );
  });

  it("removes the slot when no side was dictated — never guesses", () => {
    expect(fillModifiersInPhrase("[side?] subdural hematoma.", {})).toBe("Subdural hematoma.");
    expect(fillModifiersInPhrase("Crescentic collection over the [side?] convexity", {})).toBe(
      "Crescentic collection over the convexity",
    );
    expect(fillModifiersInPhrase("over the [side?] convexity", {})).not.toContain("bilateral");
  });

  it("the legacy [side] tile default is untouched (bilateral for foraminal wording)", () => {
    expect(fillModifiersInPhrase("[severity] [side] neural foraminal stenosis at L4-L5.", {})).toBe(
      "Bilateral neural foraminal stenosis at L4-L5.",
    );
  });
});

describe("Dream 2 mirror — region gates and prompt families", () => {
  it("the screening protocols route through the same region families", () => {
    expect(smartDictationRegionSupported("MRI LS Spine — Screening")).toBe(true);
    expect(smartDictationRegionSupported("MRI Cervical Spine — Screening")).toBe(true);
    expect(regionFamilies("MRI Cervical Spine — Screening").cervical).toBe(true);
    expect(regionFamilies("MRI LS Spine — Screening").lumbar).toBe(true);
  });

  it("the brain vocabulary is prompt-visible for Brain only", () => {
    const brain = catalogForPrompt("Brain");
    expect(brain).toContain("subdural_hematoma");
    expect(brain).toContain("fazekas_1");
    expect(brain).toContain("midline_shift");
    expect(brain).not.toContain("schmorl_node");
    expect(catalogForPrompt("LS Spine")).not.toContain("subdural_hematoma");
    expect(catalogForPrompt("Cervical Spine")).not.toContain("subdural_hematoma");
  });

  it("the LS and cervical mirrors are prompt-visible for their families", () => {
    const ls = catalogForPrompt("LS Spine");
    expect(ls).toContain("schmorl_node");
    expect(ls).toContain("lumbar_anterolisthesis");
    expect(ls).toContain("reduced_disc_height");
    expect(ls).not.toContain("cervical_disc_extrusion");

    const cervical = catalogForPrompt("Cervical Spine");
    expect(cervical).toContain("cervical_disc_extrusion");
    expect(cervical).toContain("cervical_opll");
    expect(cervical).toContain("cervical_intramedullary_lesion");
    expect(cervical).not.toContain("schmorl_node");

    const whole = catalogForPrompt("Whole Spine");
    expect(whole).toContain("cervical_disc_extrusion");
    expect(whole).toContain("schmorl_node");
  });

  it("the new built-in keys stay unique and disjoint from the custom space", () => {
    const keys = builtInConcepts();
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of [
      "acute_hemorrhage", "subdural_hematoma", "epidural_hematoma", "subarachnoid_hemorrhage",
      "microbleeds", "fazekas_1", "fazekas_2", "fazekas_3", "lacunar_infarcts", "mass_lesion",
      "cerebral_edema", "midline_shift", "aneurysm", "cavernoma", "avm", "contusion",
      "diffuse_axonal_injury", "demyelinating_lesion", "hippocampal_sclerosis",
      "extra_axial_collection", "orbital_cellulitis", "glioma_recurrence",
      "reduced_disc_height", "schmorl_node", "vertebral_hemangioma", "lumbar_anterolisthesis",
      "cervical_burst_fracture", "cervical_posterior_element_fracture", "cervical_lytic_lesion",
      "cervical_multiple_osseous_lesions", "cervical_disc_extrusion", "cervical_opll",
      "cervical_intramedullary_lesion", "cervical_intradural_lesion",
    ]) {
      expect(keys).toContain(k);
    }
    // The custom-finding fixture space stays teachable (no takeover).
    expect(keys).not.toContain("tarlov_cyst");
  });
});

describe("Dream 2, pass 2 — findings sourced from the report formats (Tier A)", () => {
  it("ring-enhancing granuloma / NCC prints the format wording verbatim", () => {
    const plan = composeBrain("Ring-enhancing granuloma in the left parietal region.");
    const o = obsByConcept(plan, "ncc_granuloma");
    expect(o?.findingsText).toBe(
      "Solitary ring-enhancing lesion in the ___ (location) on post-contrast T1W images, with surrounding T2/FLAIR hyperintense perilesional edema. No restricted diffusion within the lesion on DWI/ADC.",
    );
    expect(o?.impressionText).toBe(
      "Solitary ring-enhancing lesion with perilesional edema. Imaging features suggestive of infectious/inflammatory granuloma — differential diagnosis: neurocysticercosis (NCC) / tuberculoma.",
    );
    assertNoTemplateLeak(plan);
  });

  it("tuberculoma dictation reaches the same format wording (the format's own differential)", () => {
    const plan = composeBrain("Solitary tuberculoma.");
    expect(obsByConcept(plan, "ncc_granuloma")?.impressionText).toContain("tuberculoma");
  });

  it("HIE prints the pediatric format wording verbatim", () => {
    const plan = composeBrain("Findings consistent with hypoxic ischemic encephalopathy.");
    expect(obsByConcept(plan, "hie")?.findingsText).toBe(
      "Evidence of T2W hyperintensity (CSF signal in all sequences) in bilateral fronto-parietal lobes and bilateral insular cortex with ex-vacuo dilatation of bilateral lateral ventricles. No evidence of acute infarct, hemorrhage or space-occupying mass lesion.",
    );
  });

  it("multilevel degenerative disc disease prints the format impression verbatim", () => {
    const plan = composeLs("Multilevel degenerative disc disease.");
    expect(obsByConcept(plan, "multilevel_degenerative_disc_disease")?.findingsText).toBe(
      "Multilevel lumbar degenerative disc disease with disc desiccation and mild diffuse disc bulges.",
    );
    expect(obsByConcept(plan, "multilevel_degenerative_disc_disease")?.impressionText).toBe(
      "Multilevel lumbar degenerative disc disease with disc desiccation and mild diffuse disc bulges. No canal stenosis or nerve root compression.",
    );
  });

  it("spondylodiscitis composes for the spine families, including the clinic's shorthand", () => {
    const plan = composeLs("Infective spondylodiscitis at L3-L4.");
    expect(obsByConcept(plan, "spondylodiscitis")?.findingsText).toContain(
      "suggestive of infective spondylodiscitis",
    );
    const potts = composeLs("Pott's spine.");
    expect(obsByConcept(potts, "spondylodiscitis")?.impressionText).toContain("spondylodiscitis");
    // The dorsal families gate still shows it for dorsal / whole-spine prompts.
    expect(catalogForPrompt("Whole Spine")).toContain("spondylodiscitis");
  });
});

describe("Dream 2, pass 2 — new findings (Tier B, wording flagged for owner review)", () => {
  it("an owner-taught Tarlov custom finding composes at the dictated sacral level", () => {
    // Tarlov stays the canonical OWNER-TAUGHT finding — no built-in ships for
    // it (the clinic's wording stays theirs). The sacral extractor serves the
    // custom vocabulary exactly like a built-in one.
    const tarlovRow: SmartDictationPhraseRow = {
      id: 1,
      concept: "tarlov_cyst",
      label: "Tarlov cyst",
      families: "lumbar",
      synonyms: "tarlov cyst, perineural cyst",
      findingsText: "Well-defined T2 hyperintense Tarlov cyst at [Level].",
      impressionText: "Tarlov cyst at [Level].",
      anatomicalSection: "sacrum",
      conflictGroup: "sacral_lesion",
      baselineReplaces: "The sacrum and coccyx are normal.",
      enabled: true,
    };
    const plan = deterministicCompose({
      transcript: "There is a tarlov cyst at S1.",
      region: "LS Spine",
      findingsText: normalLsFindings,
      priorObservations: [],
      customPhrases: [phraseFromRow(tarlovRow)],
    });
    const o = obsByConcept(plan, "tarlov_cyst");
    expect(o?.level).toBe("S1");
    expect(o?.findingsText).toBe("Well-defined T2 hyperintense Tarlov cyst at S1.");
    expect(o?.impressionText).toBe("Tarlov cyst at S1.");
    // And it removes by name like any built-in.
    const remove = deterministicCompose({
      transcript: "Remove the tarlov cyst.",
      region: "LS Spine",
      findingsText: normalLsFindings,
      priorObservations: plan!.observations,
      customPhrases: [phraseFromRow(tarlovRow)],
    });
    expect(remove?.observations[0]?.operation).toBe("remove");
  });

  it("transitional vertebra (Bertolotti) prints its sentence", () => {
    const plan = composeLs("Bertolotti variant at the lumbosacral junction.");
    expect(obsByConcept(plan, "lumbosacral_transitional_vertebra")?.findingsText).toBe(
      "Lumbosacral transitional vertebra (Bertolotti variant) with normal marrow signal.",
    );
  });

  it("sacroiliitis prints its sentence (the screening protocol's SI question)", () => {
    const plan = composeLs("Active sacroiliitis.");
    expect(obsByConcept(plan, "sacroiliitis")?.impressionText).toBe("Active bilateral sacroiliitis.");
  });

  it("cervical disc-osteophyte complex fills the dictated level", () => {
    const plan = composeCervical("Disc-osteophyte complex at C5-C6.");
    const o = obsByConcept(plan, "cervical_disc_osteophyte_complex");
    expect(o?.findingsText).toBe("Disc-osteophyte complex at C5-C6.");
    expect(o?.level).toBe("C5-C6");
  });

  it("facet synovial cyst fills the dictated level", () => {
    const plan = composeLs("Synovial cyst arising from the L4-L5 facet joint.");
    const o = obsByConcept(plan, "facet_synovial_cyst");
    expect(o?.level).toBe("L4-L5");
    expect(o?.findingsText).toBe(
      "Synovial cyst arising from the L4-L5 facet joint with adjacent thecal sac compression.",
    );
  });
});

describe("Dream 2 — sacral levels (the L5-S1 extractor fix)", () => {
  it("L5-S1 extracts as an explicit pair — the most common lumbar disc level", () => {
    expect(extractLevels("disc protrusion at L5-S1")).toEqual(["L5-S1"]);
  });

  it("dictating an L5-S1 disc finding fills the level (previously printed ___)", () => {
    const plan = composeLs("Posterocentral disc protrusion at L5-S1 indenting the thecal sac.");
    const o = plan?.observations.find((x) => x.concept === "disc_herniation");
    expect(o?.level).toBe("L5-S1");
    expect(o?.findingsText).toBe("Posterocentral disc protrusion at L5-S1 indenting the thecal sac.");
  });

  it("a lone S1 stays S1 — never an invented S1-S2 disc segment", () => {
    expect(extractLevels("bulge at S1")).toEqual(["S1"]);
    expect(extractBodyLevels("tarlov cyst at S1")).toEqual(["S1"]);
  });

  it("the pre-existing segment expansions are unchanged", () => {
    expect(extractLevels("bulge at L4")).toEqual(["L4-L5"]);
    expect(extractLevels("bulge at L5")).toEqual(["L5-S1"]);
    expect(extractLevels("bulge at C5")).toEqual(["C5-C6"]);
    expect(extractLevels("bulge at C7")).toEqual(["C7-T1"]);
    expect(extractLevels("bulge at T12")).toEqual(["T12-L1"]);
  });
});

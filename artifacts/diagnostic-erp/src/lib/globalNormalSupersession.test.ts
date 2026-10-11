/**
 * Global normal statements — a focal brain abnormality may not stand next to an
 * unqualified claim that the whole brain parenchyma is normal.
 *
 * The scaffold's first findings line is "Brain parenchyma shows normal signal
 * intensity with preserved grey-white differentiation." That is a
 * whole-examination statement: it speaks for every part of the parenchyma. A
 * right MCA infarct, a left basal ganglia hemorrhage and a contusion are each a
 * parenchymal lesion, so each falsifies that sentence, and a report that keeps
 * both is answering itself. Nothing in the shipped engine retired it, because
 * retirement matches a concept's aliases against the sentence already there, and
 * the infarct and hemorrhage concepts never spell "brain parenchyma" — their
 * tiles spell it "encephalomalacia", "intraparenchymal", "MCA territory".
 *
 * The fix is deliberately NOT more prose inference. It is an explicit ownership
 * contract — concept -> the whole-examination normals it supersedes — gated by
 * the rules that already govern normals (never a sentence that itself asserts
 * something abnormal) and by the study-wide test (never a sentence that speaks
 * for one side or one level). So:
 *
 *   - the global parenchyma normal goes for an intra-axial lesion;
 *   - the cerebellum, brainstem, basal ganglia, ventricular and posterior-fossa
 *     normals stay — a focal lesion says nothing about them;
 *   - an extra-axial collection, a hydrocephalus, a midline shift, an aneurysm
 *     and generalized atrophy keep it, because the parenchyma genuinely can be
 *     normal in all of those;
 *   - one abnormality can never delete another, because the supersession arm only
 *     ever claims sentences that assert nothing abnormal.
 *
 * Same oracles as the catalogue and the whole-report cases: the real content-pack
 * table, the real ownership function, the real shipped baseline manifest.
 */
import { describe, expect, it } from "vitest";
import {
  GLOBAL_NORMAL_SUPERSESSION,
  contentPackForConcept,
  globalNormalsSupersededBy,
} from "./conceptCanon/contentPacks";
import { sentenceOwnedBySlot, conceptsAssertedIn, sentenceMatchesConcept } from "./observationSlot";
import { MRI_BRAIN_STANDARD_NORMAL_MANIFEST } from "./zai-workspace/baselines/mriBrainStandardNormal";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";

const GLOBAL_PARENCHYMA =
  "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.";
const CEREBELLUM = "Cerebellar hemispheres show normal morphology and signal intensity.";
const BRAINSTEM = "Brainstem shows normal morphology and signal intensity.";
const BASAL_GANGLIA = "Basal ganglia and thalami are normal in signal intensity.";
const VENTRICLES = "Ventricular system and cisternal spaces are normal in size and configuration.";
const DWI_NORMAL = "No restricted diffusion is seen on DWI/ADC.";

/** An ownership probe carrying only what a brain tile actually supplies. */
const probe = (concept: string, laterality = "") => ({
  concept, level: "", laterality, anatomicalSection: "", baselineReplaces: "",
  supersedesGlobals: globalNormalsSupersededBy(concept),
});

/** Concepts whose lesion sits inside the brain parenchyma. Authored clinically. */
const INTRA_AXIAL = [
  "infarct", "subacute_infarct", "encephalomalacia", "diffusion", "hemorrhage",
  "lacunar", "susceptibility", "fazekas", "demyelinating_lesion", "contusion",
  "dai", "hippocampus_pattern", "cavernoma", "avm", "mass_effect", "edema",
];

/**
 * Concepts that leave the parenchyma normal standing, each for its own reason:
 * extra-axial blood and collections are outside it; ventricular size, midline
 * position and the vessels are different compartments; an aneurysm is a vascular
 * finding; generalized atrophy is a volume claim, and a parenchyma can atrophy
 * with normal signal. The last two are the study-wide normals themselves — a
 * normal-side concept must never supersede anything.
 */
const NOT_INTRA_AXIAL = [
  "subdural_hematoma", "epidural_hematoma", "subarachnoid_hemorrhage", "extra_axial",
  "intraventricular_hemorrhage", "ventricles", "cerebral_hydrocephalus", "ventriculomegaly",
  "midline", "midline_shift", "aneurysm", "cvst", "orbital", "pituitary",
  "senile_atrophy", "brain_parenchyma", "brainstem", "cerebellum", "posterior_fossa",
  "basal_ganglia", "vascular_flow_voids",
];

describe("the supersession contract is explicit data, not a word match", () => {
  it("pins exactly which concepts supersede a whole-examination normal", () => {
    // The table deletes a sentence from a signed report, so a change to it has to
    // be a reviewed decision — the same reason the registry counts concepts.
    expect(Object.keys(GLOBAL_NORMAL_SUPERSESSION).sort()).toEqual([...INTRA_AXIAL].sort());
    for (const concept of INTRA_AXIAL) {
      expect(GLOBAL_NORMAL_SUPERSESSION[concept]).toEqual(["brain_parenchyma"]);
    }
  });

  it("supersedes nothing for an extra-axial, ventricular, vascular or volume claim", () => {
    for (const concept of NOT_INTRA_AXIAL) {
      expect(globalNormalsSupersededBy(concept), concept).toEqual([]);
    }
  });

  it("keeps the contract inside the brain and away from unknown concepts", () => {
    // The territory string is what the matcher runs against, so an unregistered
    // key or territory would silently do nothing — a contract that cannot fire.
    for (const [concept, territories] of Object.entries(GLOBAL_NORMAL_SUPERSESSION)) {
      expect(contentPackForConcept(concept), `${concept} is not a registered concept`).toBeTruthy();
      for (const t of territories) {
        expect(contentPackForConcept(t), `${t} is not a registered concept`).toBeTruthy();
        expect(contentPackForConcept(t)!.regions, `${t} must be a brain concept`).toContain("brain");
      }
    }
    expect(globalNormalsSupersededBy(null)).toEqual([]);
    expect(globalNormalsSupersededBy("not_a_concept_at_all")).toEqual([]);
  });

  it("is not reachable by prose inference from a concept that sits outside the parenchyma", () => {
    // The two mechanisms have to stay separate, and the direction that can hurt
    // is this one: an extra-axial, ventricular, positional or vascular box must
    // never reach the parenchymal normal through `conceptsAssertedIn`, because
    // then supersession stops being a contract and becomes a substring hunt —
    // which is what retired unrelated anatomy before PR #926.
    let checked = 0;
    for (const tile of DEFAULT_QUICK_SELECT_TILES) {
      const t = tile as { scopeBodyPart?: string; concept?: string; sentence?: string; label?: string; category?: string };
      if (t.scopeBodyPart !== "Brain" || !t.concept || !t.sentence) continue;
      // Normal boxes restate the scaffold's own normals, so of course they name
      // the parenchyma; the guard is about abnormal boxes.
      if (t.category !== "abnormal" && t.category !== "critical") continue;
      if (INTRA_AXIAL.includes(t.concept)) continue;
      checked++;
      expect(
        conceptsAssertedIn(`${t.sentence} ${t.concept}`, t.concept),
        `${t.label} should not name the parenchyma in its own words`,
      ).not.toContain("brain_parenchyma");
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});

describe("supersession reaches the whole-examination normal and nothing else", () => {
  it("finds exactly one shipped brain baseline row for the territory", () => {
    const rows = (MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations ?? [])
      .filter((o) => o.field === "findings" && sentenceMatchesConcept(o.renderedText, "brain_parenchyma"));
    // One, and the global one. A second row that reads as study-wide parenchyma
    // would be deleted by every infarct report and nobody would notice.
    expect(rows.map((r) => r.renderedText)).toEqual([GLOBAL_PARENCHYMA]);
  });

  it("retires the global parenchyma normal for each intra-axial concept", () => {
    for (const concept of INTRA_AXIAL) {
      expect(sentenceOwnedBySlot(GLOBAL_PARENCHYMA, probe(concept)), concept).toBe(true);
    }
  });

  it("leaves every region-specific normal untouched", () => {
    // The half that matters most: a right MCA infarct says nothing about the
    // cerebellum, the brainstem, the basal ganglia or the ventricles, and this
    // change must not start claiming them.
    const REGION_ROWS = [CEREBELLUM, BRAINSTEM, BASAL_GANGLIA, VENTRICLES];
    for (const concept of INTRA_AXIAL) {
      for (const sentence of REGION_ROWS) {
        expect(sentenceOwnedBySlot(sentence, probe(concept)), `${concept} vs ${sentence}`).toBe(false);
      }
      // The sequence negative is #928's guarantee: only the concept that IS the
      // sequence may claim it, never the infarct, hemorrhage or lesion concepts
      // that merely happen to sit beside it.
      if (concept !== "diffusion") {
        expect(sentenceOwnedBySlot(DWI_NORMAL, probe(concept)), concept).toBe(false);
      }
    }
  });

  it("never claims a sentence that itself asserts an abnormality", () => {
    // Supersession must only ever reach normals. A sentence that states a lesion
    // is not a normal statement even when it shares the parenchyma with one, and
    // the two abnormal sentences below name a concept that is NOT the probing
    // concept, so nothing here is owned by identity either — replacing a
    // same-concept claim is a different rule, guarded by `overwritesAbnormalClaim`
    // and pinned by the whole-report cases (a mass eaten by the edema box).
    const abnormalSentences = [
      "Brain parenchyma contains a right mass lesion with surrounding edema and mass effect.",
      "There is encephalomalacia with gliosis in the right hemisphere.",
      "Brain parenchyma shows confluent T2/FLAIR hyperintense lesions, Fazekas grade 3.",
    ];
    for (const sentence of abnormalSentences) {
      for (const concept of ["infarct", "hemorrhage", "subacute_infarct", "contusion"]) {
        expect(sentenceOwnedBySlot(sentence, probe(concept)), `${concept} vs ${sentence}`).toBe(false);
      }
    }
  });

  it("respects laterality, so a side-specific parenchymal normal is not global", () => {
    expect(sentenceOwnedBySlot(
      "Brain parenchyma shows normal signal intensity in the left hemisphere.",
      probe("infarct", "right"),
    )).toBe(false);
    // The study-wide row names no side, so either side's lesion falsifies it.
    expect(sentenceOwnedBySlot(GLOBAL_PARENCHYMA, probe("infarct", "right"))).toBe(true);
    expect(sentenceOwnedBySlot(GLOBAL_PARENCHYMA, probe("infarct", "left"))).toBe(true);
  });

  it("a level-bearing observation cannot reach another level's sentence", () => {
    // Not refused by the supersession arm — by the level gate that has governed
    // every retirement since the cervical and dorsal catalogues were written
    // ("Disc herniation L4-L5" widening to all levels once deleted five normals).
    // It is pinned here because the new arm feeds the same `matchesConcept` the
    // gate tests: weaken the gate and a brain contract starts sweeping documents
    // it has no business touching.
    expect(sentenceOwnedBySlot(
      "L2-L3: Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
      {
        concept: "infarct", level: "L4-L5", laterality: "", anatomicalSection: "",
        baselineReplaces: "", supersedesGlobals: globalNormalsSupersededBy("infarct"),
      },
    )).toBe(false);
    // The same contract, no level, does its job.
    expect(sentenceOwnedBySlot(GLOBAL_PARENCHYMA, probe("infarct"))).toBe(true);
  });

  it("does nothing without the contract", () => {
    // Positive control for the arm itself: strip the metadata and the pre-fix
    // answer comes back, so a passing suite above cannot be resting on something
    // else that changed.
    expect(sentenceOwnedBySlot(GLOBAL_PARENCHYMA, {
      concept: "infarct", level: "", laterality: "", anatomicalSection: "", baselineReplaces: "",
    })).toBe(false);
    expect(sentenceOwnedBySlot(GLOBAL_PARENCHYMA, {
      concept: "subdural_hematoma", level: "", laterality: "", anatomicalSection: "", baselineReplaces: "",
      supersedesGlobals: globalNormalsSupersededBy("subdural_hematoma"),
    })).toBe(false);
  });
});

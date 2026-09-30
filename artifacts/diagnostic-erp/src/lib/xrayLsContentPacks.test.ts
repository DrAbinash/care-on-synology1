/**
 * X-ray LS concept registration guard (spec §1 reuse rule, and the ledger's
 * identity contract).
 *
 * Two failure modes are worth a test rather than a review comment:
 *  1. a tile emits a concept the registry does not know, so the observation
 *     cannot be reconciled, suppressed or looked up by any other CARE surface;
 *  2. a new concept id normalizes onto an OLDER pack's alias. ALIAS_INDEX maps
 *     aliases first-wins but maps each canonical id unconditionally, so such a
 *     collision silently rewrites the older pack's resolution — a regression in
 *     a file this feature does not otherwise touch. `resolveCanonicalConcept`
 *     round-tripping every LS concept is what catches that.
 */
import { describe, expect, it } from "vitest";
import { XRAY_LS_SUB_MASTERS } from "./xrayLsSubMasters";
import { LS_BASELINE_CONTRACTS } from "./xrayLsNormalAtoms";
import { contentPackForConcept, isImpressionworthyAbnormal } from "./conceptCanon/contentPacks";
import { resolveCanonicalConcept } from "./conceptCanon/conceptCanon";

const MODEL_CONCEPTS = [
  // xrayLsMeasures.ts
  "ls_height_loss_measurement",
  "ls_listhesis_measurement",
  "ls_cobb_angle",
  "ls_segmental_angulation",
  "ls_other_measurement",
  // xrayLsDynamic.ts
  "ls_dynamic_assessment",
  // xrayLsHardware.ts
  "ls_postop_hardware",
  "adjacent_segment_degeneration",
  // xrayLsNormalAtoms.ts baseline concepts
  "ls_numbering_basis",
  "ls_alignment",
  "ls_vertebral_body_height",
  "ls_disc_space",
  "ls_posterior_elements",
  "ls_l5s1_junction",
  "ls_si_joints",
  "ls_no_acute_fracture",
  "ls_no_hardware",
];

const BASELINE_CONCEPTS = [
  "ls_numbering_basis",
  "ls_alignment",
  "ls_vertebral_body_height",
  "ls_disc_space",
  "ls_posterior_elements",
  "ls_l5s1_junction",
  "ls_si_joints",
  "ls_no_acute_fracture",
  "ls_no_hardware",
];

const CATALOG_CONCEPTS = XRAY_LS_SUB_MASTERS.flatMap((sm) => sm.tiles.flatMap((t) => t.atoms.map((a) => a.concept)));
const ALL_LS_CONCEPTS = [...new Set([...CATALOG_CONCEPTS, ...MODEL_CONCEPTS])].sort();

describe("every lumbosacral radiography concept is registered", () => {
  it("knows each concept the catalog and the model builders can emit", () => {
    const unknown = ALL_LS_CONCEPTS.filter((c) => !contentPackForConcept(c));
    expect(unknown).toEqual([]);
    expect(ALL_LS_CONCEPTS.length).toBeGreaterThan(100);
  });

  it("declares each new pack for the ls spine region and XR modality", () => {
    for (const concept of ALL_LS_CONCEPTS) {
      const pack = contentPackForConcept(concept)!;
      expect(pack.regions, concept).toContain("ls spine");
      expect(pack.modalities, concept).toContain("XR");
    }
  });

  it("resolves every concept to itself (no alias shadowing)", () => {
    for (const concept of ALL_LS_CONCEPTS) {
      expect(resolveCanonicalConcept(concept), concept).toBe(concept);
    }
  });

  it("never marks a normal baseline as impression-worthy", () => {
    // The system normal impression is suppressed per concept, so a baseline that
    // registers as abnormal would delete the normal line it belongs to.
    for (const concept of BASELINE_CONCEPTS) {
      expect(isImpressionworthyAbnormal(concept), concept).toBe(false);
    }
  });

  it("marks the atoms that carry their own impression as impression-worthy", () => {
    const withImpression = XRAY_LS_SUB_MASTERS.flatMap((sm) => sm.tiles)
      .flatMap((t) => t.atoms)
      .filter(
        (a) =>
          a.impression &&
          a.role !== "baseline" &&
          !BASELINE_CONCEPTS.includes(a.concept) &&
          // Disclaimers state the limit of radiography; they keep their own
          // impression line without claiming an abnormality.
          !/_disclaimer$/.test(a.concept) &&
          a.concept !== "ls_not_assessable",
      )
      .map((a) => a.concept);
    expect(withImpression.length).toBeGreaterThan(30);
    for (const concept of [...new Set(withImpression)]) {
      expect(isImpressionworthyAbnormal(concept), concept).toBe(true);
    }
  });

  it("reuses a shared concept rather than declaring a lumbar synonym", () => {
    // adjacent_segment_degeneration predates this feature and already declares
    // ls spine + XR; re-declaring it would split observation identity per region.
    const pack = contentPackForConcept("adjacent_segment_degeneration")!;
    expect(pack.regions).toContain("cervical spine");
    expect(pack.regions).toContain("ls spine");
    expect(ALL_LS_CONCEPTS).not.toContain("ls_adjacent_segment_degeneration");
  });

  it("keeps measurement and disclaimer concepts non-impression-worthy", () => {
    // A measurement is data, and a disclaimer is a statement about limits: neither
    // is an abnormality, and neither may suppress the system normal impression.
    for (const concept of [
      "ls_height_loss_measurement",
      "ls_listhesis_measurement",
      "ls_cobb_angle",
      "ls_etiology_disclaimer",
      "ls_neoplasm_disclaimer",
      "ls_si_disclaimer",
      "ls_not_assessable",
    ]) {
      expect(isImpressionworthyAbnormal(concept), concept).toBe(false);
    }
  });

  it("keeps the baseline supersession sentences registered in prose, not ids", () => {
    // The contracts are text; this guards against a refactor silently turning
    // them into concept ids, which the store would then fail to match.
    for (const [key, sentence] of Object.entries(LS_BASELINE_CONTRACTS)) {
      expect(typeof sentence, key).toBe("string");
      expect(sentence.length, key).toBeGreaterThan(10);
    }
  });
});

/**
 * Smart Dictation custom findings — unit tests for the vocabulary compiler
 * and its merge with the built-in phrase catalog.
 *
 * Task 15 (Part E, follow-up): the doctor adds NEW findings from Settings →
 * Radiology → Voice. These tests pin the safety contract of that feature:
 *   1. a synonym is a LITERAL (escaped, case-insensitive) — punctuation or
 *      regex metacharacters in a synonym can never inject pattern code;
 *   2. a custom finding is dictatable, correctable and removable through the
 *      SAME deterministic composer paths a built-in finding uses;
 *   3. a custom finding prints exactly its stored sentence — nothing else;
 *   4. family scoping keeps a phrase out of the wrong examination;
 *   5. the two concept key spaces are disjoint (create-time guard).
 */
import { describe, it, expect } from "vitest";
import {
  escapeSynonym,
  splitCommaField,
  phraseFromRow,
  phrasesFromRows,
  type SmartDictationPhraseRow,
} from "./customPhrases";
import {
  matchCatalogPhrases,
  catalogForPrompt,
  conceptsMatchingTail,
  phraseByConcept,
  builtInConcepts,
} from "./phraseCatalog";
import { deterministicCompose } from "./composer";
import type { VoiceObservation } from "./schema";

function row(overrides: Partial<SmartDictationPhraseRow> = {}): SmartDictationPhraseRow {
  return {
    id: 1,
    concept: "tarlov_cyst",
    label: "Tarlov cyst",
    families: "lumbar",
    synonyms: "tarlov cyst, perineural cyst",
    findingsText: "Well-defined T2 hyperintense Tarlov cyst at S1.",
    impressionText: "Tarlov cyst at S1.",
    anatomicalSection: "sacrum",
    conflictGroup: "sacral_lesion",
    baselineReplaces: "The sacrum and coccyx are normal.",
    enabled: true,
    ...overrides,
  };
}

const TARLOV = phraseFromRow(row());

describe("custom phrase compilation", () => {
  it("lowercases and trims comma-separated fields, dropping empties", () => {
    expect(splitCommaField(" Tarlov Cyst , perineural cyst ,, ")).toEqual([
      "tarlov cyst",
      "perineural cyst",
    ]);
  });

  it("escapes regex metacharacters so a synonym is a literal, never code", () => {
    expect(escapeSynonym("(s1) root*.")).toBe("\\(s1\\) root\\*\\.");
    // The compiled pattern matches the literal text case-insensitively…
    expect(new RegExp(escapeSynonym("(s1) root*."), "i").test("a (S1) ROOT*. in the sacrum")).toBe(true);
    // …and a metacharacter cannot widen itself into other sentences.
    expect(new RegExp(escapeSynonym("tarlov.*cyst"), "i").test("tarlovXYZcyst")).toBe(false);
  });

  it("compiles synonyms into patterns and maps every catalog field", () => {
    expect(TARLOV.patterns).toHaveLength(2);
    expect(TARLOV.findingsText).toBe("Well-defined T2 hyperintense Tarlov cyst at S1.");
    expect(TARLOV.impressionText).toBe("Tarlov cyst at S1.");
    expect(TARLOV.anatomicalSection).toBe("sacrum");
    expect(TARLOV.conflictGroup).toBe("sacral_lesion");
    expect(TARLOV.baselineReplaces).toBe("The sacrum and coccyx are normal.");
    expect(TARLOV.families).toEqual(["lumbar"]);
  });

  it("maps empty optional fields to undefined, not blank strings", () => {
    const bare = phraseFromRow(row({ impressionText: "", anatomicalSection: "", conflictGroup: "", baselineReplaces: "" }));
    expect(bare.impressionText).toBeUndefined();
    expect(bare.anatomicalSection).toBeUndefined();
    expect(bare.conflictGroup).toBeUndefined();
    expect(bare.baselineReplaces).toBeUndefined();
  });

  it("keeps only valid families and defaults to lumbar when none parse", () => {
    expect(phraseFromRow(row({ families: "brain, lumbar, nonsense" })).families).toEqual(["brain", "lumbar"]);
    expect(phraseFromRow(row({ families: "nonsense" })).families).toEqual(["lumbar"]);
  });

  it("maps a row list through phrasesFromRows", () => {
    const list = phrasesFromRows([
      row(),
      row({ id: 2, concept: "conus_low", synonyms: "low lying conus" }),
    ]);
    expect(list.map((p) => p.concept)).toEqual(["tarlov_cyst", "conus_low"]);
  });
});

describe("custom phrases join the built-in catalog", () => {
  it("a dictated custom synonym matches with the exact stored sentence", () => {
    const hits = matchCatalogPhrases("There is a perineural cyst at S1.", [TARLOV]);
    expect(hits.some((h) => h.concept === "tarlov_cyst")).toBe(true);
    const tarlov = hits.find((h) => h.concept === "tarlov_cyst")!;
    expect(tarlov.findingsText).toBe("Well-defined T2 hyperintense Tarlov cyst at S1.");
  });

  it("built-in matching is unchanged when no extras are given", () => {
    const hits = matchCatalogPhrases("Disc desiccation at L4-L5.");
    expect(hits.some((h) => h.concept === "disc_desiccation")).toBe(true);
  });

  it("phraseByConcept resolves a custom concept and keeps built-ins authoritative", () => {
    expect(phraseByConcept("tarlov_cyst", [TARLOV])?.findingsText)
      .toBe("Well-defined T2 hyperintense Tarlov cyst at S1.");
    // A custom entry with a built-in key (only possible via manual SQL) must
    // not override the shipped wording.
    const impostor = phraseFromRow(row({ concept: "disc_bulge", findingsText: "WRONG WORDING." }));
    expect(phraseByConcept("disc_bulge", [impostor])?.findingsText)
      .toBe(phraseByConcept("disc_bulge")!.findingsText);
  });

  it("conceptsMatchingTail resolves a custom finding for conversational removal", () => {
    expect(conceptsMatchingTail("tarlov cyst", [TARLOV])).toContain("tarlov_cyst");
  });

  it("catalogForPrompt includes the custom finding only for its own family", () => {
    const lumbarBlock = catalogForPrompt("LS Spine", [TARLOV]);
    expect(lumbarBlock).toContain("tarlov_cyst: \"Well-defined T2 hyperintense Tarlov cyst at S1.\"");
    expect(catalogForPrompt("Brain", [TARLOV])).not.toContain("tarlov_cyst");
  });

  it("builtInConcepts lists the shipped keys so a create can refuse collisions", () => {
    const keys = builtInConcepts();
    expect(keys).toContain("canal_stenosis");
    expect(keys).toContain("disc_desiccation");
    expect(new Set(keys).size).toBe(keys.length); // keys are unique in the catalog
  });
});

describe("deterministicCompose with a custom vocabulary", () => {
  it("dictating a custom synonym adds EXACTLY the stored sentence", () => {
    const plan = deterministicCompose({
      transcript: "there is a tarlov cyst at S1",
      region: "LS Spine",
      modality: "MR",
      findingsText: "",
      customPhrases: [TARLOV],
    });
    expect(plan).not.toBeNull();
    expect(plan!.observations).toHaveLength(1);
    const obs = plan!.observations[0];
    expect(obs.concept).toBe("tarlov_cyst");
    expect(obs.findingsText).toBe("Well-defined T2 hyperintense Tarlov cyst at S1.");
    expect(obs.impressionText).toBe("Tarlov cyst at S1.");
    expect(obs.operation).toBe("add");
    // The baseline normal the doctor named retires through the SAME engine.
    expect(plan!.removeConflictingBaselineConcepts).toContain("The sacrum and coccyx are normal.");
  });

  it("a custom finding is removable conversationally", () => {
    const prior: VoiceObservation[] = [{
      id: "obs_tarlov_cyst",
      concept: "tarlov_cyst",
      level: "S1",
      severity: null,
      laterality: null,
      modifiers: [],
      findingsText: "Well-defined T2 hyperintense Tarlov cyst at S1.",
      impressionText: "Tarlov cyst at S1.",
      anatomicalSection: "sacrum",
      conflictGroup: "sacral_lesion",
      operation: "add",
    }];
    const plan = deterministicCompose({
      transcript: "remove tarlov cyst",
      region: "LS Spine",
      modality: "MR",
      findingsText: "",
      priorObservations: prior,
      customPhrases: [TARLOV],
    });
    expect(plan).not.toBeNull();
    expect(plan!.observations).toHaveLength(1);
    expect(plan!.observations[0].operation).toBe("remove");
    expect(plan!.observations[0].concept).toBe("tarlov_cyst");
    expect(plan!.observations[0].targetObservationId).toBe("obs_tarlov_cyst");
  });

  it("a disabled (absent) custom phrase composes nothing — no invention", () => {
    const plan = deterministicCompose({
      transcript: "there is a tarlov cyst at S1",
      region: "LS Spine",
      modality: "MR",
      findingsText: "",
    });
    expect(plan).toBeNull();
  });

  it("a built-in and a custom finding can be dictated in one sentence", () => {
    const plan = deterministicCompose({
      transcript: "mild diffuse disc bulge at L4-L5 and a tarlov cyst at S1",
      region: "LS Spine",
      modality: "MR",
      findingsText: "",
      customPhrases: [TARLOV],
    });
    expect(plan).not.toBeNull();
    const concepts = plan!.observations.map((o) => o.concept);
    expect(concepts).toContain("disc_bulge");
    expect(concepts).toContain("tarlov_cyst");
    // The built-in sentence is the tile's wording, unchanged.
    const bulge = plan!.observations.find((o) => o.concept === "disc_bulge")!;
    expect(bulge.findingsText).toBe("Disc bulge at L4-L5 without nerve root compression.");
  });
});

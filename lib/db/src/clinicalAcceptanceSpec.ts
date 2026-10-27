/**
 * CLINICAL ACCEPTANCE SPECIFICATION — care-v4 Stage B hardening, §5 of the architectural brief.
 *
 * WHAT THIS IS
 * ------------
 * The twenty cases the future composer must satisfy, written as data so that its own completeness
 * can be tested (see clinicalAcceptanceSpec.test.ts) rather than asserted in prose. It is a
 * specification, not a passing suite: no case here has been executed, because there is nothing to
 * execute it against — the deterministic composer does not exist yet, and the v4 catalogue tables
 * are dormant with no clinical content migrated into them (deliberately: §6 of the brief forbids a
 * content migration in Stage B).
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a source of clinical wording. Every expectation is written as a structural property of
 * the report — which observations appear, in which field, retired by whom, in which order, and what
 * must not change when the click order changes. Where a case genuinely needs a *sentence* (the
 * consolidated Fazekas-and-atrophy line, the gallstones-without-cholecystitis negative), the case
 * is marked `awaiting-radiologist-review` and quotes nothing, because inventing clinical prose to
 * make a test pass is precisely the failure the brief forbids and the one this review has caught
 * three times in shipped code.
 *
 * THE BINDING
 * -----------
 * Each case names the Stage B contract it discharges. That is what makes this file the acceptance
 * test for the hardening work rather than a wish list: if a contract has no case, the contract is
 * untested; if a case names no contract, it is decoration. The test suite checks both directions.
 */

/** The three states a clinical sentence can honestly be in. Nothing here is 'ratified' yet. */
export type WordingStatus = "structural-only" | "awaiting-radiologist-review" | "ratified";

/**
 * The only status a case may hold while there is no composer. Widening this union is a Stage C
 * act, and clinicalAcceptanceSpec.test.ts refuses a case that claims anything else.
 */
export type CaseStatus = "specified-not-executed";

export type AcceptanceCase = {
  id: string;
  title: string;
  examination: string;
  /** What the radiologist does, in plain terms. No catalogue row is named, because none is seeded. */
  selection: readonly string[];
  /** Structural properties of the printed report. Never a sentence. */
  expected: readonly string[];
  /** Which fields of the report the case constrains. */
  fields: readonly ("findings" | "impression" | "recommendation" | "technique" | "identity")[];
  /** The Stage B contract this case discharges, by the name the hardening work uses. */
  discharges: readonly string[];
  wording: WordingStatus;
  wordingNote: string;
  /** Prose the case would need. Empty until a radiologist has approved it — see the test. */
  quotedSentences?: readonly string[];
  /** What has to exist before this case can be executed. */
  blockedBy: readonly string[];
  status: CaseStatus;
};

const BLOCKERS = ["a deterministic composer (Stage C)", "a seeded catalogue for the examination"] as const;

export const CLINICAL_ACCEPTANCE_CASES: readonly AcceptanceCase[] = [
  {
    id: "T1",
    title: "Normal MRI Brain",
    examination: "MRI Brain",
    selection: ["select nothing abnormal — the examination is a normal brain"],
    expected: [
      "every baseline normal the published catalogue declares for the examination prints, once each",
      "no abnormality sentence appears, so no normal is retired",
      "the Recommendations section is omitted, not printed as 'No recommendations.'",
      "Findings and Impression are composed with no model call",
    ],
    fields: ["findings", "impression", "recommendation"],
    discharges: ["selection state A", "selection state F restore set is empty", "gate check 5 emit_policy omission", "snapshot domain normalSlots"],
    wording: "structural-only",
    wordingNote: "The normal sentences themselves are the catalogue's, and seeding them is a content act awaiting review.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T2",
    title: "Subarachnoid hemorrhage",
    examination: "MRI Brain",
    selection: ["select subarachnoid hemorrhage"],
    expected: [
      "the hemorrhage observation prints in Findings at its anatomical position",
      "the baseline normal it contradicts is retired by that tile's replacement edge, and no other normal is",
      "the Impression states the hemorrhage",
      "a second, unrelated normal sentence the tile does not retire still prints",
    ],
    fields: ["findings", "impression"],
    discharges: ["selection state F", "gate check 4 and 10", "the restore set is the edge set"],
    wording: "awaiting-radiologist-review",
    wordingNote: "Which normals a hemorrhage retires across the parenchyma, ventricles and sulci is a radiologist's anatomy call; the shipped brain tiles retire a set this spec must not guess at.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T3",
    title: "Fazekas I plus cerebral atrophy",
    examination: "MRI Brain",
    selection: ["select Fazekas grade 1", "select mild age-related cerebral atrophy"],
    expected: [
      "both anatomical observations remain in Findings as separate sentences in section order",
      "the Impression is ONE consolidated line, not the two member impressions concatenated",
      "the consolidation is driven by a target_field='impression' rule with suppress_members=TRUE",
      "no recommendation is emitted that the catalogue did not declare",
    ],
    fields: ["findings", "impression"],
    discharges: ["§3 field scoping: combining Impressions must not suppress the Findings they rest on", "combination rule ordinal precedence", "snapshot domain combinationRules with members"],
    wording: "awaiting-radiologist-review",
    wordingNote: "The owner's Fazekas case is the reason the table exists. The consolidated sentence is the clinical claim, so it is the radiologist's wording, not a fixture's.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T4",
    title: "Hydrocephalus",
    examination: "MRI Brain",
    selection: ["select hydrocephalus"],
    expected: [
      "the ventricular baseline normal is retired and the parenchymal baseline still prints",
      "the tile's own sentences appear in Findings under the ventricular section",
      "a declared recommendation rule whose trigger this selection satisfies emits once",
    ],
    fields: ["findings", "impression", "recommendation"],
    discharges: ["selection state F", "the nine-pair register entry Normal ventricles <> Hydrocephalus", "gate check 15 for the advice trigger"],
    wording: "structural-only",
    wordingNote: "The advice text belongs to the seeded catalogue, not to this spec.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T5",
    title: "Glioma recurrence plus cerebral edema",
    examination: "MRI Brain (post-operative)",
    selection: ["select glioma recurrence", "select cerebral edema", "in either order"],
    expected: [
      "both observations print, whichever was clicked first",
      "neither selection evicts the other: the shipped defect this case pins is one abnormal silently deleting a second, unrelated abnormal",
      "the pair's resolution is the declared one, read from the catalogue, not from the merge order",
    ],
    fields: ["findings", "impression"],
    discharges: ["selection state D (declared 'coexists', both directions)", "gate check 6", "PR #1014 register pair nine"],
    wording: "awaiting-radiologist-review",
    wordingNote: "Whether edema is stated beside the recurrence or folded into the tumour line is the radiologist's opinion; the mechanism declares coexistence as the conservative default and this spec keeps the wording open.",
    blockedBy: [...BLOCKERS, "the register pair's clinical wording approved"],
    status: "specified-not-executed",
  },
  {
    id: "T6",
    title: "MRI lumbar L4-L5 disc pathology",
    examination: "MRI Lumbar Spine",
    selection: ["select an L4-L5 disc finding"],
    expected: [
      "the observation prints under the L4-L5 level, and the level label comes from the placement's section and ordinal",
      "the normals for levels the radiologist did not select are unaffected",
      "the findings order is the anatomical order, not alphabetical and not insertion order",
    ],
    fields: ["findings"],
    discharges: ["selection state A", "gate checks 1 and 9 (unresolved ordering)", "snapshot domains sections and placements"],
    wording: "structural-only",
    wordingNote: "Sentence-level disc prose is catalogue content and is not quoted here.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T7",
    title: "Multiple lumbar abnormalities",
    examination: "MRI Lumbar Spine",
    selection: ["select abnormalities at L3-L4 and L5-S1", "in either order"],
    expected: [
      "both findings print, and swapping the click order changes no word and no position",
      "one abnormality retiring a baseline does not retire the other level's baseline unless its own edge says so",
      "an impression-field consolidation, if declared, leaves both findings sentences in place",
    ],
    fields: ["findings", "impression"],
    discharges: ["§2 click-order independence", "§3 field scoping", "the restore set is per edge"],
    wording: "structural-only",
    wordingNote: "The expectations are about which observations survive, which is a structural fact.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T8",
    title: "Cervical spinal canal measurements",
    examination: "MRI Cervical Spine",
    selection: ["enter a canal measurement at one level", "select the stenosis tile at another"],
    expected: [
      "the entered number, unit and level survive verbatim into Findings — the system formats, it does not restate",
      "no measurement is invented, imputed, averaged or carried over from another level",
      "re-opening the report reproduces the same measurement text",
    ],
    fields: ["findings", "identity"],
    discharges: ["gate check 11 versus the runtime's own required-parameter fact", "snapshot domain parameters", "the brief's rule that the radiologist controls the observations"],
    wording: "structural-only",
    wordingNote: "This case deliberately quotes no value: a specification that invented a measurement would be the exact defect §5 forbids.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T9",
    title: "Bilateral lower-limb DVT",
    examination: "USG Lower Limb Venous Doppler",
    selection: ["select the right-sided finding", "select the left-sided finding"],
    expected: [
      "both sides print with their laterality intact and neither folds into a single undifferentiated sentence",
      "two anatomically distinct baselines retired by one tile's edge set stay distinguishable",
      "the report names one examination, one patient and one study identity",
    ],
    fields: ["findings", "impression", "identity"],
    discharges: ["selection state D", "gate check 5 (a member must be placed)", "duplicate logical normal slots cannot exist"],
    wording: "structural-only",
    wordingNote: "Laterality is carried by the tile's slot fields, which the snapshot freezes.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T10",
    title: "Gallstones without cholecystitis",
    examination: "USG Abdomen",
    selection: ["select cholelithiasis", "do not select any wall-thickening or pericholecystic finding"],
    expected: [
      "the negative observation the radiologist did NOT select never appears as text",
      "the impression states the stones and asserts no inflammation because nothing else was selected, not because a template said so",
      "requires_only_members is evaluated against the selection, so an added cholecystitis finding changes which rule fires",
    ],
    fields: ["findings", "impression"],
    discharges: ["combination rule requires_only_members", "selection state A versus E", "the brief's rule that AI must remain optional"],
    wording: "awaiting-radiologist-review",
    wordingNote: "The absent-cholecystitis sentence is a clinical assertion about a negative; the spec states the mechanism and leaves the wording to review.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T11",
    title: "Brain lesion plus independently directed shift",
    examination: "MRI Brain",
    selection: ["select a focal lesion", "state a midline shift independently"],
    expected: [
      "the shift prints once, whichever of the two observations produced it",
      "deselecting the lesion does not silently delete a shift the radiologist stated on its own",
      "the dependency between the two is resolved in the field each one writes, not by rewriting the other",
    ],
    fields: ["findings", "impression"],
    discharges: ["§3 field scoping", "selection state E parent-child", "gate check 13 (no cycle)"],
    wording: "structural-only",
    wordingNote: "The shipped defect class this pins is a derived statement that outlives, or overwrites, the independent one.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T12",
    title: "Tile deselection and restoration",
    examination: "any",
    selection: ["select a tile that retires two normals", "deselect it", "select a second tile that shares one of those normals"],
    expected: [
      "deselecting restores exactly the normals the deselected tile retired, and no others",
      "where two tiles retire the same normal, deselecting one leaves it retired by the other",
      "the restore set is a SELECT over clinical_tile_normal_replacements, never a text match",
    ],
    fields: ["findings", "impression"],
    discharges: ["selection state B", "the edge table is the only suppression mechanism", "no baseline_replaces column exists on a tile"],
    wording: "structural-only",
    wordingNote: "This is the mechanism case: the prose is the catalogue's.",
    blockedBy: [...BLOCKERS, "a study-level selection ledger (Stage C)"],
    status: "specified-not-executed",
  },
  {
    id: "T13",
    title: "Manual text protection",
    examination: "any",
    selection: ["let the system compose a field", "type over that field", "select or deselect another tile"],
    expected: [
      "the edited text is preserved, and no combination or suppression rule re-runs across it",
      "the override is stored beside the study, not as a catalogue edit",
      "the report still records what the catalogue produced, so the override is auditable",
    ],
    fields: ["findings", "impression"],
    discharges: ["selection state G", "the signed-report mutation boundary in the live ERP", "gate check 8 (reviewed wording stays in the catalogue)"],
    wording: "structural-only",
    wordingNote: "The content of the override is the radiologist's own words by definition.",
    blockedBy: [...BLOCKERS, "a study-level override record (Stage C)"],
    status: "specified-not-executed",
  },
  {
    id: "T14",
    title: "Same selection, different click order",
    examination: "MRI Brain",
    selection: ["one selection, entered in every permutation the UI allows"],
    expected: [
      "the report is byte-identical across permutations for a compatible selection",
      "for a mutually exclusive pair, the end state is the declared one and the click order only changes which tile is selected, never what the selected set means",
      "PR #1014's register of nine order-dependent pairs is empty when this case passes",
    ],
    fields: ["findings", "impression", "recommendation"],
    discharges: ["the whole §2 selection-state contract", "gate checks 6 and 7", "conflict resolution kept separate from anatomical order"],
    wording: "structural-only",
    wordingNote: "This case is the acceptance test for the nine measured defects, so it quotes no sentence — it compares two outputs against each other.",
    blockedBy: [...BLOCKERS, "the register emptied"],
    status: "specified-not-executed",
  },
  {
    id: "T15",
    title: "Multiple compatible abnormalities",
    examination: "MRI Brain",
    selection: ["select three findings that share no conflict group and declare nothing between them"],
    expected: [
      "all three print: the default for an undeclared pair is to state both and evict neither",
      "their order is the anatomical order from the placements, not the order they were clicked",
      "nothing in the catalogue is inferred from the absence of a relationship row",
    ],
    fields: ["findings"],
    discharges: ["the stated limit of gate check 7 — cross-group undeclared pairs", "selection state D versus an undeclared pair"],
    wording: "structural-only",
    wordingNote: "The conservative default is a runtime rule; this file records it so Stage C cannot choose a different one by accident.",
    blockedBy: [...BLOCKERS, "the composer's default documented"],
    status: "specified-not-executed",
  },
  {
    id: "T16",
    title: "Mutually exclusive severity grades",
    examination: "MRI Brain",
    selection: ["select Fazekas 1", "then select Fazekas 3"],
    expected: [
      "exactly one grade survives in the report",
      "which one survives is declared by an 'excludes' pair in both directions, not by the visit order",
      "the normals the losing grade retired are re-evaluated against the surviving selection",
    ],
    fields: ["findings", "impression"],
    discharges: ["selection state C", "gate check 6 (a one-directional symmetric pair is refused)", "PR #1014 register pairs two through six"],
    wording: "structural-only",
    wordingNote: "Grade semantics are already the shipped catalogue's; the case is about the mechanism choosing between them.",
    blockedBy: BLOCKERS,
    status: "specified-not-executed",
  },
  {
    id: "T17",
    title: "Undo and redo",
    examination: "any",
    selection: ["compose a report", "undo a selection", "redo it"],
    expected: [
      "the report is a pure function of the selection, so redo reproduces the state before undo exactly",
      "no field is left holding a contribution whose source observation is gone, and none is missing a contribution whose source is back",
    ],
    fields: ["findings", "impression"],
    discharges: ["the determinism principle the content hash exists to certify", "selection states A, B and F together"],
    wording: "structural-only",
    wordingNote: "Two renderings are compared to each other, not to prose.",
    blockedBy: [...BLOCKERS, "an undo ledger that stores selections rather than sentences"],
    status: "specified-not-executed",
  },
  {
    id: "T18",
    title: "Report re-opening and rehydration",
    examination: "any",
    selection: ["sign a report", "reload the workspace", "compare before and after"],
    expected: [
      "every field is byte-identical after rehydration — the defect class this pins is a field lost between save and reopen",
      "the report cites the publication it was composed from, and the frozen snapshot reproduces it",
      "the measurement, technique and laterality the radiologist entered come back unchanged",
    ],
    fields: ["findings", "impression", "technique", "identity"],
    discharges: ["§1 the complete publication snapshot", "the ten domains and their identities", "restore round-trip proven in clinicalCatalogue.db.test.ts"],
    wording: "structural-only",
    wordingNote: "Rehydration is compared against the earlier rendering, which is the honest oracle.",
    blockedBy: [...BLOCKERS, "a publisher/restore writer (deliberately absent in Stage B)"],
    status: "specified-not-executed",
  },
  {
    id: "T19",
    title: "Draft versus published catalogue",
    examination: "any",
    selection: ["edit the live catalogue after a report was composed from publication P"],
    expected: [
      "the edited draft content is inert: a report composed from P prints what P froze",
      "the live catalogue may hold incomplete and unreviewed rows that P could never have contained, and editing them is allowed",
      "the gate refuses an unplaced rule, an unresolved conflict pair and an unreviewed sentence at publication only — never while drafting",
    ],
    fields: ["identity"],
    discharges: ["the three-layer split in the publication-validation contract", "append-only publications", "content_hash and catalogue_snapshot"],
    wording: "structural-only",
    wordingNote: "This is the case that keeps the draft editor usable, so it is asserted against the gate, not against a report.",
    blockedBy: [...BLOCKERS, "a read path that resolves a report to its publication"],
    status: "specified-not-executed",
  },
  {
    id: "T20",
    title: "No AI dependency",
    examination: "any",
    selection: ["compose every case above with AI disabled and no model reachable"],
    expected: [
      "every deterministic case above produces the same report with the model unavailable, unconfigured or failing",
      "no AI artefact is required to sign, to print, or to rehydrate a report",
      "an AI suggestion that was never accepted leaves no sentence, and one that was accepted is recorded as accepted rather than silently merged into the catalogue",
    ],
    fields: ["findings", "impression", "recommendation"],
    discharges: ["the brief's final principle that AI must remain optional", "the snapshot's independence from any model output"],
    wording: "structural-only",
    wordingNote: "The case is an absence assertion, which is why it needs no clinical prose.",
    blockedBy: [...BLOCKERS, "the composer keeping its deterministic path separate from the suggestion path"],
    status: "specified-not-executed",
  },
] as const;

/** The four contracts Stage B hardened. Every case must name at least one, and every contract
 * must have at least one case — the test checks both directions. */
export type StageBContract =
  | "publication snapshot"
  | "selection-state contract"
  | "field-scoped combination contract"
  | "publication validation contract";

/**
 * Which contract each case discharges, as a table rather than as prose inside `discharges`, so
 * that the mapping can be checked for completeness in both directions. A free-text field cannot
 * be counted: "§3 field scoping" and "field-scoped combination contract" would read as two
 * different things to a grep and as one thing to a reviewer, which is the mistake that let a
 * hollow guard look like coverage.
 */
export const CASE_CONTRACTS: Readonly<Record<string, readonly StageBContract[]>> = {
  T1: ["publication snapshot", "selection-state contract", "publication validation contract"],
  T2: ["selection-state contract", "publication validation contract"],
  T3: ["field-scoped combination contract", "publication snapshot"],
  T4: ["selection-state contract", "publication validation contract"],
  T5: ["selection-state contract"],
  T6: ["publication snapshot", "publication validation contract"],
  T7: ["selection-state contract", "field-scoped combination contract"],
  T8: ["publication snapshot", "publication validation contract"],
  T9: ["selection-state contract", "publication validation contract"],
  T10: ["field-scoped combination contract", "selection-state contract"],
  T11: ["field-scoped combination contract", "selection-state contract"],
  T12: ["selection-state contract"],
  T13: ["selection-state contract", "publication validation contract"],
  T14: ["selection-state contract", "publication validation contract"],
  T15: ["selection-state contract"],
  T16: ["selection-state contract"],
  T17: ["publication snapshot", "selection-state contract"],
  T18: ["publication snapshot"],
  T19: ["publication validation contract", "publication snapshot"],
  T20: ["publication snapshot", "field-scoped combination contract"],
};

/** Every selection state the contract defines, so the spec can be proved to cover all seven. */
export const SELECTION_STATE_IDS = ["A", "B", "C", "D", "E", "F", "G"] as const;

/**
 * knowledgeRetrievalMutations.test.ts — the six retrieval cases the brief names, one test each.
 *
 * WHY THIS FILE IS SEPARATE FROM knowledgeRetrieval.test.ts
 * That file holds the INVARIANTS (query = authored text, budget is a ceiling, passages are
 * traceable). This one holds the CLINICAL CLAIMS: that a given finding reaches the rule that
 * governs it, and that a given kind of report reaches nothing it has no business seeing. Each test
 * here is a mutation test in the repo's sense — the ranker or a document gate has to be changed for
 * it to fail, and every one of them was run against the code before the assertion was written.
 *
 * WHAT THESE TESTS CHANGED IN THE RETRIEVER (each was measured failing first)
 *  1. A word in a section's HEADING now counts twice (`TITLE_WEIGHT`). Before, an acute-infarct
 *     report retrieved four ischaemic-wording sections and NOT `5. ACUTE ISCHEMIC INFARCTION` —
 *     the length normalisation let every short section that mentioned infarction in passing outrank
 *     the rule that governs it. (§1 below)
 *  2. Query terms are filtered through `termOnlyDenied`, the Composer's own grounding polarity rule.
 *     Before, "No restricted diffusion…" retrieved the acute-infarction reporting rule, because
 *     lexical matching cannot tell a denial from an assertion. (§4)
 *  3. `mri-*` documents are gated on the study being MRI, and the lumbosacral document is gated on
 *     lumbosacral wording. Before, a CT brain pulled the MRI brain DWI/ADC rules and a cervical
 *     disc bulge was governed by the L4-L5 lateral-recess and canal-AP rules. (§6)
 *
 * NO EMBEDDINGS WERE ADDED. All four failures above were fixed with the lexical ranker, the shipped
 * negation rule and two document gates — so the brief's condition for adding vectors ("first
 * demonstrate a retrieval failure that embeddings can address") has not been met.
 */
import { describe, it, expect } from "vitest";

import { retrieveReferenceKnowledge, REFERENCE_KNOWLEDGE_HEADER } from "./knowledgeRetrieval";
import { loadKnowledgeCorpus, __resetKnowledgeCorpusCacheForTests } from "./knowledgeCorpus";
import type { ComposerInputSnapshot } from "./types";

const BRAIN = "mri-brain-v1.md";
const SPINE = "mri-ls-spine-v1.2.md";
const MASTER = "master-system-prompt-v4.md";

const snap = (over: Partial<ComposerInputSnapshot>): ComposerInputSnapshot =>
  ({
    worklistId: 9001,
    modality: "MR",
    region: "Brain",
    family: "brain",
    protocol: "Plain",
    findings: "",
    impression: "",
    observations: [],
    ...over,
  }) as ComposerInputSnapshot;

function run(s: ComposerInputSnapshot, maxChars = 12000) {
  __resetKnowledgeCorpusCacheForTests();
  return retrieveReferenceKnowledge(s, { maxChars, corpus: loadKnowledgeCorpus() });
}

const ids = (r: ReturnType<typeof run>) => r.passages.map((p) => p.id);
const files = (r: ReturnType<typeof run>) => [...new Set(r.passages.map((p) => p.file))];

describe("§1 restricted diffusion reaches the acute-ischaemic-infarction rule", () => {
  const r = run(snap({
    findings:
      "There is an area of restricted diffusion in the left middle cerebral artery territory "
      + "with corresponding low ADC signal.",
    impression: "Acute infarction in the left MCA territory.",
  }));

  it("retrieves section 5 ACUTE ISCHEMIC INFARCTION", () => {
    expect(ids(r)).toContain(5);
    const five = r.passages.find((p) => p.id === 5 && p.file === BRAIN)!;
    expect(five.title).toBe("ACUTE ISCHEMIC INFARCTION");
  });

  it("and the observation-to-diagnosis rule that licenses calling it an infarct", () => {
    expect(r.passages.some((p) => p.file === BRAIN && p.id === 58)).toBe(true);
  });

  it("the section that arrives is the document's own text, whole", () => {
    const five = r.passages.find((p) => p.id === 5)!;
    const src = loadKnowledgeCorpus().byId.get(`${BRAIN}#5`)!;
    expect(r.block).toContain(src.text);
    expect(five.chars).toBe(src.chars);
    expect(five.version).toBe(src.version);
  });
});

describe("§2 white matter hyperintensities reach the chronic small-vessel rules", () => {
  const r = run(snap({
    findings:
      "Confluent T2/FLAIR hyperintensities are seen in the periventricular and deep white matter, "
      + "without restricted diffusion.",
    impression: "Chronic small-vessel ischemic changes.",
  }));

  it("retrieves 8 SMALL VESSEL ISCHEMIC WHITE MATTER CHANGE and 59 CHRONIC ISCHEMIC FINDINGS", () => {
    expect(ids(r)).toEqual(expect.arrayContaining([8, 59]));
    expect(r.passages.find((p) => p.id === 8)!.title).toBe("SMALL VESSEL ISCHEMIC WHITE MATTER CHANGE");
  });

  it("and not the acute-infarction rule, which this report does not discuss", () => {
    // "without restricted diffusion" is a denial: §1's ranker would otherwise put the acute rule in
    // front of a model writing a chronic small-vessel report, and the model would have acute text to copy.
    expect(ids(r)).not.toContain(5);
  });
});

describe("§3 a lumbar disc bulge reaches level-specific lumbar disc pathology", () => {
  const r = run(snap({
    region: "LS Spine",
    family: "spine",
    spineSegment: "lumbar",
    findings: "Posterior disc bulge at L4-L5 with narrowing of the left lateral recess.",
    impression: "L4-L5 disc bulge with left lateral recess narrowing.",
  }));

  it("retrieves the lateral recess and the disc location/laterality rules", () => {
    expect(ids(r)).toEqual(expect.arrayContaining([14, 10]));
    expect(r.passages.find((p) => p.id === 14)!.title).toBe("LATERAL RECESS");
    expect(r.passages.find((p) => p.id === 10)!.title).toBe("DISC LOCATION AND LATERALITY");
  });

  it("every passage comes from the lumbosacral document", () => {
    expect(files(r)).toEqual([SPINE]);
  });
});

describe("§4 a negated finding must not retrieve the rule for asserting it", () => {
  it("a report that only denies things retrieves nothing, and says which words it denied", () => {
    const r = run(snap({
      findings:
        "No restricted diffusion to suggest acute infarction. No disc bulge at L4-L5. "
        + "No white matter hyperintensities.",
      impression: "No acute infarction.",
    }));
    expect(r.block).toBe("");
    expect(r.passages).toEqual([]);
    expect(r.reason).toContain("stated in the negative");
    for (const term of ["restri", "diffus", "infarc", "bulge"]) expect(r.reason).toContain(term);
    // The terms were READ (they reached the polarity filter) — they were just all denials.
    expect(r.queryTerms).toEqual(expect.arrayContaining(["restri", "infarc"]));
  });

  it("a mixed report keeps its positive terms and still drops the denied ones", () => {
    const r = run(snap({
      findings:
        "No restricted diffusion to suggest acute infarction. Periventricular white matter "
        + "hyperintensities are seen.",
      impression: "No acute infarction. Chronic small-vessel ischemic change.",
    }));
    expect(r.passages.length).toBeGreaterThan(0);
    expect(ids(r)).toEqual(expect.arrayContaining([8, 59]));
    expect(ids(r)).not.toContain(5);
    expect(r.queryTerms).not.toContain("restri");
    expect(r.queryTerms).not.toContain("infarc");
    expect(r.queryTerms).toContain("white");
  });

  it("the same word stated once positively is enough to retrieve its rule", () => {
    // Guards against the filter being a blanket "denied anywhere = never retrieved": reports say
    // "No acute infarct. Chronic infarct in the left MCA." and the chronic rule is wanted.
    const r = run(snap({
      findings: "No restricted diffusion. A chronic infarct with gliosis is seen in the left MCA territory.",
      impression: "Chronic left MCA infarct.",
    }));
    expect(r.queryTerms).toContain("infarc");
    expect(r.passages.length).toBeGreaterThan(0);
  });

  it("a denial whose cue is far from the term is still a denial (the 40-character window)", () => {
    // The shipped grounding rule's cue window is 40 characters; this sentence puts its cue ~48 away,
    // which is why retrieval asks `termOnlyDenied` (cue-at-head OR proximity) and not polarity
    // alone. Impression deliberately empty: "Normal MRI brain." is a POSITIVE statement and would
    // rightly retrieve the normal-survey rule.
    const r = run(snap({
      findings: "No diffusion abnormality to suggest an acute ischaemic infarction.",
      impression: "",
    }));
    expect(r.block).toBe("");
    expect(r.reason).toContain("stated in the negative");
    expect([...r.queryTerms].sort()).toEqual(
      ["abnorm", "acute", "diffus", "infarc", "ischae", "sugges"],
    );
  });

  it("a positive normal declaration in the same report still retrieves its rule", () => {
    // Companion control for the test above: the emptiness comes from denial, not from the filter
    // swallowing every sentence. One affirmative line brings reference knowledge back.
    const r = run(snap({
      findings: "No diffusion abnormality to suggest an acute ischaemic infarction. Ventricles are normal in size.",
      impression: "",
    }));
    expect(r.block).not.toBe("");
    expect(r.queryTerms).toContain("ventri");
  });
});

describe("§5 a provisional normal template must not influence retrieval", () => {
  const authored = "Posterior disc bulge at L4-L5 with narrowing of the left lateral recess.";

  it("a template normal that CONTRADICTS the radiologist changes no passage", () => {
    const bare = run(snap({ region: "LS Spine", family: "spine", findings: authored }));
    const withTemplate = run(snap({
      region: "LS Spine",
      family: "spine",
      findings: authored,
      observations: [
        {
          id: "obs-tpl-1",
          concept: "discL4L5",
          role: "baseline",
          source: "normal-template",
          // CARE's real spine normal wording: denial AFTER the level, which is the case a
          // sentence-head denial test misses.
          findingsText: "L4-L5: No significant disc bulge or protrusion is seen.",
          impressionText: "",
          baselineReplaces: null,
        },
      ] as never,
    }));
    expect(withTemplate.passages.map((p) => p.address)).toEqual(bare.passages.map((p) => p.address));
    expect(withTemplate.block).toBe(bare.block);
    expect(ids(bare)).toEqual(expect.arrayContaining([14, 10]));
  });

  it("the template's own words never appear in the query", () => {
    const withTemplate = run(snap({
      region: "LS Spine",
      family: "spine",
      findings: authored,
      observations: [
        {
          id: "obs-tpl-2",
          concept: "other",
          role: "baseline",
          source: "normal-template",
          findingsText: "Proteus mirabilis quantification significance threshold",
          impressionText: "",
          baselineReplaces: null,
        },
      ] as never,
    }));
    for (const phantom of ["proteus", "mirabilis", "quantific", "threshold"]) {
      expect(withTemplate.queryTerms).not.toContain(phantom);
    }
  });
});

describe("§6 no cross-patient, cross-examination or cross-level leakage", () => {
  const brainCase = snap({
    worklistId: 11,
    studyId: 101,
    findings: "Restricted diffusion in the left MCA territory with low ADC signal.",
    impression: "Acute left MCA infarction.",
  });

  it("the same report on a different patient gets byte-identical reference text", () => {
    const other = run(snap({ ...brainCase, worklistId: 999, studyId: 901, reportId: 77 }));
    const same = run(brainCase);
    expect(other.block).toBe(same.block);
    expect(other.passages.map((p) => p.address)).toEqual(same.passages.map((p) => p.address));
  });

  it("identity fields and clinical history are not part of the query", () => {
    // `authoredSentences` is findings + impression + the radiologist's own observations. A referral
    // line ("rule out metastasis") must not be able to summon the metastasis reporting rule: the
    // clinician's question is not the radiologist's finding, and retrieval that could not tell them
    // apart would be inventing an indication-driven diagnosis path.
    const r = run(snap({
      ...brainCase,
      clinicalHistory: "History of carcinoma of the breast. Rule out cerebral metastases.",
      patientName: "SYNTHETIC-PATIENT-ONE",
    } as never));
    for (const term of ["carcinoma", "breast", "metasta", "rule", "synthetic", "patient"]) {
      expect(r.queryTerms).not.toContain(term);
    }
    expect(r.block).toBe(run(brainCase).block);
  });

  it("a brain MRI never reaches the lumbar document, or vice versa", () => {
    expect(files(run(brainCase))).not.toContain(SPINE);
    const lumbar = run(snap({
      region: "LS Spine",
      family: "spine",
      findings: "Posterior disc bulge at L4-L5 with left lateral recess narrowing.",
    }));
    expect(files(lumbar)).not.toContain(BRAIN);
  });

  it("a CT brain gets no MRI document — its rules name sequences this patient never had", () => {
    const ct = run(snap({
      modality: "CT",
      region: "Brain",
      family: "brain",
      findings: "Hyperdense middle cerebral artery sign with loss of grey-white differentiation.",
      impression: "Evolving left MCA infarction.",
    }));
    expect(files(ct)).toEqual([MASTER]);
    // The master prompt does discuss sequences in the abstract; what must not appear is the MRI
    // brain document's own sections, cited by address.
    expect(ct.block).not.toContain(`${BRAIN}#`);
  });

  it("an X-ray gets no MRI document either", () => {
    const xray = run(snap({
      modality: "XR",
      region: "Chest",
      family: "",
      findings: "No consolidation. Heart size normal.",
      impression: "Normal chest X-ray.",
    }));
    expect(files(xray)).toEqual([MASTER]);
  });

  it("a cervical disc bulge is not governed by the lumbosacral document", () => {
    const cerv = run(snap({
      region: "Cervical spine",
      family: "spine",
      spineSegment: "cervical",
      findings: "Posterolateral disc bulge at C5-C6 with right neural foraminal narrowing.",
      impression: "C5-C6 disc bulge with right foraminal narrowing.",
    }));
    expect(files(cerv)).toEqual([MASTER]);
    // The LS rules that would have been wrong to show: the lumbosacral canal AP table and the
    // L4-L5 lateral recess wording.
    expect(cerv.block).not.toContain(`${SPINE}#`);
    expect(cerv.block.toLowerCase()).not.toContain("lumbosacral");
  });

  it("an MRI LS spine still gets its own document, so the gates are not a blanket refusal", () => {
    const ls = run(snap({
      region: "LS Spine",
      family: "spine",
      findings: "Disc protrusion at L5-S1 contacting the traversing right L5 nerve root.",
    }));
    expect(files(ls)).toContain(SPINE);
  });

  it("a missing modality fails the gate rather than guessing MRI", () => {
    const noModality = run(snap({ modality: undefined as never, findings: "Restricted diffusion in the left MCA." }));
    expect(files(noModality)).toEqual([MASTER]);
  });

  it("whatever does reach the prompt arrives labelled as reference, never as findings", () => {
    // The one sentence that tells the model these words are not this patient's. A retrieved section
    // without it is indistinguishable from supplied clinical truth, which is the failure mode this
    // whole feature has to make impossible.
    for (const s of [
      brainCase,
      snap({ region: "LS Spine", family: "spine", findings: "Posterior disc bulge at L4-L5 with left lateral recess narrowing." }),
    ]) {
      const r = run(s);
      expect(r.passages.length).toBeGreaterThan(0);
      expect(r.block.startsWith(REFERENCE_KNOWLEDGE_HEADER)).toBe(true);
      expect(r.block).toContain("NOT this patient's findings");
      // The shipped sentence, which is line-wrapped in the source: assert both halves rather than
      // a spelling that does not exist.
      expect(r.block).toContain("must not add any finding, side, level,");
      expect(r.block).toContain("measurement or diagnosis that the supplied report does not already support");
      expect(r.block).toContain("The radiologist's supplied text remains the only clinical truth.");
    }
  });

  it("the level he dictated is not a retrieval key, so another level's rule cannot arrive", () => {
    // Measured across the lumbosacral document: no section is scoped to one level. §17 CROSS-LEVEL
    // MORPHOLOGY MUST NOT BE COLLAPSED, §18 DOMINANT LEVEL and §27 MULTILEVEL DEGENERATIVE DISEASE
    // are rules ABOUT levels, and they apply to whichever level this patient has. So the only way a
    // level could change what reaches the model is through term overlap, and this asserts the
    // property the clinic needs: the same sentence shifted one level retrieves the same sections.
    // If a future document adds a per-level section, this fires and the gates have to explain it.
    const at = (level: string) => run(snap({
      region: "LS Spine",
      family: "spine",
      spineSegment: "lumbar",
      findings: `${level}: Posterior disc bulge with left lateral recess narrowing. ${level}: Neural foramen patent.`,
    }));
    const l4 = at("L4-L5");
    const l5 = at("L5-S1");
    expect(l4.passages.map((p) => `${p.file}#${p.id}`)).toEqual(l5.passages.map((p) => `${p.file}#${p.id}`));
    expect(l4.passages.length).toBeGreaterThan(0);
    expect(l4.queryTerms).toEqual(l5.queryTerms);
  });
});

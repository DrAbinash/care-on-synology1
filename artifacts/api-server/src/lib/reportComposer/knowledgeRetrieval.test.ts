/**
 * knowledgeRetrieval.test.ts — deterministic, findings-driven retrieval from the clinic's own
 * radiology documents, inside the Composer's existing context budget.
 *
 * THE THREE RULES THESE TESTS EXIST TO HOLD
 * 1. The query is what the RADIOLOGIST wrote. A provisional normal template sentence is unreviewed
 *    scaffolding (PR #1257 established its provenance); letting it steer retrieval would mean the
 *    template choosing which clinical authority the model is shown.
 * 2. Retrieval is an OFFER, never a cost the report pays for. If the section set does not fit the
 *    headroom the caller reports, fewer sections are sent — the radiologist's own text is never
 *    shortened to make room, and a request is never refused because of RAG.
 * 3. A retrieved section is reference knowledge about wording and interpretation. It must not
 *    reach the grounding corpora, because a document that justified itself into "clinical truth"
 *    would let documentation invent findings for this patient.
 */
import { describe, it, expect } from "vitest";

import { retrieveReferenceKnowledge, REFERENCE_KNOWLEDGE_HEADER } from "./knowledgeRetrieval";
import { loadKnowledgeCorpus, __resetKnowledgeCorpusCacheForTests } from "./knowledgeCorpus";
import type { ComposerInputSnapshot } from "./types";

const BRAIN = "mri-brain-v1.md";
const SPINE = "mri-ls-spine-v1.2.md";

const snap = (over: Partial<ComposerInputSnapshot>): ComposerInputSnapshot =>
  ({
    worklistId: "WL-RAG-1",
    modality: "MR",
    region: "Brain",
    family: "brain",
    protocol: "Plain",
    findings: "",
    impression: "",
    observations: [],
    ...over,
  }) as ComposerInputSnapshot;

const run = (s: ComposerInputSnapshot, maxChars = 6000) =>
  retrieveReferenceKnowledge(s, { maxChars, corpus: (__resetKnowledgeCorpusCacheForTests(), loadKnowledgeCorpus()) });

describe("rule 1 — the radiologist's own words choose the references", () => {
  it("a brain study with restricted diffusion reaches the brain document, not the spine one", () => {
    const r = run(snap({
      findings:
        "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC. "
        + "The ventricles are normal in size.",
    }));
    expect(r.passages.length).toBeGreaterThan(0);
    expect(r.passages.every((p) => p.file !== SPINE)).toBe(true);
    const ids = r.passages.map((p) => p.id);
    // DWI/ADC is §4 and the observation→diagnosis synthesis is §58; either may rank first, and
    // both are sections a brain report with that finding should be written against.
    expect(ids.some((i) => i === 4 || i === 58)).toBe(true);
  });

  it("an LS spine study reaches the LS spine document", () => {
    const r = run(snap({
      region: "LS Spine",
      family: "spine",
      spineSegment: "lumbar",
      findings: "Disc protrusion at L4-L5 with thecal sac compression. Bilateral pars interarticularis defects at L5.",
    }));
    expect(r.passages.some((p) => p.file === SPINE)).toBe(true);
    expect(r.passages.every((p) => p.file !== BRAIN)).toBe(true);
  });

  it("a provisional normal template sentence does not steer retrieval", () => {
    const withoutTemplate = snap({ findings: "Restricted diffusion in the left frontal cortex on DWI." });
    const withTemplate = snap({
      findings: "Restricted diffusion in the left frontal cortex on DWI.",
      observations: [
        {
          id: "obs-normal-1",
          concept: "dwiclinical",
          role: "baseline",
          source: "normal-template",
          findingsText: "No restricted diffusion is seen on DWI/ADC.",
          impressionText: "",
          baselineReplaces: null,
        },
      ] as never,
    });
    const a = run(withoutTemplate);
    const b = run(withTemplate);
    expect(b.passages.map((p) => p.address)).toEqual(a.passages.map((p) => p.address));
  });

  it("an empty authored input retrieves nothing rather than guessing", () => {
    const r = run(snap({ findings: "", impression: "" }));
    expect(r.passages).toEqual([]);
    expect(r.block).toBe("");
    expect(r.reason).toContain("no authored findings");
  });
});

describe("rule 2 — the budget is a hard ceiling and it degrades by dropping sections", () => {
  it("never exceeds the characters it is given", () => {
    for (const maxChars of [500, 1200, 3000, 12000]) {
      const r = run(
        snap({ findings: "Acute infarction with haemorrhagic transformation. Microbleeds on SWI. Midline shift." }),
        maxChars,
      );
      expect(r.block.length).toBeLessThanOrEqual(maxChars);
    }
  });

  it("returns an empty offer when nothing fits, and says so", () => {
    const r = run(snap({ findings: "Restricted diffusion on DWI with low ADC signal." }), 40);
    expect(r.passages).toEqual([]);
    expect(r.block).toBe("");
    expect(r.reason).toContain("did not fit");
  });

  it("never truncates a section to squeeze it in — a partial clinical rule is worse than none", () => {
    const c = loadKnowledgeCorpus();
    const r = run(
      snap({ findings: "Restricted diffusion in the basal ganglia on DWI with corresponding low ADC signal." }),
      4000,
    );
    expect(r.passages.length).toBeGreaterThan(0);
    // Each offered section appears whole. Cutting a rule mid-sentence is how a document starts
    // meaning something its author never wrote.
    for (const p of r.passages) expect(r.block).toContain(c.byId.get(p.address)!.text);
  });

  it("drops a section rather than cutting it when the next one would not fit", () => {
    const c = loadKnowledgeCorpus();
    const wide = run(
      snap({ findings: "Restricted diffusion on DWI with low ADC. Microbleeds on SWI. Venous sinus thrombosis." }),
      12000,
    );
    const tight = run(
      snap({ findings: "Restricted diffusion on DWI with low ADC. Microbleeds on SWI. Venous sinus thrombosis." }),
      Math.max(600, wide.passages[0].chars + 200),
    );
    expect(tight.passages.length).toBeLessThan(wide.passages.length);
    for (const p of tight.passages) expect(tight.block).toContain(c.byId.get(p.address)!.text);
  });
});

describe("rule 3 — reference knowledge is labelled, traceable and inert", () => {
  it("the block states that it is not this patient's findings", () => {
    const r = run(snap({ findings: "Restricted diffusion on DWI with low ADC." }));
    expect(r.block.startsWith(REFERENCE_KNOWLEDGE_HEADER)).toBe(true);
    expect(r.block).toMatch(/NOT this patient/i);
    expect(r.block).toMatch(/must not add/i);
  });

  it("every passage records file, section id and document version", () => {
    const c = loadKnowledgeCorpus();
    const r = run(snap({ findings: "Disc protrusion L4-L5 with thecal sac compression." }));
    expect(r.passages.length).toBeGreaterThan(0);
    for (const p of r.passages) {
      expect(p.address).toBe(`${p.file}#${p.id}`);
      expect(p.version).toHaveLength(64);
      expect(p.version).toBe(c.files.find((f) => f.file === p.file)!.version);
      expect(p.title).toBeTruthy();
      expect(r.block).toContain(p.address);
    }
  });

  it("a corpus that is not there changes nothing", () => {
    const r = retrieveReferenceKnowledge(
      snap({ findings: "Restricted diffusion on DWI with low ADC." }),
      { maxChars: 6000, corpus: loadKnowledgeCorpus({ dir: "C:/definitely/not/here" }) },
    );
    expect(r.block).toBe("");
    expect(r.passages).toEqual([]);
    expect(r.reason).toBeTruthy();
  });

  it("is deterministic — the same input gives the same passages in the same order", () => {
    const s = snap({ findings: "Restricted diffusion on DWI with low ADC signal. Ventricles normal." });
    const a = run(s);
    const b = run(s);
    expect(a.passages.map((p) => p.address)).toEqual(b.passages.map((p) => p.address));
  });

  it("never cites a section whose text is not the document's own text", () => {
    const c = loadKnowledgeCorpus();
    const r = run(snap({ findings: "Acute infarct in the left MCA territory." }));
    for (const p of r.passages) {
      const s = c.byId.get(p.address)!;
      expect(r.block).toContain(s.text.slice(0, 60));
    }
  });
});

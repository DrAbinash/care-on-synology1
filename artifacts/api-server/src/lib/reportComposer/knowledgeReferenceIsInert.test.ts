/**
 * knowledgeReferenceIsInert.test.ts — retrieved documents are wording authority, never clinical truth.
 *
 * THE THREAT THIS CLOSES
 * Reference knowledge puts radiology prose about infarcts, occlusions and herniations in front of a
 * model that is being asked about one patient. A model that copies one of those words into the draft
 * has invented a finding. The only thing standing between that text and the patient is the existing
 * validator, so what has to be proven is that the validator does not see the reference block as
 * evidence — a grounding corpus that included the retrieved sections would treat the clinic's own
 * documentation as something the radiologist supplied, and every unsupported statement in a passage
 * would become licensable.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { retrieveReferenceKnowledge, applyReferenceKnowledge } from "./knowledgeRetrieval";
import { loadKnowledgeCorpus, __resetKnowledgeCorpusCacheForTests } from "./knowledgeCorpus";
import { validateComposerOutput, termOnlyDenied } from "./validateOutput";
import { ComposerEvidenceProvenanceSchema } from "./types";
import type { ComposerDraftOutput, ComposerInputSnapshot } from "./types";

const REPO = path.resolve(process.cwd());

const snap = (over: Partial<ComposerInputSnapshot>): ComposerInputSnapshot =>
  ({
    worklistId: 7001,
    modality: "MR",
    region: "Brain",
    family: "brain",
    protocol: "Plain",
    findings: "There is an area of restricted diffusion in the left middle cerebral artery territory "
      + "with corresponding low ADC signal.",
    impression: "Acute infarction in the left MCA territory.",
    observations: [],
    ...over,
  }) as ComposerInputSnapshot;

const draft = (over: Partial<ComposerDraftOutput>): ComposerDraftOutput =>
  ({
    findings: "",
    impression: "",
    recommendation: "",
    unresolvedQuestions: [],
    warnings: [],
    ...over,
  }) as ComposerDraftOutput;

function retrieve(s: ComposerInputSnapshot) {
  __resetKnowledgeCorpusCacheForTests();
  return retrieveReferenceKnowledge(s, { maxChars: 12000, corpus: loadKnowledgeCorpus() });
}

describe("the retrieved text is available to the model but not to the validator", () => {
  const s = snap({});
  const r = retrieve(s);

  it("the reference block really does contain pathology the patient was never said to have", () => {
    // Not a straw man: this is the whole reason the guard below matters. `occlusion` is in the
    // retrieved text and nowhere in the snapshot.
    expect(r.block).toContain("occlusion");
    expect(s.findings + s.impression).not.toContain("occlusion");
  });

  it("a draft that copies that word out of the reference text is refused as unsupported", () => {
    const out = validateComposerOutput(s, draft({
      findings: "Area of restricted diffusion in the left MCA territory with low ADC signal.",
      impression: "Acute left MCA infarction with arterial occlusion.",
    }), { kind: "FULL_REPORT" });
    expect(out.unsupportedMentions).toContain("occlusion");
    expect(out.ok).toBe(false);
  });

  it("CONTROL — the same draft without the copied word passes, so the refusal above is the word", () => {
    const out = validateComposerOutput(s, draft({
      findings: "Area of restricted diffusion in the left MCA territory with low ADC signal.",
      impression: "Acute left MCA infarction.",
    }), { kind: "FULL_REPORT" });
    expect(out.unsupportedMentions).not.toContain("occlusion");
    expect(out.ok).toBe(true);
  });

  it("the refusal is unchanged when the reference knowledge is switched on for that very request", async () => {
    // The validator's input is the snapshot and the draft. The retrieved text travels only in the
    // prompt, so turning RAG on cannot move the clinical-truth boundary — which is the property the
    // owner asked for: "existing clinical validation must reject unsupported statements regardless of
    // whether they appear in retrieved passages."
    const s = snap({});
    const ragOutcome = await applyReferenceKnowledge({
      snapshot: s,
      systemPrompt: "system",
      userPrompt: "report",
      transport: "ollama",
      configuredNumCtx: 4096,
      enabled: true,
    });
    expect(ragOutcome.passages.length).toBeGreaterThan(0);
    expect(ragOutcome.userPrompt).not.toBe("report");

    const after = validateComposerOutput(s, draft({
      findings: "Restricted diffusion in the left MCA territory.",
      impression: "Acute left MCA infarction with arterial occlusion.",
    }), { kind: "FULL_REPORT" });
    const before = validateComposerOutput(s, draft({
      findings: "Restricted diffusion in the left MCA territory.",
      impression: "Acute left MCA infarction with arterial occlusion.",
    }), { kind: "FULL_REPORT" });
    expect(after.unsupportedMentions).toEqual(before.unsupportedMentions);
    expect(after.unsupportedMentions).toContain("occlusion");
  });
});

describe("the boundary is structural, not incidental", () => {
  it("the clinical-validation module never reads the knowledge corpus", () => {
    // If someone wires `knowledgeCorpus` in here, retrieved documentation becomes part of the
    // grounding corpus and every finding named in a clinic document is licensable for every patient.
    const src = fs.readFileSync(
      path.join(REPO, "artifacts/api-server/src/lib/reportComposer/validateOutput.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"\.\/knowledge(Corpus|Retrieval)"/);
    expect(src).not.toMatch(/loadKnowledgeCorpus|retrieveReferenceKnowledge/);
  });

  it("the baseline-retirement module never reads it either", () => {
    const src = fs.readFileSync(
      path.join(REPO, "artifacts/api-server/src/lib/reportComposer/baselineRetirement.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"\.\/knowledge(Corpus|Retrieval)"/);
  });

  it("retrieval returns a prompt and a record — never a draft, never a finding list", () => {
    const keys = Object.keys({
      ...retrieve(snap({})),
    }).sort();
    expect(keys).toEqual(["block", "passages", "queryTerms", "reason"]);
  });

  it("retrieval cannot modify the study it was run for", () => {
    const s = snap({});
    const before = JSON.parse(JSON.stringify(s));
    retrieve(s);
    expect(s).toEqual(before);
  });

  it("the composer's own negation rule is what retrieval asks, not a second one", () => {
    // `termOnlyDenied` is exported from the validator: one definition of "the radiologist did not
    // say this". A copy in the retrieval module would drift, and the drift would be in the
    // direction that lets a denied finding license a positive rule.
    expect(typeof termOnlyDenied).toBe("function");
    expect(termOnlyDenied("No restricted diffusion to suggest acute infarction.", "diffus")).toBe(true);
    expect(termOnlyDenied("Restricted diffusion is present in the left MCA.", "diffus")).toBe(false);
  });
});

describe("every retrieved passage is recorded with its document version", () => {
  it("the provenance contract carries file, section id and the document SHA256", () => {
    const r = retrieve(snap({}));
    const parsed = ComposerEvidenceProvenanceSchema.parse({
      provider: "ollama",
      model: "qwen3:14b",
      referenceKnowledge: r.passages.map((p) => ({
        address: p.address, file: p.file, id: p.id, version: p.version, chars: p.chars,
      })),
    });
    expect(parsed.referenceKnowledge).toHaveLength(r.passages.length);
    for (const entry of parsed.referenceKnowledge ?? []) {
      expect(entry.address).toMatch(/^[a-z0-9.\-]+\.md#\d+$/);
      expect(entry.version).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.chars).toBeGreaterThan(0);
    }
  });

  it("the shape is optional, so a run without reference knowledge records nothing", () => {
    const parsed = ComposerEvidenceProvenanceSchema.parse({ provider: "ollama", model: "qwen3:14b" });
    expect(parsed.referenceKnowledge).toBeUndefined();
  });

  it("the compose engine spreads that record into every text path result", () => {
    // Source contract for the one thing a log line cannot give: the row must carry it. The success
    // return is `provenance: { ...baseProvenance, ...ragProvenance, model, provider… }`.
    const src = fs.readFileSync(
      path.join(REPO, "artifacts/api-server/src/lib/reportComposer/composeEngine.ts"), "utf8");
    const spreads = src.split(/\r?\n/).filter((l) => l.includes("...ragProvenance"));
    expect(spreads.length).toBeGreaterThanOrEqual(7);
    expect(src).toMatch(/provenance: \{ \.\.\.baseProvenance, \.\.\.ragProvenance, model, provider: providerName, fallbackUsed \},/);
  });
});

/**
 * knowledgeStatusIsReported.test.ts — the review surface has to be able to say, from the job row
 * alone, whether reference knowledge was in front of the model and which sections. That is a
 * reporting-correctness property, not a cosmetic one: with `ff_radiology_ai_rag` now enabled by
 * default, "why is this draft worded like that" must be answerable months later, and "RAG is off"
 * must be distinguishable from "RAG was on and matched nothing".
 *
 * Nothing here asserts a clinical conclusion. It asserts what the run records about itself.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyReferenceKnowledge,
  REFERENCE_KNOWLEDGE_HEADER,
  RAG_FEATURE_FLAG,
  retrieveReferenceKnowledge,
} from "./knowledgeRetrieval";
import { loadKnowledgeCorpus } from "./knowledgeCorpus";
import { ComposerEvidenceProvenanceSchema } from "./types";
import type { ComposerInputSnapshot } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));

const snap = (over: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot => ({
  worklistId: 1,
  modality: "MR",
  region: "Brain",
  family: "brain",
  findings: "Restricted diffusion in the left thalamus with corresponding low signal on ADC.",
  impression: "",
  observations: [
    { id: "o1", role: "finding", findingsText: "Restricted diffusion in the left thalamus with corresponding low signal on ADC." },
  ],
  ...over,
} as ComposerInputSnapshot);

const corpus = loadKnowledgeCorpus();

async function outcome(enabled: boolean, snapshot = snap()) {
  const system = "SYSTEM";
  const user = "USER\n\nFindings: " + (snapshot.findings ?? "");
  return applyReferenceKnowledge({
    snapshot,
    systemPrompt: system,
    userPrompt: user,
    transport: "ollama",
    configuredNumCtx: 8192,
    enabled,
    corpus,
  });
}

describe("what a run records about its own reference knowledge", () => {
  it("every retrieved section arrives with the heading the reviewer will recognise", () => {
    const r = retrieveReferenceKnowledge(snap(), { maxChars: 6000, corpus });
    expect(r.passages.length).toBeGreaterThan(0);
    for (const p of r.passages) {
      expect(p.title.trim().length).toBeGreaterThan(0);
      // The heading is the section's own line, and its address matches the file#id it came from.
      expect(p.address).toBe(`${p.file}#${p.id}`);
      expect(p.version).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("the recorded entry parses against the provenance contract, heading included", () => {
    const r = retrieveReferenceKnowledge(snap(), { maxChars: 6000, corpus });
    const parsed = ComposerEvidenceProvenanceSchema.parse({
      provider: "ollama",
      model: "qwen3:14b",
      referenceKnowledge: r.passages.map((p) => ({
        address: p.address, file: p.file, id: p.id, title: p.title, version: p.version, chars: p.chars,
      })),
      referenceKnowledgeNote: "recorded by the compose engine",
    });
    expect(parsed.referenceKnowledge?.[0].title).toBeTruthy();
    expect(parsed.referenceKnowledgeNote).toBe("recorded by the compose engine");
  });

  it("says OFF when the flag is off, and does not touch the prompts", async () => {
    const off = await outcome(false);
    expect(off.passages).toEqual([]);
    expect(off.userPrompt).toContain("USER");
    expect(off.userPrompt).not.toContain(REFERENCE_KNOWLEDGE_HEADER);
    expect(off.note.toLowerCase()).toContain("off");
    expect(off.note).toContain("feature flag");
  });

  it("names the sections it added when the flag is on", async () => {
    const on = await outcome(true);
    expect(on.passages.length).toBeGreaterThan(0);
    expect(on.userPrompt).toContain(REFERENCE_KNOWLEDGE_HEADER);
    expect(on.note).toMatch(/reference section\(s\)/);
  });

  it("keeps a reason for every run that contributed nothing, so inert is not mistaken for off", async () => {
    // A report whose authored findings are all denials retrieves nothing; the note is the only
    // thing that will tell a reviewer why the draft looks exactly like the pre-RAG draft.
    const denied = await outcome(true, snap({
      findings: "No restricted diffusion is seen on DWI or ADC. No acute intracranial abnormality.",
      observations: [
        {
          id: "o1",
          role: "finding",
          concept: "dwiclinical",
          findingsText: "No restricted diffusion is seen on DWI or ADC.",
        },
        {
          id: "o2",
          role: "finding",
          concept: "noacuteintracranial",
          findingsText: "No acute intracranial abnormality.",
        },
      ],
    }));
    expect(denied.passages).toEqual([]);
    expect(denied.note.length).toBeGreaterThan(0);
    expect(denied.userPrompt).not.toContain(REFERENCE_KNOWLEDGE_HEADER);

    // A database with no row reads as OFF, which is the fail-safe direction.
    const noCorpus = await applyReferenceKnowledge({
      snapshot: snap(),
      systemPrompt: "SYSTEM",
      userPrompt: "USER",
      transport: "ollama",
      configuredNumCtx: 8192,
      enabled: true,
      corpus: { available: false, dir: null, files: [], sections: [], missing: [], reason: "no ai-knowledge directory" } as never,
    });
    expect(noCorpus.passages).toEqual([]);
    expect(noCorpus.note).toContain("unavailable");
  });

  it("the gate the code reads is the key the registry ships enabled", async () => {
    // Three names for one switch — the constant in the retriever, the row in the database, and the
    // entry the ops surface publishes. If any of them drifts, the composer is running with a
    // different setting than the one anyone can see, so they are pinned together.
    const { RADIOLOGY_FLAG_REGISTRY } = await import("../radiologyFeatureFlagRegistry");
    const entry = RADIOLOGY_FLAG_REGISTRY.find((e) => e.key === RAG_FEATURE_FLAG);
    expect(entry?.key).toBe("ff_radiology_ai_rag");
    expect(entry?.defaultValue).toBe(true);
    expect(entry?.wired).toBe(true);
  });

  it("the compose engine writes both halves into the job's provenance", () => {
    // Source contract for the only thing that can regress silently: the engine must spread the
    // heading and the note, not just the address, into every TEXT_ONLY result's provenance.
    const src = fs.readFileSync(path.join(here, "composeEngine.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("referenceKnowledgeNote: rag.note");
    expect(src).toMatch(/referenceKnowledge: rag\.passages\.map\(\(p\) => \(\{[\s\S]{0,200}title: p\.title,/);
    const spreads = src.split("\n").filter((l) => l.includes("...ragProvenance"));
    expect(spreads.length).toBeGreaterThanOrEqual(6);
  });

  it("the log prints a line for a run that retrieved nothing, now that OFF is no longer the default", () => {
    // The `[compose-rag]` line used to fire only when passages came back, which was safe while the
    // flag was off by default: no line meant the code path never ran. With the row seeded enabled,
    // that reading is wrong — a retrieval that matched nothing and a flag that is off both go
    // silent. One line either way, carrying the server's own reason.
    const src = fs.readFileSync(path.join(here, "composeEngine.ts"), "utf8").replace(/\r\n/g, "\n");
    const lines = src.split("\n").filter((l) => l.includes("[compose-rag]"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => /sections=0/.test(l) && /rag\.note/.test(l))).toBe(true);
    // And the reason must come from the note, never from the report text it retrieved against.
    expect(lines.join("\n")).not.toMatch(/queryTerms|user\.slice|authored/);
  });
});

/**
 * THE PER-JOB OVERRIDE, WHERE IT IS DECIDED AND WHERE IT IS WRITTEN.
 *
 * These are wiring guards, not behaviour tests: the behaviour is executed in
 * `knowledgeBudget.test.ts` (retrieval) and `composeEngine.contextBudget.test.ts` §D (the run and
 * its provenance), and `resolveRagOverride` / the row envelope are executed in
 * `reportComposer.unit.test.ts`. What cannot be executed without a database is the last inch — that
 * the HTTP route actually asks the session, that it asks the AI-settings gate rather than a
 * permission nobody holds, that it hands the resolved contract to the queue, and that nothing on
 * any of these paths can write the clinic-wide flag.
 *
 * `reportComposer.visionTrialGate.test.ts` records why this file greps: the composer router pulls
 * in the job queue, the compose engine and the database, so it has no no-database handler harness.
 * A route that must not fail a clinical request is exactly the route that cannot be put behind a
 * supertest fixture on a laptop.
 */
const routeSrc = fs
  .readFileSync(path.join(here, "..", "..", "routes", "reportComposer.ts"), "utf8")
  .replace(/\r\n/g, "\n");
const jobServiceSrc = fs
  .readFileSync(path.join(here, "jobService.ts"), "utf8")
  .replace(/\r\n/g, "\n");

describe("who may ask for a per-job override, and what it can never touch", () => {
  it("POST /jobs decides the override from the session, through one pure contract function", () => {
    expect(routeSrc).toMatch(
      /resolveRagOverride\(\s*body\.ragOverride,\s*canOverrideReferenceKnowledge\(req[^)]*\)\s*,?\s*\)/s,
    );
  });

  it("the gate it reuses is CARE's existing AI-settings grant, not a string nothing grants", () => {
    const gate = routeSrc.slice(
      routeSrc.indexOf("function canOverrideReferenceKnowledge"),
      routeSrc.indexOf("reportComposerRouter.post"),
    );
    expect(gate.length).toBeGreaterThan(40);
    expect(gate).toContain("ai_reporting.configure");
    expect(gate).toContain("FULL_ACCESS_ROLES");
    // `ai_reporting.configure` is the permission the AI configuration surfaces already enforce —
    // API keys, model routes, the prompt library, AI comparison. If that grant is ever renamed,
    // this fires before the composer starts gating on a key nobody is assigned.
    const configuredRoutes = fs
      .readdirSync(path.join(here, "..", "..", "routes"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) =>
        fs
          .readFileSync(path.join(here, "..", "..", "routes", f), "utf8")
          .includes('"ai_reporting.configure"'),
      );
    expect(configuredRoutes.length).toBeGreaterThanOrEqual(4);
    expect(configuredRoutes).toContain("aiReporting.ts");
  });

  it("the request body cannot grant itself anything", () => {
    // One writer of the authorization argument, and it is the session.
    const assignments = routeSrc.match(/canOverrideReferenceKnowledge\(/g) ?? [];
    expect(assignments.length).toBeGreaterThanOrEqual(2);
    expect(routeSrc).not.toMatch(/authorized:\s*Boolean\(body\./);
    expect(routeSrc).not.toMatch(/ragOverride\w*\s*=\s*body\.ragOverrideAuthorized/);
  });

  it("the queue carries the decision, and reads it back for every door that runs the job", () => {
    expect(jobServiceSrc).toContain("encodeRagOverrideEnvelope");
    expect(jobServiceSrc).toContain("decodeRagOverrideEnvelope");
    expect(jobServiceSrc).toMatch(/runReportComposer\(\{[\s\S]{0,900}ragOverride/s);
  });

  it("no path in this feature writes the clinic-wide flag", () => {
    // The owner's constraint is the reason the override exists at all: an A/B comparison must not
    // change what every other workstation does. So the flag row is read-only here, provably.
    for (const src of [routeSrc, jobServiceSrc, fs.readFileSync(path.join(here, "composeEngine.ts"), "utf8"),
      fs.readFileSync(path.join(here, "knowledgeRetrieval.ts"), "utf8")]) {
      expect(src).not.toMatch(/update\(featureFlagsTable/);
      expect(src).not.toMatch(/UPDATE\s+feature_flags/i);
      expect(src).not.toMatch(/setFeatureEnabled|toggleFeatureFlag/);
    }
    // And the only write of the flag CARE ships is the admin-gated PATCH on the flags router.
    expect(routeSrc).not.toContain("featureFlagsTable");
  });

  it("the engine records the override fields the review panel and the audit need", () => {
    const src = fs.readFileSync(path.join(here, "composeEngine.ts"), "utf8").replace(/\r\n/g, "\n");
    for (const key of [
      "referenceKnowledgeEffective",
      "ragOverrideRequested",
      "ragOverrideApplied",
      "ragOverrideIgnoredReason",
    ]) {
      expect(src).toContain(`${key}:`);
    }
    const provenance = fs.readFileSync(path.join(here, "types.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(provenance).toContain("referenceKnowledgeEffective:");
    expect(provenance).toContain("ragOverrideApplied:");
  });
});

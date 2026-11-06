/**
 * The supported-synthesis licence: what it grants, what it must never grant, and the
 * knowledge section it comes from.
 *
 * The rule exists because a live qwen3 draft was refused for calling restricted
 * diffusion with an ADC correlate an acute infarct — clinically correct, and
 * authorised in writing by the clinic's own knowledge pack. So these tests are
 * two-sided on purpose: the licence must fire for the synthesis, and must not fire for
 * anything a radiologist has not described.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";
import { isMriBrainStudy, licensedTerms, licensedSyntheses, usedSynthesisNotices, SYNTHESIS_RULES } from "./supportedSynthesis";
import { selectPersonaModules, CARE_MRI_BRAIN } from "./persona";
import { validateComposerOutput } from "./validateOutput";

const AFFIRM = (corpus: string) => (phrase: string) => {
  const lower = corpus.toLowerCase();
  // Positive when the phrase occurs somewhere that is not inside a negation. Mirrors
  // the validator's own test for the purpose of these unit cases: a phrase preceded by
  // "no"/"not" within the same clause is not an affirmation.
  for (const sentence of lower.split(/(?<=[.!?])\s+|\n+/)) {
    const at = sentence.indexOf(phrase);
    if (at < 0) continue;
    if (at > 0 && /\b(?:no|not|without|absent|negative)\b/.test(sentence.slice(0, at))) continue;
    return true;
  }
  return false;
};

function brain(study: Partial<ComposerInputSnapshot>): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MRI",
    family: "brain",
    region: "Brain",
    bodyPart: "BRAIN",
    reportTitle: "MRI BRAIN",
    technique: "MRI brain on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences.",
    findings: "",
    impression: "",
    recommendation: "",
    observations: [],
    aiMode: "TEXT_ONLY",
    ...study,
  });
}

describe("the synthesis licence fires only on the examination that earned it", () => {
  it("grants infarct when diffusion restriction and an ADC correlate are both supplied", () => {
    const snapshot = brain({
      findings: "Restricted diffusion in the right basal ganglia with corresponding low signal on ADC.",
      observations: [
        {
          id: "voice-1",
          concept: "diffusion",
          role: "finding",
          source: "voice",
          findingsText:
            "Restricted diffusion in the right basal ganglia with corresponding low signal on ADC.",
        },
      ],
    });
    const terms = licensedTerms(snapshot, AFFIRM(snapshot.findings));
    expect(terms.has("infarct")).toBe(true);
  });

  it("refuses the licence when the evidence itself is denied", () => {
    // The brief's case C. The words "diffusion restriction" are present, inside a
    // negation — which is precisely the case a substring test cannot tell apart.
    const corpus = "No diffusion restriction. ADC maps were obtained.";
    const snapshot = brain({ findings: corpus });
    expect(licensedSyntheses(snapshot, AFFIRM(corpus))).toEqual([]);
  });

  it("refuses the licence when only one half of the evidence is supplied", () => {
    const corpus = "Restricted diffusion in the right basal ganglia.";
    const snapshot = brain({ findings: corpus, technique: "MRI brain on 3T, T1W and T2W sequences." });
    expect(licensedSyntheses(snapshot, AFFIRM(corpus))).toEqual([]);
  });

  it("refuses the licence outside an MRI brain study", () => {
    const corpus = "Restricted diffusion in the right basal ganglia with low ADC.";
    const ls = brain({ family: "spine", modality: "MRI", region: "Lumbosacral Spine", findings: corpus });
    expect(licensedSyntheses(ls, AFFIRM(corpus))).toEqual([]);
    expect(isMriBrainStudy(ls)).toBe(false);
    expect(isMriBrainStudy(brain({ findings: corpus }))).toBe(true);
  });

  it("agrees with the persona router about which study is an MRI brain", () => {
    // The licence must never exist in a run where the model was not shown the MRI brain
    // rules it comes from, and vice versa: one predicate, two consumers.
    const matrix: Array<[string, Partial<ComposerInputSnapshot>]> = [
      ["mri brain", { modality: "MRI", family: "brain" }],
      ["mr brain", { modality: "MR", family: "brain" }],
      ["ct brain", { modality: "CT", family: "brain" }],
      ["mri ls spine", { modality: "MRI", family: "spine", region: "Lumbosacral Spine" }],
      ["mri cervical spine", { modality: "MRI", family: "spine", spineSegment: "cervical" }],
      ["xray chest", { modality: "DX", family: "chest" }],
      ["usg abdomen", { modality: "US", family: "abdomen" }],
    ];
    for (const [label, study] of matrix) {
      const snapshot = brain(study);
      const routerLoadsBrainModule = selectPersonaModules(snapshot).includes(CARE_MRI_BRAIN);
      expect(isMriBrainStudy(snapshot), `${label}: licence scope vs persona routing`).toBe(
        routerLoadsBrainModule,
      );
    }
  });

  it("never licenses the characterisation that travels with a diagnosis", () => {
    // §58's own prohibition list. The evidence is complete; none of these words may be
    // reached with it, so each stays a grounding failure.
    const snapshot = brain({
      findings: "Restricted diffusion in the right basal ganglia with corresponding low ADC.",
    });
    const terms = licensedTerms(snapshot, AFFIRM(snapshot.findings));
    for (const forbidden of ["occlusion", "thrombus", "hemorrhage", "herniation", "embolism", "stenosis"]) {
      expect(terms.has(forbidden), `a synthesis rule must not license ${forbidden}`).toBe(false);
    }
  });

  it("every rule's own citation resolves, and still says what the rule claims", () => {
    // The rule is only as trustworthy as its citation — so the citation is read FROM the
    // rule, not written out again here. A rule that renamed its section, moved to
    // another pack or dropped the `§` would otherwise keep licensing in silence, with
    // this file still green and the review panel still printing the old reference.
    const packs = new Map<string, string>();
    for (const rule of SYNTHESIS_RULES) {
      const cited = /^(\S+\.md)\s§(\d+)$/.exec(rule.kbSource);
      expect(
        cited,
        `${rule.id}: kbSource must be "<pack path from the repo root> §<section>", got "${rule.kbSource}"`,
      ).not.toBeNull();
      const [, file, number] = cited!;
      let markdown = packs.get(file);
      if (markdown === undefined) {
        markdown = readFileSync(new URL(`../../../../../${file}`, import.meta.url), "utf8");
        packs.set(file, markdown);
      }
      const body = knowledgeSection(markdown, Number(number));
      expect(body, `${file} no longer carries a section ${number}`).not.toBeNull();
      // The pack is hard-wrapped at ~72 columns, so a sentence the authority states
      // across a line break must still read as one sentence here.
      const text = (body ?? "").toLowerCase().replace(/\s+/g, " ");
      for (const requirement of rule.requires) {
        // One of the wordings this requirement accepts must be named by the section it
        // comes from — otherwise the rule demands evidence the pack never mentioned.
        expect(
          requirement.some((alt) => text.includes(alt)),
          `${rule.id}: §${number} names none of ${JSON.stringify(requirement)}`,
        ).toBe(true);
      }
      // And the diagnosis it grants is the one the section draws.
      expect(
        rule.licenses.some((term) => text.includes(term)),
        `${rule.id}: §${number} reaches none of ${JSON.stringify(rule.licenses)}`,
      ).toBe(true);
      expect(text).toContain("do not additionally infer");
      // The licence is impression-level, exactly as the section says.
      expect(text).toContain("synthesize");
    }
  });

  it("the MRI brain section 58 names the evidence and forbids the extras", () => {
    // The same citation, read as prose a radiologist can check by opening the pack.
    const kb = readFileSync(
      new URL("../../../../../ai-knowledge/care-radiologist/mri-brain-v1.md", import.meta.url),
      "utf8",
    );
    const body = knowledgeSection(kb, 58);
    expect(body, "mri-brain-v1.md no longer carries a section 58").not.toBeNull();
    const text = (body ?? "").toLowerCase().replace(/\s+/g, " ");
    expect(text).toContain("diagnostic synthesis");
    expect(text).toContain("restricted diffusion");
    expect(text).toContain("adc");
    expect(text).toContain("infarct");
    expect(text).toContain("do not additionally infer");
  });
});

/**
 * The body of a numbered section in a CARE knowledge pack: from `58. TITLE` to the
 * next banner-headed section. A banner is the pack's own `======` rule above and below
 * the heading, and a bare `^\\d+\\.` line is NOT a section boundary — nested ordered
 * lists use the same shape inside a section.
 */
function knowledgeSection(markdown: string, number: number): string | null {
  const lines = markdown.split(/\r?\n/);
  const heading = new RegExp(`^${number}\\.\\s`);
  let start = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (heading.test(lines[i] ?? "") && /^=+$/.test(lines[i - 1]?.trim() ?? "")) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  for (let j = start + 2; j < lines.length; j += 1) {
    const line = lines[j] ?? "";
    if (/^=+$/.test(line.trim()) && /^\d+\.\s/.test(lines[j + 1] ?? "")) {
      return lines.slice(start, j).join("\n");
    }
  }
  return lines.slice(start).join("\n");
}

describe("the licence is exercised in the open", () => {
  it("names the evidence and the section when the draft uses the word", () => {
    const snapshot = brain({
      findings: "Restricted diffusion in the right basal ganglia with corresponding low signal on ADC.",
    });
    const notices = usedSynthesisNotices(
      snapshot,
      AFFIRM(snapshot.findings),
      "acute infarct in the right basal ganglia.",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("restricted diffusion");
    expect(notices[0]).toContain("mri-brain-v1.md §58");
  });

  it("says nothing when the draft never reached the diagnosis", () => {
    const snapshot = brain({
      findings: "Restricted diffusion in the right basal ganglia with corresponding low signal on ADC.",
    });
    expect(usedSynthesisNotices(snapshot, AFFIRM(snapshot.findings), "basal ganglia lesion.")).toEqual([]);
  });

  it("a draft cannot license itself", () => {
    // The evidence is nowhere in the INPUT, only in the answer the model produced.
    // Grounding a diagnosis on the model's own sentence would let any draft vouch for
    // itself, so the licence is computed from the snapshot and never from the draft.
    const snapshot = brain({ findings: "Right basal ganglia lesion." });
    const v = validateComposerOutput(
      snapshot,
      {
        findings: "Restricted diffusion in the right basal ganglia with corresponding low ADC.",
        impression: "Acute infarct in the right basal ganglia.",
        recommendation: "",
        unresolvedQuestions: [],
        warnings: [],
      },
      { kind: "FULL_REPORT" },
    );
    expect(v.errors).toContain("unsupported_abnormality");
  });
});

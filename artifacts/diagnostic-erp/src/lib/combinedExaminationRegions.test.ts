/**
 * A combined examination must report as ONE combined examination.
 *
 * Filed from production on 2026-11-01: `MRI BRAIN + CX SCR` opened with only
 * `MRI Brain — Standard Normal` on the STARTING CANVAS. The cervical component was
 * not missing from the catalogue and was not ambiguous — it was never looked at.
 * `matchStudyRegion()` truncates the name at the first `+`/`with`/`and` and only
 * reads the remainder if the primary clause matched nothing, and it returns a
 * single string; `useReportingStudySetup` then wraps that one string in a
 * one-element array. `CX SCR` additionally resolves to nothing, because the study
 * tab is named `Cervical Spine` and the synonym table carried only lumbar/ls.
 *
 * The policy this has to respect is RIS-001 (#1039): the PRIMARY examination
 * chooses the report format, and a screening sequence must not change it. So
 * widening coverage must never cost the radiologist the normal they get today —
 * the last test pins exactly that, because `resolveNormalBootstrapFormat` answers
 * `ambiguous` (no auto-apply at all) when two complete normals survive the region
 * filter, which is what a naive multi-region change would have done to every
 * combined brain+spine study in the clinic.
 */
import { describe, expect, it } from "vitest";
import { matchStudyRegion, resolveAutoStudyRegion } from "./studyRegion";
import { resolveNormalBootstrapFormat } from "./zai-workspace/normalBootstrap";

// The MRI tabs this clinic actually carries, in the order the workspace reads them.
const REGIONS = ["Brain", "Cervical Spine", "LS Spine", "Whole Spine", "Knee"];

describe("combined examination names resolve to every region they cover", () => {
  it("MRI BRAIN + CX SCR still resolves the primary as Brain", () => {
    expect(matchStudyRegion("MRI BRAIN + CX SCR", REGIONS)).toBe("Brain");
  });

  it("the cervical half of the name is not dropped", () => {
    const m = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI BRAIN + CX SCR",
      orderedRegionNames: REGIONS,
    });
    expect(m.region).toBe("Brain");
    expect(m.regions).toEqual(["Brain", "Cervical Spine"]);
  });

  it("the abbreviation is understood in either order, and `with` counts as a join", () => {
    // Written order, not primary-first: `resolveAutoStudyRegion` answers "Brain" as
    // the format owner for this name too, and the coverage list now leads with that
    // owner, so the two agree whatever order the order-entry wrote the name in.
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI CX SCR + BRAIN", orderedRegionNames: REGIONS,
    }).region).toBe("Brain");
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI CX SCR + BRAIN", orderedRegionNames: REGIONS,
    }).regions).toEqual(["Brain", "Cervical Spine"]);
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI Brain with Cervical Spine Screening", orderedRegionNames: REGIONS,
    }).regions).toEqual(["Brain", "Cervical Spine"]);
  });

  it("a single-region name resolves exactly one region — nothing widens", () => {
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI BRAIN", orderedRegionNames: REGIONS,
    }).regions).toEqual(["Brain"]);
    // The synonym table must keep working on its own: LS SPINE is the tab, the
    // order says lumbar.
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI LUMBAR SPINE", orderedRegionNames: REGIONS,
    }).regions).toEqual(["LS Spine"]);
  });

  it("a region is never counted twice because it appears in both clauses", () => {
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI BRAIN + BRAIN W/O CONTRAST", orderedRegionNames: REGIONS,
    }).regions).toEqual(["Brain"]);
  });

  it("widening coverage does not take the starting normal away — the primary's normal still auto-applies", () => {
    const brainNormal = {
      id: "f-brain", name: "MRI Brain — Standard Normal", modality: "MR", bodyPart: "Brain",
      isCompleteNormal: true, findings: "No acute intracranial abnormality.", impression: "Normal MRI brain.",
    };
    const cervicalNormal = {
      id: "f-c-spine", name: "MRI Cervical Spine — Normal", modality: "MR", bodyPart: "Cervical Spine",
      isCompleteNormal: true, findings: "No cord compression.", impression: "Normal MRI cervical spine.",
    };
    const ctx = {
      modality: "MR",
      region: "Brain",
      regions: ["Brain", "Cervical Spine"],
      studyDescription: "MRI BRAIN + CX SCR",
      source: "auto" as const,
    };

    const decision = resolveNormalBootstrapFormat({ ctx, formats: [brainNormal, cervicalNormal] as never });

    expect(decision, "a combined examination must not fall to `ambiguous` and lose its normal").not.toBeNull();
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(decision.format.id).toBe("f-brain");
    }
  });

  it("coverage never moves the region that owns the report format", () => {
    // Study Tab names are owner-editable, and this clinic's catalogue carries both
    // spellings of the cervical examination in live use. The raw matcher reads the
    // billed name as one tab and the abbreviation reading as the other, so
    // coverage can disagree with the format owner — and every consumer takes
    // `regions[0]` as the primary. Widening coverage must never cost the
    // radiologist the format of the examination they actually ordered.
    const both = ["C Spine", "Cervical Spine", "Brain"];
    const m = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: null,
      billedTestName: "MRI C SPINE",
      orderedRegionNames: both,
    });
    expect(m.region).toBe("C Spine");
    expect(m.regions[0], "the coverage list must lead with the format owner").toBe(m.region);
    expect(m.regions, "coverage still records the other spelling of the same examination").toContain("Cervical Spine");
  });
});

/**
 * OWNER DECISION 2026-11-01, on production worklist row 12326:
 *
 *  • "The confirmed examination actually performed takes precedence over the
 *    billing label when selecting the reporting format."
 *  • "Where billing, worklist and acquisition descriptions disagree, preserve the
 *    billed identity and ask the radiologist to confirm the reporting scope."
 *  • "Do not infer an additional examination from an ambiguous DICOM series name alone."
 *  • "Do not alter billing records automatically."
 *
 * Measured on the deployed build: the row was billed as `MRI Brain`, its
 * StudyDescription said `MRI BRAIN + CX SCR`, and the report covered Brain only —
 * because the billed hint won and `MRI Brain` names one region. The row this fix
 * is judged against had `reportId = NULL`, i.e. nothing was ever billed against
 * it, so the unbilled arm (which reads the acquisition name and already widened)
 * was the only one that worked.
 *
 * The precedence therefore cannot be a silent swap of one hint for the other:
 * the acquisition label is what the scanner technologist typed, and CARE has no
 * third source that says the second examination was actually performed. So the
 * disagreement is DETECTED here and DECIDED by the radiologist — which is what
 * "the confirmed examination actually performed" means, and what his second
 * sentence asks for. `region`/`regions` answers stay exactly as they are until
 * he confirms, so no report changes because a name changed.
 */
describe("a billed label narrower than the examination performed is proposed, not applied", () => {
  const COMBINED = {
    modality: "MR",
    studyDescription: "MRI BRAIN + CX SCR",
    billedTestName: "MRI Brain",
    orderedRegionNames: REGIONS,
  };

  it("proposes the combined scope and names what the acquisition adds", () => {
    const p = resolveAutoStudyRegion(COMBINED).scopeProposal;
    expect(p).not.toBeNull();
    expect(p?.billedRegions).toEqual(["Brain"]);
    expect(p?.performedRegions).toEqual(["Brain", "Cervical Spine"]);
    expect(p?.addedRegions).toEqual(["Cervical Spine"]);
    expect(p?.proposedRegions).toEqual(["Brain", "Cervical Spine"]);
  });

  it("writes nothing until the radiologist confirms — the report is still Brain-only", () => {
    const m = resolveAutoStudyRegion(COMBINED);
    expect(m.region).toBe("Brain");
    expect(m.regions).toEqual(["Brain"]);
    expect(m.source, "the billed identity is preserved").toBe("billed");
  });

  it("the performed examination owns the format of the confirmed scope", () => {
    // Booked as the cervical screen, acquired as brain plus cervical. On confirm
    // the primary becomes the examination that was actually performed, so the
    // report format follows the acquisition and not the billing label.
    const p = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI BRAIN + CX SCR",
      billedTestName: "MRI CERVICAL SPINE",
      orderedRegionNames: REGIONS,
    }).scopeProposal;
    expect(p?.proposedRegions).toEqual(["Brain", "Cervical Spine"]);
    expect(p?.addedRegions).toEqual(["Brain"]);
  });

  it("nothing is added to the proposal that the acquisition does not name", () => {
    // The bill may claim MORE coverage than the acquisition label spells out (a
    // sloppy scanner name). Asking the radiologist to confirm a NARROWING would
    // retire sentences, and this rule never does that: no disagreement, no strip.
    const m = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI LUMBAR SPINE",
      billedTestName: "MRI LS SPINE WITH SCREENING WHOLE SPINE",
      orderedRegionNames: REGIONS,
    });
    expect(m.scopeProposal).toBeNull();
    expect(m.regions).toEqual(["LS Spine", "Whole Spine"]);
  });

  it("two readings of one examination are not a disagreement", () => {
    expect(resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI BRAIN + CERVICAL SPINE",
      billedTestName: "MRI BRAIN + CX SCR",
      orderedRegionNames: REGIONS,
    }).scopeProposal).toBeNull();
  });

  it("a bill that names no examination is not a disagreement either — the acquisition is adopted", () => {
    // This is today's fallback and must stay silent: nothing disagrees, because
    // only one source spoke.
    const m = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI BRAIN + CX SCR",
      billedTestName: "MRI Stroke Protocol 3T",
      orderedRegionNames: REGIONS,
    });
    expect(m.scopeProposal).toBeNull();
    expect(m.source).toBe("dicom");
    expect(m.regions).toEqual(["Brain", "Cervical Spine"]);
  });

  it("an acquisition label that names no examination proposes nothing", () => {
    // The third sentence of the decision: an ambiguous name — a series-style
    // label, a protocol code, an empty StudyDescription — must never widen a
    // report. Only a study-level name that resolves to a real Study Tab can.
    for (const ambiguous of ["MRI", "  ", "3D T2 SPACE", "MRI BRAIN"]) {
      const m = resolveAutoStudyRegion({
        modality: "MR",
        studyDescription: ambiguous === "MRI BRAIN" ? null : ambiguous,
        billedTestName: ambiguous === "MRI BRAIN" ? "MRI BRAIN" : "MRI Brain",
        orderedRegionNames: REGIONS,
      });
      expect(m.scopeProposal, `“${ambiguous}” must not propose a second examination`).toBeNull();
    }
  });
});

/**
 * The CONTENT half of the same decision: "Generate one combined report. Include MRI
 * Brain and Cervical Spine findings … Generate one combined Impression."
 *
 * Care Diagnostics already authored that report. `ai_normal_report_templates` row 3 is
 * `MRI Brain – Screening Cervical Spine Normal`, whose Findings read `Brain: …` then
 * `Cervical Spine: …` and whose Impression reads "Normal MRI brain. Normal cervical
 * spine screening." One format, both examinations, one Impression — and it was never
 * chosen, because the picker's screening signal is a word match on the protocol name
 * and the StudyDescription, and `CX SCR` does not spell "screening". With no signal,
 * the non-screening arm of that match actively filters the screening row OUT of the
 * pool, so the plain brain normal won and the second examination had no section.
 *
 * What a second examination needs is a row that DOCUMENTS it. The fix is not to read
 * "screening" off the region count: measured against this clinic's own migrated library,
 * that swap made a Brain + Cervical study take `MRI Brain — Screening Normal` — limited
 * planar, limited sequence — over `MRI Brain — Standard Normal`, and still wrote no
 * cervical findings, a screening technique statement about an examination that was not a
 * brain screen. So the confirmed scope is matched against each candidate's own prose:
 * coverage decides, the word "screening" decides nothing here.
 *
 * And the scope only counts once the radiologist has confirmed it, because before his
 * answer the report covers one examination and the plain normal is the right format for it.
 */
describe("a confirmed combined scope selects the clinic's combined normal", () => {
  // Ownership is what lets a normal be retired by a Quick Select tile: each prose
  // sentence the format writes is a ledger row attributed to the baseline that authored
  // it. Every row below carries that manifest because the picker only auto-applies rows
  // that carry one.
  const owns = (key: string, rows: Array<{ region?: string; concept: string; text: string }>) => ({
    kind: "care.full_report_baseline.v1",
    version: 1,
    revision: `${key}.v1`,
    observations: rows.map((r, i) => ({
      id: `${key}-${i}`,
      field: "findings" as const,
      concept: r.concept,
      conflictGroup: r.concept,
      anatomicalSection: r.region ?? "Brain",
      region: r.region ?? "Brain",
      renderedText: r.text,
    })),
  });

  const plainBrain = {
    id: "f-brain-plain", name: "MRI Brain — Standard Normal", modality: "MR", bodyPart: "Brain",
    isCompleteNormal: true, findings: "Brain parenchyma shows normal signal intensity.",
    impression: "Normal MRI brain.",
    baselineManifest: owns("brain-plain", [
      { concept: "brain-signal-intensity", text: "Brain parenchyma shows normal signal intensity." },
    ]),
  };
  const combinedNormal = {
    id: "f-brain-cspine-screening", name: "MRI Brain – Screening Cervical Spine Normal",
    modality: "MR", bodyPart: "Brain", isCompleteNormal: true,
    findings: "Brain: Normal signal intensity on all sequences.\nCervical Spine: Normal alignment. The canal is capacious.",
    impression: "Normal MRI brain. Normal cervical spine screening.",
    baselineManifest: owns("brain-cspine", [
      { concept: "brain-signal-intensity", text: "Brain: Normal signal intensity on all sequences." },
      { region: "Cervical Spine", concept: "cervical-alignment", text: "Cervical Spine: Normal alignment. The canal is capacious." },
    ]),
  };
  // Both rows exist in the library this rig migrated from `radiology_snippets`
  // (`MRI Brain — Screening Normal`, id 15; `MRI Brain — Standard Normal`, id 9), which
  // is why this case is a measurement and not a hypothesis.
  const screeningBrainOnly = {
    id: "f-brain-screening", name: "MRI Brain — Screening Normal", modality: "MR", bodyPart: "Brain",
    isCompleteNormal: true,
    findings: "Brain parenchyma shows no gross signal abnormality on screening sequences.",
    impression: "Normal MRI brain screening.",
    baselineManifest: owns("brain-screening", [
      { concept: "brain-signal-screening", text: "Brain parenchyma shows no gross signal abnormality on screening sequences." },
    ]),
  };

  const applyFor = (regions: string[], source: "billed" | "override" = "override") => resolveNormalBootstrapFormat({
    ctx: {
      modality: "MR", region: regions[0], regions,
      studyDescription: "MRI BRAIN + CX SCR", source,
    },
    formats: [plainBrain, combinedNormal] as never,
  });

  it("applies the combined normal once the scope covers both examinations", () => {
    const decision = applyFor(["Brain", "Cervical Spine"]);
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(decision.format.id).toBe("f-brain-cspine-screening");
      expect(decision.format.findings).toContain("Cervical Spine:");
      expect(decision.format.impression).toContain("cervical spine");
    }
  });

  it("a combined scope with no combined normal keeps the normal it gets today", () => {
    // The mutant this pin exists to kill: reading the region count as a screening marker
    // made `wantsScreening` true here, the screening arm preferred id 15 over id 9, and a
    // full brain examination was documented as a limited-planar brain screen. A second
    // examination is answered by a row that speaks for it, not by screening prose.
    const decision = resolveNormalBootstrapFormat({
      ctx: {
        modality: "MR", region: "Brain", regions: ["Brain", "Cervical Spine"],
        studyDescription: "MRI BRAIN + CX SCR", source: "override",
      },
      formats: [plainBrain, screeningBrainOnly] as never,
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(decision.format.id).toBe("f-brain-plain");
      expect(decision.format.findings).not.toContain("screening sequences");
    }
  });

  it("the row that covers the scope outranks a screening-labelled row that does not", () => {
    const decision = resolveNormalBootstrapFormat({
      ctx: {
        modality: "MR", region: "Brain", regions: ["Brain", "Cervical Spine"],
        studyDescription: "MRI BRAIN + CX SCR", source: "override",
      },
      formats: [plainBrain, screeningBrainOnly, combinedNormal] as never,
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") expect(decision.format.id).toBe("f-brain-cspine-screening");
  });

  it("an un-owned row that covers the scope still cannot take the scaffold away", () => {
    // The ownership rule that governs every other auto-apply holds here: a Formats row
    // with no curated baseline manifest has no ledger attribution, so the sentences it
    // writes cannot be retired by the Quick Select tile that contradicts them. It
    // applies when the radiologist chooses it in Starting Canvas; the automatic pass
    // does not reach for it.
    const combinedUnowned = { ...combinedNormal, baselineManifest: undefined };
    const decision = resolveNormalBootstrapFormat({
      ctx: {
        modality: "MR", region: "Brain", regions: ["Brain", "Cervical Spine"],
        studyDescription: "MRI BRAIN + CX SCR", source: "override",
      },
      formats: [plainBrain, combinedUnowned] as never,
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") expect(decision.format.id).toBe("f-brain-plain");
  });

  it("keeps the plain normal while the report covers only the brain", () => {
    const decision = applyFor(["Brain"], "billed");
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") expect(decision.format.id).toBe("f-brain-plain");
  });

  it("never gates: a combined scope with no combined normal still gets its normal", () => {
    // The coverage preference is an ordering, not a requirement. If it could empty the
    // pool, a Knee-plus-Brain study would lose the starting normal it gets today.
    const decision = resolveNormalBootstrapFormat({
      ctx: {
        modality: "MR", region: "Brain", regions: ["Brain", "Knee"],
        studyDescription: "MRI BRAIN + KNEE", source: "override",
      },
      formats: [plainBrain] as never,
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") expect(decision.format.id).toBe("f-brain-plain");
  });

  it("a single-region study never picks up a screening normal it did not order", () => {
    // The other direction of the same rule: this must not become a general fondness for
    // screening prose, or every plain brain MRI would gain a cervical spine.
    const decision = resolveNormalBootstrapFormat({
      ctx: {
        modality: "MR", region: "Brain", regions: ["Brain"],
        studyDescription: "MRI BRAIN", source: "billed",
      },
      formats: [plainBrain, combinedNormal] as never,
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") expect(decision.format.id).toBe("f-brain-plain");
  });
});

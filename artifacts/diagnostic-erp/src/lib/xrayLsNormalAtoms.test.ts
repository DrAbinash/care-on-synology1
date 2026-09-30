/**
 * X-ray LS coverage- and numbering-aware NORMAL baseline (spec §5, §6; library
 * §2). The properties under test are the ones the spec calls out explicitly: a
 * normal study may only be certified for what the views can see; transitional or
 * unanchored numbering must not read as a confidently numbered five-segment
 * spine; and each section keeps ONE sentence per state so an abnormal selection
 * always supersedes the line the baseline actually wrote.
 */
import { describe, expect, it } from "vitest";
import {
  LS_BASELINE_CONTRACTS,
  LS_NORMAL_IMPRESSION,
  LS_NORMAL_SENTENCES,
  buildLsNormalAtomSpecs,
  buildLsNormalAtoms,
  buildLsNormalCoverageNotes,
} from "./xrayLsNormalAtoms";
import { UNSET_LS_NUMBERING, type LsNumbering } from "./xrayLsNumbering";
import { parseXrayLsViews } from "./xrayLsViews";

const LIVE_PROTOCOL =
  "AP and lateral views of the lumbar spine (with flexion-extension views where indicated).";

const FULL_SERIES = [
  "AP lumbar radiograph.",
  "Lateral lumbar radiograph.",
  "Right oblique views.",
  "Left oblique views.",
  "Flexion view.",
  "Extension view.",
  "Spot L5-S1 view.",
  "The L5-S1 junction is adequately visualized.",
  "The posterior elements are adequately visualized.",
  "T12-L1 is included in the field of view.",
  "The sacroiliac joints are adequately visualized.",
  "No significant rotation.",
  "No motion artifact.",
].join(" ");

const STANDARD_5: LsNumbering = {
  basis: "standard",
  lumbarTypeCount: 5,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

const LSTV_6: LsNumbering = {
  basis: "lstv",
  lumbarTypeCount: 6,
  designatedL5Position: 5,
  evidence: null,
  castellvi: null,
};

const specsFor = (text: string, numbering: LsNumbering) =>
  buildLsNormalAtomSpecs(parseXrayLsViews(text), numbering);

const findingsOf = (text: string, numbering: LsNumbering, concept: string) =>
  specsFor(text, numbering).find((a) => a.concept === concept)?.findings ?? "";

describe("one sentence per state — the supersession contract", () => {
  it("writes each section in report order (spec §17)", () => {
    expect(specsFor(FULL_SERIES, STANDARD_5).map((s) => s.concept)).toEqual([
      "ls_numbering_basis",
      "ls_alignment",
      "ls_vertebral_body_height",
      "ls_no_acute_fracture",
      "ls_disc_space",
      "posterior_elements",
      "ls_l5s1_junction",
      "ls_si_joints",
      "ls_no_hardware",
    ]);
  });

  it("emits the exact sentences the abnormal tiles supersede", () => {
    const byConcept = new Map(specsFor(FULL_SERIES, STANDARD_5).map((s) => [s.concept, s.findings]));
    expect(byConcept.get("ls_alignment")).toBe(LS_BASELINE_CONTRACTS.alignment);
    expect(byConcept.get("ls_vertebral_body_height")).toBe(LS_BASELINE_CONTRACTS.vertebrae);
    expect(byConcept.get("ls_disc_space")).toBe(LS_BASELINE_CONTRACTS.discs);
    expect(byConcept.get("posterior_elements")).toBe(LS_BASELINE_CONTRACTS.posteriorElements);
    expect(byConcept.get("ls_no_acute_fracture")).toBe(LS_BASELINE_CONTRACTS.noFracture);
    expect(byConcept.get("ls_no_hardware")).toBe(LS_BASELINE_CONTRACTS.noHardware);
    expect(byConcept.get("ls_si_joints")).toBe(LS_BASELINE_CONTRACTS.siPreserved);
    expect(byConcept.get("ls_l5s1_junction")).toBe(LS_BASELINE_CONTRACTS.junctionAdequate);
  });

  it("states numbering before it names any level", () => {
    expect(findingsOf(FULL_SERIES, STANDARD_5, "ls_numbering_basis")).toBe(
      LS_NORMAL_SENTENCES.numberingStandard,
    );
  });

  it("marks every sentence as a supersessable baseline, never an abnormality", () => {
    const specs = specsFor(FULL_SERIES, STANDARD_5);
    expect(specs.every((s) => s.role === "baseline")).toBe(true);
    expect(specs.every((s) => s.impression === undefined)).toBe(true);
  });

  it("leaves no unfilled token, double space or empty line", () => {
    for (const spec of specsFor(LIVE_PROTOCOL, UNSET_LS_NUMBERING).concat(specsFor(FULL_SERIES, LSTV_6))) {
      expect(spec.findings).not.toMatch(/\[[a-zA-Z]]/);
      expect(spec.findings).not.toMatch(/\s{2,}/);
      expect(spec.findings.trim()).not.toBe("");
    }
  });
});

describe("coverage limits what may be certified (spec §2, §6)", () => {
  it("keeps the disc sentence stable and puts the caveat in its own atom", () => {
    // The live protocol records no junction coverage: the disc line stays the
    // contract sentence, and the junction atom carries the limitation.
    expect(findingsOf(LIVE_PROTOCOL, STANDARD_5, "ls_disc_space")).toBe(LS_BASELINE_CONTRACTS.discs);
    expect(findingsOf(LIVE_PROTOCOL, STANDARD_5, "ls_l5s1_junction")).toBe(
      LS_NORMAL_SENTENCES.junctionNotAdequate,
    );
  });

  it("refuses to certify the pars when the posterior elements were never seen", () => {
    expect(findingsOf(LIVE_PROTOCOL, STANDARD_5, "posterior_elements")).toBe(
      LS_NORMAL_SENTENCES.parsNotAssessed,
    );
    expect(findingsOf(FULL_SERIES, STANDARD_5, "posterior_elements")).toBe(
      LS_NORMAL_SENTENCES.posteriorElements,
    );
  });

  it("hedges the sacroiliac line when SI adequacy was not recorded", () => {
    // Verbatim shape of the seeded normal_text: "where visualized".
    expect(findingsOf(LIVE_PROTOCOL, STANDARD_5, "ls_si_joints")).toBe(LS_NORMAL_SENTENCES.siHedged);
    expect(findingsOf("Lateral lumbar radiograph.", STANDARD_5, "ls_si_joints")).toBe(
      LS_NORMAL_SENTENCES.siNotAssessed,
    );
  });

  it("says alignment cannot be assessed when no lateral view exists", () => {
    expect(findingsOf("AP lumbar radiograph.", STANDARD_5, "ls_alignment")).toBe(
      LS_NORMAL_SENTENCES.alignmentNotAssessed,
    );
    expect(findingsOf("AP lumbar radiograph.", STANDARD_5, "posterior_elements")).toBe(
      LS_NORMAL_SENTENCES.parsNotAssessed,
    );
  });
});

describe("numbering uncertainty (spec §4, §6)", () => {
  it("makes no level-specific normal claim when nothing is established", () => {
    const discs = findingsOf(FULL_SERIES, UNSET_LS_NUMBERING, "ls_disc_space");
    expect(discs).not.toMatch(/L[1-5]-/);
    const numbering = findingsOf(FULL_SERIES, UNSET_LS_NUMBERING, "ls_numbering_basis");
    expect(numbering).toContain("not established");
    expect(numbering).toContain("not as an assumed L5-S1 junction");
  });

  it("keeps a transitional film from implying five segments", () => {
    const numbering = findingsOf(FULL_SERIES, LSTV_6, "ls_numbering_basis");
    expect(numbering).toContain("6 lumbar-type vertebrae are counted");
    expect(numbering).toContain("transitional lumbosacral vertebra");
    expect(numbering).toContain("designated L5");
    expect(numbering).toContain(LS_NORMAL_SENTENCES.numberingCaution);
  });

  it("lists the counted sequence when a transitional body is anchored", () => {
    expect(findingsOf(FULL_SERIES, LSTV_6, "ls_numbering_basis")).toContain(
      "labelled sequence L1, L2, L3, L4, L5, S1",
    );
  });

  it("collects the caveats the canvas shows beside the one-click normal", () => {
    const notes = buildLsNormalCoverageNotes(parseXrayLsViews(LIVE_PROTOCOL), UNSET_LS_NUMBERING);
    expect(notes).toContain(LS_NORMAL_SENTENCES.junctionNotAdequate);
    expect(notes).toContain(LS_NORMAL_SENTENCES.parsNotAssessed);
    expect(notes).toContain(LS_NORMAL_SENTENCES.t12l1NotRecorded);
    expect(notes).toContain(LS_NORMAL_SENTENCES.siHedged);
    expect(notes).toContain(LS_NORMAL_SENTENCES.numberingCaution);
    expect(notes).not.toContain(LS_NORMAL_SENTENCES.alignmentNotAssessed);
  });

  it("has nothing to warn about on a fully recorded study with standard numbering", () => {
    expect(
      buildLsNormalCoverageNotes(parseXrayLsViews(FULL_SERIES), STANDARD_5),
    ).toEqual([LS_NORMAL_SENTENCES.t12l1Included]);
  });
});

describe("baseline bundle", () => {
  it("applies as one reversible bundle in the lumbar region", () => {
    const ctx = parseXrayLsViews(FULL_SERIES);
    const built = buildLsNormalAtoms({ ctx, numbering: STANDARD_5 });
    expect(built.bundleId).toBe("xlsb-normal-ls");
    expect(built.observations).toHaveLength(buildLsNormalAtomSpecs(ctx, STANDARD_5).length);
    expect(built.observations.every((p) => p.bundleId === built.bundleId)).toBe(true);
    expect(built.observations.every((p) => p.region === "Lumbar Spine")).toBe(true);
    expect(built.observations.every((p) => p.source === "structured-template")).toBe(true);
    expect(built.observations.every((p) => p.role === "baseline")).toBe(true);
  });

  it("respects an explicit region override", () => {
    const built = buildLsNormalAtoms({
      region: "Lumbosacral Spine",
      ctx: parseXrayLsViews(LIVE_PROTOCOL),
      numbering: UNSET_LS_NUMBERING,
    });
    expect(built.observations.every((p) => p.region === "Lumbosacral Spine")).toBe(true);
  });

  it("exposes the impression seed", () => {
    expect(LS_NORMAL_IMPRESSION).toBe(
      "No acute osseous abnormality identified on the provided lumbosacral spine radiographs.",
    );
  });
});

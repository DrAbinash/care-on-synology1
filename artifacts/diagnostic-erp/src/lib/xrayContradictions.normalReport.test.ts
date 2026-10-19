/**
 * xrayContradictions.normalReport.test.ts — the false-alarm review of the three
 * surfaces the owner named for review in the PR #1077 final corrections round
 * (2026-10-20): the plain-film cervical lint, the plain-film LS lint, and the
 * dorso-lumbar MRI lint.
 *
 * What this file measures, and pins:
 *
 *   1. The COMPLETE normal reports the workspace actually writes — the X-ray
 *      cervical normal built from the shipped atoms for a full series, the
 *      shipped "XR LS Spine — Normal" and "XR LS Spine — Degenerative changes"
 *      formats, and the dorso-lumbar composition of the two shipped standard
 *      normals — produce ZERO contradiction warnings.
 *   2. The lints still HEAR after this pin: appending one genuine abnormality to
 *      each normal text fires the warning the pair exists for. A lint that
 *      stays silent because it is broken is worse than one that cries wolf.
 *
 * Why this is a review and not a rewrite: the MRI spine lint's false-positive
 * (measured 2026-10-19, fixed in this PR's previous round) came from a
 * BARE-WORD abnormal regex matching its own denial. The two plain-film lints
 * carry phrase-shaped abnormal regexes plus a whole-sentence denial guard — a
 * DIFFERENT, more conservative shape — and the dorso-lumbar lint already
 * carries both MRI guards from the previous round. The review's verdict is
 * therefore measured here rather than assumed: if any of these surfaces can
 * cry wolf on the shipped normals, this test goes red and the fix lands in the
 * lint, not in this pin.
 *
 * Warnings are advisory only. Nothing here rewrites or deletes clinical
 * interpretation — the radiologist always has the last word.
 */
import { describe, expect, it } from "vitest";

import {
  buildCervicalNormalAtoms,
  CERVICAL_NORMAL_IMPRESSION,
} from "./xrayCervicalNormalAtoms";
import { cervicalTextContradictions } from "./xrayCervicalContradictions";
import { parseXrayCervicalViews } from "./xrayCervicalViews";
import { lsTextContradictions } from "./xrayLsContradictions";
import { dorsoLumbarTextContradictions } from "./mriDorsoLumbarValidation";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import {
  MRI_DORSAL_STANDARD_NORMAL_FINDINGS,
  MRI_DORSAL_STANDARD_NORMAL_IMPRESSION,
} from "./zai-workspace/baselines/mriDorsalStandardNormal";
import {
  MRI_LS_SPINE_STANDARD_NORMAL_FINDINGS,
  MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION,
} from "./zai-workspace/fullReportBaseline";

/** The full-series technique the shipped normal atoms are built for. */
const CERVICAL_FULL_SERIES =
  "AP cervical radiograph. Lateral cervical radiograph. Open-mouth odontoid view. " +
  "The odontoid is adequately visualized. C7-T1 is adequately visualized. " +
  "The inferior visualization extends to T1. No significant rotation. No motion artifact.";

/** A shipped format's text, read from the library so this pin cannot drift
 *  from the wording the workspace actually writes. */
function shippedFormat(name: string): { findings: string; impression: string; technique: string } {
  const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === name);
  if (!f) throw new Error(`${name} missing from the shipped format library`);
  return { findings: f.findings, impression: f.impression, technique: f.technique };
}

/** The complete X-ray cervical normal the workspace writes for a full series —
 *  the exact sentences, joined the way the atom bundle prints them. */
function cervicalNormalText(): string {
  const built = buildCervicalNormalAtoms({ ctx: parseXrayCervicalViews(CERVICAL_FULL_SERIES) });
  return built.observations.map((o) => o.findingsText).join("\n");
}

describe("plain-film cervical lint — false-alarm review (PR #1077 final corrections round)", () => {
  it("stays silent on the complete shipped normal the workspace writes for a full series", () => {
    const warnings = cervicalTextContradictions({
      findingsText: cervicalNormalText(),
      impressionText: CERVICAL_NORMAL_IMPRESSION,
      techniqueText: CERVICAL_FULL_SERIES,
    });
    expect(warnings).toEqual([]);
  });

  it("still flags a listhesis appended to the same normal text (the lint is not broken)", () => {
    const warnings = cervicalTextContradictions({
      findingsText: `${cervicalNormalText()}\nAnterolisthesis of C5 over C6.`,
      impressionText: CERVICAL_NORMAL_IMPRESSION,
      techniqueText: CERVICAL_FULL_SERIES,
    });
    expect(warnings.some((w) => /listhesis/i.test(w))).toBe(true);
  });
});

describe("plain-film LS lint — false-alarm review (PR #1077 final corrections round)", () => {
  it("stays silent on the shipped XR LS Spine — Normal format", () => {
    const normal = shippedFormat("XR LS Spine — Normal");
    const warnings = lsTextContradictions({
      findingsText: normal.findings,
      impressionText: normal.impression,
      techniqueText: normal.technique,
    });
    expect(warnings).toEqual([]);
  });

  it("stays silent on the shipped XR LS Spine — Degenerative changes format (a true abnormal report whose impression matches its findings)", () => {
    // A genuine abnormal report is the other place an advisory lint must not
    // cry wolf: the degenerative format's findings and impression agree, so no
    // normal-vs-abnormal pair has both of its sides asserted.
    const degenerative = shippedFormat("XR LS Spine — Degenerative changes");
    const warnings = lsTextContradictions({
      findingsText: degenerative.findings,
      impressionText: degenerative.impression,
      techniqueText: degenerative.technique,
    });
    expect(warnings).toEqual([]);
  });

  it("still flags a spondylolisthesis appended to the shipped normal text", () => {
    const normal = shippedFormat("XR LS Spine — Normal");
    const warnings = lsTextContradictions({
      findingsText: `${normal.findings}\nGrade 1 spondylolisthesis at L4-L5.`,
      impressionText: normal.impression,
      techniqueText: normal.technique,
    });
    expect(warnings.some((w) => /listhesis/i.test(w))).toBe(true);
  });
});

describe("dorso-lumbar MRI lint — false-alarm review (guards landed in the previous round)", () => {
  it("stays silent on the two shipped standard normals composed as one dorso-lumbar report", () => {
    // What a Dorso-Lumbar study's complete normal holds: the dorsal half and
    // the lumbar half, each its own shipped standard normal. Both guards from
    // the previous round (clause-denied matches are not abnormality
    // statements; a sentence matching the pair's own abnormal side is not its
    // normal claim) must keep every pair quiet on this text.
    const warnings = dorsoLumbarTextContradictions({
      findingsText: `${MRI_DORSAL_STANDARD_NORMAL_FINDINGS}\n${MRI_LS_SPINE_STANDARD_NORMAL_FINDINGS}`,
      impressionText: `${MRI_DORSAL_STANDARD_NORMAL_IMPRESSION} ${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}`,
      state: null,
    });
    expect(warnings.filter((w) => /Contradiction in/.test(w))).toEqual([]);
  });

  it("still flags a genuine normal-versus-abnormal contradiction on the composed report", () => {
    const warnings = dorsoLumbarTextContradictions({
      findingsText: `${MRI_DORSAL_STANDARD_NORMAL_FINDINGS}\n${MRI_LS_SPINE_STANDARD_NORMAL_FINDINGS}\nAcute compression fracture of the L1 vertebral body.`,
      impressionText: `${MRI_DORSAL_STANDARD_NORMAL_IMPRESSION} ${MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION}`,
      state: null,
    });
    expect(warnings.some((w) => /Contradiction in/i.test(w))).toBe(true);
  });
});

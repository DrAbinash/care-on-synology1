/**
 * The Text-to-Report fixtures must be the clinic's live normal templates, not a copy
 * that drifts from them.
 *
 * `api-server/src/testSupport/textToReportCases.ts` cannot import these manifests: the
 * two packages are separate compilation units, and the ERP's `@/` aliases do not resolve
 * inside api-server's `pnpm typecheck`. So the clinical battery's scaffold sentences are
 * COPIED — and a copy is exactly the kind of fixture that goes quietly false. If a
 * template sentence is reworded, retired or added and the fixture is not, the validator
 * battery keeps passing over a scaffold the product no longer produces: a normal the
 * live template still prints would read as an invented one, and one it deleted would
 * read as grounded. Both are wrong in the direction that lets a bad draft through.
 *
 * This file pins the copy from the other side — inside the package that owns the
 * templates, against the manifests Mode A actually composes from, concept by concept and
 * sentence by sentence, in both directions.
 */
import { describe, expect, it } from "vitest";
import { MRI_BRAIN_STANDARD_NORMAL_MANIFEST, MRI_BRAIN_STANDARD_NORMAL_IMPRESSION } from "@/lib/zai-workspace/baselines/mriBrainStandardNormal";
import {
  MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST,
  MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION,
} from "@/lib/zai-workspace/fullReportBaseline";
import {
  MRI_BRAIN_NORMALS,
  MRI_BRAIN_NORMAL_IMPRESSION,
  LS_GENERAL_NORMALS,
  LS_LEVELS,
  LS_NORMAL_IMPRESSION,
  lsLevelNormals,
  brainStudy,
  lsStudy,
} from "../../../../api-server/src/testSupport/textToReportCases";

type Row = [concept: string, sentence: string];

/** The findings rows of a live manifest, in shipped order, as `[concept, sentence]`. */
function manifestRows(manifest: typeof MRI_BRAIN_STANDARD_NORMAL_MANIFEST): Row[] {
  return (manifest.observations ?? [])
    .filter((o) => o.field === "findings")
    .map((o) => [o.concept ?? "", (o.renderedText ?? "").trim()]);
}

describe("the Text-to-Report fixtures mirror the live normal templates", () => {
  it("MRI brain: every scaffold sentence and its concept, both directions", () => {
    const live = manifestRows(MRI_BRAIN_STANDARD_NORMAL_MANIFEST);
    const fixture: Row[] = MRI_BRAIN_NORMALS.map(([c, s]) => [c, s.trim()]);
    expect(fixture).toEqual(live);
    // Non-vacuous: the battery claims completeness over the brief's structure list, so
    // a mirror that compared two empty arrays would prove nothing.
    expect(live.length).toBeGreaterThanOrEqual(16);
  });

  it("MRI brain: the normal impression is the one the template owns", () => {
    expect(MRI_BRAIN_NORMAL_IMPRESSION.trim()).toBe(MRI_BRAIN_STANDARD_NORMAL_IMPRESSION.trim());
  });

  it("MRI LS spine: general and per-level sentences and their concepts, both directions", () => {
    const fixture: Row[] = [
      ...LS_GENERAL_NORMALS.map(([c, s]) => [c, s.trim()] as Row),
      ...LS_LEVELS.flatMap((level) =>
        lsLevelNormals(level).map(([c, s]) => [c, s.trim()] as Row),
      ),
    ];
    expect(fixture).toEqual(manifestRows(MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST));
    expect(LS_LEVELS).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
  });

  it("MRI LS spine: the normal impression is the one the template owns", () => {
    expect(LS_NORMAL_IMPRESSION.trim()).toBe(MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION.trim());
  });

  it("the fixtures declare the revisions the live manifests carry", () => {
    // The scaffold row id is `baseline:<revision>:<concept>`, and revision is what the
    // supersession and provenance keys are built from. A template renumbering that the
    // fixture does not follow would make the battery test a ledger the product cannot
    // produce — and the mismatch is invisible from inside api-server.
    const brain = brainStudy([]);
    const spine = lsStudy([]);
    for (const o of brain.observations) {
      expect(o.id, `brain row ${o.id}`).toMatch(
        new RegExp(`^baseline:${MRI_BRAIN_STANDARD_NORMAL_MANIFEST.revision}:`),
      );
    }
    for (const o of spine.observations) {
      expect(o.id, `LS row ${o.id}`).toMatch(
        new RegExp(`^baseline:${MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST.revision}:`),
      );
    }
    expect(brain.observations.length).toBeGreaterThan(0);
    expect(spine.observations.length).toBeGreaterThan(0);
  });

  it("the Findings text the fixtures hand the composer is the template's own lines", () => {
    // `brainStudy()` writes the scaffold into `findings` as well as into the ledger; if
    // the two ever disagree, the validator reads a corpus the workspace never shows.
    const brain = brainStudy([]);
    expect(brain.findings.split("\n")).toEqual(MRI_BRAIN_NORMALS.map(([, s]) => s));
    const spine = lsStudy([]);
    expect(spine.findings.split("\n").length).toBe(
      LS_GENERAL_NORMALS.length + LS_LEVELS.length * 6,
    );
  });
});

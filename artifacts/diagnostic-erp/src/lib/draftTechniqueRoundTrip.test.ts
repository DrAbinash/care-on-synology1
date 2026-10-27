/**
 * B-01 regression: the Technique line must survive
 * save → close → reopen → re-save, exactly.
 *
 * Root cause this proves is closed: hydration read `draft.technique`, but
 * `radiology_report_drafts` has no technique column — the value is persisted
 * inside the `findings_sections` JSON column under `Technique`, which is what
 * `GET /drafts` actually returns.
 *
 * The WRITER side is asserted against the real route handler in
 * artifacts/api-server/src/routes/radiology-report-generator.test.ts
 * ("POST /save-draft — B-01 …"), which proves the exact column shape used here.
 * This file owns the READER side and the two properties that only the reader can
 * show: the restored text is byte-identical, and the acquisition state derived
 * from it is the same state the radiologist had before the reload — not the state
 * an accidental empty string produces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TECHNIQUE_SECTION_KEY,
  resolveDraftTechnique,
  techniqueFromFindingsSections,
} from "./draftTechniqueRoundTrip";
import { deriveSpineSequencesAvailable } from "./mriSpineSequences";

const TECHNIQUE =
  "Multiplanar multisequence MRI performed including T1, T2 and STIR sequences.";

/**
 * What one saved draft looks like on the wire. `findingsSections` is a TEXT
 * column, so the API hands back a JSON string; there is no `technique` key at
 * all, and that absence is the entire defect.
 */
function savedDraftRow(technique: string, extraSections: Record<string, string> = {}) {
  const sections: Record<string, string> = { ...extraSections };
  // The server's own rule: a blank technique stores no section.
  if (technique.trim()) sections[TECHNIQUE_SECTION_KEY] = technique.trim();
  return {
    id: 101,
    studyId: 7,
    rawFindings: "Findings text",
    findingsSections: Object.keys(sections).length > 0 ? JSON.stringify(sections) : null,
    impression: JSON.stringify(["Impression text"]),
    recommendation: "Recommendation text",
    clinicalHistory: "Headache for three weeks.",
    status: "draft",
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
}

describe("B-01 the saved Technique is restored on reopen", () => {
  it("restores the exact text the radiologist entered", () => {
    const row = savedDraftRow(TECHNIQUE);
    expect(resolveDraftTechnique(row)).toBe(TECHNIQUE);
  });

  it("is not blank — the pre-fix read of draft.technique returned an empty string", () => {
    const row = savedDraftRow(TECHNIQUE);
    expect(row.technique).toBeUndefined();
    expect(resolveDraftTechnique(row)).not.toBe("");
    expect(resolveDraftTechnique(row).trim()).not.toBe("");
  });

  it("restores the text the way the workspace column type describes the row", () => {
    // The row type declares findingsSections as `string | null`; nothing declares
    // a technique column, because none exists.
    const row = savedDraftRow(TECHNIQUE);
    expect(typeof row.findingsSections).toBe("string");
    expect("technique" in row).toBe(false);
  });
});

describe("B-01 re-saving what was reopened does not erase it", () => {
  it("a second serialization retains the same Technique", () => {
    const first = savedDraftRow(TECHNIQUE);
    const restored = resolveDraftTechnique(first);
    const second = savedDraftRow(restored);
    expect(resolveDraftTechnique(second)).toBe(TECHNIQUE);
  });

  it("stays stable across a third round trip", () => {
    let row: unknown = savedDraftRow(TECHNIQUE);
    for (let i = 0; i < 3; i++) row = savedDraftRow(resolveDraftTechnique(row));
    expect(resolveDraftTechnique(row)).toBe(TECHNIQUE);
  });

  it("leaves the persisted representation semantically equivalent", () => {
    const before = JSON.parse(savedDraftRow(TECHNIQUE, { "Lumbar spine": "Discs preserved." }).findingsSections!);
    const after = JSON.parse(
      savedDraftRow(resolveDraftTechnique({ findingsSections: JSON.stringify(before) }), {
        "Lumbar spine": "Discs preserved.",
      }).findingsSections!,
    );
    expect(after).toEqual(before);
  });
});

describe("B-01 acquisition state is derived from the restored Technique", () => {
  const context = {
    studyDescription: "MRI Lumbar Spine",
    protocolName: null,
    reportTitle: null,
  };

  it("derives the same sequence state before and after a reload", () => {
    const beforeReload = deriveSpineSequencesAvailable({ techniqueText: TECHNIQUE, ...context });
    const afterReload = deriveSpineSequencesAvailable({
      techniqueText: resolveDraftTechnique(savedDraftRow(TECHNIQUE)),
      ...context,
    });
    expect(afterReload).toEqual(beforeReload);
  });

  it("and proves that the reload actually changed something — an empty Technique derives less", () => {
    // Without this assertion the equality above would also pass if the reader
    // returned "" and the derivation ignored its input.
    const restored = deriveSpineSequencesAvailable({
      techniqueText: resolveDraftTechnique(savedDraftRow(TECHNIQUE)),
      ...context,
    });
    const lost = deriveSpineSequencesAvailable({ techniqueText: "", ...context });
    expect(restored.stir).toBe(true);
    expect(lost.stir).toBe(false);
    expect(restored).not.toEqual(lost);
  });
});

describe("B-01 an empty Technique stays empty without inventing text", () => {
  it("saves and restores as empty", () => {
    const row = savedDraftRow("");
    expect(row.findingsSections).toBeNull();
    expect(resolveDraftTechnique(row)).toBe("");
  });

  it("restores empty when the column holds other sections but no Technique", () => {
    const row = { findingsSections: JSON.stringify({ "Cervical spine": "Normal alignment." }) };
    expect(resolveDraftTechnique(row)).toBe("");
  });

  it("restores empty for a row with no draft at all", () => {
    expect(resolveDraftTechnique(null)).toBe("");
    expect(resolveDraftTechnique(undefined)).toBe("");
    expect(resolveDraftTechnique({})).toBe("");
  });
});

describe("B-01 the reader degrades instead of throwing or inventing", () => {
  it("malformed JSON in the column reads as no Technique", () => {
    expect(resolveDraftTechnique({ findingsSections: "{not json" })).toBe("");
    expect(techniqueFromFindingsSections("[1,2,3]")).toBe("");
    expect(techniqueFromFindingsSections(null)).toBe("");
  });

  it("an already-parsed object column also works", () => {
    expect(resolveDraftTechnique({ findingsSections: { Technique: TECHNIQUE } })).toBe(TECHNIQUE);
  });

  it("a non-string section body is ignored rather than stringified", () => {
    expect(techniqueFromFindingsSections({ Technique: 12 })).toBe("");
    expect(techniqueFromFindingsSections({ Technique: null })).toBe("");
  });

  it("accepts a differently-cased section name stored by another writer", () => {
    expect(techniqueFromFindingsSections({ technique: TECHNIQUE })).toBe(TECHNIQUE);
    expect(techniqueFromFindingsSections({ TECHNIQUE: TECHNIQUE })).toBe(TECHNIQUE);
  });

  it("prefers a direct technique field when an endpoint ever provides one", () => {
    expect(resolveDraftTechnique({ technique: "Direct value.", findingsSections: JSON.stringify({ Technique: "Stored value." }) }))
      .toBe("Direct value.");
  });

  it("does not let a blank direct field mask the stored section", () => {
    expect(resolveDraftTechnique({ technique: "   ", findingsSections: JSON.stringify({ Technique: TECHNIQUE }) }))
      .toBe(TECHNIQUE);
  });
});

/**
 * Wiring. The behaviour above is the reader; these two assertions prove the
 * workspace actually calls it. A source contract is the strongest thing available
 * here — there is no DOM harness in this repository, so the hydrate effect itself
 * cannot be executed — which is exactly why it is paired with the executable
 * reader/derivation tests above rather than standing alone.
 *
 * Comments are stripped BEFORE matching: this file's own explanation quotes the
 * broken expression, and an unstripped grep would fail on the fix instead of on
 * the defect.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

const HOOK = readFileSync(
  resolve(HERE, "../hooks/radiology-workspace/useDraftPersistence.ts"),
  "utf8",
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const CODE = stripComments(HOOK);

describe("B-01 the workspace hydrates Technique through the shared reader", () => {
  it("imports the reader", () => {
    expect(CODE).toMatch(/import\s*\{\s*resolveDraftTechnique\s*\}\s*from\s*"@\/lib\/draftTechniqueRoundTrip"/);
  });

  it("resolves Technique at both draft-reading sites — the hydrate effect and discard-local", () => {
    const calls = CODE.match(/technique:\s*resolveDraftTechnique\(draft\)/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it("reads the draft's technique column nowhere", () => {
    expect(CODE).not.toMatch(/technique:\s*normStr\(draft\.technique\)/);
  });

  it("positive control: the scanner does catch the broken form it is guarding against", () => {
    // Without this, "reads the draft's technique column nowhere" could pass on an
    // expression the pattern simply cannot see.
    const broken = stripComments('      technique: normStr(draft.technique),\n');
    expect(broken).toMatch(/technique:\s*normStr\(draft\.technique\)/);
    expect(broken).not.toMatch(/technique:\s*resolveDraftTechnique\(draft\)/);
  });
});

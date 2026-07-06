import { describe, it, expect } from "vitest";
import { mergeBlock, removeBlock, mergeImpression, removeImpression } from "./quickFindingsMerge";

// Tests for the Radiology Quick Select text-merge safety model.
// The invariants under test:
//  1. Toggling a button ON never duplicates identical text.
//  2. Toggling OFF removes exactly what was inserted — and ONLY if still
//     present verbatim; radiologist-edited text is never touched.
//  3. Manually typed text always survives insert + remove round-trips.

const FAZEKAS = "Few scattered punctate T2/FLAIR hyperintense foci (Fazekas grade 1).";
const SINUS = "Mucosal thickening is noted in the paranasal sinuses.";

describe("mergeBlock", () => {
  it("inserts into an empty field", () => {
    expect(mergeBlock("", FAZEKAS)).toBe(FAZEKAS);
  });

  it("appends as a new paragraph after existing text", () => {
    const out = mergeBlock("Manually typed line.", FAZEKAS);
    expect(out).toBe(`Manually typed line.\n${FAZEKAS}`);
  });

  it("does not duplicate an identical block", () => {
    const once = mergeBlock("", FAZEKAS);
    expect(mergeBlock(once, FAZEKAS)).toBe(once);
  });

  it("merges multiple different findings", () => {
    const out = mergeBlock(mergeBlock("", FAZEKAS), SINUS);
    expect(out).toContain(FAZEKAS);
    expect(out).toContain(SINUS);
  });

  it("ignores empty block", () => {
    expect(mergeBlock("existing", "   ")).toBe("existing");
  });
});

describe("removeBlock", () => {
  it("removes exactly the inserted block, keeping typed text", () => {
    const withBoth = mergeBlock("My own observation.", FAZEKAS);
    expect(removeBlock(withBoth, FAZEKAS)).toBe("My own observation.");
  });

  it("no-ops when the block was edited by the radiologist", () => {
    const edited = "Few scattered punctate foci — CORRELATE CLINICALLY (Fazekas grade 1, edited).";
    expect(removeBlock(edited, FAZEKAS)).toBe(edited);
  });

  it("removes middle block without mangling neighbors", () => {
    const text = mergeBlock(mergeBlock(mergeBlock("", FAZEKAS), SINUS), "Final typed note.");
    const out = removeBlock(text, SINUS);
    expect(out).toContain(FAZEKAS);
    expect(out).toContain("Final typed note.");
    expect(out).not.toContain(SINUS);
    expect(out).not.toMatch(/\n{3,}/); // no triple blank gaps left behind
  });

  it("insert + remove on empty field round-trips to empty", () => {
    expect(removeBlock(mergeBlock("", FAZEKAS), FAZEKAS)).toBe("");
  });
});

describe("mergeImpression / removeImpression", () => {
  it("adds and dedupes impression lines", () => {
    const a = mergeImpression([], "Mild chronic small vessel ischemic changes.");
    const b = mergeImpression(a, "Mild chronic small vessel ischemic changes.");
    expect(b).toHaveLength(1);
  });

  it("removes only the exact matching line", () => {
    const lines = ["Manually written impression.", "Paranasal sinusitis."];
    expect(removeImpression(lines, "Paranasal sinusitis.")).toEqual(["Manually written impression."]);
  });

  it("keeps an edited impression line on remove", () => {
    const lines = ["Paranasal sinusitis — advise ENT opinion."];
    expect(removeImpression(lines, "Paranasal sinusitis.")).toEqual(lines);
  });
});

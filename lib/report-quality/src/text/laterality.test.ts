/**
 * The stated-side ↔ written-side rule, at its new home.
 *
 * These are the semantics the AI finding gauntlet has always had, pinned here
 * because the gauntlet now delegates rather than carrying its own copy: a change
 * to this file changes what a MODEL's output is quarantined for as well as what a
 * radiologist is warned about, so both readings get asserted in one place.
 */
import { describe, expect, it } from "vitest";
import {
  sideBlindText,
  sidesNamedInText,
  statedLateralityConflict,
} from "./laterality";

describe("sidesNamedInText", () => {
  it("1. names every side the text carries", () => {
    expect([...sidesNamedInText("Left and right paravertebral collections")].sort()).toEqual([
      "left",
      "right",
    ]);
    expect([...sidesNamedInText("Bilateral renal cysts")]).toEqual(["bilateral"]);
  });

  it("2. is empty when the text is silent on side", () => {
    expect(sidesNamedInText("Mild cortical atrophy.").size).toBe(0);
    // Word boundaries: "brighter" and "leftover" contain the letters, not the side.
    expect(sidesNamedInText("A brighter signal and leftover fluid.").size).toBe(0);
  });

  it("3. reads a hyphenated side", () => {
    expect([...sidesNamedInText("Right-sided hydronephrosis")]).toEqual(["right"]);
  });
});

describe("statedLateralityConflict", () => {
  it("4. fires on the two swaps a signer must not miss", () => {
    expect(statedLateralityConflict("left", "Right kidney shows a 2 cm cyst.")).toMatch(
      /stated laterality "left" conflicts with text laterality \(right\)/,
    );
    expect(statedLateralityConflict("right", "Left kidney shows a 2 cm cyst.")).toMatch(
      /stated laterality "right" conflicts with text laterality \(left\)/,
    );
  });

  it("5. is silent when the sentence agrees with the selection", () => {
    expect(statedLateralityConflict("left", "Left kidney shows a 2 cm cyst.")).toBeNull();
  });

  it("6. is silent on a description involving both sides", () => {
    // The correct contralateral picture, and the plain both-sides description.
    expect(
      statedLateralityConflict("left", "Right hemispheric infarct with left-sided weakness."),
    ).toBeNull();
    expect(statedLateralityConflict("left", "Left and right paravertebral collections.")).toBeNull();
  });

  it("7. is silent on a legitimate bilateral selection", () => {
    expect(statedLateralityConflict("bilateral", "Left kidney shows a cyst.")).toBeNull();
  });

  it("8. is silent when no side was claimed", () => {
    expect(statedLateralityConflict("", "Right kidney shows a cyst.")).toBeNull();
    expect(statedLateralityConflict("none", "Right kidney shows a cyst.")).toBeNull();
    expect(statedLateralityConflict(null, "Right kidney shows a cyst.")).toBeNull();
    expect(statedLateralityConflict(undefined, "Right kidney shows a cyst.")).toBeNull();
  });

  it("9. is silent when the sentence names no side at all", () => {
    expect(statedLateralityConflict("left", "A 2 cm simple cortical cyst.")).toBeNull();
  });

  it("10. reads a side the ledger recorded in another case", () => {
    // The observation column is a bare string; the gauntlet's union is lowercase.
    // Normalizing is a no-op for the gauntlet and stops an uppercase row from
    // reporting a conflict against a sentence that agrees with it.
    expect(statedLateralityConflict("LEFT", "Left kidney shows a cyst.")).toBeNull();
    expect(statedLateralityConflict("Left", "Right kidney shows a cyst.")).toMatch(/"left"/);
  });

  it("11. never rewrites the text it judges", () => {
    const sentence = "Right kidney shows a 2 cm cyst.";
    statedLateralityConflict("left", sentence);
    expect(sentence).toBe("Right kidney shows a 2 cm cyst.");
  });
});

describe("sideBlindText", () => {
  it("12. deletes exactly the words the counter reads", () => {
    // The invariant the ledger's typed-over fallback rests on: if the strip left a
    // word the counter sees, or removed one it does not, a re-sided sentence would
    // stop being recognisable as the same sentence.
    expect(sideBlindText("Left renal cyst.").replace(/\s+/g, " ")).toBe(" renal cyst.");
    expect(sideBlindText("Right renal cyst.").replace(/\s+/g, " ")).toBe(" renal cyst.");
    expect(sideBlindText("Bilateral renal cysts.").replace(/\s+/g, " ")).toBe(" renal cysts.");
    // Not a side word — untouched, so it cannot make two different sentences look alike.
    expect(sideBlindText("A brighter signal.")).toBe("A brighter signal.");
  });

  it("13. leaves a sentence with no side word byte-identical", () => {
    const text = "Mild cortical atrophy with prominence of the sulci.";
    expect(sideBlindText(text)).toBe(text);
  });
});

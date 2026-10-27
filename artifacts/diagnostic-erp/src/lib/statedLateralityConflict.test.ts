/**
 * Finding C — a structured observation whose selected side no longer agrees with
 * the sentence carrying it.
 *
 * The two examples the brief names are cases 1 and 2. Everything after them is
 * the reason this rule can be shown to a signer at all: the legitimate reports it
 * must stay quiet about (bilateral, both-sides descriptions, a correct LEFT/RIGHT
 * pair), and the two ledger flags it deliberately does NOT filter on.
 *
 * Runs against the shipped detector, not a restatement of it — `observationLedger`
 * is imported whole, so a rule that stopped calling
 * `@workspace/report-quality`'s `statedLateralityConflict` fails here rather than
 * silently becoming a second spelling.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectStatedLateralityConflictsForLedger,
  STATED_LATERALITY_HINT,
} from "./observationLedger";

type Row = {
  lastRendered: { findings?: string };
  observation?: { laterality?: string | null } | null;
  stale?: boolean;
  protected?: boolean;
};

function patch(laterality: string, findings: string, extra?: Partial<Row>): Row {
  return { lastRendered: { findings }, observation: { laterality }, ...extra };
}

function detect(findings: string, patches: Row[]) {
  return detectStatedLateralityConflictsForLedger({ findings, patches });
}

describe("the two swaps the brief names", () => {
  it("1. selected Left, the sentence now says Right", () => {
    const out = detect("Right renal cyst.", [patch("left", "Left renal cyst.")]);
    expect(out).toHaveLength(1);
    expect(out[0].stated).toBe("left");
    expect(out[0].said).toEqual(["right"]);
    expect(out[0].sentence).toBe("Right renal cyst.");
    expect(out[0].message).toContain('selected as "left"');
    expect(out[0].message).toContain('says "right"');
    expect(out[0].message).toContain("Right renal cyst.");
  });

  it("2. selected Right, the sentence now says Left", () => {
    const out = detect("Left renal cyst.", [patch("right", "Right renal cyst.")]);
    expect(out).toHaveLength(1);
    expect(out[0].stated).toBe("right");
    expect(out[0].said).toEqual(["left"]);
  });

  it("2b. reads a hyphenated side too", () => {
    const out = detect("Right-sided hydronephrosis.", [patch("left", "Left-sided hydronephrosis.")]);
    expect(out).toHaveLength(1);
    expect(out[0].said).toEqual(["right"]);
  });
});

describe("the legitimate reports it must not mark up", () => {
  it("3. an unedited observation agrees with itself", () => {
    expect(detect("Left renal cyst.", [patch("left", "Left renal cyst.")])).toHaveLength(0);
  });

  it("4. a bilateral selection is legitimate whatever the sentence says", () => {
    expect(detect("Bilateral renal cysts.", [patch("bilateral", "Bilateral renal cysts.")])).toHaveLength(0);
    expect(detect("Left renal cyst.", [patch("bilateral", "Bilateral renal cysts.")])).toHaveLength(0);
  });

  it("5. a description involving both sides is not a conflict", () => {
    const sentence = "Left and right paravertebral collections.";
    expect(detect(sentence, [patch("left", sentence)])).toHaveLength(0);
    expect(detect(sentence, [patch("right", sentence)])).toHaveLength(0);
  });

  it("6. a sentence that names no side has nothing to contradict", () => {
    expect(detect("A 2 cm simple cortical cyst.", [patch("left", "Left simple cortical cyst.")])).toHaveLength(0);
  });

  it("7. a correct LEFT / RIGHT pair does not warn about itself", () => {
    // The false positive this rule was nearly built with: once the sides are
    // deleted these two are the same sentence, so the left row would have warned
    // about the right row's own line.
    const findings = "Left renal cyst.\nRight renal cyst.";
    expect(
      detect(findings, [patch("left", "Left renal cyst."), patch("right", "Right renal cyst.")]),
    ).toHaveLength(0);
  });

  it("7b. does not claim a sentence another observation still owns", () => {
    // The left row's contribution has left the narrative, and the only renal-cyst
    // sentence there is the right row's, exactly as the right row rendered it. That
    // is a leftover ledger row — the composition gate's stale count is what names a
    // contribution that has gone — so pointing the signer at the OTHER observation's
    // sentence would blame the one line that is correct.
    const out = detect("Right renal cyst.", [
      patch("left", "Left renal cyst."),
      patch("right", "Right renal cyst."),
    ]);
    expect(out).toHaveLength(0);
  });

  it("8. an observation with no side recorded is never judged", () => {
    expect(detect("Right renal cyst.", [patch("", "Left renal cyst.")])).toHaveLength(0);
  });

  it("9. a sentence rewritten rather than re-sided is left alone", () => {
    // Documented limit: with the contribution gone there is no way to prove which
    // sentence replaced it, and guessing would train the signer to ignore the panel.
    expect(
      detect("The right kidney demonstrates a complex cystic lesion with septations.", [
        patch("left", "Left renal cyst."),
      ]),
    ).toHaveLength(0);
  });

  it("10. two identical conflicting sentences warn once", () => {
    const out = detect("Right renal cyst.\nRight renal cyst.", [patch("left", "Left renal cyst.")]);
    expect(out).toHaveLength(1);
  });

  it("10b. two ledger rows resolving to the same sentence warn once", () => {
    // Both rows are the same sentence once their sides are deleted, neither matches
    // the narrative exactly, and both were recorded as left — so both find the one
    // re-sided line. The signer is told about that line once, not twice.
    const out = detect("Right renal cyst.", [
      patch("left", "Left renal cyst."),
      patch("left", "Bilateral renal cyst."),
    ]);
    expect(out).toHaveLength(1);
  });

  it("11. an ambiguous side-blind match names no sentence", () => {
    // Both lines are "renal cyst" once the sides are deleted, and neither is the
    // contribution the ledger recorded, so nothing here can say which one the
    // radiologist edited. Naming one would point the signer at the wrong line and
    // naming both is noise; the composition gate's stale count is what says a
    // contribution has left the narrative.
    const out = detect("Right renal cyst.\nBilateral renal cyst.", [patch("left", "Left renal cyst.")]);
    expect(out).toHaveLength(0);
  });

  it("11b. a second, unrelated sentence does not make the match ambiguous", () => {
    // Proves the guard above is keyed on the side-blind match, not on how many
    // sentences the narrative happens to hold.
    const out = detect("Right renal cyst.\nBilateral hepatic cysts.", [patch("left", "Left renal cyst.")]);
    expect(out).toHaveLength(1);
    expect(out[0].sentence).toBe("Right renal cyst.");
  });
});

describe("the ledger flags it deliberately ignores", () => {
  it("12. a stale row is still judged", () => {
    // `stale` is set on hydrate when the contribution has left the narrative —
    // which is exactly what a side edit does. Skipping it would skip the case.
    expect(detect("Right renal cyst.", [patch("left", "Left renal cyst.", { stale: true })])).toHaveLength(1);
  });

  it("13. a protected row is still judged", () => {
    // `protected` means the radiologist's manual edit won over the structured
    // contribution. That is the moment this rule exists for.
    expect(detect("Right renal cyst.", [patch("left", "Left renal cyst.", { protected: true })])).toHaveLength(1);
  });
});

describe("what it does with the conflict", () => {
  it("14. warns, and rewrites nothing", () => {
    const findings = "Right renal cyst.";
    const patches = [patch("left", "Left renal cyst.")];
    const out = detect(findings, patches);
    expect(out).toHaveLength(1);
    expect(findings).toBe("Right renal cyst.");
    expect(patches[0].observation?.laterality).toBe("left");
    expect(patches[0].lastRendered.findings).toBe("Left renal cyst.");
    expect(out[0]).not.toHaveProperty("replacement");
  });

  it("15. the hint tells the signer which two things disagree", () => {
    expect(STATED_LATERALITY_HINT).toMatch(/side selected/i);
    expect(STATED_LATERALITY_HINT).toMatch(/before signing/i);
  });
});

describe("wiring", () => {
  const FINALIZE = readFileSync(
    path.resolve(__dirname, "../hooks/radiology-workspace/useStudyFinalize.ts"),
    "utf8",
  );

  it("16. reaches the sign dialog through the existing warning channel", () => {
    const call = FINALIZE.indexOf("detectStatedLateralityConflictsForLedger({");
    expect(call, "the gauntlet no longer calls the rule").toBeGreaterThan(-1);
    const end = FINALIZE.indexOf("const validationIssues = [...textIssues, ...lateralityIssues];", call);
    expect(end, "the warnings no longer join validationIssues").toBeGreaterThan(call);
    const block = FINALIZE.slice(call, end);
    expect(block).toContain("findings: live.findingsText");
    expect(block).toContain("appliedPathologyPatches");
    expect(block).toContain("STATED_LATERALITY_HINT");
    expect(FINALIZE).toContain("clinicalWarnings: validationIssues");
  });

  it("17. advises rather than blocks, and rewrites nothing", () => {
    // Bounded by the START of the whole advisory read, not by the comment that
    // introduces it or the call itself: a guard injected on the same line as either
    // marker would sit outside a tighter slice, and this case would keep passing on
    // a gauntlet that had started refusing to sign.
    const at = FINALIZE.indexOf("const textIssues = validateReport({");
    expect(at, "the gauntlet's text validation is gone").toBeGreaterThan(-1);
    const end = FINALIZE.indexOf("const validationIssues = [...textIssues", at);
    expect(end, "the warnings no longer merge into validationIssues").toBeGreaterThan(at);
    const block = FINALIZE.slice(at, end);
    expect(block).toContain("detectStatedLateralityConflictsForLedger({");
    // The gauntlet's blocking guards all `toast(...); return;`. This one may not.
    expect(block).not.toContain("return;");
    expect(block).not.toContain("variant: \"destructive\"");
    // Nothing here may write back to the store or to the narrative.
    expect(block).not.toContain("setState(");
    expect(block).not.toContain("setFindings");
    expect(block).not.toContain("applySide");
    expect(block).not.toContain("swapSides");
    expect(block).not.toContain("relateralizePatches");
  });

  it("18. is read from the same snapshot the rest of the gauntlet uses", () => {
    // A Retry in the dialog re-runs the service checks over `live`; a rule read
    // from a later `useWorkspace.getState()` would judge a different report.
    const liveAt = FINALIZE.indexOf("const live = readWorkspaceClinicalTexts();");
    const ruleAt = FINALIZE.indexOf("detectStatedLateralityConflictsForLedger({");
    const checksAt = FINALIZE.indexOf("const runServiceChecks = async ()");
    expect(liveAt).toBeGreaterThan(-1);
    expect(ruleAt).toBeGreaterThan(liveAt);
    expect(ruleAt).toBeLessThan(checksAt);
  });
});

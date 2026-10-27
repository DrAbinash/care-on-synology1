import { describe, expect, it } from "vitest";
import {
  nextAutoRevealSection,
  revealNeedKey,
  sectionsRequiringReveal,
} from "@/lib/reportSectionCollapsePrefs";
import { REPORT_SECTIONS, sectionOwningFocus } from "@/lib/reportSectionAccordion";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Release-blocking clinical regression: hand-typed Findings text was silently lost from the
 * ~4th keystroke onward. Cause: a stale-Impression auto-reveal moved the open accordion section
 * away from Findings, the Findings body got `display:none`, and Chromium blurs a focused element
 * whose ancestor is hidden — every keystroke after the blur went nowhere.
 *
 * P0-A … P0-O are the behavioural contract. P0-A/P0-B/P0-C are the defect: the reveal must never
 * collapse the section that holds the caret. The rest pin what must NOT change: the reveal still
 * happens once the caret leaves (a collapsed Impression row shows "done", not "stale", so the
 * reveal is the only cue), and progressive clicks are still not fought.
 */

const need = sectionsRequiringReveal({ impressionNeedsRefresh: true });

const fakeSection = (testId: string) => {
  const section = { getAttribute: (name: string) => (name === "data-testid" ? testId : null) };
  return { closest: (sel: string) => (sel.startsWith("section[data-testid^=") ? section : null) };
};

describe("P0 — an auto-reveal must not collapse the section holding the caret", () => {
  it("P0-A: typing in Findings does not open Impression under the user", () => {
    expect(need).toEqual(["impression"]);
    expect(
      nextAutoRevealSection({
        need,
        currentActive: "findings",
        alreadyRevealedKey: "",
        sectionWithCaret: "findings",
      })
    ).toBeNull();
  });

  it("P0-B: the same need still reveals once the caret has left the accordion", () => {
    expect(
      nextAutoRevealSection({
        need,
        currentActive: "findings",
        alreadyRevealedKey: "",
        sectionWithCaret: null,
      })
    ).toBe("impression");
  });

  it("P0-C: a deferred need is not consumed, so a later edit cannot lose it", () => {
    const deferred = nextAutoRevealSection({
      need,
      currentActive: "findings",
      alreadyRevealedKey: "",
      sectionWithCaret: "findings",
    });
    expect(deferred).toBeNull();
    expect(
      nextAutoRevealSection({ need, currentActive: "findings", alreadyRevealedKey: "", sectionWithCaret: null })
    ).toBe("impression");
  });

  it("P0-D: a caret in a collapsed section's own header does not block the reveal", () => {
    // Only the open section can lose its editor; a header button in a collapsed row holds no text.
    expect(
      nextAutoRevealSection({
        need,
        currentActive: "findings",
        alreadyRevealedKey: "",
        sectionWithCaret: "technique",
      })
    ).toBe("impression");
  });

  it("P0-E: the reveal still fires for a critical recommendation while Findings is open", () => {
    const critical = sectionsRequiringReveal({ recommendationCritical: true });
    expect(critical).toEqual(["recommendation"]);
    expect(
      nextAutoRevealSection({ need: critical, currentActive: "findings", alreadyRevealedKey: "", sectionWithCaret: "findings" })
    ).toBeNull();
    expect(
      nextAutoRevealSection({ need: critical, currentActive: "findings", alreadyRevealedKey: "", sectionWithCaret: null })
    ).toBe("recommendation");
  });

  it("P0-O: a stale Impression outranks any other section that needs attention", () => {
    // Precedence is a promise about *which* blocker the radiologist is shown, so it must not
    // depend on the order `sectionsRequiringReveal` happens to push into.
    expect(
      nextAutoRevealSection({
        need: ["recommendation", "impression"],
        currentActive: "findings",
        alreadyRevealedKey: "",
        sectionWithCaret: null,
      })
    ).toBe("impression");
  });

  it("P0-F: already viewing the section that needs attention is not fought, caret or no caret", () => {
    expect(
      nextAutoRevealSection({ need, currentActive: "impression", alreadyRevealedKey: "", sectionWithCaret: "impression" })
    ).toBeNull();
    expect(
      nextAutoRevealSection({ need, currentActive: "impression", alreadyRevealedKey: "", sectionWithCaret: null })
    ).toBeNull();
  });

  it("P0-G: an already-revealed need set stays revealed after the caret leaves", () => {
    expect(
      nextAutoRevealSection({ need, currentActive: "findings", alreadyRevealedKey: revealNeedKey(need), sectionWithCaret: null })
    ).toBeNull();
  });

  it("P0-H: a caret outside any report section counts as no protection", () => {
    expect(sectionOwningFocus(null)).toBeNull();
    expect(sectionOwningFocus(undefined)).toBeNull();
    expect(sectionOwningFocus({})).toBeNull();
  });

  it("P0-I: the caret is resolved to the section that owns it", () => {
    expect(sectionOwningFocus(fakeSection("report-section-findings"))).toBe("findings");
    expect(sectionOwningFocus(fakeSection("report-section-impression"))).toBe("impression");
  });

  it("P0-J: a data-testid that is not a report section is not a section", () => {
    expect(sectionOwningFocus(fakeSection("report-section-not-a-section"))).toBeNull();
  });

  it("P0-K: every registered section id round-trips through the caret lookup", () => {
    for (const section of REPORT_SECTIONS) {
      expect(sectionOwningFocus(fakeSection(`report-section-${section.id}`))).toBe(section.id);
    }
  });
});

describe("P0 — the workspace passes the caret to the reveal (wiring)", () => {
  const clinical = readFileSync(join(__dirname, "../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"), "utf8");

  it("P0-L: the reveal call is given the caret's section", () => {
    const call = clinical.slice(clinical.indexOf("nextAutoRevealSection({"));
    const args = call.slice(0, call.indexOf("})"));
    expect(args).toContain("sectionWithCaret");
    expect(args).toContain("alreadyRevealedKey");
  });

  it("P0-M: the caret is a dependency, so a deferred reveal still runs when it leaves", () => {
    const effect = clinical.slice(clinical.indexOf("const need = sectionsRequiringReveal({"));
    const depsStart = effect.indexOf("}, [") + 3;
    const deps = effect.slice(depsStart, effect.indexOf("]", depsStart) + 1);
    // Passing the argument is not enough: without the dependency the effect never
    // re-runs on caret-leave, so a deferred stale Impression hides for the session.
    expect(deps.startsWith("[impressionNeedsRefresh")).toBe(true);
    expect(deps).toContain("sectionWithCaret");
  });

  it("P0-N: a deferred need is not marked handled, so it stays pending", () => {
    const early = clinical.indexOf("const need = sectionsRequiringReveal({");
    const guard = clinical.slice(early, clinical.indexOf("}, [", early));
    expect(guard).toContain("if (!target)");
    expect(guard).toContain("caretIsEditingTheOpenSection");
    expect(guard).toMatch(/if \(!caretIsEditingTheOpenSection\) autoRevealKeyRef\.current = key/);
  });
});

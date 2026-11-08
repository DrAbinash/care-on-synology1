import { describe, expect, it } from "vitest";
import { expandMacro } from "./types";
import { initialMacroValues, macroPromptReadiness } from "./macroPromptValidation";

const V = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, ...extra }) as never;

/**
 * U1 pins — the macro prompt must not be applicable while any variable would
 * expand to a literal `___` in clinical text. Enter used to apply from ANY
 * input with no validation, so a two-variable macro filled halfway printed
 * `Mild ___ disc protrusion…`.
 */
describe("macroPromptReadiness (U1: `___` can no longer reach the report)", () => {
  it("blocks apply while a required variable is unfilled — and that variable would expand to ___", () => {
    const vars = [V("severity"), V("level")];
    const r = macroPromptReadiness(vars, { severity: "Mild" });
    expect(r.canApply).toBe(false);
    expect(r.filled).toBe(1);
    expect(r.total).toBe(2);
    expect(r.firstUnfilledIndex).toBe(1);
    // The hazard this guard exists for:
    expect(expandMacro({ template: "{severity} {level} protrusion", variables: vars } as never, { severity: "Mild" }))
      .toContain("___");
  });

  it("allows apply once every required variable has a value", () => {
    const r = macroPromptReadiness([V("severity"), V("level")], { severity: "Mild", level: "L4-L5" });
    expect(r.canApply).toBe(true);
    expect(r.firstUnfilledIndex).toBeNull();
  });

  it("a variable with a default counts as filled even when its input is empty", () => {
    const r = macroPromptReadiness([V("side", { default: "right" }), V("level")], { side: "", level: "L5-S1" });
    expect(r.canApply).toBe(true);
  });

  it("a variable with options counts as filled (the select always resolves)", () => {
    const r = macroPromptReadiness(
      [V("interval", { options: ["6 months", "1 year"] }), V("level")],
      { interval: "", level: "L3-L4" },
    );
    expect(r.canApply).toBe(true);
  });

  it("an all-optional macro (defaults/options only) is applicable immediately", () => {
    const r = macroPromptReadiness(
      [V("side", { default: "bilateral" }), V("grade", { options: ["mild", "moderate"] })],
      {},
    );
    expect(r.canApply).toBe(true);
    expect(r.filled).toBe(2);
  });

  it("initialMacroValues seeds defaults first, then the first option", () => {
    expect(initialMacroValues([V("side", { default: "left" }), V("grade", { options: ["mild", "severe"] }), V("level")]))
      .toEqual({ side: "left", grade: "mild", level: "" });
  });
});

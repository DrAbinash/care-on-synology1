import { describe, it, expect } from "vitest";
import { extractLearnedIgnored, withLearnedIgnored, clearLearned, learnedIgnoredList } from "./copilotLearning";

describe("copilotLearning — namespaced reuse of ignoredWarnings", () => {
  it("extracts only the copilot-namespaced ids", () => {
    const set = extractLearnedIgnored(["other-warning", "copilot:missing:ls-modic", "copilot:differential:ddx-ring"]);
    expect([...set].sort()).toEqual(["differential:ddx-ring", "missing:ls-modic"]);
    expect(set.has("other-warning")).toBe(false);
  });

  it("records an ignore without disturbing other entries, and de-dupes", () => {
    const start = ["some-other", "copilot:a"];
    const next = withLearnedIgnored(start, "b", true);
    expect(next).toEqual(["some-other", "copilot:a", "copilot:b"]);
    // idempotent
    expect(withLearnedIgnored(next, "b", true)).toEqual(next);
  });

  it("clears an ignore (radiologist now accepts it)", () => {
    expect(withLearnedIgnored(["some-other", "copilot:a", "copilot:b"], "a", false))
      .toEqual(["some-other", "copilot:b"]);
  });

  it("reset removes only copilot entries, preserving other consumers' warnings", () => {
    expect(clearLearned(["keep-me", "copilot:a", "also-keep", "copilot:b"])).toEqual(["keep-me", "also-keep"]);
  });

  it("export lists the copilot ids", () => {
    expect(learnedIgnoredList(["x", "copilot:missing:brain-swi"]).sort()).toEqual(["missing:brain-swi"]);
  });
});

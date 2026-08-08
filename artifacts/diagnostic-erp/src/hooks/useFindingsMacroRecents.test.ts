import { describe, expect, it } from "vitest";
import { chocolateMacroId, templateMacroId } from "./useFindingsMacroRecents";
import { pushRecent } from "../lib/commandPalette";

describe("findings macro recent ids", () => {
  it("builds stable chocolate / template ids", () => {
    expect(chocolateMacroId("brain", "Mass")).toBe("choc:brain:Mass");
    expect(templateMacroId("disc")).toBe("tpl:disc");
  });

  it("pushRecent caps and de-dupes like palette prefs", () => {
    expect(pushRecent(["a", "b"], "b", 8)).toEqual(["b", "a"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

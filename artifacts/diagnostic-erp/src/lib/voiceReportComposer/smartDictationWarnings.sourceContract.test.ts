/**
 * @vitest-environment node
 *
 * Source contract: contradiction warnings must reach the SCREEN.
 *
 * smartDictationWarnings.test.ts pins the fold; this pin guards the wiring
 * that a green fold suite can silently lose:
 *
 *   1. The hook must forward res.warnings into the compose outcome —
 *      dropped here, the warning dies inside the fetch response.
 *   2. The panel must render the warnings block on the accepted turn with
 *      the established amber advisory styling and a stable testid.
 *   3. The shared ComposeApiResponse type must carry the warnings field —
 *      the mirror of the server contract.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = join(__dirname, "..", "..", "..", "src");

describe("contradiction-warning wiring (source contract)", () => {
  const hook = readFileSync(join(here, "hooks", "useSmartDictation.ts"), "utf8");
  const panel = readFileSync(
    join(here, "components", "radiology", "SmartDictationPanel.tsx"),
    "utf8",
  );
  const types = readFileSync(
    join(here, "lib", "voiceReportComposer", "types.ts"),
    "utf8",
  );

  it("the hook forwards the route warnings into the fold outcome", () => {
    expect(hook).toMatch(/warnings:\s*res\.warnings/);
  });

  it("the panel renders the warnings block on the dictation thread", () => {
    expect(panel).toContain("smart-dictation-warnings");
    // Every warning's message is printed — the code is for telemetry/tests,
    // the message is for the radiologist.
    expect(panel).toMatch(/turn\.warnings\.\w*map/);
    expect(panel).toMatch(/w\.message/);
    // Advisory styling: amber like every other review-time caution in the panel.
    expect(panel).toMatch(/amber-\d+/);
  });

  it("the shared ComposeApiResponse type carries the warnings field", () => {
    expect(types).toMatch(/ComposerContradictionWarning/);
    expect(types).toMatch(/warnings\?:\s*ComposerContradictionWarning\[\]/);
  });

  it("the session turn type carries warnings for the accepted turns", () => {
    const sessionSource = readFileSync(
      join(here, "lib", "voiceReportComposer", "smartDictationSession.ts"),
      "utf8",
    );
    expect(sessionSource).toMatch(/warnings\?:\s*ComposerContradictionWarning\[\]/);
  });
});

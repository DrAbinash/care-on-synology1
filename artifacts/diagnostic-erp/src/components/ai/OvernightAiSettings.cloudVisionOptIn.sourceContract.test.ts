/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The cloud-vision opt-in must say what it does.
 *
 * The persisted key is `deepseekCloudVisionAllowed`, but the server treats that one
 * value as `cloudVisionAllowed` for every cloud vendor. A checkbox labelled
 * "Allow DeepSeek cloud vision" therefore under-states its own blast radius: whoever
 * enables it for a DeepSeek trial also opens Qwen and OpenAI image egress, and the
 * words beside the box are the only place that would have said so.
 *
 * These assertions bind the label to the server's behaviour, so the two cannot drift
 * apart in either direction — a widened switch with a narrow label, or a genuinely
 * per-vendor switch still sharing one stored key.
 */
describe("cloud vision opt-in wording (source contract)", () => {
  const component = readFileSync(join(__dirname, "OvernightAiSettings.tsx"), "utf8");
  const apiRoutes = join(__dirname, "..", "..", "..", "..", "api-server", "src");
  const reportComposer = readFileSync(join(apiRoutes, "routes", "reportComposer.ts"), "utf8");
  const aiReporting = readFileSync(join(apiRoutes, "routes", "aiReporting.ts"), "utf8");
  const gateway = readFileSync(join(apiRoutes, "lib", "ai", "gatewayInferenceProvider.ts"), "utf8");

  it("names every cloud vendor the switch actually covers", () => {
    const label = component.match(/data-testid="cloud-vision-optin-label">([\s\S]*?)<\/span>/)?.[1] ?? "";
    expect(label, "the label must not read as a single-vendor permission").toMatch(/ALL cloud providers/i);
    for (const vendor of ["DeepSeek", "Qwen", "OpenAI"]) {
      expect(label, `label omits ${vendor}, which this switch also enables`).toContain(vendor);
    }
  });

  it("keeps the old single-vendor wording out of the panel", () => {
    expect(component).not.toContain("Allow DeepSeek cloud vision");
    expect(component).not.toMatch(/DeepSeek uses official API only when cloud vision is explicitly allowed/);
  });

  it("states that pixels are sent as stored and never inspected", () => {
    const warning = component.match(/data-testid="cloud-vision-optin-warning">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(warning).toMatch(/burned\s*\n?\s*into the image/i);
    expect(warning).toMatch(/Nothing in CARE inspects pixels/i);
    expect(warning, "the text gate is separate and must not be implied to cover images").toMatch(/PHI gate/);
  });

  it("is honest only while the server really does share one key across vendors", () => {
    // If a future change makes this DeepSeek-only for real, the label above becomes the
    // lie — this test fails here to force the wording to be revisited, not to be kept.
    expect(reportComposer).toMatch(/cloudVisionAllowed:\s*deepseekCloudVisionAllowed/);
    expect(aiReporting).toMatch(/cloudVisionAllowed = ops\.deepseekCloudVisionAllowed === true/);
    expect(gateway).toMatch(/cloudVisionAllowed =[\s\S]{0,160}deepseekCloudVisionAllowed/);
  });

  it("still requires an explicit opt-in server-side, with no client override", () => {
    // The value comes from stored clinic settings only; a request body must never set it.
    expect(reportComposer).not.toMatch(/cloudVisionAllowed\s*=\s*body\.cloudVisionAllowed/);
    expect(gateway).toMatch(/let cloudVisionAllowed = false/);
  });
});

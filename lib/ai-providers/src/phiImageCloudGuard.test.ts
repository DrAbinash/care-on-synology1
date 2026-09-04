import { describe, expect, it } from "vitest";
import { generateAiResponse } from "./index";

describe("PHI clinical-image cloud egress guard", () => {
  it("blocks cloud providers when images are present", async () => {
    const res = await generateAiResponse("gemini", "Describe findings", ["base64frame"]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Clinical images cannot be sent to cloud/i);
    expect(res.diagnostics?.errorCode).toBe("PHI_IMAGE_CLOUD_BLOCKED");
  });

  it("does not block text-only cloud prompts (no images)", async () => {
    // Provider may be unconfigured in unit env — that is a different error class.
    const res = await generateAiResponse("gemini", "Text only prompt", []);
    expect(res.diagnostics?.errorCode).not.toBe("PHI_IMAGE_CLOUD_BLOCKED");
  });
});

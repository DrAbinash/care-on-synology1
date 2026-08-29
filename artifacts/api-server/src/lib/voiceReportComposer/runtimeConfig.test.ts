import { describe, expect, it } from "vitest";

const dbAvailable = Boolean(process.env.DATABASE_URL);

describe.skipIf(!dbAvailable)("composer runtime endpoint — canonical clinic source", () => {
  it("composer endpoint matches resolveLocalAiRuntime endpoint", async () => {
    const { resolveComposerRuntime } = await import("./runtimeConfig");
    const { resolveLocalAiRuntime } = await import("../aiPipeline/runtimeConfig");
    const local = await resolveLocalAiRuntime(true);
    const composer = await resolveComposerRuntime(true);
    expect(composer.endpoint).toBe(local.ollamaBaseUrl.replace(/\/$/, "") || local.ollamaBaseUrl);
    expect(composer.endpointSource).toBe(local.ollamaUrlSource);
  });

  it("composer does not define a separate endpoint field in schema", async () => {
    const { resolveComposerRuntime } = await import("./runtimeConfig");
    const composer = await resolveComposerRuntime(true);
    expect(composer).not.toHaveProperty("composerEndpoint");
    expect(composer.endpoint).toBeTruthy();
  });
});

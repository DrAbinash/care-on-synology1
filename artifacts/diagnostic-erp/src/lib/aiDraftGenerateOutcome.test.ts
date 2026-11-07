import { describe, expect, it } from "vitest";
import { describeAiGenerateFailure, describeAiGenerateOutcome } from "./aiDraftGenerateOutcome";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The audit item: "Pressing Generate can do nothing and say nothing."
 * `AiDraftPanel.tsx` awaited `aiClient.generate(...)` — which answers
 * `{ enqueued, reason }` — and threw the answer away, so a refusal (`enqueued: false`)
 * and a successful queue both ended with a stopped spinner and no message.
 */
describe("AI draft generate outcome is stated, not swallowed", () => {
  it("names a refusal with the server's own reason", () => {
    expect(describeAiGenerateOutcome({ enqueued: false, reason: "master flag off" }))
      .toBe("Not queued: master flag off");
    expect(describeAiGenerateOutcome({ enqueued: false, reason: "an AI draft is already queued for this study" }))
      .toContain("already queued");
  });

  it("keeps the scheduler's deferral sentence on a queue that did start", () => {
    const said = describeAiGenerateOutcome({ enqueued: true, reason: "night batch window", jobId: 42 });
    expect(said).toContain("Queued");
    expect(said).toContain("night batch window");
    expect(said).toContain("#42");
  });

  it("never renders an empty reason as a bare label", () => {
    for (const shape of [{}, { enqueued: false }, { enqueued: false, reason: "   " }, null, undefined]) {
      const said = describeAiGenerateOutcome(shape);
      expect(said.startsWith("Not queued: ")).toBe(true);
      expect(said.trim()).not.toBe("Not queued:");
    }
  });

  it("reports a thrown 403/5xx as a refusal the radiologist can read", () => {
    expect(describeAiGenerateFailure(new Error("403 — AI drafting is disabled for this modality")))
      .toBe("Not queued: 403 — AI drafting is disabled for this modality");
    expect(describeAiGenerateFailure(new Error("   "))).toBe("Not queued: the request failed");
    expect(describeAiGenerateFailure("boom")).toBe("Not queued: boom");
  });

  // Wiring check, not a behaviour proof: this package has no component test renderer,
  // so the branch coverage above is behavioural and this assertion only pins that the
  // panel calls the tested wording instead of dropping the response the way it did.
  it("is the panel's own path, and it no longer discards the response", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../components/ai/AiDraftPanel.tsx"), "utf8");
    expect(src).toContain("describeAiGenerateOutcome(await aiClient.generate(");
    expect(src).toContain("describeAiGenerateFailure(e)");
    expect(src).toContain('data-testid="ai-generate-outcome"');
    expect(src).not.toMatch(/try\s*\{\s*await aiClient\.generate\([^)]*\);\s*\}\s*finally/);
  });
});

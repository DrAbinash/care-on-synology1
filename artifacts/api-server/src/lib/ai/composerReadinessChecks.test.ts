/**
 * Report Composer readiness steps for the existing AI verification screen.
 *
 * The screen already proved the overnight image pipeline; these steps are the
 * Composer half, and they are pure so the verdicts can be tested without a
 * database, an Ollama server or a PACS.
 */
import { describe, expect, it } from "vitest";
import {
  composerModelInstalled,
  composerReadinessSteps,
  type ComposerReadinessInput,
} from "./composerReadinessChecks";

const INSTALLED = ["qwen3:14b", "qwen3-vl:8b", "llama3.2:3b"];

function input(overrides: Partial<ComposerReadinessInput> = {}): ComposerReadinessInput {
  return {
    routedProvider: null,
    routedModel: null,
    enabled: true,
    model: "qwen3:14b",
    fallbackModel: null,
    endpoint: "http://172.16.1.140:11434",
    timeoutMs: 90_000,
    endpointGuardOk: true,
    endpointGuardReason: null,
    reachable: true,
    installedModels: INSTALLED,
    probeError: null,
    ...overrides,
  };
}

function step(steps: ReturnType<typeof composerReadinessSteps>, id: string) {
  const found = steps.find((s) => s.id === id);
  expect(found, `no step ${id}`).toBeTruthy();
  return found!;
}

describe("composerModelInstalled", () => {
  it("matches a full tag exactly", () => {
    expect(composerModelInstalled("qwen3:14b", INSTALLED)).toBe(true);
  });

  it("matches a bare family name against a tagged install", () => {
    // The setting may hold "qwen3" while Ollama lists "qwen3:14b", and
    // composeEngine sends whichever string was saved — so both count.
    expect(composerModelInstalled("qwen3", INSTALLED)).toBe(true);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(composerModelInstalled("  QWEN3:14B ", INSTALLED)).toBe(true);
  });

  it("matches a hyphenated family but not a different size of the same family", () => {
    // "qwen3:14b" is installed. A raw startsWith on the family name would also
    // call "qwen3-vl:8b" a match for "qwen3", which is a different model.
    expect(composerModelInstalled("qwen3-vl", INSTALLED)).toBe(true);
    expect(composerModelInstalled("qwen3:70b", INSTALLED)).toBe(false);
    expect(composerModelInstalled("mistral", INSTALLED)).toBe(false);
  });

  it("is false for an empty model or an empty listing", () => {
    expect(composerModelInstalled("", INSTALLED)).toBe(false);
    expect(composerModelInstalled("qwen3:14b", [])).toBe(false);
  });
});

describe("composerReadinessSteps", () => {
  it("reports the five checks under their own group with stable ids", () => {
    const steps = composerReadinessSteps(input());
    expect(steps.map((s) => s.id)).toEqual([
      "composer-model",
      "composer-model-installed",
      "composer-timeout",
      "composer-endpoint-guard",
      "composer-fallback-model",
    ]);
    for (const s of steps) {
      expect(s.group, s.id).toBe("Report Composer");
      expect(s.name, s.id).toBeTruthy();
      expect(s.detail, s.id).toBeTruthy();
    }
  });

  it("all five pass on a correctly configured clinic", () => {
    const steps = composerReadinessSteps(input());
    for (const s of steps) expect(s.status, `${s.id}: ${s.detail}`).toBe("pass");
  });

  // ── 1. configured ────────────────────────────────────────────────────────
  it("fails when no composer model is set, and says what that costs", () => {
    const s = step(composerReadinessSteps(input({ model: "", enabled: false })), "composer-model");
    expect(s.status).toBe("fail");
    // The consequence is the part an operator needs: this is not an error, it is
    // a draft that looks like a report.
    expect(s.detail).toMatch(/mechanical fallback draft/);
    expect(s.detail).toMatch(/AI Reporting Settings → Local AI/);
  });

  it("fails when a model is set but the Local AI Assistant is off", () => {
    const s = step(
      composerReadinessSteps(input({ model: "qwen3:14b", enabled: false })),
      "composer-model",
    );
    expect(s.status).toBe("fail");
    expect(s.detail).toMatch(/switched off/);
    expect(s.detail).toContain("qwen3:14b");
  });

  // ── 2. installed ─────────────────────────────────────────────────────────
  it("fails when the configured model is not on the server, and lists what is", () => {
    const s = step(
      composerReadinessSteps(input({ model: "qwen3:70b" })),
      "composer-model-installed",
    );
    expect(s.status).toBe("fail");
    expect(s.detail).toMatch(/NOT on the server/);
    // Without the list the operator cannot tell whether to pull or to re-point.
    expect(s.detail).toContain("qwen3:14b");
  });

  it("fails when the server cannot be reached at all", () => {
    const s = step(
      composerReadinessSteps(input({ reachable: false, installedModels: [], probeError: "Timed out after 6000ms" })),
      "composer-model-installed",
    );
    expect(s.status).toBe("fail");
    expect(s.detail).toMatch(/Cannot list models/);
    expect(s.detail).toContain("Timed out after 6000ms");
  });

  it("skips the lookup when there is no model to look up", () => {
    const s = step(composerReadinessSteps(input({ model: "" })), "composer-model-installed");
    expect(s.status).toBe("skip");
  });

  // ── 3. timeout ───────────────────────────────────────────────────────────
  it("fails a timeout below the approved default and names the field to change", () => {
    const s = step(composerReadinessSteps(input({ timeoutMs: 45_000 })), "composer-timeout");
    expect(s.status).toBe("fail");
    expect(s.detail).toMatch(/^45s/);
    expect(s.detail).toMatch(/below the approved 90s default/);
    expect(s.detail).toMatch(/Timeout \(sec\)/);
    // And why it matters: a timeout is not an error, it is a silent fallback.
    expect(s.detail).toMatch(/mechanical draft, not an error/);
  });

  it("passes at the approved default and above it", () => {
    expect(step(composerReadinessSteps(input({ timeoutMs: 90_000 })), "composer-timeout").status).toBe("pass");
    expect(step(composerReadinessSteps(input({ timeoutMs: 120_000 })), "composer-timeout").status).toBe("pass");
  });

  // ── 4. endpoint guard ────────────────────────────────────────────────────
  it("fails with the guard's own sentence when the endpoint is refused", () => {
    const reason =
      'Private/LAN addresses require "Local / LAN mode" to be enabled in Settings → Radiology → AI Assistant (172.16.1.140)';
    const s = step(
      composerReadinessSteps(input({ endpointGuardOk: false, endpointGuardReason: reason })),
      "composer-endpoint-guard",
    );
    expect(s.status).toBe("fail");
    // Verbatim: the guard already names the setting, and a paraphrase here would
    // send the operator somewhere else.
    expect(s.detail).toBe(reason);
  });

  // ── 5. fallback model ────────────────────────────────────────────────────
  it("passes when no fallback is configured but says what happens instead", () => {
    const s = step(composerReadinessSteps(input({ fallbackModel: null })), "composer-fallback-model");
    expect(s.status).toBe("pass");
    expect(s.detail).toMatch(/None configured/);
    expect(s.detail).toMatch(/straight to the mechanical draft/);
  });

  it("fails a fallback model that is not installed — the retry would fail too", () => {
    const s = step(
      composerReadinessSteps(input({ fallbackModel: "mistral:7b" })),
      "composer-fallback-model",
    );
    expect(s.status).toBe("fail");
    expect(s.detail).toMatch(/NOT on the server/);
    expect(s.detail).toMatch(/the draft is mechanical/);
  });

  it("passes an installed fallback model", () => {
    const s = step(
      composerReadinessSteps(input({ fallbackModel: "llama3.2:3b" })),
      "composer-fallback-model",
    );
    expect(s.status).toBe("pass");
  });

  it("skips the fallback check when the server could not be reached", () => {
    const s = step(
      composerReadinessSteps(input({ fallbackModel: "llama3.2:3b", reachable: false, installedModels: [] })),
      "composer-fallback-model",
    );
    expect(s.status).toBe("skip");
  });

  // ── routing ──────────────────────────────────────────────────────────────
  it("skips the Ollama-only checks when Model Routing sends the composer elsewhere", () => {
    const steps = composerReadinessSteps(input({ routedProvider: "deepseek", routedModel: "deepseek-chat" }));
    expect(step(steps, "composer-model").status).toBe("pass");
    expect(step(steps, "composer-model").detail).toMatch(
      /sends report_composer to deepseek \(deepseek-chat\)/,
    );
    for (const id of ["composer-model-installed", "composer-endpoint-guard", "composer-fallback-model"]) {
      expect(step(steps, id).status, id).toBe("skip");
      expect(step(steps, id).detail, id).toMatch(/routed to deepseek/);
    }
    // The timeout applies to every provider arm, so it is still evaluated.
    expect(step(steps, "composer-timeout").status).toBe("pass");
  });

  it("still checks the Ollama arm when the route names ollama", () => {
    const steps = composerReadinessSteps(input({ routedProvider: "ollama", routedModel: "qwen3:14b" }));
    expect(step(steps, "composer-model-installed").status).toBe("pass");
    expect(step(steps, "composer-endpoint-guard").status).toBe("pass");
  });

  it("produces exactly one step per id, so the panel cannot render a duplicate", () => {
    for (const overrides of [
      {},
      { model: "" },
      { reachable: false, installedModels: [] },
      { routedProvider: "qwen" },
      { endpointGuardOk: false, endpointGuardReason: "refused" },
    ]) {
      const ids = composerReadinessSteps(input(overrides)).map((s) => s.id);
      expect(new Set(ids).size, JSON.stringify(overrides)).toBe(ids.length);
    }
  });
});

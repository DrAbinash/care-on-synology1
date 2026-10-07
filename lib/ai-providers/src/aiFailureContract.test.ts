/**
 * aiFailureContract.test.ts — the nine-member failure vocabulary, and the
 * promise that nothing secret or unbounded travels with it.
 *
 * Each case starts from a `diagnostics` object shaped exactly like the one the
 * provider arms really produce (the field names and code strings are the shipped
 * ones, not invented), because the point of this module is to translate what
 * already exists into one stable answer.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAiFailure, redactAiSecrets, type AiFailureCode } from "./aiFailureContract";
import type { AiQueryResult } from "./index";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("pnpm-workspace.yaml not found");
}

function executed(over: Partial<AiQueryResult["execution"]> = {}) {
  return {
    provider: "ollama",
    model: "qwen3-vl:8b",
    locality: "local" as const,
    timeoutMs: 300_000,
    attempted: true,
    ...over,
  };
}

function result(over: Partial<AiQueryResult> = {}): AiQueryResult {
  return { text: "IMPRESSION: Fine.", success: true, ...over };
}

const WIRE_CODES: AiFailureCode[] = [
  "DISABLED",
  "NOT_CONFIGURED",
  "TIMEOUT",
  "PROVIDER_HTTP_ERROR",
  "MALFORMED_RESPONSE",
  "PHI_POLICY_BLOCK",
  "IMAGE_EGRESS_BLOCK",
  "EMPTY_RESPONSE",
  "UNKNOWN",
];

describe("normalizeAiFailure — one answer for every provider layer", () => {
  it("a successful call with text is not a failure", () => {
    expect(normalizeAiFailure(result({ execution: executed() }))).toBeNull();
  });

  it("the clinic's PHI text policy is a policy decision, not an outage", () => {
    const f = normalizeAiFailure(result({
      text: "",
      success: false,
      error: "PHI_TEXT_CLOUD_BLOCKED: …",
      execution: executed({ provider: "gemini", locality: "cloud", attempted: false }),
      diagnostics: {
        provider: "gemini", errorCode: "PHI_TEXT_CLOUD_BLOCKED", errorClass: "PhiTextCloudBlocked",
      } as AiQueryResult["diagnostics"],
    }));
    expect(f?.code).toBe("PHI_POLICY_BLOCK");
    expect(f?.attempted).toBe(false);
    expect(f?.provider).toBe("gemini");
  });

  it("both image-egress refusals land in IMAGE_EGRESS_BLOCK", () => {
    for (const errorCode of ["PHI_IMAGE_CLOUD_BLOCKED", "MODEL_NOT_VISION_CAPABLE"]) {
      const f = normalizeAiFailure(result({
        text: "",
        success: false,
        diagnostics: { provider: "qwen", errorCode, errorClass: "PhiImageCloudBlocked" } as AiQueryResult["diagnostics"],
      }));
      expect(f?.code).toBe("IMAGE_EGRESS_BLOCK");
    }
  });

  it("an unconfigured provider is NOT_CONFIGURED, never a generic error", () => {
    const f = normalizeAiFailure(result({
      text: "",
      success: false,
      diagnostics: { provider: "gemini", errorCode: "PROVIDER_NOT_CONFIGURED", errorClass: "ProviderNotConfigured" } as AiQueryResult["diagnostics"],
    }));
    expect(f?.code).toBe("NOT_CONFIGURED");
  });

  it("a deadline that fired is distinguishable from a provider that refused", () => {
    const f = normalizeAiFailure(result({
      text: "",
      success: false,
      diagnostics: { provider: "ollama", errorCode: "PROVIDER_TIMEOUT", errorClass: "AiRequestTimeout" } as AiQueryResult["diagnostics"],
    }));
    expect(f?.code).toBe("TIMEOUT");
  });

  it("an HTTP status from the provider is PROVIDER_HTTP_ERROR and keeps its detail code", () => {
    const f = normalizeAiFailure(result({
      text: "",
      success: false,
      diagnostics: { provider: "openai", httpStatus: 429, errorCode: "PROVIDER_ERROR" } as AiQueryResult["diagnostics"],
    }));
    expect(f?.code).toBe("PROVIDER_HTTP_ERROR");
    expect(f?.detailCode).toBe("PROVIDER_ERROR");
  });

  it("local capacity failures (context budget, GPU) are provider errors, not parse failures", () => {
    for (const errorCode of ["CONTEXT_BUDGET_EXCEEDED", "GPU_OUT_OF_MEMORY"]) {
      const f = normalizeAiFailure(result({
        text: "",
        success: false,
        diagnostics: { provider: "ollama", errorCode } as AiQueryResult["diagnostics"],
      }));
      expect(f?.code).toBe("PROVIDER_HTTP_ERROR");
      expect(f?.detailCode).toBe(errorCode);
    }
  });

  it("an awake model that said nothing is EMPTY_RESPONSE", () => {
    const f = normalizeAiFailure(result({ text: "   ", success: true, execution: executed() }));
    expect(f?.code).toBe("EMPTY_RESPONSE");
  });

  it("anything unclassified stays UNKNOWN and keeps its raw class", () => {
    const f = normalizeAiFailure(result({
      text: "",
      success: false,
      error: "a new SDK threw something nobody has mapped yet",
      diagnostics: { provider: "ollama", errorClass: "WeirdNewThing" } as AiQueryResult["diagnostics"],
    }));
    expect(f?.code).toBe("UNKNOWN");
    expect(f?.detailCode).toBe("WeirdNewThing");
  });

  it("the caller can declare the one thing the execution layer cannot see", () => {
    // A provider that answered perfectly, in a form that is not the requested
    // section, is the route's discovery — and the route's responsibility to say.
    const f = normalizeAiFailure(result({ execution: executed() }), {
      code: "MALFORMED_RESPONSE",
      message: "The model answered without the IMPRESSION: section the request asked for.",
    });
    expect(f?.code).toBe("MALFORMED_RESPONSE");
    expect(f?.message).toMatch(/IMPRESSION:/);
    expect(f?.provider).toBe("ollama");
  });

  it("the override can name its own detail code — /draft and /query report mismatches", () => {
    // "The execution layer answered for a provider nobody validated" is invisible
    // to this layer and unfabricable by it: the caller states the code, the layer
    // still supplies the identity. Without `detailCode` travelling, the two routes
    // would refuse an answer and report `failure: null` — a refusal with no reason.
    const f = normalizeAiFailure(result({ execution: executed() }), {
      code: "UNKNOWN",
      detailCode: "PROVIDER_IDENTITY_MISMATCH",
      message: "The answer was discarded rather than recorded under an unconfirmed provider.",
    });
    expect(f?.code).toBe("UNKNOWN");
    expect(f?.detailCode).toBe("PROVIDER_IDENTITY_MISMATCH");
    expect(f?.provider).toBe("ollama");
  });

  it("identity comes from the execution layer, not from whatever the caller hoped", () => {
    const f = normalizeAiFailure(result({
      text: "",
      success: false,
      execution: executed(),
      diagnostics: { provider: "gemini", errorCode: "PROVIDER_NOT_CONFIGURED" } as AiQueryResult["diagnostics"],
    }));
    // `executed()` says ollama — the report follows the executor.
    expect(f?.provider).toBe("ollama");
    expect(f?.model).toBe("qwen3-vl:8b");
    expect(f?.timeoutMs).toBe(300_000);
  });
});

describe("failure messages are safe to show", () => {
  it("redacts credential-shaped text", () => {
    const leaked = [
      "openai rejected the key sk-abcdefghijklmnopqrstuvwxyz1234",
      "header Authorization: Bearer eyJhbGciOi.abcdef.GHIJ789",
      "config api_key=supersecretvalue123",
      "resolved decrypted:ENCRYPTED_BLOB_VALUE",
    ].join(" | ");
    const out = redactAiSecrets(leaked);
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz1234");
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).not.toContain("supersecretvalue123");
    expect(out).not.toContain("ENCRYPTED_BLOB_VALUE");
    expect(out).toContain("[REDACTED]");
  });

  it("bounds the message so a provider dump cannot ride along", () => {
    const f = normalizeAiFailure(result({
      text: "",
      success: false,
      error: "x".repeat(20_000),
      diagnostics: { provider: "ollama", errorMessage: "y".repeat(20_000) } as AiQueryResult["diagnostics"],
    }));
    expect((f?.message ?? "").length).toBeLessThanOrEqual(240);
    expect(f?.message).not.toMatch(/^y+$/);
  });

  it("falls back to a plain sentence when the provider gave nothing usable", () => {
    const f = normalizeAiFailure(result({
      text: "",
      success: false,
      diagnostics: { provider: "ollama", errorCode: "PROVIDER_TIMEOUT" } as AiQueryResult["diagnostics"],
    }));
    expect(f?.message).toBe("The model did not answer within the configured time.");
  });
});

describe("the wire mirror cannot drift", () => {
  it("api-zod declares exactly the same nine codes", () => {
    const src = readFileSync(join(repoRoot(), "lib/api-zod/src/radiologyAi.ts"), "utf8");
    const block = src.match(/export type AiFailureWireCode =([^]*?);/);
    // Non-vacuity: the block has to exist and have members.
    expect(block?.[1]).toBeTruthy();
    const wire = [...(block?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(wire).toHaveLength(WIRE_CODES.length);
    expect(new Set(wire)).toEqual(new Set(WIRE_CODES));
  });

  it("api-zod mirrors the execution identity field-for-field", () => {
    // `executed` is the field a screen reads to answer "which model wrote this?",
    // so a mirror missing `locality` or `attempted` would silently turn a truthful
    // record into a partial one on the browser side.
    const wireBlock = readFileSync(join(repoRoot(), "lib/api-zod/src/radiologyAi.ts"), "utf8")
      .match(/export interface AiExecutedIdentity \{([^]*?)\n\}/)?.[1] ?? "";
    const serverBlock = readFileSync(join(repoRoot(), "lib/ai-providers/src/index.ts"), "utf8")
      .match(/export interface AiExecutionIdentity \{([^]*?)\n\}/)?.[1] ?? "";
    const fields = (src: string) => src
      .split(/\r?\n/)
      // Comments are stripped, never sliced by a character budget: a longer doc
      // line would otherwise truncate the block and make this compare nothing.
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .map((line) => line.match(/^\s*(\w+)\??:/)?.[1])
      .filter((name): name is string => !!name);
    // Non-vacuity: the server interface must declare its five fields, or this test
    // would pass by comparing two empty sets.
    expect(fields(serverBlock)).toHaveLength(5);
    expect(fields(wireBlock)).toHaveLength(5);
    expect(new Set(fields(wireBlock))).toEqual(new Set(fields(serverBlock)));
  });

  it("every code in the contract has a default sentence", () => {
    for (const code of WIRE_CODES) {
      const f = normalizeAiFailure(result({
        text: "",
        success: false,
        error: undefined,
        diagnostics: { provider: "ollama", errorCode: `UNMAPPED_${code}`, errorClass: code } as AiQueryResult["diagnostics"],
      }));
      expect(f?.message ?? "").not.toBe("");
    }
  });
});

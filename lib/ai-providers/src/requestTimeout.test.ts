import { afterEach, describe, expect, test } from "vitest";
import {
  AiRequestTimeoutError,
  resolveRequestTimeoutMs,
  withAiDeadline,
} from "./index";

// Every clinical AI call used to be unbounded unless its caller happened to
// pass a budget, so a wedged model or a cloud endpoint that accepts the socket
// and never answers held an Express request open indefinitely.

const original = process.env.AI_REQUEST_TIMEOUT_SECONDS;

afterEach(() => {
  if (original === undefined) delete process.env.AI_REQUEST_TIMEOUT_SECONDS;
  else process.env.AI_REQUEST_TIMEOUT_SECONDS = original;
});

describe("resolveRequestTimeoutMs", () => {
  test("a caller that knows better keeps its own budget", () => {
    expect(resolveRequestTimeoutMs(45_000)).toBe(45_000);
    expect(resolveRequestTimeoutMs(600_000)).toBe(600_000);
  });

  test("no budget from the caller still gets one", () => {
    delete process.env.AI_REQUEST_TIMEOUT_SECONDS;
    expect(resolveRequestTimeoutMs()).toBe(300_000);
    expect(resolveRequestTimeoutMs(undefined)).toBe(300_000);
    expect(resolveRequestTimeoutMs(Number.NaN)).toBe(300_000);
    expect(resolveRequestTimeoutMs(0)).toBe(300_000);
  });

  test("the operator's setting is honoured, and clamped to a sane band", () => {
    process.env.AI_REQUEST_TIMEOUT_SECONDS = "60";
    expect(resolveRequestTimeoutMs()).toBe(60_000);

    process.env.AI_REQUEST_TIMEOUT_SECONDS = "5";
    expect(resolveRequestTimeoutMs()).toBe(30_000);

    process.env.AI_REQUEST_TIMEOUT_SECONDS = "99999";
    expect(resolveRequestTimeoutMs()).toBe(900_000);

    process.env.AI_REQUEST_TIMEOUT_SECONDS = "not-a-number";
    expect(resolveRequestTimeoutMs()).toBe(300_000);
  });
});

describe("withAiDeadline", () => {
  test("an answer that arrives is passed through untouched", async () => {
    await expect(withAiDeadline(Promise.resolve("text"), 1_000, "Gemini")).resolves.toBe("text");
  });

  test("a provider that never answers rejects with a named timeout", async () => {
    const never = new Promise<string>(() => { /* no settle */ });
    await expect(withAiDeadline(never, 20, "Ollama")).rejects.toBeInstanceOf(AiRequestTimeoutError);
    await withAiDeadline(never, 20, "Ollama").catch((e: unknown) => {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/Ollama did not respond within/);
    });
  });
});

/**
 * localBurnedInOcr.test.ts — the on-premises checker must fail closed, and must
 * never become the leak it exists to prevent.
 *
 * No model and no network: the vision resolver and the task runner are injected.
 * The important assertions are the ones where the runner declines to attest —
 * each of those is a cloud transmission that does not happen.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => {
  const dummy: Record<string, unknown> = {};
  const proxy = new Proxy(dummy, {
    get: (t, k: string) => (k in t ? t[k] : (t[k] = { __table: k, __isMock: true })),
  });
  return { db: { select: () => proxy }, ...proxy };
});

import { createLocalBurnedInOcrRunner } from "./localBurnedInOcr";

type Vision = { endpointUrl: string; model: string } | null;
type TaskResult = {
  text?: string;
  success?: boolean;
  error?: string;
  execution?: { attempted: boolean; provider: string };
};

const LOCAL = "http://192.168.0.50:11434";

function runnerFor(vision: Vision, result: Partial<TaskResult> | Error) {
  const runTask = vi.fn(async () => {
    if (result instanceof Error) throw result;
    // Explicit rather than a spread of defaults: a provider result with no
    // text/success must stay unfalsy, and overwriting a default silently is
    // exactly the ambiguity TS would flag here.
    return {
      text: result.text ?? "",
      success: result.success ?? false,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.execution !== undefined ? { execution: result.execution } : {}),
    };
  }) as never;
  const resolveVision = vi.fn(async () => vision);
  return {
    runTask,
    runner: createLocalBurnedInOcrRunner({ resolveVision, runTask }),
  };
}

describe("it refuses to attest rather than imply a clean image", () => {
  it("no local vision model configured", async () => {
    const { runner } = runnerFor(null, { success: true, text: '{"legible":true,"text":""}' });
    const a = await runner("QUJD", "image/jpeg");
    expect(a).toEqual({ read: false, reason: "no local vision model is configured" });
  });

  it("a vision row with no endpoint is not a checker", async () => {
    const { runner } = runnerFor({ endpointUrl: "  ", model: "qwen3-vl:8b" }, {});
    expect((await runner("QUJD", "image/jpeg")).read).toBe(false);
  });

  it("a resolver that throws does not become a pass", async () => {
    const runner = createLocalBurnedInOcrRunner({
      resolveVision: async () => {
        throw new Error("db down");
      },
      runTask: vi.fn() as never,
    });
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("local vision lookup failed");
  });
});

describe("the check stays on-premises", () => {
  it("refuses a model whose endpoint resolves to the public internet", async () => {
    // This is the leak-that-looks-like-a-control case: a row named "ollama"
    // pointing at a vendor would send every image for a privacy check that is
    // supposed to keep images local.
    const { runner, runTask } = runnerFor(
      { endpointUrl: "https://ollama.some-vendor.example", model: "qwen3-vl:8b" },
      { success: true, text: '{"legible":true,"text":""}' },
    );
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("off-premises");
    // Refusing before the call is the point — nothing was sent anywhere.
    expect(runTask).not.toHaveBeenCalled();
  });

  it("accepts a genuinely private LAN endpoint", async () => {
    const { runner, runTask } = runnerFor(
      { endpointUrl: LOCAL, model: "qwen3-vl:8b" },
      { success: true, text: '{"legible":true,"text":"liver normal"}' },
    );
    const a = await runner("QUJD", "image/jpeg");
    expect(a).toEqual({ read: true, transcript: "liver normal" });
    expect(runTask).toHaveBeenCalled();
  });

  it("passes the resolved model and endpoint through unchanged", async () => {
    const { runner, runTask } = runnerFor(
      { endpointUrl: LOCAL, model: "qwen3-vl:8b" },
      { success: true, text: '{"legible":true,"text":"x"}' },
    );
    await runner("BASE64BYTES", "image/jpeg");
    const call = (runTask as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("burned_in_text_ocr");
    expect(call[2]).toEqual(["BASE64BYTES"]);
    expect(call[3]).toMatchObject({ provider: "ollama", model: "qwen3-vl:8b", endpointUrl: LOCAL });
  });
});

describe("the answer is read as an attestation, not as text", () => {
  const cleanModel = { endpointUrl: LOCAL, model: "qwen3-vl:8b" };

  it("legible true with a transcript attests", async () => {
    const { runner } = runnerFor(cleanModel, {
      success: true,
      text: '{"legible": true, "text": "ABIHNASH SINGH 12/04/1980"}',
    });
    expect(await runner("QUJD", "image/jpeg")).toEqual({
      read: true,
      transcript: "ABIHNASH SINGH 12/04/1980",
    });
  });

  it("legible true with an EMPTY transcript is still a real attestation", async () => {
    // A clean image genuinely has no text. This is the one place where silence
    // IS evidence, and it is only trustworthy because `legible` was asserted.
    const { runner } = runnerFor(cleanModel, { success: true, text: '{"legible":true,"text":""}' });
    expect(await runner("QUJD", "image/jpeg")).toEqual({ read: true, transcript: "" });
  });

  it("legible false declines", async () => {
    const { runner } = runnerFor(cleanModel, { success: true, text: '{"legible":false,"text":"???"}' });
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("could not read");
  });

  it("a missing legibility flag declines rather than assuming", async () => {
    const { runner } = runnerFor(cleanModel, { success: true, text: '{"text":"liver normal"}' });
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("no legibility attestation");
  });

  it("legible true with no text field declines", async () => {
    const { runner } = runnerFor(cleanModel, { success: true, text: '{"legible":true}' });
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("without a transcript");
  });

  it("prose around the JSON is tolerated, malformed JSON is not", async () => {
    const wrapped = runnerFor(cleanModel, {
      success: true,
      text: 'Here you go:\n{"legible":true,"text":"name in corner"}\nHope that helps.',
    });
    expect(await wrapped.runner("QUJD", "image/jpeg")).toEqual({
      read: true,
      transcript: "name in corner",
    });

    const broken = runnerFor(cleanModel, { success: true, text: '{"legible":tru}' });
    const a = await broken.runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("malformed JSON");
  });

  it("no JSON at all declines", async () => {
    const { runner } = runnerFor(cleanModel, { success: true, text: "I could not analyse this image." });
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("did not return a readable answer");
  });
});

describe("provider failures decline, and say less than they heard", () => {
  const cleanModel = { endpointUrl: LOCAL, model: "qwen3-vl:8b" };

  it("a model that did not answer declines", async () => {
    const { runner } = runnerFor(cleanModel, { success: false, error: "boom" });
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("did not answer");
  });

  it("a call refused before it started is reported as such", async () => {
    const { runner } = runnerFor(cleanModel, {
      success: false,
      execution: { attempted: false, provider: "ollama" },
    });
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) expect(a.reason).toContain("refused the request before answering");
  });

  it("a thrown provider error is categorised, not echoed", async () => {
    const { runner } = runnerFor(
      cleanModel,
      new Error("connect ECONNREFUSED to https://user:sk-abcdefghijklmnopqrstuvwxyz@host"),
    );
    const a = await runner("QUJD", "image/jpeg");
    expect(a.read).toBe(false);
    if (!a.read) {
      expect(a.reason).toContain("local vision call failed");
      // The reason reaches an operator screen; a provider error often echoes
      // the URL or header it was given.
      expect(a.reason).not.toMatch(/sk-/);
      expect(a.reason).not.toContain("host");
    }
  });

  it("the prompt demands transcription and forbids interpretation", async () => {
    const { runner, runTask } = runnerFor(cleanModel, {
      success: true,
      text: '{"legible":true,"text":""}',
    });
    await runner("QUJD", "image/jpeg");
    const prompt = String((runTask as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1]);
    expect(prompt).toMatch(/EVERY piece of legible text/i);
    expect(prompt).toMatch(/not reading the image clinically/i);
    expect(prompt).toMatch(/Do not translate, expand, correct/);
  });
});

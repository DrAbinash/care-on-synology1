import { beforeEach, describe, expect, it, test, vi } from "vitest";

// The image egress guard has existed for a while; the text beside it did not.
// A prompt naming a patient used to reach any enabled cloud provider unchecked,
// because the only gate ran when at least one image was attached. These tests
// pin the new behaviour end-to-end at the provider boundary: what Gemini is
// actually handed.

let globalSettings: string | null;

const geminiParts = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async (parts: unknown) => {
          geminiParts.calls.push(parts);
          return { response: { text: () => "OK" } };
        },
      };
    }
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => ({ __provider: value }),
  and: (...parts: unknown[]) => parts,
}));

vi.mock("@workspace/db", () => {
  const aiProviderSettingsTable = {
    provider: "provider",
    settingsJson: "settings_json",
    isEnabled: "is_enabled",
    encryptedApiKey: "encrypted_api_key",
    defaultModel: "default_model",
    endpointUrl: "endpoint_url",
  };
  const row = (provider: string) => {
    if (provider === "__global__") return { settingsJson: globalSettings };
    if (provider === "gemini") {
      return {
        provider: "gemini",
        isEnabled: true,
        encryptedApiKey: "ZW5jcnlwdGVkLWtleQ==",
        defaultModel: "gemini-1.5-pro",
        endpointUrl: null,
        settingsJson: null,
      };
    }
    return { provider, isEnabled: false, encryptedApiKey: null, defaultModel: null, endpointUrl: null, settingsJson: null };
  };
  const db = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          const flat = Array.isArray(cond) ? cond : [cond];
          const hit = flat.find((c) => (c as { __provider?: string })?.__provider) as
            | { __provider: string }
            | undefined;
          return { limit: async () => [row(hit?.__provider ?? "")] };
        },
      }),
    }),
  };
  return { db, aiProviderSettingsTable, aiModelRoutesTable: {} };
});

vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => "plain-api-key" }));

import { generateAiResponse } from "./index";

const PHI_PROMPT = [
  "Summarise this case.",
  "Patient: Ananya Sharma",
  "ID: EXP-2610-0016",
  "Date of Birth: 1992-04-30",
].join("\n");

beforeEach(() => {
  globalSettings = null;
  geminiParts.calls = [];
});

describe("PHI text cloud egress guard", () => {
  test("cloud + named patient + no opt-in: blocked, and nothing reaches the provider", async () => {
    const res = await generateAiResponse("gemini", PHI_PROMPT, []);

    expect(res.success).toBe(false);
    expect(res.diagnostics?.errorCode).toBe("PHI_TEXT_CLOUD_BLOCKED");
    expect(res.error).toMatch(/Keep this task on a local model/);
    expect(geminiParts.calls).toHaveLength(0);
  });

  test("the block names the categories found, so the operator knows what to fix", async () => {
    const res = await generateAiResponse("gemini", PHI_PROMPT, []);
    expect(res.error).toMatch(/name/);
    expect(res.error).toMatch(/patient_id/);
    expect(res.error).toMatch(/date_of_birth/);
  });

  test("opt-in sends the prompt with the identifiers redacted", async () => {
    globalSettings = JSON.stringify({ cloudTextPhiAllowed: true });
    const res = await generateAiResponse("gemini", PHI_PROMPT, []);

    expect(res.success).toBe(true);
    expect(geminiParts.calls).toHaveLength(1);
    const sent = JSON.stringify(geminiParts.calls[0]);
    expect(sent).not.toContain("Ananya Sharma");
    expect(sent).not.toContain("EXP-2610-0016");
    expect(sent).not.toContain("1992-04-30");
    expect(sent).toContain("[REDACTED]");
    expect(sent).toContain("Summarise this case.");
  });

  test("an opt-in that is merely present but not true still denies", async () => {
    globalSettings = JSON.stringify({ cloudTextPhiAllowed: false });
    const res = await generateAiResponse("gemini", PHI_PROMPT, []);
    expect(res.diagnostics?.errorCode).toBe("PHI_TEXT_CLOUD_BLOCKED");
  });

  test("a clean clinical prompt is untouched and ungated", async () => {
    const clean = "No midline shift. The ventricles are normal in size and configuration.";
    const res = await generateAiResponse("gemini", clean, []);

    expect(res.success).toBe(true);
    expect(JSON.stringify(geminiParts.calls[0])).toContain("No midline shift");
  });

  it("does not gate the on-prem provider, which is where patient data belongs", async () => {
    // Ollama needs no key and no opt-in; the gate is for cloud egress only.
    const res = await generateAiResponse("ollama", PHI_PROMPT, [], {
      model: "qwen3-vl:8b",
      endpointUrl: "http://127.0.0.1:1",
      timeoutMs: 50,
    });
    expect(res.diagnostics?.errorCode).not.toBe("PHI_TEXT_CLOUD_BLOCKED");
    expect(res.success).toBe(false); // connection refused — but it was allowed to try
  });
});

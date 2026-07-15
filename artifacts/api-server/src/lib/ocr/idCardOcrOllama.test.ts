import { describe, it, expect, vi, beforeEach } from "vitest";

// Ollama chat-completion models are more prone than Gemini's structured-
// output-tuned models to wrapping JSON in markdown fences or adding stray
// prose despite explicit instructions not to — these tests guard the
// parsing/normalization layer against exactly that, plus the deterministic
// age-from-DOB computation and ID-number masking the spec requires (never
// trust the model's own math, never store/log a full ID number).

const mockGenerateAiForTask = vi.fn();

vi.mock("@workspace/ai-providers", () => ({
  generateAiForTask: (...args: unknown[]) => mockGenerateAiForTask(...args),
}));

const { ollamaOcrIdCard } = await import("./idCardOcrOllama");

const OPTS = { endpointUrl: "http://100.79.100.41:11434", model: "llava:13b" };

beforeEach(() => {
  vi.clearAllMocks();
});

function ollamaSuccess(text: string) {
  mockGenerateAiForTask.mockResolvedValue({ success: true, text });
}

describe("ollamaOcrIdCard — happy path", () => {
  it("parses a well-formed response and normalizes it onto IdCardOcrResult", async () => {
    ollamaSuccess(JSON.stringify({
      documentType: "AADHAAR",
      name: "Ramesh Kumar",
      dateOfBirth: "1990-05-14",
      yearOfBirth: "1990",
      age: null,
      gender: "MALE",
      address: "123 MG Road,  Deoghar , Jharkhand",
      idNumber: "123456789012",
      confidence: { name: 95, dateOfBirth: 90, gender: 92, address: 88, idNumber: 97 },
    }));

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    expect(result.guardianName).toBe("Ramesh Kumar");
    expect(result.address).toBe("123 MG Road, Deoghar , Jharkhand"); // whitespace collapsed
    expect(result.documentType).toBe("Aadhaar");
    expect(result.gender).toBe("M");
    expect(result.ocrProvider).toBe("ollama");
    expect(result.dob).toBe("1990-05-14");
    // Last-4-only masking, never the full number.
    expect(result.idNumber).toBe("••••••••9012");
    expect(result.idNumber).not.toContain("123456789012");
  });

  it("computes age deterministically from dateOfBirth rather than trusting the model's own age field", async () => {
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    const dob = eighteenYearsAgo.toISOString().slice(0, 10);

    ollamaSuccess(JSON.stringify({
      documentType: "VOTER_ID", name: "Test Person", dateOfBirth: dob, yearOfBirth: "", age: 999, gender: "FEMALE",
      address: "Some address", idNumber: "ABC1234567",
      confidence: { name: 90, dateOfBirth: 90, gender: 90, address: 90, idNumber: 90 },
    }));

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    // NOT 999 — the model's bogus age value is discarded entirely.
    expect(result.age).toBe(18);
  });

  it("falls back to yearOfBirth-only age computation when dateOfBirth is unavailable", async () => {
    const thisYear = new Date().getFullYear();
    ollamaSuccess(JSON.stringify({
      documentType: "PAN", name: "Test Person", dateOfBirth: "", yearOfBirth: String(thisYear - 40), age: null, gender: "OTHER",
      address: "Some address", idNumber: "ABCDE1234F",
      confidence: { name: 80, dateOfBirth: 0, gender: 80, address: 80, idNumber: 85 },
    }));

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    expect(result.age).toBe(40);
    expect(result.gender).toBe("Other");
  });
});

describe("ollamaOcrIdCard — malformed / adversarial model output", () => {
  it("strips a ```json ... ``` markdown fence before parsing", async () => {
    ollamaSuccess("```json\n" + JSON.stringify({
      documentType: "AADHAAR", name: "Fenced Name", dateOfBirth: "", yearOfBirth: "", age: null, gender: "MALE",
      address: "Fenced Address", idNumber: "999988887777",
      confidence: { name: 90, dateOfBirth: 0, gender: 90, address: 90, idNumber: 90 },
    }) + "\n```");

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    expect(result.guardianName).toBe("Fenced Name");
    expect(result.address).toBe("Fenced Address");
  });

  it("strips a bare ``` ... ``` fence (no language tag)", async () => {
    ollamaSuccess("```\n" + JSON.stringify({ documentType: "OTHER", name: "Bare Fence", address: "X", confidence: {} }) + "\n```");

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    expect(result.guardianName).toBe("Bare Fence");
  });

  it("extracts JSON even when the model adds prose before/after it despite instructions", async () => {
    ollamaSuccess(`Sure, here is the extracted data:\n${JSON.stringify({ documentType: "AADHAAR", name: "Prose Wrapped", address: "Y", confidence: {} })}\nLet me know if you need anything else!`);

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    expect(result.guardianName).toBe("Prose Wrapped");
  });

  it("returns a well-typed empty-ish result (never throws) when the response isn't JSON at all", async () => {
    ollamaSuccess("I cannot read this image clearly.");

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    expect(result.guardianName).toBe("");
    expect(result.address).toBe("");
    expect(result.confidencePercent).toBe(0);
    expect(result.confidence).toBe("low");
  });

  it("clamps out-of-range confidence values instead of trusting the model verbatim", async () => {
    ollamaSuccess(JSON.stringify({
      documentType: "AADHAAR", name: "Overconfident", address: "Z", dateOfBirth: "", yearOfBirth: "", age: null, gender: "MALE", idNumber: "",
      confidence: { name: 150, dateOfBirth: -20, gender: 92, address: 88, idNumber: 97 },
    }));

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    expect(result.fieldConfidence?.name).toBe(100);
    expect(result.fieldConfidence?.dateOfBirth).toBe(0);
  });

  it("treats an unrecognized documentType as Other rather than passing it through raw", async () => {
    ollamaSuccess(JSON.stringify({ documentType: "SOMETHING_WEIRD", name: "N", address: "A", confidence: {} }));

    const result = await ollamaOcrIdCard("base64imagedata", OPTS);

    expect(result.documentType).toBe("Other");
  });
});

describe("ollamaOcrIdCard — provider failure", () => {
  it("throws when generateAiForTask reports failure, so the resolver's fallback/error path can take over", async () => {
    mockGenerateAiForTask.mockResolvedValue({ success: false, text: "", error: "connection refused" });

    await expect(ollamaOcrIdCard("base64imagedata", OPTS)).rejects.toThrow("connection refused");
  });
});
